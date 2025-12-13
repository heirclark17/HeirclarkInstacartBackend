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
} from "../utils/services/nutritionService"; // 👈 fixed path
import { computeStreak } from "../services/streakService";
import { estimateMealFromText } from "../services/aiNutritionService"; // 👈 NEW

export const nutritionRouter = Router();

/**
 * POST /api/v1/nutrition/meal
 * Logs a full meal with one or more items into the in-memory store.
 *
 * Accepts EITHER:
 *  A) {
 *       datetime?: string,
 *       label?: string,
 *       items: NutritionItem[]
 *     }
 *
 *  OR (single-item convenience):
 *  B) {
 *       datetime?: string,
 *       label?: string,
 *       name: string,
 *       calories: number,
 *       protein?: number,
 *       carbs?: number,
 *       fat?: number,
 *       fiber?: number,
 *       sugar?: number,
 *       sodium?: number
 *     }
 */
nutritionRouter.post("/meal", (req: Request, res: Response) => {
  try {
    const body = req.body as {
      datetime?: string;
      label?: string;
      items?: NutritionItem[];

      // single-item fallback fields
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

    // ---------- shape-normalisation: items[] OR single item ----------
    let itemsSource: NutritionItem[] | undefined;

    if (Array.isArray(body.items) && body.items.length > 0) {
      // normal multi-item shape
      itemsSource = body.items;
    } else if (
      typeof body.name === "string" &&
      body.name.trim() &&
      typeof body.calories !== "undefined"
    ) {
      // single-item convenience shape
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

    // ---------- normalise + validate items ----------
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

        const normalized: NutritionItem = {
          name: item.name.trim(),
          calories: Number(item.calories),
          protein: Number(item.protein ?? 0),
          carbs: Number(item.carbs ?? 0),
          fat: Number(item.fat ?? 0),
          fiber: Number(item.fiber ?? 0),
          sugar: Number(item.sugar ?? 0),
          sodium: Number(item.sodium ?? 0),
        };

        return normalized;
      }
    );

    const iso = datetime
      ? new Date(datetime).toISOString()
      : new Date().toISOString();

    // Build a Meal (without userId; addMealForUser will attach it)
    const meal: Omit<Meal, "userId"> = {
      id: uuidv4(),
      datetime: iso,
      label,
      items: normalizedItems,
    };

    // Log against the current user in memoryStore
    addMealForUser(memoryStore.userId, meal);

    return res.status(201).json({
      ok: true,
      meal,
    });
  } catch (err: any) {
    console.error("Error in POST /api/v1/nutrition/meal:", err);
    return res.status(500).json({
      ok: false,
      error: err?.message || "Failed to log meal",
    });
  }
});

/**
 * POST /api/v1/nutrition/ai/meal-from-text
 *
 * Body:
 * {
 *   text: string;          // user description of the meal
 *   localTimeIso?: string; // optional local time ISO; helps pick B/L/D/S
 * }
 *
 * Response:
 * {
 *   ok: true,
 *   calories: number,
 *   protein: number,
 *   carbs: number,
 *   fat: number,
 *   label: "Breakfast" | "Lunch" | "Dinner" | "Snack" | null,
 *   mealName: string,
 *   explanation: string
 * }
 */
nutritionRouter.post(
  "/ai/meal-from-text",
  async (req: Request, res: Response) => {
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
  }
);

/**
 * Helper: look up a product by barcode using Open Food Facts
 * and normalize to a simple macro object.
 */
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

  // NOTE: relies on global fetch (Node 18+). For older Node, add your own fetch implementation.
  const resp = await fetch(url);
  if (!resp.ok) {
    console.warn(
      "[lookupBarcodeOpenFoodFacts] Non-200 from OFF:",
      resp.status
    );
    return null;
  }

  const data: any = await resp.json().catch(() => null);
  if (!data || data.status !== 1 || !data.product) {
    // status === 0 → product not found
    return null;
  }

  const product = data.product;
  const nutr = product.nutriments || {};

  // Prefer per serving if available, fall back to per 100g
  const caloriesRaw =
    nutr["energy-kcal_serving"] ??
    nutr["energy-kcal_100g"] ??
    nutr["energy-kcal"] ??
    null;
  const proteinRaw =
    nutr["proteins_serving"] ?? nutr["proteins_100g"] ?? null;
  const carbsRaw =
    nutr["carbohydrates_serving"] ?? nutr["carbohydrates_100g"] ?? null;
  const fatRaw =
    nutr["fat_serving"] ?? nutr["fat_100g"] ?? null;

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
 * GET /api/v1/nutrition/lookup-barcode?code=1234567890
 *
 * Used by the barcode scanner on the calorie counter page.
 * Returns a flattened macro response:
 * {
 *   ok: true,
 *   code: string,
 *   source: "openfoodfacts",
 *   name: string,
 *   calories: number,
 *   protein: number,
 *   carbs: number,
 *   fat: number
 * }
 */
nutritionRouter.get(
  "/lookup-barcode",
  async (req: Request, res: Response) => {
    try {
      const code = (req.query.code as string) || "";

      if (!code || !code.trim()) {
        return res.status(400).json({
          ok: false,
          error: "Missing 'code' query parameter.",
        });
      }

      const result = await lookupBarcodeOpenFoodFacts(code);
      if (!result) {
        return res.status(404).json({
          ok: false,
          code,
          error: "No product found for this barcode.",
        });
      }

      return res.json({
        ok: true,
        code,
        source: "openfoodfacts",
        ...result,
      });
    } catch (err: any) {
      console.error("Error in GET /api/v1/nutrition/lookup-barcode:", err);
      return res.status(500).json({
        ok: false,
        error: err?.message || "Failed to look up barcode.",
      });
    }
  }
);

/**
 * GET /api/v1/nutrition/history
 *
 * Query:
 *  - days?: number (default 7, min 1, max 365)
 *  - end?: YYYY-MM-DD (default today)
 *  - shopifyCustomerId?: string (optional now; falls back to memoryStore.userId)
 *
 * Response:
 *  {
 *    ok: true,
 *    range: { start, end },
 *    days: [
 *      {
 *        date: "YYYY-MM-DD",
 *        totals: { calories, protein, carbs, fat, fiber, sugar, sodium },
 *        targets: { calories, protein, carbs, fat, fiber, sugar, sodium },
 *        meals: number
 *      }
 *    ]
 *  }
 *
 * Notes:
 * - Zero-fills days with no meals (important for charts).
 * - Uses your existing nutritionService helpers.
 */
nutritionRouter.get("/history", (req: Request, res: Response) => {
  try {
    // ---------------------------
    // Small local helpers
    // ---------------------------
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
      if (
        d.getFullYear() !== y ||
        d.getMonth() !== mo - 1 ||
        d.getDate() !== da
      ) {
        return null;
      }
      return d;
    };

    const addDays = (date: Date, delta: number) => {
      const d = new Date(date);
      d.setDate(d.getDate() + delta);
      return d;
    };

    const userId =
      (req.query.shopifyCustomerId
        ? String(req.query.shopifyCustomerId)
        : "")?.trim() || memoryStore.userId;

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
      totals: {
        calories: number;
        protein: number;
        carbs: number;
        fat: number;
        fiber: number;
        sugar: number;
        sodium: number;
      };
      targets: any;
      meals: number;
    }> = [];

    for (let i = 0; i < days; i++) {
      const d = addDays(startDate, i);
      const dateStr = formatDateOnly(d);

      // IMPORTANT: your getMealsForDate signature differs in some places.
      // We'll try (userId, date) first; if it throws, fall back to (date).
      let mealsForDay: Meal[] = [];
      try {
        mealsForDay = (getMealsForDate as any)(userId, dateStr) || [];
      } catch {
        mealsForDay = (getMealsForDate as any)(dateStr) || [];
      }

      // Totals: try computeDailyTotals(meals[]) first; if your older helper expects a date, fallback.
      let totalsAny: any = null;
      try {
        totalsAny = (computeDailyTotals as any)(mealsForDay);
      } catch {
        totalsAny = (computeDailyTotals as any)(dateStr);
      }
      totalsAny = totalsAny || {};

      // Targets: try per-user targets; fallback to global targets.
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

// GET /api/v1/nutrition/day-summary?date=YYYY-MM-DD
nutritionRouter.get("/day-summary", (req: Request, res: Response) => {
  const date = (req.query.date as string) || todayDateOnly();

  const targets = getStaticDailyTargets();
  const consumed = computeDailyTotals(date);
  const remaining = computeRemaining(targets, consumed);
  const meals = getMealsForDate(date);
  const streak = computeStreak();

  // Placeholder health score until AI is added
  const healthScore =
    consumed.calories === 0
      ? null
      : Math.min(100, Math.max(40, 100 - remaining.sugar / 2));

  res.json({
    ok: true, // 👈 added for consistency with other APIs
    date,
    targets,
    consumed,
    remaining,
    healthScore,
    streak,
    recentMeals: meals
      .slice()
      .sort((a: Meal, b: Meal) => (a.datetime < b.datetime ? 1 : -1))
      .slice(0, 5),
  });
});

/**
 * DELETE /api/v1/nutrition/reset-day
 *
 * Clears all logged meals for the given date (or today by default)
 * for the current in-memory user. Used by the "Reset the day" button.
 *
 * Optional query:
 *   ?date=YYYY-MM-DD   – if not provided, today is used.
 */
nutritionRouter.delete("/reset-day", (req: Request, res: Response) => {
  try {
    const date = (req.query.date as string) || todayDateOnly();
    const userId = memoryStore.userId;

    // We assume memoryStore keeps a flat array of meals for the user.
    // Filter out any meals that belong to this user AND fall on the given date.
    if (!Array.isArray((memoryStore as any).meals)) {
      console.warn(
        "[nutrition.reset-day] memoryStore.meals is not an array – nothing to clear."
      );
      return res.status(200).json({
        ok: true,
        date,
        removedMeals: 0,
        message: "Nothing to clear for this date.",
      });
    }

    const allMeals = (memoryStore as any).meals as Meal[];
    const beforeCount = allMeals.length;

    const keptMeals = allMeals.filter((m: Meal) => {
      // Different user? keep
      if (m.userId !== userId) return true;

      // Compare only the date portion of datetime
      const mealDate = m.datetime.slice(0, 10); // "YYYY-MM-DD"
      return mealDate !== date;
    });

    (memoryStore as any).meals = keptMeals;

    const removedMeals = beforeCount - keptMeals.length;

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
