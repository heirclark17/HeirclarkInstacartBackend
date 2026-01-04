// Optimized photo meal logging handler
// This file contains the fast single-call photo analysis

import { Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import sharp from "sharp";
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const VISION_MODEL = process.env.OPENAI_VISION_MODEL || "gpt-4.1-mini";

function nowMs() {
  return Date.now();
}

function errMessage(e: any) {
  return e?.message || String(e);
}

function n0(v: any) {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

function int0(v: any) {
  return Math.max(0, Math.round(n0(v)));
}

function clamp(v: any, min: number, max: number) {
  const x = n0(v);
  if (!Number.isFinite(x)) return min;
  return Math.max(min, Math.min(max, x));
}

function safeParseJson(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {}
    }
    return {};
  }
}

function normalizeFoods(input: any): Array<{
  name: string;
  portion?: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  notes?: string;
}> {
  const arr = Array.isArray(input) ? input : [];
  return arr
    .map((x) => {
      if (typeof x === "string") {
        return { name: x, calories: 0, protein: 0, carbs: 0, fat: 0 };
      }
      const name = String(x?.name || x?.food || x?.item || "").trim();
      if (!name) return null;
      return {
        name,
        portion: x?.portion ? String(x.portion) : undefined,
        calories: int0(x?.macros?.calories ?? x?.calories),
        protein: int0(x?.macros?.protein ?? x?.protein),
        carbs: int0(x?.macros?.carbs ?? x?.carbs),
        fat: int0(x?.macros?.fat ?? x?.fat),
        notes: x?.notes ? String(x.notes) : undefined,
      };
    })
    .filter(Boolean) as any;
}

function normalizeSwaps(input: any): Array<{
  swap: string;
  why: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}> {
  const arr = Array.isArray(input) ? input : [];
  return arr
    .map((x) => {
      if (typeof x === "string") {
        const s = x.trim();
        if (!s) return null;
        return { swap: s, why: "", calories: 0, protein: 0, carbs: 0, fat: 0 };
      }
      const swap = String(x?.swap || x?.text || x?.recommendation || "").trim();
      if (!swap) return null;
      return {
        swap,
        why: String(x?.why || x?.reason || x?.explanation || "").trim(),
        calories: int0(x?.macros?.calories ?? x?.calories),
        protein: int0(x?.macros?.protein ?? x?.protein),
        carbs: int0(x?.macros?.carbs ?? x?.carbs),
        fat: int0(x?.macros?.fat ?? x?.fat),
      };
    })
    .filter(Boolean) as any;
}

function getShopifyCustomerId(req: Request): string {
  const q = (req.query?.shopifyCustomerId as string) || "";
  const b = (req.body as any)?.shopifyCustomerId || "";
  const h = String(req.headers["x-shopify-customer-id"] || "");
  return String(q || b || h || "").trim();
}

function getUploadedPhotoFile(req: Request): Express.Multer.File | null {
  const filesAny = (req as any).files as Record<string, Express.Multer.File[]> | undefined;
  const img = filesAny?.image?.[0];
  const pho = filesAny?.photo?.[0];
  return img || pho || null;
}

function aiResponse(normalized: any) {
  const conf100 = normalized?.confidence == null ? null : Number(normalized.confidence);
  const conf01 = conf100 == null || Number.isNaN(conf100) ? null : Math.max(0, Math.min(1, conf100 / 100));
  const mealName = String(normalized?.mealName || normalized?.name || normalized?.title || "Meal");
  const foods = normalizeFoods(normalized?.foods);
  const healthierSwaps = normalizeSwaps(normalized?.healthierSwaps ?? normalized?.swaps);

  return {
    ok: true,
    calories: int0(normalized?.calories),
    protein: int0(normalized?.protein),
    carbs: int0(normalized?.carbs),
    fat: int0(normalized?.fat),
    mealName,
    name: mealName,
    label: String(normalized?.label || "Meal"),
    foods,
    healthierSwaps,
    swaps: healthierSwaps,
    confidence: conf01,
    explanation: String(normalized?.explanation || ""),
    portionNotes: String(normalized?.portionNotes || ""),
    normalized,
    macros: {
      calories: int0(normalized?.calories),
      protein: int0(normalized?.protein),
      carbs: int0(normalized?.carbs),
      fat: int0(normalized?.fat),
    },
  };
}

/**
 * OPTIMIZED: Single-call photo analysis (2x faster than two-call approach)
 * Combines vision + macro estimation into one GPT-4 Vision call
 */
export async function handlePhotoFast(req: Request, res: Response) {
  const reqId = uuidv4();
  const t0 = nowMs();

  try {
    const cid = getShopifyCustomerId(req);
    if (!cid) {
      return res.status(400).json({ ok: false, error: "Missing shopifyCustomerId" });
    }

    const file = getUploadedPhotoFile(req);
    if (!file?.buffer) {
      return res.status(400).json({
        ok: false,
        error: "Missing image upload (send multipart with field name 'image' or 'photo')",
      });
    }

    // Optimized image processing: smaller for speed, still good quality
    const processed = await sharp(file.buffer)
      .rotate()
      .resize({ width: 768, withoutEnlargement: true })
      .jpeg({ quality: 75 })
      .toBuffer();

    // SINGLE COMBINED PROMPT - identifies foods AND estimates macros in one call
    const combinedPrompt = [
      "Analyze this meal photo. Identify all foods, estimate portions, and calculate macros.",
      "",
      "PORTION REFERENCE:",
      "- Dinner plate = 10-11 inches, Salad plate = 7-8 inches",
      "- Palm = ~3 oz protein, Fist = ~1 cup, Thumb = ~1 tbsp oil/fat",
      "",
      "Return ONLY valid JSON:",
      "{",
      '  "mealName": "descriptive meal name",',
      '  "calories": number, "protein": number, "carbs": number, "fat": number,',
      '  "foods": [{ "name": "food", "portion": "amount", "macros": { "calories": n, "protein": n, "carbs": n, "fat": n } }],',
      '  "healthierSwaps": [{ "swap": "suggestion", "why": "brief reason", "macros": { "calories": n, "protein": n, "carbs": n, "fat": n } }],',
      '  "confidence": 0-100,',
      '  "portionNotes": "brief portion analysis"',
      "}",
      "",
      "RULES: Account for cooking oils, sauces, hidden fats. foods[].macros should sum to totals.",
    ].join("\n");

    const completion = await openai.chat.completions.create({
      model: VISION_MODEL,
      temperature: 0.2,
      max_tokens: 1000,
      messages: [
        {
          role: "user",
          // @ts-ignore
          content: [
            { type: "text", text: combinedPrompt },
            {
              type: "image_url",
              image_url: {
                url: `data:image/jpeg;base64,${processed.toString("base64")}`,
                detail: "low", // Use low detail for faster processing
              },
            },
          ],
        },
      ],
    });

    const raw = completion.choices?.[0]?.message?.content || "{}";
    const parsed = safeParseJson(raw);

    const foods = normalizeFoods(parsed.foods);
    const swaps = normalizeSwaps(parsed.healthierSwaps ?? parsed.swaps);

    const calories = int0(parsed.calories);
    const protein = int0(parsed.protein);
    const carbs = int0(parsed.carbs);
    const fat = int0(parsed.fat);
    const confidence = clamp(parsed.confidence, 0, 100);
    const portionNotes = String(parsed.portionNotes || "");

    const ranges = confidence < 70 ? {
      calories: { min: Math.round(calories * 0.8), max: Math.round(calories * 1.2) },
      protein: { min: Math.round(protein * 0.85), max: Math.round(protein * 1.15) },
      carbs: { min: Math.round(carbs * 0.8), max: Math.round(carbs * 1.2) },
      fat: { min: Math.round(fat * 0.75), max: Math.round(fat * 1.25) },
    } : null;

    const normalized = {
      label: String((req.body as any)?.label || "Meal"),
      mealName: String(parsed.mealName || parsed.name || "Meal"),
      name: String(parsed.mealName || parsed.name || "Meal"),
      calories,
      protein,
      carbs,
      fat,
      foods: foods.length ? foods : [{ name: "Meal", calories, protein, carbs, fat }],
      portionNotes,
      healthierSwaps: swaps,
      explanation: "",
      confidence,
      ranges,
      meta: { source: "ai_photo_fast", autoLogged: false },
    };

    const ms = nowMs() - t0;
    console.log("[nutrition][ai-photo-fast] ok", {
      reqId,
      ms,
      cid,
      model: VISION_MODEL,
      confidence,
      foodCount: foods.length,
    });

    return res.json({
      ...aiResponse(normalized),
      ranges,
      rag_enabled: false,
      processingMs: ms,
    });
  } catch (err: any) {
    console.error("[nutrition][ai-photo-fast] error", { reqId, msg: errMessage(err) });
    return res.status(500).json({ ok: false, error: err.message });
  }
}
