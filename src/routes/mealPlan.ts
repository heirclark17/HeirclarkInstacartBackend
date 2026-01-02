// src/routes/mealPlan.ts
import { Router, Request, Response } from 'express';
import { pool } from '../db/pool';
import { sendSuccess, sendError, sendServerError } from '../middleware/responseHelper';
import { rateLimitMiddleware } from '../middleware/rateLimiter';

export const mealPlanRouter = Router();

// Apply rate limiting (10 requests per minute per IP)
const planRateLimit = rateLimitMiddleware({
  windowMs: 60000,
  maxRequests: 10,
  message: 'Too many meal plan requests, please try again later',
});

// ============================================================
// TYPES
// ============================================================

interface MealPlanTargets {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

interface MealPlanPreferences {
  dietType?: string; // e.g., 'balanced', 'high-protein', 'low-carb', 'vegetarian', 'pescatarian'
  mealsPerDay?: number;
  allergies?: string[];
  cuisinePreferences?: string[];
  cookingSkill?: 'beginner' | 'intermediate' | 'advanced';
  budgetPerDay?: number;
}

interface Ingredient {
  name: string;
  quantity: number;
  unit: string;
  instacartQuery?: string;
}

interface Recipe {
  ingredients: Ingredient[];
  instructions: string[];
  prepMinutes: number;
  cookMinutes: number;
}

interface Meal {
  mealType: string;
  dishName: string;
  description: string;
  calories: number;
  macros: {
    protein: number;
    carbs: number;
    fat: number;
  };
  servings: number;
  recipe: Recipe;
}

interface DayPlan {
  day: number;
  meals: Meal[];
  totalCalories: number;
  totalMacros: {
    protein: number;
    carbs: number;
    fat: number;
  };
}

interface ShoppingListItem {
  name: string;
  quantity: number;
  unit: string;
  category?: string;
}

interface MealPlanResponse {
  days: DayPlan[];
  shoppingList: ShoppingListItem[];
  generatedAt: string;
  targets: MealPlanTargets;
}

// ============================================================
// OPENAI MEAL PLAN GENERATION
// ============================================================

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

async function generateMealPlanWithAI(
  targets: MealPlanTargets,
  preferences: MealPlanPreferences
): Promise<MealPlanResponse> {
  if (!OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not configured');
  }

  const dietTypeText = preferences.dietType || 'balanced';
  const mealsPerDay = preferences.mealsPerDay || 3;
  const allergiesText = preferences.allergies?.length
    ? `Avoid these allergens: ${preferences.allergies.join(', ')}.`
    : '';
  const skillText = preferences.cookingSkill || 'intermediate';

  const systemPrompt = `You are a nutritionist. Create a 7-day meal plan as JSON ONLY (no markdown).

Format: {"days":[{"day":1,"meals":[{"mealType":"Breakfast","dishName":"Name","description":"Brief desc","calories":450,"macros":{"protein":30,"carbs":40,"fat":15},"servings":1,"recipe":{"ingredients":[{"name":"ingredient","quantity":1,"unit":"cup"}],"instructions":["Step 1"],"prepMinutes":10,"cookMinutes":15}}],"totalCalories":2000,"totalMacros":{"protein":150,"carbs":200,"fat":65}}],"shoppingList":[{"name":"item","quantity":2,"unit":"lb","category":"Protein"}]}

Rules: 7 days, ${mealsPerDay} meals/day (Breakfast/Lunch/Dinner), target ~${targets.calories}cal/${targets.protein}g protein/${targets.carbs}g carbs/${targets.fat}g fat per day. Diet: ${dietTypeText}. Skill: ${skillText}. ${allergiesText} Keep recipes simple with 3-5 ingredients each.`;

  const userPrompt = `Generate the 7-day ${dietTypeText} meal plan now. ${allergiesText}`;

  // Set 15 second timeout for faster fallback
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.5,
        max_tokens: 4000,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[mealPlan] OpenAI API error:', response.status, errorText);
      throw new Error(`OpenAI API error: ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      throw new Error('No content in OpenAI response');
    }

    // Parse JSON, handle potential markdown code blocks
    let parsedPlan: any;
    let cleanContent = content.trim();
    if (cleanContent.startsWith('```json')) {
      cleanContent = cleanContent.slice(7);
    } else if (cleanContent.startsWith('```')) {
      cleanContent = cleanContent.slice(3);
    }
    if (cleanContent.endsWith('```')) {
      cleanContent = cleanContent.slice(0, -3);
    }
    parsedPlan = JSON.parse(cleanContent.trim());

    // Validate structure
    if (!parsedPlan.days || !Array.isArray(parsedPlan.days) || parsedPlan.days.length !== 7) {
      console.error('[mealPlan] Invalid plan structure - missing or incomplete days');
      throw new Error('Invalid meal plan structure');
    }

    return {
      ...parsedPlan,
      generatedAt: new Date().toISOString(),
      targets,
    };
  } catch (err: any) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      console.warn('[mealPlan] OpenAI request timed out after 15s');
      throw new Error('Request timed out');
    }
    console.error('[mealPlan] Failed to parse OpenAI response:', err.message);
    throw err;
  }
}

// ============================================================
// FALLBACK PLAN (when AI fails)
// ============================================================

function generateFallbackPlan(targets: MealPlanTargets): MealPlanResponse {
  const mealCalories = {
    breakfast: Math.round(targets.calories * 0.25),
    lunch: Math.round(targets.calories * 0.35),
    dinner: Math.round(targets.calories * 0.40),
  };

  const mealMacros = {
    breakfast: {
      protein: Math.round(targets.protein * 0.25),
      carbs: Math.round(targets.carbs * 0.30),
      fat: Math.round(targets.fat * 0.25),
    },
    lunch: {
      protein: Math.round(targets.protein * 0.35),
      carbs: Math.round(targets.carbs * 0.35),
      fat: Math.round(targets.fat * 0.35),
    },
    dinner: {
      protein: Math.round(targets.protein * 0.40),
      carbs: Math.round(targets.carbs * 0.35),
      fat: Math.round(targets.fat * 0.40),
    },
  };

  const days: DayPlan[] = [];

  const fallbackMeals = [
    {
      breakfast: { name: 'Greek Yogurt Parfait', desc: 'Creamy Greek yogurt layered with fresh berries and granola' },
      lunch: { name: 'Grilled Chicken Salad', desc: 'Mixed greens with grilled chicken, cherry tomatoes, and balsamic vinaigrette' },
      dinner: { name: 'Baked Salmon with Vegetables', desc: 'Herb-crusted salmon with roasted broccoli and sweet potato' },
    },
    {
      breakfast: { name: 'Veggie Egg Scramble', desc: 'Fluffy scrambled eggs with spinach, peppers, and cheese' },
      lunch: { name: 'Turkey Wrap', desc: 'Whole wheat wrap with sliced turkey, avocado, and mixed greens' },
      dinner: { name: 'Lean Beef Stir-Fry', desc: 'Tender beef strips with mixed vegetables in ginger sauce' },
    },
    {
      breakfast: { name: 'Overnight Oats', desc: 'Steel-cut oats with almond milk, chia seeds, and banana' },
      lunch: { name: 'Quinoa Buddha Bowl', desc: 'Quinoa with chickpeas, roasted vegetables, and tahini dressing' },
      dinner: { name: 'Herb Roasted Chicken', desc: 'Juicy roasted chicken breast with green beans and rice' },
    },
    {
      breakfast: { name: 'Avocado Toast with Eggs', desc: 'Whole grain toast with mashed avocado and poached eggs' },
      lunch: { name: 'Mediterranean Chicken Bowl', desc: 'Grilled chicken with feta, olives, cucumber, and hummus' },
      dinner: { name: 'Shrimp and Vegetable Pasta', desc: 'Whole wheat pasta with garlic shrimp and sautéed vegetables' },
    },
    {
      breakfast: { name: 'Protein Smoothie Bowl', desc: 'Blended protein smoothie topped with nuts and fresh fruit' },
      lunch: { name: 'Asian Chicken Lettuce Wraps', desc: 'Seasoned ground chicken in crisp lettuce cups with peanut sauce' },
      dinner: { name: 'Grilled Tilapia with Salsa', desc: 'Light tilapia fillet with mango salsa and cilantro lime rice' },
    },
    {
      breakfast: { name: 'Breakfast Burrito', desc: 'Scrambled eggs with black beans, cheese, and salsa in a tortilla' },
      lunch: { name: 'Tuna Salad on Greens', desc: 'Light tuna salad with mixed greens and whole grain crackers' },
      dinner: { name: 'Turkey Meatballs with Marinara', desc: 'Lean turkey meatballs over zucchini noodles with marinara sauce' },
    },
    {
      breakfast: { name: 'Cottage Cheese Bowl', desc: 'Cottage cheese with pineapple, honey, and walnuts' },
      lunch: { name: 'Chicken Caesar Wrap', desc: 'Grilled chicken with romaine and light Caesar dressing in a wrap' },
      dinner: { name: 'Baked Cod with Asparagus', desc: 'Lemon herb cod with roasted asparagus and wild rice' },
    },
  ];

  for (let i = 0; i < 7; i++) {
    const dayMeals = fallbackMeals[i];
    days.push({
      day: i + 1,
      meals: [
        {
          mealType: 'Breakfast',
          dishName: dayMeals.breakfast.name,
          description: dayMeals.breakfast.desc,
          calories: mealCalories.breakfast,
          macros: mealMacros.breakfast,
          servings: 1,
          recipe: {
            ingredients: [
              { name: 'See recipe details', quantity: 1, unit: 'serving' },
            ],
            instructions: ['Prepare ingredients', 'Cook according to standard recipe', 'Serve and enjoy'],
            prepMinutes: 10,
            cookMinutes: 15,
          },
        },
        {
          mealType: 'Lunch',
          dishName: dayMeals.lunch.name,
          description: dayMeals.lunch.desc,
          calories: mealCalories.lunch,
          macros: mealMacros.lunch,
          servings: 1,
          recipe: {
            ingredients: [
              { name: 'See recipe details', quantity: 1, unit: 'serving' },
            ],
            instructions: ['Prepare ingredients', 'Cook according to standard recipe', 'Serve and enjoy'],
            prepMinutes: 15,
            cookMinutes: 20,
          },
        },
        {
          mealType: 'Dinner',
          dishName: dayMeals.dinner.name,
          description: dayMeals.dinner.desc,
          calories: mealCalories.dinner,
          macros: mealMacros.dinner,
          servings: 1,
          recipe: {
            ingredients: [
              { name: 'See recipe details', quantity: 1, unit: 'serving' },
            ],
            instructions: ['Prepare ingredients', 'Cook according to standard recipe', 'Serve and enjoy'],
            prepMinutes: 15,
            cookMinutes: 30,
          },
        },
      ],
      totalCalories: targets.calories,
      totalMacros: {
        protein: targets.protein,
        carbs: targets.carbs,
        fat: targets.fat,
      },
    });
  }

  return {
    days,
    shoppingList: [],
    generatedAt: new Date().toISOString(),
    targets,
  };
}

// ============================================================
// ENDPOINTS
// ============================================================

/**
 * POST /api/v1/ai/meal-plan-7day
 * Generate a 7-day AI meal plan based on user's goals
 */
mealPlanRouter.post('/meal-plan-7day', planRateLimit, async (req: Request, res: Response) => {
  const { shopifyCustomerId, targets, preferences } = req.body;

  // Validate targets
  if (!targets || typeof targets.calories !== 'number') {
    return sendError(res, 'Missing or invalid targets. Required: calories, protein, carbs, fat', 400);
  }

  const validatedTargets: MealPlanTargets = {
    calories: Number(targets.calories) || 2000,
    protein: Number(targets.protein) || 150,
    carbs: Number(targets.carbs) || 200,
    fat: Number(targets.fat) || 65,
  };

  const validatedPreferences: MealPlanPreferences = {
    dietType: preferences?.dietType || 'balanced',
    mealsPerDay: preferences?.mealsPerDay || 3,
    allergies: preferences?.allergies || [],
    cookingSkill: preferences?.cookingSkill || 'intermediate',
  };

  console.log(`[mealPlan] Generating 7-day plan for user ${shopifyCustomerId || 'anonymous'}:`, validatedTargets);

  try {
    // Try AI generation first
    let plan: MealPlanResponse;

    try {
      plan = await generateMealPlanWithAI(validatedTargets, validatedPreferences);
      console.log('[mealPlan] AI plan generated successfully');
    } catch (aiErr: any) {
      console.warn('[mealPlan] AI generation failed, using fallback:', aiErr.message);
      plan = generateFallbackPlan(validatedTargets);
    }

    // Store plan in database for user if logged in
    if (shopifyCustomerId) {
      try {
        await pool.query(
          `INSERT INTO hc_meal_plans (shopify_customer_id, plan_data, created_at)
           VALUES ($1, $2, NOW())
           ON CONFLICT (shopify_customer_id)
           DO UPDATE SET plan_data = $2, created_at = NOW()`,
          [String(shopifyCustomerId), JSON.stringify(plan)]
        );
      } catch (dbErr) {
        console.warn('[mealPlan] Failed to store plan in database:', dbErr);
        // Continue anyway - plan still works
      }
    }

    return sendSuccess(res, { plan });

  } catch (err: any) {
    console.error('[mealPlan] Generation failed:', err);
    return sendServerError(res, err.message || 'Failed to generate meal plan');
  }
});

/**
 * GET /api/v1/ai/meal-plan
 * Get the latest saved meal plan for a user
 */
mealPlanRouter.get('/meal-plan', async (req: Request, res: Response) => {
  const shopifyCustomerId = req.query.shopifyCustomerId as string;

  if (!shopifyCustomerId) {
    return sendError(res, 'Missing shopifyCustomerId', 400);
  }

  try {
    const result = await pool.query(
      `SELECT plan_data, created_at FROM hc_meal_plans
       WHERE shopify_customer_id = $1
       ORDER BY created_at DESC LIMIT 1`,
      [shopifyCustomerId]
    );

    if (result.rows.length === 0) {
      return sendSuccess(res, { hasPlan: false });
    }

    return sendSuccess(res, {
      hasPlan: true,
      plan: result.rows[0].plan_data,
      createdAt: result.rows[0].created_at,
    });

  } catch (err: any) {
    console.error('[mealPlan] Fetch failed:', err);
    return sendServerError(res, 'Failed to fetch meal plan');
  }
});

/**
 * POST /api/v1/ai/instacart-order
 * Create an Instacart shopping link from meal plan ingredients
 */
mealPlanRouter.post('/instacart-order', planRateLimit, async (req: Request, res: Response) => {
  // Accept either 'shoppingList' or 'ingredients' for backwards compatibility
  const { shoppingList, ingredients, planTitle } = req.body;
  const items = shoppingList || ingredients;

  if (!items || !Array.isArray(items) || items.length === 0) {
    return sendError(res, 'Missing or empty shoppingList/ingredients', 400);
  }

  // Build line items
  const lineItems = items.map((item: ShoppingListItem) => ({
    name: item.name,
    quantity: item.quantity || 1,
    unit: item.unit || 'each',
  }));

  const INSTACART_API_KEY = process.env.INSTACART_API_KEY;
  console.log('[mealPlan] Instacart API key present:', !!INSTACART_API_KEY);

  // If no API key, generate a search URL fallback
  if (!INSTACART_API_KEY) {
    console.log('[mealPlan] No Instacart API key found, using search fallback');

    // Create a search query with top ingredients
    const topItems = lineItems.slice(0, 10).map((item: any) => item.name).join(', ');
    const searchUrl = `https://www.instacart.com/store/search/${encodeURIComponent(topItems)}`;

    return sendSuccess(res, {
      instacartUrl: searchUrl,
      itemsCount: lineItems.length,
      fallback: true,
      shoppingList: lineItems, // Return the list so frontend can display it
    });
  }

  try {
    const payload = {
      title: planTitle || '7-Day Meal Plan Ingredients',
      link_type: 'shopping_list',
      line_items: lineItems.map((item: any) => ({
        ...item,
        display_text: `${item.quantity} ${item.unit} ${item.name}`,
      })),
      landing_page_configuration: {
        partner_linkback_url: 'https://heirclark.com/pages/meal-plan',
        enable_pantry_items: false,
      },
    };

    const response = await fetch('https://connect.instacart.com/idp/v1/products/products_link', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${INSTACART_API_KEY}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('[mealPlan] Instacart API error:', response.status, data);
      // Fall back to search URL on API error
      const topItems = lineItems.slice(0, 10).map((item: any) => item.name).join(', ');
      return sendSuccess(res, {
        instacartUrl: `https://www.instacart.com/store/search/${encodeURIComponent(topItems)}`,
        itemsCount: lineItems.length,
        fallback: true,
        shoppingList: lineItems,
      });
    }

    return sendSuccess(res, {
      instacartUrl: data.products_link_url,
      itemsCount: lineItems.length,
    });

  } catch (err: any) {
    console.error('[mealPlan] Instacart order failed:', err);
    // Fall back to search URL on error
    const topItems = lineItems.slice(0, 10).map((item: any) => item.name).join(', ');
    return sendSuccess(res, {
      instacartUrl: `https://www.instacart.com/store/search/${encodeURIComponent(topItems)}`,
      itemsCount: lineItems.length,
      fallback: true,
      shoppingList: lineItems,
    });
  }
});

/**
 * POST /api/v1/ai/recipe-details
 * Generate detailed recipe with AI for a specific meal
 */
mealPlanRouter.post('/recipe-details', planRateLimit, async (req: Request, res: Response) => {
  const { dishName, mealType, calories, macros } = req.body;

  if (!dishName) {
    return sendError(res, 'Missing dishName', 400);
  }

  if (!OPENAI_API_KEY) {
    // Return a generic recipe if no API key
    return sendSuccess(res, {
      recipe: generateGenericRecipe(dishName, calories, macros)
    });
  }

  try {
    const prompt = `Generate a detailed recipe for "${dishName}" (${mealType || 'meal'}).
Target: ${calories || 500} calories, ${macros?.protein || 30}g protein, ${macros?.carbs || 40}g carbs, ${macros?.fat || 15}g fat.

Return ONLY valid JSON (no markdown):
{
  "ingredients": [
    {"name": "ingredient name", "quantity": 1, "unit": "cup"}
  ],
  "instructions": ["Step 1...", "Step 2..."],
  "prepMinutes": 10,
  "cookMinutes": 20,
  "tips": "Optional cooking tip"
}

Use 5-8 common grocery ingredients. Keep instructions clear and numbered.`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages: [
          { role: 'system', content: 'You are a chef creating simple, delicious recipes. Return only JSON.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.5,
        max_tokens: 1000,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`OpenAI error: ${response.status}`);
    }

    const data = await response.json();
    let content = data.choices?.[0]?.message?.content || '';

    // Clean markdown if present
    if (content.startsWith('```')) {
      content = content.replace(/```json?\n?/g, '').replace(/```$/g, '');
    }

    const recipe = JSON.parse(content.trim());
    return sendSuccess(res, { recipe });

  } catch (err: any) {
    console.warn('[mealPlan] AI recipe generation failed:', err.message);
    // Return generic recipe on failure
    return sendSuccess(res, {
      recipe: generateGenericRecipe(dishName, calories, macros)
    });
  }
});

// Generate a generic recipe when AI is unavailable
function generateGenericRecipe(dishName: string, calories?: number, macros?: any) {
  const isBreakfast = /breakfast|oat|egg|yogurt|pancake|smoothie/i.test(dishName);
  const isLunch = /salad|wrap|sandwich|bowl|soup/i.test(dishName);

  const baseIngredients = isBreakfast ? [
    { name: 'eggs', quantity: 2, unit: 'large' },
    { name: 'olive oil', quantity: 1, unit: 'tbsp' },
    { name: 'salt and pepper', quantity: 1, unit: 'pinch' },
    { name: 'fresh vegetables of choice', quantity: 1, unit: 'cup' },
  ] : isLunch ? [
    { name: 'mixed greens', quantity: 2, unit: 'cups' },
    { name: 'grilled chicken breast', quantity: 4, unit: 'oz' },
    { name: 'cherry tomatoes', quantity: 0.5, unit: 'cup' },
    { name: 'olive oil', quantity: 1, unit: 'tbsp' },
    { name: 'lemon juice', quantity: 1, unit: 'tbsp' },
  ] : [
    { name: 'protein of choice', quantity: 6, unit: 'oz' },
    { name: 'vegetables', quantity: 1, unit: 'cup' },
    { name: 'whole grain or starch', quantity: 0.5, unit: 'cup' },
    { name: 'olive oil', quantity: 1, unit: 'tbsp' },
    { name: 'herbs and spices', quantity: 1, unit: 'tsp' },
  ];

  return {
    ingredients: baseIngredients,
    instructions: [
      'Prep all ingredients by washing and cutting as needed.',
      'Heat oil in a pan over medium heat.',
      'Cook protein until done, about 5-7 minutes per side.',
      'Add vegetables and cook until tender.',
      'Season to taste and serve immediately.'
    ],
    prepMinutes: 10,
    cookMinutes: 20,
    tips: 'Feel free to substitute ingredients based on what you have available.'
  };
}

// Ensure table exists on module load
async function ensureMealPlanTable(): Promise<void> {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS hc_meal_plans (
        id SERIAL PRIMARY KEY,
        shopify_customer_id VARCHAR(255) NOT NULL UNIQUE,
        plan_data JSONB NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_meal_plans_customer ON hc_meal_plans(shopify_customer_id)
    `);
  } catch (err) {
    console.warn('[mealPlan] Failed to ensure table exists:', err);
  }
}

ensureMealPlanTable();
