// src/types/stores.ts

/**
 * Properly typed interfaces for in-memory stores.
 * These replace the `any` types used previously.
 */

// Meal item stored in a meal
export interface MealItem {
  name: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  portion?: string;
  notes?: string;
}

// A logged meal
export interface Meal {
  id: string;
  datetime: string;  // ISO string
  label?: string;
  items: MealItem[];
  source?: "manual" | "ai_photo" | "ai_text" | "barcode";
}

// Nutrition targets for a user
export interface NutritionTargets {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

// Water log entry
export interface WaterLog {
  id: string;
  userId: string;
  datetime: string;  // ISO string
  amountMl: number;
}

// Weight log entry
export interface WeightLog {
  id: string;
  userId: string;
  date: string;  // YYYY-MM-DD
  weightLbs: number;
}

// User preferences
export interface UserPreferences {
  goalWeightLbs?: number;
  hydrationTargetMl: number;
  caloriesTarget: number;
  proteinTarget: number;
  carbsTarget: number;
  fatTarget: number;
  timezone: string;
}

// Health data from devices
export interface HealthSnapshot {
  ts: string;
  steps?: number;
  activeCalories?: number;
  latestHeartRateBpm?: number;
  workoutsToday?: number;
  source: "shortcut" | "fitbit" | "apple";
  receivedAt: number;
}

// Pairing token for device linking
export interface PairingToken {
  shopifyCustomerId: string;
  createdAt: number;
  expiresAt: number;
}

// Linked health device
export interface HealthDevice {
  shopifyCustomerId: string;
  createdAt: number;
  lastSeenAt: number;
  deviceName?: string;
}

// Apple Health daily summary
export interface AppleHealthDaily {
  burnedKcal: number;
  consumedKcal: number;
  lastUpdatedAt: number;
}

// Memory store structure with proper types
export interface MemoryStore {
  mealsByUser: Record<string, Meal[]>;
  targetsByUser: Record<string, NutritionTargets>;
  waterLogs: WaterLog[];
  weights: WeightLog[];
  userId: string;  // default user ID (legacy)
}

// Health store types
export interface HealthStore {
  pairingTokens: Map<string, PairingToken>;
  devices: Map<string, HealthDevice>;
  latestByUser: Map<string, HealthSnapshot>;
}

/**
 * Default values for user preferences
 */
export function getDefaultPreferences(): UserPreferences {
  return {
    goalWeightLbs: Number(process.env.DEFAULT_GOAL_WEIGHT_LBS) || 225,
    hydrationTargetMl: Number(process.env.DEFAULT_HYDRATION_TARGET_ML) || 3000,
    caloriesTarget: Number(process.env.DEFAULT_CALORIES_TARGET) || 2200,
    proteinTarget: Number(process.env.DEFAULT_PROTEIN_TARGET) || 190,
    carbsTarget: Number(process.env.DEFAULT_CARBS_TARGET) || 190,
    fatTarget: Number(process.env.DEFAULT_FAT_TARGET) || 60,
    timezone: "America/New_York",
  };
}

/**
 * Default nutrition targets
 */
export function getDefaultTargets(): NutritionTargets {
  return {
    calories: Number(process.env.DEFAULT_CALORIES_TARGET) || 2200,
    protein: Number(process.env.DEFAULT_PROTEIN_TARGET) || 190,
    carbs: Number(process.env.DEFAULT_CARBS_TARGET) || 190,
    fat: Number(process.env.DEFAULT_FAT_TARGET) || 60,
  };
}
