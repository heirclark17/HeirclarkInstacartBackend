// src/routes/admin.ts
// Admin endpoints for database management tasks

import { Router, Request, Response } from 'express';
import { Pool } from 'pg';
import axios from 'axios';

const USDA_API_KEY = process.env.USDA_API_KEY || 'DEMO_KEY';
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'heirclark-admin-2024';
const USDA_BASE_URL = 'https://api.nal.usda.gov/fdc/v1';

// Nutrient IDs from USDA
const NUTRIENT_IDS = {
  calories: 1008,
  protein: 1003,
  fat: 1004,
  carbs: 1005,
  fiber: 1079,
  sugar: 2000,
  sodium: 1093,
  cholesterol: 1253,
  saturated_fat: 1258,
  potassium: 1092,
  vitamin_a: 1106,
  vitamin_c: 1162,
  calcium: 1087,
  iron: 1089,
};

export function createAdminRouter(pool: Pool): Router {
  const router = Router();

  // Middleware to check admin secret
  const checkAdminAuth = (req: Request, res: Response, next: Function) => {
    const secret = req.headers['x-admin-secret'] || req.query.secret;
    if (secret !== ADMIN_SECRET) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }
    next();
  };

  // GET /api/v1/admin/stats
  router.get('/stats', checkAdminAuth, async (req: Request, res: Response) => {
    try {
      const tables = [
        'nutrition_foods',
        'hc_programs',
        'hc_program_enrollments',
        'hc_user_profiles',
        'hc_challenges',
        'hc_progress_photos',
        'hc_import_jobs',
      ];

      const stats: Record<string, number> = {};

      for (const table of tables) {
        try {
          const result = await pool.query(`SELECT COUNT(*) FROM ${table}`);
          stats[table] = parseInt(result.rows[0].count);
        } catch {
          stats[table] = -1; // Table doesn't exist
        }
      }

      return res.json({ ok: true, data: stats });
    } catch (error) {
      console.error('[Admin] Stats error:', error);
      return res.status(500).json({ ok: false, error: 'Failed to get stats' });
    }
  });

  // POST /api/v1/admin/seed-usda
  router.post('/seed-usda', checkAdminAuth, async (req: Request, res: Response) => {
    const { pages = 10, dataType = 'Foundation' } = req.body;

    // Send immediate response, run seeding in background
    res.json({
      ok: true,
      message: `Starting USDA seeding in background (${dataType}, ${pages} pages)`,
    });

    // Run seeding in background
    seedUSDAFoodsBackground(pool, dataType, pages).catch(console.error);
  });

  // POST /api/v1/admin/seed-usda-sync (synchronous, for small batches)
  router.post('/seed-usda-sync', checkAdminAuth, async (req: Request, res: Response) => {
    try {
      const { pages = 5, dataType = 'Foundation' } = req.body;

      console.log(`[Admin] Starting synchronous USDA seeding: ${dataType}, ${pages} pages`);

      let totalInserted = 0;

      for (let page = 1; page <= pages; page++) {
        const foods = await fetchUSDAFoods(dataType, 200, page);
        if (foods.length === 0) break;

        console.log(`[Admin] Processing page ${page}: ${foods.length} foods`);

        for (const food of foods) {
          const mapped = mapUSDAToNutritionFood(food);
          const success = await insertFood(pool, mapped);
          if (success) totalInserted++;
        }

        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      // Get total count
      const countResult = await pool.query('SELECT COUNT(*) FROM nutrition_foods');

      return res.json({
        ok: true,
        data: {
          inserted: totalInserted,
          total_foods: parseInt(countResult.rows[0].count),
        },
      });
    } catch (error: any) {
      console.error('[Admin] Seed error:', error);
      return res.status(500).json({ ok: false, error: error.message });
    }
  });

  return router;
}

// Helper functions
async function fetchUSDAFoods(dataType: string, pageSize: number, pageNumber: number): Promise<any[]> {
  try {
    const response = await axios.post(
      `${USDA_BASE_URL}/foods/search?api_key=${USDA_API_KEY}`,
      {
        dataType: [dataType],
        pageSize,
        pageNumber,
        sortBy: 'dataType.keyword',
        sortOrder: 'asc',
      },
      { headers: { 'Content-Type': 'application/json' } }
    );
    return response.data.foods || [];
  } catch (error: any) {
    console.error(`Error fetching USDA foods:`, error.message);
    return [];
  }
}

function getNutrientValue(food: any, nutrientId: number): number | null {
  const nutrient = food.foodNutrients?.find((n: any) => n.nutrientId === nutrientId);
  return nutrient ? nutrient.value : null;
}

function mapUSDAToNutritionFood(food: any) {
  const calories = getNutrientValue(food, NUTRIENT_IDS.calories) || 0;
  const protein = getNutrientValue(food, NUTRIENT_IDS.protein) || 0;
  const carbs = getNutrientValue(food, NUTRIENT_IDS.carbs) || 0;

  const dietaryFlags: string[] = [];
  if (protein >= 20) dietaryFlags.push('high_protein');
  const sodium = getNutrientValue(food, NUTRIENT_IDS.sodium);
  if (sodium && sodium < 140) dietaryFlags.push('low_sodium');
  if (carbs < 5 && calories > 0) dietaryFlags.push('keto_friendly');

  return {
    name: food.description,
    brand: food.brandOwner || food.brandName || null,
    category: food.foodCategory || null,
    upc: food.gtinUpc || null,
    calories,
    protein_g: protein,
    carbs_g: carbs,
    fat_g: getNutrientValue(food, NUTRIENT_IDS.fat) || 0,
    fiber_g: getNutrientValue(food, NUTRIENT_IDS.fiber),
    sugar_g: getNutrientValue(food, NUTRIENT_IDS.sugar),
    sodium_mg: sodium,
    cholesterol_mg: getNutrientValue(food, NUTRIENT_IDS.cholesterol),
    saturated_fat_g: getNutrientValue(food, NUTRIENT_IDS.saturated_fat),
    potassium_mg: getNutrientValue(food, NUTRIENT_IDS.potassium),
    vitamin_a_iu: getNutrientValue(food, NUTRIENT_IDS.vitamin_a),
    vitamin_c_mg: getNutrientValue(food, NUTRIENT_IDS.vitamin_c),
    calcium_mg: getNutrientValue(food, NUTRIENT_IDS.calcium),
    iron_mg: getNutrientValue(food, NUTRIENT_IDS.iron),
    serving_amount: food.servingSize || 100,
    serving_unit: food.servingSizeUnit || 'g',
    serving_grams: food.servingSize || 100,
    serving_description: food.householdServingFullText || null,
    verification_status: 'verified',
    quality_score: 85,
    source: 'usda',
    source_id: food.fdcId?.toString(),
    dietary_flags: dietaryFlags,
  };
}

async function insertFood(pool: Pool, food: any): Promise<boolean> {
  try {
    await pool.query(
      `INSERT INTO nutrition_foods (
        name, brand, category, upc,
        calories, protein_g, carbs_g, fat_g, fiber_g, sugar_g,
        sodium_mg, cholesterol_mg, saturated_fat_g, potassium_mg,
        vitamin_a_iu, vitamin_c_mg, calcium_mg, iron_mg,
        serving_amount, serving_unit, serving_grams, serving_description,
        verification_status, quality_score, source, source_id, dietary_flags
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $15, $16, $17, $18,
        $19, $20, $21, $22, $23, $24, $25, $26, $27
      )
      ON CONFLICT (upc) DO UPDATE SET
        name = EXCLUDED.name,
        calories = EXCLUDED.calories,
        protein_g = EXCLUDED.protein_g,
        updated_at = NOW()
      WHERE nutrition_foods.upc IS NOT NULL`,
      [
        food.name, food.brand, food.category, food.upc,
        food.calories, food.protein_g, food.carbs_g, food.fat_g,
        food.fiber_g, food.sugar_g, food.sodium_mg, food.cholesterol_mg,
        food.saturated_fat_g, food.potassium_mg, food.vitamin_a_iu,
        food.vitamin_c_mg, food.calcium_mg, food.iron_mg,
        food.serving_amount, food.serving_unit, food.serving_grams,
        food.serving_description, food.verification_status, food.quality_score,
        food.source, food.source_id, JSON.stringify(food.dietary_flags),
      ]
    );
    return true;
  } catch {
    return false;
  }
}

async function seedUSDAFoodsBackground(pool: Pool, dataType: string, maxPages: number) {
  console.log(`[Admin] Background seeding started: ${dataType}`);
  let totalInserted = 0;

  for (let page = 1; page <= maxPages; page++) {
    const foods = await fetchUSDAFoods(dataType, 200, page);
    if (foods.length === 0) break;

    for (const food of foods) {
      const mapped = mapUSDAToNutritionFood(food);
      if (await insertFood(pool, mapped)) totalInserted++;
    }

    console.log(`[Admin] Page ${page} complete: ${totalInserted} total inserted`);
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  console.log(`[Admin] Background seeding complete: ${totalInserted} foods inserted`);
}

export default createAdminRouter;
