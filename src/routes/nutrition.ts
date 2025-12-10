import { Router, Request, Response } from "express";
import { todayDateOnly } from "../utils/date";
import {
  computeDailyTotals,
  computeRemaining,
  getMealsForDate,
  getStaticDailyTargets,
  // new imports from your nutritionService
  memoryStore,
  addMealForUser,
  Meal,
  NutritionItem
} from "../services/nutritionService";
import { computeStreak } from "../services/streakService";

export const nutritionRouter = Router();

/**
 * POST /api/v1/nutrition/meal
 * Logs a full meal with one or more items into the in-memory store.
 *
 * Body:
 * {
 *   datetime?: string,             // ISO datetime; defaults to now
 *   label?: string,                // "Breakfast", "Lunch", "Snack"
 *   items: Array<{
 *     name: string;
 *     calories: number;
 *     protein?: number;
 *     carbs?: number;
 *     fat?: number;
 *     fiber?: number;
 *     sugar?: number;
 *     sodium?: number;
 *   }>
 * }
 */
nutritionRouter.post("/meal", (req: Request, res: Response) => {
  try {
    const {
      datetime,
      label,
      items
    }: {
      datetime?: string;
      label?: string;
      items?: NutritionItem[];
    } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        ok: false,
        error: "items is required and must be a non-empty array"
      });
    }

    // Normalize + validate items
    const normalizedItems: NutritionItem[] = items.map((item, idx) => {
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
        calories: item.calories,
        protein: item.protein ?? 0,
        carbs: item.carbs ?? 0,
        fat: item.fat ?? 0,
        fiber: item.fiber ?? 0,
        sugar: item.sugar ?? 0,
        sodium: item.sodium ?? 0
      };
    });

    const iso = datetime
      ? new Date(datetime).toISOString()
      : new Date().toISOString();

    // Build a Meal (without userId; addMealForUser will attach it)
    const meal: Omit<Meal, "userId"> = {
      id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}`,
      datetime: iso,
      label,
      items: normalizedItems
    };

    // Log against the current user in memoryStore
    addMealForUser(memoryStore.userId, meal);

    return res.status(201).json({
      ok: true,
      meal
    });
  } catch (err: any) {
    console.error("Error in POST /api/v1/nutrition/meal:", err);
    return res.status(500).json({
      ok: false,
      error: err?.message || "Failed to log meal"
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
    date,
    targets,
    consumed,
    remaining,
    healthScore,
    streak,
    recentMeals: meals
      .slice()
      .sort((a: Meal, b: Meal) =>
        a.datetime < b.datetime ? 1 : -1
      )
      .slice(0, 5)
  });
});
