import { Router, Request, Response } from "express";
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

export const nutritionRouter = Router();

console.log("[nutrition] routes loaded:", {
  hasHistory: true,
  build: process.env.RAILWAY_GIT_COMMIT_SHA || process.env.GIT_SHA || "unknown",
});

/* ======================================================================
   POST /api/v1/nutrition/meal
   Accepts:
   - items[] form OR single-item convenience fields
   ====================================================================== */
nutritionRouter.post("/meal", (req: Request, res: Response) => {
  try {
    const body = req.body as {
      datetime?: string;
      label?: string;
      items?: NutritionItem[];

      name?: string;
      calories?: number;
      protein?: number;
      carbs?: number;
      fat?: number;
      fiber?: number;
      sugar?: number;
      sodium?: number;
    };

    const { datetime, label } = body;

    let itemsSource: NutritionItem[] | undefined;

    if (Array.isArray(body.items) && body.items.length > 0) {
      itemsSource = body.items;
    } else if (
      typeof body.name === "string" &&
      body.name.trim() &&
      typeof body.calories !== "undefined"
    ) {
      itemsSource = [
        {
          name: body.name,
          calories: Number(body.calories),
          protein: body.protein,
          carbs: body.carbs,
          fat: body.fat,
          fiber: body.fiber,
          sugar: body.sugar,
          sodium: body.sodium,
        } as NutritionItem,
      ];
    }

    if (!Array.isArray(itemsSource) || itemsSource.length === 0) {
      return res.status(400).json({
        ok: false,
        error:
          "items is required (array) OR provide name + calories for a single item.",
      });
    }

    const normalizedItems: NutritionItem[] = itemsSource.map(
      (item: NutritionItem, idx: number) => {
        if (!item || typeof item.name !== "string") {
          throw new Error(`items[${idx}].name is required (string)`);
        }
        if (
          typeof item.calories !== "number" ||
          !Number.isFinite(item.calories)
        ) {
          throw new Error(`items[${idx}].calories is required (number)`);
        }

        return {
          name: item.name.trim(),
          calories: Number(item.calories),
          protein: Number(item.protein ?? 0),
          carbs: Number(item.carbs ?? 0),
          fat: Number(item.fat ?? 0),
          fiber: Number(item.fiber ?? 0),
          sugar: Number(item.sugar ?? 0),
          sodium: Number(item.sodium ?? 0),
        };
      }
    );

    const iso = datetime
      ? new Date(datetime).toISOString()
      : new Date().toISOString();

    const meal: Omit<Meal, "userId"> = {
      id: uuidv4(),
      datetime: iso,
      label,
      items: normalizedItems,
    };

    addMealForUser(memoryStore.userId, meal);

    return res.status(201).json({ ok: true, meal });
  } catch (err: any) {
    console.error("Error in POST /api/v1/nutrition/meal:", err);
    return res.status(500).json({
      ok: false,
      error: err?.message || "Failed to log meal",
    });
  }
});

/* ======================================================================
   POST /api/v1/nutrition/ai/meal-from-text
   ====================================================================== */
nutritionRouter.post("/ai/meal-from-text", async (req: Request, res: Response) => {
  try {
    const { text, localTimeIso } = req.body || {};

    if (!text || typeof text !== "string") {
      return res.status(400).json({
        ok: false,
        error: "Missing or invalid 'text' in request body.",
      });
    }

    const estimate = await estimateMealFromText(text, localTimeIso);

    return res.json({
      ok: true,
      ...estimate,
    });
  } catch (err: any) {
    console.error("Error in POST /api/v1/nutrition/ai/meal-from-text:", err);
    return res.status(500).json({
      ok: false,
      error: err?.message || "Failed to generate meal estimate.",
    });
  }
});

/* ======================================================================
   Barcode Lookup (Open Food Facts)
   - NEW: POST /barcode/lookup (what your frontend expects)
   - Keep: GET /lookup-barcode?code=... for backward compatibility
   ====================================================================== */

async function lookupBarcodeOpenFoodFacts(barcode: string): Promise<{
  name: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
} | null> {
  const trimmed = (barcode || "").trim();
  if (!trimmed) return null;

  const url = `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(
    trimmed
  )}.json`;

  const resp = await fetch(url);
  if (!resp.ok) return null;

  const data: any = await resp.json().catch(() => null);
  if (!data || data.status !== 1 || !data.product) return null;

  const product = data.product;
  const nutr = product.nutriments || {};

  const caloriesRaw =
    nutr["energy-kcal_serving"] ??
    nutr["energy-kcal_100g"] ??
    nutr["energy-kcal"] ??
    null;

  const proteinRaw = nutr["proteins_serving"] ?? nutr["proteins_100g"] ?? null;
  const carbsRaw =
    nutr["carbohydrates_serving"] ?? nutr["carbohydrates_100g"] ?? null;
  const fatRaw = nutr["fat_serving"] ?? nutr["fat_100g"] ?? null;

  const name: string =
    product.product_name ||
    product.generic_name ||
    (product.brands
      ? `${product.brands} ${product.product_name || ""}`.trim()
      : "Unknown product");

  const toNum = (v: any): number => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };

  return {
    name,
    calories: toNum(caloriesRaw),
    protein: toNum(proteinRaw),
    carbs: toNum(carbsRaw),
    fat: toNum(fatRaw),
  };
}

/**
 * ✅ NEW (frontend-friendly):
 * POST /api/v1/nutrition/barcode/lookup
 * Body: { barcode: string }
 */
nutritionRouter.post("/barcode/lookup", async (req: Request, res: Response) => {
  try {
    const barcode = String(req.body?.barcode || "").trim();
    if (!barcode) {
      return res.status(400).json({ ok: false, error: "Missing 'barcode' in body." });
    }

    const result = await lookupBarcodeOpenFoodFacts(barcode);
    if (!result) {
      return res.status(404).json({ ok: false, error: "No product found for this barcode." });
    }

    return res.json({ ok: true, ...result });
  } catch (err: any) {
    console.error("Error in POST /api/v1/nutrition/barcode/lookup:", err);
    return res.status(500).json({ ok: false, error: err?.message || "Barcode lookup failed." });
  }
});

/**
 * Legacy:
 * GET /api/v1/nutrition/lookup-barcode?code=123
 */
nutritionRouter.get("/lookup-barcode", async (req: Request, res: Response) => {
  try {
    const code = String(req.query.code || "").trim();
    if (!code) {
      return res.status(400).json({ ok: false, error: "Missing 'code' query parameter." });
    }

    const result = await lookupBarcodeOpenFoodFacts(code);
    if (!result) {
      return res.status(404).json({ ok: false, code, error: "No product found for this barcode." });
    }

    return res.json({
      ok: true,
      code,
      source: "openfoodfacts",
      ...result,
    });
  } catch (err: any) {
    console.error("Error in GET /api/v1/nutrition/lookup-barcode:", err);
    return res.status(500).json({ ok: false, error: err?.message || "Failed to look up barcode." });
  }
});

/* ======================================================================
   GET /api/v1/nutrition/history
   (unchanged logic; good as-is)
   ====================================================================== */
nutritionRouter.get("/history", (req: Request, res: Response) => {
  try {
    const clampInt = (v: any, def: number, min: number, max: number) => {
      const n = Number(v);
      if (!Number.isFinite(n)) return def;
      const i = Math.floor(n);
      return Math.max(min, Math.min(max, i));
    };

    const pad2 = (n: number) => String(n).padStart(2, "0");
    const formatDateOnly = (d: Date) =>
      `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

    const parseDateOnly = (s: string): Date | null => {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || "").trim());
      if (!m) return null;

      const y = Number(m[1]);
      const mo = Number(m[2]);
      const da = Number(m[3]);
      if (!y || mo < 1 || mo > 12 || da < 1 || da > 31) return null;

      const d = new Date(y, mo - 1, da);
      if (d.getFullYear() !== y || d.getMonth() !== mo - 1 || d.getDate() !== da) return null;
      return d;
    };

    const addDays = (date: Date, delta: number) => {
      const d = new Date(date);
      d.setDate(d.getDate() + delta);
      return d;
    };

    const userId =
      (req.query.shopifyCustomerId ? String(req.query.shopifyCustomerId) : "")?.trim() ||
      memoryStore.userId;

    const days = clampInt(req.query.days, 7, 1, 365);

    const endStrRaw =
      typeof req.query.end === "string" ? String(req.query.end).trim() : "";
    const endStr = endStrRaw || todayDateOnly();

    const endDate = parseDateOnly(endStr);
    if (!endDate) {
      return res.status(400).json({
        ok: false,
        error: "Invalid 'end' date. Expected YYYY-MM-DD.",
      });
    }

    const startDate = addDays(endDate, -(days - 1));
    const startStr = formatDateOnly(startDate);
    const endOutStr = formatDateOnly(endDate);

    const outDays: Array<{
      date: string;
      totals: any;
      targets: any;
      meals: number;
    }> = [];

    for (let i = 0; i < days; i++) {
      const d = addDays(startDate, i);
      const dateStr = formatDateOnly(d);

      let mealsForDay: Meal[] = [];
      try {
        mealsForDay = (getMealsForDate as any)(userId, dateStr) || [];
      } catch {
        mealsForDay = (getMealsForDate as any)(dateStr) || [];
      }

      let totalsAny: any = null;
      try {
        totalsAny = (computeDailyTotals as any)(mealsForDay);
      } catch {
        totalsAny = (computeDailyTotals as any)(dateStr);
      }
      totalsAny = totalsAny || {};

      let targetsAny: any = null;
      try {
        targetsAny = (getStaticDailyTargets as any)(userId);
      } catch {
        targetsAny = (getStaticDailyTargets as any)();
      }
      targetsAny = targetsAny || {};

      outDays.push({
        date: dateStr,
        totals: {
          calories: Number(totalsAny.calories ?? 0) || 0,
          protein: Number(totalsAny.protein ?? 0) || 0,
          carbs: Number(totalsAny.carbs ?? 0) || 0,
          fat: Number(totalsAny.fat ?? 0) || 0,
          fiber: Number(totalsAny.fiber ?? 0) || 0,
          sugar: Number(totalsAny.sugar ?? 0) || 0,
          sodium: Number(totalsAny.sodium ?? 0) || 0,
        },
        targets: {
          calories: Number(targetsAny.calories ?? 0) || 0,
          protein: Number(targetsAny.protein ?? 0) || 0,
          carbs: Number(targetsAny.carbs ?? 0) || 0,
          fat: Number(targetsAny.fat ?? 0) || 0,
          fiber: Number(targetsAny.fiber ?? 0) || 0,
          sugar: Number(targetsAny.sugar ?? 0) || 0,
          sodium: Number(targetsAny.sodium ?? 0) || 0,
        },
        meals: Array.isArray(mealsForDay) ? mealsForDay.length : 0,
      });
    }

    return res.json({
      ok: true,
      range: { start: startStr, end: endOutStr },
      days: outDays,
    });
  } catch (err: any) {
    console.error("Error in GET /api/v1/nutrition/history:", err);
    return res.status(500).json({
      ok: false,
      error: err?.message || "Failed to load history",
    });
  }
});

/* ======================================================================
   Day summary (frontend-friendly aliases added)
   ====================================================================== */
nutritionRouter.get("/day-summary", (req: Request, res: Response) => {
  const date = (req.query.date as string) || todayDateOnly();

  const userId =
    (req.query.shopifyCustomerId ? String(req.query.shopifyCustomerId) : "")?.trim() ||
    memoryStore.userId;

  const targets: any = (() => {
    try {
      return (getStaticDailyTargets as any)(userId);
    } catch {
      return (getStaticDailyTargets as any)();
    }
  })();

  const meals: Meal[] = (() => {
    try {
      return (getMealsForDate as any)(userId, date) || [];
    } catch {
      return (getMealsForDate as any)(date) || [];
    }
  })();

  const consumed: any = (() => {
    try {
      return (computeDailyTotals as any)(meals);
    } catch {
      return (computeDailyTotals as any)(date);
    }
  })();

  const remaining = computeRemaining(targets, consumed);
  const streak = computeStreak();

  const healthScore =
    consumed.calories === 0
      ? null
      : Math.min(100, Math.max(40, 100 - remaining.sugar / 2));

  res.json({
    ok: true,
    date,

    // canonical keys
    targets,
    consumed,

    // ✅ frontend-friendly aliases
    totals: consumed,
    dayStreak: streak,

    remaining,
    healthScore,
    streak,

    recentMeals: meals
      .slice()
      .sort((a: Meal, b: Meal) => (a.datetime < b.datetime ? 1 : -1))
      .slice(0, 5),
  });
});

/* ======================================================================
   Reset Day (frontend expects POST /day/reset)
   Your existing endpoint was DELETE /reset-day
   We support BOTH.
   ====================================================================== */

function resetDayInternal(date: string) {
  const userId = memoryStore.userId;

  if (!Array.isArray((memoryStore as any).meals)) {
    return { removedMeals: 0 };
  }

  const allMeals = (memoryStore as any).meals as Meal[];
  const beforeCount = allMeals.length;

  const keptMeals = allMeals.filter((m: Meal) => {
    if (m.userId !== userId) return true;
    const mealDate = m.datetime.slice(0, 10);
    return mealDate !== date;
  });

  (memoryStore as any).meals = keptMeals;

  return { removedMeals: beforeCount - keptMeals.length };
}

// Legacy + compatible
nutritionRouter.delete("/reset-day", (req: Request, res: Response) => {
  try {
    const date = (req.query.date as string) || todayDateOnly();
    const { removedMeals } = resetDayInternal(date);
    return res.status(200).json({
      ok: true,
      date,
      removedMeals,
      message: `Cleared ${removedMeals} meal(s) for ${date}.`,
    });
  } catch (err: any) {
    console.error("Error in DELETE /api/v1/nutrition/reset-day:", err);
    return res.status(500).json({
      ok: false,
      error: err?.message || "Failed to reset day",
    });
  }
});

// ✅ Frontend-friendly alias
nutritionRouter.post("/day/reset", (req: Request, res: Response) => {
  try {
    const date = (req.body?.date as string) || todayDateOnly();
    const { removedMeals } = resetDayInternal(date);
    return res.status(200).json({
      ok: true,
      date,
      removedMeals,
      message: `Cleared ${removedMeals} meal(s) for ${date}.`,
    });
  } catch (err: any) {
    console.error("Error in POST /api/v1/nutrition/day/reset:", err);
    return res.status(500).json({
      ok: false,
      error: err?.message || "Failed to reset day",
    });
  }
});
