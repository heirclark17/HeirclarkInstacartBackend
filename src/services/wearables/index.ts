// src/services/wearables/index.ts
// Wearables service exports

export * from './types';
export { tokenManager, TokenManager } from './tokenManager';
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
