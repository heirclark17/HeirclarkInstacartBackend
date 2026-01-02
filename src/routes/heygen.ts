import { Router, Request, Response } from 'express';
import { pool } from '../db/pool';
import {
  createAvatarVideo,
  getVideoStatus,
  listAvatars,
  listVoices,
} from '../services/heygenService';
import { generateVideoScript, hashPlan } from '../services/scriptGenerator';
import { videoRateLimitMiddleware } from '../middleware/rateLimiter';

export const heygenRouter = Router();

// Apply strict rate limiting to video generation endpoint
const videoRateLimit = videoRateLimitMiddleware();

/**
 * HeyGen Video Generation Routes
 * Handles personalized avatar video creation for nutrition plans
 */

/**
 * Validate and sanitize user ID
 * Prevents injection and ensures safe database queries
 */
function sanitizeUserId(userId: string): string | null {
  if (!userId || typeof userId !== 'string') return null;

  // Remove dangerous characters, allow alphanumeric, underscore, dash
  const sanitized = userId.trim().replace(/[^a-zA-Z0-9_\-]/g, '');

  // Must be reasonable length
  if (sanitized.length < 1 || sanitized.length > 255) return null;

  return sanitized;
}

/**
 * Validate video ID format (HeyGen video IDs are UUIDs or similar)
 */
function sanitizeVideoId(videoId: string): string | null {
  if (!videoId || typeof videoId !== 'string') return null;

  // Allow alphanumeric, underscore, dash (typical for UUIDs/IDs)
  const sanitized = videoId.trim().replace(/[^a-zA-Z0-9_\-]/g, '');

  if (sanitized.length < 1 || sanitized.length > 100) return null;

  return sanitized;
}

// Initialize database table if it doesn't exist
async function ensureTableExists(): Promise<void> {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS hc_user_videos (
        id SERIAL PRIMARY KEY,
        user_id VARCHAR(255) NOT NULL,
        heygen_video_id VARCHAR(255),
        video_url TEXT,
        script_text TEXT,
        status VARCHAR(50) DEFAULT 'pending',
        plan_hash VARCHAR(64),
        created_at TIMESTAMP DEFAULT NOW(),
        expires_at TIMESTAMP,
        UNIQUE(user_id, plan_hash)
      )
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_user_videos_user_id ON hc_user_videos(user_id)
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_user_videos_status ON hc_user_videos(status)
    `);
  } catch (err) {
    console.error('[heygen] Failed to ensure table exists:', err);
  }
}

// Run on module load
ensureTableExists();

/**
 * POST /api/v1/video/generate
 * Start video generation for a user's 7-day plan
 * Rate limited: 5 videos per hour per user
 */
heygenRouter.post('/generate', videoRateLimit, async (req: Request, res: Response) => {
  const { userId: rawUserId, weekPlan, wellness, preferences, userName } = req.body;

  const userId = sanitizeUserId(rawUserId);
  if (!userId) {
    return res.status(400).json({ ok: false, error: 'Invalid or missing userId' });
  }

  if (!weekPlan || !wellness) {
    return res.status(400).json({ ok: false, error: 'Missing weekPlan or wellness data' });
  }

  try {
    // Generate plan hash for deduplication
    const planHash = hashPlan(weekPlan, wellness);

    // Check for existing video with same plan
    const existing = await pool.query(
      `SELECT id, heygen_video_id, video_url, status, expires_at
       FROM hc_user_videos
       WHERE user_id = $1 AND plan_hash = $2`,
      [userId, planHash]
    );

    if (existing.rows.length > 0) {
      const row = existing.rows[0];

      // If video exists and not expired, return it
      if (row.status === 'completed' && row.video_url) {
        const expiresAt = new Date(row.expires_at);
        if (expiresAt > new Date()) {
          return res.json({
            ok: true,
            videoId: row.heygen_video_id,
            status: 'completed',
            videoUrl: row.video_url,
            cached: true,
          });
        }
      }

      // If still processing, return current status
      if (row.status === 'pending' || row.status === 'processing') {
        return res.json({
          ok: true,
          videoId: row.heygen_video_id,
          status: row.status,
        });
      }
    }

    // Generate script using Claude
    console.log(`[heygen] Generating script for user ${userId}`);
    const script = await generateVideoScript(weekPlan, wellness, preferences, userName);

    // Create video with HeyGen
    console.log(`[heygen] Creating HeyGen video for user ${userId}`);
    const heygenVideoId = await createAvatarVideo(script);

    // Calculate expiry (HeyGen videos expire in 7 days)
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    // Store in database (upsert)
    await pool.query(
      `INSERT INTO hc_user_videos (user_id, heygen_video_id, script_text, status, plan_hash, expires_at)
       VALUES ($1, $2, $3, 'processing', $4, $5)
       ON CONFLICT (user_id, plan_hash)
       DO UPDATE SET
         heygen_video_id = $2,
         script_text = $3,
         status = 'processing',
         expires_at = $5,
         created_at = NOW()`,
      [userId, heygenVideoId, script, planHash, expiresAt.toISOString()]
    );

    return res.json({
      ok: true,
      videoId: heygenVideoId,
      status: 'processing',
      message: 'Video generation started. Poll /video/status for updates.',
    });
  } catch (err: any) {
    console.error('[heygen] generate failed:', err);
    return res.status(500).json({
      ok: false,
      error: err.message || 'Video generation failed',
    });
  }
});

/**
 * GET /api/v1/video/status/:videoId
 * Check the status of a video generation
 */
heygenRouter.get('/status/:videoId', async (req: Request, res: Response) => {
  const videoId = sanitizeVideoId(req.params.videoId);

  if (!videoId) {
    return res.status(400).json({ ok: false, error: 'Invalid or missing videoId' });
  }

  try {
    // Get status from HeyGen
    const heygenStatus = await getVideoStatus(videoId);

    // Update database if completed
    if (heygenStatus.status === 'completed' && heygenStatus.videoUrl) {
      await pool.query(
        `UPDATE hc_user_videos
         SET status = 'completed', video_url = $1
         WHERE heygen_video_id = $2`,
        [heygenStatus.videoUrl, videoId]
      );
    } else if (heygenStatus.status === 'failed') {
      await pool.query(
        `UPDATE hc_user_videos
         SET status = 'failed'
         WHERE heygen_video_id = $1`,
        [videoId]
      );
    }

    return res.json({
      ok: true,
      videoId,
      status: heygenStatus.status,
      videoUrl: heygenStatus.videoUrl,
      thumbnailUrl: heygenStatus.thumbnailUrl,
      duration: heygenStatus.duration,
      error: heygenStatus.error,
    });
  } catch (err: any) {
    console.error('[heygen] status check failed:', err);
    return res.status(500).json({
      ok: false,
      error: err.message || 'Status check failed',
    });
  }
});

/**
 * GET /api/v1/video/user/:userId
 * Get the latest video for a user
 */
heygenRouter.get('/user/:userId', async (req: Request, res: Response) => {
  const userId = sanitizeUserId(req.params.userId);

  if (!userId) {
    return res.status(400).json({ ok: false, error: 'Invalid or missing userId' });
  }

  try {
    const result = await pool.query(
      `SELECT heygen_video_id, video_url, status, created_at, expires_at
       FROM hc_user_videos
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [userId]
    );

    if (result.rows.length === 0) {
      return res.json({
        ok: true,
        hasVideo: false,
      });
    }

    const row = result.rows[0];

    // Check if expired
    const expiresAt = new Date(row.expires_at);
    const isExpired = expiresAt < new Date();

    return res.json({
      ok: true,
      hasVideo: true,
      videoId: row.heygen_video_id,
      videoUrl: isExpired ? null : row.video_url,
      status: isExpired ? 'expired' : row.status,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      isExpired,
    });
  } catch (err: any) {
    console.error('[heygen] user video lookup failed:', err);
    return res.status(500).json({
      ok: false,
      error: err.message || 'User video lookup failed',
    });
  }
});

/**
 * GET /api/v1/video/avatars
 * List available HeyGen avatars (for setup/configuration)
 */
heygenRouter.get('/avatars', async (_req: Request, res: Response) => {
  try {
    const avatars = await listAvatars();
    return res.json({
      ok: true,
      avatars: avatars.map((a) => ({
        id: a.avatar_id,
        name: a.avatar_name,
        gender: a.gender,
        previewImage: a.preview_image_url,
      })),
    });
  } catch (err: any) {
    console.error('[heygen] list avatars failed:', err);
    return res.status(500).json({
      ok: false,
      error: err.message || 'Failed to list avatars',
    });
  }
});

/**
 * GET /api/v1/video/voices
 * List available HeyGen voices (for setup/configuration)
 */
heygenRouter.get('/voices', async (_req: Request, res: Response) => {
  try {
    const voices = await listVoices();
    return res.json({
      ok: true,
      voices: voices.map((v) => ({
        id: v.voice_id,
        name: v.name,
        language: v.language,
        gender: v.gender,
        previewAudio: v.preview_audio,
      })),
    });
  } catch (err: any) {
    console.error('[heygen] list voices failed:', err);
    return res.status(500).json({
      ok: false,
      error: err.message || 'Failed to list voices',
    });
  }
});

/**
 * POST /api/v1/video/goal-coach
 * Generate a personalized goal coaching video/script
 * Returns video URL if HeyGen succeeds, or fallback script text
 */
heygenRouter.post('/goal-coach', videoRateLimit, async (req: Request, res: Response) => {
  const { userId: rawUserId, goalData, userInputs } = req.body;

  const userId = sanitizeUserId(rawUserId || 'guest');

  if (!goalData) {
    return res.status(400).json({ ok: false, error: 'Missing goalData' });
  }

  try {
    // Generate personalized coaching script
    const script = generateGoalCoachScript(goalData, userInputs);

    // Try to create HeyGen video if API key is configured
    const hasHeyGenKey = !!process.env.HEYGEN_API_KEY && process.env.HEYGEN_API_KEY.length > 20;

    if (hasHeyGenKey && process.env.HEYGEN_AVATAR_ID && process.env.HEYGEN_VOICE_ID) {
      try {
        console.log(`[heygen] Creating goal coach video for user ${userId}`);
        const heygenVideoId = await createAvatarVideo(script);

        // Store in database
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 7);

        await pool.query(
          `INSERT INTO hc_user_videos (user_id, heygen_video_id, script_text, status, plan_hash, expires_at)
           VALUES ($1, $2, $3, 'processing', $4, $5)
           ON CONFLICT (user_id, plan_hash)
           DO UPDATE SET
             heygen_video_id = $2,
             script_text = $3,
             status = 'processing',
             expires_at = $5,
             created_at = NOW()`,
          [userId, heygenVideoId, script, `goal_${Date.now()}`, expiresAt.toISOString()]
        );

        // Poll for completion (max 60 seconds)
        let attempts = 0;
        const maxAttempts = 12;
        const pollInterval = 5000;

        while (attempts < maxAttempts) {
          await new Promise(resolve => setTimeout(resolve, pollInterval));
          attempts++;

          const status = await getVideoStatus(heygenVideoId);

          if (status.status === 'completed' && status.videoUrl) {
            // Update database
            await pool.query(
              `UPDATE hc_user_videos SET status = 'completed', video_url = $1 WHERE heygen_video_id = $2`,
              [status.videoUrl, heygenVideoId]
            );

            return res.json({
              ok: true,
              videoId: heygenVideoId,
              videoUrl: status.videoUrl,
              script: script,
            });
          } else if (status.status === 'failed') {
            console.warn(`[heygen] Video generation failed for ${heygenVideoId}`);
            break;
          }
        }

        // Timeout or failed - return script as fallback
        console.log(`[heygen] Video not ready in time, returning script fallback`);
        return res.json({
          ok: true,
          videoId: heygenVideoId,
          videoUrl: null,
          script: script,
          message: 'Video is still processing. Script provided as fallback.',
        });

      } catch (heygenErr: any) {
        console.error('[heygen] Goal coach video creation failed:', heygenErr.message);
        // Fall through to return script only
      }
    }

    // No HeyGen or it failed - return script only
    return res.json({
      ok: true,
      videoUrl: null,
      script: script,
      message: 'Video generation not available. Coaching script provided.',
    });

  } catch (err: any) {
    console.error('[heygen] goal-coach failed:', err);
    return res.status(500).json({
      ok: false,
      error: err.message || 'Goal coach generation failed',
    });
  }
});

/**
 * Generate a personalized goal coaching script
 */
function generateGoalCoachScript(goalData: any, userInputs: any): string {
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
    currentWeight = 180,
    targetWeight = 180,
    totalWeeks = 0,
  } = goalData || {};

  const name = userInputs?.name || 'there';
  const goalWord = goalType === 'lose' ? 'lose weight' : goalType === 'gain' ? 'build muscle' : 'maintain your weight';
  const absWeekly = Math.abs(weeklyChange).toFixed(2);
  const absDelta = Math.abs(Math.round(dailyDelta));

  let script = `Hey ${name}! Congratulations on setting up your personalized nutrition plan. I'm excited to walk you through your goals.\n\n`;

  // BMI section
  script += `First, let's talk about where you're starting. Your BMI is ${bmi.toFixed(1)}, which puts you in the "${bmiCategory.name}" category. `;

  if (goalType === 'lose') {
    script += `Since your goal is to lose weight, remember that BMI is just one number. What matters more is how you feel, your energy levels, and your body composition. As you shed fat while keeping muscle, your health will improve even if the scale moves slowly.\n\n`;
  } else if (goalType === 'gain') {
    script += `As you work toward gaining weight, your BMI will naturally increase. That's expected and healthy when you're building muscle. Focus on your strength gains and measurements alongside the scale.\n\n`;
  } else {
    script += `For maintenance, track how you feel day to day rather than fixating on numbers.\n\n`;
  }

  // TDEE section
  script += `Now let's talk about your metabolism. Your body burns about ${tdee.toLocaleString()} calories per day at your current activity level. This is called your TDEE, or maintenance calories. `;

  // Goal-specific calorie explanation
  if (goalType === 'lose') {
    script += `To ${goalWord}, you'll be eating ${calories.toLocaleString()} calories daily, which creates a ${absDelta} calorie deficit. This means you'll lose about ${absWeekly} pounds per week over ${Math.round(totalWeeks)} weeks.\n\n`;
  } else if (goalType === 'gain') {
    script += `To ${goalWord}, you'll be eating ${calories.toLocaleString()} calories daily, giving you a ${absDelta} calorie surplus. Combined with strength training, you'll gain about ${absWeekly} pounds per week.\n\n`;
  } else {
    script += `You'll be eating right at maintenance with ${calories.toLocaleString()} calories daily.\n\n`;
  }

  // Macros
  script += `Your macro targets are ${protein} grams of protein, ${carbs} grams of carbs, and ${fat} grams of fat. `;

  if (goalType === 'lose' || goalType === 'gain') {
    script += `Protein is especially important for your goal. Hitting ${protein} grams daily helps preserve muscle during a cut or build it during a bulk.\n\n`;
  } else {
    script += `These macros give you a balanced approach to nutrition.\n\n`;
  }

  // Encouragement
  script += `Here's my advice: Consistency beats perfection. You don't need to hit these numbers exactly every day. Aim for the weekly average. Track your food for the first couple of weeks to build awareness, then you can be more flexible.\n\n`;

  script += `You've taken the first step by setting clear goals. Now it's about showing up each day, one meal at a time. I believe in you. Let's crush this together!`;

  return script;
}
