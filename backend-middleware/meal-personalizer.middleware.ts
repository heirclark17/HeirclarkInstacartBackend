import { Request, Response, NextFunction } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { Pool } from 'pg';

// Initialize clients
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

// Type definitions
interface UserGoal {
  user_id: string;
  goal_type: 'cut' | 'bulk' | 'maintain' | 'recomp';
  daily_calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  activity_level?: string;
}

interface NutritionPreference {
  diet_type: string;
  allergies: string[];
  dislikes: string[];
  favorites: string[];
  cooking_skill: string;
  max_prep_time_min: number;
  budget: string;
}

interface WorkoutDay {
  day: string;
  workout_type: string;
  duration_min: number;
  estimated_calories_burned: number;
}

interface MealPlanRequest {
  user_id: string;
  week_start_date?: string;
  include_instacart?: boolean;
  servings_per_meal?: number;
}

interface MealPlanResponse {
  user_id: string;
  week_start: string;
  goals_summary: UserGoal;
  workout_sync: {
    synced: boolean;
    workout_days: string[];
    rest_days: string[];
  };
  meal_plan: DayPlan[];
  grocery_list: {
    items: GroceryItem[];
    estimated_cost: number;
    instacart_link: string;
  };
  prep_tips: string[];
}

interface DayPlan {
  day: string;
  date: string;
  is_workout_day: boolean;
  adjusted_calories: number;
  meals: {
    breakfast: Meal;
    lunch: Meal;
    dinner: Meal;
    snacks: Meal[];
  };
  daily_totals: {
    calories: number;
    protein_g: number;
    carbs_g: number;
    fat_g: number;
  };
}

interface Meal {
  name: string;
  ingredients: Ingredient[];
  total_nutrition: {
    calories: number;
    protein_g: number;
    carbs_g: number;
    fat_g: number;
  };
  prep_time_min: number;
  cook_time_min: number;
  recipe_url?: string;
}

interface Ingredient {
  food_name: string;
  amount: number;
  unit: string;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  usda_validated: boolean;
}

interface GroceryItem {
  name: string;
  quantity: number;
  unit: string;
  category: string;
  estimated_price: number;
}

// Extend Express Request
declare global {
  namespace Express {
    interface Request {
      meal_plan?: MealPlanResponse;
    }
  }
}

/**
 * Fetch user goals from database
 */
async function getUserGoals(userId: string): Promise<UserGoal | null> {
  try {
    const result = await pool.query(
      'SELECT * FROM user_goals WHERE user_id = $1 AND active = true LIMIT 1',
      [userId]
    );
    return result.rows[0] || null;
  } catch (error) {
    console.error('Error fetching user goals:', error);
    return null;
  }
}

/**
 * Fetch user preferences from database
 */
async function getUserPreferences(userId: string): Promise<NutritionPreference | null> {
  try {
    const result = await pool.query(
      'SELECT * FROM user_preferences WHERE user_id = $1 LIMIT 1',
      [userId]
    );
    return result.rows[0] || null;
  } catch (error) {
    console.error('Error fetching user preferences:', error);
    return null;
  }
}

/**
 * Fetch workout schedule (would come from FitnessCoach MCP in production)
 */
async function getWorkoutSchedule(userId: string): Promise<WorkoutDay[]> {
  // Default workout schedule - in production, this would query FitnessCoach MCP
  return [
    { day: 'Monday', workout_type: 'strength_upper', duration_min: 60, estimated_calories_burned: 400 },
    { day: 'Tuesday', workout_type: 'cardio_moderate', duration_min: 45, estimated_calories_burned: 350 },
    { day: 'Wednesday', workout_type: 'rest', duration_min: 0, estimated_calories_burned: 0 },
    { day: 'Thursday', workout_type: 'strength_lower', duration_min: 60, estimated_calories_burned: 450 },
    { day: 'Friday', workout_type: 'hiit', duration_min: 30, estimated_calories_burned: 400 },
    { day: 'Saturday', workout_type: 'cardio_light', duration_min: 30, estimated_calories_burned: 200 },
    { day: 'Sunday', workout_type: 'rest', duration_min: 0, estimated_calories_burned: 0 },
  ];
}

/**
 * MealPersonalizer Middleware
 *
 * Generates personalized weekly meal plans using user goals, preferences, and workout schedule.
 * Integrates with OpenNutrition MCP for validation and Instacart for shopping lists.
 *
 * Usage:
 *   app.post('/api/meal-plan/generate', mealPersonalizer, handleMealPlan);
 */
export const mealPersonalizer = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { user_id, week_start_date, include_instacart = true, servings_per_meal = 1 }: MealPlanRequest = req.body;

    if (!user_id) {
      res.status(400).json({ error: 'user_id is required' });
      return;
    }

    // Fetch user data from database
    const [userGoals, userPreferences, workoutSchedule] = await Promise.all([
      getUserGoals(user_id),
      getUserPreferences(user_id),
      getWorkoutSchedule(user_id),
    ]);

    if (!userGoals) {
      res.status(400).json({
        error: 'User goals not found',
        message: 'Please complete onboarding to set your nutrition goals',
      });
      return;
    }

    // Calculate week start date
    const weekStart = week_start_date
      ? new Date(week_start_date)
      : getNextMonday();

    // Build context for Claude
    const context = {
      user_goals: userGoals,
      preferences: userPreferences || getDefaultPreferences(),
      workout_schedule: workoutSchedule,
      week_start: weekStart.toISOString().split('T')[0],
      servings: servings_per_meal,
      include_instacart,
    };

    // Call Claude with MealPersonalizer skill
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 8192,
      system: `You are a meal planning assistant for the Heirclark Nutrition App. Generate personalized weekly meal plans based on user goals and preferences.

Use the OpenNutrition MCP to validate all nutrition data against USDA database.

Instructions:
1. Create a 7-day meal plan (breakfast, lunch, dinner, snacks)
2. Adjust calories on workout days (+200-400 cal)
3. Ensure macro targets are met within 5%
4. Respect dietary restrictions and preferences
5. Generate grocery list with Instacart integration
6. Validate all nutrition data against USDA

Output as valid JSON matching the MealPlanResponse schema.`,
      messages: [
        {
          role: 'user',
          content: `Generate a weekly meal plan with these parameters:

User Goals:
- Daily calories: ${context.user_goals.daily_calories}
- Protein: ${context.user_goals.protein_g}g
- Carbs: ${context.user_goals.carbs_g}g
- Fat: ${context.user_goals.fat_g}g
- Goal type: ${context.user_goals.goal_type}

Preferences:
- Diet type: ${context.preferences.diet_type || 'standard'}
- Allergies: ${context.preferences.allergies?.join(', ') || 'none'}
- Cooking skill: ${context.preferences.cooking_skill || 'intermediate'}
- Max prep time: ${context.preferences.max_prep_time_min || 30} min
- Budget: ${context.preferences.budget || 'moderate'}

Workout Schedule:
${context.workout_schedule.map(w => `- ${w.day}: ${w.workout_type} (${w.duration_min} min, ${w.estimated_calories_burned} cal)`).join('\n')}

Week starting: ${context.week_start}
Servings per meal: ${context.servings}
Include Instacart list: ${context.include_instacart}

Generate complete meal plan as JSON.`,
        },
      ],
    });

    // Extract text content
    const textContent = message.content.find(block => block.type === 'text');
    if (!textContent || textContent.type !== 'text') {
      throw new Error('No text response from Claude');
    }

    // Parse meal plan
    const jsonMatch = textContent.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in response');
    }

    const mealPlan: MealPlanResponse = JSON.parse(jsonMatch[0]);

    // Attach to request
    req.meal_plan = mealPlan;

    next();
  } catch (error) {
    console.error('MealPersonalizer error:', error);
    res.status(500).json({
      error: 'Failed to generate meal plan',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

/**
 * Get next Monday's date
 */
function getNextMonday(): Date {
  const today = new Date();
  const dayOfWeek = today.getDay();
  const daysUntilMonday = dayOfWeek === 0 ? 1 : 8 - dayOfWeek;
  const nextMonday = new Date(today);
  nextMonday.setDate(today.getDate() + daysUntilMonday);
  return nextMonday;
}

/**
 * Default preferences for users without saved preferences
 */
function getDefaultPreferences(): NutritionPreference {
  return {
    diet_type: 'standard',
    allergies: [],
    dislikes: [],
    favorites: [],
    cooking_skill: 'intermediate',
    max_prep_time_min: 30,
    budget: 'moderate',
  };
}

/**
 * Standalone meal plan generation function
 */
export const generateMealPlan = async (
  userId: string,
  options?: Partial<MealPlanRequest>
): Promise<MealPlanResponse> => {
  const mockReq = {
    body: { user_id: userId, ...options },
  } as Request;
  const mockRes = {
    status: () => ({ json: () => {} }),
  } as unknown as Response;

  return new Promise((resolve, reject) => {
    mealPersonalizer(mockReq, mockRes, (err) => {
      if (err) reject(err);
      else if (mockReq.meal_plan) resolve(mockReq.meal_plan);
      else reject(new Error('No meal plan generated'));
    });
  });
};

export default mealPersonalizer;
