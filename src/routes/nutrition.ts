import { Router, Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import multer from "multer";
import sharp from "sharp";
import OpenAI from "openai";

/** NOTE:
 * Keeps your existing behavior:
 * - POST /meal logs a meal
 * - GET /day-summary returns { totals, targets, recentMeals } and dedupes to prevent doubling
 * - GET /history returns day totals
 * - POST /day/reset clears today’s meals
 *
 * AI behavior:
 * ✅ AI photo endpoint NEVER auto-logs (user must Confirm & Log)
 * ✅ AI photo endpoint returns fully-normalized response fields (mealName, fat, confidence, swaps)
 *
 * IMPORTANT FIX:
 * ✅ Exports BOTH a named router and a default export to satisfy imports.
 */
const nutritionRouter = Router();
export { nutritionRouter };
export default nutritionRouter;

const upload = multer({ storage: multer.memoryStorage() });

/* ======================================================================
   Memory store
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

/** Targets (adjust if you store per-user targets elsewhere) */
function getTargetsForUser(_cid: string) {
  return { calories: 2200, protein: 190, carbs: 190, fat: 60 };
}

function safeParseJson(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    return {};
  }
}

function clamp01to100(n: any) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, v));
}

function toNum(n: any) {
  const v = Number(n);
  return Number.isFinite(v) ? v : 0;
}

function toStr(n: any) {
  return typeof n === "string" ? n : n == null ? "" : String(n);
}

function toStrArray(x: any): string[] {
  if (!Array.isArray(x)) return [];
  return x.map((v) => String(v)).filter((s) => s.trim() !== "");
}

/* ======================================================================
   OpenAI setup
   ====================================================================== */
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const VISION_MODEL = process.env.OPENAI_VISION_MODEL || "gpt-4o-mini";
const MACRO_MODEL = process.env.OPENAI_MACRO_MODEL || "gpt-4.1-mini";

/* ======================================================================
   AI: meal-from-text
   ====================================================================== */
nutritionRouter.post("/ai/meal-from-text", async (req, res) => {
  const reqId = uuidv4();
  try {
    const cid = getShopifyCustomerId(req);
    if (!cid) return res.status(400).json({ ok: false, error: "Missing shopifyCustomerId" });

    const { text } = req.body || {};
    if (!text) return res.status(400).json({ ok: false, error: "Missing text" });

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
   ✅ Accepts multipart field "image" OR "photo"
   ✅ FULLY NORMALIZES response so frontend always gets:
      { mealName, fat, confidence, swaps }
   ====================================================================== */
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

    const processed = await sharp(file.buffer)
      .rotate()
      .resize({ width: 1024, withoutEnlargement: true })
      .jpeg({ quality: 82 })
      .toBuffer();

    // 1) Vision: extract foods + portion + clarity
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
          content: [
            {
              type: "image_url",
              image_url: { url: `data:image/jpeg;base64,${processed.toString("base64")}` },
            },
          ],
        },
      ],
    });

    const visionRaw = vision.choices?.[0]?.message?.content || "{}";
    const visionParsed = safeParseJson(visionRaw);

    const foodsFromVision = toStrArray(visionParsed.foods);
    const portionNotes = toStr(visionParsed.portionNotes);
    const clarity = clamp01to100(visionParsed.clarity);

    // 2) Macro estimation: mealName, macros, confidence, swaps, explanation
    const macroPrompt = [
      "Estimate macros from foods list.",
      "Return ONLY JSON with keys: { mealName, name, calories, protein, carbs, fat, fats, confidence, swaps, healthierSwaps, explanation }",
      `Foods: ${JSON.stringify(foodsFromVision)}`,
      `Portion notes: ${portionNotes}`,
    ].join("\n");

    const macro = await openai.chat.completions.create({
      model: MACRO_MODEL,
      temperature: 0.2,
      messages: [{ role: "user", content: macroPrompt }],
    });

    const macroRaw = macro.choices?.[0]?.message?.content || "{}";
    const macroParsed = safeParseJson(macroRaw);

    // ✅ FULL NORMALIZATION (this is the critical part)
    const mealName = toStr(macroParsed.mealName || macroParsed.name || "Meal");
    const calories = Math.max(0, Math.round(toNum(macroParsed.calories)));
    const protein = Math.max(0, Math.round(toNum(macroParsed.protein)));
    const carbs = Math.max(0, Math.round(toNum(macroParsed.carbs)));

    // fat key normalization: fat | fats
    const fat = Math.max(0, Math.round(toNum(macroParsed.fat ?? macroParsed.fats)));

    // swaps key normalization: swaps | healthierSwaps
    const swaps = toStrArray(macroParsed.swaps).length
      ? toStrArray(macroParsed.swaps)
      : toStrArray(macroParsed.healthierSwaps);

    // confidence key normalization: confidence | clarity fallback
    const confidence = clamp01to100(macroParsed.confidence ?? clarity);

    // foods normalization:
    // - prefer vision foods (strings)
    // - allow macroParsed.foods if provided (array of strings or objects)
    let foods: string[] = foodsFromVision;
    if (!foods.length && Array.isArray(macroParsed.foods)) {
      foods = macroParsed.foods
        .map((f: any) => (typeof f === "string" ? f : f?.name ? String(f.name) : ""))
        .filter((s: string) => s.trim() !== "");
    }

    const explanation = toStr(macroParsed.explanation);

    const normalized = {
      label: String((req.body as any)?.label || "Meal"),
      mealName,                 // ✅ frontend expects mealName (or falls back)
      calories,
      protein,
      carbs,
      fat,                      // ✅ normalized to fat (not fats)
      confidence,               // ✅ always present
      foods,                    // ✅ always array of strings
      swaps,                    // ✅ always array of strings
      portionNotes,
      explanation,
      meta: { source: "ai_photo", clarity, autoLogged: false },
    };

    console.log("[nutrition][ai-photo] ok", {
      reqId,
      ms: nowMs() - t0,
      cid,
      visionModel: VISION_MODEL,
      macroModel: MACRO_MODEL,
      confidence,
      clarity,
      swapsCount: swaps.length,
      foodsCount: foods.length,
    });

    // ✅ NEVER auto-log
    return res.json({ ok: true, normalized });
  } catch (err: any) {
    console.error("[nutrition][ai-photo] error", { reqId, msg: errMessage(err) });
    return res.status(500).json({ ok: false, error: err.message });
  }
}

/* ======================================================================
   POST /meal  - Logs a meal (stable id for delete)
   ====================================================================== */
nutritionRouter.post("/meal", (req: Request, res: Response) => {
  const reqId = uuidv4();
  try {
    const cid = getShopifyCustomerId(req);
    if (!cid) return res.status(400).json({ ok: false, error: "Missing shopifyCustomerId" });

    const body: any = req.body || {};
    const label = body.label ? String(body.label) : undefined;

    let items = Array.isArray(body.items) ? body.items : null;
    if (!items || !items.length) {
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
   DELETE /meal/:id
   ====================================================================== */
nutritionRouter.delete("/meal/:id", (req: Request, res: Response) => {
  const reqId = uuidv4();
  try {
    const cid = getShopifyCustomerId(req);
    if (!cid) return res.status(400).json({ ok: false, error: "Missing shopifyCustomerId" });

    const id = String(req.params.id || "").trim();
    if (!id) return res.status(400).json({ ok: false, error: "Missing id" });

    const meals = getMealsArrayForUser(cid);
    const next = meals.filter((m: any) => String(m?.id || "") !== id);
    setMealsArrayForUser(cid, next);

    return res.json({ ok: true, deletedId: id });
  } catch (err: any) {
    console.error("[nutrition][meal-delete] error", { reqId, msg: errMessage(err) });
    return res.status(500).json({ ok: false, error: err.message });
  }
});

/* ======================================================================
   GET /day-summary
   - returns { totals, targets, recentMeals } for today
   ====================================================================== */
nutritionRouter.get("/day-summary", (req: Request, res: Response) => {
  const reqId = uuidv4();
  try {
    const cid = getShopifyCustomerId(req);
    if (!cid) return res.status(400).json({ ok: false, error: "Missing shopifyCustomerId" });

    const meals = dedupeMeals(getMealsArrayForUser(cid));

    const todayKey = isoDateKey(new Date());
    const todaysMeals = meals.filter((m: any) => String(m?.datetime || "").slice(0, 10) === todayKey);

    const totals = computeTotalsFromMeals(todaysMeals);
    const targets = getTargetsForUser(cid);

    // Sort by datetime desc
    const recentMeals = [...todaysMeals].sort((a, b) => String(b.datetime).localeCompare(String(a.datetime)));

    return res.json({ ok: true, totals, targets, recentMeals });
  } catch (err: any) {
    console.error("[nutrition][day-summary] error", { reqId, msg: errMessage(err) });
    return res.status(500).json({ ok: false, error: err.message });
  }
});

/* ======================================================================
   GET /history?days=7
   - returns totals per day for last N days
   ====================================================================== */
nutritionRouter.get("/history", (req: Request, res: Response) => {
  const reqId = uuidv4();
  try {
    const cid = getShopifyCustomerId(req);
    if (!cid) return res.status(400).json({ ok: false, error: "Missing shopifyCustomerId" });

    const days = Math.max(1, Math.min(60, Number(req.query.days) || 7));
    const meals = dedupeMeals(getMealsArrayForUser(cid));

    const byDate: Record<string, any[]> = {};
    for (const m of meals) {
      const k = String(m?.datetime || "").slice(0, 10);
      if (!k) continue;
      byDate[k] = byDate[k] || [];
      byDate[k].push(m);
    }

    const out: any[] = [];
    for (let i = 0; i < days; i++) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = isoDateKey(d);

      const dayMeals = byDate[key] || [];
      const totals = computeTotalsFromMeals(dayMeals);

      out.push({ date: key, totals });
    }

    // oldest -> newest for chart
    out.reverse();

    return res.json({ ok: true, days: out });
  } catch (err: any) {
    console.error("[nutrition][history] error", { reqId, msg: errMessage(err) });
    return res.status(500).json({ ok: false, error: err.message });
  }
});

/* ======================================================================
   POST /day/reset
   - clears today's meals only
   ====================================================================== */
nutritionRouter.post("/day/reset", (req: Request, res: Response) => {
  const reqId = uuidv4();
  try {
    const cid = getShopifyCustomerId(req);
    if (!cid) return res.status(400).json({ ok: false, error: "Missing shopifyCustomerId" });

    const meals = dedupeMeals(getMealsArrayForUser(cid));
    const todayKey = isoDateKey(new Date());

    const keep = meals.filter((m: any) => String(m?.datetime || "").slice(0, 10) !== todayKey);
    setMealsArrayForUser(cid, keep);

    return res.json({ ok: true });
  } catch (err: any) {
    console.error("[nutrition][day-reset] error", { reqId, msg: errMessage(err) });
    return res.status(500).json({ ok: false, error: err.message });
  }
});
