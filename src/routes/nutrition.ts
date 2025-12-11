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
      .sort((a: Meal, b: Meal) =>
        a.datetime < b.datetime ? 1 : -1
      )
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
