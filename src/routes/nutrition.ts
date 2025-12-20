import { Router, Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import multer from "multer";
import sharp from "sharp";
import OpenAI from "openai";

/** NOTE:
 * This file keeps your existing behavior:
 * - POST /meal logs a meal
 * - GET /day-summary returns { totals, targets, recentMeals } and dedupes to prevent doubling
 * - GET /history returns day totals
 * - POST /day/reset clears today’s meals
 *
 * NEW REQUIREMENTS ADDED:
 * ✅ AI photo endpoint NEVER auto-logs (user must Confirm & Log)
 * ✅ DELETE /meal/:id removes a meal and updates macro totals
 *
 * IMPORTANT FIX:
 * ✅ Exports BOTH a named router and a default export to satisfy imports.
 */

const nutritionRouter = Router();
export { nutritionRouter };
export default nutritionRouter;

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
      `${dt.slice(0, 19)}|${String(first?.name || "")}|${Number(first?.calories || 0)}|${String(m?.label || "")}`;

    if (seen.has(key)) continue;
    seen.add(key);
    out.push(m);
  }
  return out;
}

/** Targets (keep your existing pattern; adjust if you already store targets elsewhere) */
function getTargetsForUser(_cid: string) {
  // If you already have per-user targets, return those here.
  return { calories: 2200, protein: 190, carbs: 190, fat: 60 };
}

/* ======================================================================
   OpenAI setup (existing)
   ====================================================================== */
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const VISION_MODEL = process.env.OPENAI_VISION_MODEL || "gpt-4o-mini";
const MACRO_MODEL = process.env.OPENAI_MACRO_MODEL || "gpt-4.1-mini";

function safeParseJson(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    return {};
  }
}

/* ======================================================================
   AI: meal-from-text (keeps your behavior)
   ====================================================================== */
nutritionRouter.post("/ai/meal-from-text", async (req, res) => {
  const reqId = uuidv4();
  try {
    const cid = getShopifyCustomerId(req);
    if (!cid) return res.status(400).json({ ok: false, error: "Missing shopifyCustomerId" });

    const { text } = req.body || {};
    if (!text) return res.status(400).json({ ok: false, error: "Missing text" });

    // NOTE: if you already use a separate service, keep it — this is a safe inline fallback
    const prompt = [
      "You are a nutrition estimator.",
      "Return ONLY valid JSON with: label, name, calories, protein, carbs, fat.",
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
   AI: meal-from-photo
   ✅ NEVER AUTO-LOGS
   ✅ Accepts multipart field "image" OR "photo" (supports both old/new JS)
   ====================================================================== */
nutritionRouter.post("/ai/meal-from-photo", (req: Request, res: Response) => {
  // We need to support either field name.
  // We'll try "image" first, then "photo".
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

    // preprocess image (helps vision)
    const processed = await sharp(file.buffer)
      .rotate()
      .resize({ width: 1024, withoutEnlargement: true })
      .jpeg({ quality: 82 })
      .toBuffer();

    // vision: describe foods/portion
    const visionPrompt = [
      "Analyze this meal photo.",
      "Return ONLY valid JSON with keys:",
      "{ foods: string[], portionNotes: string, clarity: number }",
      "foods = list of visible foods",
      "portionNotes = short portion estimate",
      "clarity = 0-100 how confident you are in what you see",
    ].join("\n");

    const vision = await openai.chat.completions.create({
      model: VISION_MODEL,
      temperature: 0.2,
      messages: [
        { role: "user", content: visionPrompt },
        {
          role: "user",
          // @ts-ignore (OpenAI SDK image content typing varies by version)
          content: [{ type: "image_url", image_url: { url: `data:image/jpeg;base64,${processed.toString("base64")}` } }],
        },
      ],
    });

    const visionRaw = vision.choices?.[0]?.message?.content || "{}";
    const visionParsed = safeParseJson(visionRaw);

    const foods = Array.isArray(visionParsed.foods) ? visionParsed.foods.map(String) : [];
    const portionNotes = String(visionParsed.portionNotes || "");
    const clarity = Math.max(0, Math.min(100, Number(visionParsed.clarity) || 0));

    // macro estimation from foods
    const macroPrompt = [
      "Estimate macros from foods list.",
      "Return ONLY JSON with keys: { name, calories, protein, carbs, fat, confidence, swaps, explanation }",
      `Foods: ${JSON.stringify(foods)}`,
      `Portion notes: ${portionNotes}`,
    ].join("\n");

    const macro = await openai.chat.completions.create({
      model: MACRO_MODEL,
      temperature: 0.2,
      messages: [{ role: "user", content: macroPrompt }],
    });

    const macroRaw = macro.choices?.[0]?.message?.content || "{}";
    const macroParsed = safeParseJson(macroRaw);

    const normalized = {
      label: String((req.body as any)?.label || "Meal"),
      name: String(macroParsed.name || "Meal"),
      calories: Math.max(0, Math.round(Number(macroParsed.calories) || 0)),
      protein: Math.max(0, Math.round(Number(macroParsed.protein) || 0)),
      carbs: Math.max(0, Math.round(Number(macroParsed.carbs) || 0)),
      fat: Math.max(0, Math.round(Number(macroParsed.fat) || 0)),
      foods,
      portionNotes,
      swaps: Array.isArray(macroParsed.swaps) ? macroParsed.swaps.map(String) : [],
      explanation: String(macroParsed.explanation || ""),
      confidence: Math.max(0, Math.min(100, Number(macroParsed.confidence) || 0)),
      meta: { source: "ai_photo", clarity, autoLogged: false },
    };

    console.log("[nutrition][ai-photo] ok", {
      reqId,
      ms: nowMs() - t0,
      cid,
      visionModel: VISION_MODEL,
      macroModel: MACRO_MODEL,
    });

    // ✅ NEVER auto-log
    return res.json({ ok: true, normalized });
  } catch (err: any) {
    console.error("[nutrition][ai-photo] error", { reqId, msg: errMessage(err) });
    return res.status(500).json({ ok: false, error: err.message });
  }
}

/* ======================================================================
   POST /api/v1/nutrition/meal
   - Logs a meal (ensures stable id for delete)
   ====================================================================== */
nutritionRouter.post("/meal", (req: Request, res: Response) => {
  const reqId = uuidv4();
  try {
    const cid = getShopifyCustomerId(req);
    if (!cid) return res.status(400).json({ ok: false, error: "Missing shopifyCustomerId" });

    const body: any = req.body || {};
    const label = body.label ? String(body.label) : undefined;

    // Accept either "items" array or single macro fields
    let items = Array.isArray(body.items) ? body.items : null;
    if (!items || !items.length) {
      // fallback to single
      items = [
        {
          name: String(body.name || "Meal"),
          calories: Number(body.calories || 0),
          protein: Number(body.protein || 0),
          carbs: Number(body.carbs || 0),
          fat: Number(body.fat || 0),
        },
      ];
    }

    if (!items.length) return res.status(400).json({ ok: false, error: "Missing items" });

    const meal = {
      id: uuidv4(),
      datetime: new Date().toISOString(),
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

    return res.status(201).json({ ok: true, meal });
  } catch (err: any) {
    console.error("[nutrition][meal] error", { reqId, msg: errMessage(err) });
    return res.status(500).json({ ok: false, error: err.message });
  }
});

/* ======================================================================
   ✅ NEW: DELETE /api/v1/nutrition/meal/:id
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
    return res.json({ ok: true, id, removed });
  } catch (err: any) {
    console.error("[nutrition][meal-delete] error", { reqId, msg: errMessage(err) });
    return res.status(500).json({ ok: false, error: err.message });
  }
});

/* ======================================================================
   GET /api/v1/nutrition/day-summary
   ====================================================================== */
nutritionRouter.get("/day-summary", (req: Request, res: Response) => {
  const reqId = uuidv4();
  try {
    const cid = getShopifyCustomerId(req);
    if (!cid) return res.status(400).json({ ok: false, error: "Missing shopifyCustomerId" });

    const meals = getMealsArrayForUser(cid);
    const todayKey = isoDateKey(new Date());

    const todaysMealsRaw = meals.filter((m: any) => String(m.datetime || "").slice(0, 10) === todayKey);
    const todaysMeals = dedupeMeals(todaysMealsRaw);

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
   ====================================================================== */
nutritionRouter.get("/history", (req: Request, res: Response) => {
  const reqId = uuidv4();
  try {
    const cid = getShopifyCustomerId(req);
    if (!cid) return res.status(400).json({ ok: false, error: "Missing shopifyCustomerId" });

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

      out.push({ date: key, totals: computeTotalsFromMeals(dayMeals) });
    }

    return res.json({ ok: true, days: out });
  } catch (err: any) {
    console.error("[nutrition][history] error", { reqId, msg: errMessage(err) });
    return res.status(500).json({ ok: false, error: err.message });
  }
});

/* ======================================================================
   POST /api/v1/nutrition/day/reset
   ====================================================================== */
nutritionRouter.post("/day/reset", (req: Request, res: Response) => {
  const reqId = uuidv4();
  try {
    const cid = getShopifyCustomerId(req);
    if (!cid) return res.status(400).json({ ok: false, error: "Missing shopifyCustomerId" });

    const meals = getMealsArrayForUser(cid);
    const todayKey = isoDateKey(new Date());

    const next = meals.filter((m: any) => String(m.datetime || "").slice(0, 10) !== todayKey);
    setMealsArrayForUser(cid, next);

    return res.json({ ok: true });
  } catch (err: any) {
    console.error("[nutrition][day-reset] error", { reqId, msg: errMessage(err) });
    return res.status(500).json({ ok: false, error: err.message });
  }
});
