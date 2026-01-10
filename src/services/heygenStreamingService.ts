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
import OpenAI from 'openai';

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

// Cached context ID to avoid creating new contexts on every request
let cachedContextId: string | null = null;

/**
 * Get or create a context for the LiveAvatar
 * Context defines how the avatar thinks and responds
 */
async function getOrCreateContext(): Promise<string> {
  // Use cached context if available
  if (cachedContextId) {
    return cachedContextId;
  }

  // HEYGEN_CONTEXT_ID is required - must be created via LiveAvatar web portal
  const envContextId = process.env.HEYGEN_CONTEXT_ID;
  if (envContextId) {
    cachedContextId = envContextId;
    return envContextId;
  }

  // Context ID is required but not set
  throw new Error(
    'HEYGEN_CONTEXT_ID is required. ' +
    'Create a context at https://www.liveavatar.com, then set the context_id as HEYGEN_CONTEXT_ID in Railway.'
  );
}

/**
 * Create a session token for frontend SDK
 * Uses LiveAvatar API (api.liveavatar.com)
 * @returns Session token for frontend use
 */
export async function createSessionToken(): Promise<string> {
  console.log('[liveavatar] Creating session token...');

  const avatarId = process.env.HEYGEN_AVATAR_ID;
  const voiceId = process.env.HEYGEN_VOICE_ID;

  // Validate required configuration
  if (!avatarId) {
    throw new Error('HEYGEN_AVATAR_ID environment variable is not set');
  }
  if (!voiceId) {
    throw new Error('HEYGEN_VOICE_ID environment variable is not set');
  }

  try {
    const client = createLiveAvatarClient();

    // Get or create a context (required for FULL mode)
    const contextId = await getOrCreateContext();

    // LiveAvatar API: POST /sessions/token
    // FULL mode requires: avatar_id, avatar_persona (voice_id, context_id, language)
    const requestBody = {
      mode: 'FULL',  // Required for text-to-speech (avatar.speak_text, avatar.speak_response)
      avatar_id: avatarId,
      avatar_persona: {
        voice_id: voiceId,
        context_id: contextId,
        language: 'en',
      },
    };

    console.log('[liveavatar] Request:', JSON.stringify(requestBody));

    const response = await withRetry(() =>
      client.post<LiveAvatarTokenResponse>('/sessions/token', requestBody)
    );

    console.log('[liveavatar] Response:', JSON.stringify(response.data));

    // Extract token from response
    const sessionToken = response.data.session_token
      || (response.data as any).token
      || (response.data as any).data?.session_token
      || (response.data as any).data?.token;

    if (!sessionToken) {
      console.error('[liveavatar] No token found. Response keys:', Object.keys(response.data));
      throw new Error('No session_token returned from API');
    }

    console.log('[liveavatar] Token created, length:', sessionToken.length);
    return sessionToken;
  } catch (error) {
    if (error instanceof AxiosError) {
      const apiErrorData = error.response?.data;
      console.error('[liveavatar] API Error:', {
        status: error.response?.status,
        data: JSON.stringify(apiErrorData),
        message: error.message,
      });
      // Include API error details in the thrown error for debugging
      const apiErrorMsg = typeof apiErrorData === 'object'
        ? JSON.stringify(apiErrorData)
        : String(apiErrorData);
      throw new Error(`LiveAvatar API ${error.response?.status}: ${apiErrorMsg}`);
    } else {
      console.error('[liveavatar] Error:', error);
    }
    throw error;
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
// OPENAI CLIENT FOR AI-GENERATED SCRIPTS
// ============================================================

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

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
 * Generate a goal coaching script using AI
 * Creates a unique, personalized script for each user based on their specific data
 */
export async function generateGoalCoachingScript(goalData: {
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
}, userInputs?: { name?: string }): Promise<string> {
  const {
    calories = 2000,
    protein = 150,
    carbs = 200,
    fat = 65,
    bmr = 1800,
    tdee = 2300,
    bmi = 25,
    bmiCategory = { name: 'Normal' },
    weeklyChange = 0,
    dailyDelta = 0,
    goalType = 'maintain',
    currentWeight = 0,
    targetWeight = 0,
    totalWeeks = 0,
  } = goalData || {};

  const userName = userInputs?.name || null;

  const systemPrompt = `You are a warm, encouraging AI nutrition coach named Chef Clark for the Heirclark nutrition app. You're about to speak to a user via video avatar, so write conversational spoken text (not written text).

VOICE STYLE:
- Warm, friendly, and confident like a personal trainer who genuinely cares
- Use natural speech patterns with occasional pauses (use commas and periods naturally)
- Vary sentence length - mix short punchy statements with longer explanations
- Be encouraging without being cheesy or over-the-top
- Sound like a real person, not a robot reading a script
- Say numbers naturally (e.g., "twenty-three hundred" not "2,300")

SCRIPT REQUIREMENTS:
- Start with a personalized greeting using the user's name if provided
- Explain their TDEE (daily calorie burn) in relatable terms
- Explain their calorie target and how it relates to their goal
- Break down their macros (protein, carbs, fat) with context on why each matters
- Guide them to the next steps (Generate Meal Plan button OR Save and Start Tracking)
- End with an encouraging, personalized sign-off
- Keep total length between 150-250 words (about 60-90 seconds when spoken)
- NEVER use bullet points, numbered lists, or markdown formatting
- Write everything as flowing, natural speech`;

  const userPrompt = `Generate a unique coaching script for this user:

USER DATA:
- Name: ${userName || 'Not provided (use friendly generic greeting)'}
- Goal Type: ${goalType} (lose weight / gain muscle / maintain)
- Current Weight: ${currentWeight} lbs
- Target Weight: ${targetWeight} lbs
- BMI: ${bmi.toFixed(1)} (${bmiCategory.name})

CALCULATED TARGETS:
- BMR (Basal Metabolic Rate): ${bmr} calories/day
- TDEE (Total Daily Energy Expenditure): ${tdee} calories/day
- Daily Calorie Target: ${calories} calories
- Daily ${dailyDelta < 0 ? 'Deficit' : dailyDelta > 0 ? 'Surplus' : 'Balance'}: ${Math.abs(Math.round(dailyDelta))} calories
- Weekly Weight Change: ${Math.abs(weeklyChange).toFixed(2)} lbs/week
- Estimated Time to Goal: ${Math.round(totalWeeks)} weeks

MACRO TARGETS:
- Protein: ${protein}g per day
- Carbs: ${carbs}g per day
- Fat: ${fat}g per day

Create a unique, conversational script that feels personal to THIS specific user and their goals. Make it sound natural when spoken aloud by a video avatar coach.`;

  try {
    console.log('[heygen-streaming] Generating AI goal coaching script...');

    const completion = await openai.chat.completions.create({
      model: 'gpt-4.1-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.8, // Higher creativity for unique scripts
      max_tokens: 600,
    });

    const script = completion.choices[0]?.message?.content?.trim();

    if (!script || script.length < 50) {
      throw new Error('AI returned empty or too short script');
    }

    console.log('[heygen-streaming] AI script generated successfully, length:', script.length);
    return script;

  } catch (error) {
    console.error('[heygen-streaming] AI script generation failed, using fallback:', error);

    // Fallback to template-based script
    return generateGoalCoachingScriptFallback(goalData, userInputs);
  }
}

/**
 * Fallback template-based goal script (used if AI fails)
 */
function generateGoalCoachingScriptFallback(goalData: {
  calories?: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  tdee?: number;
  weeklyChange?: number;
  dailyDelta?: number;
  goalType?: string;
  totalWeeks?: number;
}, userInputs?: { name?: string }): string {
  const {
    calories = 2000,
    protein = 150,
    carbs = 200,
    fat = 65,
    tdee = 2300,
    weeklyChange = 0,
    dailyDelta = 0,
    goalType = 'maintain',
    totalWeeks = 0,
  } = goalData || {};

  const userName = userInputs?.name;
  const absWeekly = Math.abs(weeklyChange).toFixed(2);
  const absDelta = Math.abs(Math.round(dailyDelta));

  let script = userName ? `Hi ${userName}! ` : `Hey there! `;
  script += `Your body burns about ${tdee.toLocaleString()} calories daily. `;

  if (goalType !== 'maintain') {
    script += `You'll eat ${calories.toLocaleString()} calories with a ${absDelta} calorie ${dailyDelta < 0 ? 'deficit' : 'surplus'}, `;
    script += `${goalType === 'lose' ? 'losing' : 'gaining'} about ${absWeekly} pounds per week over ${Math.round(totalWeeks)} weeks. `;
  } else {
    script += `At ${calories.toLocaleString()} calories, you'll maintain your weight. `;
  }

  script += `Your macros: ${protein} grams of protein, ${carbs} grams of carbs, and ${fat} grams of fat. `;
  script += `Tap Generate Meal Plan to get started, or Save and Start Tracking to begin logging. `;
  script += userName ? `You've got this, ${userName}!` : `You've got this!`;

  return script;
}

/**
 * Generate a meal plan coaching script using AI
 * Creates a unique, personalized script for each user based on their meal plan
 */
export async function generateMealPlanCoachingScript(plan: {
  days?: Array<{ meals?: Array<{ dishName?: string; name?: string; mealType?: string; type?: string; calories?: number }> }>;
  shoppingList?: Array<unknown>;
}, targets?: {
  calories?: number;
  protein?: number;
  carbs?: number;
  fat?: number;
}, userInputs?: { name?: string }): Promise<string> {
  const calories = targets?.calories || 2000;
  const protein = targets?.protein || 150;
  const carbs = targets?.carbs || 200;
  const fat = targets?.fat || 65;
  const userName = userInputs?.name || null;

  const days = plan?.days || [];
  const totalMeals = days.reduce((sum, day) => sum + (day.meals?.length || 0), 0);

  // Extract meal highlights for context
  const mealHighlights: string[] = [];
  for (const day of days.slice(0, 3)) {
    if (day.meals) {
      for (const meal of day.meals.slice(0, 2)) {
        const mealName = meal?.dishName || meal?.name;
        if (mealName && !mealHighlights.includes(mealName)) {
          mealHighlights.push(mealName);
        }
      }
    }
  }

  const systemPrompt = `You are a warm, encouraging AI nutrition coach for the Heirclark nutrition app. You're about to speak to a user via video avatar about their new 7-day meal plan.

VOICE STYLE:
- Warm, friendly, and excited about helping them eat well
- Use natural speech patterns - vary rhythm and sentence length
- Be encouraging and make cooking feel approachable, not intimidating
- Sound genuinely enthusiastic about the meals in their plan
- Speak conversationally as if you're right there with them

SCRIPT REQUIREMENTS:
- Start IMMEDIATELY with a personalized greeting to the user - DO NOT introduce yourself or say your name
- Briefly mention their calorie/macro targets
- Highlight 2-3 specific meals from their plan by name - be genuinely enthusiastic about how delicious they sound
- Explain how to navigate the meal plan (day tabs, tapping meal cards for recipes)
- Mention the Instacart grocery ordering feature
- Give 1-2 practical tips for meal prep success
- End with encouragement personalized to them
- Keep total length between 150-250 words (about 60-90 seconds when spoken)
- NEVER use bullet points, numbered lists, or markdown
- Write flowing, natural speech only`;

  const userPrompt = `Generate a unique coaching script for this user's new meal plan:

USER INFO:
- Name: ${userName || 'Not provided (use friendly generic greeting)'}

DAILY TARGETS:
- Calories: ${calories}
- Protein: ${protein}g
- Carbs: ${carbs}g
- Fat: ${fat}g

MEAL PLAN DETAILS:
- Total Days: ${days.length}
- Total Meals: ${totalMeals}
- Sample Meals: ${mealHighlights.length > 0 ? mealHighlights.join(', ') : 'Various balanced meals'}

Create an excited, personalized script that makes this user feel great about their meal plan and confident they can follow it. Mention at least 2 of the specific meals by name if available. Make it sound natural when spoken by a video avatar.

IMPORTANT: Start immediately with ${userName ? `"Hey ${userName}"` : '"Hey there"'} - NO introduction, NO saying your name, jump straight into greeting the user personally.`;

  try {
    console.log('[heygen-streaming] Generating AI meal plan coaching script...');

    const completion = await openai.chat.completions.create({
      model: 'gpt-4.1-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.8,
      max_tokens: 600,
    });

    const script = completion.choices[0]?.message?.content?.trim();

    if (!script || script.length < 50) {
      throw new Error('AI returned empty or too short script');
    }

    console.log('[heygen-streaming] AI meal plan script generated successfully, length:', script.length);
    return script;

  } catch (error) {
    console.error('[heygen-streaming] AI meal plan script generation failed, using fallback:', error);

    // Fallback to template-based script
    return generateMealPlanCoachingScriptFallback(plan, targets, userInputs);
  }
}

/**
 * Fallback template-based meal plan script (used if AI fails)
 */
function generateMealPlanCoachingScriptFallback(plan: {
  days?: Array<{ meals?: Array<{ dishName?: string; name?: string }> }>;
}, targets?: {
  calories?: number;
  protein?: number;
  carbs?: number;
  fat?: number;
}, userInputs?: { name?: string }): string {
  const calories = targets?.calories || 2000;
  const protein = targets?.protein || 150;
  const carbs = targets?.carbs || 200;
  const fat = targets?.fat || 65;
  const userName = userInputs?.name;

  let script = userName ? `Hi ${userName}! ` : `Hey there! `;
  script += `Your plan is designed for ${calories.toLocaleString()} calories per day, with ${protein} grams of protein, ${carbs} grams of carbs, and ${fat} grams of fat. `;
  script += `Use the day tabs at the top to navigate between days. Tap any meal card to see the full recipe. `;
  script += `When you're ready to shop, hit the green Order Groceries button to send everything to Instacart. `;
  script += userName ? `You've got this, ${userName}!` : `You've got this!`;

  return script;
}
