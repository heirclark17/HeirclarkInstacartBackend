// src/routes/coach.ts - ProgressCoach Skill Routes
import { Router, Request, Response } from 'express';
import { Pool } from 'pg';
import { authMiddleware } from '../middleware/auth';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false },
});

export const coachRouter = Router();

// ✅ SECURITY FIX: Apply STRICT authentication (OWASP A01: IDOR Protection)
coachRouter.use(authMiddleware());

/**
 * GET /api/v1/coach/weekly-summary
 * Get weekly progress summary with insights
 */
coachRouter.get('/weekly-summary', async (req: Request, res: Response) => {
  try {
    const shopifyCustomerId = req.query.shopifyCustomerId as string || req.headers['x-shopify-customer-id'] as string;
    if (!shopifyCustomerId) {
      return res.status(400).json({ ok: false, error: 'Missing shopifyCustomerId' });
    }

    const weekOffset = parseInt(req.query.weekOffset as string || '0', 10);

    // Get weight data for the week
    const weightResult = await pool.query(
      `SELECT weight_lbs, recorded_at
       FROM hc_weight_logs
       WHERE shopify_customer_id = $1
       AND recorded_at >= CURRENT_DATE - INTERVAL '${7 + weekOffset * 7} days'
       AND recorded_at < CURRENT_DATE - INTERVAL '${weekOffset * 7} days'
       ORDER BY recorded_at`,
      [shopifyCustomerId]
    );

    // Get nutrition data for the week
    const nutritionResult = await pool.query(
      `SELECT DATE(datetime) as date,
              SUM(total_calories) as calories,
              SUM(total_protein) as protein
       FROM hc_meals
       WHERE shopify_customer_id = $1
       AND datetime >= CURRENT_DATE - INTERVAL '${7 + weekOffset * 7} days'
       AND datetime < CURRENT_DATE - INTERVAL '${weekOffset * 7} days'
       GROUP BY DATE(datetime)`,
      [shopifyCustomerId]
    );

    // Get user goals
    const goalsResult = await pool.query(
      `SELECT calories_target, protein_target FROM hc_user_preferences WHERE shopify_customer_id = $1`,
      [shopifyCustomerId]
    );

    const goals = goalsResult.rows[0] || { calories_target: 2000, protein_target: 150 };
    const daysLogged = nutritionResult.rows.length;
    const avgCalories = daysLogged > 0
      ? Math.round(nutritionResult.rows.reduce((sum: number, r: any) => sum + Number(r.calories), 0) / daysLogged)
      : 0;
    const avgProtein = daysLogged > 0
      ? Math.round(nutritionResult.rows.reduce((sum: number, r: any) => sum + Number(r.protein), 0) / daysLogged)
      : 0;

    // Calculate adherence score
    const loggingScore = (daysLogged / 7) * 30;
    const calorieAdherence = Math.max(0, 100 - Math.abs(avgCalories - goals.calories_target) / goals.calories_target * 100);
    const proteinAdherence = avgProtein >= goals.protein_target * 0.9 ? 100 : (avgProtein / goals.protein_target) * 100;
    const adherenceScore = Math.round(loggingScore + calorieAdherence * 0.4 + proteinAdherence * 0.3);

    // Generate insights
    const insights: any[] = [];

    if (daysLogged >= 5) {
      insights.push({
        type: 'positive',
        title: 'Great Consistency!',
        message: `You logged ${daysLogged} days this week - excellent habit building!`,
        priority: 1
      });
    } else if (daysLogged < 3) {
      insights.push({
        type: 'observation',
        title: 'Logging Opportunity',
        message: `Only ${daysLogged} days logged this week. Try setting a meal reminder.`,
        suggestion: 'Start with just logging one meal per day',
        priority: 2
      });
    }

    if (avgProtein < goals.protein_target * 0.8) {
      insights.push({
        type: 'observation',
        title: 'Protein Gap',
        message: `Averaging ${avgProtein}g protein vs ${goals.protein_target}g target`,
        suggestion: 'Add Greek yogurt or protein shake as a snack',
        priority: 1
      });
    }

    res.json({
      ok: true,
      period: {
        start: new Date(Date.now() - (7 + weekOffset * 7) * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        end: new Date(Date.now() - weekOffset * 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
      },
      nutrition: {
        avg_calories: avgCalories,
        calorie_target: goals.calories_target,
        avg_protein_g: avgProtein,
        protein_target_g: goals.protein_target,
        days_logged: daysLogged,
        total_days: 7
      },
      adherence_score: adherenceScore,
      insights,
      next_week_focus: {
        goal: avgProtein < goals.protein_target * 0.9 ? 'Hit protein target 5/7 days' : 'Maintain consistency',
        metric: 'protein',
        target_value: goals.protein_target
      }
    });

  } catch (err: any) {
    console.error('[coach] weekly-summary error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * GET /api/v1/coach/insights
 * Get personalized insights based on tracking patterns
 */
coachRouter.get('/insights', async (req: Request, res: Response) => {
  try {
    const shopifyCustomerId = req.query.shopifyCustomerId as string || req.headers['x-shopify-customer-id'] as string;
    if (!shopifyCustomerId) {
      return res.status(400).json({ ok: false, error: 'Missing shopifyCustomerId' });
    }

    const days = parseInt(req.query.days as string || '30', 10);

    // Analyze patterns over the period
    const mealsResult = await pool.query(
      `SELECT DATE(datetime) as date,
              EXTRACT(DOW FROM datetime) as day_of_week,
              SUM(total_calories) as calories,
              SUM(total_protein) as protein,
              COUNT(*) as meal_count
       FROM hc_meals
       WHERE shopify_customer_id = $1
       AND datetime >= CURRENT_DATE - INTERVAL '${days} days'
       GROUP BY DATE(datetime), EXTRACT(DOW FROM datetime)
       ORDER BY date`,
      [shopifyCustomerId]
    );

    // Calculate weekday vs weekend patterns
    const weekdayData = mealsResult.rows.filter((r: any) => r.day_of_week >= 1 && r.day_of_week <= 5);
    const weekendData = mealsResult.rows.filter((r: any) => r.day_of_week === 0 || r.day_of_week === 6);

    const weekdayAvg = weekdayData.length > 0
      ? Math.round(weekdayData.reduce((sum: number, r: any) => sum + Number(r.calories), 0) / weekdayData.length)
      : 0;
    const weekendAvg = weekendData.length > 0
      ? Math.round(weekendData.reduce((sum: number, r: any) => sum + Number(r.calories), 0) / weekendData.length)
      : 0;

    const patterns: any[] = [];

    if (weekendAvg > weekdayAvg * 1.2) {
      patterns.push({
        type: 'opportunity',
        category: 'time',
        insight: `Weekend calories average ${weekendAvg - weekdayAvg} higher than weekdays`,
        data_points: `Weekday: ${weekdayAvg} cal, Weekend: ${weekendAvg} cal`,
        suggested_action: {
          type: 'pre_log',
          description: 'Pre-log weekend meals Saturday morning',
          implementation: 'Set a Saturday 9am reminder to plan the day'
        }
      });
    }

    const daysLogged = mealsResult.rows.length;
    const consistencyPct = Math.round((daysLogged / days) * 100);

    if (consistencyPct >= 80) {
      patterns.push({
        type: 'positive',
        category: 'behavior',
        insight: `Outstanding ${consistencyPct}% logging consistency over ${days} days!`,
        data_points: `${daysLogged} of ${days} days logged`
      });
    }

    res.json({
      ok: true,
      period_analyzed_days: days,
      patterns,
      strongest_habits: consistencyPct >= 70 ? ['Daily logging'] : [],
      habits_needing_attention: consistencyPct < 70 ? ['Daily logging'] : []
    });

  } catch (err: any) {
    console.error('[coach] insights error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * GET /api/v1/coach/milestones
 * Get achieved and upcoming milestones
 */
coachRouter.get('/milestones', async (req: Request, res: Response) => {
  try {
    const shopifyCustomerId = req.query.shopifyCustomerId as string || req.headers['x-shopify-customer-id'] as string;
    if (!shopifyCustomerId) {
      return res.status(400).json({ ok: false, error: 'Missing shopifyCustomerId' });
    }

    // Calculate logging streak
    const streakResult = await pool.query(
      `WITH daily_logs AS (
         SELECT DISTINCT DATE(datetime) as log_date
         FROM hc_meals
         WHERE shopify_customer_id = $1
         ORDER BY log_date DESC
       )
       SELECT COUNT(*) as streak
       FROM (
         SELECT log_date,
                log_date - (ROW_NUMBER() OVER (ORDER BY log_date DESC))::int as grp
         FROM daily_logs
         WHERE log_date >= CURRENT_DATE - INTERVAL '90 days'
       ) t
       WHERE grp = (SELECT log_date - 1 FROM daily_logs WHERE log_date = CURRENT_DATE LIMIT 1)
          OR log_date = CURRENT_DATE`,
      [shopifyCustomerId]
    );

    const currentStreak = parseInt(streakResult.rows[0]?.streak || '0', 10);

    const achieved: any[] = [];
    const upcoming: any[] = [];

    // Check streak milestones
    const streakMilestones = [7, 14, 21, 30, 60, 90];
    for (const milestone of streakMilestones) {
      if (currentStreak >= milestone) {
        achieved.push({
          id: `streak_${milestone}`,
          name: `${milestone}-Day Streak`,
          description: `Logged meals for ${milestone} consecutive days`,
          celebration_message: `Amazing dedication! ${milestone} days of consistency!`
        });
      } else if (currentStreak >= milestone - 3) {
        upcoming.push({
          id: `streak_${milestone}`,
          name: `${milestone}-Day Streak`,
          description: `Log ${milestone - currentStreak} more days`,
          progress_pct: Math.round((currentStreak / milestone) * 100)
        });
        break;
      }
    }

    res.json({
      ok: true,
      current_streak: currentStreak,
      achieved: achieved.slice(-5),
      upcoming: upcoming.slice(0, 3)
    });

  } catch (err: any) {
    console.error('[coach] milestones error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * POST /api/v1/coach/mealplan
 * Get personalized coaching for meal plan
 */
coachRouter.post('/mealplan', async (req: Request, res: Response) => {
  try {
    const { plan, targets, userInputs } = req.body;

    if (!plan || !targets) {
      return res.status(400).json({ ok: false, error: 'Missing plan or targets' });
    }

    // Get user's name for personalization
    const userName = userInputs?.name || 'friend';

    // Extract first day's meals for specific examples
    const day1 = plan.days?.[0];
    const breakfast = day1?.meals?.find((m: any) => m.mealType === 'Breakfast');
    const lunch = day1?.meals?.find((m: any) => m.mealType === 'Lunch');
    const dinner = day1?.meals?.find((m: any) => m.mealType === 'Dinner');
    const snacks = day1?.meals?.filter((m: any) => m.mealType === 'Snack') || [];

    // Check if Sunday (day 7) has cheat day meals
    const sunday = plan.days?.find((d: any) => d.day === 7);
    const hasSundayCheat = sunday?.meals?.some((m: any) =>
      m.calories > (targets.calories / 3) * 1.2
    );

    // Build personalized coaching script
    let script = `Hey ${userName}, your personalized 7-day meal plan looks fantastic! `;

    // Mention specific daily targets
    script += `I've designed this plan around your daily goals of ${targets.calories} calories, with ${targets.protein} grams of protein, ${targets.carbs} grams of carbs, and ${targets.fat} grams of fat. `;

    // Mention specific meals from day 1
    if (breakfast && lunch && dinner) {
      script += `Let me walk you through day one. You'll start with ${breakfast.dishName}, which gives you ${breakfast.macros?.protein || 0} grams of protein right away. `;
      script += `For lunch, you've got ${lunch.dishName}, and dinner is ${dinner.dishName}. `;
    }

    // Mention snacks if present
    if (snacks.length > 0) {
      script += `I've also included ${snacks.length} snacks throughout the day, like ${snacks[0]?.dishName}${snacks.length > 1 ? ` and ${snacks[1]?.dishName}` : ''}. `;
    }

    // Mention meal diversity
    const totalMeals = plan.days?.reduce((sum: number, d: any) => sum + d.meals?.length || 0, 0) || 0;
    const uniqueDishes = new Set(plan.days?.flatMap((d: any) => d.meals?.map((m: any) => m.dishName) || [])).size;
    if (uniqueDishes === totalMeals / 7) {
      script += `I've kept the same meals every day for easy meal prep - you can cook once and eat all week! `;
    } else {
      script += `I've created diverse meals for every day, so you won't get bored! `;
    }

    // Mention cheat day if applicable
    if (hasSundayCheat) {
      script += `And I noticed you have a cheat day on Sunday, so I made those meals more indulgent while still keeping you on track. `;
    }

    // Closing encouragement
    script += `This plan is designed specifically for YOU, hitting your macros while keeping things delicious and sustainable. Tap the grocery button when you're ready to order these ingredients through Instacart. You've got this!`;

    res.json({
      ok: true,
      streamingAvailable: true,
      script,
      defaultAvatarId: process.env.HEYGEN_AVATAR_ID || 'default',
      defaultVoiceId: process.env.HEYGEN_VOICE_ID || 'default',
    });

  } catch (err: any) {
    console.error('[coach] mealplan error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default coachRouter;
