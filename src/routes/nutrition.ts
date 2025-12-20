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

function getShopifyCustomerId(req: Request) {
  const fromQuery = req.query.shopifyCustomerId;
  const fromBody = (req.body as any)?.shopifyCustomerId;
  const cid = String(fromQuery ?? fromBody ?? "").trim();
  return cid || null;
}

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
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error("Model returned non-JSON output");
  }
}

/** Returns YYYY-MM-DD for local UTC-based bucket */
function isoDateKey(d: Date) {
  return d.toISOString().slice(0, 10);
}

/** Safely read meals array for a given user, regardless of your store shape */
function getMealsArrayForUser(cid: string): any[] {
  const ms: any = memoryStore as any;

  // Preferred: mealsByUser[cid] = Meal[]
  if (ms?.mealsByUser && Array.isArray(ms.mealsByUser[cid])) {
    return ms.mealsByUser[cid];
  }

  // Fallback: mealsByUser is a Map
  if (ms?.mealsByUser instanceof Map) {
    const v = ms.mealsByUser.get(cid);
    return Array.isArray(v) ? v : [];
  }

  // Fallback: single list (not ideal but prevents crash)
  if (Array.isArray(ms?.meals)) return ms.meals;

  return [];
}

/** Safely read targets for a given user, regardless of your store shape */
function getTargetsForUser(cid: string) {
  const ms: any = memoryStore as any;

  if (ms?.targetsByUser && ms.targetsByUser[cid]) return ms.targetsByUser[cid];
  if (ms?.targetsByUser instanceof Map) return ms.targetsByUser.get(cid);

  return { calories: 0, protein: 0, carbs: 0, fat: 0 };
}

/** Sum totals for a list of meals */
function computeTotalsFromMeals(meals: any[]) {
  return meals.reduce(
    (acc: any, meal: any) => {
      const items = Array.isArray(meal.items) ? meal.items : [];
      for (const it of items) {
        acc.calories += Number(it.calories || 0);
        acc.protein += Number(it.protein || 0);
        acc.carbs += Number(it.carbs || 0);
        acc.fat += Number(it.fat || 0);
      }
      return acc;
    },
    { calories: 0, protein: 0, carbs: 0, fat: 0 }
  );
}

/* ======================================================================
   STEP 1: Vision — Describe image (Vision model)
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
      portionNotes: parsed.portionNotes
        ? String(parsed.portionNotes)
        : "unknown portions",
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
   STEP 2: Reasoning — Estimate macros + swaps + explanation
   ====================================================================== */

type PhotoAIResult = {
  mealName: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;

  explanation: string;
  swaps: string[];

  foods: string[];
  visionClarity: number;
  reasoningConfidence: number;

  confidence: number;
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
  return s.length > 600 ? s.slice(0, 600) + "…" : s;
}

function computeBlendedConfidence(args: {
  visionClarity: number;
  reasoningConfidence: number;
  foodsCount: number;
}) {
  const v = clamp(args.visionClarity, 0, 100);
  const r = clamp(args.reasoningConfidence, 0, 100);

  let blended = Math.round(0.55 * v + 0.45 * r);
  if (args.foodsCount > 0) blended += 6;
  if (args.foodsCount === 0) blended -= 12;

  if (v >= 75 && r >= 70) blended = Math.max(blended, 72);
  if (v >= 85 && r >= 80) blended = Math.max(blended, 80);

  return clamp(blended, 0, 100);
}

async function estimateMealFromImage(
  imageBuffer: Buffer,
  reqId: string
): Promise<PhotoAIResult> {
  const t0 = nowMs();

  const vision = await describeMealImage(imageBuffer, reqId);

  const descriptionText = `
Foods identified:
${vision.foods.length ? vision.foods.map((f) => `- ${f}`).join("\n") : "- (none confidently identified)"}

Portion notes:
${vision.portionNotes}

Photo clarity (0-100):
${vision.clarity}
`.trim();

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
- swaps: 2–5 healthier swaps OR improvements (simple, actionable)
- reasoningConfidence: 0–100

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
   - NOW SAVES PER shopifyCustomerId
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

    const cid = getShopifyCustomerId(req);
    if (!cid)
      return res
        .status(400)
        .json({ ok: false, error: "Missing shopifyCustomerId" });

    addMealForUser(cid, meal);

    console.log("[nutrition][meal] logged", {
      reqId,
      cid,
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
   GET /api/v1/nutrition/day-summary
   - USED BY TODAY SUMMARY RINGS/MACROS + RECENT MEALS UI
   ====================================================================== */

nutritionRouter.get("/day-summary", (req: Request, res: Response) => {
  const reqId = uuidv4();
  try {
    const cid = getShopifyCustomerId(req);
    if (!cid) {
      return res
        .status(400)
        .json({ ok: false, error: "Missing shopifyCustomerId" });
    }

    const meals = getMealsArrayForUser(cid);
    const todayKey = isoDateKey(new Date());

    const todaysMeals = meals.filter(
      (m: any) => String(m.datetime || "").slice(0, 10) === todayKey
    );

    const totals = computeTotalsFromMeals(todaysMeals);
    const targets = getTargetsForUser(cid);

    return res.json({
      ok: true,
      totals,
      targets,
      recentMeals: todaysMeals.slice(-8).reverse(),
    });
  } catch (err: any) {
    console.error("[nutrition][day-summary] error", { reqId, msg: errMessage(err) });
    return res.status(500).json({ ok: false, error: err.message });
  }
});

/* ======================================================================
   GET /api/v1/nutrition/history
   - USED BY DAILY HISTORY + TRENDS UI
   - RETURNS: { ok:true, days:[{date, totals}] }
   ====================================================================== */

nutritionRouter.get("/history", (req: Request, res: Response) => {
  const reqId = uuidv4();
  try {
    const cid = getShopifyCustomerId(req);
    if (!cid) {
      return res
        .status(400)
        .json({ ok: false, error: "Missing shopifyCustomerId" });
    }

    const daysParam = Number(req.query.days || 7);
    const days = Number.isFinite(daysParam)
      ? Math.max(1, Math.min(60, daysParam))
      : 7;

    const meals = getMealsArrayForUser(cid);

    const out: Array<{ date: string; totals: any }> = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = isoDateKey(d);

      const dayMeals = meals.filter(
        (m: any) => String(m.datetime || "").slice(0, 10) === key
      );

      out.push({
        date: key,
        totals: computeTotalsFromMeals(dayMeals),
      });
    }

    return res.json({ ok: true, days: out });
  } catch (err: any) {
    console.error("[nutrition][history] error", { reqId, msg: errMessage(err) });
    return res.status(500).json({ ok: false, error: err.message });
  }
});

/* ======================================================================
   POST /api/v1/nutrition/ai/meal-from-text
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
   - NOW AUTO-LOGS PER shopifyCustomerId (NOT memoryStore.userId)
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

      // ✅ Require customer id so autolog + UI stay consistent
      const cid = getShopifyCustomerId(req);
      if (!cid) {
        return res
          .status(400)
          .json({ ok: false, error: "Missing shopifyCustomerId" });
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

        // ✅ FIX: store under the user’s Shopify customer id
        addMealForUser(cid, meal);
      }

      console.log("[nutrition][ai][photo] ok", {
        reqId,
        ms: nowMs() - t0,
        cid,
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

        mealName: estimate.mealName,
        calories: estimate.calories,
        protein: estimate.protein,
        carbs: estimate.carbs,
        fat: estimate.fat,
        confidence: estimate.confidence,
        foods: estimate.foods,
        swaps: estimate.swaps,
        explanation: estimate.explanation,

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
