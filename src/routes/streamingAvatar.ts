/**
 * Streaming Avatar Routes
 *
 * Unified API endpoints for HeyGen Live Avatar integration.
 * These endpoints are used by ALL avatar features across the app.
 *
 * SECURITY:
 * - API key is never exposed to frontend
 * - Session tokens are one-time use
 * - Input validation on all user-provided data
 * - Safe error messages (no secrets leaked)
 *
 * @see https://docs.heygen.com/docs/streaming-api
 */

import { Router, Request, Response } from 'express';
import {
  listStreamingAvatars,
  createSessionToken,
  createSession,
  isConfigured,
  getConfigStatus,
  sanitizeAvatarText,
  generateGoalCoachingScript,
  generateMealPlanCoachingScript,
  StreamingAvatar,
  NewSessionRequest,
} from '../services/heygenStreamingService';
import { videoRateLimitMiddleware } from '../middleware/rateLimiter';

export const streamingAvatarRouter = Router();

// Apply rate limiting to all streaming avatar endpoints
const avatarRateLimit = videoRateLimitMiddleware();

// ============================================================
// INPUT VALIDATION
// ============================================================

const ALLOWED_QUALITIES = ['high', 'medium', 'low'] as const;
const ALLOWED_CONTEXTS = ['goals', 'mealplan', 'general'] as const;

type AvatarQuality = typeof ALLOWED_QUALITIES[number];
type AvatarContext = typeof ALLOWED_CONTEXTS[number];

function validateQuality(quality: unknown): AvatarQuality {
  if (typeof quality === 'string' && ALLOWED_QUALITIES.includes(quality as AvatarQuality)) {
    return quality as AvatarQuality;
  }
  return 'medium'; // default
}

function validateContext(context: unknown): AvatarContext {
  if (typeof context === 'string' && ALLOWED_CONTEXTS.includes(context as AvatarContext)) {
    return context as AvatarContext;
  }
  return 'general'; // default
}

function sanitizeUserId(userId: unknown): string {
  if (!userId || typeof userId !== 'string') {
    return 'guest';
  }
  // Allow alphanumeric, underscore, dash only
  return userId.trim().replace(/[^a-zA-Z0-9_\-]/g, '').substring(0, 255) || 'guest';
}

// ============================================================
// ROUTES
// ============================================================

/**
 * GET /api/v1/avatar/config
 * Check if streaming avatar is configured (for frontend feature flags)
 */
streamingAvatarRouter.get('/config', (_req: Request, res: Response) => {
  const status = getConfigStatus();

  return res.json({
    ok: true,
    configured: status.hasApiKey,
    features: {
      streaming: status.hasApiKey,
      voiceChat: status.hasApiKey,
    },
  });
});

/**
 * GET /api/v1/avatar/avatars
 * List available streaming avatars
 */
streamingAvatarRouter.get('/avatars', avatarRateLimit, async (_req: Request, res: Response) => {
  console.log('[streaming-avatar] Listing avatars...');

  if (!isConfigured()) {
    return res.status(503).json({
      ok: false,
      error: 'Avatar service is not configured',
    });
  }

  try {
    const avatars = await listStreamingAvatars();

    // Return safe subset of avatar data
    const safeAvatars = avatars.map((a: StreamingAvatar) => ({
      id: a.avatar_id,
      name: a.pose_name,
      preview: a.normal_preview,
      defaultVoice: a.default_voice,
    }));

    return res.json({
      ok: true,
      avatars: safeAvatars,
    });
  } catch (error: unknown) {
    console.error('[streaming-avatar] List avatars error:', error);
    return res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : 'Failed to list avatars',
    });
  }
});

/**
 * POST /api/v1/avatar/token
 * Create a one-time session token for frontend SDK
 * This is the ONLY way frontend gets access to HeyGen
 */
streamingAvatarRouter.post('/token', avatarRateLimit, async (req: Request, res: Response) => {
  const { userId: rawUserId } = req.body;
  const userId = sanitizeUserId(rawUserId);

  console.log(`[streaming-avatar] Creating token for user ${userId}`);

  if (!isConfigured()) {
    return res.status(503).json({
      ok: false,
      error: 'Avatar service is not configured',
    });
  }

  try {
    const token = await createSessionToken();

    return res.json({
      ok: true,
      token,
      // Token is one-time use - inform frontend
      oneTimeUse: true,
    });
  } catch (error: unknown) {
    console.error('[streaming-avatar] Create token error:', error);
    return res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : 'Failed to create session token',
    });
  }
});

/**
 * POST /api/v1/avatar/session
 * Create a new streaming avatar session
 * Returns session details for frontend to connect via WebRTC
 */
streamingAvatarRouter.post('/session', avatarRateLimit, async (req: Request, res: Response) => {
  const {
    userId: rawUserId,
    avatarId,
    quality: rawQuality,
    voiceId,
    voiceRate,
    idleTimeout,
  } = req.body;

  const userId = sanitizeUserId(rawUserId);
  const quality = validateQuality(rawQuality);

  console.log(`[streaming-avatar] Creating session for user ${userId}`, {
    avatarId,
    quality,
    voiceId,
  });

  if (!isConfigured()) {
    return res.status(503).json({
      ok: false,
      error: 'Avatar service is not configured',
    });
  }

  try {
    const sessionOptions: NewSessionRequest = {
      quality,
      avatar_id: avatarId,
      activity_idle_timeout: typeof idleTimeout === 'number'
        ? Math.max(30, Math.min(3600, idleTimeout))
        : 120,
    };

    if (voiceId) {
      sessionOptions.voice = {
        voice_id: voiceId,
        rate: typeof voiceRate === 'number' ? Math.max(0.5, Math.min(1.5, voiceRate)) : 1.0,
      };
    }

    const session = await createSession(sessionOptions);

    return res.json({
      ok: true,
      session: {
        sessionId: session.session_id,
        accessToken: session.access_token,
        url: session.url,
        durationLimit: session.session_duration_limit,
        isPaid: session.is_paid,
      },
    });
  } catch (error: unknown) {
    console.error('[streaming-avatar] Create session error:', error);
    return res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : 'Failed to create session',
    });
  }
});

/**
 * POST /api/v1/avatar/speak
 * Generate speech script for a specific context
 * Frontend uses this script with the streaming SDK
 */
streamingAvatarRouter.post('/speak', avatarRateLimit, async (req: Request, res: Response) => {
  const {
    userId: rawUserId,
    context: rawContext,
    text: rawText,
    goalData,
    mealPlan,
    mealTargets,
    userInputs,
  } = req.body;

  const userId = sanitizeUserId(rawUserId);
  const context = validateContext(rawContext);

  console.log(`[streaming-avatar] Generating speech for user ${userId}, context: ${context}`);

  try {
    let script: string;

    switch (context) {
      case 'goals':
        if (!goalData) {
          return res.status(400).json({
            ok: false,
            error: 'Missing goalData for goals context',
          });
        }
        script = generateGoalCoachingScript(goalData, userInputs);
        break;

      case 'mealplan':
        if (!mealPlan) {
          return res.status(400).json({
            ok: false,
            error: 'Missing mealPlan for mealplan context',
          });
        }
        script = generateMealPlanCoachingScript(mealPlan, mealTargets);
        break;

      case 'general':
      default:
        if (!rawText) {
          return res.status(400).json({
            ok: false,
            error: 'Missing text for general context',
          });
        }
        script = sanitizeAvatarText(rawText);
        break;
    }

    return res.json({
      ok: true,
      script,
      context,
    });
  } catch (error: unknown) {
    console.error('[streaming-avatar] Generate speech error:', error);
    return res.status(400).json({
      ok: false,
      error: error instanceof Error ? error.message : 'Failed to generate speech',
    });
  }
});

/**
 * POST /api/v1/avatar/coach/goals
 * Combined endpoint: creates token + generates goal coaching script
 * Convenience endpoint for goal coach button
 */
streamingAvatarRouter.post('/coach/goals', avatarRateLimit, async (req: Request, res: Response) => {
  const { userId: rawUserId, goalData, userInputs } = req.body;
  const userId = sanitizeUserId(rawUserId);

  console.log(`[streaming-avatar] Goal coach request for user ${userId}`);

  if (!isConfigured()) {
    // Fallback: Return script only without streaming
    try {
      const script = generateGoalCoachingScript(goalData || {}, userInputs);
      return res.json({
        ok: true,
        streamingAvailable: false,
        script,
        message: 'Streaming not available. Text coaching provided.',
      });
    } catch (error: unknown) {
      return res.status(400).json({
        ok: false,
        error: error instanceof Error ? error.message : 'Failed to generate coaching',
      });
    }
  }

  try {
    // Generate token and script in parallel
    const [token, script] = await Promise.all([
      createSessionToken(),
      Promise.resolve(generateGoalCoachingScript(goalData || {}, userInputs)),
    ]);

    return res.json({
      ok: true,
      streamingAvailable: true,
      token,
      script,
      defaultAvatarId: process.env.HEYGEN_AVATAR_ID || null,
      defaultVoiceId: process.env.HEYGEN_VOICE_ID || null,
    });
  } catch (error: unknown) {
    console.error('[streaming-avatar] Goal coach error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    // Fallback: Return script only with debug info
    try {
      const script = generateGoalCoachingScript(goalData || {}, userInputs);
      return res.json({
        ok: true,
        streamingAvailable: false,
        script,
        message: 'Streaming temporarily unavailable. Text coaching provided.',
        _debug: {
          tokenError: errorMessage,
          timestamp: new Date().toISOString(),
        },
      });
    } catch {
      return res.status(500).json({
        ok: false,
        error: errorMessage,
      });
    }
  }
});

/**
 * GET /api/v1/avatar/liveavatar/voices
 * List available voices from LiveAvatar API (for debugging)
 */
streamingAvatarRouter.get('/liveavatar/voices', async (_req: Request, res: Response) => {
  const apiKey = process.env.HEYGEN_API_KEY;

  if (!apiKey) {
    return res.status(503).json({
      ok: false,
      error: 'API key not configured',
    });
  }

  try {
    const axios = require('axios');
    const response = await axios.get('https://api.liveavatar.com/v1/voices', {
      headers: {
        'X-API-KEY': apiKey,
        'Content-Type': 'application/json',
      },
      timeout: 10000,
    });

    const voices = response.data?.data || response.data || [];

    return res.json({
      ok: true,
      voices: Array.isArray(voices) ? voices.map((v: any) => ({
        id: v.voice_id || v.id,
        name: v.name || v.voice_name || 'Unnamed',
        language: v.language || 'unknown',
        gender: v.gender || null,
      })) : voices,
      raw: response.data,
    });
  } catch (error: any) {
    console.error('[liveavatar] List voices error:', error.response?.data || error.message);
    return res.status(500).json({
      ok: false,
      error: error.response?.data?.message || error.message,
      details: error.response?.data,
    });
  }
});

/**
 * GET /api/v1/avatar/liveavatar/avatars
 * List available avatars from LiveAvatar API (for debugging)
 */
streamingAvatarRouter.get('/liveavatar/avatars', async (_req: Request, res: Response) => {
  const apiKey = process.env.HEYGEN_API_KEY;

  if (!apiKey) {
    return res.status(503).json({
      ok: false,
      error: 'API key not configured',
    });
  }

  try {
    const axios = require('axios');
    const response = await axios.get('https://api.liveavatar.com/v1/avatars', {
      headers: {
        'X-API-KEY': apiKey,
        'Content-Type': 'application/json',
      },
      timeout: 10000,
    });

    const avatars = response.data?.data || response.data || [];

    return res.json({
      ok: true,
      avatars: Array.isArray(avatars) ? avatars.map((a: any) => ({
        id: a.avatar_id || a.id,
        name: a.name || a.avatar_name || 'Unnamed',
        preview: a.preview_url || a.preview_image_url || null,
        defaultVoice: a.default_voice_id || a.default_voice || null,
      })) : avatars,
      raw: response.data,
    });
  } catch (error: any) {
    console.error('[liveavatar] List avatars error:', error.response?.data || error.message);
    return res.status(500).json({
      ok: false,
      error: error.response?.data?.message || error.message,
      details: error.response?.data,
    });
  }
});

/**
 * POST /api/v1/avatar/coach/mealplan
 * Combined endpoint: creates token + generates meal plan coaching script
 * Convenience endpoint for meal plan coach button
 */
streamingAvatarRouter.post('/coach/mealplan', avatarRateLimit, async (req: Request, res: Response) => {
  const { userId: rawUserId, plan, targets } = req.body;
  const userId = sanitizeUserId(rawUserId);

  console.log(`[streaming-avatar] Meal plan coach request for user ${userId}`);

  if (!isConfigured()) {
    // Fallback: Return script only without streaming
    try {
      const script = generateMealPlanCoachingScript(plan || {}, targets);
      return res.json({
        ok: true,
        streamingAvailable: false,
        script,
        message: 'Streaming not available. Text coaching provided.',
      });
    } catch (error: unknown) {
      return res.status(400).json({
        ok: false,
        error: error instanceof Error ? error.message : 'Failed to generate coaching',
      });
    }
  }

  try {
    // Generate token and script in parallel
    const [token, script] = await Promise.all([
      createSessionToken(),
      Promise.resolve(generateMealPlanCoachingScript(plan || {}, targets)),
    ]);

    return res.json({
      ok: true,
      streamingAvailable: true,
      token,
      script,
      defaultAvatarId: process.env.HEYGEN_AVATAR_ID || null,
      defaultVoiceId: process.env.HEYGEN_VOICE_ID || null,
    });
  } catch (error: unknown) {
    console.error('[streaming-avatar] Meal plan coach error:', error);

    // Fallback: Return script only
    try {
      const script = generateMealPlanCoachingScript(plan || {}, targets);
      return res.json({
        ok: true,
        streamingAvailable: false,
        script,
        message: 'Streaming temporarily unavailable. Text coaching provided.',
      });
    } catch {
      return res.status(500).json({
        ok: false,
        error: error instanceof Error ? error.message : 'Failed to generate coaching',
      });
    }
  }
});
