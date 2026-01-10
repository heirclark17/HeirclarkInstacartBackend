// src/routes/mealLibrary.ts - Personal Meal Library Routes
import { Router, Request, Response } from 'express';
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false },
});

export const mealLibraryRouter = Router();

// Create meal library table if not exists
async function ensureTableExists() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS hc_meal_library (
        id SERIAL PRIMARY KEY,
        shopify_customer_id VARCHAR(255) NOT NULL,
        meal_name VARCHAR(500) NOT NULL,
        meal_description TEXT,
        meal_type VARCHAR(50),
        calories INTEGER,
        protein INTEGER,
        carbs INTEGER,
        fat INTEGER,
        ingredients JSONB,
        instructions TEXT,
        servings INTEGER DEFAULT 1,
        prep_time_minutes INTEGER,
        cook_time_minutes INTEGER,
        tags TEXT[],
        is_favorite BOOLEAN DEFAULT FALSE,
        times_used INTEGER DEFAULT 0,
        last_used_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(shopify_customer_id, meal_name)
      );

      CREATE INDEX IF NOT EXISTS idx_meal_library_customer ON hc_meal_library(shopify_customer_id);
      CREATE INDEX IF NOT EXISTS idx_meal_library_type ON hc_meal_library(meal_type);
      CREATE INDEX IF NOT EXISTS idx_meal_library_favorite ON hc_meal_library(shopify_customer_id, is_favorite);
    `);
    console.log('[Meal Library] Table created/verified');
  } catch (err) {
    console.error('[Meal Library] Error creating table:', err);
  }
}

// Initialize table on module load
ensureTableExists();

/**
 * GET /api/v1/meals/library
 * Get all meals in user's library
 */
mealLibraryRouter.get('/library', async (req: Request, res: Response) => {
  try {
    const shopifyCustomerId = req.query.shopifyCustomerId as string || req.headers['x-shopify-customer-id'] as string;

    if (!shopifyCustomerId) {
      return res.status(400).json({ ok: false, error: 'Missing shopifyCustomerId' });
    }

    const mealType = req.query.mealType as string;
    const search = req.query.search as string;
    const favoritesOnly = req.query.favoritesOnly === 'true';
    const sortBy = req.query.sortBy as string || 'created_at'; // created_at, times_used, meal_name, calories
    const sortOrder = req.query.sortOrder as string || 'DESC';

    let query = `
      SELECT * FROM hc_meal_library
      WHERE shopify_customer_id = $1
    `;
    const params: any[] = [shopifyCustomerId];
    let paramIndex = 2;

    // Filter by favorites
    if (favoritesOnly) {
      query += ` AND is_favorite = true`;
    }

    // Filter by meal type
    if (mealType) {
      query += ` AND meal_type = $${paramIndex}`;
      params.push(mealType);
      paramIndex++;
    }

    // Search by name
    if (search) {
      query += ` AND meal_name ILIKE $${paramIndex}`;
      params.push(`%${search}%`);
      paramIndex++;
    }

    // Sort
    const validSortColumns = ['created_at', 'times_used', 'meal_name', 'calories', 'protein'];
    const sortColumn = validSortColumns.includes(sortBy) ? sortBy : 'created_at';
    const sortDirection = sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
    query += ` ORDER BY ${sortColumn} ${sortDirection}`;

    const result = await pool.query(query, params);

    res.json({
      ok: true,
      meals: result.rows,
      count: result.rows.length
    });

  } catch (err: any) {
    console.error('[Meal Library] Get library error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * POST /api/v1/meals/library
 * Add a meal to user's library
 */
mealLibraryRouter.post('/library', async (req: Request, res: Response) => {
  try {
    const shopifyCustomerId = req.body.shopifyCustomerId || req.headers['x-shopify-customer-id'];

    if (!shopifyCustomerId) {
      return res.status(400).json({ ok: false, error: 'Missing shopifyCustomerId' });
    }

    const {
      mealName,
      mealDescription,
      mealType,
      calories,
      protein,
      carbs,
      fat,
      ingredients,
      instructions,
      servings,
      prepTimeMinutes,
      cookTimeMinutes,
      tags
    } = req.body;

    if (!mealName) {
      return res.status(400).json({ ok: false, error: 'Missing mealName' });
    }

    // Insert or update (on conflict, increment times_used)
    const result = await pool.query(`
      INSERT INTO hc_meal_library (
        shopify_customer_id, meal_name, meal_description, meal_type,
        calories, protein, carbs, fat, ingredients, instructions,
        servings, prep_time_minutes, cook_time_minutes, tags, times_used
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 1)
      ON CONFLICT (shopify_customer_id, meal_name)
      DO UPDATE SET
        times_used = hc_meal_library.times_used + 1,
        last_used_at = NOW()
      RETURNING *
    `, [
      shopifyCustomerId,
      mealName,
      mealDescription,
      mealType,
      calories,
      protein,
      carbs,
      fat,
      JSON.stringify(ingredients || []),
      instructions,
      servings || 1,
      prepTimeMinutes,
      cookTimeMinutes,
      tags || []
    ]);

    res.json({
      ok: true,
      meal: result.rows[0]
    });

  } catch (err: any) {
    console.error('[Meal Library] Add meal error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * POST /api/v1/meals/library/batch
 * Add multiple meals to library at once (from meal plan generation)
 */
mealLibraryRouter.post('/library/batch', async (req: Request, res: Response) => {
  try {
    const shopifyCustomerId = req.body.shopifyCustomerId || req.headers['x-shopify-customer-id'];

    if (!shopifyCustomerId) {
      return res.status(400).json({ ok: false, error: 'Missing shopifyCustomerId' });
    }

    const { meals } = req.body;

    if (!meals || !Array.isArray(meals) || meals.length === 0) {
      return res.status(400).json({ ok: false, error: 'Missing or empty meals array' });
    }

    const savedMeals = [];

    for (const meal of meals) {
      try {
        const result = await pool.query(`
          INSERT INTO hc_meal_library (
            shopify_customer_id, meal_name, meal_description, meal_type,
            calories, protein, carbs, fat, ingredients, instructions,
            servings, prep_time_minutes, cook_time_minutes, tags, times_used
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 1)
          ON CONFLICT (shopify_customer_id, meal_name) DO NOTHING
          RETURNING *
        `, [
          shopifyCustomerId,
          meal.dishName || meal.mealName,
          meal.description || meal.mealDescription,
          meal.mealType,
          meal.calories || meal.macros?.calories,
          meal.macros?.protein || meal.protein,
          meal.macros?.carbs || meal.carbs,
          meal.macros?.fat || meal.fat,
          JSON.stringify(meal.ingredients || []),
          meal.instructions,
          meal.servings || 1,
          meal.prepTimeMinutes,
          meal.cookTimeMinutes,
          meal.tags || []
        ]);

        if (result.rows.length > 0) {
          savedMeals.push(result.rows[0]);
        }
      } catch (err) {
        console.warn('[Meal Library] Error saving meal:', meal.dishName, err);
        // Continue with other meals
      }
    }

    res.json({
      ok: true,
      savedCount: savedMeals.length,
      meals: savedMeals
    });

  } catch (err: any) {
    console.error('[Meal Library] Batch add error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * DELETE /api/v1/meals/library/:id
 * Delete a meal from library
 */
mealLibraryRouter.delete('/library/:id', async (req: Request, res: Response) => {
  try {
    const shopifyCustomerId = req.query.shopifyCustomerId as string || req.headers['x-shopify-customer-id'] as string;
    const mealId = parseInt(req.params.id);

    if (!shopifyCustomerId) {
      return res.status(400).json({ ok: false, error: 'Missing shopifyCustomerId' });
    }

    if (isNaN(mealId)) {
      return res.status(400).json({ ok: false, error: 'Invalid meal ID' });
    }

    await pool.query(
      'DELETE FROM hc_meal_library WHERE id = $1 AND shopify_customer_id = $2',
      [mealId, shopifyCustomerId]
    );

    res.json({ ok: true });

  } catch (err: any) {
    console.error('[Meal Library] Delete meal error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * GET /api/v1/meals/library/stats
 * Get library statistics
 */
mealLibraryRouter.get('/library/stats', async (req: Request, res: Response) => {
  try {
    const shopifyCustomerId = req.query.shopifyCustomerId as string || req.headers['x-shopify-customer-id'] as string;

    if (!shopifyCustomerId) {
      return res.status(400).json({ ok: false, error: 'Missing shopifyCustomerId' });
    }

    const result = await pool.query(`
      SELECT
        COUNT(*) as total_meals,
        COUNT(DISTINCT meal_type) as meal_types,
        SUM(times_used) as total_uses,
        AVG(calories)::INTEGER as avg_calories,
        AVG(protein)::INTEGER as avg_protein,
        COUNT(*) FILTER (WHERE is_favorite = true) as favorite_count
      FROM hc_meal_library
      WHERE shopify_customer_id = $1
    `, [shopifyCustomerId]);

    res.json({
      ok: true,
      stats: result.rows[0]
    });

  } catch (err: any) {
    console.error('[Meal Library] Get stats error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * PATCH /api/v1/meals/library/:id/favorite
 * Toggle favorite status of a meal
 */
mealLibraryRouter.patch('/library/:id/favorite', async (req: Request, res: Response) => {
  try {
    const shopifyCustomerId = req.body.shopifyCustomerId || req.headers['x-shopify-customer-id'];
    const mealId = parseInt(req.params.id);
    const isFavorite = req.body.isFavorite;

    if (!shopifyCustomerId) {
      return res.status(400).json({ ok: false, error: 'Missing shopifyCustomerId' });
    }

    if (isNaN(mealId)) {
      return res.status(400).json({ ok: false, error: 'Invalid meal ID' });
    }

    if (typeof isFavorite !== 'boolean') {
      return res.status(400).json({ ok: false, error: 'isFavorite must be a boolean' });
    }

    const result = await pool.query(
      `UPDATE hc_meal_library
       SET is_favorite = $1
       WHERE id = $2 AND shopify_customer_id = $3
       RETURNING *`,
      [isFavorite, mealId, shopifyCustomerId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ ok: false, error: 'Meal not found' });
    }

    res.json({
      ok: true,
      meal: result.rows[0]
    });

  } catch (err: any) {
    console.error('[Meal Library] Toggle favorite error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default mealLibraryRouter;
