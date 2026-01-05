// src/services/mealPlanAI.ts
// AI-Powered Meal Planning with Budget Awareness
// Integrates with Nutrition Graph and Instacart for end-to-end meal planning

import OpenAI from 'openai';
import { Pool } from 'pg';
import crypto from 'crypto';
import { NutritionGraphDB } from '../db/nutritionGraph';
import { NutritionFood, NutrientProfile } from '../types/nutrition';

// ==========================================================================
// Types
// ==========================================================================

export interface MealPlanConstraints {
  daily_calories: number;
  daily_protein_g: number;
  daily_carbs_g: number;
  daily_fat_g: number;
  dietary_restrictions?: string[];  // 'vegetarian', 'vegan', 'gluten_free', etc.
  allergies?: string[];
  cuisine_preferences?: string[];
  cooking_skill?: 'beginner' | 'intermediate' | 'advanced';
  max_prep_time_minutes?: number;
  meals_per_day?: number;  // Default 3
}

export interface BudgetConstraints {
  weekly_budget_cents: number;
  preferred_stores?: string[];
  prioritize_sales?: boolean;
}

export interface PantryItem {
  food_id?: string;
  name: string;
  quantity?: number;
  unit?: string;
}

export interface PlannedMeal {
  meal_type: 'breakfast' | 'lunch' | 'dinner' | 'snack';
  name: string;
  description?: string;
  prep_time_minutes?: number;
  cook_time_minutes?: number;
  servings: number;
  ingredients: PlannedIngredient[];
  instructions?: string[];
  nutrients: NutrientProfile;
  image_url?: string;
}

export interface PlannedIngredient {
  food_id?: string;
  name: string;
  amount: number;
  unit: string;
  price_cents?: number;
  store?: string;
  in_pantry?: boolean;
}

export interface DayPlan {
  day: number;  // 1-7
  day_name: string;
  meals: PlannedMeal[];
  daily_totals: NutrientProfile;
  daily_cost_cents?: number;
}

export interface WeekPlan {
  id: string;
  created_at: Date;
  constraints: MealPlanConstraints;
  budget?: BudgetConstraints;
  days: DayPlan[];
  weekly_totals: NutrientProfile;
  weekly_cost_cents?: number;
  grocery_list: GroceryListItem[];
  ai_notes?: string;
}

export interface GroceryListItem {
  food_id?: string;
  name: string;
  total_amount: number;
  unit: string;
  category?: string;
  price_cents?: number;
  store?: string;
  instacart_product_id?: string;
}

export interface PlanFeedback {
  type: 'swap_meal' | 'adjust_portions' | 'change_ingredient' | 'regenerate_day';
  day?: number;
  meal_index?: number;
  reason?: string;
  preferences?: string;
}

// ==========================================================================
// AI Meal Plan Service
// ==========================================================================

export class MealPlanAIService {
  private openai: OpenAI;
  private pool: Pool;
  private nutritionDB: NutritionGraphDB;

  constructor(pool: Pool, openaiApiKey?: string) {
    this.pool = pool;
    this.nutritionDB = new NutritionGraphDB(pool);
    this.openai = new OpenAI({
      apiKey: openaiApiKey || process.env.OPENAI_API_KEY,
    });
  }

  // ==========================================================================
  // Main Plan Generation
  // ==========================================================================

  async generateWeekPlan(
    constraints: MealPlanConstraints,
    pantry?: PantryItem[],
    budget?: BudgetConstraints
  ): Promise<WeekPlan> {
    const startTime = Date.now();

    // Build context for AI (keep it concise)
    const pantryContext = pantry?.length
      ? `Pantry: ${pantry.slice(0, 10).map(p => p.name).join(', ')}`
      : '';

    const budgetContext = budget
      ? `Budget: $${(budget.weekly_budget_cents / 100).toFixed(0)}/week`
      : '';

    const prompt = this.buildMealPlanPrompt(constraints, pantryContext, budgetContext, '');

    try {
      // Create abort controller for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 55000); // 55 second timeout

      const response = await this.openai.chat.completions.create({
        model: 'gpt-4.1-mini',
        messages: [
          {
            role: 'system',
            content: MEAL_PLAN_SYSTEM_PROMPT,
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        response_format: { type: 'json_object' },
        max_tokens: 2500,
        temperature: 0.7,
      }, { signal: controller.signal });

      clearTimeout(timeoutId);

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error('No response from AI');
      }

      const rawPlan = JSON.parse(content);
      const weekPlan = await this.processAndEnrichPlan(rawPlan, constraints, budget);

      console.log(`[MealPlanAI] Generated plan in ${Date.now() - startTime}ms`);
      return weekPlan;

    } catch (error: any) {
      console.error('[MealPlanAI] Generation error:', error?.message || error);
      // Return fallback plan
      return this.generateFallbackPlan(constraints, budget);
    }
  }

  // ==========================================================================
  // Plan Adjustment
  // ==========================================================================

  async adjustWeekPlan(
    existingPlan: WeekPlan,
    feedback: PlanFeedback
  ): Promise<WeekPlan> {
    const prompt = this.buildAdjustmentPrompt(existingPlan, feedback);

    try {
      const response = await this.openai.chat.completions.create({
        model: 'gpt-4.1-mini',
        messages: [
          {
            role: 'system',
            content: MEAL_PLAN_SYSTEM_PROMPT,
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        response_format: { type: 'json_object' },
        max_tokens: 4000,
        temperature: 0.7,
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        return existingPlan;
      }

      const adjustment = JSON.parse(content);
      return this.applyAdjustment(existingPlan, adjustment, feedback);

    } catch (error) {
      console.error('[MealPlanAI] Adjustment error:', error);
      return existingPlan;
    }
  }

  // ==========================================================================
  // Plan Explanation
  // ==========================================================================

  async explainPlanToUser(
    plan: WeekPlan,
    constraints: MealPlanConstraints
  ): Promise<string> {
    const prompt = `
Explain this meal plan to the user in a friendly, encouraging way.

User's Goals:
- Daily calories: ${constraints.daily_calories}
- Daily protein: ${constraints.daily_protein_g}g
- Dietary restrictions: ${constraints.dietary_restrictions?.join(', ') || 'None'}

Plan Summary:
- Weekly cost: $${plan.weekly_cost_cents ? (plan.weekly_cost_cents / 100).toFixed(2) : 'Not calculated'}
- Average daily calories: ${Math.round(plan.weekly_totals.calories / 7)}
- Average daily protein: ${Math.round(plan.weekly_totals.protein_g / 7)}g
- Total grocery items: ${plan.grocery_list.length}

Sample meals:
${plan.days[0].meals.map(m => `- ${m.meal_type}: ${m.name}`).join('\n')}

Write a 2-3 paragraph explanation that:
1. Highlights how the plan meets their goals
2. Mentions key protein sources and variety
3. Gives one practical tip for meal prep success
`;

    try {
      const response = await this.openai.chat.completions.create({
        model: 'gpt-4.1-mini',
        messages: [
          {
            role: 'system',
            content: 'You are a friendly nutritionist helping users understand their meal plans. Be encouraging and practical.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        max_tokens: 500,
        temperature: 0.8,
      });

      return response.choices[0]?.message?.content || 'Your personalized meal plan is ready!';

    } catch (error) {
      console.error('[MealPlanAI] Explanation error:', error);
      return 'Your personalized meal plan is ready! It\'s designed to meet your daily nutrition goals with delicious, balanced meals.';
    }
  }

  // ==========================================================================
  // Private Helpers
  // ==========================================================================

  private buildMealPlanPrompt(
    constraints: MealPlanConstraints,
    pantryContext: string,
    budgetContext: string,
    foodsContext: string
  ): string {
    const restrictions = constraints.dietary_restrictions?.length
      ? `Restrictions: ${constraints.dietary_restrictions.join(', ')}.`
      : '';
    const allergies = constraints.allergies?.length
      ? `Allergies: ${constraints.allergies.join(', ')}.`
      : '';

    // Simplified prompt - just meal names and macros, no ingredients
    return `7-day meal plan. ${constraints.daily_calories}cal, ${constraints.daily_protein_g}g protein daily. ${restrictions} ${allergies}

JSON format:
{"days":[{"day":1,"day_name":"Mon","meals":[{"meal_type":"breakfast","name":"Eggs & Toast","nutrients":{"calories":400,"protein_g":25,"carbs_g":30,"fat_g":20}},{"meal_type":"lunch","name":"Chicken Salad","nutrients":{"calories":500,"protein_g":45,"carbs_g":25,"fat_g":25}},{"meal_type":"dinner","name":"Salmon Rice","nutrients":{"calories":600,"protein_g":50,"carbs_g":50,"fat_g":20}}]},{"day":2,"day_name":"Tue","meals":[...]},...]}

Return all 7 days. Use varied high-protein meals. Short names only.`;
  }

  private buildAdjustmentPrompt(plan: WeekPlan, feedback: PlanFeedback): string {
    let context = '';

    if (feedback.type === 'swap_meal' && feedback.day && feedback.meal_index !== undefined) {
      const meal = plan.days[feedback.day - 1]?.meals[feedback.meal_index];
      context = `User wants to swap: ${meal?.name}. Reason: ${feedback.reason || 'Not specified'}. Preferences: ${feedback.preferences || 'Similar macros'}`;
    } else if (feedback.type === 'regenerate_day' && feedback.day) {
      context = `Regenerate all meals for day ${feedback.day}. Reason: ${feedback.reason || 'Not specified'}`;
    } else if (feedback.type === 'adjust_portions') {
      context = `Adjust portions. Reason: ${feedback.reason || 'Not specified'}`;
    }

    return `
Current plan constraints: ${JSON.stringify(plan.constraints)}

${context}

Return JSON with the replacement meal(s) or adjusted plan section.
`;
  }

  private async processAndEnrichPlan(
    rawPlan: any,
    constraints: MealPlanConstraints,
    budget?: BudgetConstraints
  ): Promise<WeekPlan> {
    const days: DayPlan[] = [];
    const groceryMap = new Map<string, GroceryListItem>();

    // Day name mapping
    const dayNames: Record<string, string> = {
      'Mon': 'Monday', 'Tue': 'Tuesday', 'Wed': 'Wednesday',
      'Thu': 'Thursday', 'Fri': 'Friday', 'Sat': 'Saturday', 'Sun': 'Sunday'
    };

    // Process each day
    for (const rawDay of rawPlan.days || []) {
      const dayMeals: PlannedMeal[] = [];
      let dailyTotals: NutrientProfile = {
        calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0,
      };

      for (const rawMeal of rawDay.meals || []) {
        // Generate basic ingredients from meal name
        const ingredients = this.inferIngredientsFromMealName(rawMeal.name);

        const meal: PlannedMeal = {
          meal_type: rawMeal.meal_type,
          name: rawMeal.name,
          servings: 1,
          ingredients,
          nutrients: rawMeal.nutrients || { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 },
        };

        // Accumulate daily totals
        dailyTotals.calories += meal.nutrients.calories || 0;
        dailyTotals.protein_g += meal.nutrients.protein_g || 0;
        dailyTotals.carbs_g += meal.nutrients.carbs_g || 0;
        dailyTotals.fat_g += meal.nutrients.fat_g || 0;

        // Accumulate grocery list from inferred ingredients
        for (const ing of ingredients) {
          const key = `${ing.name.toLowerCase()}_${ing.unit}`;
          const existing = groceryMap.get(key);
          if (existing) {
            existing.total_amount += ing.amount;
          } else {
            groceryMap.set(key, {
              name: ing.name,
              total_amount: ing.amount,
              unit: ing.unit,
              category: this.inferCategory(ing.name),
            });
          }
        }

        dayMeals.push(meal);
      }

      const fullDayName = dayNames[rawDay.day_name] || rawDay.day_name;
      days.push({
        day: rawDay.day,
        day_name: fullDayName,
        meals: dayMeals,
        daily_totals: dailyTotals,
      });
    }

    // Calculate weekly totals
    const weeklyTotals: NutrientProfile = {
      calories: days.reduce((sum, d) => sum + d.daily_totals.calories, 0),
      protein_g: days.reduce((sum, d) => sum + d.daily_totals.protein_g, 0),
      carbs_g: days.reduce((sum, d) => sum + d.daily_totals.carbs_g, 0),
      fat_g: days.reduce((sum, d) => sum + d.daily_totals.fat_g, 0),
    };

    const groceryList = Array.from(groceryMap.values());

    // Enrich grocery list with store mappings and prices
    await this.enrichGroceryListWithStoreMappings(groceryList);

    // Calculate weekly cost
    const weeklyPrice = groceryList.reduce((sum, item) => sum + (item.price_cents || 0), 0);

    return {
      id: crypto.randomUUID(),
      created_at: new Date(),
      constraints,
      budget,
      days,
      weekly_totals: weeklyTotals,
      weekly_cost_cents: weeklyPrice > 0 ? weeklyPrice : undefined,
      grocery_list: groceryList,
      ai_notes: rawPlan.ai_notes || 'AI-generated meal plan',
    };
  }

  private inferIngredientsFromMealName(mealName: string): PlannedIngredient[] {
    const nameLower = mealName.toLowerCase();
    const ingredients: PlannedIngredient[] = [];

    // Common protein sources
    if (nameLower.includes('chicken')) ingredients.push({ name: 'Chicken Breast', amount: 150, unit: 'g' });
    if (nameLower.includes('salmon') || nameLower.includes('fish')) ingredients.push({ name: 'Salmon Fillet', amount: 150, unit: 'g' });
    if (nameLower.includes('beef') || nameLower.includes('steak')) ingredients.push({ name: 'Beef', amount: 150, unit: 'g' });
    if (nameLower.includes('egg')) ingredients.push({ name: 'Eggs', amount: 3, unit: 'large' });
    if (nameLower.includes('turkey')) ingredients.push({ name: 'Ground Turkey', amount: 150, unit: 'g' });
    if (nameLower.includes('shrimp')) ingredients.push({ name: 'Shrimp', amount: 150, unit: 'g' });
    if (nameLower.includes('tofu')) ingredients.push({ name: 'Tofu', amount: 200, unit: 'g' });
    if (nameLower.includes('yogurt')) ingredients.push({ name: 'Greek Yogurt', amount: 200, unit: 'g' });
    if (nameLower.includes('cottage')) ingredients.push({ name: 'Cottage Cheese', amount: 200, unit: 'g' });

    // Common carbs
    if (nameLower.includes('rice')) ingredients.push({ name: 'Rice', amount: 100, unit: 'g' });
    if (nameLower.includes('quinoa')) ingredients.push({ name: 'Quinoa', amount: 100, unit: 'g' });
    if (nameLower.includes('pasta')) ingredients.push({ name: 'Pasta', amount: 100, unit: 'g' });
    if (nameLower.includes('oat')) ingredients.push({ name: 'Oats', amount: 80, unit: 'g' });
    if (nameLower.includes('toast') || nameLower.includes('bread')) ingredients.push({ name: 'Whole Grain Bread', amount: 2, unit: 'slices' });
    if (nameLower.includes('potato') || nameLower.includes('sweet potato')) ingredients.push({ name: 'Sweet Potato', amount: 150, unit: 'g' });

    // Common vegetables
    if (nameLower.includes('salad')) ingredients.push({ name: 'Mixed Greens', amount: 100, unit: 'g' });
    if (nameLower.includes('broccoli')) ingredients.push({ name: 'Broccoli', amount: 100, unit: 'g' });
    if (nameLower.includes('vegetable') || nameLower.includes('veggies')) ingredients.push({ name: 'Mixed Vegetables', amount: 150, unit: 'g' });
    if (nameLower.includes('spinach')) ingredients.push({ name: 'Spinach', amount: 50, unit: 'g' });

    // Fruits
    if (nameLower.includes('berr')) ingredients.push({ name: 'Mixed Berries', amount: 100, unit: 'g' });
    if (nameLower.includes('banana')) ingredients.push({ name: 'Banana', amount: 1, unit: 'medium' });

    // If no ingredients matched, add generic ones based on meal type
    if (ingredients.length === 0) {
      ingredients.push({ name: 'Protein Source', amount: 150, unit: 'g' });
      ingredients.push({ name: 'Vegetables', amount: 100, unit: 'g' });
    }

    return ingredients;
  }

  private inferCategory(ingredientName: string): string {
    const nameLower = ingredientName.toLowerCase();
    if (/chicken|beef|turkey|salmon|fish|shrimp|egg|tofu/.test(nameLower)) return 'Protein';
    if (/rice|quinoa|pasta|oat|bread|potato/.test(nameLower)) return 'Grains';
    if (/yogurt|cheese|milk/.test(nameLower)) return 'Dairy';
    if (/greens|broccoli|spinach|vegetable/.test(nameLower)) return 'Vegetables';
    if (/berr|banana|fruit/.test(nameLower)) return 'Fruits';
    return 'Other';
  }

  private async enrichGroceryListWithStoreMappings(
    groceryList: GroceryListItem[]
  ): Promise<void> {
    // Price estimates per unit (in cents) for common grocery items
    const priceEstimates: Record<string, { price_cents: number; unit: string; instacart_name: string }> = {
      'chicken breast': { price_cents: 899, unit: 'lb', instacart_name: 'Boneless Skinless Chicken Breast' },
      'salmon fillet': { price_cents: 1299, unit: 'lb', instacart_name: 'Atlantic Salmon Fillet' },
      'ground turkey': { price_cents: 699, unit: 'lb', instacart_name: 'Lean Ground Turkey' },
      'shrimp': { price_cents: 1199, unit: 'lb', instacart_name: 'Large Shrimp Peeled & Deveined' },
      'eggs': { price_cents: 499, unit: 'dozen', instacart_name: 'Large Grade A Eggs' },
      'greek yogurt': { price_cents: 599, unit: '32oz', instacart_name: 'Plain Greek Yogurt' },
      'cottage cheese': { price_cents: 449, unit: '16oz', instacart_name: 'Low Fat Cottage Cheese' },
      'tofu': { price_cents: 299, unit: '14oz', instacart_name: 'Firm Tofu' },
      'beef': { price_cents: 999, unit: 'lb', instacart_name: 'Ground Beef 85% Lean' },
      'rice': { price_cents: 399, unit: '2lb', instacart_name: 'Long Grain White Rice' },
      'quinoa': { price_cents: 599, unit: '12oz', instacart_name: 'Organic Quinoa' },
      'pasta': { price_cents: 199, unit: '16oz', instacart_name: 'Whole Wheat Penne Pasta' },
      'oats': { price_cents: 449, unit: '42oz', instacart_name: 'Old Fashioned Rolled Oats' },
      'whole grain bread': { price_cents: 449, unit: 'loaf', instacart_name: 'Whole Wheat Bread' },
      'sweet potato': { price_cents: 199, unit: 'lb', instacart_name: 'Sweet Potatoes' },
      'mixed greens': { price_cents: 499, unit: '5oz', instacart_name: 'Organic Spring Mix' },
      'broccoli': { price_cents: 299, unit: 'lb', instacart_name: 'Fresh Broccoli Crowns' },
      'mixed vegetables': { price_cents: 349, unit: '12oz', instacart_name: 'Frozen Mixed Vegetables' },
      'spinach': { price_cents: 399, unit: '5oz', instacart_name: 'Baby Spinach' },
      'mixed berries': { price_cents: 599, unit: '12oz', instacart_name: 'Frozen Mixed Berries' },
      'banana': { price_cents: 59, unit: 'each', instacart_name: 'Organic Bananas' },
      'avocado': { price_cents: 199, unit: 'each', instacart_name: 'Hass Avocados' },
    };

    for (const item of groceryList) {
      const itemNameLower = item.name.toLowerCase();

      // First try to find in nutrition database
      try {
        const searchResult = await this.nutritionDB.searchFoods({
          query: item.name,
        }, 1, 1);

        if (searchResult.foods.length > 0) {
          const food = searchResult.foods[0];
          item.food_id = food.id;

          // Check for store mapping
          if (food.store_mappings && food.store_mappings.length > 0) {
            const mapping = food.store_mappings[0];
            item.price_cents = mapping.price_cents;
            item.store = mapping.store;
            item.instacart_product_id = mapping.product_id;
            continue;
          }
        }
      } catch (err) {
        // Continue with price estimation
      }

      // Fall back to price estimates
      for (const [key, estimate] of Object.entries(priceEstimates)) {
        if (itemNameLower.includes(key) || key.includes(itemNameLower)) {
          // Calculate price based on quantity
          let priceCents = estimate.price_cents;

          // Adjust for quantity (rough estimates)
          if (item.unit === 'g') {
            // Convert grams to typical package size price
            if (itemNameLower.includes('chicken') || itemNameLower.includes('beef') ||
                itemNameLower.includes('turkey') || itemNameLower.includes('salmon') ||
                itemNameLower.includes('shrimp')) {
              // Protein: ~$9-13/lb, item.total_amount in grams
              priceCents = Math.round((item.total_amount / 454) * estimate.price_cents);
            } else if (itemNameLower.includes('yogurt') || itemNameLower.includes('cheese')) {
              // Dairy: use base price for typical container
              priceCents = estimate.price_cents;
            } else {
              // Vegetables/grains: scale by weight
              priceCents = Math.round((item.total_amount / 400) * estimate.price_cents);
            }
          } else if (item.unit === 'large' && itemNameLower.includes('egg')) {
            // Eggs: price per dozen, adjust for quantity
            priceCents = Math.round((item.total_amount / 12) * estimate.price_cents);
          }

          item.price_cents = Math.max(priceCents, 99); // Minimum 99 cents
          item.store = 'instacart';
          item.instacart_product_id = `est_${key.replace(/\s+/g, '_')}`;
          break;
        }
      }

      // Default price if no match found
      if (!item.price_cents) {
        item.price_cents = 399; // Default $3.99
        item.store = 'instacart';
      }
    }
  }

  private async enrichGroceryListWithPrices(
    groceryList: GroceryListItem[],
    stores: string[]
  ): Promise<void> {
    // Deprecated - use enrichGroceryListWithStoreMappings instead
    await this.enrichGroceryListWithStoreMappings(groceryList);
  }

  private applyAdjustment(
    plan: WeekPlan,
    adjustment: any,
    feedback: PlanFeedback
  ): WeekPlan {
    const updatedPlan = { ...plan };

    if (feedback.type === 'swap_meal' && feedback.day && feedback.meal_index !== undefined) {
      if (adjustment.meal) {
        updatedPlan.days[feedback.day - 1].meals[feedback.meal_index] = adjustment.meal;
      }
    } else if (feedback.type === 'regenerate_day' && feedback.day && adjustment.day) {
      updatedPlan.days[feedback.day - 1] = adjustment.day;
    }

    return updatedPlan;
  }

  private generateFallbackPlan(
    constraints: MealPlanConstraints,
    budget?: BudgetConstraints
  ): WeekPlan {
    // Simple fallback plan when AI fails
    const dayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

    const fallbackMeals = [
      { type: 'breakfast', name: 'Greek Yogurt Parfait', cal: 350, pro: 25, carb: 40, fat: 10 },
      { type: 'lunch', name: 'Grilled Chicken Salad', cal: 450, pro: 40, carb: 20, fat: 25 },
      { type: 'dinner', name: 'Salmon with Vegetables', cal: 550, pro: 45, carb: 30, fat: 25 },
    ];

    const days: DayPlan[] = dayNames.map((name, i) => ({
      day: i + 1,
      day_name: name,
      meals: fallbackMeals.map(m => ({
        meal_type: m.type as any,
        name: m.name,
        servings: 1,
        ingredients: [],
        nutrients: { calories: m.cal, protein_g: m.pro, carbs_g: m.carb, fat_g: m.fat },
      })),
      daily_totals: {
        calories: fallbackMeals.reduce((s, m) => s + m.cal, 0),
        protein_g: fallbackMeals.reduce((s, m) => s + m.pro, 0),
        carbs_g: fallbackMeals.reduce((s, m) => s + m.carb, 0),
        fat_g: fallbackMeals.reduce((s, m) => s + m.fat, 0),
      },
    }));

    return {
      id: crypto.randomUUID(),
      created_at: new Date(),
      constraints,
      budget,
      days,
      weekly_totals: {
        calories: days.reduce((s, d) => s + d.daily_totals.calories, 0),
        protein_g: days.reduce((s, d) => s + d.daily_totals.protein_g, 0),
        carbs_g: days.reduce((s, d) => s + d.daily_totals.carbs_g, 0),
        fat_g: days.reduce((s, d) => s + d.daily_totals.fat_g, 0),
      },
      grocery_list: [],
      ai_notes: 'Fallback plan generated due to AI service unavailability.',
    };
  }
}

// ==========================================================================
// System Prompts
// ==========================================================================

const MEAL_PLAN_SYSTEM_PROMPT = `Expert nutritionist creating meal plans. Meet macro targets within 5%. Use lean proteins (chicken, fish, eggs, Greek yogurt), vegetables, complex carbs. Return valid JSON only.`;

export default MealPlanAIService;
