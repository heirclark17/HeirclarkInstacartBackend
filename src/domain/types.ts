export type MealType = "breakfast" | "lunch" | "dinner" | "snack";

export interface MealItem {
  id: string;
  name: string;
  brand?: string | null;
  servingSize?: string | null;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber?: number;
  sugar?: number;
  sodium?: number;
}

export interface Meal {
  id: string;
  userId: string;
  datetime: string; // ISO
  mealType: MealType;
  source: "manual" | "photo";
  items: MealItem[];
}

export interface WeightLog {
  id: string;
  userId: string;
  date: string; // YYYY-MM-DD
  weightLbs: number;
}

export interface WaterLog {
  id: string;
  userId: string;
  datetime: string; // ISO
  amountMl: number;
}

export interface DailyNutritionTargets {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
  sugar: number;
  sodium: number;
}

export interface DailyNutritionTotals {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
  sugar: number;
  sodium: number;
}
