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

console.log("[nutrition] routes loaded (hybrid vision gate enabled)", {
  build: process.env.RAILWAY_GIT_COMMIT_SHA || "unknown",
  visionModel: VISION_MODEL,
  macroModel: MACRO_MODEL,
  autologMinConfidence: PHOTO_CONFIDENCE_AUTOLOG_MIN,
});

/* ======================================================================
   Small helpers
   ====================================================================== */

function nowMs() {
  return Date.now();
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
    if (match) {
      return JSON.parse(match[0]);
    }
    throw new Error("Vision model returned non-JSON output");
  }
}

/* ======================================================================
   STEP 1: Vision — Describe image (Vision model)
   - Uses response_format json_object to force JSON output
   - Uses safeParseJson fallback
   ====================================================================== */

async function describeMealImage(
  imageBuffer: Buffer,
  reqId: string
): Promise<{
  foods: string[];
  portionNotes: string;
  clarity: number;
}> {
  const t0 = nowMs();

  // 🔻 Compress image for speed + cost control
  const compressed = await sharp(imageBuffer)
    .resize({ width: 768, withoutEnlargement: true })
    .jpeg({ quality: 72 })
    .toBuffer();

  const base64Image = compressed.toString("base64");

  try {
    const response = await openai.chat.completions.create({
      model: VISION_MODEL,
      temperature: 0.1,
      // ✅ Force the model to return valid JSON
      response_format: { type: "json_object" },
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `
Describe the food visible in this photo.

Return JSON ONLY in this exact shape:
{
  "foods": string[],
  "portionNotes": string,
  "clarity": number
}

Rules:
- No markdown
- No commentary
- No extra text
- Be honest if unclear
- Do not guess hidden ingredients
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
      foods: Array.isArray(parsed.foods) ? parsed.foods : [],
      portionNotes: parsed.portionNotes || "unknown portions",
      clarity: Math.max(0, Math.min(100, Number(parsed.clarity) || 0)),
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
   STEP 2: Reasoning — Estimate macros (your existing model)
   - Forces JSON via response_format json_object
   - Uses safeParseJson fallback
   ====================================================================== */

async function estimateMealFromImage(
  imageBuffer: Buffer,
  reqId: string
): Promise<{
  mealName: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  foods: string[];
  confidence: number;
}> {
  const t0 = nowMs();

  // ---- Vision gate ----
  const vision = await describeMealImage(imageBuffer, reqId);

  const descriptionText = `
Foods identified:
${vision.foods.map((f) => `- ${f}`).join("\n")}

Portion notes:
${vision.portionNotes}
`;

  // ---- Existing model does reasoning ----
  let raw = "{}";
  try {
    const response = await openai.chat.completions.create({
      model: MACRO_MODEL,
      temperature: 0.2,
      // ✅ Force JSON from text model too
      response_format: { type: "json_object" },
      messages: [
        {
          role: "user",
          content: `
You are a nutrition expert.

Based on the foods and portions below, estimate nutrition.

Return JSON ONLY in this exact shape:
{
  "mealName": string,
  "calories": number,
  "protein": number,
  "carbs": number,
  "fat": number
}

Guidelines:
- Be conservative if uncertain
- Use realistic macro totals (avoid extremes)
- If multiple items, combine into one meal estimate

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

  // Confidence blends vision clarity + food certainty
  const confidence = Math.round(
    Math.min(100, vision.clarity * (vision.foods.length > 0 ? 1 : 0.6))
  );

  const result = {
    mealName: parsed.mealName || "Meal",
    calories: Number(parsed.calories) || 0,
    protein: Number(parsed.protein) || 0,
    carbs: Number(parsed.carbs) || 0,
    fat: Number(parsed.fat) || 0,
    foods: vision.foods,
    confidence,
  };

  console.log("[nutrition][photo][macro]", {
    reqId,
    model: MACRO_MODEL,
    ms: nowMs() - t0,
    confidence: result.confidence,
    calories: result.calories,
    p: result.protein,
    c: result.carbs,
    f: result.fat,
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
   - Hybrid vision gate
   - Auto-log with confidence guard
   - Graceful fallback on vision parse errors
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
        visionModel: VISION_MODEL,
        macroModel: MACRO_MODEL,
      });

      return res.json({
        ok: true,
        autoLogged,
        ...estimate,
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
        msg.includes("Failed to parse vision response") ||
        msg.includes("Vision model returned non-JSON output") ||
        msg.includes("Failed to parse macro estimate")
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
