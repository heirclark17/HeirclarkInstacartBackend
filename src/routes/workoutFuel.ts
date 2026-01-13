// src/routes/workoutFuel.ts - WorkoutFuel Skill Routes
import { Router, Request, Response } from 'express';
import { Pool } from 'pg';
import { authMiddleware } from '../middleware/auth';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false },
});

export const workoutFuelRouter = Router();

// ✅ SECURITY FIX: Apply STRICT authentication (OWASP A01: IDOR Protection)
workoutFuelRouter.use(authMiddleware());

// MET values for different workout types
const MET_VALUES: Record<string, number> = {
  strength: 5.0,
  hiit: 8.0,
  cardio_light: 4.0,
  cardio_moderate: 6.0,
  cardio_intense: 9.0,
  yoga: 2.5,
  walking: 3.5,
  running: 9.5,
  cycling: 7.0,
  swimming: 7.0,
  sports: 6.5,
  rest: 1.0
};

/**
 * POST /api/v1/workout-fuel/log
 * Log a workout and get nutrition adjustments
 */
workoutFuelRouter.post('/log', async (req: Request, res: Response) => {
  try {
    const { shopifyCustomerId, workoutType, duration_mins, intensity, time_of_day, weight_lbs } = req.body;

    if (!shopifyCustomerId) {
      return res.status(400).json({ ok: false, error: 'Missing shopifyCustomerId' });
    }
    if (!workoutType || !duration_mins) {
      return res.status(400).json({ ok: false, error: 'Missing workoutType or duration_mins' });
    }

    // Ensure table exists
    await pool.query(`
      CREATE TABLE IF NOT EXISTS hc_workout_logs (
        id SERIAL PRIMARY KEY,
        shopify_customer_id VARCHAR(255) NOT NULL,
        workout_type VARCHAR(100) NOT NULL,
        duration_mins INT NOT NULL,
        intensity VARCHAR(20) DEFAULT 'moderate',
        time_of_day VARCHAR(20),
        calories_burned INT,
        logged_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Calculate calories burned using MET formula
    const met = MET_VALUES[workoutType] || 5.0;
    const intensityMultiplier = intensity === 'high' ? 1.2 : intensity === 'low' ? 0.8 : 1.0;
    const weightKg = (weight_lbs || 160) / 2.205;
    const caloriesBurned = Math.round(met * intensityMultiplier * weightKg * (duration_mins / 60));

    // Log the workout
    await pool.query(
      `INSERT INTO hc_workout_logs (shopify_customer_id, workout_type, duration_mins, intensity, time_of_day, calories_burned)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [shopifyCustomerId, workoutType, duration_mins, intensity || 'moderate', time_of_day, caloriesBurned]
    );

    // Calculate nutrition adjustments
    const extraCalories = Math.round(caloriesBurned * 0.5); // Eat back 50% of burned calories
    const extraProtein = workoutType === 'strength' ? 20 : 10;
    const extraCarbs = ['hiit', 'cardio_intense', 'running'].includes(workoutType) ? 30 : 15;

    res.json({
      ok: true,
      workout: {
        type: workoutType,
        duration_mins,
        intensity: intensity || 'moderate',
        calories_burned: caloriesBurned
      },
      nutrition_adjustments: {
        extra_calories: extraCalories,
        extra_protein_g: extraProtein,
        extra_carbs_g: extraCarbs,
        reason: `Based on ${duration_mins} min ${workoutType} burning ~${caloriesBurned} calories`
      },
      fueling_tips: getFuelingTips(workoutType, time_of_day)
    });

  } catch (err: any) {
    console.error('[workout-fuel] log error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * GET /api/v1/workout-fuel/today
 * Get today's workout-adjusted nutrition targets
 */
workoutFuelRouter.get('/today', async (req: Request, res: Response) => {
  try {
    const shopifyCustomerId = req.query.shopifyCustomerId as string || req.headers['x-shopify-customer-id'] as string;

    if (!shopifyCustomerId) {
      return res.status(400).json({ ok: false, error: 'Missing shopifyCustomerId' });
    }

    // Get base goals
    const goalsResult = await pool.query(
      `SELECT calories_target, protein_target, carbs_target, fat_target
       FROM hc_user_preferences WHERE shopify_customer_id = $1`,
      [shopifyCustomerId]
    );
    const baseGoals = goalsResult.rows[0] || { calories_target: 2000, protein_target: 150, carbs_target: 200, fat_target: 65 };

    // Get today's workouts
    const workoutResult = await pool.query(
      `SELECT workout_type, duration_mins, calories_burned, time_of_day
       FROM hc_workout_logs
       WHERE shopify_customer_id = $1 AND DATE(logged_at) = CURRENT_DATE`,
      [shopifyCustomerId]
    ).catch(() => ({ rows: [] }));

    const workouts = workoutResult.rows;
    const totalBurned = workouts.reduce((sum: number, w: any) => sum + Number(w.calories_burned || 0), 0);
    const hasStrength = workouts.some((w: any) => w.workout_type === 'strength');
    const hasCardio = workouts.some((w: any) => ['hiit', 'cardio_intense', 'running', 'cycling'].includes(w.workout_type));

    // Calculate adjustments
    const calorieAdjustment = Math.round(totalBurned * 0.5);
    const proteinAdjustment = hasStrength ? 25 : (hasCardio ? 10 : 0);
    const carbAdjustment = hasCardio ? 30 : (hasStrength ? 15 : 0);

    res.json({
      ok: true,
      date: new Date().toISOString().split('T')[0],
      base_targets: baseGoals,
      workouts_today: workouts.map((w: any) => ({
        type: w.workout_type,
        duration_mins: w.duration_mins,
        calories_burned: w.calories_burned
      })),
      total_calories_burned: totalBurned,
      adjusted_targets: {
        calories: baseGoals.calories_target + calorieAdjustment,
        protein_g: baseGoals.protein_target + proteinAdjustment,
        carbs_g: baseGoals.carbs_target + carbAdjustment,
        fat_g: baseGoals.fat_target
      },
      adjustments_applied: {
        extra_calories: calorieAdjustment,
        extra_protein_g: proteinAdjustment,
        extra_carbs_g: carbAdjustment,
        reason: workouts.length > 0 ? 'Adjusted for workout activity' : 'Rest day - base targets'
      }
    });

  } catch (err: any) {
    console.error('[workout-fuel] today error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * GET /api/v1/workout-fuel/pre-workout
 * Get pre-workout meal recommendations
 */
workoutFuelRouter.get('/pre-workout', async (req: Request, res: Response) => {
  try {
    const workoutType = req.query.workoutType as string || 'strength';
    const timeUntilWorkout = parseInt(req.query.timeUntilWorkout as string || '60', 10);

    const recommendations = getPreWorkoutRecommendations(workoutType, timeUntilWorkout);

    res.json({
      ok: true,
      workout_type: workoutType,
      time_until_workout_mins: timeUntilWorkout,
      recommendations
    });

  } catch (err: any) {
    console.error('[workout-fuel] pre-workout error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * GET /api/v1/workout-fuel/post-workout
 * Get post-workout meal recommendations
 */
workoutFuelRouter.get('/post-workout', async (req: Request, res: Response) => {
  try {
    const workoutType = req.query.workoutType as string || 'strength';
    const timeSinceWorkout = parseInt(req.query.timeSinceWorkout as string || '30', 10);

    const recommendations = getPostWorkoutRecommendations(workoutType, timeSinceWorkout);

    res.json({
      ok: true,
      workout_type: workoutType,
      time_since_workout_mins: timeSinceWorkout,
      recommendations
    });

  } catch (err: any) {
    console.error('[workout-fuel] post-workout error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

function getFuelingTips(workoutType: string, timeOfDay?: string): string[] {
  const tips: string[] = [];

  if (workoutType === 'strength') {
    tips.push('Have 20-40g protein within 2 hours post-workout');
    tips.push('Include fast-digesting carbs to replenish glycogen');
  } else if (['hiit', 'cardio_intense', 'running'].includes(workoutType)) {
    tips.push('Prioritize carb replenishment - aim for 0.5g/lb bodyweight');
    tips.push('Hydrate with electrolytes if workout exceeded 60 minutes');
  }

  if (timeOfDay === 'morning') {
    tips.push('Light pre-workout snack recommended - banana or toast');
  } else if (timeOfDay === 'evening') {
    tips.push('Include casein protein for overnight recovery');
  }

  return tips.length > 0 ? tips : ['Stay hydrated and eat a balanced post-workout meal'];
}

function getPreWorkoutRecommendations(workoutType: string, timeUntilWorkout: number) {
  if (timeUntilWorkout <= 30) {
    return {
      meal_type: 'quick_snack',
      suggestions: ['Banana', 'Rice cake with honey', 'Small handful of dried fruit'],
      macros: { carbs: 20, protein: 0, fat: 0 },
      note: 'Keep it simple and fast-digesting with limited time'
    };
  } else if (timeUntilWorkout <= 90) {
    return {
      meal_type: 'light_snack',
      suggestions: ['Greek yogurt with berries', 'Apple with almond butter', 'Protein shake with banana'],
      macros: { carbs: 30, protein: 15, fat: 5 },
      note: 'Balanced snack with moderate carbs and some protein'
    };
  } else {
    return {
      meal_type: 'small_meal',
      suggestions: ['Oatmeal with protein powder', 'Turkey sandwich on whole grain', 'Rice with chicken'],
      macros: { carbs: 50, protein: 25, fat: 10 },
      note: 'Full meal with complex carbs and lean protein'
    };
  }
}

function getPostWorkoutRecommendations(workoutType: string, timeSinceWorkout: number) {
  const isStrength = workoutType === 'strength';
  const isHighIntensity = ['hiit', 'cardio_intense', 'running'].includes(workoutType);

  if (timeSinceWorkout <= 30) {
    return {
      priority: 'high',
      window: 'anabolic_window',
      suggestions: isStrength
        ? ['Whey protein shake', 'Chocolate milk', 'Greek yogurt with honey']
        : ['Sports drink with protein', 'Banana with protein shake', 'Recovery smoothie'],
      macros: { carbs: isHighIntensity ? 40 : 25, protein: 30, fat: 5 },
      note: 'Optimal recovery window - prioritize fast-absorbing protein'
    };
  } else {
    return {
      priority: 'moderate',
      window: 'recovery_meal',
      suggestions: ['Grilled chicken with rice', 'Salmon with sweet potato', 'Lean beef stir-fry with vegetables'],
      macros: { carbs: 50, protein: 40, fat: 15 },
      note: 'Complete meal for sustained recovery'
    };
  }
}

export default workoutFuelRouter;
