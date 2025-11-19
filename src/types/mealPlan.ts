// src/types/mealPlan.ts
export type SkillLevel = "beginner" | "intermediate" | "advanced";

export interface UserConstraints {
  dailyCalories: number;
  proteinGrams: number;
  carbsGrams: number;
  fatsGrams: number;
  budgetPerDay: number;      // in USD
  allergies: string[];       // ["peanuts", "shellfish"]
  dislikes: string[];        // optional
  skillLevel: SkillLevel;    // affects recipe complexity
}

export interface Ingredient {
  name: string;
  amount: number;
  unit: string;   // "g", "oz", "tbsp", etc.
}

export interface Meal {
  id: string;
  name: string;
  calories: number;
  protein: number;
  carbs: number;
  fats: number;
  estimatedCost: number;
  tags: string[];       // ["gluten-free","beginner"]
  ingredients: Ingredient[];
  instructions?: string;
}

export interface DayPlan {
  date: string;         // "2025-11-18"
  meals: Meal[];        // [breakfast, lunch, dinner, snacks...]
  totalCalories: number;
  totalProtein: number;
  totalCarbs: number;
  totalFats: number;
  totalCost: number;
}

export interface WeekPlan {
  id: string;
  userId?: string;
  startDate: string;
  constraints: UserConstraints;
  days: DayPlan[];
}
