// src/routes/nutrition.ts
import { Router, Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import multer from "multer";
import sharp from "sharp";
import OpenAI from "openai";

/**
 * Keeps existing behavior and fixes your Multer "Unexpected field" issue by:
 * ✅ Accepting multipart field "image" OR "photo" using upload.fields(...)
 * ✅ Adding aliases that your frontend calls:
 *    - POST /ai/photo
 *    - POST /ai/photo-estimate
 *    - POST /ai/meal-from-photo
 *
 * IMPORTANT:
 * - This does NOT auto-log meals. It only returns estimates.
 */

const nutritionRouter = Router();
export { nutritionRouter };
export default nutritionRouter;

// Multer: accept both possible field names without throwing
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 }, // 8MB
});

// This middleware accepts either "image" or "photo"
const uploadImageOrPhoto = upload.fields([
  { name: "image", maxCount: 1 },
  { name: "photo", maxCount: 1 },
]);

/* ======================================================================
   Memory store (existing pattern)
   ====================================================================== */
const memoryStore: any =
  (global as any).memoryStore || ((global as any).memoryStore = {});
memoryStore.mealsByUser = memoryStore.mealsByUser || {};
memoryStore.targetsByUser = memoryStore.targetsByUser || {}; // optional

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

/**
 * Dedupe meals for display/totals (prevents doubled recent meals + doubled macros).
 */
function dedupeMeals(meals: any[]) {
  const seen = new Set<string>();
  const out: any[] = [];

  for (const m of meals) {
    const dt = String(m?.datetime || "");
    const id = String(m?.id || "");
    const first = m?.items?.[0] || {};
    const key =
      id ||
      `${dt.slice(0, 19)}|${String(first?.name || "")}|${Number(
        first?.calories || 0
      )}|${String(m?.label || "")}`;

    if (seen.has(key)) continue;
    seen.add(key);
    out.push(m);
  }
  return out;
}

/** Targets (swap in your real per-user targets if you have them) */
function getTargetsForUser(cid: string) {
  const t = memoryStore.targetsByUser?.[cid];
  if (t && typeof t === "object") {
    return {
      calories: Number(t.calories) || 2200,
      protein: Number(t.protein) || 190,
      carbs: Number(t.carbs) || 190,
      fat: Number(t.fat) || 60,
    };
  }
  return { calories: 2200, protein: 190, carbs: 190, fat: 60 };
}

/** AI response wrapper so JS can always read top-level fields */
function aiResponse(normalized: any) {
  const conf100 =
    normalized?.confidence == null ? null : Number(normalized.confidence);
  const conf01 =
    conf100 == null || Number.isNaN(conf100)
      ? null
      : Math.max(0, Math.min(1, conf100 / 100));

  return {
    ok: true,

    calories: Number(normalized?.calories || 0),
    protein: Number(normalized?.protein || 0),
    carbs: Number(normalized?.carbs || 0),
    fat: Number(normalized?.fat || 0),

    foods: Array.isArray(normalized?.foods) ? normalized.foods : [],
    swaps: Array.isArray(normalized?.swaps) ? normalized.swaps : [],
    confidence: conf01,
    explanation: String(normalized?.explanation || ""),

    normalized,

    macros: {
      calories: Number(normalized?.calories || 0),
      protein: Number(normalized?.protein || 0),
      carbs: Number(normalized?.carbs || 0),
      fat: Number(normalized?.fat || 0),
    },
  };
}

/* ======================================================================
   OpenAI setup
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

// Helper: safely pull the uploaded file from either field name
function getUploadedPhotoFile(req: Request): Express.Multer.File | null {
  const filesAny = (req as any).files as
    | Record<string, Express.Multer.File[]>
    | undefined;

  const img = filesAny?.image?.[0];
  const pho = filesAny?.photo?.[0];

  return img || pho || null;
}

/* ======================================================================
   GET /api/v1/nutrition/meals
   ====================================================================== */
nutritionRouter.get("/meals", (req: Request, res: Response) => {
  const reqId = uuidv4();
  try {
    const cid = getShopifyCustomerId(req);
    if (!cid) return res.status(400).json({ ok: false, error: "Missing shopifyCustomerId" });

    const mealsAll = getMealsArrayForUser(cid);

    const date = String(req.query.date || "").trim();
    const today = String(req.query.today || "").trim() === "1";
    const daysParam = Number(req.query.days || 30);
    const days = Number.isFinite(daysParam)
      ? Math.max(1, Math.min(90, daysParam))
      : 30;

    let filtered = mealsAll;

    if (date) {
      filtered = mealsAll.filter(
        (m: any) => String(m?.datetime || "").slice(0, 10) === date
      );
    } else if (today) {
      const key = isoDateKey(new Date());
      filtered = mealsAll.filter(
        (m: any) => String(m?.datetime || "").slice(0, 10) === key
      );
    } else {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - (days - 1));
      const cutoffKey = isoDateKey(cutoff);

      filtered = mealsAll.filter((m: any) => {
        const k = String(m?.datetime || "").slice(0, 10);
        return k >= cutoffKey;
      });
    }

    const meals = dedupeMeals(filtered);
    return res.json({ ok: true, meals });
  } catch (err: any) {
    console.error("[nutrition][meals] error", { reqId, msg: errMessage(err) });
    return res.status(500).json({ ok: false, error: err.message });
  }
});

/* ======================================================================
   POST /api/v1/nutrition/meal
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
          name: String(body.name || body.mealName || "Meal"),
          calories: Number(body.calories || 0),
          protein: Number(body.protein || 0),
          carbs: Number(body.carbs || 0),
          fat: Number(body.fat || 0),
        },
      ];
    }

    if (!items.length) {
      return res.status(400).json({ ok: false, error: "Missing items" });
    }

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

/* ✅ Alias: some JS calls /meals (plural) to log */
nutritionRouter.post("/meals", (req, res) => {
  (req as any).url = "/meal";
  return (nutritionRouter as any).handle(req, res, () => {});
});

/* ======================================================================
   DELETE /api/v1/nutrition/meal/:id
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

/* ✅ Alias: delete plural */
nutritionRouter.delete("/meals/:id", (req, res) => {
  (req as any).url = `/meal/${req.params.id}`;
  return (nutritionRouter as any).handle(req, res, () => {});
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

    const todaysMealsRaw = meals.filter(
      (m: any) => String(m.datetime || "").slice(0, 10) === todayKey
    );
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
    const days = Number.isFinite(daysParam)
      ? Math.max(1, Math.min(60, daysParam))
      : 7;

    const meals = getMealsArrayForUser(cid);

    const out: Array<{ date: string; totals: any }> = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = isoDateKey(d);

      const dayMealsRaw = meals.filter(
        (m: any) => String(m.datetime || "").slice(0, 10) === key
      );
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

    const next = meals.filter(
      (m: any) => String(m.datetime || "").slice(0, 10) !== todayKey
    );
    setMealsArrayForUser(cid, next);

    return res.json({ ok: true });
  } catch (err: any) {
    console.error("[nutrition][day-reset] error", { reqId, msg: errMessage(err) });
    return res.status(500).json({ ok: false, error: err.message });
  }
});

/* ✅ Alias: some JS calls /reset-day */
nutritionRouter.post("/reset-day", (req, res) => {
  (req as any).url = "/day/reset";
  return (nutritionRouter as any).handle(req, res, () => {});
});

/* ======================================================================
   AI: meal-from-text
   ====================================================================== */
nutritionRouter.post("/ai/meal-from-text", async (req, res) => {
  const reqId = uuidv4();
  try {
    const cid = getShopifyCustomerId(req);
    if (!cid) return res.status(400).json({ ok: false, error: "Missing shopifyCustomerId" });

    const { text } = req.body || {};
    if (!text || !String(text).trim()) {
      return res.status(400).json({ ok: false, error: "Missing text" });
    }

    const prompt = [
      "You are a nutrition estimator.",
      "Return ONLY valid JSON with keys: label, name, calories, protein, carbs, fat, explanation.",
      "Rules:",
      "- Use realistic estimates based on typical portion sizes if not specified.",
      "- explanation should be 1–2 short sentences.",
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
      explanation: String(parsed.explanation || ""),
      meta: { source: "ai_text", autoLogged: false },
    };

    return res.json(aiResponse(normalized));
  } catch (err: any) {
    console.error("[nutrition][ai-text] error", { reqId, msg: errMessage(err) });
    return res.status(500).json({ ok: false, error: err.message });
  }
});

/* ======================================================================
   AI: meal-from-photo
   ✅ NEVER AUTO-LOGS
   ✅ Accepts multipart field "image" OR "photo" (no MulterError)
   ====================================================================== */

nutritionRouter.post("/ai/meal-from-photo", uploadImageOrPhoto, handlePhoto);
nutritionRouter.post("/ai/photo", uploadImageOrPhoto, handlePhoto);
nutritionRouter.post("/ai/photo-estimate", uploadImageOrPhoto, handlePhoto);

async function handlePhoto(req: Request, res: Response) {
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

    // Preprocess image (rotate/resize/compress)
    const processed = await sharp(file.buffer)
      .rotate()
      .resize({ width: 1024, withoutEnlargement: true })
      .jpeg({ quality: 82 })
      .toBuffer();

    // Vision pass: identify foods / portions
    const visionPrompt = [
      "Analyze this meal photo.",
      "Return ONLY valid JSON with keys:",
      '{ "foods": string[], "portionNotes": string, "clarity": number }',
      "foods = list of visible foods",
      "portionNotes = short portion estimate",
      "clarity = 0-100 confidence in what you see",
    ].join("\n");

    const vision = await openai.chat.completions.create({
      model: VISION_MODEL,
      temperature: 0.2,
      messages: [
        { role: "user", content: visionPrompt },
        {
          role: "user",
          // @ts-ignore - OpenAI SDK supports multimodal content for compatible models
          content: [
            {
              type: "image_url",
              image_url: {
                url: `data:image/jpeg;base64,${processed.toString("base64")}`,
              },
            },
          ],
        },
      ],
    });

    const visionRaw = vision.choices?.[0]?.message?.content || "{}";
    const visionParsed = safeParseJson(visionRaw);

    const foods = Array.isArray(visionParsed.foods)
      ? visionParsed.foods.map(String)
      : [];
    const portionNotes = String(visionParsed.portionNotes || "");
    const clarity = Math.max(0, Math.min(100, Number(visionParsed.clarity) || 0));

    // Macro pass
    const macroPrompt = [
      "Estimate macros from foods list + portion notes.",
      'Return ONLY JSON with keys: { "name", "calories", "protein", "carbs", "fat", "confidence", "swaps", "explanation" }',
      `Foods: ${JSON.stringify(foods)}`,
      `Portion notes: ${portionNotes}`,
      "Rules:",
      "- confidence is 0-100",
      "- swaps is an array of 2-5 healthier alternatives",
      "- explanation is 1–2 short sentences",
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
      fieldUsed: (req as any).files?.image?.length ? "image" : "photo",
    });

    // ✅ NEVER auto-log
    return res.json(aiResponse(normalized));
  } catch (err: any) {
    console.error("[nutrition][ai-photo] error", { reqId, msg: errMessage(err) });
    return res.status(500).json({ ok: false, error: err.message });
  }
}

/* ======================================================================
   BARCODE: POST /api/v1/nutrition/barcode-lookup
   ====================================================================== */
nutritionRouter.post("/barcode-lookup", async (req: Request, res: Response) => {
  const reqId = uuidv4();
  try {
    const cid = getShopifyCustomerId(req);
    if (!cid) return res.status(400).json({ ok: false, error: "Missing shopifyCustomerId" });

    const barcode = String((req.body as any)?.barcode || "").trim();
    if (!barcode) return res.status(400).json({ ok: false, error: "Missing barcode" });

    const url = `https://world.openfoodfacts.org/api/v0/product/${encodeURIComponent(barcode)}.json`;
    const resp = await fetch(url);
    const data: any = await resp.json();

    if (!data || data.status !== 1 || !data.product) {
      return res.status(404).json({ ok: false, error: "Barcode not found" });
    }

    const p = data.product || {};
    const n = p.nutriments || {};

    const name =
      p.product_name ||
      p.product_name_en ||
      p.generic_name ||
      p.abbreviated_product_name ||
      "Barcode item";

    const cals =
      Number(n["energy-kcal_serving"]) || Number(n["energy-kcal_100g"]) || 0;
    const protein =
      Number(n["proteins_serving"]) || Number(n["proteins_100g"]) || 0;
    const carbs =
      Number(n["carbohydrates_serving"]) ||
      Number(n["carbohydrates_100g"]) ||
      0;
    const fat = Number(n["fat_serving"]) || Number(n["fat_100g"]) || 0;

    return res.json({
      ok: true,
      name: String(name),
      calories: Math.max(0, Math.round(cals)),
      protein: Math.max(0, Math.round(protein)),
      carbs: Math.max(0, Math.round(carbs)),
      fat: Math.max(0, Math.round(fat)),
      meta: {
        barcode,
        source: "openfoodfacts",
        per: Number(n["energy-kcal_serving"]) ? "serving" : "100g",
      },
    });
  } catch (err: any) {
    console.error("[nutrition][barcode-lookup] error", { reqId, msg: errMessage(err) });
    return res.status(500).json({ ok: false, error: err.message });
  }
});
