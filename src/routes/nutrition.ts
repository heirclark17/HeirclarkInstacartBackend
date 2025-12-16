import { Router, Request, Response } from "express";
import multer from "multer";
import sharp from "sharp";
import OpenAI from "openai";
import { v4 as uuidv4 } from "uuid";

import {
  memoryStore,
  addMealForUser,
  Meal,
  NutritionItem,
} from "../utils/services/nutritionService";
import { estimateMealFromText } from "../services/aiNutritionService";

/* ======================================================================
   Setup
   ====================================================================== */

export const nutritionRouter = Router();

const upload = multer({ storage: multer.memoryStorage() });

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// ✅ Configurable models
const VISION_MODEL = process.env.OPENAI_VISION_MODEL || "gpt-4o-mini";
const MACRO_MODEL = process.env.OPENAI_MACRO_MODEL || "gpt-4.1-mini";

// ✅ Tunables
const PHOTO_CONFIDENCE_AUTOLOG_MIN = Number(
  process.env.PHOTO_CONFIDENCE_AUTOLOG_MIN || 60
);

// ✅ Image tunables (raise detail to improve confidence + foods)
const PHOTO_MAX_WIDTH = Number(process.env.PHOTO_MAX_WIDTH || 1024);
const PHOTO_JPEG_QUALITY = Number(process.env.PHOTO_JPEG_QUALITY || 82);

console.log("[nutrition] routes loaded (photo ai + swaps + explanation)", {
  build: process.env.RAILWAY_GIT_COMMIT_SHA || "unknown",
  visionModel: VISION_MODEL,
  macroModel: MACRO_MODEL,
  autologMinConfidence: PHOTO_CONFIDENCE_AUTOLOG_MIN,
  photoMaxWidth: PHOTO_MAX_WIDTH,
  photoJpegQuality: PHOTO_JPEG_QUALITY,
});

/* ======================================================================
   Small helpers
   ====================================================================== */

function nowMs() {
  return Date.now();
}

function clamp(n: number, min = 0, max = 100) {
  const x = Number(n);
  if (!Number.isFinite(x)) return min;
  return Math.max(min, Math.min(max, x));
}

function errStatus(err: any): number | undefined {
  return err?.status || err?.response?.status;
}

function errMessage(err: any): string {
  return String(err?.message || err?.response?.data?.error?.message || err || "");
}

// ✅ Robust JSON parsing (handles occasional extra text)
function safeParseJson(text: string) {
  // Fast path
  try {
    return JSON.parse(text);
  } catch {
    // Try to extract the first {...} block
    const match = text.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error("Model returned non-JSON output");
  }
}

/* ======================================================================
   STEP 1: Vision — Describe image (Vision model)
   - Forces JSON output via response_format json_object
   ====================================================================== */

async function describeMealImage(
  imageBuffer: Buffer,
  reqId: string
): Promise<{
  foods: string[];
  portionNotes: string;
  clarity: number; // 0..100
}> {
  const t0 = nowMs();

  // ✅ Keep more detail to improve recognition + confidence stability
  const compressed = await sharp(imageBuffer)
    .resize({ width: PHOTO_MAX_WIDTH, withoutEnlargement: true })
    .jpeg({ quality: PHOTO_JPEG_QUALITY })
    .toBuffer();

  const base64Image = compressed.toString("base64");

  try {
    const response = await openai.chat.completions.create({
      model: VISION_MODEL,
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `
You are analyzing a food photo for meal logging.

Return JSON ONLY in this exact shape:
{
  "foods": string[],
  "portionNotes": string,
  "clarity": number
}

Rules:
- foods: list only what is clearly visible (no hidden guesses)
- portionNotes: short, concrete (e.g. "about 1 cup rice", "2 chicken thighs", "sauce unknown")
- clarity: 0-100 how clearly the photo shows the food (lighting, focus, crop)
- No markdown, no extra text
`,
            },
            {
              type: "image_url",
              image_url: { url: `data:image/jpeg;base64,${base64Image}` },
            },
          ],
        },
      ],
    });

    const raw = response.choices[0]?.message?.content || "{}";
    const parsed = safeParseJson(raw);

    const result = {
      foods: Array.isArray(parsed.foods)
        ? parsed.foods.map((x: any) => String(x)).filter(Boolean)
        : [],
      portionNotes: parsed.portionNotes ? String(parsed.portionNotes) : "unknown portions",
      clarity: clamp(Number(parsed.clarity) || 0, 0, 100),
    };

    console.log("[nutrition][photo][vision]", {
      reqId,
      model: VISION_MODEL,
      ms: nowMs() - t0,
      foodsCount: result.foods.length,
      clarity: result.clarity,
    });

    return result;
  } catch (err: any) {
    const status = errStatus(err);
    const msg = errMessage(err);

    console.error("[nutrition][photo][vision] error", {
      reqId,
      model: VISION_MODEL,
      status,
      msg,
    });

    if (status === 403 || msg.includes("does not have access")) {
      throw new Error(
        `Vision model access denied for "${VISION_MODEL}". ` +
          `Set OPENAI_VISION_MODEL to a permitted vision model (recommended: "gpt-4o-mini"), ` +
          `or enable access for this model in your OpenAI Project.`
      );
    }

    throw err;
  }
}

/* ======================================================================
   STEP 2: Reasoning — Estimate macros + swaps + explanation (production prompt)
   - Forces JSON via response_format json_object
   - Adds reasoningConfidence (0..100)
   ====================================================================== */

type PhotoAIResult = {
  mealName: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;

  // ✅ restored
  explanation: string;
  swaps: string[];

  // diagnostics
  foods: string[];
  visionClarity: number; // 0..100
  reasoningConfidence: number; // 0..100

  // final blended confidence used by UI/autolog
  confidence: number; // 0..100
};

function normalizeSwaps(x: any): string[] {
  if (!Array.isArray(x)) return [];
  return x
    .map((v) => (v == null ? "" : String(v)).trim())
    .filter(Boolean)
    .slice(0, 6);
}

function normalizeExplanation(x: any): string {
  if (!x) return "";
  const s = String(x).trim();
  // keep it short-ish for UI
  return s.length > 600 ? s.slice(0, 600) + "…" : s;
}

function computeBlendedConfidence(args: {
  visionClarity: number;
  reasoningConfidence: number;
  foodsCount: number;
}) {
  const v = clamp(args.visionClarity, 0, 100);
  const r = clamp(args.reasoningConfidence, 0, 100);

  // ✅ Weighted blend: vision matters, but reasoning prevents "obvious meals" from tanking
  let blended = Math.round(0.55 * v + 0.45 * r);

  // ✅ Small boost if foods were actually identified
  if (args.foodsCount > 0) blended += 6;

  // ✅ Small penalty if nothing identified (still allow some confidence, but lower)
  if (args.foodsCount === 0) blended -= 12;

  // ✅ Stability guard rails (avoid silly lows on clear pics)
  if (v >= 75 && r >= 70) blended = Math.max(blended, 72);
  if (v >= 85 && r >= 80) blended = Math.max(blended, 80);

  return clamp(blended, 0, 100);
}

async function estimateMealFromImage(
  imageBuffer: Buffer,
  reqId: string
): Promise<PhotoAIResult> {
  const t0 = nowMs();

  // ---- Vision gate ----
  const vision = await describeMealImage(imageBuffer, reqId);

  const descriptionText = `
Foods identified:
${vision.foods.length ? vision.foods.map((f) => `- ${f}`).join("\n") : "- (none confidently identified)"}

Portion notes:
${vision.portionNotes}

Photo clarity (0-100):
${vision.clarity}
`.trim();

  // ---- Production macro prompt (macros + explanation + swaps + reasoningConfidence) ----
  let raw = "{}";
  try {
    const response = await openai.chat.completions.create({
      model: MACRO_MODEL,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "user",
          content: `
You are a meticulous nutrition coach estimating macros from a photo description.

Use ONLY the foods listed. Do not invent hidden ingredients.
If anything is uncertain, be conservative.

Return JSON ONLY in this exact shape:
{
  "mealName": string,
  "calories": number,
  "protein": number,
  "carbs": number,
  "fat": number,
  "explanation": string,
  "swaps": string[],
  "reasoningConfidence": number
}

Rules:
- mealName: short, user-friendly
- calories/protein/carbs/fat: realistic totals for ONE meal
- explanation: 1–3 sentences explaining what you assumed (portions / cooking method) and uncertainty
- swaps: 2–5 healthier swaps OR improvements (simple, actionable). If already healthy, suggest optimizations (e.g., "add veggies", "swap sugary sauce for…")
- reasoningConfidence: 0–100 (how confident you are in the macro estimate given the description)

${descriptionText}
`,
        },
      ],
    });

    raw = response.choices[0]?.message?.content || "{}";
  } catch (err: any) {
    console.error("[nutrition][photo][macro] error", {
      reqId,
      model: MACRO_MODEL,
      status: errStatus(err),
      msg: errMessage(err),
    });
    throw err;
  }

  const parsed = safeParseJson(raw);

  const mealName = parsed.mealName ? String(parsed.mealName) : "Meal";
  const calories = Number(parsed.calories) || 0;
  const protein = Number(parsed.protein) || 0;
  const carbs = Number(parsed.carbs) || 0;
  const fat = Number(parsed.fat) || 0;

  const explanation = normalizeExplanation(parsed.explanation);
  const swaps = normalizeSwaps(parsed.swaps);
  const reasoningConfidence = clamp(Number(parsed.reasoningConfidence) || 0, 0, 100);

  const confidence = computeBlendedConfidence({
    visionClarity: vision.clarity,
    reasoningConfidence,
    foodsCount: vision.foods.length,
  });

  const result: PhotoAIResult = {
    mealName,
    calories,
    protein,
    carbs,
    fat,
    explanation,
    swaps,
    foods: vision.foods,
    visionClarity: vision.clarity,
    reasoningConfidence,
    confidence,
  };

  console.log("[nutrition][photo][macro]", {
    reqId,
    model: MACRO_MODEL,
    ms: nowMs() - t0,
    confidence: result.confidence,
    visionClarity: result.visionClarity,
    reasoningConfidence: result.reasoningConfidence,
    calories: result.calories,
    p: result.protein,
    c: result.carbs,
    f: result.fat,
    swapsCount: result.swaps.length,
    hasExplanation: !!result.explanation,
  });

  return result;
}

/* ======================================================================
   POST /api/v1/nutrition/meal
   ====================================================================== */

nutritionRouter.post("/meal", (req: Request, res: Response) => {
  const reqId = uuidv4();
  try {
    const body = req.body as any;

    const items: NutritionItem[] = Array.isArray(body.items)
      ? body.items
      : [
          {
            name: body.name,
            calories: body.calories,
            protein: body.protein,
            carbs: body.carbs,
            fat: body.fat,
          },
        ];

    if (!items[0]?.name || !Number.isFinite(Number(items[0].calories))) {
      return res.status(400).json({ ok: false, error: "Invalid meal data" });
    }

    const meal: Omit<Meal, "userId"> = {
      id: uuidv4(),
      datetime: body.datetime || new Date().toISOString(),
      label: body.label,
      items: items.map((i: any) => ({
        name: String(i.name),
        calories: Number(i.calories),
        protein: Number(i.protein || 0),
        carbs: Number(i.carbs || 0),
        fat: Number(i.fat || 0),
      })),
    };

    addMealForUser(memoryStore.userId, meal);

    console.log("[nutrition][meal] logged", {
      reqId,
      label: meal.label,
      calories: meal.items?.[0]?.calories,
    });

    res.status(201).json({ ok: true, meal });
  } catch (err: any) {
    console.error("[nutrition][meal] error", { reqId, msg: errMessage(err) });
    res.status(500).json({ ok: false, error: err.message });
  }
});

/* ======================================================================
   POST /api/v1/nutrition/ai/meal-from-text
   - unchanged, but if your estimateMealFromText already returns swaps/explanation,
     it will pass through as-is.
   ====================================================================== */

nutritionRouter.post("/ai/meal-from-text", async (req, res) => {
  const reqId = uuidv4();
  try {
    const { text } = req.body || {};
    if (!text) {
      return res.status(400).json({ ok: false, error: "Missing text" });
    }

    const estimate = await estimateMealFromText(text);

    console.log("[nutrition][ai][text] ok", { reqId });

    res.json({ ok: true, ...estimate });
  } catch (err: any) {
    console.error("[nutrition][ai][text] error", {
      reqId,
      msg: errMessage(err),
    });
    res.status(500).json({ ok: false, error: err.message });
  }
});

/* ======================================================================
   POST /api/v1/nutrition/ai/meal-from-photo
   - Restores swaps + explanation
   - Rebalanced confidence (vision + reasoningConfidence)
   - Auto-log with confidence guard
   ====================================================================== */

nutritionRouter.post(
  "/ai/meal-from-photo",
  upload.single("photo"),
  async (req: Request, res: Response) => {
    const reqId = uuidv4();
    const t0 = nowMs();

    try {
      if (!req.file?.buffer) {
        return res.status(400).json({ ok: false, error: "Missing photo" });
      }

      const estimate = await estimateMealFromImage(req.file.buffer, reqId);

      const autoLogged = estimate.confidence >= PHOTO_CONFIDENCE_AUTOLOG_MIN;

      if (autoLogged) {
        const meal: Omit<Meal, "userId"> = {
          id: uuidv4(),
          datetime: new Date().toISOString(),
          label: req.body?.label || undefined,
          items: [
            {
              name: estimate.mealName,
              calories: estimate.calories,
              protein: estimate.protein,
              carbs: estimate.carbs,
              fat: estimate.fat,
            },
          ],
        };

        addMealForUser(memoryStore.userId, meal);
      }

      console.log("[nutrition][ai][photo] ok", {
        reqId,
        ms: nowMs() - t0,
        autoLogged,
        confidence: estimate.confidence,
        visionClarity: estimate.visionClarity,
        reasoningConfidence: estimate.reasoningConfidence,
        visionModel: VISION_MODEL,
        macroModel: MACRO_MODEL,
      });

      return res.json({
        ok: true,
        autoLogged,

        // ✅ UI expects these
        mealName: estimate.mealName,
        calories: estimate.calories,
        protein: estimate.protein,
        carbs: estimate.carbs,
        fat: estimate.fat,
        confidence: estimate.confidence,
        foods: estimate.foods,
        swaps: estimate.swaps,
        explanation: estimate.explanation,

        // ✅ optional extra diagnostics (safe for UI; remove if you want)
        visionClarity: estimate.visionClarity,
        reasoningConfidence: estimate.reasoningConfidence,
      });
    } catch (err: any) {
      const msg = errMessage(err);

      console.error("[nutrition][ai][photo] error", {
        reqId,
        ms: nowMs() - t0,
        status: errStatus(err),
        msg,
      });

      // ✅ Graceful UX fallback for parse problems
      if (
        msg.includes("Model returned non-JSON output") ||
        msg.includes("Vision model returned non-JSON output") ||
        msg.toLowerCase().includes("non-json")
      ) {
        return res.status(200).json({
          ok: false,
          fallback: true,
          error:
            "We couldn’t confidently read this photo. Try a clearer photo (good lighting, closer crop) or use Ask AI (text).",
        });
      }

      return res.status(500).json({
        ok: false,
        error: msg || "Failed to analyze photo",
      });
    }
  }
);
