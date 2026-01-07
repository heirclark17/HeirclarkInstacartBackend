// src/routes/weeklyPrep.ts - WeeklyPrep Skill Routes
import { Router, Request, Response } from 'express';
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false },
});

export const weeklyPrepRouter = Router();

// Batch cooking recipes database
const BATCH_RECIPES = [
  {
    id: 'protein-chicken',
    name: 'Batch Grilled Chicken Breasts',
    category: 'protein',
    servings: 8,
    prep_time_mins: 15,
    cook_time_mins: 25,
    storage_days: 5,
    nutrition_per_serving: { calories: 165, protein: 31, carbs: 0, fat: 4 },
    ingredients: ['4 lbs chicken breast', 'olive oil', 'garlic powder', 'paprika', 'salt', 'pepper'],
    instructions: [
      'Pound chicken to even thickness',
      'Season both sides generously',
      'Grill at medium-high 6-7 mins per side',
      'Rest 5 minutes before slicing',
      'Store in airtight containers'
    ],
    versatility: ['salads', 'wraps', 'bowls', 'stir-fry', 'sandwiches']
  },
  {
    id: 'grain-rice',
    name: 'Perfect Batch Rice',
    category: 'grain',
    servings: 10,
    prep_time_mins: 5,
    cook_time_mins: 20,
    storage_days: 5,
    nutrition_per_serving: { calories: 160, protein: 3, carbs: 35, fat: 0 },
    ingredients: ['3 cups rice', '6 cups water', 'salt'],
    instructions: [
      'Rinse rice until water runs clear',
      'Bring water to boil, add rice and salt',
      'Reduce to simmer, cover 18 minutes',
      'Fluff with fork, cool completely',
      'Portion into containers'
    ],
    versatility: ['bowls', 'stir-fry', 'burritos', 'side dish']
  },
  {
    id: 'veggie-roasted',
    name: 'Sheet Pan Roasted Vegetables',
    category: 'vegetable',
    servings: 8,
    prep_time_mins: 20,
    cook_time_mins: 30,
    storage_days: 5,
    nutrition_per_serving: { calories: 85, protein: 2, carbs: 12, fat: 4 },
    ingredients: ['broccoli', 'bell peppers', 'zucchini', 'onion', 'olive oil', 'garlic'],
    instructions: [
      'Preheat oven to 425°F',
      'Cut all veggies to similar size',
      'Toss with oil, garlic, salt, pepper',
      'Spread on sheet pans - don\'t crowd',
      'Roast 25-30 mins, stirring halfway'
    ],
    versatility: ['bowls', 'wraps', 'omelets', 'pasta', 'side dish']
  },
  {
    id: 'sauce-teriyaki',
    name: 'Homemade Teriyaki Sauce',
    category: 'sauce',
    servings: 16,
    prep_time_mins: 5,
    cook_time_mins: 10,
    storage_days: 14,
    nutrition_per_serving: { calories: 35, protein: 1, carbs: 8, fat: 0 },
    ingredients: ['soy sauce', 'honey', 'rice vinegar', 'garlic', 'ginger', 'cornstarch'],
    instructions: [
      'Combine soy sauce, honey, vinegar in pot',
      'Add minced garlic and ginger',
      'Simmer 5 minutes',
      'Thicken with cornstarch slurry',
      'Cool and store in jar'
    ],
    versatility: ['stir-fry', 'bowls', 'marinades', 'dipping sauce']
  },
  {
    id: 'protein-eggs',
    name: 'Batch Hard Boiled Eggs',
    category: 'protein',
    servings: 12,
    prep_time_mins: 5,
    cook_time_mins: 12,
    storage_days: 7,
    nutrition_per_serving: { calories: 78, protein: 6, carbs: 1, fat: 5 },
    ingredients: ['12 eggs'],
    instructions: [
      'Place eggs in single layer in pot',
      'Cover with cold water by 1 inch',
      'Bring to boil, remove from heat',
      'Cover and let sit 12 minutes',
      'Ice bath, peel when cooled'
    ],
    versatility: ['breakfast', 'salads', 'snacks', 'sandwiches']
  }
];

/**
 * GET /api/v1/weekly-prep/plan
 * Generate a weekly prep plan based on goals and preferences
 */
weeklyPrepRouter.get('/plan', async (req: Request, res: Response) => {
  try {
    const shopifyCustomerId = req.query.shopifyCustomerId as string || req.headers['x-shopify-customer-id'] as string;
    const prepDay = req.query.prepDay as string || 'sunday';
    const hoursAvailable = parseInt(req.query.hoursAvailable as string || '3', 10);

    if (!shopifyCustomerId) {
      return res.status(400).json({ ok: false, error: 'Missing shopifyCustomerId' });
    }

    // Get user preferences
    const prefsResult = await pool.query(
      `SELECT calories_target, protein_target, dietary_restrictions
       FROM hc_user_preferences WHERE shopify_customer_id = $1`,
      [shopifyCustomerId]
    );
    const prefs = prefsResult.rows[0] || { calories_target: 2000, protein_target: 150 };

    // Build prep plan based on time available
    const recipes = [];
    let totalPrepTime = 0;
    const maxPrepTime = hoursAvailable * 60;

    // Always include protein and grain base
    const proteinRecipe = BATCH_RECIPES.find(r => r.id === 'protein-chicken')!;
    const grainRecipe = BATCH_RECIPES.find(r => r.id === 'grain-rice')!;
    const veggieRecipe = BATCH_RECIPES.find(r => r.id === 'veggie-roasted')!;

    recipes.push(proteinRecipe, grainRecipe, veggieRecipe);
    totalPrepTime = recipes.reduce((sum, r) => sum + r.prep_time_mins + r.cook_time_mins, 0);

    // Add extras if time permits
    if (totalPrepTime + 20 <= maxPrepTime) {
      const eggsRecipe = BATCH_RECIPES.find(r => r.id === 'protein-eggs')!;
      recipes.push(eggsRecipe);
      totalPrepTime += eggsRecipe.prep_time_mins + eggsRecipe.cook_time_mins;
    }

    if (totalPrepTime + 15 <= maxPrepTime) {
      const sauceRecipe = BATCH_RECIPES.find(r => r.id === 'sauce-teriyaki')!;
      recipes.push(sauceRecipe);
      totalPrepTime += sauceRecipe.prep_time_mins + sauceRecipe.cook_time_mins;
    }

    // Generate shopping list
    const allIngredients: string[] = [];
    for (const recipe of recipes) {
      allIngredients.push(...recipe.ingredients);
    }

    // Build timeline
    const timeline = buildPrepTimeline(recipes);

    res.json({
      ok: true,
      prep_day: prepDay,
      total_prep_time_mins: totalPrepTime,
      hours_needed: Math.ceil(totalPrepTime / 60),
      recipes: recipes.map(r => ({
        id: r.id,
        name: r.name,
        category: r.category,
        servings: r.servings,
        total_time_mins: r.prep_time_mins + r.cook_time_mins,
        storage_days: r.storage_days,
        nutrition_per_serving: r.nutrition_per_serving
      })),
      shopping_list: {
        proteins: allIngredients.filter(i => i.includes('chicken') || i.includes('egg')),
        grains: allIngredients.filter(i => i.includes('rice')),
        produce: allIngredients.filter(i => ['broccoli', 'bell peppers', 'zucchini', 'onion', 'garlic', 'ginger'].some(v => i.includes(v))),
        pantry: allIngredients.filter(i => ['oil', 'soy sauce', 'honey', 'vinegar', 'salt', 'pepper', 'paprika', 'cornstarch'].some(v => i.includes(v)))
      },
      timeline,
      meal_assembly_ideas: generateMealIdeas(recipes)
    });

  } catch (err: any) {
    console.error('[weekly-prep] plan error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * GET /api/v1/weekly-prep/recipes
 * Get all available batch recipes
 */
weeklyPrepRouter.get('/recipes', async (_req: Request, res: Response) => {
  res.json({
    ok: true,
    recipes: BATCH_RECIPES.map(r => ({
      id: r.id,
      name: r.name,
      category: r.category,
      servings: r.servings,
      total_time_mins: r.prep_time_mins + r.cook_time_mins,
      storage_days: r.storage_days,
      nutrition_per_serving: r.nutrition_per_serving,
      versatility: r.versatility
    })),
    categories: ['protein', 'grain', 'vegetable', 'sauce']
  });
});

/**
 * GET /api/v1/weekly-prep/recipes/:id
 * Get full recipe details
 */
weeklyPrepRouter.get('/recipes/:id', async (req: Request, res: Response) => {
  const recipe = BATCH_RECIPES.find(r => r.id === req.params.id);

  if (!recipe) {
    return res.status(404).json({ ok: false, error: 'Recipe not found' });
  }

  res.json({
    ok: true,
    recipe
  });
});

/**
 * POST /api/v1/weekly-prep/assemble
 * Get assembly instructions for a meal from prepped ingredients
 */
weeklyPrepRouter.post('/assemble', async (req: Request, res: Response) => {
  try {
    const { mealType, preppedIngredients, targetCalories } = req.body;

    if (!preppedIngredients || !Array.isArray(preppedIngredients)) {
      return res.status(400).json({ ok: false, error: 'Missing preppedIngredients array' });
    }

    // Generate assembly based on available prepped ingredients
    const hasProtein = preppedIngredients.some((i: string) => ['chicken', 'eggs'].some(p => i.includes(p)));
    const hasGrain = preppedIngredients.some((i: string) => ['rice'].some(g => i.includes(g)));
    const hasVeggies = preppedIngredients.some((i: string) => ['vegetables', 'veggies'].some(v => i.includes(v)));

    let assembly;
    if (hasProtein && hasGrain && hasVeggies) {
      assembly = {
        meal_name: 'Power Bowl',
        components: [
          { ingredient: 'Grilled chicken', amount: '5 oz', calories: 206 },
          { ingredient: 'Rice', amount: '1 cup', calories: 160 },
          { ingredient: 'Roasted vegetables', amount: '1 cup', calories: 85 }
        ],
        assembly_steps: [
          'Add rice to bowl as base',
          'Slice chicken and arrange on rice',
          'Add roasted vegetables on side',
          'Optional: drizzle with teriyaki sauce'
        ],
        total_nutrition: { calories: 451, protein: 37, carbs: 47, fat: 9 },
        assembly_time_mins: 3
      };
    } else if (hasProtein && hasVeggies) {
      assembly = {
        meal_name: 'Protein & Veggie Plate',
        components: [
          { ingredient: 'Grilled chicken', amount: '6 oz', calories: 247 },
          { ingredient: 'Roasted vegetables', amount: '1.5 cups', calories: 127 }
        ],
        assembly_steps: [
          'Slice chicken and plate',
          'Add generous portion of vegetables',
          'Season with salt and pepper'
        ],
        total_nutrition: { calories: 374, protein: 46, carbs: 18, fat: 10 },
        assembly_time_mins: 2
      };
    } else {
      assembly = {
        meal_name: 'Quick Assembly',
        components: preppedIngredients.map((i: string) => ({ ingredient: i, amount: '1 serving' })),
        assembly_steps: ['Combine prepped ingredients', 'Heat if desired', 'Season to taste'],
        assembly_time_mins: 5
      };
    }

    res.json({
      ok: true,
      meal_type: mealType || 'lunch',
      assembly
    });

  } catch (err: any) {
    console.error('[weekly-prep] assemble error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

function buildPrepTimeline(recipes: typeof BATCH_RECIPES): any[] {
  const timeline = [];
  let currentTime = 0;

  // Sort by cook time (longest first to run in parallel)
  const sorted = [...recipes].sort((a, b) => b.cook_time_mins - a.cook_time_mins);

  for (const recipe of sorted) {
    timeline.push({
      time_marker: `${Math.floor(currentTime / 60)}h ${currentTime % 60}m`,
      task: `Start ${recipe.name}`,
      duration_mins: recipe.prep_time_mins,
      notes: recipe.category === 'protein' ? 'Get this in first - longest cook time' : undefined
    });
    currentTime += recipe.prep_time_mins;
  }

  return timeline;
}

function generateMealIdeas(recipes: typeof BATCH_RECIPES): any[] {
  return [
    {
      name: 'Chicken Rice Bowl',
      uses: ['Grilled chicken', 'Rice', 'Roasted vegetables'],
      assembly_time: '3 mins',
      meal_type: 'lunch'
    },
    {
      name: 'Protein Salad',
      uses: ['Grilled chicken', 'Hard boiled eggs'],
      assembly_time: '5 mins',
      meal_type: 'lunch'
    },
    {
      name: 'Teriyaki Stir-Fry',
      uses: ['Grilled chicken', 'Roasted vegetables', 'Teriyaki sauce', 'Rice'],
      assembly_time: '5 mins',
      meal_type: 'dinner'
    },
    {
      name: 'Quick Breakfast',
      uses: ['Hard boiled eggs', 'Roasted vegetables'],
      assembly_time: '2 mins',
      meal_type: 'breakfast'
    }
  ];
}

export default weeklyPrepRouter;
