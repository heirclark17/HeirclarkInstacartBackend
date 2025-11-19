// src/services/mealPlanner.ts

import {
  UserConstraints,
  WeekPlan,
  DayPlan,
  Meal,
} from "../types/mealPlan";

/**
 * Helper to build a single day's meals from constraints.
 * This is ONLY used for local/static fallback (when OpenAI is not used).
 */
function buildDay(
  dayIndex: number,
  constraints: UserConstraints
): DayPlan {
  const dailyCalories = constraints.dailyCalories || 0;
  const protein = constraints.proteinGrams || 0;
  const carbs = constraints.carbsGrams || 0;
  const fats = constraints.fatsGrams || 0;

  const meals: Meal[] = [
    {
      type: "breakfast",
      title: "High-protein breakfast",
      calories: Math.round(dailyCalories * 0.25),
      protein: Math.round(protein * 0.3),
      carbs: Math.round(carbs * 0.25),
      fats: Math.round(fats * 0.25),
      notes: "Fallback breakfast – customize with your favorite foods.",
    },
    {
      type: "lunch",
      title: "Balanced lunch",
      calories: Math.round(dailyCalories * 0.35),
      protein: Math.round(protein * 0.35),
      carbs: Math.round(carbs * 0.35),
      fats: Math.round(fats * 0.35),
      notes: "Fallback lunch – use lean protein, smart carbs, and veggies.",
    },
    {
      type: "dinner",
      title: "Evening plate",
      calories: Math.round(dailyCalories * 0.4),
      protein: Math.round(protein * 0.35),
      carbs: Math.round(carbs * 0.4),
      fats: Math.round(fats * 0.4),
      notes: "Fallback dinner – build a balanced plate for the evening.",
    },
  ];

  return {
    day: dayIndex + 1,
    index: dayIndex,
    label: `Day ${dayIndex + 1}`,
    note:
      "Fallback meal framework — detailed AI recipes were unavailable. Use this as a structure for your own meals.",
    meals,
  };
}

/**
 * Local/static generator – used by buildFallbackWeekPlan in index.ts
 * and for non-AI flows.
 */
export function generateWeekPlan(constraints: UserConstraints): WeekPlan {
  const days: DayPlan[] = Array.from({ length: 7 }).map((_, i) =>
    buildDay(i, constraints)
  );

  return {
    mode: "static", // 👈 important: NOT "ai"
    generatedAt: new Date().toISOString(),
    constraints,
    days,
    // For local fallback we don’t build full recipe objects – frontend
    // will just use the high-level meals.
    recipes: [],
  };
}

/**
 * Adjust an existing WeekPlan based on actual intake deltas.
 * `actualIntake` is keyed by day label or isoDate – very simple example.
 */
export function adjustWeekPlan(
  weekPlan: WeekPlan,
  actualIntake: Record<string, { caloriesDelta: number }>
): WeekPlan {
  const clone: WeekPlan = {
    ...weekPlan,
    days: weekPlan.days.map((d) => ({ ...d, meals: d.meals.map((m) => ({ ...m })) })),
  };

  clone.days.forEach((day) => {
    const key =
      (day.isoDate as string | undefined) ||
      (day.label as string | undefined) ||
      String(day.day ?? day.index ?? "");

    if (!key || !actualIntake[key]) return;

    const delta = actualIntake[key].caloriesDelta;
    if (!delta) return;

    // Spread the calorie delta evenly across meals as a simple example.
    const perMealDelta = delta / Math.max(day.meals.length, 1);

    day.meals.forEach((meal) => {
      if (typeof meal.calories === "number") {
        meal.calories = Math.round(meal.calories + perMealDelta);
      }
    });
  });

  clone.mode = clone.mode || "static";
  clone.generatedAt = new Date().toISOString();

  return clone;
}

/**
 * Pantry-based fallback. If OpenAI fails for the pantry endpoint,
 * we use a static structure but add pantry info into the notes.
 */
export function generateFromPantry(
  constraints: UserConstraints,
  pantry: string[]
): WeekPlan {
  const base = generateWeekPlan(constraints);

  const pantrySummary =
    pantry && pantry.length
      ? `Pantry items to prioritize: ${pantry.join(", ")}.`
      : "Use whatever pantry items you prefer.";

  const days: DayPlan[] = base.days.map((d) => ({
    ...d,
    note: `${d.note} ${pantrySummary}`,
    meals: d.meals.map((m) => ({
      ...m,
      notes: m.notes
        ? `${m.notes} Try to feature your pantry items in this meal.`
        : "Try to feature your pantry items in this meal.",
    })),
  }));

  return {
    ...base,
    mode: "fallback",
    days,
  };
}
