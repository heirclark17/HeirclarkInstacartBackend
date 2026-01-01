/**
 * Top Foods Discovery Service
 * Discovers most common foods from meal history or provides fallback list
 */

import { pool } from '../../db/pool';
import { TopFood, TopFoodsResult } from './types';

// ============================================================================
// Fallback Foods List
// ============================================================================

/**
 * Curated fallback list of common foods with typical macros
 * Includes user-specified foods: ground turkey 93/7, quinoa, salmon, sweet potato,
 * whey protein, almond milk, Mission zero-carb tortillas
 */
const FALLBACK_FOODS: TopFood[] = [
  // User specified foods
  { name: 'ground turkey 93/7', count: 100, avgCalories: 170, avgProtein: 21, avgCarbs: 0, avgFat: 9 },
  { name: 'quinoa', count: 100, avgCalories: 222, avgProtein: 8, avgCarbs: 39, avgFat: 4 },
  { name: 'salmon', count: 100, avgCalories: 208, avgProtein: 20, avgCarbs: 0, avgFat: 13 },
  { name: 'sweet potato', count: 100, avgCalories: 103, avgProtein: 2, avgCarbs: 24, avgFat: 0 },
  { name: 'whey protein', count: 100, avgCalories: 120, avgProtein: 24, avgCarbs: 3, avgFat: 1 },
  { name: 'almond milk unsweetened', count: 100, avgCalories: 30, avgProtein: 1, avgCarbs: 1, avgFat: 3 },
  { name: 'mission zero carb tortilla', count: 100, avgCalories: 45, avgProtein: 5, avgCarbs: 4, avgFat: 2 },

  // Common proteins
  { name: 'chicken breast', count: 95, avgCalories: 165, avgProtein: 31, avgCarbs: 0, avgFat: 4 },
  { name: 'eggs', count: 90, avgCalories: 78, avgProtein: 6, avgCarbs: 1, avgFat: 5 },
  { name: 'egg whites', count: 85, avgCalories: 17, avgProtein: 4, avgCarbs: 0, avgFat: 0 },
  { name: 'greek yogurt', count: 80, avgCalories: 100, avgProtein: 17, avgCarbs: 6, avgFat: 1 },
  { name: 'cottage cheese', count: 75, avgCalories: 98, avgProtein: 11, avgCarbs: 3, avgFat: 4 },
  { name: 'shrimp', count: 70, avgCalories: 99, avgProtein: 24, avgCarbs: 0, avgFat: 0 },
  { name: 'tuna', count: 70, avgCalories: 132, avgProtein: 29, avgCarbs: 0, avgFat: 1 },
  { name: 'lean beef', count: 65, avgCalories: 250, avgProtein: 26, avgCarbs: 0, avgFat: 15 },
  { name: 'tofu', count: 60, avgCalories: 76, avgProtein: 8, avgCarbs: 2, avgFat: 5 },

  // Common carbs
  { name: 'brown rice', count: 85, avgCalories: 216, avgProtein: 5, avgCarbs: 45, avgFat: 2 },
  { name: 'white rice', count: 80, avgCalories: 206, avgProtein: 4, avgCarbs: 45, avgFat: 0 },
  { name: 'oatmeal', count: 80, avgCalories: 158, avgProtein: 6, avgCarbs: 27, avgFat: 3 },
  { name: 'whole wheat bread', count: 75, avgCalories: 81, avgProtein: 4, avgCarbs: 14, avgFat: 1 },
  { name: 'pasta', count: 70, avgCalories: 220, avgProtein: 8, avgCarbs: 43, avgFat: 1 },
  { name: 'banana', count: 75, avgCalories: 105, avgProtein: 1, avgCarbs: 27, avgFat: 0 },
  { name: 'apple', count: 70, avgCalories: 95, avgProtein: 0, avgCarbs: 25, avgFat: 0 },
  { name: 'berries', count: 65, avgCalories: 85, avgProtein: 1, avgCarbs: 21, avgFat: 0 },

  // Common vegetables
  { name: 'broccoli', count: 80, avgCalories: 55, avgProtein: 4, avgCarbs: 11, avgFat: 1 },
  { name: 'spinach', count: 75, avgCalories: 23, avgProtein: 3, avgCarbs: 4, avgFat: 0 },
  { name: 'mixed greens', count: 70, avgCalories: 20, avgProtein: 2, avgCarbs: 4, avgFat: 0 },
  { name: 'asparagus', count: 60, avgCalories: 27, avgProtein: 3, avgCarbs: 5, avgFat: 0 },
  { name: 'green beans', count: 60, avgCalories: 44, avgProtein: 2, avgCarbs: 10, avgFat: 0 },
  { name: 'bell peppers', count: 55, avgCalories: 31, avgProtein: 1, avgCarbs: 6, avgFat: 0 },
  { name: 'zucchini', count: 55, avgCalories: 33, avgProtein: 2, avgCarbs: 6, avgFat: 1 },
  { name: 'cauliflower', count: 55, avgCalories: 25, avgProtein: 2, avgCarbs: 5, avgFat: 0 },
  { name: 'carrots', count: 50, avgCalories: 52, avgProtein: 1, avgCarbs: 12, avgFat: 0 },
  { name: 'tomatoes', count: 50, avgCalories: 22, avgProtein: 1, avgCarbs: 5, avgFat: 0 },

  // Common fats
  { name: 'avocado', count: 75, avgCalories: 234, avgProtein: 3, avgCarbs: 12, avgFat: 21 },
  { name: 'olive oil', count: 70, avgCalories: 119, avgProtein: 0, avgCarbs: 0, avgFat: 14 },
  { name: 'almonds', count: 65, avgCalories: 164, avgProtein: 6, avgCarbs: 6, avgFat: 14 },
  { name: 'peanut butter', count: 65, avgCalories: 188, avgProtein: 8, avgCarbs: 6, avgFat: 16 },
  { name: 'cheese', count: 60, avgCalories: 113, avgProtein: 7, avgCarbs: 0, avgFat: 9 },
  { name: 'butter', count: 55, avgCalories: 102, avgProtein: 0, avgCarbs: 0, avgFat: 12 },

  // Common meals/dishes
  { name: 'salad', count: 70, avgCalories: 150, avgProtein: 5, avgCarbs: 15, avgFat: 8 },
  { name: 'grilled chicken salad', count: 65, avgCalories: 350, avgProtein: 35, avgCarbs: 15, avgFat: 15 },
  { name: 'protein shake', count: 60, avgCalories: 200, avgProtein: 30, avgCarbs: 10, avgFat: 3 },
  { name: 'smoothie', count: 55, avgCalories: 250, avgProtein: 10, avgCarbs: 45, avgFat: 5 },
  { name: 'burrito bowl', count: 50, avgCalories: 550, avgProtein: 30, avgCarbs: 55, avgFat: 20 },
  { name: 'stir fry', count: 50, avgCalories: 400, avgProtein: 25, avgCarbs: 35, avgFat: 15 },
];

// ============================================================================
// Database Query for Top Foods
// ============================================================================

/**
 * Extract top foods from hc_meals table
 * Parses JSONB items array to find most common food names
 */
async function getTopFoodsFromDatabase(
  limit: number = 25,
  days: number = 90,
  customerId?: string
): Promise<TopFood[]> {
  try {
    // Check if hc_meals table exists and has data
    const tableCheck = await pool.query(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_name = 'hc_meals'
      ) as exists
    `);

    if (!tableCheck.rows[0]?.exists) {
      console.log('[TopFoods] hc_meals table does not exist');
      return [];
    }

    // Query to extract and count food names from JSONB items
    // The items column contains: [{ name, calories, protein, carbs, fat, ... }]
    const query = `
      WITH meal_items AS (
        SELECT
          LOWER(TRIM(item->>'name')) as food_name,
          (item->>'calories')::numeric as calories,
          (item->>'protein')::numeric as protein,
          (item->>'carbs')::numeric as carbs,
          (item->>'fat')::numeric as fat
        FROM hc_meals,
             jsonb_array_elements(items) as item
        WHERE datetime >= NOW() - INTERVAL '${days} days'
          AND item->>'name' IS NOT NULL
          AND TRIM(item->>'name') != ''
          ${customerId ? `AND shopify_customer_id = $1` : ''}
      )
      SELECT
        food_name as name,
        COUNT(*) as count,
        ROUND(AVG(calories), 1) as avg_calories,
        ROUND(AVG(protein), 1) as avg_protein,
        ROUND(AVG(carbs), 1) as avg_carbs,
        ROUND(AVG(fat), 1) as avg_fat
      FROM meal_items
      WHERE food_name IS NOT NULL
        AND LENGTH(food_name) > 1
      GROUP BY food_name
      HAVING COUNT(*) >= 2
      ORDER BY count DESC
      LIMIT $${customerId ? '2' : '1'}
    `;

    const params = customerId ? [customerId, limit] : [limit];
    const result = await pool.query(query, params);

    return result.rows.map((row: Record<string, string | number | null>) => ({
      name: row.name as string,
      count: parseInt(String(row.count), 10),
      avgCalories: row.avg_calories ? parseFloat(String(row.avg_calories)) : undefined,
      avgProtein: row.avg_protein ? parseFloat(String(row.avg_protein)) : undefined,
      avgCarbs: row.avg_carbs ? parseFloat(String(row.avg_carbs)) : undefined,
      avgFat: row.avg_fat ? parseFloat(String(row.avg_fat)) : undefined,
    }));
  } catch (error) {
    console.error('[TopFoods] Database query error:', error);
    return [];
  }
}

// ============================================================================
// Main Functions
// ============================================================================

/**
 * Get top foods with automatic discovery or fallback
 */
export async function getTopFoods(
  limit: number = 25,
  customerId?: string
): Promise<TopFoodsResult> {
  // Try to get from database first
  const dbFoods = await getTopFoodsFromDatabase(limit, 90, customerId);

  if (dbFoods.length >= 10) {
    // Good coverage from database
    return {
      foods: dbFoods.slice(0, limit),
      source: 'database',
      lastUpdated: new Date(),
    };
  }

  // Merge database results with fallback
  const fallbackFoods = FALLBACK_FOODS.slice(0, limit);
  const dbFoodNames = new Set(dbFoods.map(f => f.name.toLowerCase()));

  // Add fallback foods that aren't already in db results
  const mergedFoods = [...dbFoods];
  for (const fallback of fallbackFoods) {
    if (!dbFoodNames.has(fallback.name.toLowerCase())) {
      mergedFoods.push(fallback);
    }
    if (mergedFoods.length >= limit) break;
  }

  return {
    foods: mergedFoods.slice(0, limit),
    source: dbFoods.length > 0 ? 'database' : 'fallback',
    lastUpdated: new Date(),
  };
}

/**
 * Get user-specific top foods
 */
export async function getUserTopFoods(
  customerId: string,
  limit: number = 25
): Promise<TopFoodsResult> {
  return getTopFoods(limit, customerId);
}

/**
 * Get global top foods across all users
 */
export async function getGlobalTopFoods(
  limit: number = 50
): Promise<TopFoodsResult> {
  return getTopFoods(limit);
}

/**
 * Refresh top foods cache in database
 */
export async function refreshTopFoodsCache(): Promise<void> {
  try {
    // Get global top foods
    const globalFoods = await getTopFoodsFromDatabase(100, 90);

    if (globalFoods.length === 0) {
      console.log('[TopFoods] No foods to cache');
      return;
    }

    // Upsert into cache table
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Clear old global cache
      await client.query("DELETE FROM top_foods_cache WHERE scope = 'global'");

      // Insert new cache entries
      for (const food of globalFoods) {
        await client.query(
          `INSERT INTO top_foods_cache
           (scope, food_name, occurrence_count, avg_calories, avg_protein, avg_carbs, avg_fat, last_updated)
           VALUES ('global', $1, $2, $3, $4, $5, $6, NOW())`,
          [food.name, food.count, food.avgCalories, food.avgProtein, food.avgCarbs, food.avgFat]
        );
      }

      await client.query('COMMIT');
      console.log(`[TopFoods] Cached ${globalFoods.length} global top foods`);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('[TopFoods] Cache refresh error:', error);
  }
}

/**
 * Get fallback foods list (for seeding RAG)
 */
export function getFallbackFoods(): TopFood[] {
  return [...FALLBACK_FOODS];
}

/**
 * Format top foods for RAG document
 */
export function formatFoodsForRag(foods: TopFood[]): string {
  return foods
    .map(f => {
      const macros = [
        f.avgCalories ? `${f.avgCalories} cal` : null,
        f.avgProtein ? `${f.avgProtein}g protein` : null,
        f.avgCarbs ? `${f.avgCarbs}g carbs` : null,
        f.avgFat ? `${f.avgFat}g fat` : null,
      ].filter(Boolean).join(', ');

      return `- ${f.name}: ${macros || 'macros vary'}`;
    })
    .join('\n');
}

export default {
  getTopFoods,
  getUserTopFoods,
  getGlobalTopFoods,
  refreshTopFoodsCache,
  getFallbackFoods,
  formatFoodsForRag,
  FALLBACK_FOODS,
};
