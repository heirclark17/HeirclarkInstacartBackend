// src/routes/nutrition.ts
import { Router, Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import multer from "multer";
import sharp from "sharp";
import OpenAI from "openai";
import crypto from "crypto";
import { Pool } from "pg";
import { authMiddleware } from "../middleware/auth";

// PostgreSQL connection for persistent meal storage
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes("localhost")
    ? false
    : { rejectUnauthorized: false },
});

// Fast photo handler (single API call, 2x faster)
import { handlePhotoFast } from "./photoFast";

// RAG Integration (optional - enabled via USE_RAG=true)
import {
  estimateMealFromTextWithRag,
  estimateMealFromPhotoWithRag,
  checkRagHealth,
} from "../services/rag";

/**
 * Upgrades AI payload richness:
 * ✅ Always returns mealName (and name for backward-compat)
 * ✅ "What I see on the plate" returns foods[] as objects with per-item macros + notes
 * ✅ "Healthier swaps" returns healthierSwaps[] as objects with per-swap macros + why
 * ✅ Keeps existing routes/aliases + Multer "image" OR "photo"
 * ✅ Never auto-logs meals
 */

const nutritionRouter = Router();

// ✅ SECURITY FIX: Apply STRICT authentication (OWASP A01: IDOR Protection)
nutritionRouter.use(authMiddleware({ strictAuth: true }));

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

/** clamp helpers */
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

/** Robust JSON parse (accepts raw JSON or JSON embedded in text) */
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

// Helper: safely pull the uploaded file from either field name
function getUploadedPhotoFile(req: Request): Express.Multer.File | null {
  const filesAny = (req as any).files as
    | Record<string, Express.Multer.File[]>
    | undefined;

  const img = filesAny?.image?.[0];
  const pho = filesAny?.photo?.[0];

  return img || pho || null;
}

/** Normalize "foods" items into a consistent object shape */
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
      // allow strings ("chicken") or objects
      if (typeof x === "string") {
        return {
          name: x,
          calories: 0,
          protein: 0,
          carbs: 0,
          fat: 0,
        };
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

/** Normalize swaps into a consistent object shape */
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
      // allow strings ("swap fries for salad") or objects
      if (typeof x === "string") {
        const s = x.trim();
        if (!s) return null;
        return {
          swap: s,
          why: "",
          calories: 0,
          protein: 0,
          carbs: 0,
          fat: 0,
        };
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

/**
 * AI response wrapper so JS can always read top-level fields
 * + provides foods + healthierSwaps + mealName consistently
 */
function aiResponse(normalized: any) {
  const conf100 =
    normalized?.confidence == null ? null : Number(normalized.confidence);
  const conf01 =
    conf100 == null || Number.isNaN(conf100)
      ? null
      : Math.max(0, Math.min(1, conf100 / 100));

  const mealName = String(
    normalized?.mealName || normalized?.name || normalized?.title || "Meal"
  );

  const foods = normalizeFoods(normalized?.foods);
  const healthierSwaps = normalizeSwaps(
    normalized?.healthierSwaps ?? normalized?.swaps
  );

  return {
    ok: true,

    // primary macros (what your rings & inputs use)
    calories: int0(normalized?.calories),
    protein: int0(normalized?.protein),
    carbs: int0(normalized?.carbs),
    fat: int0(normalized?.fat),

    // naming
    mealName, // ✅ frontend-friendly
    name: mealName, // ✅ backward compat (some code uses "name")
    label: String(normalized?.label || "Meal"),

    // detailed breakdowns
    foods, // ✅ "what I see on the plate"
    healthierSwaps, // ✅ detailed swaps
    swaps: healthierSwaps, // ✅ backward compat (your current JS reads swaps OR healthierSwaps)

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

/* ======================================================================
   OpenAI setup
   ====================================================================== */
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const VISION_MODEL = process.env.OPENAI_VISION_MODEL || "gpt-4.1-mini";
const MACRO_MODEL = process.env.OPENAI_MACRO_MODEL || "gpt-4.1-mini";

// RAG mode flag (set USE_RAG=true to enable RAG-enhanced meal estimation)
const USE_RAG = process.env.USE_RAG === "true";

/* ======================================================================
   GET /api/v1/nutrition/meals
   Supports pagination with ?page=1&limit=20
   Now uses PostgreSQL for persistent storage
   ====================================================================== */
nutritionRouter.get("/meals", async (req: Request, res: Response) => {
  const reqId = uuidv4();
  try {
    const cid = getShopifyCustomerId(req);
    if (!cid)
      return res
        .status(400)
        .json({ ok: false, error: "Missing shopifyCustomerId" });

    const date = String(req.query.date || "").trim();
    const today = String(req.query.today || "").trim() === "1";
    const daysParam = Number(req.query.days || 30);
    const days = Number.isFinite(daysParam)
      ? Math.max(1, Math.min(90, daysParam))
      : 30;

    // Pagination params
    const page = Math.max(1, parseInt(String(req.query.page || "1"), 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || "50"), 10) || 50));
    const offset = (page - 1) * limit;

    let query: string;
    let params: any[];
    let countQuery: string;
    let countParams: any[];

    if (date) {
      // Specific date
      query = `
        SELECT id, datetime, label, items, total_calories, total_protein, total_carbs, total_fat, source
        FROM hc_meals
        WHERE shopify_customer_id = $1 AND DATE(datetime) = $2
        ORDER BY datetime DESC
        LIMIT $3 OFFSET $4
      `;
      params = [cid, date, limit, offset];
      countQuery = `SELECT COUNT(*) FROM hc_meals WHERE shopify_customer_id = $1 AND DATE(datetime) = $2`;
      countParams = [cid, date];
    } else if (today) {
      // Today only
      query = `
        SELECT id, datetime, label, items, total_calories, total_protein, total_carbs, total_fat, source
        FROM hc_meals
        WHERE shopify_customer_id = $1 AND DATE(datetime) = CURRENT_DATE
        ORDER BY datetime DESC
        LIMIT $2 OFFSET $3
      `;
      params = [cid, limit, offset];
      countQuery = `SELECT COUNT(*) FROM hc_meals WHERE shopify_customer_id = $1 AND DATE(datetime) = CURRENT_DATE`;
      countParams = [cid];
    } else {
      // Last N days
      query = `
        SELECT id, datetime, label, items, total_calories, total_protein, total_carbs, total_fat, source
        FROM hc_meals
        WHERE shopify_customer_id = $1 AND datetime >= CURRENT_DATE - INTERVAL '${days} days'
        ORDER BY datetime DESC
        LIMIT $2 OFFSET $3
      `;
      params = [cid, limit, offset];
      countQuery = `SELECT COUNT(*) FROM hc_meals WHERE shopify_customer_id = $1 AND datetime >= CURRENT_DATE - INTERVAL '${days} days'`;
      countParams = [cid];
    }

    const [mealsResult, countResult] = await Promise.all([
      pool.query(query, params),
      pool.query(countQuery, countParams),
    ]);

    const total = parseInt(countResult.rows[0]?.count || "0", 10);
    const totalPages = Math.ceil(total / limit);

    // Transform rows to match expected format
    const meals = mealsResult.rows.map((row: any) => ({
      id: row.id,
      datetime: row.datetime,
      label: row.label,
      items: row.items || [],
      totalCalories: row.total_calories,
      totalProtein: row.total_protein,
      totalCarbs: row.total_carbs,
      totalFat: row.total_fat,
      source: row.source,
    }));

    return res.json({
      ok: true,
      meals,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
    });
  } catch (err: any) {
    console.error("[nutrition][meals] error", { reqId, msg: errMessage(err) });
    return res.status(500).json({ ok: false, error: err.message });
  }
});

/* ======================================================================
   POST /api/v1/nutrition/meal
   Now uses PostgreSQL for persistent storage
   ====================================================================== */
nutritionRouter.post("/meal", async (req: Request, res: Response) => {
  const reqId = uuidv4();
  try {
    const cid = getShopifyCustomerId(req);
    if (!cid)
      return res
        .status(400)
        .json({ ok: false, error: "Missing shopifyCustomerId" });

    const body: any = req.body || {};
    const label = body.label ? String(body.label) : null;
    const source = body.source ? String(body.source) : "manual";

    // Support custom datetime for syncing historical data
    const datetime = body.datetime ? new Date(body.datetime) : new Date();

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

    // Calculate totals
    const formattedItems = items.map((it: any) => ({
      name: String(it?.name || "Meal"),
      calories: Number(it?.calories || 0),
      protein: Number(it?.protein || 0),
      carbs: Number(it?.carbs || 0),
      fat: Number(it?.fat || 0),
    }));

    const totalCalories = formattedItems.reduce((sum: number, it: any) => sum + it.calories, 0);
    const totalProtein = formattedItems.reduce((sum: number, it: any) => sum + it.protein, 0);
    const totalCarbs = formattedItems.reduce((sum: number, it: any) => sum + it.carbs, 0);
    const totalFat = formattedItems.reduce((sum: number, it: any) => sum + it.fat, 0);

    // Insert into database
    const result = await pool.query(
      `INSERT INTO hc_meals
        (shopify_customer_id, datetime, label, items, total_calories, total_protein, total_carbs, total_fat, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, datetime, label, items, total_calories, total_protein, total_carbs, total_fat, source`,
      [cid, datetime, label, JSON.stringify(formattedItems), totalCalories, totalProtein, totalCarbs, totalFat, source]
    );

    const row = result.rows[0];
    const meal = {
      id: row.id,
      datetime: row.datetime,
      label: row.label,
      items: row.items,
      totalCalories: row.total_calories,
      totalProtein: row.total_protein,
      totalCarbs: row.total_carbs,
      totalFat: row.total_fat,
      source: row.source,
    };

    console.log("[nutrition][meal] saved to DB", { reqId, mealId: meal.id, cid });
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
   Now uses PostgreSQL for persistent storage
   ====================================================================== */
nutritionRouter.delete("/meal/:id", async (req: Request, res: Response) => {
  const reqId = uuidv4();
  try {
    const cid = getShopifyCustomerId(req);
    if (!cid)
      return res
        .status(400)
        .json({ ok: false, error: "Missing shopifyCustomerId" });

    const id = String(req.params.id || "").trim();
    if (!id) return res.status(400).json({ ok: false, error: "Missing meal id" });

    // Delete from database (ensure it belongs to this user)
    const result = await pool.query(
      `DELETE FROM hc_meals WHERE id = $1 AND shopify_customer_id = $2 RETURNING id`,
      [id, cid]
    );

    const removed = result.rowCount || 0;
    console.log("[nutrition][meal-delete] removed from DB", { reqId, mealId: id, removed });
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
   Now uses PostgreSQL for persistent storage
   ====================================================================== */
nutritionRouter.get("/day-summary", async (req: Request, res: Response) => {
  const reqId = uuidv4();
  try {
    const cid = getShopifyCustomerId(req);
    if (!cid)
      return res
        .status(400)
        .json({ ok: false, error: "Missing shopifyCustomerId" });

    // Support custom date for historical data
    const dateParam = String(req.query.date || "").trim();
    const dateCondition = dateParam ? `DATE(datetime) = $2` : `DATE(datetime) = CURRENT_DATE`;
    const params = dateParam ? [cid, dateParam] : [cid];

    // Get today's meals from database
    const mealsResult = await pool.query(
      `SELECT id, datetime, label, items, total_calories, total_protein, total_carbs, total_fat, source
       FROM hc_meals
       WHERE shopify_customer_id = $1 AND ${dateCondition}
       ORDER BY datetime DESC
       LIMIT 20`,
      params
    );

    const meals = mealsResult.rows.map((row: any) => ({
      id: row.id,
      datetime: row.datetime,
      label: row.label,
      items: row.items || [],
    }));

    // Calculate totals from database
    const totalsResult = await pool.query(
      `SELECT
        COALESCE(SUM(total_calories), 0) as calories,
        COALESCE(SUM(total_protein), 0) as protein,
        COALESCE(SUM(total_carbs), 0) as carbs,
        COALESCE(SUM(total_fat), 0) as fat
       FROM hc_meals
       WHERE shopify_customer_id = $1 AND ${dateCondition}`,
      params
    );

    const totals = {
      calories: parseInt(totalsResult.rows[0]?.calories || "0", 10),
      protein: parseInt(totalsResult.rows[0]?.protein || "0", 10),
      carbs: parseInt(totalsResult.rows[0]?.carbs || "0", 10),
      fat: parseInt(totalsResult.rows[0]?.fat || "0", 10),
    };

    const targets = getTargetsForUser(cid);

    return res.json({
      ok: true,
      date: dateParam || isoDateKey(new Date()),
      totals,
      targets,
      recentMeals: meals.slice(0, 8),
    });
  } catch (err: any) {
    console.error("[nutrition][day-summary] error", { reqId, msg: errMessage(err) });
    return res.status(500).json({ ok: false, error: err.message });
  }
});

/* ======================================================================
   GET /api/v1/nutrition/history
   Supports pagination with ?page=1&limit=7
   ====================================================================== */
nutritionRouter.get("/history", (req: Request, res: Response) => {
  const reqId = uuidv4();
  try {
    const cid = getShopifyCustomerId(req);
    if (!cid)
      return res
        .status(400)
        .json({ ok: false, error: "Missing shopifyCustomerId" });

    const daysParam = Number(req.query.days || 7);
    const days = Number.isFinite(daysParam)
      ? Math.max(1, Math.min(90, daysParam))
      : 7;

    // Pagination params
    const page = Math.max(1, parseInt(String(req.query.page || "1"), 10) || 1);
    const limit = Math.min(90, Math.max(1, parseInt(String(req.query.limit || String(days)), 10) || days));

    const meals = getMealsArrayForUser(cid);

    const allDays: Array<{ date: string; totals: any }> = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = isoDateKey(d);

      const dayMealsRaw = meals.filter(
        (m: any) => String(m.datetime || "").slice(0, 10) === key
      );
      const dayMeals = dedupeMeals(dayMealsRaw);

      allDays.push({ date: key, totals: computeTotalsFromMeals(dayMeals) });
    }

    // Apply pagination
    const total = allDays.length;
    const totalPages = Math.ceil(total / limit);
    const offset = (page - 1) * limit;
    const paginatedDays = allDays.slice(offset, offset + limit);

    return res.json({
      ok: true,
      days: paginatedDays,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
    });
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
    if (!cid)
      return res
        .status(400)
        .json({ ok: false, error: "Missing shopifyCustomerId" });

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
   AI: meal-from-text (DETAILED)
   ====================================================================== */
nutritionRouter.post("/ai/meal-from-text", async (req, res) => {
  const reqId = uuidv4();
  try {
    const cid = getShopifyCustomerId(req);
    if (!cid)
      return res
        .status(400)
        .json({ ok: false, error: "Missing shopifyCustomerId" });

    const { text, localTimeIso } = req.body || {};
    if (!text || !String(text).trim()) {
      return res.status(400).json({ ok: false, error: "Missing text" });
    }

    // ===== RAG-ENHANCED PATH =====
    if (USE_RAG) {
      try {
        const { estimate, legacy } = await estimateMealFromTextWithRag(
          String(text),
          { shopifyCustomerId: cid, localTimeIso }
        );

        // Merge legacy format with aiResponse wrapper for full backward compat
        const ragNormalized = {
          label: String(legacy.label || "Meal"),
          mealName: String(legacy.mealName || legacy.name || "Meal"),
          name: String(legacy.mealName || legacy.name || "Meal"),
          calories: int0(legacy.calories),
          protein: int0(legacy.protein),
          carbs: int0(legacy.carbs),
          fat: int0(legacy.fat),
          foods: normalizeFoods(legacy.foods as any),
          healthierSwaps: normalizeSwaps(legacy.healthierSwaps as any),
          confidence: clamp(legacy.confidence, 0, 100),
          explanation: String(estimate.explanation || ""),
          portionNotes: String(estimate.portion_notes || ""),
          meta: { source: "ai_text_rag", autoLogged: false },
        };

        // Build response with RAG-specific fields
        const response = aiResponse(ragNormalized);
        return res.json({
          ...response,
          // RAG-specific fields
          explanation_sources: estimate.explanation_sources || [],
          follow_up_question: estimate.follow_up_question || null,
          rag_enabled: true,
        });
      } catch (ragErr: any) {
        console.warn("[nutrition][ai-text] RAG failed, falling back to direct LLM:", ragErr.message);
        // Fall through to legacy path
      }
    }

    // ===== LEGACY (NON-RAG) PATH =====
    const prompt = [
      "You are a nutrition estimator for meal logging.",
      "Return ONLY valid JSON (no markdown, no commentary).",
      "Required JSON shape:",
      "{",
      '  "label": string,',
      '  "mealName": string,',
      '  "calories": number, "protein": number, "carbs": number, "fat": number,',
      '  "foods": [',
      '    { "name": string, "portion": string, "macros": { "calories": number, "protein": number, "carbs": number, "fat": number }, "notes": string }',
      "  ],",
      '  "healthierSwaps": [',
      '    { "swap": string, "why": string, "macros": { "calories": number, "protein": number, "carbs": number, "fat": number } }',
      "  ],",
      '  "confidence": number,',
      '  "explanation": string',
      "}",
      "Rules:",
      "- If portion sizes are missing, assume common portions and say what you assumed in notes/explanation.",
      "- foods[].macros should roughly sum to the totals.",
      "- healthierSwaps should be 2–5 items, each with WHY (detailed, practical).",
      "- confidence is 0-100.",
      "- explanation should be 2–4 sentences (more detailed than before).",
      "",
      "User description:",
      String(text),
    ].join("\n");

    const r = await openai.chat.completions.create({
      model: MACRO_MODEL,
      temperature: 0.2,
      messages: [{ role: "user", content: prompt }],
    });

    const raw = r.choices?.[0]?.message?.content || "{}";
    const parsed = safeParseJson(raw);

    const foods = normalizeFoods(parsed.foods);
    const swaps = normalizeSwaps(parsed.healthierSwaps ?? parsed.swaps);

    const normalized = {
      label: String(parsed.label || "Meal"),
      mealName: String(parsed.mealName || parsed.name || "Meal"),
      name: String(parsed.mealName || parsed.name || "Meal"), // compat

      calories: int0(parsed.calories),
      protein: int0(parsed.protein),
      carbs: int0(parsed.carbs),
      fat: int0(parsed.fat),

      foods,
      healthierSwaps: swaps,
      confidence: clamp(parsed.confidence, 0, 100),

      explanation: String(parsed.explanation || ""),
      meta: { source: "ai_text", autoLogged: false },
    };

    return res.json({
      ...aiResponse(normalized),
      rag_enabled: false,
    });
  } catch (err: any) {
    console.error("[nutrition][ai-text] error", { reqId, msg: errMessage(err) });
    return res.status(500).json({ ok: false, error: err.message });
  }
});

/* ======================================================================
   AI: meal-from-photo (DETAILED)
   ✅ NEVER AUTO-LOGS
   ✅ Accepts multipart field "image" OR "photo" (no MulterError)
   ====================================================================== */
nutritionRouter.post("/ai/meal-from-photo", uploadImageOrPhoto, handlePhotoFast);
nutritionRouter.post("/ai/photo", uploadImageOrPhoto, handlePhotoFast);
nutritionRouter.post("/ai/photo-estimate", uploadImageOrPhoto, handlePhotoFast);

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

    // Vision pass: identify foods / portions with enhanced prompting for accuracy
    const visionPrompt = [
      "You are an expert nutritionist analyzing a meal photo for calorie tracking.",
      "",
      "STEP 1 - IDENTIFY FOODS:",
      "List every distinct food item visible. Be specific about:",
      "- Protein source and preparation (e.g., 'grilled chicken breast', 'pan-fried salmon fillet')",
      "- Grains/starches (e.g., 'white jasmine rice', 'whole wheat pasta')",
      "- Vegetables and preparation (e.g., 'steamed broccoli', 'roasted carrots')",
      "- Sauces, dressings, oils visible",
      "",
      "STEP 2 - ESTIMATE PORTIONS:",
      "Use visual references to estimate portions accurately:",
      "- Standard dinner plate = 10-11 inches diameter",
      "- Salad plate = 7-8 inches",
      "- Palm of hand = ~3 oz cooked protein",
      "- Fist = ~1 cup of grains/vegetables",
      "- Thumb = ~1 tablespoon of fats/oils",
      "- Standard fork = ~7 inches long",
      "",
      "STEP 3 - COOKING METHOD:",
      "Note if food appears fried, grilled, baked, steamed, or raw (affects calories).",
      "",
      "Return ONLY valid JSON:",
      '{',
      '  "foods": [',
      '    { "name": "string", "portion": "string with unit", "cookingMethod": "string" }',
      '  ],',
      '  "portionNotes": "detailed portion breakdown string",',
      '  "clarity": 0-100,',
      '  "plateSize": "dinner|salad|bowl|unknown"',
      '}',
      "",
      "Example:",
      '{',
      '  "foods": [',
      '    { "name": "grilled chicken breast", "portion": "5 oz", "cookingMethod": "grilled" },',
      '    { "name": "white rice", "portion": "1.5 cups", "cookingMethod": "steamed" },',
      '    { "name": "steamed broccoli", "portion": "1 cup", "cookingMethod": "steamed" }',
      '  ],',
      '  "portionNotes": "Chicken appears to cover about 1/4 of a standard dinner plate, rice takes up 1/3, vegetables fill the remaining space",',
      '  "clarity": 85,',
      '  "plateSize": "dinner"',
      '}',
    ].join("\n");

    const vision = await openai.chat.completions.create({
      model: VISION_MODEL,
      temperature: 0.2,
      messages: [
        { role: "user", content: visionPrompt },
        {
          role: "user",
          // @ts-ignore
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

    // Parse enhanced vision response - handle both new format (array of objects) and legacy (array of strings)
    const rawFoods = Array.isArray(visionParsed.foods) ? visionParsed.foods : [];
    const foodsWithDetails = rawFoods.map((f: any) => {
      if (typeof f === "string") {
        return { name: f, portion: "", cookingMethod: "" };
      }
      return {
        name: String(f.name || f),
        portion: String(f.portion || ""),
        cookingMethod: String(f.cookingMethod || ""),
      };
    });

    // Create formatted string for macro prompt
    const foodsList = foodsWithDetails.map((f: any) => f.name);
    const foodsForPrompt = foodsWithDetails.map((f: any) => {
      const parts = [f.name];
      if (f.portion) parts.push(`(${f.portion})`);
      if (f.cookingMethod) parts.push(`- ${f.cookingMethod}`);
      return parts.join(" ");
    });

    const portionNotes = String(visionParsed.portionNotes || "");
    const clarity = Math.max(0, Math.min(100, Number(visionParsed.clarity) || 0));
    const plateSize = String(visionParsed.plateSize || "unknown");

    // Generate image hash for RAG logging
    const imageHash = crypto.createHash("sha256").update(processed).digest("hex").slice(0, 16);

    // ===== RAG-ENHANCED PATH =====
    if (USE_RAG) {
      try {
        const { estimate, legacy } = await estimateMealFromPhotoWithRag(
          {
            foods: foodsList,
            portions: portionNotes,
            clarity,
            description: `${foodsList.join(", ")}. ${portionNotes}`,
          },
          { shopifyCustomerId: cid, imageHash }
        );

        // Merge legacy format with aiResponse wrapper for full backward compat
        const ragNormalized = {
          label: String((req.body as any)?.label || legacy.label || "Meal"),
          mealName: String(legacy.mealName || legacy.name || "Meal"),
          name: String(legacy.mealName || legacy.name || "Meal"),
          calories: int0(legacy.calories),
          protein: int0(legacy.protein),
          carbs: int0(legacy.carbs),
          fat: int0(legacy.fat),
          foods: normalizeFoods(legacy.foods as any),
          portionNotes: String(estimate.portion_notes || portionNotes),
          healthierSwaps: normalizeSwaps(legacy.healthierSwaps as any),
          confidence: clamp(legacy.confidence, 0, 100),
          explanation: String(estimate.explanation || ""),
          meta: { source: "ai_photo_rag", clarity, autoLogged: false },
        };

        console.log("[nutrition][ai-photo] RAG ok", {
          reqId,
          ms: nowMs() - t0,
          cid,
          rag: true,
          fieldUsed: (req as any).files?.image?.length ? "image" : "photo",
        });

        // Build response with RAG-specific fields
        const response = aiResponse(ragNormalized);
        return res.json({
          ...response,
          // RAG-specific fields
          explanation_sources: estimate.explanation_sources || [],
          follow_up_question: estimate.follow_up_question || null,
          rag_enabled: true,
        });
      } catch (ragErr: any) {
        console.warn("[nutrition][ai-photo] RAG failed, falling back to direct LLM:", ragErr.message);
        // Fall through to legacy path
      }
    }

    // ===== LEGACY (NON-RAG) PATH =====
    const macroPrompt = [
      "You are an expert nutritionist estimating macros for a meal photo.",
      "",
      "FOOD ITEMS IDENTIFIED:",
      ...foodsForPrompt.map((f: string, i: number) => `${i + 1}. ${f}`),
      "",
      `PORTION NOTES: ${portionNotes}`,
      `PLATE SIZE: ${plateSize}`,
      `PHOTO CLARITY: ${clarity}/100`,
      "",
      "INSTRUCTIONS:",
      "1. Use USDA nutrition data as reference for macro calculations",
      "2. Account for cooking method (fried adds ~50-100 cal from oil, grilled adds minimal)",
      "3. Be precise with portions - use the portion sizes provided",
      "4. Include visible sauces/dressings/oils (often 100-200 cal overlooked)",
      "",
      "Return ONLY valid JSON (no markdown):",
      "{",
      '  "mealName": "descriptive name for the meal",',
      '  "calories": number,',
      '  "protein": number,',
      '  "carbs": number,',
      '  "fat": number,',
      '  "foods": [',
      '    {',
      '      "name": "food name",',
      '      "portion": "amount with unit",',
      '      "macros": { "calories": number, "protein": number, "carbs": number, "fat": number },',
      '      "notes": "any relevant notes about preparation"',
      '    }',
      '  ],',
      '  "healthierSwaps": [',
      '    {',
      '      "swap": "swap suggestion",',
      '      "why": "detailed explanation of benefits",',
      '      "macros": { "calories": number, "protein": number, "carbs": number, "fat": number }',
      '    }',
      '  ],',
      '  "confidence": 0-100,',
      '  "explanation": "2-4 sentences explaining your estimation methodology"',
      "}",
      "",
      "RULES:",
      "- foods[].macros MUST sum to match the totals (calories, protein, carbs, fat)",
      "- healthierSwaps: 2-5 items with specific calorie/macro savings",
      `- If photo clarity is low (${clarity}<60), be more conservative with estimates`,
      "- Include any hidden calories (oils, sauces, butter) you can reasonably assume",
    ].join("\n");

    const macro = await openai.chat.completions.create({
      model: MACRO_MODEL,
      temperature: 0.2,
      messages: [{ role: "user", content: macroPrompt }],
    });

    const macroRaw = macro.choices?.[0]?.message?.content || "{}";
    const macroParsed = safeParseJson(macroRaw);

    const foods = normalizeFoods(macroParsed.foods);
    const swaps = normalizeSwaps(macroParsed.healthierSwaps ?? macroParsed.swaps);

    const calories = int0(macroParsed.calories);
    const protein = int0(macroParsed.protein);
    const carbs = int0(macroParsed.carbs);
    const fat = int0(macroParsed.fat);
    const confidence = clamp(macroParsed.confidence, 0, 100);

    // Add ranges for low-confidence estimates (< 70%)
    const ranges = confidence < 70 ? {
      calories: { min: Math.round(calories * 0.8), max: Math.round(calories * 1.2) },
      protein: { min: Math.round(protein * 0.85), max: Math.round(protein * 1.15) },
      carbs: { min: Math.round(carbs * 0.8), max: Math.round(carbs * 1.2) },
      fat: { min: Math.round(fat * 0.75), max: Math.round(fat * 1.25) },
    } : null;

    const normalized = {
      label: String((req.body as any)?.label || "Meal"),
      mealName: String(macroParsed.mealName || macroParsed.name || "Meal"),
      name: String(macroParsed.mealName || macroParsed.name || "Meal"), // compat

      calories,
      protein,
      carbs,
      fat,

      foods: foods.length ? foods : foodsList.map((f: string) => ({ name: f, calories: 0, protein: 0, carbs: 0, fat: 0 })),
      portionNotes,
      healthierSwaps: swaps,

      explanation: String(macroParsed.explanation || ""),
      confidence,
      ranges, // Include ranges for low-confidence estimates
      meta: { source: "ai_photo", clarity, plateSize, autoLogged: false },
    };

    console.log("[nutrition][ai-photo] ok", {
      reqId,
      ms: nowMs() - t0,
      cid,
      visionModel: VISION_MODEL,
      macroModel: MACRO_MODEL,
      clarity,
      confidence,
      hasRanges: !!ranges,
      fieldUsed: (req as any).files?.image?.length ? "image" : "photo",
    });

    // ✅ NEVER auto-log
    return res.json({
      ...aiResponse(normalized),
      ranges,
      rag_enabled: false,
    });
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
    if (!cid)
      return res
        .status(400)
        .json({ ok: false, error: "Missing shopifyCustomerId" });

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
