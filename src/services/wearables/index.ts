// src/services/wearables/index.ts
// Wearables service exports

export * from './types';
export { tokenManager, TokenManager } from './tokenManager';
export { syncOrchestrator, SyncOrchestrator } from './syncOrchestrator';
export { dedupeService, DedupeService } from './dedupeService';
export {
  BaseWearableProvider,
  IWearableProvider,
  ProviderCapabilities,
  RateLimitInfo,
  RawActivity,
  RawWorkout,
  RawSleep,
  RawBody,
  RawHeart,
  ProviderError,
  RateLimitError,
  AuthError,
  normalizeActivity,
  normalizeWorkout,
  normalizeSleep,
  normalizeBody,
  normalizeHeart,
} from './providers/baseProvider';

// Providers
export { fitbitProvider, FitbitProvider } from './providers/fitbit';
export { stravaProvider, StravaProvider } from './providers/strava';
export { ouraProvider, OuraProvider } from './providers/oura';
export { withingsProvider, WithingsProvider } from './providers/withings';
