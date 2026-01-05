// src/routes/social.ts
// Social API Routes for Heirclark
// Handles friends, challenges, sharing, and activity feed

import { Router, Request, Response } from 'express';
import { Pool } from 'pg';
import {
  UserProfile,
  UserConnection,
  Challenge,
  ChallengeParticipant,
  Share,
  Badge,
  UserBadge,
  Notification,
  ConnectionStatus,
  ConnectionType,
  ChallengeType,
  ShareType,
} from '../types/social';

// ==========================================================================
// SQL Schema for Social Features
// ==========================================================================

export const SOCIAL_SCHEMA = `
-- User profiles
CREATE TABLE IF NOT EXISTS hc_user_profiles (
  user_id VARCHAR(100) PRIMARY KEY,
  display_name VARCHAR(100) NOT NULL,
  avatar_url TEXT,
  profile_visibility VARCHAR(20) DEFAULT 'friends_only',
  show_progress BOOLEAN DEFAULT true,
  show_meal_plans BOOLEAN DEFAULT false,
  show_workouts BOOLEAN DEFAULT true,
  days_active INTEGER DEFAULT 0,
  current_streak INTEGER DEFAULT 0,
  programs_completed INTEGER DEFAULT 0,
  challenges_won INTEGER DEFAULT 0,
  bio TEXT,
  goal_summary VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- User connections (friends, coaches, etc.)
CREATE TABLE IF NOT EXISTS hc_user_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id VARCHAR(100) NOT NULL,
  recipient_id VARCHAR(100) NOT NULL,
  connection_type VARCHAR(30) DEFAULT 'friend',
  status VARCHAR(20) DEFAULT 'pending',
  message TEXT,
  accepted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(requester_id, recipient_id)
);

-- Challenges
CREATE TABLE IF NOT EXISTS hc_challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  challenge_type VARCHAR(50) NOT NULL,
  start_date TIMESTAMPTZ NOT NULL,
  end_date TIMESTAMPTZ NOT NULL,
  status VARCHAR(20) DEFAULT 'upcoming',
  target_value DECIMAL(10,2) NOT NULL,
  target_unit VARCHAR(50) NOT NULL,
  scoring_method VARCHAR(30) DEFAULT 'total',
  creator_id VARCHAR(100) NOT NULL,
  is_public BOOLEAN DEFAULT true,
  max_participants INTEGER,
  participant_count INTEGER DEFAULT 0,
  stake_description TEXT,
  stake_amount_cents INTEGER,
  badge_id UUID,
  prize_description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Challenge participants
CREATE TABLE IF NOT EXISTS hc_challenge_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge_id UUID NOT NULL REFERENCES hc_challenges(id) ON DELETE CASCADE,
  user_id VARCHAR(100) NOT NULL,
  current_value DECIMAL(10,2) DEFAULT 0,
  rank INTEGER,
  last_updated TIMESTAMPTZ DEFAULT NOW(),
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  completed BOOLEAN DEFAULT false,
  won BOOLEAN DEFAULT false,
  UNIQUE(challenge_id, user_id)
);

-- Shares
CREATE TABLE IF NOT EXISTS hc_shares (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR(100) NOT NULL,
  share_type VARCHAR(50) NOT NULL,
  content_id VARCHAR(100) NOT NULL,
  visibility VARCHAR(20) DEFAULT 'friends',
  shared_with_ids VARCHAR(100)[],
  preview_text TEXT,
  preview_image_url TEXT,
  like_count INTEGER DEFAULT 0,
  comment_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ
);

-- Share comments
CREATE TABLE IF NOT EXISTS hc_share_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  share_id UUID NOT NULL REFERENCES hc_shares(id) ON DELETE CASCADE,
  user_id VARCHAR(100) NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Share likes
CREATE TABLE IF NOT EXISTS hc_share_likes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  share_id UUID NOT NULL REFERENCES hc_shares(id) ON DELETE CASCADE,
  user_id VARCHAR(100) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(share_id, user_id)
);

-- Badges
CREATE TABLE IF NOT EXISTS hc_badges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  description TEXT,
  category VARCHAR(50) NOT NULL,
  icon_url TEXT,
  color VARCHAR(20),
  rarity VARCHAR(20) DEFAULT 'common',
  requirement_description TEXT,
  requirement_value DECIMAL(10,2),
  points INTEGER DEFAULT 10,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- User badges
CREATE TABLE IF NOT EXISTS hc_user_badges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR(100) NOT NULL,
  badge_id UUID NOT NULL REFERENCES hc_badges(id),
  earned_at TIMESTAMPTZ DEFAULT NOW(),
  context TEXT,
  UNIQUE(user_id, badge_id)
);

-- Notifications
CREATE TABLE IF NOT EXISTS hc_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR(100) NOT NULL,
  type VARCHAR(50) NOT NULL,
  title VARCHAR(255) NOT NULL,
  body TEXT,
  image_url TEXT,
  action_url TEXT,
  action_data JSONB,
  read BOOLEAN DEFAULT false,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_connections_requester ON hc_user_connections(requester_id);
CREATE INDEX IF NOT EXISTS idx_connections_recipient ON hc_user_connections(recipient_id);
CREATE INDEX IF NOT EXISTS idx_challenges_status ON hc_challenges(status);
CREATE INDEX IF NOT EXISTS idx_challenge_participants_user ON hc_challenge_participants(user_id);
CREATE INDEX IF NOT EXISTS idx_shares_user ON hc_shares(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON hc_notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON hc_notifications(user_id) WHERE read = false;
`;

// ==========================================================================
// Router Factory
// ==========================================================================

export function createSocialRouter(pool: Pool): Router {
  const router = Router();

  // ==========================================================================
  // Profile Endpoints
  // ==========================================================================

  // GET /api/v1/social/profile/:userId
  router.get('/profile/:userId', async (req: Request, res: Response) => {
    try {
      const result = await pool.query(
        'SELECT * FROM hc_user_profiles WHERE user_id = $1',
        [req.params.userId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ ok: false, error: 'Profile not found' });
      }

      const profile = result.rows[0];

      // Check visibility
      const requesterId = req.query.requesterId as string || req.headers['x-shopify-customer-id'] as string;

      if (profile.profile_visibility === 'private' && requesterId !== profile.user_id) {
        return res.json({
          ok: true,
          data: {
            user_id: profile.user_id,
            display_name: profile.display_name,
            avatar_url: profile.avatar_url,
            profile_visibility: 'private',
          },
        });
      }

      return res.json({ ok: true, data: profile });
    } catch (error) {
      console.error('[Social] Get profile error:', error);
      return res.status(500).json({ ok: false, error: 'Failed to get profile' });
    }
  });

  // PUT /api/v1/social/profile
  router.put('/profile', async (req: Request, res: Response) => {
    try {
      const userId = req.body.userId || req.headers['x-shopify-customer-id'];

      if (!userId) {
        return res.status(400).json({ ok: false, error: 'userId required' });
      }

      const {
        display_name,
        avatar_url,
        profile_visibility,
        show_progress,
        show_meal_plans,
        show_workouts,
        bio,
        goal_summary,
      } = req.body;

      const result = await pool.query(
        `INSERT INTO hc_user_profiles (user_id, display_name, avatar_url, profile_visibility,
           show_progress, show_meal_plans, show_workouts, bio, goal_summary)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (user_id) DO UPDATE SET
           display_name = COALESCE($2, hc_user_profiles.display_name),
           avatar_url = COALESCE($3, hc_user_profiles.avatar_url),
           profile_visibility = COALESCE($4, hc_user_profiles.profile_visibility),
           show_progress = COALESCE($5, hc_user_profiles.show_progress),
           show_meal_plans = COALESCE($6, hc_user_profiles.show_meal_plans),
           show_workouts = COALESCE($7, hc_user_profiles.show_workouts),
           bio = COALESCE($8, hc_user_profiles.bio),
           goal_summary = COALESCE($9, hc_user_profiles.goal_summary),
           updated_at = NOW()
         RETURNING *`,
        [userId, display_name, avatar_url, profile_visibility, show_progress, show_meal_plans, show_workouts, bio, goal_summary]
      );

      return res.json({ ok: true, data: result.rows[0] });
    } catch (error) {
      console.error('[Social] Update profile error:', error);
      return res.status(500).json({ ok: false, error: 'Failed to update profile' });
    }
  });

  // ==========================================================================
  // Friends/Connections Endpoints
  // ==========================================================================

  // GET /api/v1/social/friends
  router.get('/friends', async (req: Request, res: Response) => {
    try {
      const userId = req.query.userId as string || req.headers['x-shopify-customer-id'] as string;

      if (!userId) {
        return res.status(400).json({ ok: false, error: 'userId required' });
      }

      // Get accepted connections
      const friendsResult = await pool.query(
        `SELECT c.*, p.*
         FROM hc_user_connections c
         JOIN hc_user_profiles p ON (
           CASE WHEN c.requester_id = $1 THEN c.recipient_id ELSE c.requester_id END = p.user_id
         )
         WHERE (c.requester_id = $1 OR c.recipient_id = $1)
           AND c.status = 'accepted'`,
        [userId]
      );

      // Get pending requests (received)
      const pendingResult = await pool.query(
        `SELECT c.*, p.*
         FROM hc_user_connections c
         JOIN hc_user_profiles p ON c.requester_id = p.user_id
         WHERE c.recipient_id = $1 AND c.status = 'pending'`,
        [userId]
      );

      return res.json({
        ok: true,
        data: {
          friends: friendsResult.rows.map(row => ({
            connection_id: row.id,
            user: {
              user_id: row.user_id,
              display_name: row.display_name,
              avatar_url: row.avatar_url,
              current_streak: row.current_streak,
            },
            connection_type: row.connection_type,
            connected_since: row.accepted_at,
          })),
          pending_requests: pendingResult.rows.map(row => ({
            connection_id: row.id,
            user: {
              user_id: row.user_id,
              display_name: row.display_name,
              avatar_url: row.avatar_url,
            },
            message: row.message,
            requested_at: row.created_at,
          })),
        },
      });
    } catch (error) {
      console.error('[Social] Get friends error:', error);
      return res.status(500).json({ ok: false, error: 'Failed to get friends' });
    }
  });

  // POST /api/v1/social/friends/request
  router.post('/friends/request', async (req: Request, res: Response) => {
    try {
      const requesterId = req.body.userId || req.headers['x-shopify-customer-id'];
      const { recipient_id, message, connection_type } = req.body;

      if (!requesterId || !recipient_id) {
        return res.status(400).json({ ok: false, error: 'userId and recipient_id required' });
      }

      if (requesterId === recipient_id) {
        return res.status(400).json({ ok: false, error: 'Cannot send request to yourself' });
      }

      const result = await pool.query(
        `INSERT INTO hc_user_connections (requester_id, recipient_id, message, connection_type)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (requester_id, recipient_id) DO NOTHING
         RETURNING *`,
        [requesterId, recipient_id, message, connection_type || 'friend']
      );

      if (result.rows.length === 0) {
        return res.status(400).json({ ok: false, error: 'Connection request already exists' });
      }

      // Create notification for recipient
      await createNotification(pool, recipient_id, 'friend_request', {
        title: 'New Friend Request',
        body: `${req.body.display_name || 'Someone'} wants to connect with you`,
        action_url: '/social/friends',
      });

      return res.status(201).json({ ok: true, data: result.rows[0] });
    } catch (error) {
      console.error('[Social] Friend request error:', error);
      return res.status(500).json({ ok: false, error: 'Failed to send friend request' });
    }
  });

  // POST /api/v1/social/friends/respond
  router.post('/friends/respond', async (req: Request, res: Response) => {
    try {
      const userId = req.body.userId || req.headers['x-shopify-customer-id'];
      const { connection_id, accept } = req.body;

      if (!userId || !connection_id) {
        return res.status(400).json({ ok: false, error: 'userId and connection_id required' });
      }

      const newStatus = accept ? 'accepted' : 'blocked';

      const result = await pool.query(
        `UPDATE hc_user_connections
         SET status = $1, accepted_at = CASE WHEN $1 = 'accepted' THEN NOW() ELSE NULL END
         WHERE id = $2 AND recipient_id = $3
         RETURNING *`,
        [newStatus, connection_id, userId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ ok: false, error: 'Connection not found' });
      }

      // Notify requester if accepted
      if (accept) {
        await createNotification(pool, result.rows[0].requester_id, 'friend_accepted', {
          title: 'Friend Request Accepted',
          body: 'Your friend request was accepted!',
          action_url: '/social/friends',
        });
      }

      return res.json({ ok: true, data: result.rows[0] });
    } catch (error) {
      console.error('[Social] Friend respond error:', error);
      return res.status(500).json({ ok: false, error: 'Failed to respond to request' });
    }
  });

  // ==========================================================================
  // Challenge Endpoints
  // ==========================================================================

  // GET /api/v1/social/challenges
  router.get('/challenges', async (req: Request, res: Response) => {
    try {
      const userId = req.query.userId as string || req.headers['x-shopify-customer-id'] as string;
      const status = req.query.status as string;

      let sql = `
        SELECT c.*, cp.current_value, cp.rank, cp.joined_at
        FROM hc_challenges c
        LEFT JOIN hc_challenge_participants cp ON c.id = cp.challenge_id AND cp.user_id = $1
        WHERE c.is_public = true OR c.creator_id = $1 OR cp.user_id = $1
      `;
      const params: any[] = [userId || ''];

      if (status) {
        sql += ' AND c.status = $2';
        params.push(status);
      }

      sql += ' ORDER BY c.start_date DESC LIMIT 50';

      const result = await pool.query(sql, params);

      // Group by status
      const challenges = result.rows;
      const grouped = {
        active: challenges.filter(c => c.status === 'active'),
        upcoming: challenges.filter(c => c.status === 'upcoming'),
        completed: challenges.filter(c => c.status === 'completed'),
        participating: challenges.filter(c => c.joined_at),
      };

      return res.json({ ok: true, data: grouped });
    } catch (error) {
      console.error('[Social] Get challenges error:', error);
      return res.status(500).json({ ok: false, error: 'Failed to get challenges' });
    }
  });

  // POST /api/v1/social/challenges
  router.post('/challenges', async (req: Request, res: Response) => {
    try {
      const creatorId = req.body.userId || req.headers['x-shopify-customer-id'];

      if (!creatorId) {
        return res.status(400).json({ ok: false, error: 'userId required' });
      }

      const {
        name,
        description,
        challenge_type,
        start_date,
        end_date,
        target_value,
        target_unit,
        scoring_method,
        is_public,
        max_participants,
        stake_description,
      } = req.body;

      if (!name || !challenge_type || !start_date || !end_date || !target_value) {
        return res.status(400).json({
          ok: false,
          error: 'name, challenge_type, start_date, end_date, target_value required',
        });
      }

      const result = await pool.query(
        `INSERT INTO hc_challenges
         (name, description, challenge_type, start_date, end_date, target_value, target_unit,
          scoring_method, creator_id, is_public, max_participants, stake_description)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         RETURNING *`,
        [
          name,
          description,
          challenge_type,
          start_date,
          end_date,
          target_value,
          target_unit || 'units',
          scoring_method || 'total',
          creatorId,
          is_public !== false,
          max_participants,
          stake_description,
        ]
      );

      // Auto-join creator
      await pool.query(
        `INSERT INTO hc_challenge_participants (challenge_id, user_id)
         VALUES ($1, $2)`,
        [result.rows[0].id, creatorId]
      );

      return res.status(201).json({ ok: true, data: result.rows[0] });
    } catch (error) {
      console.error('[Social] Create challenge error:', error);
      return res.status(500).json({ ok: false, error: 'Failed to create challenge' });
    }
  });

  // POST /api/v1/social/challenges/:challengeId/join
  router.post('/challenges/:challengeId/join', async (req: Request, res: Response) => {
    try {
      const userId = req.body.userId || req.headers['x-shopify-customer-id'];
      const { challengeId } = req.params;

      if (!userId) {
        return res.status(400).json({ ok: false, error: 'userId required' });
      }

      // Check if challenge exists and is joinable
      const challengeResult = await pool.query(
        'SELECT * FROM hc_challenges WHERE id = $1',
        [challengeId]
      );

      if (challengeResult.rows.length === 0) {
        return res.status(404).json({ ok: false, error: 'Challenge not found' });
      }

      const challenge = challengeResult.rows[0];

      if (challenge.status === 'completed' || challenge.status === 'cancelled') {
        return res.status(400).json({ ok: false, error: 'Challenge is not joinable' });
      }

      if (challenge.max_participants && challenge.participant_count >= challenge.max_participants) {
        return res.status(400).json({ ok: false, error: 'Challenge is full' });
      }

      // Join
      const result = await pool.query(
        `INSERT INTO hc_challenge_participants (challenge_id, user_id)
         VALUES ($1, $2)
         ON CONFLICT (challenge_id, user_id) DO NOTHING
         RETURNING *`,
        [challengeId, userId]
      );

      if (result.rows.length === 0) {
        return res.status(400).json({ ok: false, error: 'Already joined this challenge' });
      }

      // Update participant count
      await pool.query(
        'UPDATE hc_challenges SET participant_count = participant_count + 1 WHERE id = $1',
        [challengeId]
      );

      return res.json({ ok: true, data: result.rows[0] });
    } catch (error) {
      console.error('[Social] Join challenge error:', error);
      return res.status(500).json({ ok: false, error: 'Failed to join challenge' });
    }
  });

  // GET /api/v1/social/challenges/:challengeId/leaderboard
  router.get('/challenges/:challengeId/leaderboard', async (req: Request, res: Response) => {
    try {
      const { challengeId } = req.params;

      const result = await pool.query(
        `SELECT cp.*, p.display_name, p.avatar_url
         FROM hc_challenge_participants cp
         JOIN hc_user_profiles p ON cp.user_id = p.user_id
         WHERE cp.challenge_id = $1
         ORDER BY cp.current_value DESC, cp.last_updated ASC`,
        [challengeId]
      );

      // Assign ranks
      const entries = result.rows.map((row, index) => ({
        rank: index + 1,
        user_id: row.user_id,
        display_name: row.display_name,
        avatar_url: row.avatar_url,
        current_value: parseFloat(row.current_value),
        progress_percent: 0,  // Would need target from challenge
        trend: 'stable' as const,
      }));

      return res.json({
        ok: true,
        data: {
          challenge_id: challengeId,
          entries,
          last_updated: new Date(),
        },
      });
    } catch (error) {
      console.error('[Social] Get leaderboard error:', error);
      return res.status(500).json({ ok: false, error: 'Failed to get leaderboard' });
    }
  });

  // ==========================================================================
  // Sharing Endpoints
  // ==========================================================================

  // POST /api/v1/social/share
  router.post('/share', async (req: Request, res: Response) => {
    try {
      const userId = req.body.userId || req.headers['x-shopify-customer-id'];

      if (!userId) {
        return res.status(400).json({ ok: false, error: 'userId required' });
      }

      const {
        share_type,
        content_id,
        visibility,
        shared_with_ids,
        preview_text,
        preview_image_url,
      } = req.body;

      if (!share_type || !content_id) {
        return res.status(400).json({ ok: false, error: 'share_type and content_id required' });
      }

      const result = await pool.query(
        `INSERT INTO hc_shares
         (user_id, share_type, content_id, visibility, shared_with_ids, preview_text, preview_image_url)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [userId, share_type, content_id, visibility || 'friends', shared_with_ids, preview_text, preview_image_url]
      );

      return res.status(201).json({ ok: true, data: result.rows[0] });
    } catch (error) {
      console.error('[Social] Share error:', error);
      return res.status(500).json({ ok: false, error: 'Failed to create share' });
    }
  });

  // GET /api/v1/social/feed
  router.get('/feed', async (req: Request, res: Response) => {
    try {
      const userId = req.query.userId as string || req.headers['x-shopify-customer-id'] as string;
      const limit = parseInt(req.query.limit as string) || 20;
      const cursor = req.query.cursor as string;

      if (!userId) {
        return res.status(400).json({ ok: false, error: 'userId required' });
      }

      // Get friend IDs
      const friendsResult = await pool.query(
        `SELECT CASE WHEN requester_id = $1 THEN recipient_id ELSE requester_id END as friend_id
         FROM hc_user_connections
         WHERE (requester_id = $1 OR recipient_id = $1) AND status = 'accepted'`,
        [userId]
      );

      const friendIds = friendsResult.rows.map(r => r.friend_id);
      friendIds.push(userId);  // Include own posts

      // Get shares from friends
      let sql = `
        SELECT s.*, p.display_name, p.avatar_url
        FROM hc_shares s
        JOIN hc_user_profiles p ON s.user_id = p.user_id
        WHERE s.user_id = ANY($1)
          AND (s.visibility = 'public' OR s.visibility = 'friends')
      `;
      const params: any[] = [friendIds];

      if (cursor) {
        sql += ' AND s.created_at < $2';
        params.push(cursor);
      }

      sql += ' ORDER BY s.created_at DESC LIMIT $' + (params.length + 1);
      params.push(limit + 1);  // +1 to check for more

      const result = await pool.query(sql, params);

      const hasMore = result.rows.length > limit;
      const items = result.rows.slice(0, limit).map(row => ({
        id: row.id,
        type: 'share',
        user: {
          user_id: row.user_id,
          display_name: row.display_name,
          avatar_url: row.avatar_url,
        },
        content: {
          share_type: row.share_type,
          content_id: row.content_id,
          preview_text: row.preview_text,
          preview_image_url: row.preview_image_url,
          like_count: row.like_count,
          comment_count: row.comment_count,
        },
        created_at: row.created_at,
      }));

      return res.json({
        ok: true,
        data: {
          items,
          has_more: hasMore,
          next_cursor: hasMore ? items[items.length - 1].created_at : undefined,
        },
      });
    } catch (error) {
      console.error('[Social] Get feed error:', error);
      return res.status(500).json({ ok: false, error: 'Failed to get feed' });
    }
  });

  // POST /api/v1/social/shares/:shareId/like
  router.post('/shares/:shareId/like', async (req: Request, res: Response) => {
    try {
      const userId = req.body.userId || req.headers['x-shopify-customer-id'];
      const { shareId } = req.params;

      if (!userId) {
        return res.status(400).json({ ok: false, error: 'userId required' });
      }

      await pool.query(
        `INSERT INTO hc_share_likes (share_id, user_id)
         VALUES ($1, $2)
         ON CONFLICT (share_id, user_id) DO NOTHING`,
        [shareId, userId]
      );

      await pool.query(
        'UPDATE hc_shares SET like_count = like_count + 1 WHERE id = $1',
        [shareId]
      );

      return res.json({ ok: true, message: 'Liked' });
    } catch (error) {
      console.error('[Social] Like error:', error);
      return res.status(500).json({ ok: false, error: 'Failed to like' });
    }
  });

  // ==========================================================================
  // Notification Endpoints
  // ==========================================================================

  // GET /api/v1/social/notifications
  router.get('/notifications', async (req: Request, res: Response) => {
    try {
      const userId = req.query.userId as string || req.headers['x-shopify-customer-id'] as string;
      const unreadOnly = req.query.unread_only === 'true';

      if (!userId) {
        return res.status(400).json({ ok: false, error: 'userId required' });
      }

      let sql = 'SELECT * FROM hc_notifications WHERE user_id = $1';
      if (unreadOnly) {
        sql += ' AND read = false';
      }
      sql += ' ORDER BY created_at DESC LIMIT 50';

      const result = await pool.query(sql, [userId]);

      // Get unread count
      const countResult = await pool.query(
        'SELECT COUNT(*) FROM hc_notifications WHERE user_id = $1 AND read = false',
        [userId]
      );

      return res.json({
        ok: true,
        data: {
          notifications: result.rows,
          unread_count: parseInt(countResult.rows[0].count),
        },
      });
    } catch (error) {
      console.error('[Social] Get notifications error:', error);
      return res.status(500).json({ ok: false, error: 'Failed to get notifications' });
    }
  });

  // POST /api/v1/social/notifications/mark-read
  router.post('/notifications/mark-read', async (req: Request, res: Response) => {
    try {
      const userId = req.body.userId || req.headers['x-shopify-customer-id'];
      const { notification_ids, mark_all } = req.body;

      if (!userId) {
        return res.status(400).json({ ok: false, error: 'userId required' });
      }

      if (mark_all) {
        await pool.query(
          `UPDATE hc_notifications SET read = true, read_at = NOW()
           WHERE user_id = $1 AND read = false`,
          [userId]
        );
      } else if (notification_ids?.length) {
        await pool.query(
          `UPDATE hc_notifications SET read = true, read_at = NOW()
           WHERE user_id = $1 AND id = ANY($2)`,
          [userId, notification_ids]
        );
      }

      return res.json({ ok: true, message: 'Marked as read' });
    } catch (error) {
      console.error('[Social] Mark read error:', error);
      return res.status(500).json({ ok: false, error: 'Failed to mark as read' });
    }
  });

  return router;
}

// ==========================================================================
// Helper Functions
// ==========================================================================

async function createNotification(
  pool: Pool,
  userId: string,
  type: string,
  data: { title: string; body: string; action_url?: string; image_url?: string }
): Promise<void> {
  await pool.query(
    `INSERT INTO hc_notifications (user_id, type, title, body, action_url, image_url)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [userId, type, data.title, data.body, data.action_url, data.image_url]
  );
}

export default createSocialRouter;
