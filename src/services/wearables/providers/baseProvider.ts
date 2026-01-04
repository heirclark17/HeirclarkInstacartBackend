// src/services/wearables/providers/baseProvider.ts
// Base interface and abstract class for wearable providers

import type {
  SourceType,
  DateRange,
  ActivityData,
  WorkoutData,
  SleepData,
  BodyData,
  HeartData,
} from '../types';

/**
 * Raw data from provider (before normalization)
 */
export interface RawActivity {
  sourceRecordId: string;
  recordedDate: Date;
  steps?: number;
  activeCalories?: number;
  restingCalories?: number;
  totalCalories?: number;
  distanceMeters?: number;
  floorsClimbed?: number;
  activeMinutes?: number;
  raw?: any; // Original provider response
}

export interface RawWorkout {
  sourceRecordId: string;
  workoutType: string;
  startTime: Date;
  endTime?: Date;
  durationSeconds?: number;
  caloriesBurned?: number;
  distanceMeters?: number;
  avgHeartRate?: number;
  maxHeartRate?: number;
  hasGpsData?: boolean;
  gpsPolyline?: string;
  raw?: any;
}

export interface RawSleep {
  sourceRecordId: string;
  sleepDate: Date;
  bedTime?: Date;
  wakeTime?: Date;
  totalSleepMinutes?: number;
  deepSleepMinutes?: number;
  lightSleepMinutes?: number;
  remSleepMinutes?: number;
  awakeMinutes?: number;
  sleepScore?: number;
  raw?: any;
}

export interface RawBody {
  sourceRecordId: string;
  recordedAt: Date;
  weightKg?: number;
  bodyFatPercent?: number;
  muscleMassKg?: number;
  boneMassKg?: number;
  waterPercent?: number;
  bmi?: number;
  raw?: any;
}

export interface RawHeart {
  recordedAt: Date;
  heartRateBpm?: number;
  restingHeartRate?: number;
  hrvRmssd?: number;
  recoveryScore?: number;
  strainScore?: number;
  raw?: any;
}

/**
 * Provider capabilities
 */
export interface ProviderCapabilities {
  activity: boolean;
  workout: boolean;
  sleep: boolean;
  body: boolean;
  heart: boolean;
  hrv: boolean;
  webhook: boolean;
  historicalData: boolean;
  realtime: boolean;
}

/**
 * Rate limit info
 */
export interface RateLimitInfo {
  requestsPerHour?: number;
  requestsPerDay?: number;
  requestsPerMinute?: number;
  retryAfterSeconds?: number;
}

/**
 * Provider interface - all wearable providers must implement this
 */
export interface IWearableProvider {
  /** Provider identifier */
  readonly sourceType: SourceType;

  /** Provider display name */
  readonly name: string;

  /** Provider capabilities */
  readonly capabilities: ProviderCapabilities;

  /** Rate limit configuration */
  readonly rateLimit: RateLimitInfo;

  /**
   * Fetch activity data (steps, calories, distance)
   */
  fetchActivities(token: string, dateRange: DateRange): Promise<RawActivity[]>;

  /**
   * Fetch workout/exercise data
   */
  fetchWorkouts(token: string, dateRange: DateRange): Promise<RawWorkout[]>;

  /**
   * Fetch sleep data
   */
  fetchSleep(token: string, dateRange: DateRange): Promise<RawSleep[]>;

  /**
   * Fetch body measurements (weight, body fat, etc.)
   */
  fetchBody(token: string, dateRange: DateRange): Promise<RawBody[]>;

  /**
   * Fetch heart rate / HRV data
   */
  fetchHeart(token: string, dateRange: DateRange): Promise<RawHeart[]>;

  /**
   * Get user profile from provider
   */
  getUserProfile(token: string): Promise<{ id: string; email?: string; name?: string }>;

  /**
   * Verify webhook signature (if supported)
   */
  verifyWebhook?(signature: string, payload: string): boolean;

  /**
   * Parse webhook payload (if supported)
   */
  parseWebhookPayload?(payload: any): {
    userId: string;
    dataType: string;
    data?: any;
  };
}

/**
 * Abstract base class with common functionality
 */
export abstract class BaseWearableProvider implements IWearableProvider {
  abstract readonly sourceType: SourceType;
  abstract readonly name: string;
  abstract readonly capabilities: ProviderCapabilities;
  abstract readonly rateLimit: RateLimitInfo;

  protected baseUrl: string = '';

  /**
   * Make authenticated API request with error handling
   */
  protected async apiRequest<T>(
    token: string,
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = endpoint.startsWith('http') ? endpoint : `${this.baseUrl}${endpoint}`;

    const response = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    // Handle rate limiting
    if (response.status === 429) {
      const retryAfter = response.headers.get('Retry-After');
      throw new RateLimitError(
        `Rate limit exceeded for ${this.name}`,
        retryAfter ? parseInt(retryAfter) : 60
      );
    }

    // Handle auth errors
    if (response.status === 401) {
      throw new AuthError(`Authentication failed for ${this.name} - token may be expired`);
    }

    if (response.status === 403) {
      throw new AuthError(`Access denied for ${this.name} - insufficient permissions`);
    }

    if (!response.ok) {
      const errorText = await response.text();
      throw new ProviderError(
        `${this.name} API error (${response.status}): ${errorText}`,
        response.status
      );
    }

    return response.json();
  }

  /**
   * Format date for API requests (YYYY-MM-DD)
   */
  protected formatDate(date: Date): string {
    return date.toISOString().split('T')[0];
  }

  /**
   * Get array of dates between start and end (inclusive)
   */
  protected getDatesBetween(start: Date, end: Date): Date[] {
    const dates: Date[] = [];
    const current = new Date(start);
    current.setHours(0, 0, 0, 0);
    const endDate = new Date(end);
    endDate.setHours(0, 0, 0, 0);

    while (current <= endDate) {
      dates.push(new Date(current));
      current.setDate(current.getDate() + 1);
    }

    return dates;
  }

  /**
   * Sleep helper for rate limiting
   */
  protected sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Map provider workout type to normalized type
   */
  protected mapWorkoutType(providerType: string): string {
    const mapping: Record<string, string> = {
      // Common mappings
      run: 'running',
      running: 'running',
      walk: 'walking',
      walking: 'walking',
      bike: 'cycling',
      cycling: 'cycling',
      ride: 'cycling',
      swim: 'swimming',
      swimming: 'swimming',
      weights: 'strength',
      strength: 'strength',
      weighttraining: 'strength',
      yoga: 'yoga',
      hike: 'hiking',
      hiking: 'hiking',
      elliptical: 'elliptical',
      rowing: 'rowing',
      crossfit: 'crossfit',
    };

    const normalized = providerType.toLowerCase().replace(/[^a-z]/g, '');
    return mapping[normalized] || 'other';
  }

  // Default implementations - providers override as needed

  async fetchActivities(token: string, dateRange: DateRange): Promise<RawActivity[]> {
    if (!this.capabilities.activity) {
      return [];
    }
    throw new Error(`fetchActivities not implemented for ${this.name}`);
  }

  async fetchWorkouts(token: string, dateRange: DateRange): Promise<RawWorkout[]> {
    if (!this.capabilities.workout) {
      return [];
    }
    throw new Error(`fetchWorkouts not implemented for ${this.name}`);
  }

  async fetchSleep(token: string, dateRange: DateRange): Promise<RawSleep[]> {
    if (!this.capabilities.sleep) {
      return [];
    }
    throw new Error(`fetchSleep not implemented for ${this.name}`);
  }

  async fetchBody(token: string, dateRange: DateRange): Promise<RawBody[]> {
    if (!this.capabilities.body) {
      return [];
    }
    throw new Error(`fetchBody not implemented for ${this.name}`);
  }

  async fetchHeart(token: string, dateRange: DateRange): Promise<RawHeart[]> {
    if (!this.capabilities.heart) {
      return [];
    }
    throw new Error(`fetchHeart not implemented for ${this.name}`);
  }

  async getUserProfile(token: string): Promise<{ id: string; email?: string; name?: string }> {
    throw new Error(`getUserProfile not implemented for ${this.name}`);
  }
}

/**
 * Custom error types for provider operations
 */
export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

export class RateLimitError extends ProviderError {
  constructor(
    message: string,
    public readonly retryAfterSeconds: number
  ) {
    super(message, 429);
    this.name = 'RateLimitError';
  }
}

export class AuthError extends ProviderError {
  constructor(message: string) {
    super(message, 401);
    this.name = 'AuthError';
  }
}

/**
 * Normalize raw data to our schema format
 */
export function normalizeActivity(
  customerId: string,
  sourceType: SourceType,
  raw: RawActivity
): ActivityData {
  return {
    customerId,
    sourceType,
    sourceRecordId: raw.sourceRecordId,
    recordedDate: raw.recordedDate.toISOString().split('T')[0],
    steps: raw.steps,
    activeCalories: raw.activeCalories,
    restingCalories: raw.restingCalories,
    totalCalories: raw.totalCalories,
    distanceMeters: raw.distanceMeters,
    floorsClimbed: raw.floorsClimbed,
    activeMinutes: raw.activeMinutes,
  };
}

export function normalizeWorkout(
  customerId: string,
  sourceType: SourceType,
  raw: RawWorkout
): WorkoutData {
  return {
    customerId,
    sourceType,
    sourceRecordId: raw.sourceRecordId,
    workoutType: raw.workoutType,
    startTime: raw.startTime,
    endTime: raw.endTime,
    durationSeconds: raw.durationSeconds,
    caloriesBurned: raw.caloriesBurned,
    distanceMeters: raw.distanceMeters,
    avgHeartRate: raw.avgHeartRate,
    maxHeartRate: raw.maxHeartRate,
    hasGpsData: raw.hasGpsData,
    gpsPolyline: raw.gpsPolyline,
  };
}

export function normalizeSleep(
  customerId: string,
  sourceType: SourceType,
  raw: RawSleep
): SleepData {
  return {
    customerId,
    sourceType,
    sourceRecordId: raw.sourceRecordId,
    sleepDate: raw.sleepDate.toISOString().split('T')[0],
    bedTime: raw.bedTime,
    wakeTime: raw.wakeTime,
    totalSleepMinutes: raw.totalSleepMinutes,
    deepSleepMinutes: raw.deepSleepMinutes,
    lightSleepMinutes: raw.lightSleepMinutes,
    remSleepMinutes: raw.remSleepMinutes,
    awakeMinutes: raw.awakeMinutes,
    sleepScore: raw.sleepScore,
  };
}

export function normalizeBody(
  customerId: string,
  sourceType: SourceType,
  raw: RawBody
): BodyData {
  return {
    customerId,
    sourceType,
    sourceRecordId: raw.sourceRecordId,
    recordedAt: raw.recordedAt,
    weightKg: raw.weightKg,
    bodyFatPercent: raw.bodyFatPercent,
    muscleMassKg: raw.muscleMassKg,
    boneMassKg: raw.boneMassKg,
    waterPercent: raw.waterPercent,
    bmi: raw.bmi,
  };
}

export function normalizeHeart(
  customerId: string,
  sourceType: SourceType,
  raw: RawHeart
): HeartData {
  return {
    customerId,
    sourceType,
    recordedAt: raw.recordedAt,
    recordedDate: raw.recordedAt.toISOString().split('T')[0],
    heartRateBpm: raw.heartRateBpm,
    restingHeartRate: raw.restingHeartRate,
    hrvRmssd: raw.hrvRmssd,
    recoveryScore: raw.recoveryScore,
    strainScore: raw.strainScore,
  };
}
