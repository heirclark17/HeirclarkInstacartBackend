// src/services/wearables/dedupeService.ts
// Deduplication service for wearable data from multiple sources

import { pool } from '../../db/pool';
import type { SourceType, DataType, DateRange } from './types';

/**
 * Default priority order for data sources
 * Manual entries always win, then native health stores, then wearables
 */
const DEFAULT_PRIORITY: Record<DataType, SourceType[]> = {
  steps: ['manual', 'apple_health', 'health_connect', 'fitbit', 'garmin', 'oura', 'withings', 'strava'],
  calories: ['manual', 'apple_health', 'health_connect', 'fitbit', 'garmin', 'oura', 'withings', 'strava'],
  distance: ['manual', 'strava', 'garmin', 'fitbit', 'apple_health', 'health_connect', 'oura', 'withings'],
  sleep: ['manual', 'oura', 'fitbit', 'garmin', 'withings', 'apple_health', 'health_connect'],
  weight: ['manual', 'withings', 'fitbit', 'garmin', 'apple_health', 'health_connect', 'oura'],
  heart_rate: ['manual', 'oura', 'fitbit', 'garmin', 'apple_health', 'health_connect'],
  hrv: ['manual', 'oura', 'fitbit', 'garmin', 'apple_health', 'health_connect'],
  workout: ['manual', 'strava', 'garmin', 'fitbit', 'apple_health', 'health_connect', 'oura'],
};

/**
 * Dedupe configuration
 */
const DEDUPE_CONFIG = {
  // Workouts within this time window are considered duplicates
  workoutTimeToleranceMinutes: 15,
  // Minimum overlap percentage to consider same workout
  workoutOverlapThreshold: 0.7,
  // Body measurements within this time are considered duplicates
  bodyTimeToleranceMinutes: 30,
  // Percentage difference to consider values as duplicates (for double-counting prevention)
  valueSimilarityThreshold: 0.05, // 5%
};

/**
 * Dedupe Service
 * Handles deduplication of health data from multiple sources
 */
export class DedupeService {
  /**
   * Run deduplication for all data types within a date range
   */
  async dedupeAll(customerId: string, dateRange: DateRange): Promise<number> {
    let totalDeduped = 0;

    totalDeduped += await this.dedupeActivity(customerId, dateRange);
    totalDeduped += await this.dedupeWorkouts(customerId, dateRange);
    totalDeduped += await this.dedupeSleep(customerId, dateRange);
    totalDeduped += await this.dedupeBody(customerId, dateRange);

    return totalDeduped;
  }

  /**
   * Dedupe activity data (steps, calories, distance)
   * Strategy: For each day, mark the highest priority source as primary
   */
  async dedupeActivity(customerId: string, dateRange: DateRange): Promise<number> {
    const priority = await this.getUserPriority(customerId, 'steps');
    let deduped = 0;

    // Get all dates with multiple activity records
    const result = await pool.query(
      `SELECT recorded_date, array_agg(DISTINCT source_type) as sources
       FROM hc_activity_data
       WHERE customer_id = $1
         AND recorded_date >= $2
         AND recorded_date <= $3
       GROUP BY recorded_date
       HAVING COUNT(DISTINCT source_type) > 1`,
      [customerId, dateRange.start, dateRange.end]
    );

    for (const row of result.rows) {
      const date = row.recorded_date;
      const sources = row.sources as SourceType[];

      // Find highest priority source
      const primarySource = this.getHighestPriority(sources, priority);

      // Mark primary and non-primary
      await pool.query(
        `UPDATE hc_activity_data
         SET is_primary = (source_type = $3)
         WHERE customer_id = $1 AND recorded_date = $2`,
        [customerId, date, primarySource]
      );

      deduped += sources.length - 1;
    }

    // Mark single-source days as primary
    await pool.query(
      `UPDATE hc_activity_data
       SET is_primary = true
       WHERE customer_id = $1
         AND recorded_date >= $2
         AND recorded_date <= $3
         AND is_primary = false
         AND recorded_date NOT IN (
           SELECT recorded_date FROM hc_activity_data
           WHERE customer_id = $1
           GROUP BY recorded_date
           HAVING COUNT(DISTINCT source_type) > 1
         )`,
      [customerId, dateRange.start, dateRange.end]
    );

    return deduped;
  }

  /**
   * Dedupe workouts using fuzzy time matching
   * Strategy: Group overlapping workouts, mark highest priority as primary
   */
  async dedupeWorkouts(customerId: string, dateRange: DateRange): Promise<number> {
    const priority = await this.getUserPriority(customerId, 'workout');
    let deduped = 0;

    // Get all workouts in date range
    const result = await pool.query(
      `SELECT id, source_type, workout_type, start_time, end_time, duration_seconds
       FROM hc_workout_data
       WHERE customer_id = $1
         AND start_time >= $2
         AND start_time <= $3
       ORDER BY start_time`,
      [customerId, dateRange.start, dateRange.end]
    );

    const workouts = result.rows;
    const processed = new Set<string>();

    for (let i = 0; i < workouts.length; i++) {
      if (processed.has(workouts[i].id)) continue;

      const group: typeof workouts = [workouts[i]];
      processed.add(workouts[i].id);

      // Find overlapping workouts
      for (let j = i + 1; j < workouts.length; j++) {
        if (processed.has(workouts[j].id)) continue;

        if (this.workoutsOverlap(workouts[i], workouts[j])) {
          group.push(workouts[j]);
          processed.add(workouts[j].id);
        }
      }

      if (group.length > 1) {
        // Assign dedupe group ID
        const groupId = crypto.randomUUID();

        // Find primary workout based on priority
        const sources = group.map(w => w.source_type as SourceType);
        const primarySource = this.getHighestPriority(sources, priority);
        const primaryWorkout = group.find(w => w.source_type === primarySource);

        // Update all workouts in group
        for (const workout of group) {
          await pool.query(
            `UPDATE hc_workout_data
             SET dedupe_group_id = $2, is_primary = $3
             WHERE id = $1`,
            [workout.id, groupId, workout.id === primaryWorkout?.id]
          );
        }

        deduped += group.length - 1;
      } else {
        // Single workout - mark as primary
        await pool.query(
          `UPDATE hc_workout_data SET is_primary = true WHERE id = $1`,
          [workouts[i].id]
        );
      }
    }

    return deduped;
  }

  /**
   * Dedupe sleep data
   * Strategy: For each sleep date, mark highest priority source as primary
   */
  async dedupeSleep(customerId: string, dateRange: DateRange): Promise<number> {
    const priority = await this.getUserPriority(customerId, 'sleep');
    let deduped = 0;

    // Get all dates with multiple sleep records
    const result = await pool.query(
      `SELECT sleep_date, array_agg(DISTINCT source_type) as sources
       FROM hc_sleep_data
       WHERE customer_id = $1
         AND sleep_date >= $2
         AND sleep_date <= $3
       GROUP BY sleep_date
       HAVING COUNT(DISTINCT source_type) > 1`,
      [customerId, dateRange.start, dateRange.end]
    );

    for (const row of result.rows) {
      const date = row.sleep_date;
      const sources = row.sources as SourceType[];

      const primarySource = this.getHighestPriority(sources, priority);

      await pool.query(
        `UPDATE hc_sleep_data
         SET is_primary = (source_type = $3)
         WHERE customer_id = $1 AND sleep_date = $2`,
        [customerId, date, primarySource]
      );

      deduped += sources.length - 1;
    }

    // Mark single-source days as primary
    await pool.query(
      `UPDATE hc_sleep_data
       SET is_primary = true
       WHERE customer_id = $1
         AND sleep_date >= $2
         AND sleep_date <= $3
         AND is_primary = false
         AND sleep_date NOT IN (
           SELECT sleep_date FROM hc_sleep_data
           WHERE customer_id = $1
           GROUP BY sleep_date
           HAVING COUNT(DISTINCT source_type) > 1
         )`,
      [customerId, dateRange.start, dateRange.end]
    );

    return deduped;
  }

  /**
   * Dedupe body measurements
   * Strategy: Group measurements within time tolerance, mark highest priority as primary
   */
  async dedupeBody(customerId: string, dateRange: DateRange): Promise<number> {
    const priority = await this.getUserPriority(customerId, 'weight');
    let deduped = 0;

    // Get all body measurements in date range
    const result = await pool.query(
      `SELECT id, source_type, recorded_at, weight_kg
       FROM hc_body_data
       WHERE customer_id = $1
         AND recorded_at >= $2
         AND recorded_at <= $3
       ORDER BY recorded_at`,
      [customerId, dateRange.start, dateRange.end]
    );

    const measurements = result.rows;
    const processed = new Set<string>();
    const toleranceMs = DEDUPE_CONFIG.bodyTimeToleranceMinutes * 60 * 1000;

    for (let i = 0; i < measurements.length; i++) {
      if (processed.has(measurements[i].id)) continue;

      const group: typeof measurements = [measurements[i]];
      processed.add(measurements[i].id);

      // Find measurements within time tolerance
      const baseTime = new Date(measurements[i].recorded_at).getTime();

      for (let j = i + 1; j < measurements.length; j++) {
        if (processed.has(measurements[j].id)) continue;

        const compareTime = new Date(measurements[j].recorded_at).getTime();
        if (Math.abs(compareTime - baseTime) <= toleranceMs) {
          group.push(measurements[j]);
          processed.add(measurements[j].id);
        }
      }

      if (group.length > 1) {
        const groupId = crypto.randomUUID();
        const sources = group.map(m => m.source_type as SourceType);
        const primarySource = this.getHighestPriority(sources, priority);
        const primaryMeasurement = group.find(m => m.source_type === primarySource);

        for (const measurement of group) {
          await pool.query(
            `UPDATE hc_body_data
             SET dedupe_group_id = $2, is_primary = $3
             WHERE id = $1`,
            [measurement.id, groupId, measurement.id === primaryMeasurement?.id]
          );
        }

        deduped += group.length - 1;
      } else {
        await pool.query(
          `UPDATE hc_body_data SET is_primary = true WHERE id = $1`,
          [measurements[i].id]
        );
      }
    }

    return deduped;
  }

  /**
   * Prevent double-counting when health store aggregates wearable data
   * e.g., Fitbit syncs to Apple Health, user connects both
   */
  async preventDoubleCount(customerId: string, date: string): Promise<void> {
    // Get activity data from all sources for this date
    const result = await pool.query(
      `SELECT id, source_type, steps, active_calories
       FROM hc_activity_data
       WHERE customer_id = $1 AND recorded_date = $2`,
      [customerId, date]
    );

    if (result.rows.length < 2) return;

    const healthStoreData = result.rows.filter(r =>
      ['apple_health', 'health_connect'].includes(r.source_type)
    );
    const directData = result.rows.filter(r =>
      !['apple_health', 'health_connect'].includes(r.source_type)
    );

    // Check for near-identical values (likely health store got data from wearable)
    for (const hs of healthStoreData) {
      for (const direct of directData) {
        if (!hs.steps || !direct.steps) continue;

        const stepsDiff = Math.abs(hs.steps - direct.steps) / direct.steps;
        const caloriesDiff = hs.active_calories && direct.active_calories
          ? Math.abs(hs.active_calories - direct.active_calories) / direct.active_calories
          : 1;

        // If values are within threshold, mark health store as non-primary
        if (stepsDiff < DEDUPE_CONFIG.valueSimilarityThreshold ||
            caloriesDiff < DEDUPE_CONFIG.valueSimilarityThreshold) {
          await pool.query(
            `UPDATE hc_activity_data SET is_primary = false WHERE id = $1`,
            [hs.id]
          );
          await pool.query(
            `UPDATE hc_activity_data SET is_primary = true WHERE id = $1`,
            [direct.id]
          );
        }
      }
    }
  }

  // =====================================
  // Helper methods
  // =====================================

  /**
   * Get user's priority preference for a data type, or use default
   */
  private async getUserPriority(customerId: string, dataType: DataType): Promise<SourceType[]> {
    const result = await pool.query(
      `SELECT priority_order FROM hc_source_priority
       WHERE customer_id = $1 AND data_type = $2`,
      [customerId, dataType]
    );

    if (result.rows.length > 0 && result.rows[0].priority_order?.length > 0) {
      return result.rows[0].priority_order;
    }

    return DEFAULT_PRIORITY[dataType] || DEFAULT_PRIORITY.steps;
  }

  /**
   * Get highest priority source from a list
   */
  private getHighestPriority(sources: SourceType[], priority: SourceType[]): SourceType {
    for (const p of priority) {
      if (sources.includes(p)) {
        return p;
      }
    }
    return sources[0];
  }

  /**
   * Check if two workouts overlap
   */
  private workoutsOverlap(w1: any, w2: any): boolean {
    const tolerance = DEDUPE_CONFIG.workoutTimeToleranceMinutes * 60 * 1000;

    const start1 = new Date(w1.start_time).getTime();
    const start2 = new Date(w2.start_time).getTime();

    // Check if start times are within tolerance
    if (Math.abs(start1 - start2) <= tolerance) {
      return true;
    }

    // Check time overlap if we have end times
    if (w1.end_time && w2.end_time) {
      const end1 = new Date(w1.end_time).getTime();
      const end2 = new Date(w2.end_time).getTime();

      const overlapStart = Math.max(start1, start2);
      const overlapEnd = Math.min(end1, end2);

      if (overlapEnd > overlapStart) {
        const overlapDuration = overlapEnd - overlapStart;
        const duration1 = end1 - start1;
        const duration2 = end2 - start2;
        const minDuration = Math.min(duration1, duration2);

        if (overlapDuration / minDuration >= DEDUPE_CONFIG.workoutOverlapThreshold) {
          return true;
        }
      }
    }

    return false;
  }
}

// Export singleton instance
export const dedupeService = new DedupeService();
