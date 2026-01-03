/**
 * LiveAvatar Streaming Service
 *
 * Centralized service for HeyGen LiveAvatar API.
 * All avatar features in the app should use this service.
 *
 * SECURITY: API key is NEVER exposed to frontend.
 * Frontend receives only session tokens.
 *
 * @see https://docs.liveavatar.com
 * @see https://www.liveavatar.com
 */

import axios, { AxiosError, AxiosInstance } from 'axios';

// ============================================================
// TYPES & INTERFACES
// ============================================================

export interface StreamingAvatar {
  avatar_id: string;
  pose_name: string;
  normal_preview: string;
  default_voice: string;
  is_public: boolean;
  status: string;
  created_at: number;
}

export interface StreamingAvatarListResponse {
  code: number;
  message: string;
  data: StreamingAvatar[];
}

export interface SessionTokenResponse {
  error: null | { code: string; message: string };
  data: {
    token: string;
  };
}

export interface VoiceSetting {
  voice_id?: string;
  rate?: number; // 0.5 - 1.5
  emotion?: 'EXCITED' | 'SERIOUS' | 'FRIENDLY' | 'SOOTHING' | 'BROADCASTER';
}

export interface NewSessionRequest {
  quality?: 'high' | 'medium' | 'low';
  avatar_id?: string;
  voice?: VoiceSetting;
  version?: 'v2';
  activity_idle_timeout?: number; // 30-3600 seconds
  knowledge_base_id?: string;
}

export interface NewSessionResponse {
  code: number;
  message: string;
  data: {
    session_id: string;
    url: string;
    access_token: string;
    session_duration_limit: number;
    is_paid: boolean;
  };
}

export interface HeyGenError {
  code: string;
  message: string;
  statusCode?: number;
}

// ============================================================
// CONFIGURATION
// ============================================================

// LiveAvatar API (new) - uses different base URL than old HeyGen Streaming API
const LIVEAVATAR_API_BASE = 'https://api.liveavatar.com/v1';

// Legacy HeyGen API (fallback)
const HEYGEN_STREAMING_BASE = 'https://api.heygen.com';

const DEFAULT_TIMEOUT = 30000; // 30 seconds
const RETRY_ATTEMPTS = 3;
const RETRY_DELAY_MS = 1000;

// ============================================================
// API KEY VALIDATION
// ============================================================

/**
 * Get and validate the HeyGen API key from environment
 * @throws Error if key is missing or invalid
 */
function getApiKey(): string {
  const apiKey = process.env.HEYGEN_API_KEY;

  if (!apiKey) {
    throw new Error('HEYGEN_API_KEY environment variable is not set');
  }

  if (apiKey.length < 20) {
    throw new Error('HEYGEN_API_KEY appears invalid (too short)');
  }

  // Prevent placeholder values
  const invalidPatterns = ['test', 'demo', 'placeholder', 'your_api_key', 'xxx'];
  if (invalidPatterns.some(p => apiKey.toLowerCase().includes(p))) {
    throw new Error('HEYGEN_API_KEY appears to be a placeholder value');
  }

  return apiKey;
}

// ============================================================
// HTTP CLIENT WITH RETRY
// ============================================================

/**
 * Create HTTP client for LiveAvatar API
 */
function createLiveAvatarClient(): AxiosInstance {
  return axios.create({
    baseURL: LIVEAVATAR_API_BASE,
    timeout: DEFAULT_TIMEOUT,
    headers: {
      'Content-Type': 'application/json',
      'X-API-KEY': getApiKey(),
    },
  });
}

/**
 * Create HTTP client for legacy HeyGen Streaming API (fallback)
 */
function createHttpClient(): AxiosInstance {
  return axios.create({
    baseURL: HEYGEN_STREAMING_BASE,
    timeout: DEFAULT_TIMEOUT,
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': getApiKey(),
    },
  });
}

/**
 * Execute request with exponential backoff retry
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  attempts: number = RETRY_ATTEMPTS
): Promise<T> {
  let lastError: Error | null = null;

  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;

      // Don't retry on auth errors
      if (error instanceof AxiosError && error.response?.status === 401) {
        throw error;
      }

      // Don't retry on client errors (4xx)
      if (error instanceof AxiosError && error.response?.status && error.response.status >= 400 && error.response.status < 500) {
        throw error;
      }

      // Wait before retry with exponential backoff
      if (i < attempts - 1) {
        const delay = RETRY_DELAY_MS * Math.pow(2, i);
        console.log(`[heygen-streaming] Retry ${i + 1}/${attempts} after ${delay}ms`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError;
}

/**
 * Map API errors to safe error messages (no secrets leaked)
 */
function mapError(error: unknown): HeyGenError {
  if (error instanceof AxiosError) {
    const status = error.response?.status;
    const data = error.response?.data;

    // Log full error server-side only
    console.error('[heygen-streaming] API Error:', {
      status,
      message: data?.message || error.message,
      code: data?.error?.code,
    });

    // Return safe error for client
    switch (status) {
      case 401:
        return {
          code: 'UNAUTHORIZED',
          message: 'Avatar service authentication failed. Please contact support.',
          statusCode: 401,
        };
      case 403:
        return {
          code: 'FORBIDDEN',
          message: 'Avatar service access denied.',
          statusCode: 403,
        };
      case 429:
        return {
          code: 'RATE_LIMITED',
          message: 'Too many requests. Please try again in a moment.',
          statusCode: 429,
        };
      case 500:
      case 502:
      case 503:
        return {
          code: 'SERVICE_UNAVAILABLE',
          message: 'Avatar service is temporarily unavailable. Please try again.',
          statusCode: status,
        };
      default:
        return {
          code: 'API_ERROR',
          message: 'Avatar service error. Please try again.',
          statusCode: status || 500,
        };
    }
  }

  console.error('[heygen-streaming] Unknown error:', error);
  return {
    code: 'UNKNOWN_ERROR',
    message: 'An unexpected error occurred.',
    statusCode: 500,
  };
}

// ============================================================
// PUBLIC API FUNCTIONS
// ============================================================

/**
 * List all available streaming avatars
 * @returns Array of available avatars
 */
export async function listStreamingAvatars(): Promise<StreamingAvatar[]> {
  console.log('[heygen-streaming] Fetching available avatars...');

  try {
    const client = createHttpClient();
    const response = await withRetry(() =>
      client.get<StreamingAvatarListResponse>('/v1/streaming/avatar.list')
    );

    const avatars = response.data.data || [];
    console.log(`[heygen-streaming] Found ${avatars.length} avatars`);

    // Filter to only active avatars
    return avatars.filter(a => a.status === 'ACTIVE' || !a.status);
  } catch (error) {
    const mappedError = mapError(error);
    throw new Error(mappedError.message);
  }
}

/**
 * LiveAvatar session token response
 */
interface LiveAvatarTokenResponse {
  session_id: string;
  session_token: string;
}

/**
 * Create a session token for frontend SDK using LiveAvatar API
 * @returns Session token and session ID for frontend use
 */
export async function createSessionToken(): Promise<string> {
  console.log('[liveavatar] Creating session token...');

  const avatarId = process.env.HEYGEN_AVATAR_ID;
  const voiceId = process.env.HEYGEN_VOICE_ID;

  try {
    const client = createLiveAvatarClient();

    // LiveAvatar API: POST /sessions/token
    const requestBody = {
      mode: 'CUSTOM', // CUSTOM mode: we control what avatar says
      avatar_id: avatarId || undefined,
      voice_id: voiceId || undefined,
      language: 'en',
    };

    console.log('[liveavatar] Request body:', JSON.stringify(requestBody));

    const response = await withRetry(() =>
      client.post<LiveAvatarTokenResponse>('/sessions/token', requestBody)
    );

    // Log the full response to debug
    console.log('[liveavatar] Full API response:', JSON.stringify(response.data));

    // Try different possible response formats
    const sessionToken = response.data.session_token
      || (response.data as any).token
      || (response.data as any).data?.session_token
      || (response.data as any).data?.token;

    if (!sessionToken) {
      console.error('[liveavatar] Response structure:', Object.keys(response.data));
      throw new Error('No session_token returned from API');
    }

    console.log('[liveavatar] Session token created successfully', {
      session_id: response.data.session_id || (response.data as any).data?.session_id,
    });

    return sessionToken;
  } catch (error) {
    // Log the full error details
    if (error instanceof AxiosError) {
      console.error('[liveavatar] API Error:', {
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: JSON.stringify(error.response?.data),
        message: error.message,
      });
    } else {
      console.error('[liveavatar] Error:', error);
    }

    console.log('[liveavatar] Token creation failed, trying legacy HeyGen API...');

    // Fallback to legacy HeyGen Streaming API
    try {
      const legacyClient = createHttpClient();
      const response = await withRetry(() =>
        legacyClient.post<SessionTokenResponse>('/v1/streaming.create_token')
      );

      if (response.data.error) {
        throw new Error(response.data.error.message || 'Token creation failed');
      }

      const token = response.data.data?.token;
      if (!token) {
        throw new Error('No token returned from API');
      }

      console.log('[heygen-streaming] Legacy session token created successfully');
      return token;
    } catch (legacyError) {
      const mappedError = mapError(error);
      throw new Error(mappedError.message);
    }
  }
}

/**
 * Create a new streaming avatar session
 * Returns session details including WebSocket URL and access token
 */
export async function createSession(
  options: NewSessionRequest = {}
): Promise<NewSessionResponse['data']> {
  console.log('[heygen-streaming] Creating new session...', {
    quality: options.quality || 'medium',
    avatar_id: options.avatar_id || 'default',
  });

  try {
    const client = createHttpClient();
    const response = await withRetry(() =>
      client.post<NewSessionResponse>('/v1/streaming.new', {
        quality: options.quality || 'medium',
        avatar_id: options.avatar_id,
        voice: options.voice,
        version: 'v2',
        activity_idle_timeout: options.activity_idle_timeout || 120,
        knowledge_base_id: options.knowledge_base_id,
      })
    );

    const session = response.data.data;
    if (!session?.session_id) {
      throw new Error('No session data returned from API');
    }

    console.log('[heygen-streaming] Session created:', {
      session_id: session.session_id,
      duration_limit: session.session_duration_limit,
      is_paid: session.is_paid,
    });

    return session;
  } catch (error) {
    const mappedError = mapError(error);
    throw new Error(mappedError.message);
  }
}

/**
 * Check if HeyGen Streaming API is properly configured
 */
export function isConfigured(): boolean {
  try {
    getApiKey();
    return true;
  } catch {
    return false;
  }
}

/**
 * Get configuration status (safe for logging/debugging)
 */
export function getConfigStatus(): {
  hasApiKey: boolean;
  apiKeyPrefix: string | null;
} {
  const apiKey = process.env.HEYGEN_API_KEY;
  return {
    hasApiKey: !!apiKey && apiKey.length > 20,
    apiKeyPrefix: apiKey ? apiKey.substring(0, 6) + '...' : null,
  };
}

// ============================================================
// SCRIPT GENERATION HELPERS
// ============================================================

/**
 * Validate and sanitize text for avatar speech
 */
export function sanitizeAvatarText(text: string): string {
  if (!text || typeof text !== 'string') {
    throw new Error('Text is required for avatar speech');
  }

  // Remove HTML tags and control characters
  let sanitized = text
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
    .trim();

  if (sanitized.length < 10) {
    throw new Error('Text is too short for avatar speech');
  }

  // Truncate if too long (streaming avatars work best with shorter text)
  if (sanitized.length > 2000) {
    sanitized = sanitized.substring(0, 1950) + '...';
    console.warn('[heygen-streaming] Text truncated to 2000 characters');
  }

  return sanitized;
}

/**
 * Generate a goal coaching script
 */
export function generateGoalCoachingScript(goalData: {
  calories?: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  bmr?: number;
  tdee?: number;
  bmi?: number;
  bmiCategory?: { name: string };
  weeklyChange?: number;
  dailyDelta?: number;
  goalType?: string;
  currentWeight?: number;
  targetWeight?: number;
  totalWeeks?: number;
}, userInputs?: { name?: string }): string {
  const {
    calories = 2000,
    protein = 150,
    carbs = 200,
    fat = 65,
    tdee = 2300,
    bmi = 25,
    bmiCategory = { name: 'Normal' },
    weeklyChange = 0,
    dailyDelta = 0,
    goalType = 'maintain',
    totalWeeks = 0,
  } = goalData || {};

  const name = userInputs?.name || 'there';
  const goalWord = goalType === 'lose' ? 'lose weight' : goalType === 'gain' ? 'build muscle' : 'maintain your weight';
  const absWeekly = Math.abs(weeklyChange).toFixed(2);
  const absDelta = Math.abs(Math.round(dailyDelta));

  let script = `Hey ${name}! Congratulations on setting up your personalized nutrition plan.\n\n`;

  script += `Your BMI is ${bmi.toFixed(1)}, in the "${bmiCategory.name}" category. `;

  if (goalType === 'lose') {
    script += `Since you're looking to lose weight, focus on how you feel, not just the scale.\n\n`;
  } else if (goalType === 'gain') {
    script += `As you build muscle, your BMI will increase, and that's healthy.\n\n`;
  } else {
    script += `For maintenance, consistency is key.\n\n`;
  }

  script += `Your body burns about ${tdee.toLocaleString()} calories daily. `;

  if (goalType !== 'maintain') {
    script += `You'll eat ${calories.toLocaleString()} calories with a ${absDelta} calorie ${dailyDelta < 0 ? 'deficit' : 'surplus'}, `;
    script += `losing about ${absWeekly} pounds per week over ${Math.round(totalWeeks)} weeks.\n\n`;
  } else {
    script += `At ${calories.toLocaleString()} calories, you'll maintain your weight.\n\n`;
  }

  script += `Your macros: ${protein}g protein, ${carbs}g carbs, ${fat}g fat. `;
  script += `Protein is especially important for your goals.\n\n`;

  script += `Remember: Consistency beats perfection. Track your food, hit your protein, and trust the process. You've got this!`;

  return script;
}

/**
 * Generate a meal plan coaching script
 */
export function generateMealPlanCoachingScript(plan: {
  days?: Array<{ meals?: Array<{ dishName?: string }> }>;
  shoppingList?: Array<unknown>;
}, targets?: {
  calories?: number;
  protein?: number;
  carbs?: number;
  fat?: number;
}): string {
  const calories = targets?.calories || 2000;
  const protein = targets?.protein || 150;
  const carbs = targets?.carbs || 200;
  const fat = targets?.fat || 65;

  const days = plan?.days || [];
  const totalMeals = days.reduce((sum, day) => sum + (day.meals?.length || 0), 0);
  const shoppingItems = plan?.shoppingList?.length || 0;

  // Get meal highlights
  const mealHighlights: string[] = [];
  for (let i = 0; i < Math.min(3, days.length); i++) {
    const day = days[i];
    if (day.meals && day.meals.length > 0) {
      const randomMeal = day.meals[Math.floor(Math.random() * day.meals.length)];
      if (randomMeal?.dishName && !mealHighlights.includes(randomMeal.dishName)) {
        mealHighlights.push(randomMeal.dishName);
      }
    }
  }

  let script = `Hey there! I'm excited to walk you through your personalized 7-day meal plan.\n\n`;

  script += `Your plan targets ${calories.toLocaleString()} calories per day, with ${protein}g protein, ${carbs}g carbs, and ${fat}g fat.\n\n`;

  script += `Over the next 7 days, you'll enjoy ${totalMeals} delicious meals. `;

  if (mealHighlights.length > 0) {
    script += `Highlights include ${mealHighlights.join(', ')}.\n\n`;
  } else {
    script += `Each day has breakfast, lunch, and dinner.\n\n`;
  }

  if (shoppingItems > 0) {
    script += `Your shopping list has ${shoppingItems} items. Order through Instacart with one tap!\n\n`;
  }

  script += `Tips: Prep on Sunday, aim for within 100 calories of target, and stay hydrated.\n\n`;

  script += `You've got this! Each meal is a step toward your goals.`;

  return script;
}
