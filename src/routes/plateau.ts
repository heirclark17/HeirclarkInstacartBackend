// src/routes/plateau.ts - PlateauBreaker Skill Routes
import { Router, Request, Response } from 'express';
import { Pool } from 'pg';
import { authMiddleware } from '../middleware/auth';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false },
});

export const plateauRouter = Router();

// ✅ SECURITY FIX: Apply STRICT authentication (OWASP A01: IDOR Protection)
plateauRouter.use(authMiddleware());

/**
 * GET /api/v1/plateau/detect
 * Analyze weight data to detect plateau
 */
plateauRouter.get('/detect', async (req: Request, res: Response) => {
  try {
    const shopifyCustomerId = req.query.shopifyCustomerId as string || req.headers['x-shopify-customer-id'] as string;

    if (!shopifyCustomerId) {
      return res.status(400).json({ ok: false, error: 'Missing shopifyCustomerId' });
    }

    // Get weight data for the last 4 weeks
    const weightResult = await pool.query(
      `SELECT weight_lbs, recorded_at
       FROM hc_weight_logs
       WHERE shopify_customer_id = $1
       AND recorded_at >= CURRENT_DATE - INTERVAL '28 days'
       ORDER BY recorded_at`,
      [shopifyCustomerId]
    ).catch(() => ({ rows: [] }));

    if (weightResult.rows.length < 3) {
      return res.json({
        ok: true,
        plateau_detected: false,
        message: 'Insufficient weight data. Log at least 3 weights over 2+ weeks for plateau detection.',
        data_points: weightResult.rows.length,
        minimum_required: 3
      });
    }

    const weights = weightResult.rows.map((r: any) => Number(r.weight_lbs));
    const firstWeight = weights[0];
    const lastWeight = weights[weights.length - 1];
    const avgWeight = weights.reduce((sum, w) => sum + w, 0) / weights.length;

    // Calculate variance
    const variance = weights.reduce((sum, w) => sum + Math.pow(w - avgWeight, 2), 0) / weights.length;
    const stdDev = Math.sqrt(variance);

    // Plateau criteria: less than 1lb change over 2+ weeks with low variance
    const totalChange = Math.abs(lastWeight - firstWeight);
    const isLowVariance = stdDev < 1.5;
    const isPlateaued = totalChange < 1.5 && isLowVariance && weightResult.rows.length >= 3;

    // Get user's goal
    const goalResult = await pool.query(
      `SELECT goal_type, weight_goal FROM hc_user_preferences WHERE shopify_customer_id = $1`,
      [shopifyCustomerId]
    );
    const goal = goalResult.rows[0] || { goal_type: 'weight_loss' };

    res.json({
      ok: true,
      plateau_detected: isPlateaued,
      analysis: {
        period_days: 28,
        data_points: weightResult.rows.length,
        starting_weight: firstWeight,
        current_weight: lastWeight,
        total_change_lbs: Math.round(totalChange * 10) / 10,
        variance: Math.round(stdDev * 100) / 100,
        trend: lastWeight < firstWeight ? 'decreasing' : lastWeight > firstWeight ? 'increasing' : 'stable'
      },
      plateau_severity: isPlateaued ? (weightResult.rows.length > 10 ? 'extended' : 'early') : null,
      potential_causes: isPlateaued ? getPotentialCauses(goal.goal_type) : [],
      message: isPlateaued
        ? 'Plateau detected. Your weight has been stable for 2+ weeks.'
        : 'No plateau detected. Weight is showing normal variation.'
    });

  } catch (err: any) {
    console.error('[plateau] detect error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * POST /api/v1/plateau/analyze
 * Deep analysis of plateau with recommendations
 */
plateauRouter.post('/analyze', async (req: Request, res: Response) => {
  try {
    const { shopifyCustomerId, currentCalories, currentProtein, activityLevel } = req.body;

    if (!shopifyCustomerId) {
      return res.status(400).json({ ok: false, error: 'Missing shopifyCustomerId' });
    }

    // Get user data
    const userResult = await pool.query(
      `SELECT calories_target, protein_target, weight_goal, goal_type
       FROM hc_user_preferences WHERE shopify_customer_id = $1`,
      [shopifyCustomerId]
    );
    const user = userResult.rows[0] || { calories_target: 2000, protein_target: 150 };

    // Get recent nutrition compliance
    const nutritionResult = await pool.query(
      `SELECT
         AVG(total_calories) as avg_calories,
         AVG(total_protein) as avg_protein,
         COUNT(DISTINCT DATE(datetime)) as days_logged
       FROM hc_meals
       WHERE shopify_customer_id = $1
       AND datetime >= CURRENT_DATE - INTERVAL '14 days'`,
      [shopifyCustomerId]
    ).catch(() => ({ rows: [{ avg_calories: 0, avg_protein: 0, days_logged: 0 }] }));

    const nutrition = nutritionResult.rows[0];
    const avgCalories = Number(nutrition.avg_calories) || currentCalories || user.calories_target;
    const avgProtein = Number(nutrition.avg_protein) || currentProtein || user.protein_target;
    const daysLogged = Number(nutrition.days_logged) || 0;

    // Analyze root causes
    const rootCauses: any[] = [];
    const recommendations: any[] = [];

    // Check logging consistency
    if (daysLogged < 10) {
      rootCauses.push({
        category: 'tracking',
        issue: 'Inconsistent logging',
        confidence: 'high',
        detail: `Only ${daysLogged}/14 days logged - hidden calories likely`
      });
      recommendations.push({
        type: 'behavior',
        title: 'Improve Tracking',
        description: 'Log every meal for 2 weeks to identify hidden calories',
        priority: 1
      });
    }

    // Check metabolic adaptation
    const weeksSinceStart = 8; // Would calculate from actual start date
    if (weeksSinceStart > 6) {
      rootCauses.push({
        category: 'metabolic',
        issue: 'Possible metabolic adaptation',
        confidence: 'medium',
        detail: 'Extended calorie deficit may have reduced metabolic rate'
      });
      recommendations.push({
        type: 'diet_break',
        title: 'Consider a Diet Break',
        description: '1-2 weeks at maintenance calories to reset metabolism',
        details: {
          maintenance_calories: Math.round(avgCalories * 1.15),
          duration_days: 10,
          expected_outcome: 'Temporary weight increase, then resumed loss'
        },
        priority: 2
      });
    }

    // Check protein intake
    if (avgProtein < user.protein_target * 0.8) {
      rootCauses.push({
        category: 'nutrition',
        issue: 'Low protein intake',
        confidence: 'high',
        detail: `${Math.round(avgProtein)}g vs ${user.protein_target}g target`
      });
      recommendations.push({
        type: 'nutrition',
        title: 'Increase Protein',
        description: 'Higher protein preserves muscle and increases satiety',
        target: user.protein_target,
        current: Math.round(avgProtein),
        priority: 1
      });
    }

    // Activity recommendation
    recommendations.push({
      type: 'activity',
      title: 'Add NEAT Activities',
      description: 'Non-exercise activity can burn 200-400 extra calories daily',
      suggestions: ['10,000 steps daily', 'Standing desk', 'Take stairs', 'Walk meetings'],
      priority: 3
    });

    // Refeed recommendation for extended plateaus
    if (weeksSinceStart > 8) {
      recommendations.push({
        type: 'refeed',
        title: 'Weekly Refeed Day',
        description: 'One day per week at higher carbs to boost leptin',
        details: {
          extra_carbs: 100,
          keep_protein_same: true,
          reduce_fat_slightly: true,
          best_day: 'Your most active training day'
        },
        priority: 2
      });
    }

    res.json({
      ok: true,
      plateau_analysis: {
        duration_estimate: `${weeksSinceStart}+ weeks`,
        severity: weeksSinceStart > 4 ? 'extended' : 'early',
        current_nutrition: {
          avg_calories: Math.round(avgCalories),
          avg_protein: Math.round(avgProtein),
          logging_consistency: `${daysLogged}/14 days`
        }
      },
      root_causes: rootCauses,
      recommendations: recommendations.sort((a, b) => a.priority - b.priority),
      intervention_plan: {
        week_1: 'Focus on consistent logging and hitting protein target',
        week_2: 'Add 2000 extra steps daily',
        week_3: 'Evaluate - if no change, implement diet break or refeed',
        week_4: 'Reassess and adjust calories if needed'
      }
    });

  } catch (err: any) {
    console.error('[plateau] analyze error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * GET /api/v1/plateau/strategies
 * Get all plateau-breaking strategies
 */
plateauRouter.get('/strategies', async (_req: Request, res: Response) => {
  res.json({
    ok: true,
    strategies: [
      {
        id: 'diet_break',
        name: 'Diet Break',
        description: '1-2 weeks eating at maintenance calories',
        when_to_use: 'After 8+ weeks of consistent deficit',
        expected_outcome: 'Metabolic rate restoration, reduced diet fatigue',
        implementation: {
          duration: '7-14 days',
          calories: 'Increase to maintenance (TDEE)',
          macros: 'Increase carbs primarily',
          activity: 'Maintain current level'
        }
      },
      {
        id: 'refeed',
        name: 'Refeed Days',
        description: '1-2 high-carb days per week',
        when_to_use: 'During extended fat loss phases',
        expected_outcome: 'Leptin boost, glycogen replenishment',
        implementation: {
          frequency: '1-2x per week',
          extra_carbs: '100-150g',
          timing: 'On training days',
          protein: 'Keep same',
          fat: 'Reduce slightly'
        }
      },
      {
        id: 'calorie_cycling',
        name: 'Calorie Cycling',
        description: 'Vary calories day-to-day around weekly average',
        when_to_use: 'To prevent metabolic adaptation',
        expected_outcome: 'Continued progress without deep adaptation',
        implementation: {
          high_days: 'Training days +200-300 cal',
          low_days: 'Rest days -200-300 cal',
          weekly_average: 'Stays at deficit target'
        }
      },
      {
        id: 'reverse_diet',
        name: 'Reverse Diet',
        description: 'Slowly increase calories over weeks',
        when_to_use: 'After extended plateau or before new fat loss phase',
        expected_outcome: 'Restored metabolism, higher maintenance point',
        implementation: {
          rate: '+50-100 calories per week',
          duration: '4-8 weeks',
          goal: 'Find new maintenance level'
        }
      },
      {
        id: 'neat_increase',
        name: 'NEAT Increase',
        description: 'Boost non-exercise activity',
        when_to_use: 'First intervention to try',
        expected_outcome: 'Extra 200-400 calories burned daily',
        implementation: {
          step_goal: '10,000-12,000 steps',
          suggestions: ['Walking meetings', 'Park farther', 'Stairs', 'Standing desk']
        }
      }
    ]
  });
});

/**
 * POST /api/v1/plateau/start-intervention
 * Start a plateau-breaking intervention
 */
plateauRouter.post('/start-intervention', async (req: Request, res: Response) => {
  try {
    const { shopifyCustomerId, strategyId, startDate } = req.body;

    if (!shopifyCustomerId || !strategyId) {
      return res.status(400).json({ ok: false, error: 'Missing shopifyCustomerId or strategyId' });
    }

    // Ensure table exists
    await pool.query(`
      CREATE TABLE IF NOT EXISTS hc_plateau_interventions (
        id SERIAL PRIMARY KEY,
        shopify_customer_id VARCHAR(255) NOT NULL,
        strategy_id VARCHAR(100) NOT NULL,
        start_date DATE DEFAULT CURRENT_DATE,
        end_date DATE,
        status VARCHAR(20) DEFAULT 'active',
        notes TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Create intervention record
    await pool.query(
      `INSERT INTO hc_plateau_interventions (shopify_customer_id, strategy_id, start_date)
       VALUES ($1, $2, $3)`,
      [shopifyCustomerId, strategyId, startDate || new Date().toISOString().split('T')[0]]
    );

    // Get strategy details
    const strategies: Record<string, any> = {
      'diet_break': { duration_days: 10, next_check: '5 days' },
      'refeed': { duration_days: 7, next_check: '3 days' },
      'calorie_cycling': { duration_days: 14, next_check: '7 days' },
      'reverse_diet': { duration_days: 28, next_check: '7 days' },
      'neat_increase': { duration_days: 14, next_check: '7 days' }
    };

    const strategy = strategies[strategyId] || { duration_days: 14, next_check: '7 days' };

    res.json({
      ok: true,
      intervention_started: true,
      strategy: strategyId,
      start_date: startDate || new Date().toISOString().split('T')[0],
      expected_duration_days: strategy.duration_days,
      next_check_in: strategy.next_check,
      message: `${strategyId.replace('_', ' ')} intervention started. Check in after ${strategy.next_check} to assess progress.`
    });

  } catch (err: any) {
    console.error('[plateau] start-intervention error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

function getPotentialCauses(goalType: string): string[] {
  const causes = [
    'Metabolic adaptation to calorie deficit',
    'Inaccurate calorie tracking',
    'Water retention masking fat loss',
    'Decreased NEAT (non-exercise activity)',
    'Muscle gain offsetting fat loss'
  ];

  if (goalType === 'muscle_gain') {
    causes.push('Insufficient calorie surplus');
    causes.push('Inadequate protein intake');
  }

  return causes;
}

export default plateauRouter;
