import { Router, Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";

const nutritionRouter = Router();
export { nutritionRouter };
export default nutritionRouter;

/* ======================================================================
   Memory store (matches your pattern)
   ====================================================================== */
const memoryStore: any = (global as any).memoryStore || ((global as any).memoryStore = {});
memoryStore.mealsByUser = memoryStore.mealsByUser || {};

/* ======================================================================
   Helpers
   ====================================================================== */
function errMessage(e: any) {
  return e?.message || String(e);
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

function getTargetsForUser(_cid: string) {
  // keep whatever your app expects; safe defaults
  return { calories: 0, protein: 0, carbs: 0, fat: 0 };
}

/* ======================================================================
   ✅ GET /api/v1/nutrition/meals  (plural - what frontend is calling)
   ✅ GET /api/v1/nutrition/meal   (singular legacy alias)
   ====================================================================== */
function handleGetMeals(req: Request, res: Response) {
  const reqId = uuidv4();
  try {
    const cid = getShopifyCustomerId(req);
    if (!cid) return res.status(400).json({ ok: false, error: "Missing shopifyCustomerId" });

    const meals = getMealsArrayForUser(cid);
    return res.json({ ok: true, meals: dedupeMeals(meals) });
  } catch (err: any) {
    console.error("[nutrition][meals GET] error", { reqId, msg: errMessage(err) });
    return res.status(500).json({ ok: false, error: err.message });
  }
}

nutritionRouter.get("/meals", handleGetMeals);
nutritionRouter.get("/meal", handleGetMeals);

/* ======================================================================
   ✅ POST /api/v1/nutrition/meals (plural)
   ✅ POST /api/v1/nutrition/meal  (singular legacy)
   ====================================================================== */
function handlePostMeal(req: Request, res: Response) {
  const reqId = uuidv4();
  try {
    const cid = getShopifyCustomerId(req);
    if (!cid) return res.status(400).json({ ok: false, error: "Missing shopifyCustomerId" });

    const body: any = req.body || {};
    const label = body.label ? String(body.label) : undefined;

    // Accept either "items" array OR single macro fields
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
    console.error("[nutrition][meal POST] error", { reqId, msg: errMessage(err) });
    return res.status(500).json({ ok: false, error: err.message });
  }
}

nutritionRouter.post("/meals", handlePostMeal);
nutritionRouter.post("/meal", handlePostMeal);

/* ======================================================================
   ✅ DELETE /api/v1/nutrition/meals/:id (plural)
   ✅ DELETE /api/v1/nutrition/meal/:id  (singular legacy)
   ====================================================================== */
function handleDeleteMeal(req: Request, res: Response) {
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
    console.error("[nutrition][meal DELETE] error", { reqId, msg: errMessage(err) });
    return res.status(500).json({ ok: false, error: err.message });
  }
}

nutritionRouter.delete("/meals/:id", handleDeleteMeal);
nutritionRouter.delete("/meal/:id", handleDeleteMeal);

/* ======================================================================
   ✅ GET /api/v1/nutrition/day-summary
   ====================================================================== */
nutritionRouter.get("/day-summary", (req: Request, res: Response) => {
  const reqId = uuidv4();
  try {
    const cid = getShopifyCustomerId(req);
    if (!cid) return res.status(400).json({ ok: false, error: "Missing shopifyCustomerId" });

    const meals = getMealsArrayForUser(cid);

    // optional date param support (frontend sends date sometimes)
    const dateStr = String(req.query.date || "").trim();
    const dayKey = dateStr ? dateStr.slice(0, 10) : isoDateKey(new Date());

    const todaysMealsRaw = meals.filter((m: any) => String(m.datetime || "").slice(0, 10) === dayKey);
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
   ✅ GET /api/v1/nutrition/history
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
   ✅ POST /api/v1/nutrition/day/reset
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
