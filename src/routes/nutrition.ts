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

console.log("[nutrition] routes loaded (hybrid vision gate enabled)", {
  build: process.env.RAILWAY_GIT_COMMIT_SHA || "unknown",
});

/* ======================================================================
   STEP 1: Vision — Describe image (GPT-4o Vision)
   ====================================================================== */

async function describeMealImage(
  imageBuffer: Buffer
): Promise<{
  foods: string[];
  portionNotes: string;
  clarity: number;
}> {
  const compressed = await sharp(imageBuffer)
    .resize({ width: 768, withoutEnlargement: true })
    .jpeg({ quality: 72 })
    .toBuffer();

  const base64Image = compressed.toString("base64");

  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    temperature: 0.1,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `
Describe the food visible in this photo.

Return STRICT JSON ONLY:
{
  "foods": string[],           // list each visible food item
  "portionNotes": string,      // portion sizes (small/medium/large)
  "clarity": number            // 0–100 image clarity & certainty
}

Rules:
- Be honest if unclear
- Do not guess ingredients you cannot see
- No commentary, JSON only
`,
          },
          {
            type: "image_url",
            image_url: {
              url: `data:image/jpeg;base64,${base64Image}`,
            },
          },
        ],
      },
    ],
  });

  const raw = response.choices[0]?.message?.content || "{}";

  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Failed to parse vision response");
  }

  return {
    foods: Array.isArray(parsed.foods) ? parsed.foods : [],
    portionNotes: parsed.portionNotes || "unknown portions",
    clarity: Math.max(0, Math.min(100, Number(parsed.clarity) || 0)),
  };
}

/* ======================================================================
   STEP 2: Reasoning — Estimate macros (gpt-4.1-mini)
   ====================================================================== */

async function estimateMealFromImage(
  imageBuffer: Buffer
): Promise<{
  mealName: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  foods: string[];
  confidence: number;
}> {
  // ---- Vision gate ----
  const vision = await describeMealImage(imageBuffer);

  const descriptionText = `
Foods identified:
${vision.foods.map((f) => `- ${f}`).join("\n")}

Portion notes:
${vision.portionNotes}

Estimate calories and macros.
`;

  // ---- Existing model does reasoning ----
  const response = await openai.chat.completions.create({
    model: "gpt-4.1-mini",
    temperature: 0.2,
    messages: [
      {
        role: "user",
        content: `
You are a nutrition expert.

Based on the foods and portions below, estimate nutrition.

Return STRICT JSON ONLY:
{
  "mealName": string,
  "calories": number,
  "protein": number,
  "carbs": number,
  "fat": number
}

Be conservative if uncertain.

${descriptionText}
`,
      },
    ],
  });

  const raw = response.choices[0]?.message?.content || "{}";

  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Failed to parse macro estimate");
  }

  // Confidence blends vision clarity + food certainty
  const confidence = Math.round(
    Math.min(
      100,
      vision.clarity * (vision.foods.length > 0 ? 1 : 0.6)
    )
  );

  return {
    mealName: parsed.mealName || "Meal",
    calories: Number(parsed.calories) || 0,
    protein: Number(parsed.protein) || 0,
    carbs: Number(parsed.carbs) || 0,
    fat: Number(parsed.fat) || 0,
    foods: vision.foods,
    confidence,
  };
}

/* ======================================================================
   POST /api/v1/nutrition/meal
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
    const { text } = req.body || {};
    if (!text) {
      return res.status(400).json({ ok: false, error: "Missing text" });
    }

    const estimate = await estimateMealFromText(text);
    res.json({ ok: true, ...estimate });
  } catch (err: any) {
    console.error("AI text error", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/* ======================================================================
   POST /api/v1/nutrition/ai/meal-from-photo
   - Hybrid vision gate
   - Auto-log with confidence guard
   ====================================================================== */

nutritionRouter.post(
  "/ai/meal-from-photo",
  upload.single("photo"),
  async (req: Request, res: Response) => {
    try {
      if (!req.file?.buffer) {
        return res.status(400).json({ ok: false, error: "Missing photo" });
      }

      const estimate = await estimateMealFromImage(req.file.buffer);

      const autoLogged = estimate.confidence >= 60;

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

      return res.json({
        ok: true,
        autoLogged,
        ...estimate,
      });
    } catch (err: any) {
      console.error("AI photo error", err);
      res.status(500).json({
        ok: false,
        error: err.message || "Failed to analyze photo",
      });
    }
  }
);
