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

/**
 * Get menu items from database
 */
async function getMenuFromDatabase(restaurantId: string, dietaryRestrictions?: string[]): Promise<any[]> {
  try {
    let query = `SELECT
        id, name, category, calories, protein, carbs, fat,
        price_cents, is_vegetarian, is_vegan, is_gluten_free, is_dairy_free, is_keto_friendly,
        allergens, dietary_flags, customizable, customization_tips, source, confidence_score
       FROM restaurant_menu_items
       WHERE restaurant_id = $1`;

    const params: any[] = [restaurantId];

    // Add dietary restriction filters
    if (dietaryRestrictions && dietaryRestrictions.length > 0) {
      if (dietaryRestrictions.includes('vegetarian')) {
        query += ' AND is_vegetarian = true';
      }
      if (dietaryRestrictions.includes('vegan')) {
        query += ' AND is_vegan = true';
      }
      if (dietaryRestrictions.includes('gluten_free') || dietaryRestrictions.includes('gluten-free')) {
        query += ' AND is_gluten_free = true';
      }
      if (dietaryRestrictions.includes('dairy_free') || dietaryRestrictions.includes('dairy-free')) {
        query += ' AND is_dairy_free = true';
      }
      if (dietaryRestrictions.includes('keto') || dietaryRestrictions.includes('keto_friendly')) {
        query += ' AND is_keto_friendly = true';
      }
    }

    query += ' ORDER BY recommendation_count DESC, calories ASC';

    const result = await pool.query(query, params);
    return result.rows;
  } catch (error: any) {
    console.error('[restaurant] Database query error:', error.message);
    return [];
  }
}

/**
 * Save AI-generated menu items to database for future use
 */
async function cacheMenuItems(restaurantId: string, restaurantName: string, items: any[]): Promise<void> {
  try {
    for (const item of items) {
      await pool.query(
        `INSERT INTO restaurant_menu_items
         (restaurant_id, restaurant_name, name, category, calories, protein, carbs, fat,
          price_cents, is_vegetarian, is_vegan, is_gluten_free, is_dairy_free, is_keto_friendly,
          allergens, dietary_flags, customizable, customization_tips, source, confidence_score)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, 'ai', $19)
         ON CONFLICT (restaurant_id, name) DO UPDATE
         SET recommendation_count = restaurant_menu_items.recommendation_count + 1,
             last_recommended_at = NOW(),
             price_cents = COALESCE(EXCLUDED.price_cents, restaurant_menu_items.price_cents),
             is_vegetarian = COALESCE(EXCLUDED.is_vegetarian, restaurant_menu_items.is_vegetarian),
             is_vegan = COALESCE(EXCLUDED.is_vegan, restaurant_menu_items.is_vegan),
             is_gluten_free = COALESCE(EXCLUDED.is_gluten_free, restaurant_menu_items.is_gluten_free),
             is_dairy_free = COALESCE(EXCLUDED.is_dairy_free, restaurant_menu_items.is_dairy_free),
             is_keto_friendly = COALESCE(EXCLUDED.is_keto_friendly, restaurant_menu_items.is_keto_friendly),
             allergens = COALESCE(EXCLUDED.allergens, restaurant_menu_items.allergens),
             dietary_flags = COALESCE(EXCLUDED.dietary_flags, restaurant_menu_items.dietary_flags)`,
        [
          restaurantId,
          restaurantName,
          item.name,
          item.category,
          item.calories,
          item.protein,
          item.carbs,
          item.fat,
          item.price_cents || 0,
          item.is_vegetarian || false,
          item.is_vegan || false,
          item.is_gluten_free || false,
          item.is_dairy_free || false,
          item.is_keto_friendly || false,
          JSON.stringify(item.allergens || []),
          JSON.stringify(item.dietary_flags || []),
          item.customizable || false,
          item.customization_tips || null,
          item.fit_score || 75
        ]
      );
    }
    console.log(`[restaurant] Cached ${items.length} items for ${restaurantName}`);
  } catch (error: any) {
    console.error('[restaurant] Cache error:', error.message);
  }
}

// Legacy hardcoded menus (fallback only - database is primary source)
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
  priorities?: string[],
  dietaryRestrictions?: string[]
): Promise<any[]> {
  try {
    const dietaryText = dietaryRestrictions && dietaryRestrictions.length > 0
      ? `\n- Dietary restrictions: ${dietaryRestrictions.join(', ')}`
      : '';

    const prompt = `You are a nutrition expert helping someone choose healthy meals at ${restaurant}.

User's constraints:
- Max calories: ${maxCalories}
- Remaining daily protein goal: ${remainingBudget.protein}g
- Priorities: ${priorities?.join(', ') || 'balanced nutrition'}${dietaryText}

Generate 3 specific menu item recommendations from ${restaurant}'s actual menu that:
1. Stay within the calorie budget
2. Maximize protein content
3. Respect dietary restrictions (${dietaryRestrictions?.length ? dietaryRestrictions.join(', ') : 'none'})
4. Are realistic items that ${restaurant} actually serves

For each recommendation, provide:
- Item name (real menu item from ${restaurant})
- Category (e.g., bowls, sandwiches, salads, entrees, burgers, etc.)
- Estimated calories
- Estimated protein (g)
- Estimated carbs (g)
- Estimated fat (g)
- Estimated price in cents (e.g., 995 for $9.95)
- Dietary flags (is_vegetarian, is_vegan, is_gluten_free, is_dairy_free, is_keto_friendly)
- Allergens (array of allergens: ["gluten", "dairy", "nuts", "soy", "eggs", "shellfish", "fish"])
- Customizable (can the item be modified?)
- Customization tips (if customizable: specific modifications to make it better)
- Fit score (0-100 based on how well it matches their goals)
- Why recommended (1-2 sentences explaining WHY this specific item works for THIS specific user's goals and remaining macros)

IMPORTANT: The "why_recommended" MUST be personalized and specific:
- Reference their exact remaining calories (${maxCalories})
- Reference their protein goal (${remainingBudget.protein}g)
- Mention their priorities (${priorities?.join(', ') || 'balanced nutrition'})
- Explain how THIS meal helps THEM specifically
- Be conversational and encouraging

Example of good "why_recommended":
"With ${remainingBudget.protein}g of protein still needed today, this ${Math.round(remainingBudget.protein / 2)}g protein boost gets you halfway there while keeping you under ${maxCalories} calories. Perfect for your ${priorities?.includes('high_protein') ? 'high-protein goal' : 'macro balance'}."

Return as JSON array:
[
  {
    "name": "Item Name",
    "category": "category",
    "calories": number,
    "protein": number,
    "carbs": number,
    "fat": number,
    "price_cents": number,
    "is_vegetarian": boolean,
    "is_vegan": boolean,
    "is_gluten_free": boolean,
    "is_dairy_free": boolean,
    "is_keto_friendly": boolean,
    "allergens": ["allergen1", "allergen2"],
    "customizable": boolean,
    "customization_tips": "Specific tips",
    "fit_score": number,
    "why_recommended": "Personalized 1-2 sentence explanation referencing their exact goals"
  }
]

CRITICAL: Return ONLY valid JSON, no markdown, no explanations outside the JSON.`;

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

    // Fetch user dietary preferences
    let dietaryRestrictions: string[] = [];
    try {
      const prefsResult = await pool.query(
        `SELECT is_vegetarian, is_vegan, is_gluten_free, is_dairy_free, is_keto,
                is_paleo, is_halal, is_kosher, allergens, disliked_foods
         FROM user_dietary_preferences WHERE user_id = $1`,
        [shopifyCustomerId]
      );

      if (prefsResult.rows.length > 0) {
        const prefs = prefsResult.rows[0];
        if (prefs.is_vegetarian) dietaryRestrictions.push('vegetarian');
        if (prefs.is_vegan) dietaryRestrictions.push('vegan');
        if (prefs.is_gluten_free) dietaryRestrictions.push('gluten_free');
        if (prefs.is_dairy_free) dietaryRestrictions.push('dairy_free');
        if (prefs.is_keto) dietaryRestrictions.push('keto');
        if (prefs.is_paleo) dietaryRestrictions.push('paleo');
        if (prefs.is_halal) dietaryRestrictions.push('halal');
        if (prefs.is_kosher) dietaryRestrictions.push('kosher');
      }
    } catch (error: any) {
      console.log('[restaurant] No dietary preferences found for user, continuing without restrictions');
    }

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

    // ALWAYS use AI generation for personalized, meal-specific recommendations
    if (true) {
      // AI-powered recommendations - personalized to user's exact goals
      console.log(`[restaurant] Generating AI recommendations for ${restaurant}`);

      const aiItems = await generateRecommendationsWithAI(
        restaurant,
        effectiveMaxCalories,
        remainingBudget,
        priorities,
        dietaryRestrictions
      );

      // Cache the AI-generated items for future use
      if (aiItems.length > 0) {
        await cacheMenuItems(normalizedName, restaurant, aiItems);
      }

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
        price: item.price_cents ? {
          cents: item.price_cents,
          formatted: `$${(item.price_cents / 100).toFixed(2)}`,
          protein_per_dollar: item.price_cents > 0 ? (item.protein / (item.price_cents / 100)).toFixed(2) : null
        } : null,
        dietary_info: {
          is_vegetarian: item.is_vegetarian || false,
          is_vegan: item.is_vegan || false,
          is_gluten_free: item.is_gluten_free || false,
          is_dairy_free: item.is_dairy_free || false,
          is_keto_friendly: item.is_keto_friendly || false,
          allergens: item.allergens || []
        },
        customization: item.customizable ? {
          build: item.customization_tips?.includes(';')
            ? item.customization_tips.split(';').map((tip: string) => tip.trim()).filter((tip: string) => tip.startsWith('Add') || tip.startsWith('Request') || tip.startsWith('Ask for'))
            : [item.customization_tips || 'Ask for extra protein if available'],
          skip: item.customization_tips?.includes(';')
            ? item.customization_tips.split(';').map((tip: string) => tip.trim()).filter((tip: string) => tip.startsWith('Skip') || tip.startsWith('No') || tip.startsWith('Hold'))
            : ['Minimize sauces and dressings'],
          why: item.why_recommended || 'AI-personalized recommendation for your goals'
        } : {
          build: [],
          skip: [],
          why: item.why_recommended || 'Recommended based on your calorie and protein targets'
        },
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

/**
 * GET /api/v1/user/dietary-preferences
 * Get user's dietary preferences
 */
restaurantRouter.get('/user/dietary-preferences/:shopifyCustomerId', async (req: Request, res: Response) => {
  try {
    const { shopifyCustomerId } = req.params;

    if (!shopifyCustomerId) {
      return res.status(400).json({ ok: false, error: 'Missing shopifyCustomerId' });
    }

    const result = await pool.query(
      `SELECT * FROM user_dietary_preferences WHERE user_id = $1`,
      [shopifyCustomerId]
    );

    if (result.rows.length === 0) {
      return res.json({
        ok: true,
        preferences: null,
        message: 'No dietary preferences set'
      });
    }

    res.json({
      ok: true,
      preferences: result.rows[0]
    });
  } catch (err: any) {
    console.error('[restaurant] get dietary preferences error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * POST /api/v1/user/dietary-preferences
 * Set or update user's dietary preferences
 */
restaurantRouter.post('/user/dietary-preferences', async (req: Request, res: Response) => {
  try {
    const {
      shopifyCustomerId,
      is_vegetarian,
      is_vegan,
      is_gluten_free,
      is_dairy_free,
      is_keto,
      is_paleo,
      is_halal,
      is_kosher,
      allergens,
      disliked_foods,
      max_meal_budget_cents,
      prefer_value_options
    } = req.body;

    if (!shopifyCustomerId) {
      return res.status(400).json({ ok: false, error: 'Missing shopifyCustomerId' });
    }

    const result = await pool.query(
      `INSERT INTO user_dietary_preferences
       (user_id, is_vegetarian, is_vegan, is_gluten_free, is_dairy_free, is_keto,
        is_paleo, is_halal, is_kosher, allergens, disliked_foods,
        max_meal_budget_cents, prefer_value_options)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       ON CONFLICT (user_id) DO UPDATE
       SET is_vegetarian = EXCLUDED.is_vegetarian,
           is_vegan = EXCLUDED.is_vegan,
           is_gluten_free = EXCLUDED.is_gluten_free,
           is_dairy_free = EXCLUDED.is_dairy_free,
           is_keto = EXCLUDED.is_keto,
           is_paleo = EXCLUDED.is_paleo,
           is_halal = EXCLUDED.is_halal,
           is_kosher = EXCLUDED.is_kosher,
           allergens = EXCLUDED.allergens,
           disliked_foods = EXCLUDED.disliked_foods,
           max_meal_budget_cents = EXCLUDED.max_meal_budget_cents,
           prefer_value_options = EXCLUDED.prefer_value_options,
           updated_at = NOW()
       RETURNING *`,
      [
        shopifyCustomerId,
        is_vegetarian || false,
        is_vegan || false,
        is_gluten_free || false,
        is_dairy_free || false,
        is_keto || false,
        is_paleo || false,
        is_halal || false,
        is_kosher || false,
        JSON.stringify(allergens || []),
        JSON.stringify(disliked_foods || []),
        max_meal_budget_cents || null,
        prefer_value_options || false
      ]
    );

    res.json({
      ok: true,
      preferences: result.rows[0],
      message: 'Dietary preferences saved successfully'
    });
  } catch (err: any) {
    console.error('[restaurant] save dietary preferences error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * POST /api/v1/restaurant/rate
 * Rate a restaurant menu item
 */
restaurantRouter.post('/rate', async (req: Request, res: Response) => {
  try {
    const {
      shopifyCustomerId,
      menuItemId,
      restaurantId,
      rating,
      review_text,
      calories_accurate,
      protein_accurate,
      taste_rating,
      value_rating,
      verified_order
    } = req.body;

    if (!shopifyCustomerId || !menuItemId || !restaurantId || !rating) {
      return res.status(400).json({
        ok: false,
        error: 'Missing required fields: shopifyCustomerId, menuItemId, restaurantId, rating'
      });
    }

    if (rating < 1 || rating > 5) {
      return res.status(400).json({ ok: false, error: 'Rating must be between 1 and 5' });
    }

    const result = await pool.query(
      `INSERT INTO restaurant_item_ratings
       (user_id, menu_item_id, restaurant_id, rating, review_text,
        calories_accurate, protein_accurate, taste_rating, value_rating, verified_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (user_id, menu_item_id) DO UPDATE
       SET rating = EXCLUDED.rating,
           review_text = EXCLUDED.review_text,
           calories_accurate = EXCLUDED.calories_accurate,
           protein_accurate = EXCLUDED.protein_accurate,
           taste_rating = EXCLUDED.taste_rating,
           value_rating = EXCLUDED.value_rating,
           verified_order = EXCLUDED.verified_order,
           updated_at = NOW()
       RETURNING *`,
      [
        shopifyCustomerId,
        menuItemId,
        restaurantId,
        rating,
        review_text || null,
        calories_accurate || null,
        protein_accurate || null,
        taste_rating || null,
        value_rating || null,
        verified_order || false
      ]
    );

    res.json({
      ok: true,
      rating: result.rows[0],
      message: 'Rating submitted successfully'
    });
  } catch (err: any) {
    console.error('[restaurant] rate item error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * GET /api/v1/restaurant/ratings/:menuItemId
 * Get ratings for a menu item
 */
restaurantRouter.get('/ratings/:menuItemId', async (req: Request, res: Response) => {
  try {
    const { menuItemId } = req.params;

    const result = await pool.query(
      `SELECT
        r.*,
        COUNT(*) OVER() as total_ratings,
        AVG(rating) OVER() as avg_rating
       FROM restaurant_item_ratings r
       WHERE menu_item_id = $1
       ORDER BY created_at DESC
       LIMIT 50`,
      [menuItemId]
    );

    res.json({
      ok: true,
      ratings: result.rows,
      summary: result.rows.length > 0 ? {
        total_ratings: result.rows[0].total_ratings,
        avg_rating: parseFloat(result.rows[0].avg_rating).toFixed(1)
      } : { total_ratings: 0, avg_rating: 0 }
    });
  } catch (err: any) {
    console.error('[restaurant] get ratings error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * POST /api/v1/restaurant/favorite
 * Add item to user's favorites
 */
restaurantRouter.post('/favorite', async (req: Request, res: Response) => {
  try {
    const {
      shopifyCustomerId,
      restaurantId,
      menuItemId,
      orderName,
      customizations
    } = req.body;

    if (!shopifyCustomerId || !restaurantId || !menuItemId) {
      return res.status(400).json({
        ok: false,
        error: 'Missing required fields: shopifyCustomerId, restaurantId, menuItemId'
      });
    }

    const result = await pool.query(
      `INSERT INTO user_favorite_orders
       (user_id, restaurant_id, menu_item_id, order_name, customizations, times_ordered, last_ordered_at)
       VALUES ($1, $2, $3, $4, $5, 1, NOW())
       ON CONFLICT (user_id, restaurant_id, menu_item_id)
       DO UPDATE SET
         times_ordered = user_favorite_orders.times_ordered + 1,
         last_ordered_at = NOW(),
         customizations = COALESCE(EXCLUDED.customizations, user_favorite_orders.customizations)
       RETURNING *`,
      [shopifyCustomerId, restaurantId, menuItemId, orderName || null, customizations || null]
    );

    res.json({
      ok: true,
      favorite: result.rows[0],
      message: 'Added to favorites'
    });
  } catch (err: any) {
    console.error('[restaurant] add favorite error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * GET /api/v1/restaurant/favorites/:shopifyCustomerId
 * Get user's favorite orders
 */
restaurantRouter.get('/favorites/:shopifyCustomerId', async (req: Request, res: Response) => {
  try {
    const { shopifyCustomerId } = req.params;
    const { restaurantId } = req.query;

    let query = `
      SELECT f.*, m.name, m.category, m.calories, m.protein, m.carbs, m.fat
      FROM user_favorite_orders f
      LEFT JOIN restaurant_menu_items m ON f.menu_item_id = m.id
      WHERE f.user_id = $1
    `;
    const params: any[] = [shopifyCustomerId];

    if (restaurantId) {
      query += ' AND f.restaurant_id = $2';
      params.push(restaurantId);
    }

    query += ' ORDER BY f.last_ordered_at DESC';

    const result = await pool.query(query, params);

    res.json({
      ok: true,
      favorites: result.rows
    });
  } catch (err: any) {
    console.error('[restaurant] get favorites error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * POST /api/v1/restaurant/locations
 * Add or update a restaurant location
 */
restaurantRouter.post('/locations', async (req: Request, res: Response) => {
  try {
    const {
      restaurantId,
      restaurantName,
      placeId,
      address,
      city,
      state,
      zipCode,
      country,
      latitude,
      longitude,
      phone,
      website,
      isChainLocation,
      chainName,
      rating,
      totalRatings,
      hours
    } = req.body;

    if (!restaurantId || !restaurantName || !latitude || !longitude) {
      return res.status(400).json({
        ok: false,
        error: 'Missing required fields: restaurantId, restaurantName, latitude, longitude'
      });
    }

    const result = await pool.query(
      `INSERT INTO restaurant_locations
       (restaurant_id, restaurant_name, place_id, address, city, state, zip_code, country,
        latitude, longitude, phone, website, is_chain_location, chain_name, rating, total_ratings, hours)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
       ON CONFLICT (place_id) DO UPDATE
       SET restaurant_name = EXCLUDED.restaurant_name,
           address = EXCLUDED.address,
           city = EXCLUDED.city,
           state = EXCLUDED.state,
           zip_code = EXCLUDED.zip_code,
           phone = EXCLUDED.phone,
           website = EXCLUDED.website,
           rating = EXCLUDED.rating,
           total_ratings = EXCLUDED.total_ratings,
           hours = EXCLUDED.hours,
           updated_at = NOW()
       RETURNING *`,
      [
        restaurantId, restaurantName, placeId || null, address || null, city || null,
        state || null, zipCode || null, country || 'USA', latitude, longitude,
        phone || null, website || null, isChainLocation || false, chainName || null,
        rating || null, totalRatings || 0, JSON.stringify(hours || {})
      ]
    );

    res.json({
      ok: true,
      location: result.rows[0],
      message: 'Location saved successfully'
    });
  } catch (err: any) {
    console.error('[restaurant] save location error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * GET /api/v1/restaurant/nearby
 * Find nearby restaurants based on coordinates
 */
restaurantRouter.get('/nearby', async (req: Request, res: Response) => {
  try {
    const { latitude, longitude, radius_miles } = req.query;

    if (!latitude || !longitude) {
      return res.status(400).json({
        ok: false,
        error: 'Missing required parameters: latitude, longitude'
      });
    }

    const radiusMiles = radius_miles ? parseFloat(radius_miles as string) : 5;
    const lat = parseFloat(latitude as string);
    const lng = parseFloat(longitude as string);

    // Use earth distance function for spatial queries
    const result = await pool.query(
      `SELECT *,
        earth_distance(
          ll_to_earth(latitude::float8, longitude::float8),
          ll_to_earth($1, $2)
        ) * 0.000621371 as distance_miles
       FROM restaurant_locations
       WHERE earth_box(ll_to_earth($1, $2), $3 * 1609.34) @> ll_to_earth(latitude::float8, longitude::float8)
       ORDER BY distance_miles ASC
       LIMIT 50`,
      [lat, lng, radiusMiles]
    );

    res.json({
      ok: true,
      locations: result.rows,
      search_center: { latitude: lat, longitude: lng },
      radius_miles: radiusMiles
    });
  } catch (err: any) {
    console.error('[restaurant] nearby search error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * GET /api/v1/restaurant/location/:placeId
 * Get location details by place ID
 */
restaurantRouter.get('/location/:placeId', async (req: Request, res: Response) => {
  try {
    const { placeId } = req.params;

    const result = await pool.query(
      `SELECT * FROM restaurant_locations WHERE place_id = $1`,
      [placeId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        ok: false,
        error: 'Location not found'
      });
    }

    res.json({
      ok: true,
      location: result.rows[0]
    });
  } catch (err: any) {
    console.error('[restaurant] get location error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * GET /api/v1/restaurant/locations/search
 * Search restaurants by city/state
 */
restaurantRouter.get('/locations/search', async (req: Request, res: Response) => {
  try {
    const { city, state, restaurantName } = req.query;

    if (!city && !state && !restaurantName) {
      return res.status(400).json({
        ok: false,
        error: 'At least one search parameter required: city, state, or restaurantName'
      });
    }

    let query = 'SELECT * FROM restaurant_locations WHERE 1=1';
    const params: any[] = [];
    let paramCount = 0;

    if (city) {
      paramCount++;
      query += ` AND LOWER(city) = LOWER($${paramCount})`;
      params.push(city);
    }

    if (state) {
      paramCount++;
      query += ` AND LOWER(state) = LOWER($${paramCount})`;
      params.push(state);
    }

    if (restaurantName) {
      paramCount++;
      query += ` AND LOWER(restaurant_name) LIKE LOWER($${paramCount})`;
      params.push(`%${restaurantName}%`);
    }

    query += ' ORDER BY restaurant_name, city LIMIT 100';

    const result = await pool.query(query, params);

    res.json({
      ok: true,
      locations: result.rows,
      total: result.rows.length
    });
  } catch (err: any) {
    console.error('[restaurant] location search error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * POST /api/v1/restaurant/analyze-photo
 * Analyze a menu photo using AI vision
 */
restaurantRouter.post('/analyze-photo', async (req: Request, res: Response) => {
  try {
    const { shopifyCustomerId, restaurantId, restaurantName, photoUrl } = req.body;

    if (!shopifyCustomerId || !photoUrl) {
      return res.status(400).json({
        ok: false,
        error: 'Missing required fields: shopifyCustomerId, photoUrl'
      });
    }

    // Save the photo record immediately
    const photoRecord = await pool.query(
      `INSERT INTO menu_photo_uploads
       (user_id, restaurant_id, restaurant_name, photo_url, ai_analyzed)
       VALUES ($1, $2, $3, $4, false)
       RETURNING *`,
      [shopifyCustomerId, restaurantId || null, restaurantName || null, photoUrl]
    );

    const photoId = photoRecord.rows[0].id;

    // Analyze the photo with OpenAI Vision
    try {
      const visionCompletion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `You are a nutrition expert analyzing restaurant menu photos. Extract all visible menu items with their nutritional information.`
          },
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: `Analyze this menu photo and extract all visible menu items. For each item, provide:
- Item name
- Category (appetizer, entree, sandwich, salad, etc.)
- Estimated calories
- Estimated protein (g)
- Estimated carbs (g)
- Estimated fat (g)
- Price (if visible)
- Dietary flags (vegetarian, vegan, gluten-free, dairy-free)
- Brief description

Return as JSON array with confidence score (0-100) for each item:
{
  "items": [
    {
      "name": "Item Name",
      "category": "category",
      "calories": number,
      "protein": number,
      "carbs": number,
      "fat": number,
      "price_cents": number or null,
      "is_vegetarian": boolean,
      "is_vegan": boolean,
      "is_gluten_free": boolean,
      "is_dairy_free": boolean,
      "description": "brief description",
      "confidence": number (0-100)
    }
  ],
  "restaurant_detected": "restaurant name if visible",
  "overall_confidence": number (0-100)
}`
              },
              {
                type: 'image_url',
                image_url: { url: photoUrl }
              }
            ]
          }
        ],
        max_tokens: 2000
      });

      const visionContent = visionCompletion.choices[0]?.message?.content || '{}';
      const jsonMatch = visionContent.match(/\{[\s\S]*\}/);
      const analysisResult = JSON.parse(jsonMatch ? jsonMatch[0] : visionContent);

      // Update the photo record with AI analysis
      await pool.query(
        `UPDATE menu_photo_uploads
         SET ai_analyzed = true,
             detected_items = $1,
             confidence_score = $2
         WHERE id = $3`,
        [
          JSON.stringify(analysisResult.items || []),
          analysisResult.overall_confidence || 0,
          photoId
        ]
      );

      res.json({
        ok: true,
        photo_id: photoId,
        analysis: analysisResult,
        message: `Detected ${analysisResult.items?.length || 0} menu items`
      });
    } catch (aiError: any) {
      console.error('[restaurant] AI vision analysis error:', aiError.message);

      // Mark photo as analyzed but with error
      await pool.query(
        `UPDATE menu_photo_uploads
         SET ai_analyzed = true,
             confidence_score = 0
         WHERE id = $1`,
        [photoId]
      );

      res.json({
        ok: false,
        photo_id: photoId,
        error: 'Failed to analyze photo with AI',
        details: aiError.message
      });
    }
  } catch (err: any) {
    console.error('[restaurant] analyze-photo error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * GET /api/v1/restaurant/photos/:shopifyCustomerId
 * Get user's uploaded menu photos
 */
restaurantRouter.get('/photos/:shopifyCustomerId', async (req: Request, res: Response) => {
  try {
    const { shopifyCustomerId } = req.params;
    const { restaurantId } = req.query;

    let query = `SELECT * FROM menu_photo_uploads WHERE user_id = $1`;
    const params: any[] = [shopifyCustomerId];

    if (restaurantId) {
      query += ' AND restaurant_id = $2';
      params.push(restaurantId);
    }

    query += ' ORDER BY created_at DESC LIMIT 50';

    const result = await pool.query(query, params);

    res.json({
      ok: true,
      photos: result.rows
    });
  } catch (err: any) {
    console.error('[restaurant] get photos error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * POST /api/v1/restaurant/photo/:photoId/confirm
 * User confirms or corrects AI analysis
 */
restaurantRouter.post('/photo/:photoId/confirm', async (req: Request, res: Response) => {
  try {
    const { photoId } = req.params;
    const { corrections } = req.body;

    const result = await pool.query(
      `UPDATE menu_photo_uploads
       SET user_confirmed = true,
           user_corrections = $1
       WHERE id = $2
       RETURNING *`,
      [JSON.stringify(corrections || {}), photoId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ ok: false, error: 'Photo not found' });
    }

    res.json({
      ok: true,
      photo: result.rows[0],
      message: 'Photo analysis confirmed'
    });
  } catch (err: any) {
    console.error('[restaurant] confirm photo error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * POST /api/v1/restaurant/share
 * Share restaurant recommendations
 */
restaurantRouter.post('/share', async (req: Request, res: Response) => {
  try {
    const {
      shopifyCustomerId,
      restaurantId,
      restaurantName,
      menuItemIds,
      title,
      description,
      photoUrl,
      visibility
    } = req.body;

    if (!shopifyCustomerId || !restaurantId || !restaurantName) {
      return res.status(400).json({
        ok: false,
        error: 'Missing required fields: shopifyCustomerId, restaurantId, restaurantName'
      });
    }

    // Generate a unique share ID
    const shareId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    const result = await pool.query(
      `INSERT INTO shared_recommendations
       (share_id, user_id, restaurant_id, restaurant_name, menu_item_ids, title, description, photo_url, visibility)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        shareId,
        shopifyCustomerId,
        restaurantId,
        restaurantName,
        menuItemIds || [],
        title || null,
        description || null,
        photoUrl || null,
        visibility || 'public'
      ]
    );

    res.json({
      ok: true,
      share: result.rows[0],
      share_url: `${process.env.FRONTEND_URL || 'https://heirclark.com'}/shared/${shareId}`,
      message: 'Recommendation shared successfully'
    });
  } catch (err: any) {
    console.error('[restaurant] share error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * GET /api/v1/restaurant/shared/:shareId
 * Get shared recommendation details
 */
restaurantRouter.get('/shared/:shareId', async (req: Request, res: Response) => {
  try {
    const { shareId } = req.params;

    const result = await pool.query(
      `UPDATE shared_recommendations
       SET view_count = view_count + 1
       WHERE share_id = $1
       RETURNING *`,
      [shareId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ ok: false, error: 'Shared recommendation not found' });
    }

    const share = result.rows[0];

    // Fetch menu item details if menu_item_ids exist
    let menuItems = [];
    if (share.menu_item_ids && share.menu_item_ids.length > 0) {
      const itemsResult = await pool.query(
        `SELECT * FROM restaurant_menu_items WHERE id = ANY($1)`,
        [share.menu_item_ids]
      );
      menuItems = itemsResult.rows;
    }

    res.json({
      ok: true,
      share: {
        ...share,
        menu_items: menuItems
      }
    });
  } catch (err: any) {
    console.error('[restaurant] get shared error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default restaurantRouter;
