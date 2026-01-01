// src/services/userPreferences.ts
import { pool } from "../db/pool";
import { UserPreferences, getDefaultPreferences } from "../types/stores";

/**
 * Service for managing user preferences (goals, targets, settings).
 * Uses database for persistence with in-memory caching.
 */

// Simple cache with TTL
const cache = new Map<string, { data: UserPreferences; expiresAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Get user preferences, creating defaults if not exists.
 */
export async function getUserPreferences(customerId: string): Promise<UserPreferences> {
  // Check cache first
  const cached = cache.get(customerId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  try {
    const result = await pool.query(
      `SELECT * FROM hc_user_preferences WHERE shopify_customer_id = $1`,
      [customerId]
    );

    if (result.rows.length > 0) {
      const row = result.rows[0];

      // Parse cardBackground from JSON if present
      let cardBackground = undefined;
      if (row.card_background) {
        try {
          cardBackground = typeof row.card_background === 'string'
            ? JSON.parse(row.card_background)
            : row.card_background;
        } catch {
          cardBackground = undefined;
        }
      }

      const prefs: UserPreferences = {
        goalWeightLbs: row.goal_weight_lbs ? Number(row.goal_weight_lbs) : undefined,
        hydrationTargetMl: Number(row.hydration_target_ml) || 3000,
        caloriesTarget: Number(row.calories_target) || 2200,
        proteinTarget: Number(row.protein_target) || 190,
        carbsTarget: Number(row.carbs_target) || 190,
        fatTarget: Number(row.fat_target) || 60,
        timezone: row.timezone || "America/New_York",
        cardBackground,
      };

      // Cache the result
      cache.set(customerId, { data: prefs, expiresAt: Date.now() + CACHE_TTL_MS });
      return prefs;
    }

    // Create defaults for new user
    const defaults = getDefaultPreferences();
    await pool.query(
      `INSERT INTO hc_user_preferences
       (shopify_customer_id, goal_weight_lbs, hydration_target_ml, calories_target, protein_target, carbs_target, fat_target, timezone)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (shopify_customer_id) DO NOTHING`,
      [
        customerId,
        defaults.goalWeightLbs,
        defaults.hydrationTargetMl,
        defaults.caloriesTarget,
        defaults.proteinTarget,
        defaults.carbsTarget,
        defaults.fatTarget,
        defaults.timezone,
      ]
    );

    cache.set(customerId, { data: defaults, expiresAt: Date.now() + CACHE_TTL_MS });
    return defaults;
  } catch (err) {
    console.error("[userPreferences] Failed to get preferences:", err);
    // Return defaults on error
    return getDefaultPreferences();
  }
}

/**
 * Update user preferences.
 */
export async function updateUserPreferences(
  customerId: string,
  updates: Partial<UserPreferences>
): Promise<UserPreferences> {
  // Build dynamic update query
  const setClauses: string[] = [];
  const values: any[] = [];
  let paramIndex = 1;

  if (updates.goalWeightLbs !== undefined) {
    setClauses.push(`goal_weight_lbs = $${paramIndex++}`);
    values.push(updates.goalWeightLbs);
  }
  if (updates.hydrationTargetMl !== undefined) {
    setClauses.push(`hydration_target_ml = $${paramIndex++}`);
    values.push(updates.hydrationTargetMl);
  }
  if (updates.caloriesTarget !== undefined) {
    setClauses.push(`calories_target = $${paramIndex++}`);
    values.push(updates.caloriesTarget);
  }
  if (updates.proteinTarget !== undefined) {
    setClauses.push(`protein_target = $${paramIndex++}`);
    values.push(updates.proteinTarget);
  }
  if (updates.carbsTarget !== undefined) {
    setClauses.push(`carbs_target = $${paramIndex++}`);
    values.push(updates.carbsTarget);
  }
  if (updates.fatTarget !== undefined) {
    setClauses.push(`fat_target = $${paramIndex++}`);
    values.push(updates.fatTarget);
  }
  if (updates.timezone !== undefined) {
    setClauses.push(`timezone = $${paramIndex++}`);
    values.push(updates.timezone);
  }
  if (updates.cardBackground !== undefined) {
    setClauses.push(`card_background = $${paramIndex++}`);
    values.push(JSON.stringify(updates.cardBackground));
  }

  if (setClauses.length === 0) {
    return getUserPreferences(customerId);
  }

  setClauses.push(`updated_at = NOW()`);
  values.push(customerId);

  try {
    await pool.query(
      `UPDATE hc_user_preferences SET ${setClauses.join(", ")} WHERE shopify_customer_id = $${paramIndex}`,
      values
    );

    // Invalidate cache
    cache.delete(customerId);

    return getUserPreferences(customerId);
  } catch (err) {
    console.error("[userPreferences] Failed to update:", err);
    throw err;
  }
}

/**
 * Get goal weight for a user.
 */
export async function getGoalWeight(customerId: string): Promise<number | null> {
  const prefs = await getUserPreferences(customerId);
  return prefs.goalWeightLbs ?? null;
}

/**
 * Get hydration target for a user.
 */
export async function getHydrationTarget(customerId: string): Promise<number> {
  const prefs = await getUserPreferences(customerId);
  return prefs.hydrationTargetMl;
}

/**
 * Get nutrition targets for a user.
 */
export async function getNutritionTargets(customerId: string): Promise<{
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}> {
  const prefs = await getUserPreferences(customerId);
  return {
    calories: prefs.caloriesTarget,
    protein: prefs.proteinTarget,
    carbs: prefs.carbsTarget,
    fat: prefs.fatTarget,
  };
}

/**
 * Clear cache for a user (useful after updates).
 */
export function clearCache(customerId?: string): void {
  if (customerId) {
    cache.delete(customerId);
  } else {
    cache.clear();
  }
}

export default {
  getUserPreferences,
  updateUserPreferences,
  getGoalWeight,
  getHydrationTarget,
  getNutritionTargets,
  clearCache,
};
