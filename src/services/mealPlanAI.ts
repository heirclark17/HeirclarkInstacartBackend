// src/services/mealPlanAI.ts
// AI-Powered Meal Planning with Budget Awareness
// Integrates with Nutrition Graph and Instacart for end-to-end meal planning

import OpenAI from 'openai';
import { Pool } from 'pg';
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

    // Build context for AI
    const pantryContext = pantry?.length
      ? `User has these items in pantry: ${pantry.map(p => p.name).join(', ')}`
      : '';

    const budgetContext = budget
      ? `Weekly budget: $${(budget.weekly_budget_cents / 100).toFixed(2)}. ${budget.prioritize_sales ? 'Prioritize items on sale.' : ''}`
      : '';

    // Get high-protein foods from our database for reference
    const highProteinFoods = await this.nutritionDB.searchFoods({
      min_protein_g: 20,
      max_calories: 400,
      has_store_mapping: true,
    }, 1, 20);

    const foodsContext = highProteinFoods.foods.length > 0
      ? `Available high-protein foods in database: ${highProteinFoods.foods.map(f => `${f.name} (${f.nutrients.protein_g}g protein)`).join(', ')}`
      : '';

    const prompt = this.buildMealPlanPrompt(constraints, pantryContext, budgetContext, foodsContext);

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
        max_tokens: 8000,
        temperature: 0.7,
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error('No response from AI');
      }

      const rawPlan = JSON.parse(content);
      const weekPlan = await this.processAndEnrichPlan(rawPlan, constraints, budget);

      console.log(`[MealPlanAI] Generated plan in ${Date.now() - startTime}ms`);
      return weekPlan;

    } catch (error) {
      console.error('[MealPlanAI] Generation error:', error);
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
    return `
Generate a 7-day meal plan with the following requirements:

NUTRITION TARGETS (per day):
- Calories: ${constraints.daily_calories}
- Protein: ${constraints.daily_protein_g}g
- Carbs: ${constraints.daily_carbs_g}g
- Fat: ${constraints.daily_fat_g}g

DIETARY REQUIREMENTS:
- Restrictions: ${constraints.dietary_restrictions?.join(', ') || 'None'}
- Allergies: ${constraints.allergies?.join(', ') || 'None'}
- Cuisine preferences: ${constraints.cuisine_preferences?.join(', ') || 'Any'}
- Cooking skill: ${constraints.cooking_skill || 'intermediate'}
- Max prep time: ${constraints.max_prep_time_minutes || 45} minutes
- Meals per day: ${constraints.meals_per_day || 3}

${pantryContext}
${budgetContext}
${foodsContext}

Return a JSON object with this structure:
{
  "days": [
    {
      "day": 1,
      "day_name": "Monday",
      "meals": [
        {
          "meal_type": "breakfast",
          "name": "...",
          "description": "...",
          "prep_time_minutes": 10,
          "cook_time_minutes": 15,
          "servings": 1,
          "ingredients": [
            {"name": "...", "amount": 100, "unit": "g"}
          ],
          "instructions": ["Step 1...", "Step 2..."],
          "nutrients": {
            "calories": 400,
            "protein_g": 30,
            "carbs_g": 40,
            "fat_g": 15
          }
        }
      ]
    }
  ],
  "grocery_list": [
    {"name": "...", "total_amount": 500, "unit": "g", "category": "Protein"}
  ],
  "ai_notes": "Brief notes about the plan..."
}
`;
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

    // Process each day
    for (const rawDay of rawPlan.days || []) {
      const dayMeals: PlannedMeal[] = [];
      let dailyTotals: NutrientProfile = {
        calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0,
      };

      for (const rawMeal of rawDay.meals || []) {
        const meal: PlannedMeal = {
          meal_type: rawMeal.meal_type,
          name: rawMeal.name,
          description: rawMeal.description,
          prep_time_minutes: rawMeal.prep_time_minutes,
          cook_time_minutes: rawMeal.cook_time_minutes,
          servings: rawMeal.servings || 1,
          ingredients: rawMeal.ingredients?.map((i: any) => ({
            name: i.name,
            amount: i.amount,
            unit: i.unit,
          })) || [],
          instructions: rawMeal.instructions,
          nutrients: rawMeal.nutrients || { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 },
        };

        // Accumulate daily totals
        dailyTotals.calories += meal.nutrients.calories || 0;
        dailyTotals.protein_g += meal.nutrients.protein_g || 0;
        dailyTotals.carbs_g += meal.nutrients.carbs_g || 0;
        dailyTotals.fat_g += meal.nutrients.fat_g || 0;

        // Accumulate grocery list
        for (const ing of meal.ingredients) {
          const key = `${ing.name.toLowerCase()}_${ing.unit}`;
          const existing = groceryMap.get(key);
          if (existing) {
            existing.total_amount += ing.amount;
          } else {
            groceryMap.set(key, {
              name: ing.name,
              total_amount: ing.amount,
              unit: ing.unit,
            });
          }
        }

        dayMeals.push(meal);
      }

      days.push({
        day: rawDay.day,
        day_name: rawDay.day_name,
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

    // Enrich grocery list with store mappings if budget specified
    const groceryList = Array.from(groceryMap.values());
    if (budget?.preferred_stores?.length) {
      await this.enrichGroceryListWithPrices(groceryList, budget.preferred_stores);
    }

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
      ai_notes: rawPlan.ai_notes,
    };
  }

  private async enrichGroceryListWithPrices(
    groceryList: GroceryListItem[],
    stores: string[]
  ): Promise<void> {
    for (const item of groceryList) {
      // Try to find in our nutrition database with store mapping
      const searchResult = await this.nutritionDB.searchFoods({
        query: item.name,
        has_store_mapping: true,
        store: stores[0],
      }, 1, 1);

      if (searchResult.foods.length > 0) {
        const food = searchResult.foods[0];
        item.food_id = food.id;

        const storeMapping = food.store_mappings?.find(m => stores.includes(m.store));
        if (storeMapping) {
          item.price_cents = storeMapping.price_cents;
          item.store = storeMapping.store;
          item.instacart_product_id = storeMapping.product_id;
        }
      }
    }
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

const MEAL_PLAN_SYSTEM_PROMPT = `You are an expert nutritionist and meal planner for the Heirclark fitness platform.

Your role is to create personalized, practical meal plans that:
1. Meet exact macro and calorie targets (within 5% tolerance)
2. Use whole, nutritious foods with high protein sources
3. Balance variety and practicality (some meal prep, some quick meals)
4. Consider budget constraints when specified
5. Accommodate dietary restrictions and allergies strictly

Guidelines:
- Prioritize lean proteins: chicken breast, turkey, fish, Greek yogurt, eggs, tofu
- Include fiber-rich vegetables at every meal
- Use complex carbs: oats, brown rice, quinoa, sweet potato
- Include healthy fats: avocado, olive oil, nuts in moderation
- Keep sodium reasonable (<2500mg/day)
- Make weekday breakfasts quick (<15 min prep)
- Allow more elaborate cooking on weekends

Always return valid JSON matching the requested structure.`;

export default MealPlanAIService;
