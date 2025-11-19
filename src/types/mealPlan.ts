export interface Meal {
  type: "breakfast" | "lunch" | "dinner" | string;
  recipeId?: string;          // AI plans will use this
  title: string;
  calories?: number;
  protein?: number;
  carbs?: number;
  fats?: number;
  portionLabel?: string;
  portionOz?: number;
  servings?: number;
  notes?: string;
}

export interface DayPlan {
  day?: number | string;
  index?: number | string;
  isoDate?: string;
  label?: string;
  note?: string;
  meals: Meal[];
}

export interface RecipeIngredient {
  id?: string;
  name: string;
  quantity?: number | string;
  unit?: string;
  instacart_query?: string;
  category?: string;
  pantry?: boolean;
  optional?: boolean;
  displayText?: string;
  productIds?: (number | string)[];
  upcs?: string[];
  measurements?: { quantity?: number; unit?: string }[];
  filters?: Record<string, any>;
}

export interface Recipe {
  id: string;
  name: string;
  mealType?: string;
  defaultServings?: number;
  tags?: string[];
  ingredients: RecipeIngredient[];
}

export interface UserConstraints {
  dailyCalories: number;
  proteinGrams: number;
  carbsGrams: number;
  fatsGrams: number;
  budgetPerDay?: number;
  // keep any other existing fields you already had (allergies, etc.)
}

export interface WeekPlan {
  mode?: "ai" | "fallback" | "static" | string;
  generatedAt?: string;
  constraints: UserConstraints;
  days: DayPlan[];
  recipes: Recipe[];
}
