// src/routes/restaurant.ts - RestaurantAdvisor Skill Routes
import { Router, Request, Response } from 'express';
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false },
});

export const restaurantRouter = Router();

// Restaurant menu database (sample data - would be expanded)
const RESTAURANT_MENUS: Record<string, any[]> = {
  'chipotle': [
    { name: 'Chicken Burrito Bowl', category: 'bowls', calories: 665, protein: 53, carbs: 55, fat: 24, customizable: true },
    { name: 'Steak Burrito Bowl', category: 'bowls', calories: 700, protein: 51, carbs: 55, fat: 28, customizable: true },
    { name: 'Chicken Salad', category: 'salads', calories: 480, protein: 45, carbs: 20, fat: 28, customizable: true },
    { name: 'Veggie Bowl', category: 'bowls', calories: 550, protein: 15, carbs: 72, fat: 22, customizable: true },
  ],
  'chick-fil-a': [
    { name: 'Grilled Chicken Sandwich', category: 'sandwiches', calories: 390, protein: 29, carbs: 44, fat: 12 },
    { name: 'Grilled Nuggets (8-count)', category: 'entrees', calories: 130, protein: 25, carbs: 1, fat: 3 },
    { name: 'Cobb Salad w/ Grilled Chicken', category: 'salads', calories: 430, protein: 40, carbs: 24, fat: 21 },
    { name: 'Grilled Cool Wrap', category: 'wraps', calories: 350, protein: 37, carbs: 29, fat: 13 },
  ],
  'panera': [
    { name: 'Mediterranean Bowl with Chicken', category: 'bowls', calories: 520, protein: 35, carbs: 40, fat: 25 },
    { name: 'Asian Sesame Salad with Chicken', category: 'salads', calories: 400, protein: 30, carbs: 32, fat: 18 },
    { name: 'Turkey Avocado BLT', category: 'sandwiches', calories: 620, protein: 38, carbs: 50, fat: 32 },
    { name: 'Greek Salad with Chicken', category: 'salads', calories: 380, protein: 32, carbs: 15, fat: 23 },
  ],
  'sweetgreen': [
    { name: 'Harvest Bowl', category: 'bowls', calories: 555, protein: 23, carbs: 48, fat: 33 },
    { name: 'Chicken Pesto Parm', category: 'bowls', calories: 630, protein: 42, carbs: 44, fat: 34 },
    { name: 'Kale Caesar', category: 'salads', calories: 450, protein: 28, carbs: 25, fat: 30 },
    { name: 'Super Green Goddess', category: 'salads', calories: 310, protein: 9, carbs: 38, fat: 14 },
  ],
};

/**
 * POST /api/v1/restaurant/recommend
 * Get meal recommendations for a specific restaurant
 */
restaurantRouter.post('/recommend', async (req: Request, res: Response) => {
  try {
    const { shopifyCustomerId, restaurant, mealType, maxCalories, priorities } = req.body;

    if (!shopifyCustomerId) {
      return res.status(400).json({ ok: false, error: 'Missing shopifyCustomerId' });
    }
    if (!restaurant) {
      return res.status(400).json({ ok: false, error: 'Missing restaurant name' });
    }

    // Normalize restaurant name
    const normalizedName = restaurant.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-');
    const menu = RESTAURANT_MENUS[normalizedName];

    // Get user's remaining budget for the day
    const goalsResult = await pool.query(
      `SELECT calories_target, protein_target, carbs_target, fat_target
       FROM hc_user_preferences WHERE shopify_customer_id = $1`,
      [shopifyCustomerId]
    );
    const goals = goalsResult.rows[0] || { calories_target: 2000, protein_target: 150, carbs_target: 200, fat_target: 65 };

    const todayResult = await pool.query(
      `SELECT COALESCE(SUM(total_calories), 0) as consumed_calories,
              COALESCE(SUM(total_protein), 0) as consumed_protein
       FROM hc_meals
       WHERE shopify_customer_id = $1 AND DATE(datetime) = CURRENT_DATE`,
      [shopifyCustomerId]
    );
    const consumed = todayResult.rows[0];

    const remainingBudget = {
      calories: goals.calories_target - Number(consumed.consumed_calories),
      protein: goals.protein_target - Number(consumed.consumed_protein),
      carbs: goals.carbs_target,
      fat: goals.fat_target
    };

    const effectiveMaxCalories = maxCalories || remainingBudget.calories;

    if (!menu) {
      // Unknown restaurant - provide general guidance
      return res.json({
        ok: true,
        restaurant,
        restaurant_found: false,
        remaining_budget: remainingBudget,
        recommendations: [],
        general_tips: [
          'Look for grilled proteins over fried',
          'Ask for dressing/sauce on the side',
          'Choose vegetables or salad as sides',
          'Skip the bread basket or chips',
          `Aim for around ${Math.round(remainingBudget.protein / 2)}g protein in this meal`
        ],
        message: `We don't have ${restaurant} in our database yet. Use our general tips for making healthy choices.`
      });
    }

    // Score and rank menu items
    const scoredItems = menu
      .filter((item: any) => item.calories <= effectiveMaxCalories * 1.1)
      .map((item: any) => {
        let score = 0;

        // Calorie fit score (0-40 points)
        const calorieDeviation = Math.abs(item.calories - effectiveMaxCalories * 0.8) / effectiveMaxCalories;
        score += Math.max(0, 40 - calorieDeviation * 100);

        // Protein score (0-30 points) - higher protein = better
        const proteinDensity = item.protein / item.calories * 100;
        score += Math.min(30, proteinDensity * 3);

        // Priority bonuses
        if (priorities?.includes('high_protein') && item.protein > 30) score += 15;
        if (priorities?.includes('low_carb') && item.carbs < 30) score += 15;
        if (priorities?.includes('low_fat') && item.fat < 15) score += 10;

        return { ...item, fit_score: Math.round(score) };
      })
      .sort((a: any, b: any) => b.fit_score - a.fit_score)
      .slice(0, 3);

    // Add customization suggestions
    const recommendations = scoredItems.map((item: any, index: number) => ({
      rank: index + 1,
      name: item.name,
      category: item.category,
      base_nutrition: {
        calories: item.calories,
        protein: item.protein,
        carbs: item.carbs,
        fat: item.fat
      },
      customization: item.customizable ? {
        build: ['Add extra protein if available', 'Load up on vegetables'],
        skip: ['Cheese (-100 cal)', 'Sour cream (-60 cal)', 'Extra sauce/dressing'],
        why: 'Maximizes protein while keeping calories in check'
      } : null,
      final_nutrition: {
        calories: item.calories,
        protein: item.protein,
        carbs: item.carbs,
        fat: item.fat
      },
      fit_score: item.fit_score,
      fits_budget: item.calories <= remainingBudget.calories
    }));

    res.json({
      ok: true,
      restaurant,
      restaurant_found: true,
      remaining_budget: remainingBudget,
      recommendations,
      general_tips: [
        'Ask for dressing on the side',
        'Grilled is almost always better than fried',
        'Double protein is usually worth the extra cost'
      ]
    });

  } catch (err: any) {
    console.error('[restaurant] recommend error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * GET /api/v1/restaurant/chains
 * Get list of supported restaurant chains
 */
restaurantRouter.get('/chains', async (_req: Request, res: Response) => {
  const chains = Object.keys(RESTAURANT_MENUS).map(key => ({
    id: key,
    name: key.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
    item_count: RESTAURANT_MENUS[key].length
  }));

  res.json({
    ok: true,
    chains,
    total: chains.length
  });
});

/**
 * GET /api/v1/restaurant/menu/:chain
 * Get full menu for a restaurant chain
 */
restaurantRouter.get('/menu/:chain', async (req: Request, res: Response) => {
  const chain = req.params.chain.toLowerCase().replace(/[^a-z0-9]/g, '-');
  const menu = RESTAURANT_MENUS[chain];

  if (!menu) {
    return res.status(404).json({ ok: false, error: 'Restaurant not found in database' });
  }

  res.json({
    ok: true,
    restaurant: chain,
    items: menu,
    categories: [...new Set(menu.map((item: any) => item.category))]
  });
});

/**
 * POST /api/v1/restaurant/estimate-item
 * Estimate nutrition for an unknown menu item
 */
restaurantRouter.post('/estimate-item', async (req: Request, res: Response) => {
  try {
    const { description, restaurant, portion_notes } = req.body;

    if (!description) {
      return res.status(400).json({ ok: false, error: 'Missing item description' });
    }

    // Simple estimation based on keywords
    const desc = description.toLowerCase();
    let baseCalories = 500;
    let protein = 25;
    let carbs = 45;
    let fat = 20;

    // Protein adjustments
    if (desc.includes('chicken')) { protein = 35; baseCalories = 450; }
    if (desc.includes('steak') || desc.includes('beef')) { protein = 40; fat = 25; baseCalories = 550; }
    if (desc.includes('salmon') || desc.includes('fish')) { protein = 35; fat = 20; baseCalories = 480; }
    if (desc.includes('shrimp')) { protein = 30; fat = 8; baseCalories = 350; }

    // Preparation adjustments
    if (desc.includes('fried')) { fat += 15; baseCalories += 150; }
    if (desc.includes('grilled')) { fat -= 5; baseCalories -= 50; }
    if (desc.includes('salad')) { carbs -= 20; baseCalories -= 100; }
    if (desc.includes('burrito') || desc.includes('wrap')) { carbs += 30; baseCalories += 150; }
    if (desc.includes('bowl')) { /* default is fine */ }

    // Size adjustments
    if (desc.includes('large') || desc.includes('jumbo')) { baseCalories *= 1.3; protein *= 1.2; }
    if (desc.includes('small') || desc.includes('half')) { baseCalories *= 0.7; protein *= 0.7; }

    res.json({
      ok: true,
      item_name: description,
      estimated_nutrition: {
        calories: Math.round(baseCalories),
        protein: Math.round(protein),
        carbs: Math.round(carbs),
        fat: Math.round(fat)
      },
      confidence: 60,
      estimation_notes: 'Estimated based on typical restaurant portions and ingredients. Actual values may vary.',
      similar_known_items: []
    });

  } catch (err: any) {
    console.error('[restaurant] estimate-item error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default restaurantRouter;
