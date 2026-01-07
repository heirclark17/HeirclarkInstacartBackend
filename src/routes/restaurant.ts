// src/routes/restaurant.ts - RestaurantAdvisor Skill Routes
import { Router, Request, Response } from 'express';
import { Pool } from 'pg';
import OpenAI from 'openai';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false },
});

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || '',
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
  'chickfila': [
    { name: 'Grilled Chicken Sandwich', category: 'sandwiches', calories: 380, protein: 28, carbs: 44, fat: 6, customizable: false },
    { name: 'Chicken Nuggets (12-count)', category: 'entrees', calories: 380, protein: 40, carbs: 16, fat: 17, customizable: false },
    { name: 'Spicy Southwest Salad', category: 'salads', calories: 450, protein: 33, carbs: 28, fat: 23, customizable: true },
    { name: 'Grilled Chicken Cool Wrap', category: 'wraps', calories: 350, protein: 37, carbs: 29, fat: 13, customizable: false },
    { name: 'Chicken Sandwich', category: 'sandwiches', calories: 440, protein: 28, carbs: 41, fat: 17, customizable: false },
    { name: 'Cobb Salad', category: 'salads', calories: 510, protein: 40, carbs: 27, fat: 28, customizable: true },
    { name: 'Waffle Potato Fries (Medium)', category: 'sides', calories: 360, protein: 5, carbs: 43, fat: 18, customizable: false },
    { name: 'Hash Browns', category: 'breakfast', calories: 270, protein: 3, carbs: 25, fat: 18, customizable: false },
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
  'subway': [
    { name: "6\" Turkey Breast", category: "sandwiches", calories: 280, protein: 18, carbs: 46, fat: 3.5, customizable: true },
    { name: "6\" Chicken & Bacon Ranch", category: "sandwiches", calories: 530, protein: 36, carbs: 45, fat: 24, customizable: true },
    { name: "6\" Veggie Delite", category: "sandwiches", calories: 230, protein: 8, carbs: 44, fat: 2.5, customizable: true },
    { name: "Rotisserie Chicken Salad", category: "salads", calories: 350, protein: 29, carbs: 11, fat: 22, customizable: true },
    { name: "6\" Steak & Cheese", category: "sandwiches", calories: 380, protein: 23, carbs: 48, fat: 10, customizable: true },
    { name: "6\" Tuna", category: "sandwiches", calories: 470, protein: 20, carbs: 45, fat: 23, customizable: true },
    { name: "Egg & Cheese Wrap", category: "breakfast", calories: 390, protein: 19, carbs: 38, fat: 17, customizable: true },
    { name: "6\" Sweet Onion Chicken Teriyaki", category: "sandwiches", calories: 370, protein: 25, carbs: 57, fat: 4.5, customizable: true },
  ],
  'mcdonalds': [
    { name: "Big Mac", category: "burgers", calories: 550, protein: 25, carbs: 45, fat: 30, customizable: false },
    { name: "Quarter Pounder with Cheese", category: "burgers", calories: 520, protein: 26, carbs: 42, fat: 26, customizable: false },
    { name: "10-Piece Chicken McNuggets", category: "chicken", calories: 420, protein: 23, carbs: 25, fat: 24, customizable: false },
    { name: "Premium Southwest Salad (Grilled)", category: "salads", calories: 350, protein: 37, carbs: 27, fat: 12, customizable: true },
    { name: "Artisan Grilled Chicken Sandwich", category: "chicken", calories: 380, protein: 37, carbs: 44, fat: 7, customizable: false },
    { name: "Filet-O-Fish", category: "fish", calories: 380, protein: 15, carbs: 39, fat: 18, customizable: false },
    { name: "Egg McMuffin", category: "breakfast", calories: 300, protein: 17, carbs: 30, fat: 13, customizable: false },
    { name: "Fruit & Maple Oatmeal", category: "breakfast", calories: 320, protein: 6, carbs: 64, fat: 4.5, customizable: false },
  ],
  'wendys': [
    { name: "Dave's Single", category: "burgers", calories: 570, protein: 29, carbs: 41, fat: 34, customizable: true },
    { name: "Grilled Chicken Sandwich", category: "chicken", calories: 370, protein: 34, carbs: 37, fat: 10, customizable: false },
    { name: "Spicy Chicken Sandwich", category: "chicken", calories: 490, protein: 29, carbs: 48, fat: 20, customizable: false },
    { name: "Southwest Avocado Chicken Salad", category: "salads", calories: 520, protein: 33, carbs: 31, fat: 31, customizable: true },
    { name: "Apple Pecan Chicken Salad", category: "salads", calories: 560, protein: 34, carbs: 39, fat: 30, customizable: true },
    { name: "Homestyle Chicken Go Wrap (Grilled)", category: "wraps", calories: 270, protein: 18, carbs: 25, fat: 10, customizable: false },
    { name: "Jr. Bacon Cheeseburger", category: "burgers", calories: 370, protein: 19, carbs: 26, fat: 21, customizable: true },
    { name: "Chili (Small)", category: "sides", calories: 250, protein: 17, carbs: 23, fat: 9, customizable: false },
  ],
  'tacobell': [
    { name: "Chicken Power Bowl", category: "bowls", calories: 470, protein: 26, carbs: 50, fat: 17, customizable: true },
    { name: "Chicken Soft Taco", category: "tacos", calories: 160, protein: 12, carbs: 15, fat: 5, customizable: true },
    { name: "Crunchy Taco", category: "tacos", calories: 170, protein: 8, carbs: 13, fat: 10, customizable: true },
    { name: "Chicken Burrito", category: "burritos", calories: 350, protein: 13, carbs: 48, fat: 11, customizable: true },
    { name: "Grilled Steak Soft Taco", category: "tacos", calories: 180, protein: 12, carbs: 17, fat: 6, customizable: true },
    { name: "Black Beans & Rice", category: "sides", calories: 180, protein: 5, carbs: 33, fat: 3.5, customizable: false },
    { name: "Veggie Power Bowl", category: "bowls", calories: 450, protein: 13, carbs: 62, fat: 16, customizable: true },
    { name: "Breakfast Crunchwrap (Steak)", category: "breakfast", calories: 680, protein: 21, carbs: 71, fat: 35, customizable: true },
  ],
};

/**
 * Use OpenAI to generate personalized restaurant recommendations
 */
async function generateRecommendationsWithAI(
  restaurant: string,
  maxCalories: number,
  remainingBudget: any,
  priorities?: string[]
): Promise<any[]> {
  try {
    const prompt = `You are a nutrition expert helping someone choose healthy meals at ${restaurant}.

User's constraints:
- Max calories: ${maxCalories}
- Remaining daily protein goal: ${remainingBudget.protein}g
- Priorities: ${priorities?.join(', ') || 'balanced nutrition'}

Generate 3 specific menu item recommendations from ${restaurant}'s actual menu that:
1. Stay within the calorie budget
2. Maximize protein content
3. Are realistic items that ${restaurant} actually serves

For each recommendation, provide:
- Item name (real menu item)
- Category (e.g., bowls, sandwiches, salads, entrees)
- Estimated calories
- Estimated protein (g)
- Estimated carbs (g)
- Estimated fat (g)
- Customization tips (if applicable)
- Fit score (0-100, higher is better for their goals)

Return as JSON array with this structure:
[
  {
    "name": "Item Name",
    "category": "category",
    "calories": number,
    "protein": number,
    "carbs": number,
    "fat": number,
    "customizable": boolean,
    "customization_tips": "Specific tips for this item",
    "fit_score": number,
    "why_recommended": "Brief explanation"
  }
]

IMPORTANT: Return ONLY valid JSON, no markdown, no explanations outside the JSON.`;

    const completion = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'You are a nutrition expert with deep knowledge of restaurant menus. Return only valid JSON arrays.'
        },
        { role: 'user', content: prompt }
      ],
      temperature: 0.3,
      max_tokens: 1500,
    });

    const content = completion.choices[0]?.message?.content || '[]';

    // Extract JSON from potential markdown code blocks
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    const items = JSON.parse(jsonMatch ? jsonMatch[0] : content);

    return items;
  } catch (error: any) {
    console.error('[restaurant] OpenAI generation error:', error.message);
    return [];
  }
}

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
      // Unknown restaurant - use OpenAI to generate recommendations
      console.log(`[restaurant] Generating AI recommendations for ${restaurant}`);

      const aiItems = await generateRecommendationsWithAI(
        restaurant,
        effectiveMaxCalories,
        remainingBudget,
        priorities
      );

      if (aiItems.length === 0) {
        // AI generation failed - provide general guidance
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

      // Format AI recommendations
      const aiRecommendations = aiItems.map((item: any, index: number) => ({
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
          build: item.customization_tips?.split(';').slice(0, 2) || ['Ask for extra protein if available'],
          skip: item.customization_tips?.split(';').slice(2) || ['Minimize sauces and dressings'],
          why: item.why_recommended || 'Good balance of protein and calories'
        } : null,
        final_nutrition: {
          calories: item.calories,
          protein: item.protein,
          carbs: item.carbs,
          fat: item.fat
        },
        fit_score: item.fit_score || 75,
        fits_budget: item.calories <= remainingBudget.calories,
        ai_generated: true
      }));

      return res.json({
        ok: true,
        restaurant,
        restaurant_found: true,
        ai_generated: true,
        remaining_budget: remainingBudget,
        recommendations: aiRecommendations,
        general_tips: [
          'These recommendations are AI-generated based on typical restaurant offerings',
          'Actual menu items and nutrition may vary',
          'Verify with restaurant staff for exact nutrition information'
        ]
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
