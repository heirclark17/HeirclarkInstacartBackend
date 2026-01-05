// src/types/social.ts
// Social & Ecosystem Types for Heirclark
// Supports friends, challenges, sharing, and data import features

// ==========================================================================
// User Connection Types
// ==========================================================================

export type ConnectionStatus = 'pending' | 'accepted' | 'blocked';
export type ConnectionType = 'friend' | 'coach' | 'accountability_partner';

export interface UserConnection {
  id: string;
  requester_id: string;
  recipient_id: string;
  connection_type: ConnectionType;
  status: ConnectionStatus;

  // Metadata
  message?: string;  // Optional request message
  accepted_at?: Date;
  created_at: Date;
}

export interface UserProfile {
  user_id: string;
  display_name: string;
  avatar_url?: string;

  // Privacy settings
  profile_visibility: 'public' | 'friends_only' | 'private';
  show_progress: boolean;
  show_meal_plans: boolean;
  show_workouts: boolean;

  // Stats for public display
  days_active: number;
  current_streak: number;
  programs_completed: number;
  challenges_won: number;

  // Optional bio
  bio?: string;
  goal_summary?: string;  // "Losing weight", "Building muscle", etc.

  created_at: Date;
  updated_at: Date;
}

// ==========================================================================
// Challenge Types
// ==========================================================================

export type ChallengeType =
  | 'steps'           // Step count challenge
  | 'calories_burned' // Active calories challenge
  | 'workout_count'   // Number of workouts
  | 'meal_logging'    // Consistency in logging
  | 'protein_target'  // Hit protein target each day
  | 'weight_loss'     // Weight loss percentage
  | 'custom';         // Custom metric

export type ChallengeStatus = 'upcoming' | 'active' | 'completed' | 'cancelled';

export interface Challenge {
  id: string;
  name: string;
  description: string;
  challenge_type: ChallengeType;

  // Timing
  start_date: Date;
  end_date: Date;
  status: ChallengeStatus;

  // Goal
  target_value: number;
  target_unit: string;  // "steps", "calories", "days", "%", etc.
  scoring_method: 'total' | 'average' | 'consistency' | 'improvement';

  // Participants
  creator_id: string;
  is_public: boolean;
  max_participants?: number;
  participant_count: number;

  // Stakes (optional)
  stake_description?: string;  // "Loser buys winner coffee"
  stake_amount_cents?: number;

  // Rewards
  badge_id?: string;
  prize_description?: string;

  created_at: Date;
}

export interface ChallengeParticipant {
  id: string;
  challenge_id: string;
  user_id: string;

  // Progress
  current_value: number;
  rank: number;
  last_updated: Date;

  // Status
  joined_at: Date;
  completed: boolean;
  won: boolean;
}

export interface ChallengeLeaderboard {
  challenge_id: string;
  entries: Array<{
    rank: number;
    user_id: string;
    display_name: string;
    avatar_url?: string;
    current_value: number;
    progress_percent: number;
    trend: 'up' | 'down' | 'stable';
  }>;
  last_updated: Date;
}

// ==========================================================================
// Sharing Types
// ==========================================================================

export type ShareType =
  | 'meal_plan'
  | 'recipe'
  | 'progress_photo'
  | 'achievement'
  | 'challenge_result'
  | 'weight_milestone';

export interface Share {
  id: string;
  user_id: string;
  share_type: ShareType;
  content_id: string;  // ID of the shared item

  // Visibility
  visibility: 'public' | 'friends' | 'specific_users';
  shared_with_ids?: string[];  // For specific_users

  // Content preview
  preview_text?: string;
  preview_image_url?: string;

  // Engagement
  like_count: number;
  comment_count: number;

  created_at: Date;
  expires_at?: Date;
}

export interface ShareComment {
  id: string;
  share_id: string;
  user_id: string;
  content: string;
  created_at: Date;
}

export interface ShareLike {
  id: string;
  share_id: string;
  user_id: string;
  created_at: Date;
}

// ==========================================================================
// Achievement & Badge Types
// ==========================================================================

export type BadgeCategory =
  | 'streak'          // Consistency badges
  | 'milestone'       // Weight loss milestones, etc.
  | 'challenge'       // Challenge participation/wins
  | 'social'          // Social engagement
  | 'nutrition'       // Nutrition-specific
  | 'activity';       // Activity-specific

export interface Badge {
  id: string;
  name: string;
  description: string;
  category: BadgeCategory;

  // Visual
  icon_url: string;
  color: string;

  // Rarity
  rarity: 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';

  // Requirements
  requirement_description: string;
  requirement_value?: number;

  // Points
  points: number;

  created_at: Date;
}

export interface UserBadge {
  id: string;
  user_id: string;
  badge_id: string;
  earned_at: Date;
  context?: string;  // "30-day streak", "Lost 10 lbs", etc.
}

// ==========================================================================
// Notification Types
// ==========================================================================

export type NotificationType =
  | 'friend_request'
  | 'friend_accepted'
  | 'challenge_invite'
  | 'challenge_started'
  | 'challenge_ended'
  | 'leaderboard_update'
  | 'like_received'
  | 'comment_received'
  | 'badge_earned'
  | 'milestone_reached'
  | 'streak_at_risk';

export interface Notification {
  id: string;
  user_id: string;
  type: NotificationType;

  title: string;
  body: string;
  image_url?: string;

  // Action
  action_url?: string;
  action_data?: Record<string, any>;

  // Status
  read: boolean;
  read_at?: Date;
  created_at: Date;
}

// ==========================================================================
// Data Import Types
// ==========================================================================

export type ImportSource =
  | 'myfitnesspal'
  | 'loseit'
  | 'cronometer'
  | 'fitbit'
  | 'apple_health'
  | 'csv';

export type ImportStatus =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'partial';

export interface DataImportJob {
  id: string;
  user_id: string;
  source: ImportSource;
  status: ImportStatus;

  // File info
  file_url?: string;
  file_name?: string;
  file_size_bytes?: number;

  // OAuth (for connected imports)
  oauth_token?: string;
  oauth_refresh_token?: string;

  // Progress
  total_records?: number;
  imported_records: number;
  failed_records: number;
  error_messages: string[];

  // Date range
  import_from?: Date;
  import_to?: Date;

  // Timing
  started_at?: Date;
  completed_at?: Date;
  created_at: Date;
}

export interface ImportedFood {
  id: string;
  import_job_id: string;
  user_id: string;

  // Original data
  original_name: string;
  original_brand?: string;
  original_calories: number;
  original_protein_g?: number;
  original_carbs_g?: number;
  original_fat_g?: number;

  // Mapped to our database
  nutrition_food_id?: string;
  mapping_confidence: number;  // 0-1

  logged_at: Date;
  meal_type?: string;

  created_at: Date;
}

// ==========================================================================
// API Response Types
// ==========================================================================

export interface FriendListResponse {
  friends: Array<{
    connection_id: string;
    user: UserProfile;
    connection_type: ConnectionType;
    connected_since: Date;
  }>;
  pending_requests: Array<{
    connection_id: string;
    user: UserProfile;
    message?: string;
    requested_at: Date;
  }>;
}

export interface ChallengeListResponse {
  active: Challenge[];
  upcoming: Challenge[];
  completed: Challenge[];
  invites: Challenge[];
}

export interface FeedItem {
  id: string;
  type: 'share' | 'challenge_update' | 'badge_earned' | 'milestone';
  user: UserProfile;
  content: Share | Challenge | UserBadge | any;
  created_at: Date;
}

export interface ActivityFeedResponse {
  items: FeedItem[];
  has_more: boolean;
  next_cursor?: string;
}
