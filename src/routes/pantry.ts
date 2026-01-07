// src/routes/pantry.ts - PantryChef Skill Routes
import { Router, Request, Response } from 'express';
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false },
});

export const pantryRouter = Router();

// Sample recipe database
const RECIPES = [
  {
    id: 'chicken-stirfry',
    name: 'Garlic Chicken Stir-Fry',
    description: 'Quick and flavorful weeknight dinner',
    ingredients: ['chicken breast', 'garlic', 'soy sauce', 'vegetables', 'rice', 'oil'],
    prep_time_mins: 10,
    cook_time_mins: 15,
    servings: 2,
    nutrition: { calories: 450, protein: 38, carbs: 42, fat: 14 },
    instructions: [
      'Cook rice according to package directions',
      'Slice chicken into thin strips',
      'Heat oil in large skillet over high heat',
      'Cook chicken 4-5 minutes until golden',
      'Add garlic and vegetables, stir-fry 3 minutes',
      'Add soy sauce, toss to coat',
      'Serve over rice'
    ]
  },
  {
    id: 'egg-fried-rice',
    name: 'Protein-Packed Egg Fried Rice',
    description: 'Simple, satisfying, and budget-friendly',
    ingredients: ['eggs', 'rice', 'soy sauce', 'vegetables', 'oil', 'garlic'],
    prep_time_mins: 5,
    cook_time_mins: 10,
    servings: 2,
    nutrition: { calories: 380, protein: 16, carbs: 52, fat: 12 },
    instructions: [
      'Heat oil in large pan or wok',
      'Scramble eggs, set aside',
      'Add cold rice to pan, stir-fry 2 minutes',
      'Add vegetables, cook 2 minutes',
      'Return eggs to pan',
      'Add soy sauce and garlic, toss well'
    ]
  },
  {
    id: 'greek-yogurt-bowl',
    name: 'High-Protein Greek Yogurt Bowl',
    description: 'Quick breakfast or snack',
    ingredients: ['greek yogurt', 'honey', 'nuts', 'berries'],
    prep_time_mins: 5,
    cook_time_mins: 0,
    servings: 1,
    nutrition: { calories: 320, protein: 22, carbs: 35, fat: 12 },
    instructions: [
      'Add Greek yogurt to bowl',
      'Top with berries',
      'Sprinkle nuts on top',
      'Drizzle with honey',
      'Mix gently and enjoy'
    ]
  },
  {
    id: 'sheet-pan-chicken',
    name: 'Sheet Pan Chicken & Vegetables',
    description: 'Hands-off healthy dinner',
    ingredients: ['chicken breast', 'broccoli', 'sweet potato', 'oil', 'garlic'],
    prep_time_mins: 15,
    cook_time_mins: 25,
    servings: 2,
    nutrition: { calories: 420, protein: 42, carbs: 35, fat: 12 },
    instructions: [
      'Preheat oven to 400°F',
      'Cube sweet potato, toss with oil',
      'Place on sheet pan, roast 10 minutes',
      'Add chicken and broccoli to pan',
      'Season everything with garlic, salt, pepper',
      'Roast additional 20-25 minutes'
    ]
  },
  {
    id: 'overnight-oats',
    name: 'Overnight Protein Oats',
    description: 'Prep tonight, eat tomorrow',
    ingredients: ['oats', 'milk', 'greek yogurt', 'honey', 'berries'],
    prep_time_mins: 5,
    cook_time_mins: 0,
    servings: 1,
    nutrition: { calories: 380, protein: 18, carbs: 55, fat: 10 },
    instructions: [
      'Mix oats, milk, and yogurt in jar',
      'Add honey and stir',
      'Refrigerate overnight',
      'Top with berries before eating'
    ]
  }
];

/**
 * POST /api/v1/pantry/items
 * Add or update pantry items
 */
pantryRouter.post('/items', async (req: Request, res: Response) => {
  try {
    const { shopifyCustomerId, items } = req.body;

    if (!shopifyCustomerId) {
      return res.status(400).json({ ok: false, error: 'Missing shopifyCustomerId' });
    }
    if (!items || !Array.isArray(items)) {
      return res.status(400).json({ ok: false, error: 'Missing items array' });
    }

    // Ensure table exists
    await pool.query(`
      CREATE TABLE IF NOT EXISTS hc_pantry_items (
        id SERIAL PRIMARY KEY,
        shopify_customer_id VARCHAR(255) NOT NULL,
        name VARCHAR(255) NOT NULL,
        quantity DECIMAL,
        unit VARCHAR(50),
        category VARCHAR(100),
        expiration_date DATE,
        added_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(shopify_customer_id, name)
      )
    `);

    // Upsert items
    for (const item of items) {
      await pool.query(
        `INSERT INTO hc_pantry_items (shopify_customer_id, name, quantity, unit, category, expiration_date)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (shopify_customer_id, name) DO UPDATE SET
           quantity = EXCLUDED.quantity,
           unit = EXCLUDED.unit,
           category = EXCLUDED.category,
           expiration_date = EXCLUDED.expiration_date,
           added_at = NOW()`,
        [shopifyCustomerId, item.name?.toLowerCase(), item.quantity || 1, item.unit, item.category, item.expiration_date]
      );
    }

    res.json({
      ok: true,
      message: `${items.length} items added/updated`,
      items_count: items.length
    });

  } catch (err: any) {
    console.error('[pantry] items POST error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * GET /api/v1/pantry/items
 * Get current pantry inventory
 */
pantryRouter.get('/items', async (req: Request, res: Response) => {
  try {
    const shopifyCustomerId = req.query.shopifyCustomerId as string || req.headers['x-shopify-customer-id'] as string;

    if (!shopifyCustomerId) {
      return res.status(400).json({ ok: false, error: 'Missing shopifyCustomerId' });
    }

    const result = await pool.query(
      `SELECT id, name, quantity, unit, category, expiration_date, added_at
       FROM hc_pantry_items
       WHERE shopify_customer_id = $1
       ORDER BY category, name`,
      [shopifyCustomerId]
    );

    // Group by category
    const byCategory: Record<string, any[]> = {};
    for (const item of result.rows) {
      const cat = item.category || 'other';
      if (!byCategory[cat]) byCategory[cat] = [];
      byCategory[cat].push(item);
    }

    res.json({
      ok: true,
      items: result.rows,
      by_category: byCategory,
      total_items: result.rows.length
    });

  } catch (err: any) {
    console.error('[pantry] items GET error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * DELETE /api/v1/pantry/items/:id
 * Remove a pantry item
 */
pantryRouter.delete('/items/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const shopifyCustomerId = req.query.shopifyCustomerId as string || req.headers['x-shopify-customer-id'] as string;

    if (!shopifyCustomerId) {
      return res.status(400).json({ ok: false, error: 'Missing shopifyCustomerId' });
    }

    await pool.query(
      `DELETE FROM hc_pantry_items WHERE id = $1 AND shopify_customer_id = $2`,
      [id, shopifyCustomerId]
    );

    res.json({ ok: true, deleted: id });

  } catch (err: any) {
    console.error('[pantry] items DELETE error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * POST /api/v1/pantry/recipes
 * Get recipes that match pantry items
 */
pantryRouter.post('/recipes', async (req: Request, res: Response) => {
  try {
    const { shopifyCustomerId, mealType, maxPrepTime, minMatchPercent = 60, servings = 2 } = req.body;

    if (!shopifyCustomerId) {
      return res.status(400).json({ ok: false, error: 'Missing shopifyCustomerId' });
    }

    // Get user's pantry items
    const pantryResult = await pool.query(
      `SELECT name FROM hc_pantry_items WHERE shopify_customer_id = $1`,
      [shopifyCustomerId]
    );

    const pantryItems = new Set(pantryResult.rows.map((r: any) => r.name.toLowerCase()));

    // Match recipes
    const matchedRecipes = RECIPES
      .map(recipe => {
        const have = recipe.ingredients.filter(ing =>
          pantryItems.has(ing.toLowerCase()) ||
          [...pantryItems].some(p => ing.toLowerCase().includes(p) || p.includes(ing.toLowerCase()))
        );
        const matchPct = Math.round((have.length / recipe.ingredients.length) * 100);
        const missing = recipe.ingredients.filter(ing => !have.includes(ing));

        return {
          ...recipe,
          match_pct: matchPct,
          match_type: matchPct === 100 ? 'perfect' : matchPct >= 80 ? 'almost' : 'partial',
          ingredients_from_pantry: have,
          ingredients_missing: missing.map(name => ({ name, essential: true }))
        };
      })
      .filter(r => r.match_pct >= minMatchPercent)
      .sort((a, b) => b.match_pct - a.match_pct);

    // Shopping suggestions
    const missingCounts: Record<string, number> = {};
    for (const recipe of RECIPES) {
      for (const ing of recipe.ingredients) {
        if (!pantryItems.has(ing.toLowerCase())) {
          missingCounts[ing] = (missingCounts[ing] || 0) + 1;
        }
      }
    }

    const shoppingSuggestions = Object.entries(missingCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, count]) => ({
        name,
        unlocks_recipes: count,
        cost_estimate: '$3-5'
      }));

    res.json({
      ok: true,
      pantry_items_count: pantryItems.size,
      recipes: matchedRecipes.slice(0, 5),
      shopping_suggestions: {
        items: shoppingSuggestions
      }
    });

  } catch (err: any) {
    console.error('[pantry] recipes error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * POST /api/v1/pantry/what-can-i-make
 * Quick recipe suggestions from a list of ingredients
 */
pantryRouter.post('/what-can-i-make', async (req: Request, res: Response) => {
  try {
    const { ingredients, timeLimit } = req.body;

    if (!ingredients || !Array.isArray(ingredients)) {
      return res.status(400).json({ ok: false, error: 'Missing ingredients array' });
    }

    const have = new Set(ingredients.map((i: string) => i.toLowerCase()));

    const matched = RECIPES
      .filter(recipe => {
        if (timeLimit && (recipe.prep_time_mins + recipe.cook_time_mins) > timeLimit) return false;
        const matchCount = recipe.ingredients.filter(ing =>
          have.has(ing.toLowerCase()) || [...have].some(h => ing.includes(h) || h.includes(ing))
        ).length;
        return matchCount >= recipe.ingredients.length * 0.6;
      })
      .map(recipe => ({
        name: recipe.name,
        description: recipe.description,
        total_time: recipe.prep_time_mins + recipe.cook_time_mins,
        nutrition: recipe.nutrition
      }));

    res.json({
      ok: true,
      suggestions: matched.slice(0, 5),
      ingredients_provided: ingredients.length
    });

  } catch (err: any) {
    console.error('[pantry] what-can-i-make error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default pantryRouter;
