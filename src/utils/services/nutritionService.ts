import { memoryStore } from "./inMemoryStore";
import {
  DailyNutritionTargets,
  DailyNutritionTotals,
  Meal
} from "../domain/types";
import { toDateOnly } from "../utils/date";

// TODO: later pull from DB/goals table
export function getStaticDailyTargets(): DailyNutritionTargets {
  // You can tune these or calculate from user profile
  return {
    calories: 2200,
    protein: 190,
    carbs: 190,
    fat: 60,
    fiber: 30,
    sugar: 75,
    sodium: 2300
  };
}

export function getMealsForDate(date: string): Meal[] {
  return memoryStore.meals.filter(
    (m) => toDateOnly(m.datetime) === date && m.userId === memoryStore.userId
  );
}

export function computeDailyTotals(date: string): DailyNutritionTotals {
  const meals = getMealsForDate(date);

  const totals: DailyNutritionTotals = {
    calories: 0,
    protein: 0,
    carbs: 0,
    fat: 0,
    fiber: 0,
    sugar: 0,
    sodium: 0
  };

  for (const meal of meals) {
    for (const item of meal.items) {
      totals.calories += item.calories;
      totals.protein += item.protein;
      totals.carbs += item.carbs;
      totals.fat += item.fat;
      totals.fiber += item.fiber ?? 0;
      totals.sugar += item.sugar ?? 0;
      totals.sodium += item.sodium ?? 0;
    }
  }

  return totals;
}

export function computeRemaining(
  targets: DailyNutritionTargets,
  consumed: DailyNutritionTotals
): DailyNutritionTotals {
  return {
    calories: Math.max(targets.calories - consumed.calories, 0),
    protein: Math.max(targets.protein - consumed.protein, 0),
    carbs: Math.max(targets.carbs - consumed.carbs, 0),
    fat: Math.max(targets.fat - consumed.fat, 0),
    fiber: Math.max(targets.fiber - consumed.fiber, 0),
    sugar: Math.max(targets.sugar - consumed.sugar, 0),
    sodium: Math.max(targets.sodium - consumed.sodium, 0)
  };
}
