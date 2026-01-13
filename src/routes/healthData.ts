// src/routes/healthData.ts
// Endpoints for retrieving synced health data from wearables

import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool';
import { syncOrchestrator } from '../services/wearables/syncOrchestrator';
import type { SourceType } from '../services/wearables/types';
import { authMiddleware } from '../middleware/auth';

export const healthDataRouter = Router();

// ✅ SECURITY FIX: Apply STRICT authentication (OWASP A01: IDOR Protection)
healthDataRouter.use(authMiddleware());

// ============================================
// Validation Schemas
// ============================================

const dateRangeSchema = z.object({
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

// ============================================
// Daily Summary
// ============================================

/**
 * GET /api/v1/health-data/summary
 * Get aggregated daily summary (primary sources only, deduped)
 */
healthDataRouter.get('/summary', async (req, res, next) => {
  try {
    const customerId = req.headers['x-shopify-customer-id'] as string;
    if (!customerId) {
      return res.status(401).json({ error: 'Missing customer ID' });
    }

    const date = (req.query.date as string) || new Date().toISOString().split('T')[0];

    // Get primary activity data
    const activityResult = await pool.query(
      `SELECT * FROM hc_activity_data
       WHERE customer_id = $1 AND recorded_date = $2 AND is_primary = true
       LIMIT 1`,
      [customerId, date]
    );

    // Get primary sleep data (from previous night)
    const sleepResult = await pool.query(
      `SELECT * FROM hc_sleep_data
       WHERE customer_id = $1 AND sleep_date = $2 AND is_primary = true
       LIMIT 1`,
      [customerId, date]
    );

    // Get latest body measurement
    const bodyResult = await pool.query(
      `SELECT * FROM hc_body_data
       WHERE customer_id = $1 AND is_primary = true
       ORDER BY recorded_at DESC
       LIMIT 1`,
      [customerId]
    );

    // Get latest heart rate
    const heartResult = await pool.query(
      `SELECT * FROM hc_heart_data
       WHERE customer_id = $1 AND recorded_date = $2
       ORDER BY recorded_at DESC
       LIMIT 1`,
      [customerId, date]
    );

    // Get workouts for the day
    const workoutsResult = await pool.query(
      `SELECT * FROM hc_workout_data
       WHERE customer_id = $1
         AND DATE(start_time) = $2
         AND is_primary = true
       ORDER BY start_time`,
      [customerId, date]
    );

    const activity = activityResult.rows[0];
    const sleep = sleepResult.rows[0];
    const body = bodyResult.rows[0];
    const heart = heartResult.rows[0];
    const workouts = workoutsResult.rows;

    res.json({
      date,
      activity: activity ? {
        steps: activity.steps,
        activeCalories: parseFloat(activity.active_calories) || 0,
        restingCalories: parseFloat(activity.resting_calories) || 0,
        totalCalories: parseFloat(activity.total_calories) || 0,
        distanceMeters: parseFloat(activity.distance_meters) || 0,
        floorsClimbed: activity.floors_climbed,
        activeMinutes: activity.active_minutes,
        source: activity.source_type,
      } : null,
      sleep: sleep ? {
        totalMinutes: sleep.total_sleep_minutes,
        deepMinutes: sleep.deep_sleep_minutes,
        lightMinutes: sleep.light_sleep_minutes,
        remMinutes: sleep.rem_sleep_minutes,
        awakeMinutes: sleep.awake_minutes,
        sleepScore: sleep.sleep_score,
        bedTime: sleep.bed_time,
        wakeTime: sleep.wake_time,
        source: sleep.source_type,
      } : null,
      body: body ? {
        weightKg: parseFloat(body.weight_kg) || null,
        bodyFatPercent: parseFloat(body.body_fat_percent) || null,
        bmi: parseFloat(body.bmi) || null,
        recordedAt: body.recorded_at,
        source: body.source_type,
      } : null,
      heart: heart ? {
        restingHeartRate: heart.resting_heart_rate,
        hrvRmssd: parseFloat(heart.hrv_rmssd) || null,
        recoveryScore: heart.recovery_score,
        source: heart.source_type,
      } : null,
      workouts: workouts.map(w => ({
        id: w.id,
        type: w.workout_type,
        startTime: w.start_time,
        endTime: w.end_time,
        durationSeconds: w.duration_seconds,
        caloriesBurned: parseFloat(w.calories_burned) || null,
        distanceMeters: parseFloat(w.distance_meters) || null,
        avgHeartRate: w.avg_heart_rate,
        source: w.source_type,
      })),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/health-data/summary/range
 * Get daily summaries for a date range
 */
healthDataRouter.get('/summary/range', async (req, res, next) => {
  try {
    const customerId = req.headers['x-shopify-customer-id'] as string;
    if (!customerId) {
      return res.status(401).json({ error: 'Missing customer ID' });
    }

    const { start, end } = dateRangeSchema.parse({
      start: req.query.start,
      end: req.query.end,
    });

    // Get all primary activity data in range
    const activityResult = await pool.query(
      `SELECT recorded_date, steps, active_calories, resting_calories, total_calories,
              distance_meters, floors_climbed, active_minutes, source_type
       FROM hc_activity_data
       WHERE customer_id = $1
         AND recorded_date >= $2
         AND recorded_date <= $3
         AND is_primary = true
       ORDER BY recorded_date`,
      [customerId, start, end]
    );

    // Get all primary sleep data in range
    const sleepResult = await pool.query(
      `SELECT sleep_date, total_sleep_minutes, deep_sleep_minutes, light_sleep_minutes,
              rem_sleep_minutes, awake_minutes, sleep_score, source_type
       FROM hc_sleep_data
       WHERE customer_id = $1
         AND sleep_date >= $2
         AND sleep_date <= $3
         AND is_primary = true
       ORDER BY sleep_date`,
      [customerId, start, end]
    );

    // Build daily summaries map
    const summaries: Record<string, any> = {};

    for (const activity of activityResult.rows) {
      const date = activity.recorded_date.toISOString().split('T')[0];
      summaries[date] = {
        date,
        steps: activity.steps,
        activeCalories: parseFloat(activity.active_calories) || 0,
        totalCalories: parseFloat(activity.total_calories) || 0,
        distanceMeters: parseFloat(activity.distance_meters) || 0,
        activeMinutes: activity.active_minutes,
        activitySource: activity.source_type,
      };
    }

    for (const sleep of sleepResult.rows) {
      const date = sleep.sleep_date.toISOString().split('T')[0];
      if (!summaries[date]) {
        summaries[date] = { date };
      }
      summaries[date].sleepMinutes = sleep.total_sleep_minutes;
      summaries[date].sleepScore = sleep.sleep_score;
      summaries[date].sleepSource = sleep.source_type;
    }

    // Convert to sorted array
    const sortedSummaries = Object.values(summaries).sort(
      (a: any, b: any) => a.date.localeCompare(b.date)
    );

    res.json({ summaries: sortedSummaries });
  } catch (err) {
    next(err);
  }
});

// ============================================
// Activity Data
// ============================================

/**
 * GET /api/v1/health-data/activity
 * Get activity data for a date range
 */
healthDataRouter.get('/activity', async (req, res, next) => {
  try {
    const customerId = req.headers['x-shopify-customer-id'] as string;
    if (!customerId) {
      return res.status(401).json({ error: 'Missing customer ID' });
    }

    const start = (req.query.start as string) || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const end = (req.query.end as string) || new Date().toISOString().split('T')[0];
    const primaryOnly = req.query.primary !== 'false';

    let query = `
      SELECT * FROM hc_activity_data
      WHERE customer_id = $1
        AND recorded_date >= $2
        AND recorded_date <= $3
    `;

    if (primaryOnly) {
      query += ` AND is_primary = true`;
    }

    query += ` ORDER BY recorded_date DESC`;

    const result = await pool.query(query, [customerId, start, end]);

    res.json({
      activity: result.rows.map(row => ({
        id: row.id,
        date: row.recorded_date,
        steps: row.steps,
        activeCalories: parseFloat(row.active_calories) || 0,
        restingCalories: parseFloat(row.resting_calories) || 0,
        totalCalories: parseFloat(row.total_calories) || 0,
        distanceMeters: parseFloat(row.distance_meters) || 0,
        floorsClimbed: row.floors_climbed,
        activeMinutes: row.active_minutes,
        source: row.source_type,
        isPrimary: row.is_primary,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// ============================================
// Workout Data
// ============================================

/**
 * GET /api/v1/health-data/workouts
 * Get workouts for a date range
 */
healthDataRouter.get('/workouts', async (req, res, next) => {
  try {
    const customerId = req.headers['x-shopify-customer-id'] as string;
    if (!customerId) {
      return res.status(401).json({ error: 'Missing customer ID' });
    }

    const start = (req.query.start as string) || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const end = (req.query.end as string) || new Date().toISOString().split('T')[0];
    const primaryOnly = req.query.primary !== 'false';
    const workoutType = req.query.type as string;

    let query = `
      SELECT * FROM hc_workout_data
      WHERE customer_id = $1
        AND DATE(start_time) >= $2
        AND DATE(start_time) <= $3
    `;
    const params: any[] = [customerId, start, end];

    if (primaryOnly) {
      query += ` AND is_primary = true`;
    }

    if (workoutType) {
      query += ` AND workout_type = $${params.length + 1}`;
      params.push(workoutType);
    }

    query += ` ORDER BY start_time DESC LIMIT 100`;

    const result = await pool.query(query, params);

    res.json({
      workouts: result.rows.map(row => ({
        id: row.id,
        type: row.workout_type,
        startTime: row.start_time,
        endTime: row.end_time,
        durationSeconds: row.duration_seconds,
        caloriesBurned: parseFloat(row.calories_burned) || null,
        distanceMeters: parseFloat(row.distance_meters) || null,
        avgHeartRate: row.avg_heart_rate,
        maxHeartRate: row.max_heart_rate,
        hasGpsData: row.has_gps_data,
        source: row.source_type,
        isPrimary: row.is_primary,
      })),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/health-data/workouts/:id
 * Get a single workout with full details
 */
healthDataRouter.get('/workouts/:id', async (req, res, next) => {
  try {
    const customerId = req.headers['x-shopify-customer-id'] as string;
    if (!customerId) {
      return res.status(401).json({ error: 'Missing customer ID' });
    }

    const { id } = req.params;

    const result = await pool.query(
      `SELECT * FROM hc_workout_data WHERE id = $1 AND customer_id = $2`,
      [id, customerId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Workout not found' });
    }

    const row = result.rows[0];

    res.json({
      workout: {
        id: row.id,
        type: row.workout_type,
        startTime: row.start_time,
        endTime: row.end_time,
        durationSeconds: row.duration_seconds,
        caloriesBurned: parseFloat(row.calories_burned) || null,
        distanceMeters: parseFloat(row.distance_meters) || null,
        avgHeartRate: row.avg_heart_rate,
        maxHeartRate: row.max_heart_rate,
        hasGpsData: row.has_gps_data,
        gpsPolyline: row.gps_polyline,
        source: row.source_type,
        sourceMetadata: row.source_metadata,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ============================================
// Sleep Data
// ============================================

/**
 * GET /api/v1/health-data/sleep
 * Get sleep data for a date range
 */
healthDataRouter.get('/sleep', async (req, res, next) => {
  try {
    const customerId = req.headers['x-shopify-customer-id'] as string;
    if (!customerId) {
      return res.status(401).json({ error: 'Missing customer ID' });
    }

    const start = (req.query.start as string) || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const end = (req.query.end as string) || new Date().toISOString().split('T')[0];
    const primaryOnly = req.query.primary !== 'false';

    let query = `
      SELECT * FROM hc_sleep_data
      WHERE customer_id = $1
        AND sleep_date >= $2
        AND sleep_date <= $3
    `;

    if (primaryOnly) {
      query += ` AND is_primary = true`;
    }

    query += ` ORDER BY sleep_date DESC`;

    const result = await pool.query(query, [customerId, start, end]);

    res.json({
      sleep: result.rows.map(row => ({
        id: row.id,
        date: row.sleep_date,
        bedTime: row.bed_time,
        wakeTime: row.wake_time,
        totalMinutes: row.total_sleep_minutes,
        deepMinutes: row.deep_sleep_minutes,
        lightMinutes: row.light_sleep_minutes,
        remMinutes: row.rem_sleep_minutes,
        awakeMinutes: row.awake_minutes,
        sleepScore: row.sleep_score,
        source: row.source_type,
        isPrimary: row.is_primary,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// ============================================
// Body/Weight Data
// ============================================

/**
 * GET /api/v1/health-data/body
 * Get body measurement history
 */
healthDataRouter.get('/body', async (req, res, next) => {
  try {
    const customerId = req.headers['x-shopify-customer-id'] as string;
    if (!customerId) {
      return res.status(401).json({ error: 'Missing customer ID' });
    }

    const limit = Math.min(parseInt(req.query.limit as string) || 30, 100);
    const primaryOnly = req.query.primary !== 'false';

    let query = `
      SELECT * FROM hc_body_data
      WHERE customer_id = $1
    `;

    if (primaryOnly) {
      query += ` AND is_primary = true`;
    }

    query += ` ORDER BY recorded_at DESC LIMIT $2`;

    const result = await pool.query(query, [customerId, limit]);

    res.json({
      measurements: result.rows.map(row => ({
        id: row.id,
        recordedAt: row.recorded_at,
        weightKg: parseFloat(row.weight_kg) || null,
        bodyFatPercent: parseFloat(row.body_fat_percent) || null,
        muscleMassKg: parseFloat(row.muscle_mass_kg) || null,
        bmi: parseFloat(row.bmi) || null,
        source: row.source_type,
        isPrimary: row.is_primary,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// ============================================
// Heart Rate Data
// ============================================

/**
 * GET /api/v1/health-data/heart
 * Get heart rate data for a date range
 */
healthDataRouter.get('/heart', async (req, res, next) => {
  try {
    const customerId = req.headers['x-shopify-customer-id'] as string;
    if (!customerId) {
      return res.status(401).json({ error: 'Missing customer ID' });
    }

    const start = (req.query.start as string) || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const end = (req.query.end as string) || new Date().toISOString().split('T')[0];

    const result = await pool.query(
      `SELECT DISTINCT ON (recorded_date)
         recorded_date, resting_heart_rate, hrv_rmssd, recovery_score, strain_score, source_type
       FROM hc_heart_data
       WHERE customer_id = $1
         AND recorded_date >= $2
         AND recorded_date <= $3
       ORDER BY recorded_date DESC, recorded_at DESC`,
      [customerId, start, end]
    );

    res.json({
      heart: result.rows.map(row => ({
        date: row.recorded_date,
        restingHeartRate: row.resting_heart_rate,
        hrvRmssd: parseFloat(row.hrv_rmssd) || null,
        recoveryScore: row.recovery_score,
        strainScore: parseFloat(row.strain_score) || null,
        source: row.source_type,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// ============================================
// Sync Trigger
// ============================================

/**
 * POST /api/v1/health-data/sync
 * Trigger sync and return results (blocking)
 */
healthDataRouter.post('/sync', async (req, res, next) => {
  try {
    const customerId = req.headers['x-shopify-customer-id'] as string;
    if (!customerId) {
      return res.status(401).json({ error: 'Missing customer ID' });
    }

    const { sourceType, days } = req.body;
    const dateRange = days ? {
      start: new Date(Date.now() - days * 24 * 60 * 60 * 1000),
      end: new Date(),
    } : undefined;

    if (sourceType) {
      // Sync single source
      const result = await syncOrchestrator.syncSource(customerId, sourceType, { dateRange });
      res.json({ results: [result] });
    } else {
      // Sync all sources
      const results = await syncOrchestrator.syncAll(customerId, { dateRange });
      res.json({ results });
    }
  } catch (err) {
    next(err);
  }
});

// ============================================
// Webhooks
// ============================================

/**
 * POST /api/v1/health-data/webhook/:sourceType
 * Receive webhooks from providers
 */
healthDataRouter.post('/webhook/:sourceType', async (req, res, next) => {
  try {
    const sourceType = req.params.sourceType as SourceType;
    const signature = req.headers['x-fitbit-signature'] as string ||
                     req.headers['x-strava-signature'] as string;

    await syncOrchestrator.handleWebhook(sourceType, req.body, signature);

    res.status(200).json({ success: true });
  } catch (err: any) {
    console.error('Webhook error:', err.message);
    // Always return 200 to webhooks to prevent retries
    res.status(200).json({ error: err.message });
  }
});

/**
 * GET /api/v1/health-data/webhook/:sourceType
 * Webhook verification (Fitbit, Strava require this)
 */
healthDataRouter.get('/webhook/:sourceType', async (req, res) => {
  const sourceType = req.params.sourceType;

  // Fitbit verification
  if (sourceType === 'fitbit' && req.query.verify) {
    return res.send(req.query.verify);
  }

  // Strava verification
  if (sourceType === 'strava') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === process.env.STRAVA_WEBHOOK_VERIFY_TOKEN) {
      return res.json({ 'hub.challenge': challenge });
    }
  }

  res.status(400).json({ error: 'Invalid verification request' });
});
