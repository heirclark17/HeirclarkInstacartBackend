import { Router, Request, Response } from "express";
import multer from "multer";
import sharp from "sharp";
import OpenAI from "openai";
import { v4 as uuidv4 } from "uuid";

const nutritionRouter = Router();
export default nutritionRouter;

// -----------------------------------------------------------------------------
// Minimal in-memory store (replace with DB later if needed)
// -----------------------------------------------------------------------------
type StoredMeal = {
  id: string;
  shopifyCustomerId: string;
  date: string; // YYYY-MM-DD
  label: string;
  mealName: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;

  confidence?: number;
  swaps?: string[];
  foods?: string[];
  explanation?: string;
  portionNotes?: string;

  meta?: any;
  createdAt: string;
};

const memoryStore: {
  mealsByUser: Record<string, StoredMeal[]>;
} = {
  mealsByUser: {},
};

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------
function nowMs() {
  return Date.now();
}

function errMessage(err: any) {
  return err?.message || String(err);
}

function toYYYYMMDD(d: Date) {
  return d.toISOString().slice(0, 10);
}

function clamp(n: number, a: number, b: number) {
  if (!Number.isFinite(n)) return a;
  return Math.min(b, Math.max(a, n));
}

function getShopifyCustomerId(req: Request) {
  const fromQuery = (req.query.shopifyCustomerId as string) || "";
  const fromBody = (req.body && (req.body.shopifyCustomerId as string)) || "";
  const cid = String(fromQuery || fromBody || "").trim();
  return cid;
}

function safeParseJson(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    const match = String(text || "").match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    return {};
  }
}

function coerceNumber(x: any, fallback = 0) {
  const n = Number(x);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeStringArray(x: any): string[] {
  if (!Array.isArray(x)) return [];
  return x.map((v) => String(v)).map((s) => s.trim()).filter(Boolean);
}

/**
 * ✅ FULL NORMALIZATION FOR PHOTO AI RESPONSE
 * Ensures frontend ALWAYS gets:
 * - mealName, calories, protein, carbs, fat
 * - confidence (0-100)
 * - swaps: string[]
 * - foods: string[] (names only)
 * - explanation: string
 */
function normalizePhotoAiParsed(parsed: any) {
  const mealName = typeof parsed?.mealName === "string" ? parsed.mealName : "Meal";

  const calories = Math.max(0, Math.round(coerceNumber(parsed?.calories, 0)));
  const protein = Math.max(0, Math.round(coerceNumber(parsed?.protein, 0)));
  const carbs = Math.max(0, Math.round(coerceNumber(parsed?.carbs, 0)));

  // Prompt uses fats, sometimes fat
  const fatRaw = parsed?.fats ?? parsed?.fat ?? 0;
  const fat = Math.max(0, Math.round(coerceNumber(fatRaw, 0)));

  const confidence = clamp(Math.round(coerceNumber(parsed?.confidence, 0)), 0, 100);

  // foods can be: [{name, ...}] or ["name", ...]
  const foodsIn = parsed?.foods;
  let foods: string[] = [];
  if (Array.isArray(foodsIn)) {
    foods = foodsIn
      .map((f: any) => {
        if (typeof f === "string") return f;
        if (f && typeof f === "object") {
          const n = f.name ?? f.food ?? f.item;
          return n ? String(n) : "";
        }
        return "";
      })
      .map((s) => s.trim())
      .filter(Boolean);
  }

  const swaps = normalizeStringArray(parsed?.swaps);
  const explanation = typeof parsed?.explanation === "string" ? parsed.explanation : "";

  return {
    mealName,
    calories,
    protein,
    carbs,
    fat,
    confidence,
    foods,
    swaps,
    explanation,
    meta: { source: "ai_photo", autoLogged: false },
  };
}

// -----------------------------------------------------------------------------
// OpenAI setup
// -----------------------------------------------------------------------------
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const VISION_MODEL = process.env.OPENAI_VISION_MODEL || "gpt-4o-mini";
const MACRO_MODEL = process.env.OPENAI_MACRO_MODEL || "gpt-4.1-mini";

// -----------------------------------------------------------------------------
// Multer upload
// -----------------------------------------------------------------------------
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 7 * 1024 * 1024 }, // 7MB
});

// -----------------------------------------------------------------------------
// AI: meal-from-text (keeps your behavior)
// -----------------------------------------------------------------------------
nutritionRouter.post("/ai/meal-from-text", async (req, res) => {
  const reqId = uuidv4();
  try {
    const cid = getShopifyCustomerId(req);
    if (!cid) return res.status(400).json({ ok: false, error: "Missing shopifyCustomerId" });

    const { text } = req.body || {};
    if (!text) return res.status(400).json({ ok: false, error: "Missing text" });

    const prompt = [
      "You are a nutrition estimator.",
      "Return ONLY valid JSON with: mealName, calories, protein, carbs, fat.",
      "User meal description:",
      String(text),
    ].join("\n");

    const r = await openai.chat.completions.create({
      model: MACRO_MODEL,
      temperature: 0.2,
      messages: [{ role: "user", content: prompt }],
    });

    const raw = r.choices?.[0]?.message?.content || "{}";
    const parsed = safeParseJson(raw);

    const normalized = {
      mealName: String(parsed.mealName || parsed.name || "Meal"),
      calories: Math.max(0, Math.round(coerceNumber(parsed.calories, 0))),
      protein: Math.max(0, Math.round(coerceNumber(parsed.protein, 0))),
      carbs: Math.max(0, Math.round(coerceNumber(parsed.carbs, 0))),
      fat: Math.max(0, Math.round(coerceNumber(parsed.fat ?? parsed.fats, 0))),
      meta: { source: "ai_text", autoLogged: false },
    };

    return res.json({ ok: true, normalized });
  } catch (err: any) {
    console.error("[nutrition][ai-text] error", { reqId, msg: errMessage(err) });
    return res.status(500).json({ ok: false, error: errMessage(err) });
  }
});

// -----------------------------------------------------------------------------
// AI: meal-from-photo
// ✅ NEVER AUTO-LOGS
// ✅ Accepts multipart field "image" OR "photo"
// ✅ FULL NORMALIZATION (confidence/swaps/foods always present)
// -----------------------------------------------------------------------------
nutritionRouter.post("/ai/meal-from-photo", (req: Request, res: Response) => {
  const tryImage = upload.single("image");
  const tryPhoto = upload.single("photo");

  tryImage(req as any, res as any, (err1: any) => {
    if (!err1 && (req as any).file?.buffer) {
      return handlePhoto(req, res);
    }

    tryPhoto(req as any, res as any, (err2: any) => {
      if (err2) return res.status(400).json({ ok: false, error: err2.message });
      return handlePhoto(req, res);
    });
  });
});

async function handlePhoto(req: Request, res: Response) {
  const reqId = uuidv4();
  const t0 = nowMs();

  try {
    const cid = getShopifyCustomerId(req);
    if (!cid) return res.status(400).json({ ok: false, error: "Missing shopifyCustomerId" });

    const file = (req as any).file;
    if (!file?.buffer) return res.status(400).json({ ok: false, error: "Missing image/photo" });

    // preprocess image
    const processed = await sharp(file.buffer)
      .rotate()
      .resize({ width: 1024, withoutEnlargement: true })
      .jpeg({ quality: 82 })
      .toBuffer();

    const mimeType = "image/jpeg";
    const base64 = processed.toString("base64");

    const systemPrompt = `
Given a single food photo, you must:
1. Infer a short human-readable meal name.
2. Estimate total calories, protein (g), carbs (g), and fats (g) for the plate in the photo.
3. Provide a confidence score from 0–100 (where 100 means very confident).
4. Break down the plate into a list of component foods with approximate macros.
5. Suggest 1–3 realistic, healthier swaps.

Respond ONLY as valid JSON with this exact shape:

{
  "mealName": string,
  "calories": number,
  "protein": number,
  "carbs": number,
  "fats": number,
  "confidence": number,
  "foods": [
    { "name": string, "calories": number, "protein": number, "carbs": number, "fats": number }
  ],
  "swaps": string[],
  "explanation": string
}
`.trim();

    const body = {
      model: VISION_MODEL,
      response_format: { type: "json_object" as const },
      messages: [
        { role: "system" as const, content: systemPrompt },
        {
          role: "user" as const,
          content: [
            { type: "text" as const, text: "Estimate the nutrition for this meal photo." },
            {
              type: "image_url" as const,
              image_url: { url: `data:${mimeType};base64,${base64}` },
            },
          ],
        },
      ],
    };

    const openaiResp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        Accept: "application/json",
      },
      body: JSON.stringify(body),
    });

    const json = await openaiResp.json();
    if (!openaiResp.ok) {
      console.error("OpenAI error:", openaiResp.status, json);
      return res.status(500).json({
        ok: false,
        error: json?.error?.message || `OpenAI API error (status ${openaiResp.status})`,
      });
    }

    const rawContent = json?.choices?.[0]?.message?.content;
    if (typeof rawContent !== "string") {
      console.error("Unexpected OpenAI content:", rawContent);
      return res.status(500).json({
        ok: false,
        error: "Unexpected OpenAI response format",
      });
    }

    const parsed = safeParseJson(rawContent);

    // ✅ FULLY NORMALIZED RESPONSE
    const normalized = normalizePhotoAiParsed(parsed);

    const ms = nowMs() - t0;
    console.log("[nutrition][ai-photo] ok", { reqId, cid, ms });

    return res.json({ ok: true, normalized });
  } catch (err: any) {
    console.error("[nutrition][ai-photo] error", { reqId, msg: errMessage(err) });
    return res.status(500).json({ ok: false, error: errMessage(err) });
  }
}

// -----------------------------------------------------------------------------
// Meals CRUD
// -----------------------------------------------------------------------------
nutritionRouter.get("/meals", (req: Request, res: Response) => {
  const cid = getShopifyCustomerId(req);
  if (!cid) return res.status(400).json({ ok: false, error: "Missing shopifyCustomerId" });

  const meals = memoryStore.mealsByUser[cid] || [];
  // return newest first
  const sorted = [...meals].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return res.json({ ok: true, meals: sorted });
});

nutritionRouter.post("/meals", (req: Request, res: Response) => {
  const cid = getShopifyCustomerId(req);
  if (!cid) return res.status(400).json({ ok: false, error: "Missing shopifyCustomerId" });

  const b = req.body || {};
  const date = typeof b.date === "string" ? b.date : toYYYYMMDD(new Date());

  const meal: StoredMeal = {
    id: uuidv4(),
    shopifyCustomerId: cid,
    date,
    label: String(b.label || b.mealName || "Meal"),
    mealName: String(b.mealName || b.label || "Meal"),
    calories: Math.max(0, Math.round(coerceNumber(b.calories, 0))),
    protein: Math.max(0, Math.round(coerceNumber(b.protein, 0))),
    carbs: Math.max(0, Math.round(coerceNumber(b.carbs, 0))),
    fat: Math.max(0, Math.round(coerceNumber(b.fat ?? b.fats, 0))),

    confidence: b.confidence != null ? clamp(Math.round(coerceNumber(b.confidence, 0)), 0, 100) : undefined,
    swaps: Array.isArray(b.swaps) ? normalizeStringArray(b.swaps) : undefined,
    foods: Array.isArray(b.foods) ? normalizeStringArray(b.foods) : undefined,
    explanation: typeof b.explanation === "string" ? b.explanation : undefined,
    portionNotes: typeof b.portionNotes === "string" ? b.portionNotes : undefined,

    meta: b.meta || { autoLogged: false },
    createdAt: new Date().toISOString(),
  };

  memoryStore.mealsByUser[cid] = memoryStore.mealsByUser[cid] || [];
  memoryStore.mealsByUser[cid].push(meal);

  return res.json({ ok: true, meal });
});

nutritionRouter.delete("/meals/:id", (req: Request, res: Response) => {
  const cid = getShopifyCustomerId(req);
  if (!cid) return res.status(400).json({ ok: false, error: "Missing shopifyCustomerId" });

  const id = String(req.params.id || "");
  if (!id) return res.status(400).json({ ok: false, error: "Missing meal id" });

  const meals = memoryStore.mealsByUser[cid] || [];
  const before = meals.length;
  memoryStore.mealsByUser[cid] = meals.filter((m) => m.id !== id);

  return res.json({ ok: true, deleted: before !== memoryStore.mealsByUser[cid].length });
});

// -----------------------------------------------------------------------------
// Day summary (totals + basic goals stub)
// -----------------------------------------------------------------------------
nutritionRouter.get("/day-summary", (req: Request, res: Response) => {
  const cid = getShopifyCustomerId(req);
  if (!cid) return res.status(400).json({ ok: false, error: "Missing shopifyCustomerId" });

  const date = typeof req.query.date === "string" ? String(req.query.date) : toYYYYMMDD(new Date());
  const meals = memoryStore.mealsByUser[cid] || [];
  const todays = meals.filter((m) => m.date === date);

  const totals = todays.reduce(
    (acc, m) => {
      acc.calories += m.calories || 0;
      acc.protein += m.protein || 0;
      acc.carbs += m.carbs || 0;
      acc.fat += m.fat || 0;
      return acc;
    },
    { calories: 0, protein: 0, carbs: 0, fat: 0 }
  );

  // Replace with your real goal logic
  const goals = { calories: 2200, protein: 190, carbs: 190, fat: 60 };

  return res.json({ ok: true, date, totals, goals });
});

// -----------------------------------------------------------------------------
// Reset day (delete all meals for the date)
// -----------------------------------------------------------------------------
nutritionRouter.post("/reset-day", (req: Request, res: Response) => {
  const cid = getShopifyCustomerId(req);
  if (!cid) return res.status(400).json({ ok: false, error: "Missing shopifyCustomerId" });

  const date = typeof req.body?.date === "string" ? String(req.body.date) : toYYYYMMDD(new Date());
  const meals = memoryStore.mealsByUser[cid] || [];
  const kept = meals.filter((m) => m.date !== date);
  memoryStore.mealsByUser[cid] = kept;

  return res.json({ ok: true, date, removed: meals.length - kept.length });
});
