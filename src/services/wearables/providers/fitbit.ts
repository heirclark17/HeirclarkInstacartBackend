// src/services/wearables/providers/fitbit.ts
// Fitbit API provider implementation

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
 * Fitbit API Provider
 *
 * Rate Limits: 150 requests/hour per user
 * Token Expiry: 8 hours (refresh tokens rotate)
 *
 * API Docs: https://dev.fitbit.com/build/reference/web-api/
 */
export class FitbitProvider extends BaseWearableProvider {
  readonly sourceType = 'fitbit' as const;
  readonly name = 'Fitbit';

  readonly capabilities: ProviderCapabilities = {
    activity: true,
    workout: true,
    sleep: true,
    body: true,
    heart: true,
    hrv: false, // HRV requires Fitbit Premium
    webhook: true,
    historicalData: true,
    realtime: false,
  };

  readonly rateLimit: RateLimitInfo = {
    requestsPerHour: 150,
  };

  protected baseUrl = 'https://api.fitbit.com';

  // Track requests for rate limiting
  private requestCount = 0;
  private requestWindowStart = Date.now();

  /**
   * Fetch daily activity summaries (steps, calories, distance, floors)
   */
  async fetchActivities(token: string, dateRange: DateRange): Promise<RawActivity[]> {
    const activities: RawActivity[] = [];
    const dates = this.getDatesBetween(dateRange.start, dateRange.end);

    for (const date of dates) {
      await this.checkRateLimit();

      const dateStr = this.formatDate(date);

      try {
        const data = await this.apiRequest<any>(
          token,
          `/1/user/-/activities/date/${dateStr}.json`
        );

        if (data.summary) {
          activities.push(this.normalizeActivity(data, date));
        }
      } catch (error: any) {
        if (error instanceof RateLimitError) {
          // Wait and retry
          await this.sleep(error.retryAfterSeconds * 1000);
          continue;
        }
        console.error(`Fitbit activity fetch failed for ${dateStr}:`, error.message);
      }
    }

    return activities;
  }

  /**
   * Fetch workout/exercise logs
   */
  async fetchWorkouts(token: string, dateRange: DateRange): Promise<RawWorkout[]> {
    await this.checkRateLimit();

    const afterDate = this.formatDate(dateRange.start);
    const beforeDate = this.formatDate(dateRange.end);

    try {
      const data = await this.apiRequest<any>(
        token,
        `/1/user/-/activities/list.json?afterDate=${afterDate}&beforeDate=${beforeDate}&sort=asc&limit=100&offset=0`
      );

      return (data.activities || []).map((activity: any) => this.normalizeWorkout(activity));
    } catch (error: any) {
      console.error('Fitbit workouts fetch failed:', error.message);
      return [];
    }
  }

  /**
   * Fetch sleep data
   */
  async fetchSleep(token: string, dateRange: DateRange): Promise<RawSleep[]> {
    await this.checkRateLimit();

    const startDate = this.formatDate(dateRange.start);
    const endDate = this.formatDate(dateRange.end);

    try {
      const data = await this.apiRequest<any>(
        token,
        `/1.2/user/-/sleep/date/${startDate}/${endDate}.json`
      );

      return (data.sleep || []).map((sleep: any) => this.normalizeSleep(sleep));
    } catch (error: any) {
      console.error('Fitbit sleep fetch failed:', error.message);
      return [];
    }
  }

  /**
   * Fetch body measurements (weight, body fat)
   */
  async fetchBody(token: string, dateRange: DateRange): Promise<RawBody[]> {
    await this.checkRateLimit();

    const startDate = this.formatDate(dateRange.start);
    const endDate = this.formatDate(dateRange.end);

    try {
      const data = await this.apiRequest<any>(
        token,
        `/1/user/-/body/log/weight/date/${startDate}/${endDate}.json`
      );

      return (data.weight || []).map((weight: any) => this.normalizeBody(weight));
    } catch (error: any) {
      console.error('Fitbit body fetch failed:', error.message);
      return [];
    }
  }

  /**
   * Fetch heart rate data (resting HR by day)
   */
  async fetchHeart(token: string, dateRange: DateRange): Promise<RawHeart[]> {
    const heartData: RawHeart[] = [];
    const dates = this.getDatesBetween(dateRange.start, dateRange.end);

    for (const date of dates) {
      await this.checkRateLimit();

      const dateStr = this.formatDate(date);

      try {
        const data = await this.apiRequest<any>(
          token,
          `/1/user/-/activities/heart/date/${dateStr}/1d.json`
        );

        const heartValue = data['activities-heart']?.[0]?.value;
        if (heartValue?.restingHeartRate) {
          heartData.push({
            recordedAt: date,
            restingHeartRate: heartValue.restingHeartRate,
          });
        }
      } catch (error: any) {
        if (error instanceof RateLimitError) {
          await this.sleep(error.retryAfterSeconds * 1000);
          continue;
        }
        // Heart rate might not be available for all dates
      }
    }

    return heartData;
  }

  /**
   * Get user profile
   */
  async getUserProfile(token: string): Promise<{ id: string; email?: string; name?: string }> {
    await this.checkRateLimit();

    const data = await this.apiRequest<any>(token, '/1/user/-/profile.json');

    return {
      id: data.user.encodedId,
      name: data.user.fullName,
    };
  }

  /**
   * Verify Fitbit webhook signature
   */
  verifyWebhook(signature: string, payload: string): boolean {
    const crypto = require('crypto');
    const secret = process.env.FITBIT_WEBHOOK_SECRET;

    if (!secret) {
      console.warn('FITBIT_WEBHOOK_SECRET not configured');
      return false;
    }

    const expectedSig = crypto
      .createHmac('sha256', secret)
      .update(payload)
      .digest('base64');

    return signature === expectedSig;
  }

  /**
   * Parse Fitbit webhook payload
   */
  parseWebhookPayload(payload: any): { userId: string; dataType: string; data?: any } {
    // Fitbit sends an array of notifications
    const notification = Array.isArray(payload) ? payload[0] : payload;

    return {
      userId: notification.ownerId,
      dataType: notification.collectionType, // 'activities', 'sleep', 'body', etc.
      data: notification,
    };
  }

  // =====================================
  // Normalization helpers
  // =====================================

  private normalizeActivity(raw: any, date: Date): RawActivity {
    const summary = raw.summary;

    return {
      sourceRecordId: `fitbit-activity-${this.formatDate(date)}`,
      recordedDate: date,
      steps: summary.steps || 0,
      activeCalories: summary.activityCalories || 0,
      restingCalories: summary.caloriesBMR || 0,
      totalCalories: summary.caloriesOut || 0,
      distanceMeters: this.milesToMeters(
        summary.distances?.find((d: any) => d.activity === 'total')?.distance || 0
      ),
      floorsClimbed: summary.floors || 0,
      activeMinutes: (summary.fairlyActiveMinutes || 0) + (summary.veryActiveMinutes || 0),
      raw,
    };
  }

  private normalizeWorkout(raw: any): RawWorkout {
    return {
      sourceRecordId: raw.logId?.toString(),
      workoutType: this.mapWorkoutType(raw.activityName || raw.name || 'other'),
      startTime: new Date(raw.startTime),
      endTime: raw.startTime && raw.activeDuration
        ? new Date(new Date(raw.startTime).getTime() + raw.activeDuration)
        : undefined,
      durationSeconds: raw.activeDuration ? Math.round(raw.activeDuration / 1000) : undefined,
      caloriesBurned: raw.calories,
      distanceMeters: raw.distance ? this.milesToMeters(raw.distance) : undefined,
      avgHeartRate: raw.averageHeartRate,
      maxHeartRate: raw.heartRateZones?.reduce(
        (max: number, zone: any) => Math.max(max, zone.max || 0), 0
      ) || undefined,
      hasGpsData: raw.hasGps || false,
      raw,
    };
  }

  private normalizeSleep(raw: any): RawSleep {
    const levels = raw.levels?.summary;

    return {
      sourceRecordId: raw.logId?.toString(),
      sleepDate: new Date(raw.dateOfSleep),
      bedTime: new Date(raw.startTime),
      wakeTime: new Date(raw.endTime),
      totalSleepMinutes: raw.minutesAsleep,
      deepSleepMinutes: levels?.deep?.minutes,
      lightSleepMinutes: levels?.light?.minutes,
      remSleepMinutes: levels?.rem?.minutes,
      awakeMinutes: raw.minutesAwake,
      sleepScore: raw.efficiency, // 0-100
      raw,
    };
  }

  private normalizeBody(raw: any): RawBody {
    return {
      sourceRecordId: raw.logId?.toString(),
      recordedAt: new Date(`${raw.date}T${raw.time || '00:00:00'}`),
      weightKg: raw.weight, // Fitbit returns kg if user setting is metric
      bodyFatPercent: raw.fat,
      bmi: raw.bmi,
      raw,
    };
  }

  // =====================================
  // Utility helpers
  // =====================================

  private milesToMeters(miles: number): number {
    return miles * 1609.344;
  }

  private async checkRateLimit(): Promise<void> {
    const now = Date.now();
    const hourMs = 60 * 60 * 1000;

    // Reset counter if window has passed
    if (now - this.requestWindowStart > hourMs) {
      this.requestCount = 0;
      this.requestWindowStart = now;
    }

    // Check if we're near the limit
    if (this.requestCount >= this.rateLimit.requestsPerHour! - 5) {
      const waitTime = hourMs - (now - this.requestWindowStart);
      console.warn(`Fitbit rate limit approaching, waiting ${Math.round(waitTime / 1000)}s`);
      await this.sleep(waitTime);
      this.requestCount = 0;
      this.requestWindowStart = Date.now();
    }

    this.requestCount++;
  }

  /**
   * Map Fitbit activity types to normalized types
   */
  protected mapWorkoutType(fitbitType: string): string {
    const mapping: Record<string, string> = {
      'Walk': 'walking',
      'Run': 'running',
      'Outdoor Bike': 'cycling',
      'Bike': 'cycling',
      'Spinning': 'cycling',
      'Swim': 'swimming',
      'Weights': 'strength',
      'Weight Training': 'strength',
      'Workout': 'strength',
      'Yoga': 'yoga',
      'Elliptical': 'elliptical',
      'Treadmill': 'running',
      'Hike': 'hiking',
      'Tennis': 'other',
      'Golf': 'other',
      'Basketball': 'other',
      'Soccer': 'other',
      'Aerobic Workout': 'other',
      'Circuit Training': 'crossfit',
      'CrossFit': 'crossfit',
    };

    return mapping[fitbitType] || super.mapWorkoutType(fitbitType);
  }
}

// Export singleton instance
export const fitbitProvider = new FitbitProvider();
