// src/services/wearables/providers/withings.ts
// Withings API provider implementation

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
 * Withings Health Mate API Provider
 *
 * Rate Limits: 120 requests per minute
 * Token Expiry: 3 hours (refresh tokens valid for 1 year)
 *
 * API Docs: https://developer.withings.com/api-reference
 */
export class WithingsProvider extends BaseWearableProvider {
  readonly sourceType = 'withings' as const;
  readonly name = 'Withings';

  readonly capabilities: ProviderCapabilities = {
    activity: true,
    workout: true,
    sleep: true,
    body: true,    // Primary data type (smart scales)
    heart: true,
    hrv: false,
    webhook: true,
    historicalData: true,
    realtime: false,
  };

  readonly rateLimit: RateLimitInfo = {
    requestsPerMinute: 120,
  };

  protected baseUrl = 'https://wbsapi.withings.net';

  // Track requests for rate limiting
  private requestCount = 0;
  private requestWindowStart = Date.now();

  /**
   * Fetch daily activity summaries
   */
  async fetchActivities(token: string, dateRange: DateRange): Promise<RawActivity[]> {
    const activities: RawActivity[] = [];

    try {
      await this.checkRateLimit();

      const data = await this.withingsApiRequest(token, '/v2/measure', {
        action: 'getactivity',
        startdateymd: this.formatDate(dateRange.start),
        enddateymd: this.formatDate(dateRange.end),
      });

      if (data.body?.activities) {
        for (const activity of data.body.activities) {
          activities.push(this.normalizeActivity(activity));
        }
      }
    } catch (error: any) {
      console.error('Withings activities fetch failed:', error.message);
    }

    return activities;
  }

  /**
   * Fetch workout data
   */
  async fetchWorkouts(token: string, dateRange: DateRange): Promise<RawWorkout[]> {
    const workouts: RawWorkout[] = [];

    try {
      await this.checkRateLimit();

      const startTs = Math.floor(dateRange.start.getTime() / 1000);
      const endTs = Math.floor(dateRange.end.getTime() / 1000) + 86400;

      const data = await this.withingsApiRequest(token, '/v2/measure', {
        action: 'getworkouts',
        startdate: startTs,
        enddate: endTs,
      });

      if (data.body?.series) {
        for (const workout of data.body.series) {
          workouts.push(this.normalizeWorkout(workout));
        }
      }
    } catch (error: any) {
      console.error('Withings workouts fetch failed:', error.message);
    }

    return workouts;
  }

  /**
   * Fetch sleep data
   */
  async fetchSleep(token: string, dateRange: DateRange): Promise<RawSleep[]> {
    const sleepData: RawSleep[] = [];

    try {
      await this.checkRateLimit();

      const startTs = Math.floor(dateRange.start.getTime() / 1000);
      const endTs = Math.floor(dateRange.end.getTime() / 1000) + 86400;

      const data = await this.withingsApiRequest(token, '/v2/sleep', {
        action: 'getsummary',
        startdateymd: this.formatDate(dateRange.start),
        enddateymd: this.formatDate(dateRange.end),
      });

      if (data.body?.series) {
        for (const sleep of data.body.series) {
          sleepData.push(this.normalizeSleep(sleep));
        }
      }
    } catch (error: any) {
      console.error('Withings sleep fetch failed:', error.message);
    }

    return sleepData;
  }

  /**
   * Fetch body measurements (weight, body fat, etc.)
   * This is Withings' primary strength with their smart scales
   */
  async fetchBody(token: string, dateRange: DateRange): Promise<RawBody[]> {
    const bodyData: RawBody[] = [];

    try {
      await this.checkRateLimit();

      const startTs = Math.floor(dateRange.start.getTime() / 1000);
      const endTs = Math.floor(dateRange.end.getTime() / 1000) + 86400;

      const data = await this.withingsApiRequest(token, '/measure', {
        action: 'getmeas',
        startdate: startTs,
        enddate: endTs,
        category: 1, // Real measurements (not user objectives)
      });

      if (data.body?.measuregrps) {
        // Group measurements by timestamp
        const measurementsByTime = new Map<number, any>();

        for (const grp of data.body.measuregrps) {
          const existing = measurementsByTime.get(grp.date) || {
            date: grp.date,
            measures: {},
          };

          for (const measure of grp.measures) {
            const value = measure.value * Math.pow(10, measure.unit);

            // Withings measure types
            switch (measure.type) {
              case 1: existing.measures.weight = value; break;      // Weight (kg)
              case 6: existing.measures.fatPercent = value; break;  // Fat %
              case 8: existing.measures.fatMass = value; break;     // Fat mass (kg)
              case 76: existing.measures.muscle = value; break;     // Muscle mass (kg)
              case 77: existing.measures.water = value; break;      // Hydration (kg)
              case 88: existing.measures.bone = value; break;       // Bone mass (kg)
            }
          }

          measurementsByTime.set(grp.date, existing);
        }

        for (const [timestamp, data] of measurementsByTime) {
          bodyData.push(this.normalizeBody(timestamp, data.measures));
        }
      }
    } catch (error: any) {
      console.error('Withings body fetch failed:', error.message);
    }

    return bodyData;
  }

  /**
   * Fetch heart rate data
   */
  async fetchHeart(token: string, dateRange: DateRange): Promise<RawHeart[]> {
    const heartData: RawHeart[] = [];

    try {
      await this.checkRateLimit();

      const startTs = Math.floor(dateRange.start.getTime() / 1000);
      const endTs = Math.floor(dateRange.end.getTime() / 1000) + 86400;

      // Get heart rate from body measurements (some Withings scales measure HR)
      const data = await this.withingsApiRequest(token, '/measure', {
        action: 'getmeas',
        startdate: startTs,
        enddate: endTs,
        category: 1,
        meastype: 11, // Heart rate
      });

      if (data.body?.measuregrps) {
        for (const grp of data.body.measuregrps) {
          for (const measure of grp.measures) {
            if (measure.type === 11) { // Heart rate
              const hr = measure.value * Math.pow(10, measure.unit);
              heartData.push({
                recordedAt: new Date(grp.date * 1000),
                heartRateBpm: Math.round(hr),
              });
            }
          }
        }
      }
    } catch (error: any) {
      console.error('Withings heart fetch failed:', error.message);
    }

    return heartData;
  }

  /**
   * Get user profile
   */
  async getUserProfile(token: string): Promise<{ id: string; email?: string; name?: string }> {
    await this.checkRateLimit();

    const data = await this.withingsApiRequest(token, '/v2/user', {
      action: 'getdevice',
    });

    // Withings doesn't expose user profile easily, use deviceid
    const deviceId = data.body?.devices?.[0]?.deviceid;

    return {
      id: deviceId || 'unknown',
    };
  }

  /**
   * Verify Withings webhook signature
   */
  verifyWebhook(signature: string, payload: string): boolean {
    const crypto = require('crypto');
    const secret = process.env.WITHINGS_WEBHOOK_SECRET;

    if (!secret) {
      console.warn('WITHINGS_WEBHOOK_SECRET not configured');
      return false;
    }

    const expectedSig = crypto
      .createHmac('sha256', secret)
      .update(payload)
      .digest('hex');

    return signature === expectedSig;
  }

  /**
   * Parse Withings webhook payload
   */
  parseWebhookPayload(payload: any): { userId: string; dataType: string; data?: any } {
    // Withings appli codes
    const appliToDataType: Record<number, string> = {
      1: 'body',      // Body weight
      4: 'body',      // Body fat
      16: 'activity', // Activity
      44: 'sleep',    // Sleep
      46: 'body',     // User vitals
      50: 'workout',  // Workout
      51: 'heart',    // Heart rate
      54: 'body',     // Scale-related
    };

    return {
      userId: payload.userid?.toString(),
      dataType: appliToDataType[payload.appli] || 'unknown',
      data: payload,
    };
  }

  // =====================================
  // Withings-specific API helper
  // =====================================

  /**
   * Withings uses a different request format (form-encoded POST)
   */
  private async withingsApiRequest(
    token: string,
    endpoint: string,
    params: Record<string, any>
  ): Promise<any> {
    const url = `${this.baseUrl}${endpoint}`;

    const formBody = new URLSearchParams(params).toString();

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formBody,
    });

    if (response.status === 429) {
      const retryAfter = response.headers.get('Retry-After');
      throw new RateLimitError(
        'Withings rate limit exceeded',
        retryAfter ? parseInt(retryAfter) : 60
      );
    }

    const data = await response.json();

    // Withings uses status codes in the response body
    if (data.status !== 0) {
      const errorMessages: Record<number, string> = {
        100: 'Missing required parameters',
        101: 'Invalid parameter value',
        200: 'Unauthorized (invalid or expired token)',
        201: 'User is deauthorized',
        202: 'Need consent again',
        401: 'Invalid access token',
        500: 'Technical error',
        503: 'Service temporarily unavailable',
      };

      const message = errorMessages[data.status] || `Withings error: ${data.status}`;

      if (data.status === 200 || data.status === 401) {
        throw new Error(`AUTH_ERROR: ${message}`);
      }

      throw new Error(message);
    }

    return data;
  }

  // =====================================
  // Normalization helpers
  // =====================================

  private normalizeActivity(raw: any): RawActivity {
    return {
      sourceRecordId: `withings-activity-${raw.date}`,
      recordedDate: new Date(raw.date),
      steps: raw.steps,
      activeCalories: raw.calories,
      totalCalories: raw.totalcalories,
      distanceMeters: raw.distance,
      floorsClimbed: raw.elevation,
      activeMinutes: Math.round((raw.moderate || 0) / 60) + Math.round((raw.intense || 0) / 60),
      raw,
    };
  }

  private normalizeWorkout(raw: any): RawWorkout {
    return {
      sourceRecordId: raw.id?.toString() || `withings-workout-${raw.startdate}`,
      workoutType: this.mapWorkoutType(raw.category?.toString() || 'other'),
      startTime: new Date(raw.startdate * 1000),
      endTime: new Date(raw.enddate * 1000),
      durationSeconds: raw.enddate - raw.startdate,
      caloriesBurned: raw.calories,
      distanceMeters: raw.distance,
      avgHeartRate: raw.hr_average,
      maxHeartRate: raw.hr_max,
      hasGpsData: raw.gpx_path ? true : false,
      raw,
    };
  }

  private normalizeSleep(raw: any): RawSleep {
    return {
      sourceRecordId: raw.id?.toString() || `withings-sleep-${raw.date}`,
      sleepDate: new Date(raw.date),
      bedTime: raw.startdate ? new Date(raw.startdate * 1000) : undefined,
      wakeTime: raw.enddate ? new Date(raw.enddate * 1000) : undefined,
      totalSleepMinutes: raw.data?.total_sleep_time
        ? Math.round(raw.data.total_sleep_time / 60)
        : undefined,
      deepSleepMinutes: raw.data?.deepsleepduration
        ? Math.round(raw.data.deepsleepduration / 60)
        : undefined,
      lightSleepMinutes: raw.data?.lightsleepduration
        ? Math.round(raw.data.lightsleepduration / 60)
        : undefined,
      remSleepMinutes: raw.data?.remsleepduration
        ? Math.round(raw.data.remsleepduration / 60)
        : undefined,
      awakeMinutes: raw.data?.wakeupcount
        ? Math.round(raw.data.wakeupduration / 60)
        : undefined,
      sleepScore: raw.data?.sleep_score,
      raw,
    };
  }

  private normalizeBody(timestamp: number, measures: any): RawBody {
    return {
      sourceRecordId: `withings-body-${timestamp}`,
      recordedAt: new Date(timestamp * 1000),
      weightKg: measures.weight,
      bodyFatPercent: measures.fatPercent,
      muscleMassKg: measures.muscle,
      boneMassKg: measures.bone,
      waterPercent: measures.water ? (measures.water / (measures.weight || 1)) * 100 : undefined,
      raw: measures,
    };
  }

  // =====================================
  // Rate limiting
  // =====================================

  private async checkRateLimit(): Promise<void> {
    const now = Date.now();
    const minuteMs = 60 * 1000;

    if (now - this.requestWindowStart > minuteMs) {
      this.requestCount = 0;
      this.requestWindowStart = now;
    }

    if (this.requestCount >= 115) { // Leave some buffer
      const waitTime = minuteMs - (now - this.requestWindowStart);
      console.warn(`Withings rate limit approaching, waiting ${Math.round(waitTime / 1000)}s`);
      await this.sleep(waitTime);
      this.requestCount = 0;
      this.requestWindowStart = Date.now();
    }

    this.requestCount++;
  }

  /**
   * Map Withings workout categories to normalized types
   * Withings uses numeric category codes
   */
  protected mapWorkoutType(withingsCategory: string): string {
    const mapping: Record<string, string> = {
      '1': 'walking',
      '2': 'running',
      '3': 'hiking',
      '4': 'other',     // Skating
      '5': 'other',     // BMX
      '6': 'cycling',
      '7': 'swimming',
      '8': 'other',     // Surfing
      '9': 'other',     // Kitesurfing
      '10': 'other',    // Windsurfing
      '11': 'other',    // Bodyboard
      '12': 'other',    // Tennis
      '13': 'other',    // Table tennis
      '14': 'other',    // Squash
      '15': 'other',    // Badminton
      '16': 'other',    // Lift weights
      '17': 'other',    // Calisthenics
      '18': 'elliptical',
      '19': 'other',    // Pilates
      '20': 'other',    // Basketball
      '21': 'other',    // Soccer
      '22': 'other',    // Football
      '23': 'other',    // Rugby
      '24': 'other',    // Volleyball
      '25': 'other',    // Water polo
      '26': 'other',    // Horse riding
      '27': 'other',    // Golf
      '28': 'yoga',
      '29': 'other',    // Dancing
      '30': 'other',    // Boxing
      '31': 'other',    // Fencing
      '32': 'other',    // Wrestling
      '33': 'other',    // Martial arts
      '34': 'other',    // Skiing
      '35': 'other',    // Snowboarding
      '36': 'other',    // Other
      '128': 'strength',
      '187': 'running', // Treadmill
      '188': 'other',   // Rowing machine
      '190': 'other',   // Indoor cycling
      '191': 'elliptical', // Elliptical
      '192': 'other',   // HIIT
      '193': 'crossfit',
      '194': 'other',   // Step training
      '200': 'cycling', // Indoor cycling
      '304': 'rowing',
    };

    return mapping[withingsCategory] || super.mapWorkoutType(withingsCategory);
  }
}

// Export singleton instance
export const withingsProvider = new WithingsProvider();
