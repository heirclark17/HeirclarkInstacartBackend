// src/services/mealPlanner.ts

import { UserConstraints, WeekPlan } from "../types/mealPlan";

/**
 * Very simple local 7-day framework.
 * This is used as a fallback when AI isn’t available,
 * and also by index.ts’s buildFallbackWeekPlan().
 */
export function generateWeekPlan(constraints: UserConstraints): WeekPlan {
  const startDate = new Date().toISOString().slice(0, 10);

  const days = Array.from({ length: 7 }).map((_, i) => ({
    dayIndex: i,
    label: `Day ${i + 1}`,
    note:
      "Local baseline plan — AI can later override this with specific recipes and macros.",
    meals: [], // your front-end knows how to handle empty meals as a framework
  }));

  // Cast through unknown so TS doesn’t try to enforce every DayPlan field.
  return {
    id: `local-${startDate}`,
    startDate,
    constraints,
    days,
  } as unknown as WeekPlan;
}

/**
 * Adjust plan based on actualIntake.
 * For now, this just returns the same plan – you can add logic later.
 */
export function adjustWeekPlan(
  weekPlan: WeekPlan,
  _actualIntake: Record<string, { caloriesDelta: number }>
): WeekPlan {
  // Placeholder: you can later tweak future days based on over/under calories.
  return {
    ...weekPlan,
  } as unknown as WeekPlan;
}

/**
 * Pantry-based fallback – just tags the plan as pantry-based.
 * Real AI pantry logic is handled in index.ts now.
 */
export function generateFromPantry(
  constraints: UserConstraints,
  _pantry: string[]
): WeekPlan {
  const basePlan = generateWeekPlan(constraints);

  // We keep required fields intact and just return the base for now.
  return {
    ...basePlan,
  } as unknown as WeekPlan;
}
