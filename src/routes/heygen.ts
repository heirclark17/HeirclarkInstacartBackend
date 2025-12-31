import { Router, Request, Response } from 'express';
import { pool } from '../db/pool';
import {
  createAvatarVideo,
  getVideoStatus,
  listAvatars,
  listVoices,
} from '../services/heygenService';
import { generateVideoScript, hashPlan } from '../services/scriptGenerator';

export const heygenRouter = Router();

/**
 * HeyGen Video Generation Routes
 * Handles personalized avatar video creation for nutrition plans
 */

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
 */
heygenRouter.post('/generate', async (req: Request, res: Response) => {
  const { userId, weekPlan, wellness, preferences, userName } = req.body;

  if (!userId) {
    return res.status(400).json({ ok: false, error: 'Missing userId' });
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
  const { videoId } = req.params;

  if (!videoId) {
    return res.status(400).json({ ok: false, error: 'Missing videoId' });
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
         WHERE heygen_video_id = $2`,
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
  const { userId } = req.params;

  if (!userId) {
    return res.status(400).json({ ok: false, error: 'Missing userId' });
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
