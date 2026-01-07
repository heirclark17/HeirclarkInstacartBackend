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
interface NutritionGap {
  amount: number;
  percent: number;
  severity: 'critical' | 'moderate' | 'minor' | 'none';
}

interface GroceryRecommendation {
  food_name: string;
  reason: string;
  fills_gap: string[];
  nutrition_per_serving: {
    serving_size: string;
    calories: number;
    protein_g: number;
    carbs_g: number;
    fat_g: number;
  };
  suggested_quantity: string;
  estimated_price: number;
  usda_fdc_id: string;
  priority: 'high' | 'medium' | 'low';
}

interface GroceryAnalysisRequest {
  user_id: string;
  days_to_analyze?: number;
  budget_tier?: 'budget' | 'moderate' | 'premium';
  store_preference?: string;
}

interface GroceryAnalysisResponse {
  user_id: string;
  analysis_period: {
    start_date: string;
    end_date: string;
    days_logged: number;
  };
  nutrition_summary: {
    avg_daily: {
      calories: number;
      protein_g: number;
      carbs_g: number;
      fat_g: number;
      fiber_g: number;
    };
    goals: {
      calories: number;
      protein_g: number;
      carbs_g: number;
      fat_g: number;
      fiber_g: number;
    };
    gaps: {
      calories: NutritionGap;
      protein_g: NutritionGap;
      carbs_g: NutritionGap;
      fat_g: NutritionGap;
      fiber_g: NutritionGap;
    };
  };
  recommendations: GroceryRecommendation[];
  instacart_list: {
    store: string;
    items: Array<{
      name: string;
      quantity: number;
      unit: string;
      category: string;
      estimated_price: number;
      product_id: string | null;
    }>;
    subtotal: number;
    deep_link: string;
  };
  weekly_impact: {
    if_purchased: {
      projected_daily_calories: number;
      projected_daily_protein: number;
      projected_daily_carbs: number;
      projected_daily_fat: number;
      gaps_filled_percent: number;
    };
  };
  tips: string[];
}

// Extend Express Request
declare global {
  namespace Express {
    interface Request {
      grocery_analysis?: GroceryAnalysisResponse;
    }
  }
}

/**
 * Fetch user's meal history from database
 */
async function getUserMealHistory(userId: string, days: number): Promise<any[]> {
  try {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const result = await pool.query(
      `SELECT
        m.id, m.logged_at, m.meal_type,
        mi.food_name, mi.calories, mi.protein_g, mi.carbs_g, mi.fat_g, mi.fiber_g
       FROM meals m
       LEFT JOIN meal_ingredients mi ON m.id = mi.meal_id
       WHERE m.user_id = $1 AND m.logged_at >= $2
       ORDER BY m.logged_at DESC`,
      [userId, startDate.toISOString()]
    );
    return result.rows;
  } catch (error) {
    console.error('Error fetching meal history:', error);
    return [];
  }
}

/**
 * Calculate average daily nutrition from meal history
 */
function calculateAverages(meals: any[], days: number) {
  const totals = meals.reduce(
    (acc, meal) => ({
      calories: acc.calories + (meal.calories || 0),
      protein_g: acc.protein_g + (meal.protein_g || 0),
      carbs_g: acc.carbs_g + (meal.carbs_g || 0),
      fat_g: acc.fat_g + (meal.fat_g || 0),
      fiber_g: acc.fiber_g + (meal.fiber_g || 0),
    }),
    { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0 }
  );

  const daysWithData = Math.max(days, 1);
  return {
    calories: Math.round(totals.calories / daysWithData),
    protein_g: Math.round(totals.protein_g / daysWithData),
    carbs_g: Math.round(totals.carbs_g / daysWithData),
    fat_g: Math.round(totals.fat_g / daysWithData),
    fiber_g: Math.round(totals.fiber_g / daysWithData),
  };
}

/**
 * Calculate nutrition gaps
 */
function calculateGaps(
  averages: ReturnType<typeof calculateAverages>,
  goals: { calories: number; protein_g: number; carbs_g: number; fat_g: number; fiber_g: number }
): GroceryAnalysisResponse['nutrition_summary']['gaps'] {
  const calculateGap = (avg: number, goal: number): NutritionGap => {
    const amount = goal - avg;
    const percent = goal > 0 ? Math.round((amount / goal) * 100) : 0;
    let severity: NutritionGap['severity'] = 'none';

    if (percent >= 20) severity = 'critical';
    else if (percent >= 10) severity = 'moderate';
    else if (percent >= 5) severity = 'minor';

    return { amount, percent, severity };
  };

  return {
    calories: calculateGap(averages.calories, goals.calories),
    protein_g: calculateGap(averages.protein_g, goals.protein_g),
    carbs_g: calculateGap(averages.carbs_g, goals.carbs_g),
    fat_g: calculateGap(averages.fat_g, goals.fat_g),
    fiber_g: calculateGap(averages.fiber_g, goals.fiber_g),
  };
}

/**
 * Fetch user goals from database
 */
async function getUserGoals(userId: string) {
  try {
    const result = await pool.query(
      'SELECT daily_calories, protein_g, carbs_g, fat_g, fiber_g FROM user_goals WHERE user_id = $1 AND active = true LIMIT 1',
      [userId]
    );
    return result.rows[0] || {
      calories: 2000,
      protein_g: 150,
      carbs_g: 200,
      fat_g: 65,
      fiber_g: 30,
    };
  } catch (error) {
    console.error('Error fetching user goals:', error);
    return { calories: 2000, protein_g: 150, carbs_g: 200, fat_g: 65, fiber_g: 30 };
  }
}

/**
 * SmartGrocery Middleware
 *
 * Analyzes user's nutrition gaps and generates intelligent Instacart shopping suggestions.
 *
 * Usage:
 *   app.post('/api/grocery/analyze', smartGrocery, handleGroceryAnalysis);
 */
export const smartGrocery = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const {
      user_id,
      days_to_analyze = 7,
      budget_tier = 'moderate',
      store_preference = 'heb',
    }: GroceryAnalysisRequest = req.body;

    if (!user_id) {
      res.status(400).json({ error: 'user_id is required' });
      return;
    }

    // Fetch data
    const [mealHistory, userGoals] = await Promise.all([
      getUserMealHistory(user_id, days_to_analyze),
      getUserGoals(user_id),
    ]);

    // Calculate averages and gaps
    const averages = calculateAverages(mealHistory, days_to_analyze);
    const goals = {
      calories: userGoals.daily_calories || userGoals.calories,
      protein_g: userGoals.protein_g,
      carbs_g: userGoals.carbs_g,
      fat_g: userGoals.fat_g,
      fiber_g: userGoals.fiber_g || 30,
    };
    const gaps = calculateGaps(averages, goals);

    // Determine which gaps to focus on
    const criticalGaps = Object.entries(gaps)
      .filter(([_, gap]) => gap.severity === 'critical' || gap.severity === 'moderate')
      .map(([nutrient, gap]) => ({ nutrient, ...gap }));

    if (criticalGaps.length === 0) {
      // No significant gaps - return basic response
      req.grocery_analysis = {
        user_id,
        analysis_period: {
          start_date: new Date(Date.now() - days_to_analyze * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
          end_date: new Date().toISOString().split('T')[0],
          days_logged: mealHistory.length > 0 ? days_to_analyze : 0,
        },
        nutrition_summary: {
          avg_daily: averages,
          goals,
          gaps,
        },
        recommendations: [],
        instacart_list: {
          store: store_preference,
          items: [],
          subtotal: 0,
          deep_link: '',
        },
        weekly_impact: {
          if_purchased: {
            projected_daily_calories: averages.calories,
            projected_daily_protein: averages.protein_g,
            projected_daily_carbs: averages.carbs_g,
            projected_daily_fat: averages.fat_g,
            gaps_filled_percent: 100,
          },
        },
        tips: ['Great job! Your nutrition is well-balanced. Keep up the good work!'],
      };
      return next();
    }

    // Call Claude for intelligent recommendations
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: `You are a smart grocery assistant for the Heirclark Nutrition App. Analyze nutrition gaps and recommend foods to fill them.

Use the OpenNutrition MCP to find foods high in the needed nutrients.

Instructions:
1. Analyze the nutrition gaps provided
2. Search USDA database for foods that efficiently fill those gaps
3. Consider budget tier and store preference
4. Generate Instacart-compatible shopping list
5. Calculate projected improvement if items are purchased

Output as valid JSON.`,
      messages: [
        {
          role: 'user',
          content: `Analyze these nutrition gaps and suggest groceries:

User ID: ${user_id}
Analysis Period: ${days_to_analyze} days
Budget Tier: ${budget_tier}
Store: ${store_preference}

Current Daily Averages:
- Calories: ${averages.calories}
- Protein: ${averages.protein_g}g
- Carbs: ${averages.carbs_g}g
- Fat: ${averages.fat_g}g
- Fiber: ${averages.fiber_g}g

Goals:
- Calories: ${goals.calories}
- Protein: ${goals.protein_g}g
- Carbs: ${goals.carbs_g}g
- Fat: ${goals.fat_g}g
- Fiber: ${goals.fiber_g}g

Critical Gaps:
${criticalGaps.map(g => `- ${g.nutrient}: ${g.amount} (${g.percent}% below goal, ${g.severity})`).join('\n')}

Generate grocery recommendations as JSON with:
- recommendations: array of food suggestions with USDA validation
- instacart_list: formatted shopping list with estimated prices
- weekly_impact: projected nutrition if items purchased
- tips: 2-3 actionable tips`,
        },
      ],
    });

    // Extract text content
    const textContent = message.content.find(block => block.type === 'text');
    if (!textContent || textContent.type !== 'text') {
      throw new Error('No text response from Claude');
    }

    // Parse recommendations
    const jsonMatch = textContent.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in response');
    }

    const aiResponse = JSON.parse(jsonMatch[0]);

    // Build full response
    const analysisResponse: GroceryAnalysisResponse = {
      user_id,
      analysis_period: {
        start_date: new Date(Date.now() - days_to_analyze * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        end_date: new Date().toISOString().split('T')[0],
        days_logged: mealHistory.length > 0 ? days_to_analyze : 0,
      },
      nutrition_summary: {
        avg_daily: averages,
        goals,
        gaps,
      },
      recommendations: aiResponse.recommendations || [],
      instacart_list: aiResponse.instacart_list || {
        store: store_preference,
        items: [],
        subtotal: 0,
        deep_link: '',
      },
      weekly_impact: aiResponse.weekly_impact || {
        if_purchased: {
          projected_daily_calories: averages.calories,
          projected_daily_protein: averages.protein_g,
          projected_daily_carbs: averages.carbs_g,
          projected_daily_fat: averages.fat_g,
          gaps_filled_percent: 0,
        },
      },
      tips: aiResponse.tips || [],
    };

    // Attach to request
    req.grocery_analysis = analysisResponse;

    next();
  } catch (error) {
    console.error('SmartGrocery error:', error);
    res.status(500).json({
      error: 'Failed to analyze grocery needs',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

/**
 * Standalone grocery analysis function
 */
export const analyzeGroceryNeeds = async (
  userId: string,
  options?: Partial<GroceryAnalysisRequest>
): Promise<GroceryAnalysisResponse> => {
  const mockReq = {
    body: { user_id: userId, ...options },
  } as Request;
  const mockRes = {
    status: () => ({ json: () => {} }),
  } as unknown as Response;

  return new Promise((resolve, reject) => {
    smartGrocery(mockReq, mockRes, (err) => {
      if (err) reject(err);
      else if (mockReq.grocery_analysis) resolve(mockReq.grocery_analysis);
      else reject(new Error('No grocery analysis generated'));
    });
  });
};

export default smartGrocery;
