// src/routes/mealPlan.ts
import { Router, Request, Response } from 'express';
import { pool } from '../db/pool';
import { sendSuccess, sendError, sendServerError } from '../middleware/responseHelper';
import { rateLimitMiddleware } from '../middleware/rateLimiter';
import { createInstacartProductsLink, InstacartLineItem } from '../instacartClient';

export const mealPlanRouter = Router();

// Apply rate limiting (10 requests per minute per IP) for expensive operations
const planRateLimit = rateLimitMiddleware({
  windowMs: 60000,
  maxRequests: 10,
  message: 'Too many meal plan requests, please try again later',
});

// More lenient rate limit for recipe details (30 requests per minute)
// This allows loading a full 7-day meal plan with 3 meals each
const recipeRateLimit = rateLimitMiddleware({
  windowMs: 60000,
  maxRequests: 30,
  message: 'Too many recipe requests, please try again later',
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
  budgetTier?: string;
  // Food preferences from onboarding
  mealStyle?: string;
  favoriteProteins?: string[];
  favoriteFruits?: string[];
  favoriteVegetables?: string[];
  favoriteStarches?: string[];
  favoriteCuisines?: string[];
  favoriteSnacks?: string[];
  hatedFoods?: string;
  cheatDays?: string[];
  mealDiversity?: string;
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
  imageUrl?: string | null;
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
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4.1-mini';
const UNSPLASH_ACCESS_KEY = process.env.UNSPLASH_ACCESS_KEY || '';

// ============================================================
// UNSPLASH IMAGE FETCHING
// ============================================================

// Simple in-memory cache for image URLs (avoid duplicate API calls)
const imageCache = new Map<string, string>();

// Curated food images from Unsplash (reliable direct URLs)
const FOOD_IMAGES: Record<string, string> = {
  // Breakfast
  'yogurt': 'https://images.unsplash.com/photo-1488477181946-6428a0291777?w=400&h=300&fit=crop',
  'parfait': 'https://images.unsplash.com/photo-1488477181946-6428a0291777?w=400&h=300&fit=crop',
  'oatmeal': 'https://images.unsplash.com/photo-1517673400267-0251440c45dc?w=400&h=300&fit=crop',
  'oats': 'https://images.unsplash.com/photo-1517673400267-0251440c45dc?w=400&h=300&fit=crop',
  'eggs': 'https://images.unsplash.com/photo-1525351484163-7529414344d8?w=400&h=300&fit=crop',
  'scramble': 'https://images.unsplash.com/photo-1525351484163-7529414344d8?w=400&h=300&fit=crop',
  'pancake': 'https://images.unsplash.com/photo-1567620905732-2d1ec7ab7445?w=400&h=300&fit=crop',
  'toast': 'https://images.unsplash.com/photo-1525351484163-7529414344d8?w=400&h=300&fit=crop',
  'avocado': 'https://images.unsplash.com/photo-1541519227354-08fa5d50c44d?w=400&h=300&fit=crop',
  'smoothie': 'https://images.unsplash.com/photo-1553530666-ba11a7da3888?w=400&h=300&fit=crop',
  'burrito': 'https://images.unsplash.com/photo-1626700051175-6818013e1d4f?w=400&h=300&fit=crop',
  'cottage': 'https://images.unsplash.com/photo-1488477181946-6428a0291777?w=400&h=300&fit=crop',
  // Lunch
  'salad': 'https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=400&h=300&fit=crop',
  'chicken salad': 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=400&h=300&fit=crop',
  'wrap': 'https://images.unsplash.com/photo-1626700051175-6818013e1d4f?w=400&h=300&fit=crop',
  'sandwich': 'https://images.unsplash.com/photo-1528735602780-2552fd46c7af?w=400&h=300&fit=crop',
  'bowl': 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=400&h=300&fit=crop',
  'buddha': 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=400&h=300&fit=crop',
  'quinoa': 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=400&h=300&fit=crop',
  'soup': 'https://images.unsplash.com/photo-1547592166-23ac45744acd?w=400&h=300&fit=crop',
  'tuna': 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=400&h=300&fit=crop',
  'caesar': 'https://images.unsplash.com/photo-1550304943-4f24f54ddde9?w=400&h=300&fit=crop',
  'lettuce': 'https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=400&h=300&fit=crop',
  // Dinner proteins
  'salmon': 'https://images.unsplash.com/photo-1467003909585-2f8a72700288?w=400&h=300&fit=crop',
  'fish': 'https://images.unsplash.com/photo-1467003909585-2f8a72700288?w=400&h=300&fit=crop',
  'tilapia': 'https://images.unsplash.com/photo-1467003909585-2f8a72700288?w=400&h=300&fit=crop',
  'cod': 'https://images.unsplash.com/photo-1467003909585-2f8a72700288?w=400&h=300&fit=crop',
  'shrimp': 'https://images.unsplash.com/photo-1565680018434-b513d5e5fd47?w=400&h=300&fit=crop',
  'chicken': 'https://images.unsplash.com/photo-1598103442097-8b74394b95c6?w=400&h=300&fit=crop',
  'grilled chicken': 'https://images.unsplash.com/photo-1598103442097-8b74394b95c6?w=400&h=300&fit=crop',
  'roasted chicken': 'https://images.unsplash.com/photo-1598103442097-8b74394b95c6?w=400&h=300&fit=crop',
  'beef': 'https://images.unsplash.com/photo-1546833999-b9f581a1996d?w=400&h=300&fit=crop',
  'steak': 'https://images.unsplash.com/photo-1546833999-b9f581a1996d?w=400&h=300&fit=crop',
  'stir-fry': 'https://images.unsplash.com/photo-1512058564366-18510be2db19?w=400&h=300&fit=crop',
  'turkey': 'https://images.unsplash.com/photo-1598103442097-8b74394b95c6?w=400&h=300&fit=crop',
  'meatball': 'https://images.unsplash.com/photo-1529042410759-befb1204b468?w=400&h=300&fit=crop',
  'pasta': 'https://images.unsplash.com/photo-1551183053-bf91a1d81141?w=400&h=300&fit=crop',
  // Generic fallbacks
  'breakfast': 'https://images.unsplash.com/photo-1533089860892-a7c6f0a88666?w=400&h=300&fit=crop',
  'lunch': 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=400&h=300&fit=crop',
  'dinner': 'https://images.unsplash.com/photo-1467003909585-2f8a72700288?w=400&h=300&fit=crop',
  'meal': 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=400&h=300&fit=crop',
};

function getFoodImage(dishName: string, mealType?: string): string {
  const nameLower = dishName.toLowerCase();

  // Check for keyword matches
  for (const [keyword, url] of Object.entries(FOOD_IMAGES)) {
    if (nameLower.includes(keyword)) {
      return url;
    }
  }

  // Fallback based on meal type
  const typeLower = (mealType || '').toLowerCase();
  if (typeLower.includes('breakfast')) {
    return FOOD_IMAGES['breakfast'];
  } else if (typeLower.includes('lunch')) {
    return FOOD_IMAGES['lunch'];
  } else if (typeLower.includes('dinner')) {
    return FOOD_IMAGES['dinner'];
  }

  return FOOD_IMAGES['meal'];
}

async function getUnsplashImage(dishName: string, mealType?: string): Promise<string | null> {
  // Check cache first
  const cacheKey = dishName.toLowerCase().trim();
  if (imageCache.has(cacheKey)) {
    return imageCache.get(cacheKey)!;
  }

  // If API key available, try Unsplash API
  if (UNSPLASH_ACCESS_KEY) {
    try {
      const searchQuery = encodeURIComponent(`${dishName} food dish`);
      const response = await fetch(
        `https://api.unsplash.com/search/photos?query=${searchQuery}&per_page=1&orientation=landscape`,
        {
          headers: {
            'Authorization': `Client-ID ${UNSPLASH_ACCESS_KEY}`,
          },
        }
      );

      if (response.ok) {
        const data = await response.json();
        if (data.results && data.results.length > 0) {
          const imageUrl = data.results[0].urls?.small || data.results[0].urls?.regular;
          if (imageUrl) {
            imageCache.set(cacheKey, imageUrl);
            return imageUrl;
          }
        }
      }
    } catch (err: any) {
      console.warn(`[unsplash] API error for "${dishName}":`, err.message);
    }
  }

  // Use curated image library as fallback
  const imageUrl = getFoodImage(dishName, mealType);
  imageCache.set(cacheKey, imageUrl);
  return imageUrl;
}

async function addImagesToMealPlan(plan: MealPlanResponse): Promise<MealPlanResponse> {
  // Add images directly to each meal (using curated library is fast, no batching needed)
  console.log('[addImagesToMealPlan] Starting image generation for', plan.days.length, 'days');

  for (const day of plan.days) {
    // Skip cheat days (they don't have meals)
    if ((day as any).isCheatDay) {
      console.log('[addImagesToMealPlan] Skipping day', day.day, '- is cheat day');
      continue;
    }

    if (!day.meals || !Array.isArray(day.meals)) {
      console.warn('[addImagesToMealPlan] Day', day.day, 'has no meals array');
      continue;
    }

    console.log('[addImagesToMealPlan] Adding images to day', day.day, '-', day.meals.length, 'meals');
    for (const meal of day.meals) {
      const imageUrl = await getUnsplashImage(meal.dishName, meal.mealType);
      (meal as any).imageUrl = imageUrl;
      console.log('[addImagesToMealPlan]   -', meal.dishName, ':', imageUrl ? 'image added' : 'no image');
    }
  }

  console.log('[addImagesToMealPlan] Image generation complete');
  return plan;
}

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

  // Build food preferences text
  const hatedFoodsText = preferences.hatedFoods
    ? `CRITICAL - NEVER include these hated foods: ${preferences.hatedFoods}. The user strongly dislikes these and they must be completely avoided.`
    : '';
  const favoriteProteinsText = preferences.favoriteProteins?.length
    ? `Prioritize these proteins: ${preferences.favoriteProteins.join(', ')}.`
    : '';
  const favoriteFruitsText = preferences.favoriteFruits?.length
    ? `Use these fruits: ${preferences.favoriteFruits.join(', ')}.`
    : '';
  const favoriteVegetablesText = preferences.favoriteVegetables?.length
    ? `Use these vegetables: ${preferences.favoriteVegetables.join(', ')}.`
    : '';
  const favoriteStarchesText = preferences.favoriteStarches?.length
    ? `Use these starches/carbs: ${preferences.favoriteStarches.join(', ')}.`
    : '';
  const favoriteCuisinesText = preferences.favoriteCuisines?.length
    ? `Favor these cuisines: ${preferences.favoriteCuisines.join(', ')}.`
    : '';
  const favoriteSnacksText = preferences.favoriteSnacks?.length
    ? `For snacks, use: ${preferences.favoriteSnacks.join(', ')}.`
    : '';

  // Handle snacks based on meal style
  const includeSnacks = preferences.mealStyle === 'threePlusSnacks';
  const snacksInstruction = includeSnacks
    ? 'IMPORTANT: Include 2-3 snacks per day in addition to breakfast, lunch, and dinner. Each snack should be 100-200 calories.'
    : '';

  // Handle cheat days - map to day numbers
  const cheatDayNumbers: number[] = [];
  const dayNameToNumber: { [key: string]: number } = {
    'Monday': 1,
    'Tuesday': 2,
    'Wednesday': 3,
    'Thursday': 4,
    'Friday': 5,
    'Saturday': 6,
    'Sunday': 7
  };

  if (preferences.cheatDays?.length) {
    preferences.cheatDays.forEach(dayName => {
      const dayNum = dayNameToNumber[dayName];
      if (dayNum) cheatDayNumbers.push(dayNum);
    });
  }

  const cheatDaysText = cheatDayNumbers.length > 0
    ? `CHEAT DAYS (Days ${cheatDayNumbers.join(', ')}): Do NOT generate meals for these days. Instead, provide encouraging advice on how to enjoy a cheat day mindfully while staying aligned with their goals.`
    : '';

  const mealDiversityText = preferences.mealDiversity === 'diverse'
    ? 'IMPORTANT: Create completely different and diverse meals for each day. Every day should have unique dishes - no repeating meals across the 7 days.'
    : preferences.mealDiversity === 'sameDaily'
    ? 'IMPORTANT: Create meal prep simplicity by using the EXACT SAME meals for all 7 days. Day 1 meals should be identical to Day 2, Day 3, etc. This allows the user to meal prep once for the entire week.'
    : 'Create diverse meals with different dishes each day.';

  // Build concise preferences list
  const prefsList = [];
  if (preferences.favoriteProteins?.length) {
    prefsList.push(`Proteins: ${preferences.favoriteProteins.join(', ')}`);
  }
  if (preferences.favoriteVegetables?.length) {
    prefsList.push(`Vegetables: ${preferences.favoriteVegetables.join(', ')}`);
  }
  if (preferences.favoriteStarches?.length) {
    prefsList.push(`Starches/Carbs: ${preferences.favoriteStarches.join(', ')}`);
  }
  if (preferences.favoriteCuisines?.length) {
    prefsList.push(`Cuisines: ${preferences.favoriteCuisines.join(', ')}`);
  }
  if (includeSnacks) {
    const snackTypes = preferences.favoriteSnacks?.length
      ? `(prefer ${preferences.favoriteSnacks.join(', ')} based snacks)`
      : '';
    prefsList.push(`Include 2-3 snacks/day (100-200cal each) ${snackTypes}`);
  }
  if (preferences.cheatDays?.length) {
    prefsList.push(`Cheat days (${preferences.cheatDays.join(', ')}): Allow indulgent meals with higher calories and more flexibility on these days`);
  }
  if (preferences.mealDiversity === 'diverse') {
    prefsList.push('Make all 7 days unique');
  } else if (preferences.mealDiversity === 'sameDaily') {
    prefsList.push('Repeat same meals all 7 days');
  }

  // CRITICAL: Put hated foods LAST so AI pays maximum attention (recency bias)
  if (preferences.hatedFoods) {
    prefsList.push(`CRITICAL ABSOLUTE RULE - NEVER EVER include or mention these foods in ANY meal or dish name: ${preferences.hatedFoods}. This is NON-NEGOTIABLE. Choose completely different dishes instead`);
  }

  // Build detailed JSON format example
  const mealFormatExample = `{
  "mealType": "Breakfast",
  "dishName": "Greek Yogurt Parfait",
  "description": "Creamy Greek yogurt layered with fresh berries and granola",
  "calories": 450,
  "macros": {"protein": 30, "carbs": 50, "fat": 15},
  "servings": 1
}`;

  const cheatDayInstructions = cheatDayNumbers.length > 0
    ? `\n\nCHEAT DAYS (Days ${cheatDayNumbers.join(', ')}): Use this EXACT format:\n{"day":X,"isCheatDay":true,"cheatDayAdvice":"Motivational 2-3 sentence advice"}\nDo NOT generate meals for cheat days.`
    : '';

  const systemPrompt = `You are a meal planning expert. Generate a 7-day meal plan in this EXACT JSON format:

{
  "days": [
    {
      "day": 1,
      "meals": [${mealFormatExample}, ...]
    }
  ]
}

CRITICAL - MEAL FORMAT:
- Each meal MUST have: mealType, dishName, description, calories, macros{protein,carbs,fat}, servings
- dishName is the COMPLETE dish name (e.g., "Grilled Chicken with Rice and Broccoli")
- calories is total for the dish
- macros must be an object with protein, carbs, fat in grams

Target: ${targets.calories}cal, ${targets.protein}g protein/day per day. ${dietTypeText} diet.
${allergiesText}
Preferences: ${prefsList.join('. ')}.${cheatDayInstructions}

Return ONLY valid JSON. No markdown, no explanations.`;

  const userPrompt = `Generate the complete 7-day meal plan JSON now.`;

  // Set 60 second timeout (meal plan generation is slow with detailed preferences)
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60000);

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

    // Validate each day has either meals or is a cheat day
    for (const day of parsedPlan.days) {
      if (!day.isCheatDay && (!day.meals || day.meals.length === 0)) {
        console.error('[mealPlan] Invalid day structure - day has no meals and is not a cheat day:', day);
        throw new Error('Invalid meal plan structure - days must have meals or be cheat days');
      }
      if (day.isCheatDay && !day.cheatDayAdvice) {
        console.error('[mealPlan] Cheat day missing advice:', day);
        throw new Error('Cheat days must include cheatDayAdvice');
      }
    }

    return {
      ...parsedPlan,
      generatedAt: new Date().toISOString(),
      targets,
    };
  } catch (err: any) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      console.warn('[mealPlan] OpenAI request timed out after 60s');
      throw new Error('Request timed out - AI generation took too long. Try again or simplify preferences.');
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
    budgetTier: preferences?.budgetTier,
    // Food preferences from onboarding
    mealStyle: preferences?.mealStyle,
    favoriteProteins: preferences?.favoriteProteins || [],
    favoriteFruits: preferences?.favoriteFruits || [],
    favoriteVegetables: preferences?.favoriteVegetables || [],
    favoriteStarches: preferences?.favoriteStarches || [],
    favoriteCuisines: preferences?.favoriteCuisines || [],
    favoriteSnacks: preferences?.favoriteSnacks || [],
    hatedFoods: preferences?.hatedFoods || '',
    cheatDays: preferences?.cheatDays || [],
    mealDiversity: preferences?.mealDiversity,
  };

  console.log(`[mealPlan] Generating 7-day plan for user ${shopifyCustomerId || 'anonymous'}:`, validatedTargets);

  try {
    // Generate AI meal plan
    let plan: MealPlanResponse;

    console.log(`[mealPlan] Calling OpenAI with model: ${OPENAI_MODEL}`);
    try {
      plan = await generateMealPlanWithAI(validatedTargets, validatedPreferences);
      console.log('[mealPlan] AI plan generated successfully');
    } catch (aiErr: any) {
      console.error('[mealPlan] AI generation failed:', aiErr.message);
      return sendServerError(res, `AI meal plan generation failed: ${aiErr.message}. Please try again.`);
    }

    // Add Unsplash images to each meal
    try {
      console.log('[mealPlan] Fetching meal images from Unsplash...');
      plan = await addImagesToMealPlan(plan);
      console.log('[mealPlan] Images added successfully');
    } catch (imgErr: any) {
      console.warn('[mealPlan] Image fetch failed (continuing without images):', imgErr.message);
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

        // Auto-save meals to user's meal library (skip cheat days)
        const allMeals = plan.days
          ?.filter((day: any) => !day.isCheatDay)
          .flatMap((day: any) => day.meals || []) || [];
        if (allMeals.length > 0) {
          console.log(`[mealPlan] Auto-saving ${allMeals.length} meals to library (skipping cheat days)...`);
          let savedCount = 0;
          for (const meal of allMeals) {
            try {
              const result = await pool.query(`
                INSERT INTO hc_meal_library (
                  shopify_customer_id, meal_name, meal_description, meal_type,
                  calories, protein, carbs, fat, ingredients, instructions,
                  servings, prep_time_minutes, cook_time_minutes, times_used
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 1)
                ON CONFLICT (shopify_customer_id, meal_name)
                DO UPDATE SET times_used = hc_meal_library.times_used + 1, last_used_at = NOW()
                RETURNING id
              `, [
                String(shopifyCustomerId),
                meal.dishName,
                meal.description || meal.mealDescription || '',
                meal.mealType,
                meal.calories || meal.macros?.calories || 0,
                meal.macros?.protein || meal.protein || 0,
                meal.macros?.carbs || meal.carbs || 0,
                meal.macros?.fat || meal.fat || 0,
                JSON.stringify(meal.ingredients || []),
                meal.instructions || '',
                meal.servings || 1,
                meal.prepTimeMinutes || null,
                meal.cookTimeMinutes || null
              ]);
              if (result.rows.length > 0) {
                savedCount++;
              }
            } catch (err: any) {
              console.error('[mealPlan] Error saving meal to library:', meal.dishName, err.message);
              // Continue with other meals
            }
          }
          console.log(`[mealPlan] Saved ${savedCount}/${allMeals.length} meals to library`);
        }
      } catch (dbErr) {
        console.warn('[mealPlan] Failed to store plan in database:', dbErr);
        // Continue anyway - plan still works
      }
    }

    return sendSuccess(res, { plan});

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
 * Uses the shared instacartClient for consistency
 */
mealPlanRouter.post('/instacart-order', planRateLimit, async (req: Request, res: Response) => {
  // Accept either 'shoppingList' or 'ingredients' for backwards compatibility
  const { shoppingList, ingredients, planTitle } = req.body;
  const items = shoppingList || ingredients;

  if (!items || !Array.isArray(items) || items.length === 0) {
    return sendError(res, 'Missing or empty shoppingList/ingredients', 400);
  }

  // Build line items using the InstacartLineItem type
  const lineItems: InstacartLineItem[] = items.map((item: ShoppingListItem) => ({
    name: item.name,
    quantity: item.quantity || 1,
    unit: item.unit || 'each',
    display_text: `${item.quantity || 1} ${item.unit || ''} ${item.name}`.trim(),
  }));

  // Check if API key is configured
  if (!process.env.INSTACART_API_KEY) {
    console.log('[mealPlan] No Instacart API key, using search fallback');
    const topItems = lineItems.slice(0, 10).map((item) => item.name).join(', ');
    return sendSuccess(res, {
      instacartUrl: `https://www.instacart.com/store/search/${encodeURIComponent(topItems)}`,
      itemsCount: lineItems.length,
      fallback: true,
      shoppingList: lineItems,
    });
  }

  try {
    console.log('[mealPlan] Calling createInstacartProductsLink with', lineItems.length, 'items');
    console.log('[mealPlan] INSTACART_ENV:', process.env.INSTACART_ENV || 'not set (using sandbox)');

    // Use the shared Instacart client
    const result = await createInstacartProductsLink({
      title: planTitle || '7-Day Meal Plan Groceries',
      line_items: lineItems,
      link_type: 'shopping_list',
      landing_page_configuration: {
        partner_linkback_url: 'https://heirclark.com/pages/meal-plan',
      },
    });

    console.log('[mealPlan] Instacart response:', result);

    if (result.products_link_url) {
      return sendSuccess(res, {
        instacartUrl: result.products_link_url,
        itemsCount: lineItems.length,
      });
    } else {
      throw new Error('No products_link_url in response');
    }

  } catch (err: any) {
    console.error('[mealPlan] Instacart order failed:', err.message);
    // Fall back to search URL on error - include error for debugging
    const topItems = lineItems.slice(0, 10).map((item: any) => item.name).join(', ');
    return sendSuccess(res, {
      instacartUrl: `https://www.instacart.com/store/search/${encodeURIComponent(topItems)}`,
      itemsCount: lineItems.length,
      fallback: true,
      fallbackReason: err.message, // Include error message for debugging
      shoppingList: lineItems,
    });
  }
});

/**
 * POST /api/v1/ai/recipe-details
 * Generate detailed recipe with AI for a specific meal
 */
mealPlanRouter.post('/recipe-details', recipeRateLimit, async (req: Request, res: Response) => {
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

// ============================================================
// SINGLE MEAL REFRESH ENDPOINT
// ============================================================

// Curated meal options for fast selection (no AI needed for meal name)
const MEAL_OPTIONS: Record<string, string[]> = {
  breakfast: [
    'Greek Yogurt Parfait with Berries',
    'Avocado Toast with Poached Eggs',
    'Oatmeal with Banana and Almond Butter',
    'Spinach and Feta Omelette',
    'Protein Smoothie Bowl',
    'Whole Grain Pancakes with Fresh Fruit',
    'Egg White Scramble with Vegetables',
    'Chia Seed Pudding with Mango',
    'Turkey Sausage Breakfast Bowl',
    'Cottage Cheese with Pineapple',
    'Veggie Egg Scramble',
    'Overnight Oats with Berries',
    'Breakfast Burrito with Eggs',
    'Smoked Salmon Bagel',
    'Acai Bowl with Granola',
  ],
  lunch: [
    'Grilled Chicken Caesar Salad',
    'Quinoa Buddha Bowl',
    'Turkey and Avocado Wrap',
    'Mediterranean Chickpea Salad',
    'Asian Chicken Lettuce Wraps',
    'Salmon Poke Bowl',
    'Black Bean and Corn Salad',
    'Grilled Shrimp Tacos',
    'Caprese Chicken Sandwich',
    'Thai Peanut Noodle Bowl',
    'Tuna Salad on Greens',
    'Greek Salad with Grilled Chicken',
    'Turkey Club Wrap',
    'Veggie Stir-Fry Bowl',
    'Southwest Chicken Salad',
  ],
  dinner: [
    'Grilled Salmon with Roasted Vegetables',
    'Chicken Stir-Fry with Brown Rice',
    'Lean Beef with Sweet Potato',
    'Baked Cod with Quinoa Pilaf',
    'Turkey Meatballs with Zucchini Noodles',
    'Herb-Crusted Pork Tenderloin',
    'Shrimp and Vegetable Curry',
    'Grilled Chicken with Mediterranean Salad',
    'Tofu and Vegetable Stir-Fry',
    'Lemon Herb Tilapia with Asparagus',
    'Baked Salmon with Vegetables',
    'Chicken Breast with Green Beans',
    'Beef Stir-Fry with Broccoli',
    'Garlic Butter Shrimp with Rice',
    'Stuffed Bell Peppers',
  ],
};

/**
 * POST /api/v1/ai/single-meal
 * Fast endpoint to generate a single meal replacement
 * Much faster than calling meal-plan-7day for a single meal refresh
 */
mealPlanRouter.post('/single-meal', recipeRateLimit, async (req: Request, res: Response) => {
  const { mealType, targetCalories, excludeMeals, dietaryRestrictions, macros } = req.body;

  const type = (mealType || 'lunch').toLowerCase();
  const calories = targetCalories || 500;
  const excludeList = (excludeMeals || []).map((m: string) => m.toLowerCase());

  // Get available meals, excluding any the user doesn't want
  const availableMeals = (MEAL_OPTIONS[type] || MEAL_OPTIONS.lunch)
    .filter(meal => !excludeList.some((ex: string) => meal.toLowerCase().includes(ex)));

  if (availableMeals.length === 0) {
    return sendError(res, 'No available meals for this type', 400);
  }

  // Pick a random meal
  const selectedMeal = availableMeals[Math.floor(Math.random() * availableMeals.length)];

  // Calculate macros based on calories (balanced distribution)
  const mealMacros = macros || {
    protein: Math.round(calories * 0.3 / 4), // 30% protein (4 cal/g)
    carbs: Math.round(calories * 0.4 / 4),   // 40% carbs (4 cal/g)
    fat: Math.round(calories * 0.3 / 9),     // 30% fat (9 cal/g)
  };

  // Get image for the meal
  const imageUrl = getFoodImage(selectedMeal, type);

  // If OpenAI is available, generate detailed recipe with goal-matching macros
  if (OPENAI_API_KEY) {
    try {
      // Use provided macros as targets, or calculate defaults
      const targetProtein = mealMacros.protein;
      const targetCarbs = mealMacros.carbs;
      const targetFat = mealMacros.fat;

      const prompt = `Create a recipe for "${selectedMeal}" that MUST hit these exact nutrition targets:
- Calories: ${calories}
- Protein: ${targetProtein}g
- Carbs: ${targetCarbs}g
- Fat: ${targetFat}g

Adjust portion sizes and ingredient quantities to hit these targets. Scale up protein sources if needed.

Return ONLY valid JSON:
{
  "calories": ${calories},
  "protein": ${targetProtein},
  "carbs": ${targetCarbs},
  "fat": ${targetFat},
  "ingredients": [{"name": "ingredient", "quantity": 1, "unit": "cup"}],
  "instructions": ["Step 1", "Step 2"],
  "prepMinutes": 10,
  "cookMinutes": 15,
  "description": "Brief appetizing description",
  "servingSize": "portion description"
}
Use 5-8 common ingredients with quantities scaled to match the targets.${dietaryRestrictions?.length ? ` Restrictions: ${dietaryRestrictions.join(', ')}` : ''}`;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000); // 8 second timeout for speed

      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: OPENAI_MODEL,
          messages: [
            { role: 'system', content: 'Chef creating quick, healthy recipes. Return only JSON.' },
            { role: 'user', content: prompt },
          ],
          temperature: 0.6,
          max_tokens: 800,
        }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (response.ok) {
        const data = await response.json();
        let content = data.choices?.[0]?.message?.content || '';

        // Clean markdown
        if (content.startsWith('```')) {
          content = content.replace(/```json?\n?/g, '').replace(/```$/g, '');
        }

        const recipeData = JSON.parse(content.trim());

        // Use target macros (AI was instructed to match these)
        const dishCalories = calories;
        const dishMacros = {
          protein: targetProtein,
          carbs: targetCarbs,
          fat: targetFat,
        };

        return sendSuccess(res, {
          meal: {
            mealType: type.charAt(0).toUpperCase() + type.slice(1),
            dishName: selectedMeal,
            name: selectedMeal,
            description: recipeData.description || `Delicious ${selectedMeal}`,
            calories: dishCalories,
            macros: dishMacros,
            servings: 1,
            servingSize: recipeData.servingSize || null,
            imageUrl,
            recipe: {
              ingredients: recipeData.ingredients || [],
              instructions: recipeData.instructions || [],
              prepMinutes: recipeData.prepMinutes || 10,
              cookMinutes: recipeData.cookMinutes || 15,
            },
          },
        });
      }
    } catch (err: any) {
      console.warn('[mealPlan] AI recipe failed, using generic:', err.message);
    }
  }

  // Fallback: return meal without detailed recipe
  return sendSuccess(res, {
    meal: {
      mealType: type.charAt(0).toUpperCase() + type.slice(1),
      dishName: selectedMeal,
      name: selectedMeal,
      description: `Delicious ${selectedMeal}`,
      calories,
      macros: mealMacros,
      servings: 1,
      imageUrl,
      recipe: generateGenericRecipe(selectedMeal, calories, mealMacros),
    },
  });
});

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
