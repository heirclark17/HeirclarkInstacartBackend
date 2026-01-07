// src/routes/budgetMeals.ts - BudgetMeals Skill Routes
import { Router, Request, Response } from 'express';
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false },
});

export const budgetMealsRouter = Router();

// Budget meal database
const BUDGET_MEALS = [
  {
    id: 'chicken-rice-beans',
    name: 'Chicken, Rice & Black Beans',
    cost_per_serving: 2.50,
    servings: 4,
    prep_time_mins: 10,
    cook_time_mins: 25,
    nutrition: { calories: 420, protein: 35, carbs: 48, fat: 8 },
    ingredients: [
      { name: 'chicken thighs', amount: '1.5 lbs', cost: 4.50 },
      { name: 'rice', amount: '1 cup dry', cost: 0.50 },
      { name: 'black beans (canned)', amount: '1 can', cost: 1.00 },
      { name: 'onion', amount: '1', cost: 0.50 },
      { name: 'spices', amount: 'various', cost: 0.50 }
    ],
    total_cost: 7.00,
    budget_tier: 'budget'
  },
  {
    id: 'egg-veggie-scramble',
    name: 'Loaded Veggie Egg Scramble',
    cost_per_serving: 1.75,
    servings: 2,
    prep_time_mins: 5,
    cook_time_mins: 10,
    nutrition: { calories: 320, protein: 21, carbs: 12, fat: 22 },
    ingredients: [
      { name: 'eggs', amount: '4', cost: 1.00 },
      { name: 'bell pepper', amount: '1', cost: 1.00 },
      { name: 'onion', amount: '1/2', cost: 0.25 },
      { name: 'cheese', amount: '1/4 cup', cost: 0.75 },
      { name: 'butter', amount: '1 tbsp', cost: 0.25 }
    ],
    total_cost: 3.25,
    budget_tier: 'ultra_budget'
  },
  {
    id: 'lentil-soup',
    name: 'Hearty Lentil Soup',
    cost_per_serving: 1.25,
    servings: 6,
    prep_time_mins: 15,
    cook_time_mins: 40,
    nutrition: { calories: 280, protein: 18, carbs: 42, fat: 4 },
    ingredients: [
      { name: 'lentils', amount: '1 lb dry', cost: 2.00 },
      { name: 'carrots', amount: '3', cost: 0.75 },
      { name: 'celery', amount: '3 stalks', cost: 0.50 },
      { name: 'onion', amount: '1', cost: 0.50 },
      { name: 'garlic', amount: '4 cloves', cost: 0.25 },
      { name: 'vegetable broth', amount: '4 cups', cost: 1.50 },
      { name: 'spices', amount: 'various', cost: 0.50 }
    ],
    total_cost: 6.00,
    budget_tier: 'ultra_budget'
  },
  {
    id: 'tuna-salad',
    name: 'High-Protein Tuna Salad',
    cost_per_serving: 2.00,
    servings: 2,
    prep_time_mins: 10,
    cook_time_mins: 0,
    nutrition: { calories: 280, protein: 32, carbs: 8, fat: 14 },
    ingredients: [
      { name: 'canned tuna', amount: '2 cans', cost: 2.50 },
      { name: 'greek yogurt', amount: '1/4 cup', cost: 0.50 },
      { name: 'celery', amount: '2 stalks', cost: 0.30 },
      { name: 'lemon', amount: '1/2', cost: 0.25 },
      { name: 'mixed greens', amount: '2 cups', cost: 1.00 }
    ],
    total_cost: 4.55,
    budget_tier: 'budget'
  },
  {
    id: 'pasta-meat-sauce',
    name: 'Pasta with Meat Sauce',
    cost_per_serving: 2.25,
    servings: 4,
    prep_time_mins: 10,
    cook_time_mins: 25,
    nutrition: { calories: 480, protein: 28, carbs: 52, fat: 16 },
    ingredients: [
      { name: 'ground beef (80/20)', amount: '1 lb', cost: 5.00 },
      { name: 'pasta', amount: '1 lb', cost: 1.50 },
      { name: 'marinara sauce', amount: '1 jar', cost: 2.50 },
      { name: 'onion', amount: '1', cost: 0.50 }
    ],
    total_cost: 9.50,
    budget_tier: 'moderate'
  }
];

// Seasonal produce calendar
const SEASONAL_PRODUCE: Record<string, string[]> = {
  winter: ['cabbage', 'carrots', 'potatoes', 'sweet potatoes', 'onions', 'citrus', 'apples', 'squash'],
  spring: ['asparagus', 'spinach', 'peas', 'strawberries', 'lettuce', 'radishes'],
  summer: ['tomatoes', 'zucchini', 'corn', 'berries', 'peppers', 'cucumber', 'watermelon'],
  fall: ['pumpkin', 'apples', 'squash', 'brussels sprouts', 'broccoli', 'cauliflower', 'pears']
};

/**
 * GET /api/v1/budget-meals/meals
 * Get budget-friendly meal suggestions
 */
budgetMealsRouter.get('/meals', async (req: Request, res: Response) => {
  try {
    const maxCostPerServing = parseFloat(req.query.maxCostPerServing as string || '5.00');
    const budgetTier = req.query.budgetTier as string;
    const minProtein = parseInt(req.query.minProtein as string || '0', 10);

    let filtered = BUDGET_MEALS;

    if (maxCostPerServing) {
      filtered = filtered.filter(m => m.cost_per_serving <= maxCostPerServing);
    }

    if (budgetTier) {
      filtered = filtered.filter(m => m.budget_tier === budgetTier);
    }

    if (minProtein > 0) {
      filtered = filtered.filter(m => m.nutrition.protein >= minProtein);
    }

    // Sort by cost per gram of protein (best value first)
    filtered.sort((a, b) => {
      const aValue = a.cost_per_serving / a.nutrition.protein;
      const bValue = b.cost_per_serving / b.nutrition.protein;
      return aValue - bValue;
    });

    res.json({
      ok: true,
      meals: filtered.map(m => ({
        id: m.id,
        name: m.name,
        cost_per_serving: m.cost_per_serving,
        total_cost: m.total_cost,
        servings: m.servings,
        nutrition: m.nutrition,
        budget_tier: m.budget_tier,
        protein_cost_efficiency: `$${(m.cost_per_serving / m.nutrition.protein).toFixed(2)}/g protein`
      })),
      filters_applied: {
        max_cost_per_serving: maxCostPerServing,
        budget_tier: budgetTier,
        min_protein: minProtein
      }
    });

  } catch (err: any) {
    console.error('[budget-meals] meals error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * GET /api/v1/budget-meals/meals/:id
 * Get full recipe details
 */
budgetMealsRouter.get('/meals/:id', async (req: Request, res: Response) => {
  const meal = BUDGET_MEALS.find(m => m.id === req.params.id);

  if (!meal) {
    return res.status(404).json({ ok: false, error: 'Meal not found' });
  }

  res.json({
    ok: true,
    meal
  });
});

/**
 * POST /api/v1/budget-meals/weekly-plan
 * Generate a budget-friendly weekly meal plan
 */
budgetMealsRouter.post('/weekly-plan', async (req: Request, res: Response) => {
  try {
    const { shopifyCustomerId, weeklyBudget, mealsPerDay = 3, prioritizeProtein = true } = req.body;

    if (!shopifyCustomerId) {
      return res.status(400).json({ ok: false, error: 'Missing shopifyCustomerId' });
    }

    const budget = weeklyBudget || 75; // Default $75/week
    const dailyBudget = budget / 7;
    const perMealBudget = dailyBudget / mealsPerDay;

    // Get user's nutrition targets
    const goalsResult = await pool.query(
      `SELECT calories_target, protein_target FROM hc_user_preferences WHERE shopify_customer_id = $1`,
      [shopifyCustomerId]
    );
    const goals = goalsResult.rows[0] || { calories_target: 2000, protein_target: 150 };

    // Select meals that fit budget
    const eligibleMeals = BUDGET_MEALS.filter(m => m.cost_per_serving <= perMealBudget * 1.2);

    if (prioritizeProtein) {
      eligibleMeals.sort((a, b) => b.nutrition.protein - a.nutrition.protein);
    }

    // Build weekly plan
    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    const weeklyPlan = days.map((day, index) => {
      const mealIndex = index % eligibleMeals.length;
      const meal = eligibleMeals[mealIndex];
      return {
        day,
        meals: [
          { type: 'breakfast', suggestion: 'Eggs with toast', estimated_cost: 2.00 },
          { type: 'lunch', suggestion: meal?.name || 'Lentil soup', estimated_cost: meal?.cost_per_serving || 1.50 },
          { type: 'dinner', suggestion: eligibleMeals[(mealIndex + 1) % eligibleMeals.length]?.name || 'Chicken and rice', estimated_cost: eligibleMeals[(mealIndex + 1) % eligibleMeals.length]?.cost_per_serving || 2.50 }
        ],
        daily_total: 2.00 + (meal?.cost_per_serving || 1.50) + (eligibleMeals[(mealIndex + 1) % eligibleMeals.length]?.cost_per_serving || 2.50)
      };
    });

    const totalWeeklyCost = weeklyPlan.reduce((sum, day) => sum + day.daily_total, 0);

    res.json({
      ok: true,
      weekly_budget: budget,
      estimated_cost: Math.round(totalWeeklyCost * 100) / 100,
      under_budget: totalWeeklyCost <= budget,
      savings: Math.round((budget - totalWeeklyCost) * 100) / 100,
      daily_budget: Math.round(dailyBudget * 100) / 100,
      weekly_plan: weeklyPlan,
      shopping_list: generateShoppingList(weeklyPlan),
      tips: [
        'Buy proteins in bulk when on sale',
        'Use frozen vegetables to reduce waste',
        'Batch cook grains on Sunday',
        'Check store brands for staples'
      ]
    });

  } catch (err: any) {
    console.error('[budget-meals] weekly-plan error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * GET /api/v1/budget-meals/seasonal
 * Get current season's budget-friendly produce
 */
budgetMealsRouter.get('/seasonal', async (_req: Request, res: Response) => {
  const month = new Date().getMonth();
  let season: string;

  if (month >= 2 && month <= 4) season = 'spring';
  else if (month >= 5 && month <= 7) season = 'summer';
  else if (month >= 8 && month <= 10) season = 'fall';
  else season = 'winter';

  const produce = SEASONAL_PRODUCE[season];

  res.json({
    ok: true,
    current_season: season,
    seasonal_produce: produce,
    budget_tip: 'Seasonal produce is typically 30-50% cheaper than out-of-season options',
    meal_ideas: produce.slice(0, 3).map(item => ({
      ingredient: item,
      suggestion: `Add ${item} to your meals this week for best value`
    }))
  });
});

/**
 * GET /api/v1/budget-meals/protein-value
 * Get best protein value foods
 */
budgetMealsRouter.get('/protein-value', async (_req: Request, res: Response) => {
  const proteinSources = [
    { name: 'Eggs', cost_per_lb: 2.50, protein_per_lb: 56, cost_per_20g_protein: 0.89 },
    { name: 'Chicken thighs', cost_per_lb: 3.00, protein_per_lb: 100, cost_per_20g_protein: 0.60 },
    { name: 'Canned tuna', cost_per_lb: 4.00, protein_per_lb: 110, cost_per_20g_protein: 0.73 },
    { name: 'Ground beef 80/20', cost_per_lb: 5.00, protein_per_lb: 77, cost_per_20g_protein: 1.30 },
    { name: 'Lentils (dry)', cost_per_lb: 2.00, protein_per_lb: 115, cost_per_20g_protein: 0.35 },
    { name: 'Greek yogurt', cost_per_lb: 3.50, protein_per_lb: 45, cost_per_20g_protein: 1.56 },
    { name: 'Cottage cheese', cost_per_lb: 3.00, protein_per_lb: 50, cost_per_20g_protein: 1.20 },
    { name: 'Peanut butter', cost_per_lb: 3.50, protein_per_lb: 114, cost_per_20g_protein: 0.61 }
  ];

  proteinSources.sort((a, b) => a.cost_per_20g_protein - b.cost_per_20g_protein);

  res.json({
    ok: true,
    protein_sources: proteinSources.map((p, index) => ({
      rank: index + 1,
      ...p,
      value_rating: p.cost_per_20g_protein < 0.75 ? 'excellent' : p.cost_per_20g_protein < 1.00 ? 'good' : 'moderate'
    })),
    recommendation: 'Lentils and chicken thighs offer the best protein value for your budget'
  });
});

function generateShoppingList(weeklyPlan: any[]): any {
  return {
    proteins: ['chicken thighs 3 lbs', 'eggs 2 dozen', 'ground beef 1 lb'],
    grains: ['rice 2 lbs', 'pasta 1 lb', 'bread 1 loaf'],
    produce: ['onions 3', 'carrots 1 lb', 'bell peppers 3', 'lettuce 1 head'],
    canned_goods: ['black beans 2 cans', 'lentils 1 lb', 'marinara sauce 1 jar', 'tuna 2 cans'],
    dairy: ['cheese 8 oz', 'butter', 'greek yogurt'],
    estimated_total: 45.00
  };
}

export default budgetMealsRouter;
