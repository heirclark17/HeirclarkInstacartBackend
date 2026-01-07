// src/routes/habits.ts - HabitBuilder Skill Routes
import { Router, Request, Response } from 'express';
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false },
});

export const habitsRouter = Router();

// XP rewards for actions
const XP_REWARDS = {
  meal_logged: 10,
  all_meals_logged: 50,
  calorie_target_hit: 25,
  protein_target_hit: 25,
  workout_logged: 30,
  streak_7_days: 100,
  streak_30_days: 500,
  challenge_completed: 100
};

// Level thresholds
const LEVELS = [
  { level: 1, name: 'Starter', xp: 0 },
  { level: 5, name: 'Consistent', xp: 1000 },
  { level: 10, name: 'Committed', xp: 5000 },
  { level: 15, name: 'Dedicated', xp: 15000 },
  { level: 20, name: 'Master', xp: 30000 },
  { level: 25, name: 'Legend', xp: 50000 }
];

// Daily challenges
const DAILY_CHALLENGES = [
  { id: 'protein_breakfast', title: 'Protein-Packed Morning', description: 'Include 25g+ protein in breakfast', xp: 50, difficulty: 'medium' },
  { id: 'water_first', title: 'Hydrate First', description: 'Log water before your first meal', xp: 25, difficulty: 'easy' },
  { id: 'veggie_lunch', title: 'Green Lunch', description: 'Include 2+ servings of vegetables at lunch', xp: 50, difficulty: 'medium' },
  { id: 'prelog', title: 'Plan Ahead', description: 'Pre-log a meal before eating', xp: 50, difficulty: 'medium' },
  { id: 'three_meals', title: 'Complete Day', description: 'Log breakfast, lunch, and dinner', xp: 75, difficulty: 'medium' }
];

/**
 * GET /api/v1/habits/status
 * Get daily habit status and streaks
 */
habitsRouter.get('/status', async (req: Request, res: Response) => {
  try {
    const shopifyCustomerId = req.query.shopifyCustomerId as string || req.headers['x-shopify-customer-id'] as string;

    if (!shopifyCustomerId) {
      return res.status(400).json({ ok: false, error: 'Missing shopifyCustomerId' });
    }

    // Check today's logged meals
    const todayMeals = await pool.query(
      `SELECT COUNT(*) as count FROM hc_meals
       WHERE shopify_customer_id = $1 AND DATE(datetime) = CURRENT_DATE`,
      [shopifyCustomerId]
    );

    // Calculate logging streak
    const streakResult = await pool.query(
      `WITH daily_logs AS (
         SELECT DISTINCT DATE(datetime) as log_date
         FROM hc_meals WHERE shopify_customer_id = $1
       ),
       streak_calc AS (
         SELECT log_date,
                log_date - (ROW_NUMBER() OVER (ORDER BY log_date DESC))::int as grp
         FROM daily_logs
         WHERE log_date <= CURRENT_DATE AND log_date >= CURRENT_DATE - INTERVAL '90 days'
       )
       SELECT COUNT(*) as streak
       FROM streak_calc
       WHERE grp = (SELECT MIN(grp) FROM streak_calc WHERE log_date = CURRENT_DATE OR log_date = CURRENT_DATE - 1)`,
      [shopifyCustomerId]
    );

    const currentStreak = parseInt(streakResult.rows[0]?.streak || '0', 10);
    const mealCount = parseInt(todayMeals.rows[0]?.count || '0', 10);

    // Build habit status
    const habits = [
      { habit: 'meal_logging', name: 'Log a meal', completed: mealCount > 0, xp_value: 10 },
      { habit: 'all_meals_logged', name: 'Log all 3 meals', completed: mealCount >= 3, xp_value: 50 }
    ];

    // Get random daily challenge
    const todayChallenge = DAILY_CHALLENGES[Math.floor(Date.now() / 86400000) % DAILY_CHALLENGES.length];

    // Calculate XP
    const xpResult = await pool.query(
      `SELECT COALESCE(SUM(xp_earned), 0) as total_xp FROM hc_user_xp WHERE shopify_customer_id = $1`,
      [shopifyCustomerId]
    ).catch(() => ({ rows: [{ total_xp: 0 }] }));

    const totalXp = parseInt(xpResult.rows[0]?.total_xp || '0', 10);
    const currentLevel = LEVELS.reduce((acc, l) => totalXp >= l.xp ? l : acc, LEVELS[0]);

    res.json({
      ok: true,
      date: new Date().toISOString().split('T')[0],
      habits,
      habits_completed: habits.filter(h => h.completed).length,
      habits_total: habits.length,
      xp_earned_today: habits.filter(h => h.completed).reduce((sum, h) => sum + h.xp_value, 0),
      streaks: [
        {
          habit: 'logging',
          current_days: currentStreak,
          status: currentStreak > 0 ? 'active' : 'broken',
          milestone_next: currentStreak < 7 ? 7 : currentStreak < 14 ? 14 : currentStreak < 30 ? 30 : 60
        }
      ],
      todays_challenge: todayChallenge,
      level: {
        current: currentLevel.level,
        name: currentLevel.name,
        total_xp: totalXp
      },
      motivation_message: currentStreak >= 7
        ? `Amazing ${currentStreak}-day streak! Keep it going!`
        : mealCount > 0
          ? 'Great start today! Keep logging!'
          : 'Start your day by logging breakfast!'
    });

  } catch (err: any) {
    console.error('[habits] status error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * GET /api/v1/habits/streaks
 * Get all streak data
 */
habitsRouter.get('/streaks', async (req: Request, res: Response) => {
  try {
    const shopifyCustomerId = req.query.shopifyCustomerId as string || req.headers['x-shopify-customer-id'] as string;

    if (!shopifyCustomerId) {
      return res.status(400).json({ ok: false, error: 'Missing shopifyCustomerId' });
    }

    // Calculate various streaks
    const loggingStreak = await pool.query(
      `WITH daily_logs AS (
         SELECT DISTINCT DATE(datetime) as log_date FROM hc_meals WHERE shopify_customer_id = $1
       )
       SELECT COUNT(*) as streak FROM daily_logs
       WHERE log_date >= CURRENT_DATE - (SELECT COUNT(*) FROM daily_logs WHERE log_date <= CURRENT_DATE)::int
       AND log_date <= CURRENT_DATE`,
      [shopifyCustomerId]
    );

    const streaks = [
      {
        habit: 'meal_logging',
        name: 'Logging Streak',
        current_days: parseInt(loggingStreak.rows[0]?.streak || '0', 10),
        longest_days: parseInt(loggingStreak.rows[0]?.streak || '0', 10), // Simplified
        status: 'active',
        grace_days_used: 0,
        grace_days_allowed: 1
      }
    ];

    res.json({ ok: true, streaks });

  } catch (err: any) {
    console.error('[habits] streaks error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * GET /api/v1/habits/challenges
 * Get available challenges
 */
habitsRouter.get('/challenges', async (req: Request, res: Response) => {
  const daily = DAILY_CHALLENGES.map(c => ({ ...c, type: 'daily', status: 'available' }));

  res.json({
    ok: true,
    daily_challenges: daily.slice(0, 3),
    weekly_challenges: [
      {
        id: 'five_day_logging',
        title: 'Consistent Logger',
        description: 'Log at least one meal for 5 days this week',
        xp: 200,
        type: 'weekly',
        status: 'available',
        progress: '0/5'
      }
    ]
  });
});

/**
 * POST /api/v1/habits/check-in
 * Mark a habit as complete
 */
habitsRouter.post('/check-in', async (req: Request, res: Response) => {
  try {
    const { shopifyCustomerId, habit, notes, mood } = req.body;

    if (!shopifyCustomerId) {
      return res.status(400).json({ ok: false, error: 'Missing shopifyCustomerId' });
    }

    // Ensure XP table exists
    await pool.query(`
      CREATE TABLE IF NOT EXISTS hc_user_xp (
        id SERIAL PRIMARY KEY,
        shopify_customer_id VARCHAR(255) NOT NULL,
        xp_earned INT NOT NULL,
        source VARCHAR(100),
        earned_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Award XP
    const xpAmount = XP_REWARDS[habit as keyof typeof XP_REWARDS] || 10;
    await pool.query(
      `INSERT INTO hc_user_xp (shopify_customer_id, xp_earned, source)
       VALUES ($1, $2, $3)`,
      [shopifyCustomerId, xpAmount, habit]
    );

    res.json({
      ok: true,
      habit,
      xp_earned: xpAmount,
      message: `+${xpAmount} XP earned!`
    });

  } catch (err: any) {
    console.error('[habits] check-in error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * GET /api/v1/habits/xp
 * Get XP and level info
 */
habitsRouter.get('/xp', async (req: Request, res: Response) => {
  try {
    const shopifyCustomerId = req.query.shopifyCustomerId as string || req.headers['x-shopify-customer-id'] as string;

    if (!shopifyCustomerId) {
      return res.status(400).json({ ok: false, error: 'Missing shopifyCustomerId' });
    }

    const result = await pool.query(
      `SELECT COALESCE(SUM(xp_earned), 0) as total_xp FROM hc_user_xp WHERE shopify_customer_id = $1`,
      [shopifyCustomerId]
    ).catch(() => ({ rows: [{ total_xp: 0 }] }));

    const totalXp = parseInt(result.rows[0]?.total_xp || '0', 10);

    // Find current and next level
    let currentLevel = LEVELS[0];
    let nextLevel = LEVELS[1];
    for (let i = 0; i < LEVELS.length; i++) {
      if (totalXp >= LEVELS[i].xp) {
        currentLevel = LEVELS[i];
        nextLevel = LEVELS[i + 1] || LEVELS[i];
      }
    }

    const xpInLevel = totalXp - currentLevel.xp;
    const xpForNextLevel = nextLevel.xp - currentLevel.xp;

    res.json({
      ok: true,
      total_xp: totalXp,
      level: currentLevel.level,
      level_name: currentLevel.name,
      xp_for_current_level: currentLevel.xp,
      xp_for_next_level: nextLevel.xp,
      xp_progress_in_level: xpInLevel,
      xp_to_next_level: nextLevel.xp - totalXp,
      progress_percentage: Math.round((xpInLevel / xpForNextLevel) * 100) || 0
    });

  } catch (err: any) {
    console.error('[habits] xp error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * GET /api/v1/habits/insights
 * Get behavior pattern insights
 */
habitsRouter.get('/insights', async (req: Request, res: Response) => {
  try {
    const shopifyCustomerId = req.query.shopifyCustomerId as string || req.headers['x-shopify-customer-id'] as string;

    if (!shopifyCustomerId) {
      return res.status(400).json({ ok: false, error: 'Missing shopifyCustomerId' });
    }

    // Analyze logging patterns
    const patternResult = await pool.query(
      `SELECT EXTRACT(DOW FROM datetime) as dow, COUNT(*) as count
       FROM hc_meals WHERE shopify_customer_id = $1
       AND datetime >= CURRENT_DATE - INTERVAL '30 days'
       GROUP BY EXTRACT(DOW FROM datetime)
       ORDER BY count DESC`,
      [shopifyCustomerId]
    );

    const patterns = [];
    if (patternResult.rows.length > 0) {
      const bestDay = patternResult.rows[0];
      const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      patterns.push({
        type: 'positive',
        category: 'time',
        insight: `Your best logging day is ${dayNames[bestDay.dow]} with ${bestDay.count} meals logged this month`
      });
    }

    res.json({
      ok: true,
      period_analyzed_days: 30,
      patterns,
      strongest_habits: ['Morning logging'],
      habits_needing_attention: []
    });

  } catch (err: any) {
    console.error('[habits] insights error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default habitsRouter;
