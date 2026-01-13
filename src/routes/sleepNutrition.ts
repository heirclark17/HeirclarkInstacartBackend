// src/routes/sleepNutrition.ts - SleepNutrition Skill Routes
import { Router, Request, Response } from 'express';
import { Pool } from 'pg';
import { authMiddleware } from '../middleware/auth';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false },
});

export const sleepNutritionRouter = Router();

// ✅ SECURITY FIX: Apply STRICT authentication (OWASP A01: IDOR Protection)
sleepNutritionRouter.use(authMiddleware());

/**
 * POST /api/v1/sleep-nutrition/log
 * Log sleep data and get nutrition recommendations
 */
sleepNutritionRouter.post('/log', async (req: Request, res: Response) => {
  try {
    const { shopifyCustomerId, sleep_hours, sleep_quality, bedtime, wake_time, notes } = req.body;

    if (!shopifyCustomerId) {
      return res.status(400).json({ ok: false, error: 'Missing shopifyCustomerId' });
    }
    if (!sleep_hours) {
      return res.status(400).json({ ok: false, error: 'Missing sleep_hours' });
    }

    // Ensure table exists
    await pool.query(`
      CREATE TABLE IF NOT EXISTS hc_sleep_logs (
        id SERIAL PRIMARY KEY,
        shopify_customer_id VARCHAR(255) NOT NULL,
        sleep_hours DECIMAL(3,1) NOT NULL,
        sleep_quality VARCHAR(20),
        bedtime TIME,
        wake_time TIME,
        notes TEXT,
        logged_at TIMESTAMP DEFAULT NOW(),
        log_date DATE DEFAULT CURRENT_DATE
      )
    `);

    // Log sleep
    await pool.query(
      `INSERT INTO hc_sleep_logs (shopify_customer_id, sleep_hours, sleep_quality, bedtime, wake_time, notes)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [shopifyCustomerId, sleep_hours, sleep_quality || 'moderate', bedtime, wake_time, notes]
    );

    // Calculate sleep score (0-100)
    let sleepScore = 0;
    if (sleep_hours >= 7 && sleep_hours <= 9) {
      sleepScore += 50;
    } else if (sleep_hours >= 6) {
      sleepScore += 30;
    } else {
      sleepScore += Math.max(0, sleep_hours * 5);
    }

    if (sleep_quality === 'excellent') sleepScore += 50;
    else if (sleep_quality === 'good') sleepScore += 40;
    else if (sleep_quality === 'moderate') sleepScore += 25;
    else sleepScore += 10;

    // Generate nutrition adjustments based on sleep
    const recommendations = generateSleepBasedRecommendations(sleep_hours, sleep_quality || 'moderate', sleepScore);

    res.json({
      ok: true,
      sleep: {
        hours: sleep_hours,
        quality: sleep_quality || 'moderate',
        score: sleepScore
      },
      nutrition_adjustments: recommendations.adjustments,
      meal_recommendations: recommendations.meals,
      tips: recommendations.tips
    });

  } catch (err: any) {
    console.error('[sleep-nutrition] log error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * GET /api/v1/sleep-nutrition/today
 * Get today's nutrition recommendations based on last night's sleep
 */
sleepNutritionRouter.get('/today', async (req: Request, res: Response) => {
  try {
    const shopifyCustomerId = req.query.shopifyCustomerId as string || req.headers['x-shopify-customer-id'] as string;

    if (!shopifyCustomerId) {
      return res.status(400).json({ ok: false, error: 'Missing shopifyCustomerId' });
    }

    // Get last night's sleep
    const sleepResult = await pool.query(
      `SELECT sleep_hours, sleep_quality
       FROM hc_sleep_logs
       WHERE shopify_customer_id = $1
       ORDER BY logged_at DESC LIMIT 1`,
      [shopifyCustomerId]
    ).catch(() => ({ rows: [] }));

    const lastSleep = sleepResult.rows[0];

    if (!lastSleep) {
      return res.json({
        ok: true,
        sleep_logged: false,
        message: 'No sleep data logged. Log your sleep to get personalized nutrition recommendations.',
        default_recommendations: {
          focus: 'balanced',
          tips: ['Aim for 7-9 hours of sleep tonight', 'Avoid caffeine after 2pm']
        }
      });
    }

    const sleepHours = Number(lastSleep.sleep_hours);
    const sleepQuality = lastSleep.sleep_quality;

    // Calculate sleep score
    let sleepScore = 0;
    if (sleepHours >= 7 && sleepHours <= 9) sleepScore += 50;
    else if (sleepHours >= 6) sleepScore += 30;
    else sleepScore += Math.max(0, sleepHours * 5);

    if (sleepQuality === 'excellent') sleepScore += 50;
    else if (sleepQuality === 'good') sleepScore += 40;
    else if (sleepQuality === 'moderate') sleepScore += 25;
    else sleepScore += 10;

    const recommendations = generateSleepBasedRecommendations(sleepHours, sleepQuality, sleepScore);

    res.json({
      ok: true,
      sleep_logged: true,
      last_night: {
        hours: sleepHours,
        quality: sleepQuality,
        score: sleepScore
      },
      today_focus: sleepScore >= 70 ? 'optimal_performance' : sleepScore >= 50 ? 'energy_support' : 'recovery_mode',
      nutrition_adjustments: recommendations.adjustments,
      meal_recommendations: recommendations.meals,
      tips: recommendations.tips,
      hunger_prediction: {
        likely_increased: sleepHours < 7,
        ghrelin_impact: sleepHours < 6 ? 'elevated' : 'normal',
        strategy: sleepHours < 7 ? 'Plan protein-rich snacks to manage hunger' : 'Normal eating pattern'
      }
    });

  } catch (err: any) {
    console.error('[sleep-nutrition] today error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * GET /api/v1/sleep-nutrition/trends
 * Get sleep and nutrition correlation trends
 */
sleepNutritionRouter.get('/trends', async (req: Request, res: Response) => {
  try {
    const shopifyCustomerId = req.query.shopifyCustomerId as string || req.headers['x-shopify-customer-id'] as string;
    const days = parseInt(req.query.days as string || '14', 10);

    if (!shopifyCustomerId) {
      return res.status(400).json({ ok: false, error: 'Missing shopifyCustomerId' });
    }

    // Get sleep data
    const sleepResult = await pool.query(
      `SELECT log_date, sleep_hours, sleep_quality
       FROM hc_sleep_logs
       WHERE shopify_customer_id = $1
       AND log_date >= CURRENT_DATE - INTERVAL '${days} days'
       ORDER BY log_date`,
      [shopifyCustomerId]
    ).catch(() => ({ rows: [] }));

    // Get nutrition data for same period
    const nutritionResult = await pool.query(
      `SELECT DATE(datetime) as log_date,
              SUM(total_calories) as calories,
              SUM(total_protein) as protein
       FROM hc_meals
       WHERE shopify_customer_id = $1
       AND datetime >= CURRENT_DATE - INTERVAL '${days} days'
       GROUP BY DATE(datetime)
       ORDER BY log_date`,
      [shopifyCustomerId]
    ).catch(() => ({ rows: [] }));

    // Calculate averages
    const avgSleep = sleepResult.rows.length > 0
      ? sleepResult.rows.reduce((sum: number, r: any) => sum + Number(r.sleep_hours), 0) / sleepResult.rows.length
      : 0;

    const poorSleepDays = sleepResult.rows.filter((r: any) => Number(r.sleep_hours) < 6);
    const goodSleepDays = sleepResult.rows.filter((r: any) => Number(r.sleep_hours) >= 7);

    // Analyze correlations
    const insights: any[] = [];

    if (avgSleep < 7) {
      insights.push({
        type: 'warning',
        title: 'Sleep Deficit Detected',
        message: `Averaging ${avgSleep.toFixed(1)} hours - this may increase hunger hormones and cravings`,
        recommendation: 'Prioritize protein at breakfast to manage appetite'
      });
    }

    if (poorSleepDays.length > goodSleepDays.length) {
      insights.push({
        type: 'observation',
        title: 'Poor Sleep Pattern',
        message: 'More poor sleep nights than good ones in this period',
        recommendation: 'Consider magnesium-rich foods in the evening'
      });
    }

    res.json({
      ok: true,
      period_days: days,
      sleep_summary: {
        average_hours: Math.round(avgSleep * 10) / 10,
        nights_logged: sleepResult.rows.length,
        good_sleep_nights: goodSleepDays.length,
        poor_sleep_nights: poorSleepDays.length
      },
      daily_data: sleepResult.rows.map((s: any) => {
        const nutrition = nutritionResult.rows.find((n: any) => n.log_date === s.log_date);
        return {
          date: s.log_date,
          sleep_hours: Number(s.sleep_hours),
          sleep_quality: s.sleep_quality,
          calories: nutrition ? Number(nutrition.calories) : null,
          protein: nutrition ? Number(nutrition.protein) : null
        };
      }),
      insights,
      correlations: {
        sleep_calorie_correlation: 'insufficient_data',
        note: 'Need more data points to establish correlations'
      }
    });

  } catch (err: any) {
    console.error('[sleep-nutrition] trends error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * GET /api/v1/sleep-nutrition/evening-foods
 * Get sleep-promoting food recommendations for evening
 */
sleepNutritionRouter.get('/evening-foods', async (_req: Request, res: Response) => {
  res.json({
    ok: true,
    sleep_promoting_foods: [
      {
        name: 'Tart Cherry Juice',
        benefit: 'Natural melatonin source',
        serving: '8 oz, 1-2 hours before bed',
        nutrients: ['melatonin', 'antioxidants']
      },
      {
        name: 'Kiwi',
        benefit: 'Serotonin and antioxidants improve sleep onset',
        serving: '2 kiwis, 1 hour before bed',
        nutrients: ['serotonin', 'vitamin C', 'vitamin E']
      },
      {
        name: 'Almonds',
        benefit: 'Magnesium promotes muscle relaxation',
        serving: '1 oz (23 almonds)',
        nutrients: ['magnesium', 'melatonin', 'protein']
      },
      {
        name: 'Turkey',
        benefit: 'Tryptophan precursor to sleep hormones',
        serving: '3 oz',
        nutrients: ['tryptophan', 'protein']
      },
      {
        name: 'Chamomile Tea',
        benefit: 'Apigenin promotes relaxation',
        serving: '1 cup, 30 mins before bed',
        nutrients: ['apigenin', 'antioxidants']
      }
    ],
    foods_to_avoid: [
      { name: 'Caffeine', avoid_after: '2pm', reason: 'Half-life of 5-6 hours disrupts sleep' },
      { name: 'Alcohol', reason: 'Disrupts REM sleep despite initial sedation' },
      { name: 'Spicy foods', reason: 'Can cause acid reflux and discomfort' },
      { name: 'High-sugar foods', reason: 'Blood sugar spikes disrupt sleep cycles' },
      { name: 'Large meals', avoid_after: '2-3 hours before bed', reason: 'Digestion interferes with sleep' }
    ]
  });
});

function generateSleepBasedRecommendations(sleepHours: number, sleepQuality: string, sleepScore: number) {
  const adjustments: any = {};
  const meals: any[] = [];
  const tips: string[] = [];

  if (sleepHours < 6) {
    // Poor sleep - recovery mode
    adjustments.calorie_adjustment = '+100-200 to manage increased hunger';
    adjustments.protein_priority = 'high';
    adjustments.carb_timing = 'Front-load carbs earlier in day';
    adjustments.caffeine_limit = 'Max 2 cups, none after 12pm';

    meals.push({
      meal: 'breakfast',
      focus: 'High protein to stabilize hunger',
      suggestions: ['Eggs with avocado toast', 'Greek yogurt parfait with nuts', 'Protein smoothie with oats']
    });
    meals.push({
      meal: 'snacks',
      focus: 'Protein-rich to prevent crashes',
      suggestions: ['Hard boiled eggs', 'Cheese and crackers', 'Protein bar']
    });

    tips.push('Expect increased hunger today - ghrelin levels are elevated');
    tips.push('Avoid high-sugar snacks - energy crashes will be worse');
    tips.push('Consider a 20-min power nap if possible');
    tips.push('Extra protein at breakfast helps manage appetite');

  } else if (sleepHours < 7 || sleepQuality === 'poor') {
    // Suboptimal sleep - energy support
    adjustments.calorie_adjustment = 'Slight increase okay if hungry';
    adjustments.protein_priority = 'moderate-high';
    adjustments.caffeine_limit = 'Normal intake, none after 2pm';

    meals.push({
      meal: 'breakfast',
      focus: 'Balanced with protein emphasis',
      suggestions: ['Oatmeal with protein powder', 'Eggs and whole grain toast', 'Cottage cheese with fruit']
    });

    tips.push('Energy may dip mid-afternoon - have a protein snack ready');
    tips.push('Stay well hydrated - sleep deprivation increases dehydration');

  } else {
    // Good sleep - optimal performance
    adjustments.calorie_adjustment = 'Standard targets';
    adjustments.protein_priority = 'normal';
    adjustments.caffeine_limit = 'Normal intake';

    meals.push({
      meal: 'general',
      focus: 'Follow normal meal plan',
      suggestions: ['Stick to your regular healthy eating pattern']
    });

    tips.push('Great sleep! Your metabolism and hunger hormones are balanced');
    tips.push('Good day for intense workouts if planned');
  }

  return { adjustments, meals, tips };
}

export default sleepNutritionRouter;
