import { Router, Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import multer from "multer";
import sharp from "sharp";
import OpenAI from "openai";

/** NOTE:
 * This file keeps your existing behavior:
 * - /meal logs a meal
 * - /day-summary DEDUPES meals to stop doubling
 * - /history returns day totals
 * - /day/reset clears today’s meals
 *
 * NEW REQUIREMENTS ADDED:
 * ✅ AI photo endpoint NEVER auto-logs anymore (user must Confirm & Log)
 * ✅ DELETE /meal/:id removes a meal and therefore updates macro totals
 */

const nutritionRouter = Router();
const upload = multer({ storage: multer.memoryStorage() });

/* ======================================================================
   Memory store (existing pattern)
   ====================================================================== */
const memoryStore: any = (global as any).memoryStore || ((global as any).memoryStore = {});
memoryStore.mealsByUser = memoryStore.mealsByUser || {};

/* ======================================================================
   Helpers
   ====================================================================== */
function errMessage(e: any) {
  return e?.message || String(e);
}

function clamp(n: number, a: number, b: number) {
  const x = Number(n);
  if (!Number.isFinite(x)) return a;
  return Math.max(a, Math.min(b, x));
}

function nowMs() {
  return Date.now();
}

function isoDateKey(d: Date) {
  return new Date(d).toISOString().slice(0, 10);
}

/** Pull customer id from query/body first, then header fallback */
function getShopifyCustomerId(req: Request): string {
  const q = (req.query?.shopifyCustomerId as string) || "";
  const b = (req.body as any)?.shopifyCustomerId || "";
  const h = String(req.headers["x-shopify-customer-id"] || "");
  return String(q || b || h || "").trim();
}

function getMealsArrayForUser(cid: string) {
  memoryStore.mealsByUser[cid] = memoryStore.mealsByUser[cid] || [];
  return memoryStore.mealsByUser[cid] as any[];
}

function setMealsArrayForUser(cid: string, meals: any[]) {
  memoryStore.mealsByUser[cid] = Array.isArray(meals) ? meals : [];
}

function addMealForUser(cid: string, meal: any) {
  const meals = getMealsArrayForUser(cid);
  meals.push(meal);
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

/** Dedupe meals for display/totals (prevents doubled recent meals + doubled macros) */
function dedupeMeals(meals: any[]) {
  const seen = new Set<string>();
  const out: any[] = [];

  for (const m of meals) {
    const dt = String(m?.datetime || "");
    const id = String(m?.id || "");
    const first = m?.items?.[0] || {};
    const key =
      id ||
      `${dt.slice(0, 19)}|${String(first?.name || "")}|${Number(first?.calories || 0)}|${String(
        m?.label || ""
      )}`;

    if (seen.has(key)) continue;
    seen.add(key);
    out.push(m);
  }
  return out;
}

/** Targets (keep your existing pattern; adjust if you already store targets elsewhere) */
function getTargetsForUser(_cid: string) {
  // If you already have per-user targets, return those here.
  // For now, safe defaults:
  return { calories: 2200, protein: 190, carbs: 190, fat: 60 };
}

function safeParseJson(s: string) {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}

/* ======================================================================
   OpenAI setup (existing)
   ====================================================================== */
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const VISION_MODEL = process.env.HC_VISION_MODEL || "gpt-4.1-mini";
const TEXT_MODEL = process.env.HC_TEXT_MODEL || "gpt-4.1-mini";

const PHOTO_MAX_WIDTH = Number(process.env.HC_PHOTO_MAX_WIDTH || 1024);
const PHOTO_JPEG_QUALITY = Number(process.env.HC_PHOTO_JPEG_QUALITY || 72);

/* ======================================================================
   STEP 1: Vision — Describe image
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
      portionNotes: parsed.portionNotes ? String(parsed.portionNotes) : "unknown portions",
      clarity: clamp(Number(parsed.clarity) || 0, 0, 100),
    };

    console.log("[nutrition][vision] ok", { reqId, ms: nowMs() - t0, clarity: result.clarity });
    return result;
  } catch (err: any) {
    console.error("[nutrition][vision] error", { reqId, ms: nowMs() - t0, msg: errMessage(err) });
    return { foods: [], portionNotes: "unknown portions", clarity: 0 };
  }
}

/* ======================================================================
   STEP 2: Nutrition estimate from foods list
   ====================================================================== */
async function estimateMacrosFromFoods(
  foods: string[],
  portionNotes: string,
  reqId: string
): Promise<{
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  name: string;
}> {
  const t0 = nowMs();

  try {
    const response = await openai.chat.completions.create({
      model: TEXT_MODEL,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "user",
          content: `
Estimate nutrition for this meal.

Visible foods: ${JSON.stringify(foods)}
Portion notes: ${JSON.stringify(portionNotes)}

Return JSON ONLY:
{
  "name": string,
  "calories": number,
  "protein": number,
  "carbs": number,
  "fat": number
}

Rules:
- Round reasonably (whole calories, whole grams)
- If uncertain, make conservative estimates
- No markdown
`,
        },
      ],
    });

    const raw = response.choices[0]?.message?.content || "{}";
    const parsed = safeParseJson(raw);

    const out = {
      name: String(parsed.name || "Meal"),
      calories: Math.max(0, Math.round(Number(parsed.calories) || 0)),
      protein: Math.max(0, Math.round(Number(parsed.protein) || 0)),
      carbs: Math.max(0, Math.round(Number(parsed.carbs) || 0)),
      fat: Math.max(0, Math.round(Number(parsed.fat) || 0)),
    };

    console.log("[nutrition][estimate] ok", { reqId, ms: nowMs() - t0, calories: out.calories });
    return out;
  } catch (err: any) {
    console.error("[nutrition][estimate] error", { reqId, ms: nowMs() - t0, msg: errMessage(err) });
    return { name: "Meal", calories: 0, protein: 0, carbs: 0, fat: 0 };
  }
}

/* ======================================================================
   POST /api/v1/nutrition/meal
   ====================================================================== */
nutritionRouter.post("/meal", (req: Request, res: Response) => {
  const reqId = uuidv4();

  try {
    const cid = getShopifyCustomerId(req);
    if (!cid) return res.status(400).json({ ok: false, error: "Missing shopifyCustomerId" });

    const body = req.body as any;
    const label = String(body?.label || "Meal");
    const items = Array.isArray(body?.items) ? body.items : [];

    if (!items.length) {
      return res.status(400).json({ ok: false, error: "Missing items" });
    }

    const dt = new Date().toISOString();

    // ✅ Ensure a stable id exists for delete
    const meal = {
      id: uuidv4(),
      datetime: dt,
      label,
      items: items.map((it: any) => ({
        name: String(it?.name || "Meal"),
        calories: Number(it?.calories || 0),
        protein: Number(it?.protein || 0),
        carbs: Number(it?.carbs || 0),
        fat: Number(it?.fat || 0),
      })),
    };

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
   ✅ NEW: DELETE /api/v1/nutrition/meal/:id
   - Removes a meal for the user (so macros/totals update)
   ====================================================================== */
nutritionRouter.delete("/meal/:id", (req: Request, res: Response) => {
  const reqId = uuidv4();

  try {
    const cid = getShopifyCustomerId(req);
    if (!cid) return res.status(400).json({ ok: false, error: "Missing shopifyCustomerId" });

    const id = String(req.params.id || "").trim();
    if (!id) return res.status(400).json({ ok: false, error: "Missing meal id" });

    const meals = getMealsArrayForUser(cid);
    const before = meals.length;

    const next = meals.filter((m: any) => String(m?.id || "") !== id);
    setMealsArrayForUser(cid, next);

    const removed = before - next.length;

    console.log("[nutrition][meal-delete] ok", { reqId, cid, id, removed });

    return res.json({ ok: true, id, removed });
  } catch (err: any) {
    console.error("[nutrition][meal-delete] error", { reqId, msg: errMessage(err) });
    return res.status(500).json({ ok: false, error: err.message });
  }
});

/* ======================================================================
   GET /api/v1/nutrition/day-summary
   - Used by Today Summary rings/macros + recent meals UI
   - ✅ DEDUPES to prevent doubled meals/macros
   ====================================================================== */
nutritionRouter.get("/day-summary", (req: Request, res: Response) => {
  const reqId = uuidv4();
  try {
    const cid = getShopifyCustomerId(req);
    if (!cid) {
      return res.status(400).json({ ok: false, error: "Missing shopifyCustomerId" });
    }

    const meals = getMealsArrayForUser(cid);
    const todayKey = isoDateKey(new Date());

    const todaysMealsRaw = meals.filter((m: any) => String(m.datetime || "").slice(0, 10) === todayKey);

    // ✅ fix doubled meals/macros (dedupe)
    const todaysMeals = dedupeMeals(todaysMealsRaw);

    const totals = computeTotalsFromMeals(todaysMeals);
    const targets = getTargetsForUser(cid);

    return res.json({
      ok: true,
      totals,
      targets,
      recentMeals: todaysMeals.slice(-8).reverse(), // includes ids for delete
    });
  } catch (err: any) {
    console.error("[nutrition][day-summary] error", { reqId, msg: errMessage(err) });
    return res.status(500).json({ ok: false, error: err.message });
  }
});

/* ======================================================================
   GET /api/v1/nutrition/history
   - Used by Daily History + Trends UI
   ====================================================================== */
nutritionRouter.get("/history", (req: Request, res: Response) => {
  const reqId = uuidv4();
  try {
    const cid = getShopifyCustomerId(req);
    if (!cid) {
      return res.status(400).json({ ok: false, error: "Missing shopifyCustomerId" });
    }

    const daysParam = Number(req.query.days || 7);
    const days = Number.isFinite(daysParam) ? Math.max(1, Math.min(60, daysParam)) : 7;

    const meals = getMealsArrayForUser(cid);

    const out: Array<{ date: string; totals: any }> = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = isoDateKey(d);

      const dayMealsRaw = meals.filter((m: any) => String(m.datetime || "").slice(0, 10) === key);
      const dayMeals = dedupeMeals(dayMealsRaw);

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
   POST /api/v1/nutrition/day/reset
   - ✅ Makes “Reset Day” button work
   - Clears meals for today (or for ?date=YYYY-MM-DD)
   ====================================================================== */
nutritionRouter.post("/day/reset", (req: Request, res: Response) => {
  const reqId = uuidv4();
  try {
    const cid = getShopifyCustomerId(req);
    if (!cid) {
      return res.status(400).json({ ok: false, error: "Missing shopifyCustomerId" });
    }

    const dateParam = String(req.query.date || (req.body as any)?.date || "").trim();
    const key = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : isoDateKey(new Date());

    const meals = getMealsArrayForUser(cid);
    const before = meals.length;

    const next = meals.filter((m: any) => String(m.datetime || "").slice(0, 10) !== key);
    setMealsArrayForUser(cid, next);

    console.log("[nutrition][day-reset] ok", { reqId, cid, date: key, before, after: next.length });

    return res.json({ ok: true, date: key, removed: before - next.length });
  } catch (err: any) {
    console.error("[nutrition][day-reset] error", { reqId, msg: errMessage(err) });
    return res.status(500).json({ ok: false, error: err.message });
  }
});

/* ======================================================================
   POST /api/v1/nutrition/ai/meal-from-text
   - Suggests macros; DOES NOT LOG (user must confirm)
   ====================================================================== */
nutritionRouter.post("/ai/meal-from-text", async (req: Request, res: Response) => {
  const reqId = uuidv4();
  try {
    const cid = getShopifyCustomerId(req);
    if (!cid) return res.status(400).json({ ok: false, error: "Missing shopifyCustomerId" });

    const text = String((req.body as any)?.text || "").trim();
    if (!text) return res.status(400).json({ ok: false, error: "Missing text" });

    const response = await openai.chat.completions.create({
      model: TEXT_MODEL,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "user",
          content: `
Convert this meal description into nutrition.
Text: ${JSON.stringify(text)}

Return JSON ONLY:
{
  "label": string,
  "name": string,
  "calories": number,
  "protein": number,
  "carbs": number,
  "fat": number
}
`,
        },
      ],
    });

    const raw = response.choices[0]?.message?.content || "{}";
    const parsed = safeParseJson(raw);

    const normalized = {
      label: String(parsed.label || "Meal"),
      name: String(parsed.name || "Meal"),
      calories: Math.max(0, Math.round(Number(parsed.calories) || 0)),
      protein: Math.max(0, Math.round(Number(parsed.protein) || 0)),
      carbs: Math.max(0, Math.round(Number(parsed.carbs) || 0)),
      fat: Math.max(0, Math.round(Number(parsed.fat) || 0)),
      meta: { source: "ai_text", autoLogged: false },
    };

    return res.json({ ok: true, normalized });
  } catch (err: any) {
    console.error("[nutrition][ai-text] error", { reqId, msg: errMessage(err) });
    return res.status(500).json({ ok: false, error: err.message });
  }
});

/* ======================================================================
   POST /api/v1/nutrition/ai/meal-from-photo
   - ✅ NOW NEVER AUTO-LOGS
   - Returns suggestion; user must Confirm & Log
   ====================================================================== */
nutritionRouter.post(
  "/ai/meal-from-photo",
  upload.single("image"),
  async (req: Request, res: Response) => {
    const reqId = uuidv4();

    try {
      const cid = getShopifyCustomerId(req);
      if (!cid) return res.status(400).json({ ok: false, error: "Missing shopifyCustomerId" });

      const file = (req as any).file;
      if (!file?.buffer) return res.status(400).json({ ok: false, error: "Missing image" });

      const vision = await describeMealImage(file.buffer, reqId);
      const estimate = await estimateMacrosFromFoods(vision.foods, vision.portionNotes, reqId);

      // ✅ IMPORTANT: do NOT addMealForUser here.
      // User must click "Confirm & Log Meal" which calls POST /meal.

      const normalized = {
        label: "Meal",
        name: estimate.name || "Meal",
        calories: estimate.calories,
        protein: estimate.protein,
        carbs: estimate.carbs,
        fat: estimate.fat,
        foods: vision.foods,
        portionNotes: vision.portionNotes,
        meta: {
          source: "ai_photo",
          clarity: vision.clarity,
          autoLogged: false,
        },
      };

      return res.json({ ok: true, normalized });
    } catch (err: any) {
      console.error("[nutrition][ai-photo] error", { reqId, msg: errMessage(err) });
      return res.status(500).json({ ok: false, error: err.message });
    }
  }
);

export default nutritionRouter;
