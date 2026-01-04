// src/services/wearables/syncOrchestrator.ts
// Orchestrates data sync across all wearable providers

import { pool } from '../../db/pool';
import { tokenManager } from './tokenManager';
import { dedupeService } from './dedupeService';
import { fitbitProvider } from './providers/fitbit';
import { stravaProvider } from './providers/strava';
import { ouraProvider } from './providers/oura';
import { withingsProvider } from './providers/withings';
import {
  BaseWearableProvider,
  IWearableProvider,
  normalizeActivity,
  normalizeWorkout,
  normalizeSleep,
  normalizeBody,
  normalizeHeart,
  RawActivity,
  RawWorkout,
  RawSleep,
  RawBody,
  RawHeart,
  AuthError,
} from './providers/baseProvider';
import type {
  SourceType,
  DataType,
  DateRange,
  SyncOptions,
  SyncResult,
  ConnectedSource,
  ActivityData,
  WorkoutData,
  SleepData,
  BodyData,
  HeartData,
} from './types';

/**
 * Provider registry
 */
const providers = new Map<SourceType, IWearableProvider>([
  ['fitbit', fitbitProvider as IWearableProvider],
  ['strava', stravaProvider as IWearableProvider],
  ['oura', ouraProvider as IWearableProvider],
  ['withings', withingsProvider as IWearableProvider],
]);

/**
 * Sync Orchestrator
 * Coordinates syncing data from all connected wearable sources
 */
export class SyncOrchestrator {
  /**
   * Sync data from a single source
   */
  async syncSource(
    customerId: string,
    sourceType: SourceType,
    options: SyncOptions = {}
  ): Promise<SyncResult> {
    const syncId = crypto.randomUUID();
    const startedAt = new Date();

    // Create sync log entry
    await this.createSyncLog(syncId, customerId, sourceType, options.dateRange ? 'incremental' : 'full');

    try {
      // Get provider
      const provider = providers.get(sourceType);
      if (!provider) {
        throw new Error(`Provider not available: ${sourceType}`);
      }

      // Get valid token
      const token = await tokenManager.getValidToken(customerId, sourceType);

      // Determine date range
      const dateRange = options.dateRange || await this.getDefaultDateRange(customerId, sourceType);

      // Track counts
      let recordsFetched = 0;
      let recordsInserted = 0;
      let recordsUpdated = 0;

      // Sync each data type
      const dataTypes = options.dataTypes || ['steps', 'calories', 'workout', 'sleep', 'weight', 'heart_rate'];

      // Activity data (steps, calories, distance)
      if (this.shouldSync(dataTypes, ['steps', 'calories', 'distance']) && provider.capabilities.activity) {
        const activities = await provider.fetchActivities(token, dateRange);
        recordsFetched += activities.length;
        const { inserted, updated } = await this.saveActivities(customerId, sourceType, activities);
        recordsInserted += inserted;
        recordsUpdated += updated;
      }

      // Workout data
      if (this.shouldSync(dataTypes, ['workout']) && provider.capabilities.workout) {
        const workouts = await provider.fetchWorkouts(token, dateRange);
        recordsFetched += workouts.length;
        const { inserted, updated } = await this.saveWorkouts(customerId, sourceType, workouts);
        recordsInserted += inserted;
        recordsUpdated += updated;
      }

      // Sleep data
      if (this.shouldSync(dataTypes, ['sleep']) && provider.capabilities.sleep) {
        const sleepData = await provider.fetchSleep(token, dateRange);
        recordsFetched += sleepData.length;
        const { inserted, updated } = await this.saveSleep(customerId, sourceType, sleepData);
        recordsInserted += inserted;
        recordsUpdated += updated;
      }

      // Body data (weight, body fat)
      if (this.shouldSync(dataTypes, ['weight']) && provider.capabilities.body) {
        const bodyData = await provider.fetchBody(token, dateRange);
        recordsFetched += bodyData.length;
        const { inserted, updated } = await this.saveBody(customerId, sourceType, bodyData);
        recordsInserted += inserted;
        recordsUpdated += updated;
      }

      // Heart rate data
      if (this.shouldSync(dataTypes, ['heart_rate', 'hrv']) && provider.capabilities.heart) {
        const heartData = await provider.fetchHeart(token, dateRange);
        recordsFetched += heartData.length;
        const { inserted, updated } = await this.saveHeart(customerId, sourceType, heartData);
        recordsInserted += inserted;
        recordsUpdated += updated;
      }

      // Run dedupe
      const recordsDeduped = await dedupeService.dedupeAll(customerId, dateRange);

      // Update sync status
      await tokenManager.updateSyncStatus(customerId, sourceType, 'success');

      // Complete sync log
      const result: SyncResult = {
        syncId,
        customerId,
        sourceType,
        status: 'success',
        recordsFetched,
        recordsInserted,
        recordsUpdated,
        recordsDeduped,
        startedAt,
        completedAt: new Date(),
      };

      await this.completeSyncLog(syncId, result);

      return result;
    } catch (error: any) {
      console.error(`Sync failed for ${customerId}/${sourceType}:`, error);

      // Handle auth errors
      if (error instanceof AuthError) {
        await tokenManager.updateSyncStatus(customerId, sourceType, 'failed', 'Authentication failed - please reconnect');
      } else {
        await tokenManager.updateSyncStatus(customerId, sourceType, 'failed', error.message);
      }

      const result: SyncResult = {
        syncId,
        customerId,
        sourceType,
        status: 'failed',
        recordsFetched: 0,
        recordsInserted: 0,
        recordsUpdated: 0,
        recordsDeduped: 0,
        startedAt,
        completedAt: new Date(),
        error: error.message,
      };

      await this.completeSyncLog(syncId, result);

      throw error;
    }
  }

  /**
   * Sync all connected sources for a customer
   */
  async syncAll(customerId: string, options: SyncOptions = {}): Promise<SyncResult[]> {
    const sources = await tokenManager.getAllSources(customerId);
    const results: SyncResult[] = [];

    for (const source of sources) {
      if (!source.syncEnabled) continue;

      // Skip native sources (handled by mobile app)
      if (['apple_health', 'health_connect'].includes(source.sourceType)) continue;

      try {
        const result = await this.syncSource(customerId, source.sourceType, options);
        results.push(result);
      } catch (error: any) {
        console.error(`Sync failed for ${source.sourceType}:`, error.message);
        // Continue with other sources
      }
    }

    return results;
  }

  /**
   * Handle incoming webhook data
   */
  async handleWebhook(
    sourceType: SourceType,
    payload: any,
    signature?: string
  ): Promise<void> {
    const provider = providers.get(sourceType);
    if (!provider) {
      throw new Error(`Provider not available: ${sourceType}`);
    }

    // Verify webhook signature if provider supports it
    if (signature && provider.verifyWebhook) {
      const isValid = provider.verifyWebhook(signature, JSON.stringify(payload));
      if (!isValid) {
        throw new Error('Invalid webhook signature');
      }
    }

    // Parse webhook payload
    if (!provider.parseWebhookPayload) {
      throw new Error(`Provider ${sourceType} does not support webhooks`);
    }

    const { userId, dataType } = provider.parseWebhookPayload(payload);

    // Find customer by source user ID
    const result = await pool.query(
      `SELECT customer_id FROM hc_connected_sources
       WHERE source_type = $1 AND source_user_id = $2 AND disconnected_at IS NULL`,
      [sourceType, userId]
    );

    if (result.rows.length === 0) {
      console.warn(`No customer found for ${sourceType} user ${userId}`);
      return;
    }

    const customerId = result.rows[0].customer_id;

    // Trigger incremental sync for the affected data type
    const dataTypes = this.webhookDataTypeToSyncTypes(dataType);
    const dateRange = {
      start: new Date(Date.now() - 24 * 60 * 60 * 1000), // Last 24 hours
      end: new Date(),
    };

    await this.syncSource(customerId, sourceType, { dataTypes, dateRange });
  }

  // =====================================
  // Data persistence
  // =====================================

  private async saveActivities(
    customerId: string,
    sourceType: SourceType,
    activities: RawActivity[]
  ): Promise<{ inserted: number; updated: number }> {
    let inserted = 0;
    let updated = 0;

    for (const raw of activities) {
      const activity = normalizeActivity(customerId, sourceType, raw);

      const result = await pool.query(
        `INSERT INTO hc_activity_data (
          customer_id, source_type, source_record_id, recorded_date,
          steps, active_calories, resting_calories, total_calories,
          distance_meters, floors_climbed, active_minutes
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        ON CONFLICT (customer_id, source_type, recorded_date, source_record_id)
        DO UPDATE SET
          steps = EXCLUDED.steps,
          active_calories = EXCLUDED.active_calories,
          resting_calories = EXCLUDED.resting_calories,
          total_calories = EXCLUDED.total_calories,
          distance_meters = EXCLUDED.distance_meters,
          floors_climbed = EXCLUDED.floors_climbed,
          active_minutes = EXCLUDED.active_minutes
        RETURNING (xmax = 0) AS is_insert`,
        [
          customerId, sourceType, activity.sourceRecordId, activity.recordedDate,
          activity.steps, activity.activeCalories, activity.restingCalories, activity.totalCalories,
          activity.distanceMeters, activity.floorsClimbed, activity.activeMinutes,
        ]
      );

      if (result.rows[0]?.is_insert) {
        inserted++;
      } else {
        updated++;
      }
    }

    return { inserted, updated };
  }

  private async saveWorkouts(
    customerId: string,
    sourceType: SourceType,
    workouts: RawWorkout[]
  ): Promise<{ inserted: number; updated: number }> {
    let inserted = 0;
    let updated = 0;

    for (const raw of workouts) {
      const workout = normalizeWorkout(customerId, sourceType, raw);

      const result = await pool.query(
        `INSERT INTO hc_workout_data (
          customer_id, source_type, source_record_id, workout_type,
          start_time, end_time, duration_seconds, calories_burned,
          distance_meters, avg_heart_rate, max_heart_rate, has_gps_data, gps_polyline
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        ON CONFLICT (customer_id, source_type, source_record_id)
        DO UPDATE SET
          workout_type = EXCLUDED.workout_type,
          end_time = EXCLUDED.end_time,
          duration_seconds = EXCLUDED.duration_seconds,
          calories_burned = EXCLUDED.calories_burned,
          distance_meters = EXCLUDED.distance_meters,
          avg_heart_rate = EXCLUDED.avg_heart_rate,
          max_heart_rate = EXCLUDED.max_heart_rate,
          has_gps_data = EXCLUDED.has_gps_data,
          gps_polyline = EXCLUDED.gps_polyline
        RETURNING (xmax = 0) AS is_insert`,
        [
          customerId, sourceType, workout.sourceRecordId, workout.workoutType,
          workout.startTime, workout.endTime, workout.durationSeconds, workout.caloriesBurned,
          workout.distanceMeters, workout.avgHeartRate, workout.maxHeartRate,
          workout.hasGpsData, workout.gpsPolyline,
        ]
      );

      if (result.rows[0]?.is_insert) {
        inserted++;
      } else {
        updated++;
      }
    }

    return { inserted, updated };
  }

  private async saveSleep(
    customerId: string,
    sourceType: SourceType,
    sleepData: RawSleep[]
  ): Promise<{ inserted: number; updated: number }> {
    let inserted = 0;
    let updated = 0;

    for (const raw of sleepData) {
      const sleep = normalizeSleep(customerId, sourceType, raw);

      const result = await pool.query(
        `INSERT INTO hc_sleep_data (
          customer_id, source_type, source_record_id, sleep_date,
          bed_time, wake_time, total_sleep_minutes, deep_sleep_minutes,
          light_sleep_minutes, rem_sleep_minutes, awake_minutes, sleep_score
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        ON CONFLICT (customer_id, source_type, sleep_date, source_record_id)
        DO UPDATE SET
          bed_time = EXCLUDED.bed_time,
          wake_time = EXCLUDED.wake_time,
          total_sleep_minutes = EXCLUDED.total_sleep_minutes,
          deep_sleep_minutes = EXCLUDED.deep_sleep_minutes,
          light_sleep_minutes = EXCLUDED.light_sleep_minutes,
          rem_sleep_minutes = EXCLUDED.rem_sleep_minutes,
          awake_minutes = EXCLUDED.awake_minutes,
          sleep_score = EXCLUDED.sleep_score
        RETURNING (xmax = 0) AS is_insert`,
        [
          customerId, sourceType, sleep.sourceRecordId, sleep.sleepDate,
          sleep.bedTime, sleep.wakeTime, sleep.totalSleepMinutes, sleep.deepSleepMinutes,
          sleep.lightSleepMinutes, sleep.remSleepMinutes, sleep.awakeMinutes, sleep.sleepScore,
        ]
      );

      if (result.rows[0]?.is_insert) {
        inserted++;
      } else {
        updated++;
      }
    }

    return { inserted, updated };
  }

  private async saveBody(
    customerId: string,
    sourceType: SourceType,
    bodyData: RawBody[]
  ): Promise<{ inserted: number; updated: number }> {
    let inserted = 0;
    let updated = 0;

    for (const raw of bodyData) {
      const body = normalizeBody(customerId, sourceType, raw);

      const result = await pool.query(
        `INSERT INTO hc_body_data (
          customer_id, source_type, source_record_id, recorded_at,
          weight_kg, body_fat_percent, muscle_mass_kg, bone_mass_kg, water_percent, bmi
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (customer_id, source_type, recorded_at, source_record_id)
        DO UPDATE SET
          weight_kg = EXCLUDED.weight_kg,
          body_fat_percent = EXCLUDED.body_fat_percent,
          muscle_mass_kg = EXCLUDED.muscle_mass_kg,
          bone_mass_kg = EXCLUDED.bone_mass_kg,
          water_percent = EXCLUDED.water_percent,
          bmi = EXCLUDED.bmi
        RETURNING (xmax = 0) AS is_insert`,
        [
          customerId, sourceType, body.sourceRecordId, body.recordedAt,
          body.weightKg, body.bodyFatPercent, body.muscleMassKg,
          body.boneMassKg, body.waterPercent, body.bmi,
        ]
      );

      if (result.rows[0]?.is_insert) {
        inserted++;
      } else {
        updated++;
      }
    }

    return { inserted, updated };
  }

  private async saveHeart(
    customerId: string,
    sourceType: SourceType,
    heartData: RawHeart[]
  ): Promise<{ inserted: number; updated: number }> {
    let inserted = 0;
    let updated = 0;

    for (const raw of heartData) {
      const heart = normalizeHeart(customerId, sourceType, raw);

      const result = await pool.query(
        `INSERT INTO hc_heart_data (
          customer_id, source_type, recorded_at, recorded_date,
          heart_rate_bpm, resting_heart_rate, hrv_rmssd, recovery_score, strain_score
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT DO NOTHING
        RETURNING id`,
        [
          customerId, sourceType, heart.recordedAt, heart.recordedDate,
          heart.heartRateBpm, heart.restingHeartRate, heart.hrvRmssd,
          heart.recoveryScore, heart.strainScore,
        ]
      );

      if (result.rows.length > 0) {
        inserted++;
      }
    }

    return { inserted, updated };
  }

  // =====================================
  // Helper methods
  // =====================================

  private async getDefaultDateRange(customerId: string, sourceType: SourceType): Promise<DateRange> {
    // Get last sync time
    const source = await tokenManager.getSource(customerId, sourceType);

    const end = new Date();
    let start: Date;

    if (source?.lastSyncAt) {
      // Sync from last sync minus 1 day overlap
      start = new Date(source.lastSyncAt.getTime() - 24 * 60 * 60 * 1000);
    } else {
      // First sync - get last 7 days
      start = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
    }

    return { start, end };
  }

  private shouldSync(requestedTypes: DataType[], targetTypes: string[]): boolean {
    return requestedTypes.some(t => targetTypes.includes(t));
  }

  private webhookDataTypeToSyncTypes(webhookType: string): DataType[] {
    const mapping: Record<string, DataType[]> = {
      'activities': ['steps', 'calories', 'workout'],
      'sleep': ['sleep'],
      'body': ['weight'],
      'foods': ['calories'],
    };

    return mapping[webhookType] || ['steps', 'calories'];
  }

  private async createSyncLog(
    syncId: string,
    customerId: string,
    sourceType: SourceType,
    syncType: string
  ): Promise<void> {
    await pool.query(
      `INSERT INTO hc_sync_log (id, customer_id, source_type, sync_started_at, sync_type, status)
       VALUES ($1, $2, $3, NOW(), $4, 'running')`,
      [syncId, customerId, sourceType, syncType]
    );
  }

  private async completeSyncLog(syncId: string, result: SyncResult): Promise<void> {
    await pool.query(
      `UPDATE hc_sync_log
       SET sync_completed_at = NOW(),
           status = $2,
           records_fetched = $3,
           records_inserted = $4,
           records_updated = $5,
           records_deduped = $6,
           error_message = $7
       WHERE id = $1`,
      [
        syncId, result.status, result.recordsFetched,
        result.recordsInserted, result.recordsUpdated, result.recordsDeduped,
        result.error || null,
      ]
    );
  }
}

// Export singleton instance
export const syncOrchestrator = new SyncOrchestrator();
