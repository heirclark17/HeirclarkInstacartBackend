import { Router, Request, Response } from "express";
import multer from "multer";
import sharp from "sharp";
import OpenAI from "openai";
import { v4 as uuidv4 } from "uuid";

import { todayDateOnly } from "../utils/date";
import {
  computeDailyTotals,
  computeRemaining,
  getMealsForDate,
  getStaticDailyTargets,
  memoryStore,
  addMealForUser,
  Meal,
  NutritionItem,
} from "../utils/services/nutritionService";
import { computeStreak } from "../services/streakService";
import { estimateMealFromText } from "../services/aiNutritionService";

/* ======================================================================
   Setup
   ====================================================================== */

export const nutritionRouter = Router();

const upload = multer({ storage: multer.memoryStorage() });

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

console.log("[nutrition] routes loaded:", {
  build: process.env.RAILWAY_GIT_COMMIT_SHA || "unknown",
});

/* ======================================================================
   Helper: Estimate meal from image (USING EXISTING MODEL)
   Model: gpt-4.1-mini
   ====================================================================== */

async function estimateMealFromImage(
  imageBuffer: Buffer,
  localTimeIso?: string
): Promise<{
  mealName: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  confidence: number;
  foods: string[];
}> {
  // 🔻 Compress image for speed + cost control
  const compressed = await sharp(imageBuffer)
    .resize({ width: 768, withoutEnlargement: true })
    .jpeg({ quality: 72 })
    .toBuffer();

  const base64Image = compressed.toString("base64");

  const prompt = `
You are a nutrition expert.

The user uploaded a meal photo.
You are given a BASE64-ENCODED JPEG IMAGE of the meal.

Analyze the meal and estimate calories and macros.

Return STRICT JSON ONLY in this exact shape:
{
  "mealName": string,
  "calories": number,
  "protein": number,
  "carbs": number,
  "fat": number,
  "foods": string[],
  "confidence": number
}

Rules:
- Confidence is 0–100 based on image clarity and portion certainty
- Be conservative if portions are unclear
- Assume standard restaurant portions unless clearly homemade
- No markdown, no commentary, JSON only

BASE64_IMAGE:
${base64Image}
`;

  const response = await openai.chat.completions.create({
    model: "gpt-4.1-mini",
    temperature: 0.2,
    messages: [
      {
        role: "user",
        content: prompt,
      },
    ],
  });

  const raw = response.choices[0]?.message?.content || "{}";

  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Failed to parse AI image response");
  }

  return {
    mealName: parsed.mealName || "Meal",
    calories: Number(parsed.calories) || 0,
    protein: Number(parsed.protein) || 0,
    carbs: Number(parsed.carbs) || 0,
    fat: Number(parsed.fat) || 0,
    foods: Array.isArray(parsed.foods) ? parsed.foods : [],
    confidence: Math.max(0, Math.min(100, Number(parsed.confidence) || 0)),
  };
}

/* ======================================================================
   POST /api/v1/nutrition/meal
   Logs a confirmed meal (manual or AI-confirmed)
   ====================================================================== */

nutritionRouter.post("/meal", (req: Request, res: Response) => {
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

    res.status(201).json({ ok: true, meal });
  } catch (err: any) {
    console.error("POST /meal failed", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/* ======================================================================
   POST /api/v1/nutrition/ai/meal-from-text
   ====================================================================== */

nutritionRouter.post("/ai/meal-from-text", async (req, res) => {
  try {
    const { text, localTimeIso } = req.body || {};
    if (!text) {
      return res.status(400).json({ ok: false, error: "Missing text" });
    }

    const estimate = await estimateMealFromText(text, localTimeIso);

    res.json({
      ok: true,
      ...estimate,
    });
  } catch (err: any) {
    console.error("AI text error", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/* ======================================================================
   POST /api/v1/nutrition/ai/meal-from-photo
   - Compresses image
   - Runs AI
   - AUTO-LOGS meal
   ====================================================================== */

nutritionRouter.post(
  "/ai/meal-from-photo",
  upload.single("photo"),
  async (req: Request, res: Response) => {
    try {
      if (!req.file?.buffer) {
        return res.status(400).json({ ok: false, error: "Missing photo" });
      }

      const estimate = await estimateMealFromImage(
        req.file.buffer,
        req.body?.localTimeIso
      );

      // ✅ Auto-log immediately
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

      return res.json({
        ok: true,
        autoLogged: true,
        ...estimate,
      });
    } catch (err: any) {
      console.error("AI photo error", err);
      return res.status(500).json({
        ok: false,
        error: err.message || "Failed to analyze photo",
      });
    }
  }
);

/* ======================================================================
   History, Day Summary, Reset Day
   (UNCHANGED — keep your existing implementations below)
   ====================================================================== */

// ⬇️ KEEP YOUR EXISTING history, summary, streak, reset routes here ⬇️
