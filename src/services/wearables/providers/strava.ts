// src/services/wearables/providers/strava.ts
// Strava API provider implementation

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
 * Strava API Provider
 *
 * Rate Limits: 100 requests per 15 minutes, 1000 per day
 * Token Expiry: 6 hours (refresh tokens don't expire)
 *
 * API Docs: https://developers.strava.com/docs/reference/
 */
export class StravaProvider extends BaseWearableProvider {
  readonly sourceType = 'strava' as const;
  readonly name = 'Strava';

  readonly capabilities: ProviderCapabilities = {
    activity: true,   // Aggregated from workouts
    workout: true,    // Primary data type
    sleep: false,
    body: false,
    heart: true,      // From workouts
    hrv: false,
    webhook: true,
    historicalData: true,
    realtime: false,
  };

  readonly rateLimit: RateLimitInfo = {
    requestsPerMinute: 7,  // ~100 per 15 min
    requestsPerDay: 1000,
  };

  protected baseUrl = 'https://www.strava.com/api/v3';

  // Track requests for rate limiting
  private requestCount = 0;
  private requestWindowStart = Date.now();
  private dailyRequestCount = 0;
  private dailyWindowStart = Date.now();

  /**
   * Fetch daily activity summaries (aggregated from workouts)
   * Strava is workout-focused, so we aggregate workout data by day
   */
  async fetchActivities(token: string, dateRange: DateRange): Promise<RawActivity[]> {
    // Fetch workouts first, then aggregate by day
    const workouts = await this.fetchWorkouts(token, dateRange);

    // Group workouts by date
    const activityByDate = new Map<string, RawActivity>();

    for (const workout of workouts) {
      const dateStr = this.formatDate(workout.startTime);

      const existing = activityByDate.get(dateStr) || {
        sourceRecordId: `strava-activity-${dateStr}`,
        recordedDate: new Date(dateStr),
        steps: 0,
        activeCalories: 0,
        distanceMeters: 0,
        activeMinutes: 0,
      };

      // Aggregate workout data
      existing.activeCalories = (existing.activeCalories || 0) + (workout.caloriesBurned || 0);
      existing.distanceMeters = (existing.distanceMeters || 0) + (workout.distanceMeters || 0);
      existing.activeMinutes = (existing.activeMinutes || 0) + Math.round((workout.durationSeconds || 0) / 60);

      // Estimate steps from running/walking workouts
      if (['running', 'walking', 'hiking'].includes(workout.workoutType)) {
        // Rough estimate: 1300 steps per km for running, 1400 for walking
        const kmDistance = (workout.distanceMeters || 0) / 1000;
        const stepsPerKm = workout.workoutType === 'running' ? 1300 : 1400;
        existing.steps = (existing.steps || 0) + Math.round(kmDistance * stepsPerKm);
      }

      activityByDate.set(dateStr, existing);
    }

    return Array.from(activityByDate.values());
  }

  /**
   * Fetch workout/activity data from Strava
   */
  async fetchWorkouts(token: string, dateRange: DateRange): Promise<RawWorkout[]> {
    const workouts: RawWorkout[] = [];
    let page = 1;
    const perPage = 100;

    // Convert dates to Unix timestamps
    const after = Math.floor(dateRange.start.getTime() / 1000);
    const before = Math.floor(dateRange.end.getTime() / 1000) + 86400; // Include end date

    try {
      while (true) {
        await this.checkRateLimit();

        const activities = await this.apiRequest<any[]>(
          token,
          `/athlete/activities?after=${after}&before=${before}&page=${page}&per_page=${perPage}`
        );

        if (!activities || activities.length === 0) break;

        for (const activity of activities) {
          workouts.push(this.normalizeWorkout(activity));
        }

        if (activities.length < perPage) break;
        page++;
      }
    } catch (error: any) {
      if (error instanceof RateLimitError) {
        console.warn('Strava rate limit hit, returning partial results');
      } else {
        console.error('Strava workouts fetch failed:', error.message);
      }
    }

    return workouts;
  }

  /**
   * Strava doesn't track sleep
   */
  async fetchSleep(token: string, dateRange: DateRange): Promise<RawSleep[]> {
    return [];
  }

  /**
   * Strava doesn't track body measurements
   */
  async fetchBody(token: string, dateRange: DateRange): Promise<RawBody[]> {
    return [];
  }

  /**
   * Fetch heart rate data from workouts
   */
  async fetchHeart(token: string, dateRange: DateRange): Promise<RawHeart[]> {
    const workouts = await this.fetchWorkouts(token, dateRange);

    // Extract heart rate data from workouts that have it
    return workouts
      .filter(w => w.avgHeartRate)
      .map(w => ({
        recordedAt: w.startTime,
        heartRateBpm: w.avgHeartRate,
      }));
  }

  /**
   * Get user profile
   */
  async getUserProfile(token: string): Promise<{ id: string; email?: string; name?: string }> {
    await this.checkRateLimit();

    const data = await this.apiRequest<any>(token, '/athlete');

    return {
      id: data.id.toString(),
      name: `${data.firstname} ${data.lastname}`.trim(),
    };
  }

  /**
   * Verify Strava webhook
   * Strava uses a different verification mechanism for webhook subscription
   */
  verifyWebhook(signature: string, payload: string): boolean {
    // Strava webhook validation is done via subscription verification
    // The actual events don't have signatures, but we verify via the subscription
    return true;
  }

  /**
   * Parse Strava webhook payload
   */
  parseWebhookPayload(payload: any): { userId: string; dataType: string; data?: any } {
    return {
      userId: payload.owner_id?.toString(),
      dataType: payload.object_type === 'activity' ? 'workout' : payload.object_type,
      data: payload,
    };
  }

  // =====================================
  // Normalization helpers
  // =====================================

  private normalizeWorkout(raw: any): RawWorkout {
    return {
      sourceRecordId: raw.id.toString(),
      workoutType: this.mapWorkoutType(raw.type || raw.sport_type || 'other'),
      startTime: new Date(raw.start_date),
      endTime: raw.start_date && raw.elapsed_time
        ? new Date(new Date(raw.start_date).getTime() + raw.elapsed_time * 1000)
        : undefined,
      durationSeconds: raw.moving_time || raw.elapsed_time,
      caloriesBurned: raw.calories || this.estimateCalories(raw),
      distanceMeters: raw.distance,
      avgHeartRate: raw.average_heartrate,
      maxHeartRate: raw.max_heartrate,
      hasGpsData: raw.start_latlng && raw.start_latlng.length === 2,
      gpsPolyline: raw.map?.summary_polyline,
      raw,
    };
  }

  /**
   * Estimate calories if not provided (using MET values)
   */
  private estimateCalories(activity: any): number | undefined {
    if (!activity.moving_time) return undefined;

    // MET values for common activities
    const metValues: Record<string, number> = {
      Run: 9.8,
      Ride: 7.5,
      Walk: 3.5,
      Hike: 6.0,
      Swim: 8.0,
      WeightTraining: 5.0,
      Yoga: 2.5,
      Workout: 5.0,
    };

    const met = metValues[activity.type] || 5.0;
    const hours = activity.moving_time / 3600;
    // Assume 70kg average weight if not known
    const weightKg = 70;

    return Math.round(met * weightKg * hours);
  }

  // =====================================
  // Rate limiting
  // =====================================

  private async checkRateLimit(): Promise<void> {
    const now = Date.now();
    const fifteenMinMs = 15 * 60 * 1000;
    const dayMs = 24 * 60 * 60 * 1000;

    // Reset 15-minute window
    if (now - this.requestWindowStart > fifteenMinMs) {
      this.requestCount = 0;
      this.requestWindowStart = now;
    }

    // Reset daily window
    if (now - this.dailyWindowStart > dayMs) {
      this.dailyRequestCount = 0;
      this.dailyWindowStart = now;
    }

    // Check 15-minute limit (100 requests)
    if (this.requestCount >= 95) {
      const waitTime = fifteenMinMs - (now - this.requestWindowStart);
      console.warn(`Strava 15-min rate limit approaching, waiting ${Math.round(waitTime / 1000)}s`);
      await this.sleep(waitTime);
      this.requestCount = 0;
      this.requestWindowStart = Date.now();
    }

    // Check daily limit (1000 requests)
    if (this.dailyRequestCount >= 990) {
      const waitTime = dayMs - (now - this.dailyWindowStart);
      console.warn(`Strava daily rate limit approaching, waiting ${Math.round(waitTime / 1000)}s`);
      await this.sleep(waitTime);
      this.dailyRequestCount = 0;
      this.dailyWindowStart = Date.now();
    }

    this.requestCount++;
    this.dailyRequestCount++;
  }

  /**
   * Map Strava activity types to normalized types
   */
  protected mapWorkoutType(stravaType: string): string {
    const mapping: Record<string, string> = {
      'Run': 'running',
      'TrailRun': 'running',
      'VirtualRun': 'running',
      'Ride': 'cycling',
      'MountainBikeRide': 'cycling',
      'GravelRide': 'cycling',
      'EBikeRide': 'cycling',
      'VirtualRide': 'cycling',
      'Walk': 'walking',
      'Hike': 'hiking',
      'Swim': 'swimming',
      'WeightTraining': 'strength',
      'Workout': 'strength',
      'Yoga': 'yoga',
      'Rowing': 'rowing',
      'Elliptical': 'elliptical',
      'StairStepper': 'other',
      'Crossfit': 'crossfit',
      'RockClimbing': 'other',
      'NordicSki': 'other',
      'AlpineSki': 'other',
      'Snowboard': 'other',
      'IceSkate': 'other',
      'Skateboard': 'other',
      'InlineSkate': 'other',
      'Surfing': 'other',
      'Kitesurf': 'other',
      'Windsurf': 'other',
      'Golf': 'other',
      'Tennis': 'other',
      'Badminton': 'other',
      'Pickleball': 'other',
      'Soccer': 'other',
      'Basketball': 'other',
    };

    return mapping[stravaType] || super.mapWorkoutType(stravaType);
  }
}

// Export singleton instance
export const stravaProvider = new StravaProvider();
