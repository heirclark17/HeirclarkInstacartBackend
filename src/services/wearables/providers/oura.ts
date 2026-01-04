// src/services/wearables/providers/oura.ts
// Oura Ring API provider implementation

import {
  BaseWearableProvider,
  ProviderCapabilities,
  RateLimitInfo,
  RawActivity,
  RawWorkout,
  RawSleep,
  RawBody,
  RawHeart,
  RateLimitError,
} from './baseProvider';
import type { DateRange } from '../types';

/**
 * Oura Ring API Provider (V2 API)
 *
 * Rate Limits: 5000 requests per 5 minutes
 * Token Expiry: Access tokens expire in 24 hours
 *
 * API Docs: https://cloud.ouraring.com/v2/docs
 */
export class OuraProvider extends BaseWearableProvider {
  readonly sourceType = 'oura' as const;
  readonly name = 'Oura Ring';

  readonly capabilities: ProviderCapabilities = {
    activity: true,
    workout: true,
    sleep: true,    // Primary data type for Oura
    body: false,
    heart: true,
    hrv: true,      // Oura excels at HRV
    webhook: true,
    historicalData: true,
    realtime: false,
  };

  readonly rateLimit: RateLimitInfo = {
    requestsPerMinute: 1000, // 5000 per 5 min
  };

  protected baseUrl = 'https://api.ouraring.com/v2';

  /**
   * Fetch daily activity summaries
   */
  async fetchActivities(token: string, dateRange: DateRange): Promise<RawActivity[]> {
    const activities: RawActivity[] = [];

    try {
      const startDate = this.formatDate(dateRange.start);
      const endDate = this.formatDate(dateRange.end);

      const data = await this.apiRequest<any>(
        token,
        `/usercollection/daily_activity?start_date=${startDate}&end_date=${endDate}`
      );

      for (const activity of data.data || []) {
        activities.push(this.normalizeActivity(activity));
      }
    } catch (error: any) {
      console.error('Oura activities fetch failed:', error.message);
    }

    return activities;
  }

  /**
   * Fetch workout sessions
   */
  async fetchWorkouts(token: string, dateRange: DateRange): Promise<RawWorkout[]> {
    const workouts: RawWorkout[] = [];

    try {
      const startDate = this.formatDate(dateRange.start);
      const endDate = this.formatDate(dateRange.end);

      const data = await this.apiRequest<any>(
        token,
        `/usercollection/workout?start_date=${startDate}&end_date=${endDate}`
      );

      for (const workout of data.data || []) {
        workouts.push(this.normalizeWorkout(workout));
      }
    } catch (error: any) {
      console.error('Oura workouts fetch failed:', error.message);
    }

    return workouts;
  }

  /**
   * Fetch sleep data (Oura's specialty)
   */
  async fetchSleep(token: string, dateRange: DateRange): Promise<RawSleep[]> {
    const sleepData: RawSleep[] = [];

    try {
      const startDate = this.formatDate(dateRange.start);
      const endDate = this.formatDate(dateRange.end);

      // Fetch sleep sessions
      const sessionsData = await this.apiRequest<any>(
        token,
        `/usercollection/sleep?start_date=${startDate}&end_date=${endDate}`
      );

      // Also fetch daily sleep scores
      const dailyData = await this.apiRequest<any>(
        token,
        `/usercollection/daily_sleep?start_date=${startDate}&end_date=${endDate}`
      );

      // Create a map of daily scores
      const dailyScores = new Map<string, number>();
      for (const day of dailyData.data || []) {
        dailyScores.set(day.day, day.score);
      }

      for (const sleep of sessionsData.data || []) {
        const normalized = this.normalizeSleep(sleep);

        // Add daily score if available
        const dateStr = this.formatDate(normalized.sleepDate);
        if (dailyScores.has(dateStr)) {
          normalized.sleepScore = dailyScores.get(dateStr);
        }

        sleepData.push(normalized);
      }
    } catch (error: any) {
      console.error('Oura sleep fetch failed:', error.message);
    }

    return sleepData;
  }

  /**
   * Oura doesn't track body measurements
   */
  async fetchBody(token: string, dateRange: DateRange): Promise<RawBody[]> {
    return [];
  }

  /**
   * Fetch heart rate and HRV data
   */
  async fetchHeart(token: string, dateRange: DateRange): Promise<RawHeart[]> {
    const heartData: RawHeart[] = [];

    try {
      const startDate = this.formatDate(dateRange.start);
      const endDate = this.formatDate(dateRange.end);

      // Fetch daily readiness (includes HRV and resting HR)
      const readinessData = await this.apiRequest<any>(
        token,
        `/usercollection/daily_readiness?start_date=${startDate}&end_date=${endDate}`
      );

      for (const readiness of readinessData.data || []) {
        heartData.push(this.normalizeHeart(readiness));
      }
    } catch (error: any) {
      console.error('Oura heart data fetch failed:', error.message);
    }

    return heartData;
  }

  /**
   * Get user profile
   */
  async getUserProfile(token: string): Promise<{ id: string; email?: string; name?: string }> {
    const data = await this.apiRequest<any>(token, '/usercollection/personal_info');

    return {
      id: data.id || data.email,
      email: data.email,
    };
  }

  /**
   * Verify Oura webhook signature
   */
  verifyWebhook(signature: string, payload: string): boolean {
    const crypto = require('crypto');
    const secret = process.env.OURA_WEBHOOK_SECRET;

    if (!secret) {
      console.warn('OURA_WEBHOOK_SECRET not configured');
      return false;
    }

    const expectedSig = crypto
      .createHmac('sha256', secret)
      .update(payload)
      .digest('hex');

    return signature === expectedSig;
  }

  /**
   * Parse Oura webhook payload
   */
  parseWebhookPayload(payload: any): { userId: string; dataType: string; data?: any } {
    return {
      userId: payload.user_id,
      dataType: payload.data_type, // 'daily_activity', 'sleep', 'workout', etc.
      data: payload,
    };
  }

  // =====================================
  // Normalization helpers
  // =====================================

  private normalizeActivity(raw: any): RawActivity {
    return {
      sourceRecordId: raw.id,
      recordedDate: new Date(raw.day),
      steps: raw.steps,
      activeCalories: raw.active_calories,
      totalCalories: raw.total_calories,
      distanceMeters: raw.equivalent_walking_distance, // meters
      activeMinutes: Math.round((raw.high_activity_time || 0) / 60) +
                     Math.round((raw.medium_activity_time || 0) / 60),
      raw,
    };
  }

  private normalizeWorkout(raw: any): RawWorkout {
    return {
      sourceRecordId: raw.id,
      workoutType: this.mapWorkoutType(raw.activity || 'other'),
      startTime: new Date(raw.start_datetime),
      endTime: new Date(raw.end_datetime),
      durationSeconds: raw.duration || undefined,
      caloriesBurned: raw.calories,
      distanceMeters: raw.distance,
      avgHeartRate: raw.average_heart_rate,
      maxHeartRate: raw.max_heart_rate,
      hasGpsData: false,
      raw,
    };
  }

  private normalizeSleep(raw: any): RawSleep {
    return {
      sourceRecordId: raw.id,
      sleepDate: new Date(raw.day),
      bedTime: new Date(raw.bedtime_start),
      wakeTime: new Date(raw.bedtime_end),
      totalSleepMinutes: Math.round((raw.total_sleep_duration || 0) / 60),
      deepSleepMinutes: Math.round((raw.deep_sleep_duration || 0) / 60),
      lightSleepMinutes: Math.round((raw.light_sleep_duration || 0) / 60),
      remSleepMinutes: Math.round((raw.rem_sleep_duration || 0) / 60),
      awakeMinutes: Math.round((raw.awake_time || 0) / 60),
      sleepScore: raw.score,
      raw,
    };
  }

  private normalizeHeart(raw: any): RawHeart {
    return {
      recordedAt: new Date(raw.day),
      restingHeartRate: raw.contributors?.resting_heart_rate,
      hrvRmssd: raw.contributors?.hrv_balance,
      recoveryScore: raw.score, // Readiness score
      raw,
    };
  }

  /**
   * Map Oura activity types to normalized types
   */
  protected mapWorkoutType(ouraType: string): string {
    const mapping: Record<string, string> = {
      'running': 'running',
      'cycling': 'cycling',
      'walking': 'walking',
      'hiking': 'hiking',
      'swimming': 'swimming',
      'strength_training': 'strength',
      'yoga': 'yoga',
      'rowing': 'rowing',
      'elliptical': 'elliptical',
      'crossfit': 'crossfit',
      'dancing': 'other',
      'pilates': 'other',
      'martial_arts': 'other',
      'tennis': 'other',
      'basketball': 'other',
      'soccer': 'other',
      'golf': 'other',
    };

    return mapping[ouraType.toLowerCase()] || super.mapWorkoutType(ouraType);
  }
}

// Export singleton instance
export const ouraProvider = new OuraProvider();
