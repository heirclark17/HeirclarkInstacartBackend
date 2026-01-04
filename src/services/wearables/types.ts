// src/services/wearables/types.ts
// Type definitions for wearables integration

/**
 * Supported wearable data sources
 */
export type SourceType =
  | 'apple_health'
  | 'health_connect'
  | 'fitbit'
  | 'garmin'
  | 'strava'
  | 'oura'
  | 'whoop'
  | 'withings'
  | 'manual';

/**
 * Data types that can be synced from wearables
 */
export type DataType =
  | 'steps'
  | 'calories'
  | 'distance'
  | 'sleep'
  | 'weight'
  | 'heart_rate'
  | 'hrv'
  | 'workout';

/**
 * Sync status values
 */
export type SyncStatus = 'success' | 'partial' | 'failed' | 'pending';

/**
 * Sync type values
 */
export type SyncType = 'full' | 'incremental' | 'manual' | 'webhook';

/**
 * Workout type mapping (normalized)
 */
export type WorkoutType =
  | 'running'
  | 'walking'
  | 'cycling'
  | 'swimming'
  | 'hiking'
  | 'strength'
  | 'yoga'
  | 'elliptical'
  | 'rowing'
  | 'crossfit'
  | 'other';

/**
 * OAuth token set
 */
export interface TokenSet {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
  scopes?: string[];
  tokenType?: string;
}

/**
 * Connected source from database
 */
export interface ConnectedSource {
  id: string;
  customerId: string;
  sourceType: SourceType;
  sourceUserId?: string;
  scopesGranted: string[];
  isPrimarySource: boolean;
  syncEnabled: boolean;
  lastSyncAt?: Date;
  lastSyncStatus?: SyncStatus;
  lastError?: string;
  connectedAt: Date;
  disconnectedAt?: Date;
  tokenExpiresAt?: Date;
}

/**
 * Connected source with decrypted tokens (internal use only)
 */
export interface ConnectedSourceWithTokens extends ConnectedSource {
  accessToken: string;
  refreshToken?: string;
}

/**
 * Source priority configuration
 */
export interface SourcePriority {
  customerId: string;
  dataType: DataType;
  priorityOrder: SourceType[];
}

/**
 * Date range for sync operations
 */
export interface DateRange {
  start: Date;
  end: Date;
}

/**
 * Sync options
 */
export interface SyncOptions {
  sourceType?: SourceType;
  dataTypes?: DataType[];
  dateRange?: DateRange;
  force?: boolean;
}

/**
 * Sync result
 */
export interface SyncResult {
  syncId: string;
  customerId: string;
  sourceType: SourceType;
  status: SyncStatus;
  recordsFetched: number;
  recordsInserted: number;
  recordsUpdated: number;
  recordsDeduped: number;
  startedAt: Date;
  completedAt?: Date;
  error?: string;
}

/**
 * Normalized activity data
 */
export interface ActivityData {
  id?: string;
  customerId: string;
  sourceType: SourceType;
  sourceRecordId?: string;
  recordedDate: string; // YYYY-MM-DD
  startTime?: Date;
  endTime?: Date;
  steps?: number;
  activeCalories?: number;
  restingCalories?: number;
  totalCalories?: number;
  distanceMeters?: number;
  floorsClimbed?: number;
  activeMinutes?: number;
  isPrimary?: boolean;
  dedupeGroupId?: string;
}

/**
 * Normalized workout data
 */
export interface WorkoutData {
  id?: string;
  customerId: string;
  sourceType: SourceType;
  sourceRecordId?: string;
  workoutType: WorkoutType | string;
  startTime: Date;
  endTime?: Date;
  durationSeconds?: number;
  caloriesBurned?: number;
  distanceMeters?: number;
  avgHeartRate?: number;
  maxHeartRate?: number;
  hasGpsData?: boolean;
  gpsPolyline?: string;
  sourceMetadata?: Record<string, any>;
  isPrimary?: boolean;
  dedupeGroupId?: string;
}

/**
 * Normalized sleep data
 */
export interface SleepData {
  id?: string;
  customerId: string;
  sourceType: SourceType;
  sourceRecordId?: string;
  sleepDate: string; // YYYY-MM-DD
  bedTime?: Date;
  wakeTime?: Date;
  totalSleepMinutes?: number;
  deepSleepMinutes?: number;
  lightSleepMinutes?: number;
  remSleepMinutes?: number;
  awakeMinutes?: number;
  sleepScore?: number; // 0-100
  isPrimary?: boolean;
  dedupeGroupId?: string;
}

/**
 * Normalized body measurements
 */
export interface BodyData {
  id?: string;
  customerId: string;
  sourceType: SourceType;
  sourceRecordId?: string;
  recordedAt: Date;
  weightKg?: number;
  bodyFatPercent?: number;
  muscleMassKg?: number;
  boneMassKg?: number;
  waterPercent?: number;
  bmi?: number;
  isPrimary?: boolean;
  dedupeGroupId?: string;
}

/**
 * Heart rate / HRV data
 */
export interface HeartData {
  id?: string;
  customerId: string;
  sourceType: SourceType;
  recordedAt: Date;
  recordedDate: string; // YYYY-MM-DD
  heartRateBpm?: number;
  restingHeartRate?: number;
  hrvRmssd?: number;
  recoveryScore?: number; // 0-100
  strainScore?: number;
}

/**
 * Aggregated daily summary (after dedupe)
 */
export interface DailySummary {
  customerId: string;
  date: string; // YYYY-MM-DD

  // Activity
  steps: number;
  activeCalories: number;
  restingCalories: number;
  totalCalories: number;
  distanceMeters: number;
  activeMinutes: number;

  // Sleep (from previous night)
  sleepMinutes?: number;
  sleepScore?: number;

  // Body (latest)
  weightKg?: number;
  bodyFatPercent?: number;

  // Heart
  restingHeartRate?: number;
  hrvRmssd?: number;
  recoveryScore?: number;

  // Sources used for each metric
  sources: {
    steps?: SourceType;
    calories?: SourceType;
    sleep?: SourceType;
    weight?: SourceType;
    heartRate?: SourceType;
  };
}

/**
 * OAuth configuration for a provider
 */
export interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  authUrl: string;
  tokenUrl: string;
  scopes: string[];
  redirectUri: string;
}

/**
 * OAuth state for CSRF protection
 */
export interface OAuthState {
  customerId: string;
  sourceType: SourceType;
  nonce: string;
  createdAt: Date;
  redirectUri: string;
}

/**
 * Provider metadata for UI
 */
export interface ProviderInfo {
  type: SourceType;
  name: string;
  icon: string;
  description: string;
  dataTypes: DataType[];
  authType: 'oauth' | 'native';
  platform?: 'ios' | 'android' | 'all';
}

/**
 * List of all provider metadata
 */
export const PROVIDER_INFO: ProviderInfo[] = [
  {
    type: 'apple_health',
    name: 'Apple Health',
    icon: 'apple',
    description: 'Steps, Workouts, Sleep, Heart Rate',
    dataTypes: ['steps', 'calories', 'distance', 'sleep', 'weight', 'heart_rate', 'workout'],
    authType: 'native',
    platform: 'ios',
  },
  {
    type: 'health_connect',
    name: 'Health Connect',
    icon: 'google-fit',
    description: 'Steps, Workouts, Sleep, Heart Rate',
    dataTypes: ['steps', 'calories', 'distance', 'sleep', 'weight', 'heart_rate', 'workout'],
    authType: 'native',
    platform: 'android',
  },
  {
    type: 'fitbit',
    name: 'Fitbit',
    icon: 'fitbit',
    description: 'Activity, Sleep, Heart Rate, Weight',
    dataTypes: ['steps', 'calories', 'distance', 'sleep', 'weight', 'heart_rate', 'workout'],
    authType: 'oauth',
    platform: 'all',
  },
  {
    type: 'garmin',
    name: 'Garmin',
    icon: 'garmin',
    description: 'Activity, Workouts, Sleep, Heart Rate',
    dataTypes: ['steps', 'calories', 'distance', 'sleep', 'heart_rate', 'workout'],
    authType: 'oauth',
    platform: 'all',
  },
  {
    type: 'strava',
    name: 'Strava',
    icon: 'strava',
    description: 'Workouts, GPS Activities',
    dataTypes: ['workout', 'calories', 'distance', 'heart_rate'],
    authType: 'oauth',
    platform: 'all',
  },
  {
    type: 'oura',
    name: 'Oura',
    icon: 'oura',
    description: 'Sleep, HRV, Recovery, Activity',
    dataTypes: ['sleep', 'heart_rate', 'hrv', 'steps', 'calories'],
    authType: 'oauth',
    platform: 'all',
  },
  // WHOOP disabled - requires paid API access
  // {
  //   type: 'whoop',
  //   name: 'WHOOP',
  //   icon: 'whoop',
  //   description: 'Recovery, Strain, Sleep, HRV',
  //   dataTypes: ['sleep', 'heart_rate', 'hrv', 'workout', 'calories'],
  //   authType: 'oauth',
  //   platform: 'all',
  // },
  {
    type: 'withings',
    name: 'Withings',
    icon: 'withings',
    description: 'Weight, Body Composition, Activity, Sleep',
    dataTypes: ['weight', 'steps', 'calories', 'distance', 'sleep'],
    authType: 'oauth',
    platform: 'all',
  },
];

/**
 * Get provider info by type
 */
export function getProviderInfo(type: SourceType): ProviderInfo | undefined {
  return PROVIDER_INFO.find(p => p.type === type);
}

/**
 * Check if source type is valid
 */
export function isValidSourceType(type: string): type is SourceType {
  return [
    'apple_health', 'health_connect', 'fitbit', 'garmin',
    'strava', 'oura', 'whoop', 'withings', 'manual'
  ].includes(type);
}

/**
 * Check if data type is valid
 */
export function isValidDataType(type: string): type is DataType {
  return [
    'steps', 'calories', 'distance', 'sleep',
    'weight', 'heart_rate', 'hrv', 'workout'
  ].includes(type);
}
