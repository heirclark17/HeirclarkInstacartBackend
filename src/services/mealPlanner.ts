// src/services/mealPlanner.ts

import {
  DayPlan,
  Meal,
  UserConstraints,
  WeekPlan,
} from "../types/mealPlan";

// ------------------------------------------------------------------
// Simple in-memory recipe library (seed data)
// ------------------------------------------------------------------

const RECIPES: Meal[] = [
  {
    id: "broiled-salmon-bowl",
    name: "Broiled Salmon Bowl with Veggies",
    calories: 550,
    protein: 40,
    carbs: 35,
    fats: 24,
    estimatedCost: 5.5,
    tags: ["dinner", "gluten-free", "intermediate"],
    ingredients: [
      { name: "salmon fillet", amount: 6, unit: "oz" },
      { name: "brown rice", amount: 1, unit: "cup" },
      { name: "asparagus", amount: 1, unit: "cup" },
      { name: "olive oil", amount: 1, unit: "tbsp" },
    ],
    instructions: "Broil salmon and roast veggies. Serve over rice.",
  },
  {
    id: "turkey-omelette",
    name: "Turkey Veggie Omelette",
    calories: 400,
    protein: 35,
    carbs: 10,
    fats: 22,
    estimatedCost: 2.5,
    tags: ["breakfast", "gluten-free", "beginner"],
    ingredients: [
      { name: "eggs", amount: 3, unit: "large" },
      { name: "ground turkey", amount: 2, unit: "oz" },
      { name: "bell pepper", amount: 0.5, unit: "cup" },
      { name: "onion", amount: 0.25, unit: "cup" },
    ],
    instructions: "Cook turkey, add veggies and eggs, fold into omelette.",
  },
  {
    id: "chicken-bowl",
    name: "Simple Chicken & Quinoa Bowl",
    calories: 500,
    protein: 45,
    carbs: 40,
    fats: 14,
    estimatedCost: 4.0,
    tags: ["lunch", "gluten-free", "beginner"],
    ingredients: [
      { name: "chicken breast", amount: 6, unit: "oz" },
      { name: "quinoa", amount: 1, unit: "cup" },
      { name: "mixed veggies", amount: 1, unit: "cup" },
    ],
    instructions: "Grill chicken, cook quinoa, serve with steamed veggies.",
  },
  {
    id: "greek-yogurt-bowl",
    name: "Greek Yogurt Protein Bowl",
    calories: 300,
    protein: 25,
    carbs: 30,
    fats: 6,
    estimatedCost: 1.8,
    tags: ["breakfast", "snack", "beginner"],
    ingredients: [
      { name: "greek yogurt", amount: 1, unit: "cup" },
      { name: "berries", amount: 0.5, unit: "cup" },
      { name: "granola", amount: 0.25, unit: "cup" },
    ],
    instructions: "Combine yogurt with berries and granola.",
  },
];

// ------------------------------------------------------------------
// Helper functions
// ------------------------------------------------------------------

function filterRecipesForUser(constraints: UserConstraints): Meal[] {
  const allergies = (constraints.allergies || []).map((a) =>
    a.toLowerCase().trim()
  );
  const dislikes = (constraints.dislikes || []).map((d) =>
    d.toLowerCase().trim()
  );

  return RECIPES.filter((recipe) => {
    const ingredientNames = recipe.ingredients.map((i) =>
      i.name.toLowerCase()
    );

    // Basic allergy filter
    const hasAllergyHit = allergies.some((allergy) =>
      ingredientNames.some((ing) => ing.includes(allergy))
    );
    if (hasAllergyHit) return false;

    // Basic dislikes filter
    const hasDisliked = dislikes.some((dislike) =>
      ingredientNames.some((ing) => ing.includes(dislike))
    );
    if (hasDisliked) return false;

    // Crude "complexity" filter: beginners shouldn't get "advanced" recipes
    if (constraints.skillLevel === "beginner" && recipe.tags.includes("advanced")) {
      return false;
    }

    return true;
  });
}

function pickMealsForDay(constraints: UserConstraints, candidates: Meal[]): DayPlan {
  // Fallback if somehow no candidates
  if (!candidates.length) {
    throw new Error("No candidate recipes available for given constraints.");
  }

  const targetCalories = constraints.dailyCalories;
  const budget = constraints.budgetPerDay;

  const breakfasts = candidates.filter((c) => c.tags.includes("breakfast"));
  const lunches   = candidates.filter((c) => c.tags.includes("lunch"));
  const dinners   = candidates.filter((c) => c.tags.includes("dinner"));
  const snacks    = candidates.filter((c) => c.tags.includes("snack"));

  // Super simple selection for now
  const b = breakfasts[0] ?? candidates[0];
  const l = lunches[0] ?? candidates[1] ?? candidates[0];
  const d = dinners[0] ?? candidates[2] ?? candidates[0];

  let meals: Meal[] = [b, l, d];

  // Optional snack if we're way under target and under budget
  const totals = meals.reduce(
    (acc, m) => {
      acc.calories += m.calories;
      acc.protein += m.protein;
      acc.carbs += m.carbs;
      acc.fats += m.fats;
      acc.cost += m.estimatedCost;
      return acc;
    },
    { calories: 0, protein: 0, carbs: 0, fats: 0, cost: 0 }
  );

  if (
    snacks.length &&
    totals.calories < targetCalories - 200 &&
    totals.cost < budget
  ) {
    const snack = snacks[0];
    meals = [...meals, snack];

    totals.calories += snack.calories;
    totals.protein += snack.protein;
    totals.carbs += snack.carbs;
    totals.fats += snack.fats;
    totals.cost += snack.estimatedCost;
  }

  return {
    date: "", // set later
    meals,
    totalCalories: totals.calories,
    totalProtein: totals.protein,
    totalCarbs: totals.carbs,
    totalFats: totals.fats,
    totalCost: totals.cost,
  };
}

function scoreRecipeByPantry(meal: Meal, pantry: string[]): number {
  const pantryLower = pantry.map((p) => p.toLowerCase());
  let score = 0;

  meal.ingredients.forEach((ing) => {
    if (pantryLower.some((p) => ing.name.toLowerCase().includes(p))) {
      score += 1;
    }
  });

  return score;
}

// ------------------------------------------------------------------
// Exported service functions
// ------------------------------------------------------------------

// Generate a 7-day plan from constraints
export function generateWeekPlan(constraints: UserConstraints): WeekPlan {
  const candidates = filterRecipesForUser(constraints);
  if (!candidates.length) {
    throw new Error("No recipes available for these constraints.");
  }

  const today = new Date();
  const days: DayPlan[] = [];

  for (let i = 0; i < 7; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);

    const dayPlan = pickMealsForDay(constraints, candidates);
    dayPlan.date = d.toISOString().slice(0, 10); // YYYY-MM-DD
    days.push(dayPlan);
  }

  return {
    id: `week_${Date.now()}`,
    startDate: days[0].date,
    constraints,
    days,
  };
}

// Adjust future days when the user goes over/under calories
export function adjustWeekPlan(
  weekPlan: WeekPlan,
  actualIntake: Record<string, { caloriesDelta: number }>
): WeekPlan {
  const newDays: DayPlan[] = weekPlan.days.map((day) => ({ ...day, meals: [...day.meals] }));

  newDays.forEach((day, index) => {
    const deltaInfo = actualIntake[day.date];
    if (!deltaInfo) return;

    const delta = deltaInfo.caloriesDelta; // +300 = went over, -200 = under
    const remainingDays = newDays.length - (index + 1);
    if (remainingDays <= 0) return;

    const perDayAdjustment = Math.round(delta / remainingDays);

    for (let j = index + 1; j < newDays.length; j++) {
      const futureDay = newDays[j];
      if (!futureDay.meals.length) continue;

      // Simple strategy: adjust the last meal (usually dinner)
      const lastIdx = futureDay.meals.length - 1;
      const dinner = { ...futureDay.meals[lastIdx] };

      dinner.calories -= perDayAdjustment;
      // keep calories non-negative
      if (dinner.calories < 0) dinner.calories = 0;

      // Reassign updated dinner
      futureDay.meals[lastIdx] = dinner;
      futureDay.totalCalories -= perDayAdjustment;
    }
  });

  return {
    ...weekPlan,
    days: newDays,
  };
}

// Generate a 7-day plan primarily based on pantry contents
export function generateFromPantry(
  constraints: UserConstraints,
  pantry: string[]
): WeekPlan {
  if (!Array.isArray(pantry)) {
    throw new Error("pantry must be an array of strings.");
  }

  const filtered = filterRecipesForUser(constraints);

  const scored = filtered
    .map((meal) => ({
      meal,
      score: scoreRecipeByPantry(meal, pantry),
    }))
    .sort((a, b) => b.score - a.score)
    .map((x) => x.meal);

  const candidates = scored.length ? scored : filtered;
  if (!candidates.length) {
    throw new Error("No recipes available for these constraints.");
  }

  const today = new Date();
  const days: DayPlan[] = [];

  for (let i = 0; i < 7; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);

    const dayPlan = pickMealsForDay(constraints, candidates);
    dayPlan.date = d.toISOString().slice(0, 10);
    days.push(dayPlan);
  }

  return {
    id: `week_pantry_${Date.now()}`,
    startDate: days[0].date,
    constraints,
    days,
  };
}
