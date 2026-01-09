// src/db/migrations/runProductMigrations.ts
// Run all H1/H2/H3 Product Improvement migrations

import { Pool } from 'pg';
import 'dotenv/config';

const DATABASE_URL = process.env.DATABASE_URL || '';

if (!DATABASE_URL) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production'
    ? { rejectUnauthorized: false }
    : undefined,
});

// ==========================================================================
// 1. Nutrition Graph Schema
// ==========================================================================
const NUTRITION_GRAPH_SCHEMA = `
-- Enable trigram extension for fuzzy search
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Core Foods Table
CREATE TABLE IF NOT EXISTS nutrition_foods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  name_normalized TEXT GENERATED ALWAYS AS (lower(trim(name))) STORED,
  brand TEXT,
  category TEXT,
  subcategory TEXT,
  upc TEXT UNIQUE,
  canonical_food_id UUID REFERENCES nutrition_foods(id),

  -- Nutrients per serving
  calories NUMERIC NOT NULL DEFAULT 0,
  protein_g NUMERIC NOT NULL DEFAULT 0,
  carbs_g NUMERIC NOT NULL DEFAULT 0,
  fat_g NUMERIC NOT NULL DEFAULT 0,
  fiber_g NUMERIC,
  sugar_g NUMERIC,
  sodium_mg NUMERIC,
  cholesterol_mg NUMERIC,
  saturated_fat_g NUMERIC,
  trans_fat_g NUMERIC,
  potassium_mg NUMERIC,
  vitamin_a_iu NUMERIC,
  vitamin_c_mg NUMERIC,
  calcium_mg NUMERIC,
  iron_mg NUMERIC,

  -- Serving size
  serving_amount NUMERIC NOT NULL DEFAULT 1,
  serving_unit TEXT NOT NULL DEFAULT 'serving',
  serving_grams NUMERIC NOT NULL DEFAULT 100,
  serving_description TEXT,

  -- Quality & verification
  verification_status TEXT NOT NULL DEFAULT 'unverified'
    CHECK (verification_status IN ('unverified', 'scraped', 'verified', 'canonical')),
  quality_score INTEGER NOT NULL DEFAULT 0 CHECK (quality_score >= 0 AND quality_score <= 100),
  source TEXT NOT NULL DEFAULT 'user'
    CHECK (source IN ('usda', 'branded', 'user', 'scraped', 'calculated')),
  source_url TEXT,
  source_id TEXT,

  -- Arrays stored as JSONB
  tags JSONB DEFAULT '[]'::jsonb,
  allergens JSONB DEFAULT '[]'::jsonb,
  dietary_flags JSONB DEFAULT '[]'::jsonb,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  verified_at TIMESTAMPTZ,
  verified_by TEXT
);

-- Indexes for search performance
CREATE INDEX IF NOT EXISTS idx_nutrition_foods_name_trgm
  ON nutrition_foods USING GIN (name_normalized gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_nutrition_foods_brand
  ON nutrition_foods (lower(brand)) WHERE brand IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_nutrition_foods_category
  ON nutrition_foods (category) WHERE category IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_nutrition_foods_upc
  ON nutrition_foods (upc) WHERE upc IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_nutrition_foods_verification
  ON nutrition_foods (verification_status);
CREATE INDEX IF NOT EXISTS idx_nutrition_foods_quality
  ON nutrition_foods (quality_score DESC);
CREATE INDEX IF NOT EXISTS idx_nutrition_foods_canonical
  ON nutrition_foods (canonical_food_id) WHERE canonical_food_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_nutrition_foods_dietary
  ON nutrition_foods USING GIN (dietary_flags);

-- Store Mappings Table (Instacart, Walmart, etc.)
CREATE TABLE IF NOT EXISTS nutrition_store_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  food_id UUID NOT NULL REFERENCES nutrition_foods(id) ON DELETE CASCADE,
  store TEXT NOT NULL CHECK (store IN ('instacart', 'walmart', 'amazon_fresh', 'kroger')),
  product_id TEXT NOT NULL,
  product_name TEXT NOT NULL,
  price_cents INTEGER,
  price_per_unit NUMERIC,
  unit TEXT,
  available BOOLEAN NOT NULL DEFAULT true,
  last_checked TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (food_id, store, product_id)
);

CREATE INDEX IF NOT EXISTS idx_store_mappings_food
  ON nutrition_store_mappings (food_id);
CREATE INDEX IF NOT EXISTS idx_store_mappings_store_product
  ON nutrition_store_mappings (store, product_id);
CREATE INDEX IF NOT EXISTS idx_store_mappings_available
  ON nutrition_store_mappings (store, available) WHERE available = true;

-- Verification Audit Log
CREATE TABLE IF NOT EXISTS nutrition_verification_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  food_id UUID NOT NULL REFERENCES nutrition_foods(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN ('approve', 'reject', 'merge', 'edit', 'create')),
  previous_status TEXT,
  new_status TEXT,
  previous_quality_score INTEGER,
  new_quality_score INTEGER,
  merge_into_id UUID REFERENCES nutrition_foods(id),
  corrections JSONB,
  verified_by TEXT NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_verification_log_food
  ON nutrition_verification_log (food_id);
CREATE INDEX IF NOT EXISTS idx_verification_log_time
  ON nutrition_verification_log (created_at DESC);

-- Recipe Ingredients (for composite foods)
CREATE TABLE IF NOT EXISTS nutrition_recipe_ingredients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_id UUID NOT NULL REFERENCES nutrition_foods(id) ON DELETE CASCADE,
  ingredient_food_id UUID NOT NULL REFERENCES nutrition_foods(id) ON DELETE RESTRICT,
  amount NUMERIC NOT NULL,
  unit TEXT NOT NULL,
  grams NUMERIC NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_recipe_ingredients_recipe
  ON nutrition_recipe_ingredients (recipe_id);

-- Updated timestamp trigger
CREATE OR REPLACE FUNCTION update_nutrition_foods_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_nutrition_foods_updated_at ON nutrition_foods;
CREATE TRIGGER trigger_nutrition_foods_updated_at
  BEFORE UPDATE ON nutrition_foods
  FOR EACH ROW
  EXECUTE FUNCTION update_nutrition_foods_updated_at();
`;

// ==========================================================================
// 2. Programs Schema
// ==========================================================================
const PROGRAMS_SCHEMA = `
-- Programs table (definitions)
CREATE TABLE IF NOT EXISTS hc_programs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type VARCHAR(50) NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  duration_days INTEGER NOT NULL,
  difficulty VARCHAR(20) DEFAULT 'beginner',
  category VARCHAR(100),

  days JSONB NOT NULL DEFAULT '[]',
  min_completion_rate DECIMAL(3,2) DEFAULT 0.70,

  thumbnail_url TEXT,
  coach_name VARCHAR(100),
  estimated_daily_minutes INTEGER DEFAULT 15,
  requires_programs UUID[],

  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- User program enrollments
CREATE TABLE IF NOT EXISTS hc_program_enrollments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR(100) NOT NULL,
  program_id UUID NOT NULL REFERENCES hc_programs(id),

  status VARCHAR(20) DEFAULT 'active',
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  paused_at TIMESTAMPTZ,

  current_day INTEGER DEFAULT 1,
  days_completed INTEGER DEFAULT 0,
  tasks_completed INTEGER DEFAULT 0,
  total_tasks INTEGER DEFAULT 0,
  completion_rate DECIMAL(3,2) DEFAULT 0,

  total_time_spent_minutes INTEGER DEFAULT 0,
  streak_days INTEGER DEFAULT 0,
  longest_streak INTEGER DEFAULT 0,
  points_earned INTEGER DEFAULT 0,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(user_id, program_id)
);

-- Day-level progress
CREATE TABLE IF NOT EXISTS hc_program_day_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id UUID NOT NULL REFERENCES hc_program_enrollments(id) ON DELETE CASCADE,
  day INTEGER NOT NULL,

  status VARCHAR(20) DEFAULT 'locked',
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,

  tasks_completed INTEGER DEFAULT 0,
  total_tasks INTEGER DEFAULT 0,
  time_spent_minutes INTEGER DEFAULT 0,

  created_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(enrollment_id, day)
);

-- Task responses
CREATE TABLE IF NOT EXISTS hc_program_task_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id UUID NOT NULL REFERENCES hc_program_enrollments(id) ON DELETE CASCADE,
  task_id VARCHAR(100) NOT NULL,
  day INTEGER NOT NULL,

  completed BOOLEAN DEFAULT false,
  completed_at TIMESTAMPTZ,
  time_spent_seconds INTEGER,

  response_data JSONB,
  quiz_score INTEGER,
  quiz_passed BOOLEAN,

  points_awarded INTEGER DEFAULT 0,

  created_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(enrollment_id, task_id)
);

-- Habit loops
CREATE TABLE IF NOT EXISTS hc_habit_loops (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR(100) NOT NULL,

  habit_name VARCHAR(255) NOT NULL,
  cue TEXT,
  routine TEXT,
  reward TEXT,

  frequency VARCHAR(20) DEFAULT 'daily',
  custom_days INTEGER[],
  target_time TIME,

  current_streak INTEGER DEFAULT 0,
  longest_streak INTEGER DEFAULT 0,
  total_completions INTEGER DEFAULT 0,
  completion_rate DECIMAL(3,2) DEFAULT 0,

  level INTEGER DEFAULT 1,
  points_per_completion INTEGER DEFAULT 10,

  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Habit completions
CREATE TABLE IF NOT EXISTS hc_habit_completions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  habit_id UUID NOT NULL REFERENCES hc_habit_loops(id) ON DELETE CASCADE,
  user_id VARCHAR(100) NOT NULL,

  completed_at TIMESTAMPTZ DEFAULT NOW(),
  notes TEXT,
  mood_rating INTEGER,
  points_awarded INTEGER DEFAULT 0,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Program reminders
CREATE TABLE IF NOT EXISTS hc_program_reminders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR(100) NOT NULL,
  program_id UUID REFERENCES hc_programs(id),
  habit_id UUID REFERENCES hc_habit_loops(id),

  type VARCHAR(50) NOT NULL,
  scheduled_at TIMESTAMPTZ NOT NULL,
  sent_at TIMESTAMPTZ,

  title VARCHAR(255) NOT NULL,
  body TEXT,
  deep_link TEXT,

  push_enabled BOOLEAN DEFAULT true,
  email_enabled BOOLEAN DEFAULT false,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_enrollments_user ON hc_program_enrollments(user_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_status ON hc_program_enrollments(status);
CREATE INDEX IF NOT EXISTS idx_day_progress_enrollment ON hc_program_day_progress(enrollment_id);
CREATE INDEX IF NOT EXISTS idx_task_responses_enrollment ON hc_program_task_responses(enrollment_id);
CREATE INDEX IF NOT EXISTS idx_habits_user ON hc_habit_loops(user_id);
CREATE INDEX IF NOT EXISTS idx_habit_completions_habit ON hc_habit_completions(habit_id);
CREATE INDEX IF NOT EXISTS idx_reminders_scheduled ON hc_program_reminders(scheduled_at) WHERE sent_at IS NULL;
`;

// ==========================================================================
// 3. Body Scan Reports Schema
// ==========================================================================
const BODY_SCAN_REPORTS_SCHEMA = `
-- Drop existing tables to ensure clean state (removes corrupted tables)
DROP TABLE IF EXISTS hc_body_goals CASCADE;
DROP TABLE IF EXISTS hc_recomp_reports CASCADE;
DROP TABLE IF EXISTS hc_body_measurements CASCADE;
DROP TABLE IF EXISTS hc_progress_photos CASCADE;

-- Progress photos
CREATE TABLE IF NOT EXISTS hc_progress_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR(100) NOT NULL,
  photo_type VARCHAR(50) NOT NULL,
  photo_url TEXT NOT NULL,
  thumbnail_url TEXT,
  taken_at TIMESTAMPTZ DEFAULT NOW(),
  condition VARCHAR(100),
  lighting_notes TEXT,
  weight_lbs DECIMAL(5,1),
  body_fat_percent DECIMAL(4,1),
  tags TEXT[],
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Body measurements
CREATE TABLE IF NOT EXISTS hc_body_measurements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR(100) NOT NULL,
  measured_at TIMESTAMPTZ DEFAULT NOW(),
  weight_lbs DECIMAL(5,1) NOT NULL,
  body_fat_percent DECIMAL(4,1),
  lean_mass_lbs DECIMAL(5,1),
  fat_mass_lbs DECIMAL(5,1),
  waist_inches DECIMAL(4,1),
  hip_inches DECIMAL(4,1),
  chest_inches DECIMAL(4,1),
  arm_inches DECIMAL(4,1),
  thigh_inches DECIMAL(4,1),
  neck_inches DECIMAL(4,1),
  bmi DECIMAL(4,1),
  waist_to_hip_ratio DECIMAL(3,2),
  source VARCHAR(50) DEFAULT 'manual',
  device_name VARCHAR(100),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Recomposition reports
CREATE TABLE IF NOT EXISTS hc_recomp_reports (
  id UUID PRIMARY KEY,
  user_id VARCHAR(100) NOT NULL,
  report_data JSONB NOT NULL,
  generated_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Body goals
CREATE TABLE IF NOT EXISTS hc_body_goals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR(100) NOT NULL,
  goal_type VARCHAR(50) NOT NULL,
  target_weight_lbs DECIMAL(5,1),
  target_body_fat_percent DECIMAL(4,1),
  target_lean_mass_lbs DECIMAL(5,1),
  target_date DATE,
  aggressive BOOLEAN DEFAULT false,
  starting_weight_lbs DECIMAL(5,1),
  starting_body_fat_percent DECIMAL(4,1),
  current_weight_lbs DECIMAL(5,1),
  current_body_fat_percent DECIMAL(4,1),
  percent_complete DECIMAL(5,2) DEFAULT 0,
  status VARCHAR(20) DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_progress_photos_user ON hc_progress_photos(user_id);
CREATE INDEX IF NOT EXISTS idx_progress_photos_taken ON hc_progress_photos(taken_at DESC);
CREATE INDEX IF NOT EXISTS idx_body_measurements_user ON hc_body_measurements(user_id);
CREATE INDEX IF NOT EXISTS idx_body_measurements_date ON hc_body_measurements(measured_at DESC);
CREATE INDEX IF NOT EXISTS idx_recomp_reports_user ON hc_recomp_reports(user_id);
CREATE INDEX IF NOT EXISTS idx_body_goals_user ON hc_body_goals(user_id);
`;

// ==========================================================================
// 4. Social Schema
// ==========================================================================
const SOCIAL_SCHEMA = `
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
// 5. Import Schema
// ==========================================================================
const IMPORT_SCHEMA = `
-- Import jobs
CREATE TABLE IF NOT EXISTS hc_import_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR(100) NOT NULL,
  source VARCHAR(50) NOT NULL,
  status VARCHAR(20) DEFAULT 'pending',
  file_url TEXT,
  file_name VARCHAR(255),
  file_size_bytes BIGINT,
  oauth_token TEXT,
  oauth_refresh_token TEXT,
  total_records INTEGER,
  imported_records INTEGER DEFAULT 0,
  failed_records INTEGER DEFAULT 0,
  error_messages TEXT[],
  import_from TIMESTAMPTZ,
  import_to TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Imported foods (mapped to our database)
CREATE TABLE IF NOT EXISTS hc_imported_foods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  import_job_id UUID NOT NULL REFERENCES hc_import_jobs(id) ON DELETE CASCADE,
  user_id VARCHAR(100) NOT NULL,
  original_name VARCHAR(500) NOT NULL,
  original_brand VARCHAR(255),
  original_calories INTEGER,
  original_protein_g DECIMAL(8,2),
  original_carbs_g DECIMAL(8,2),
  original_fat_g DECIMAL(8,2),
  nutrition_food_id UUID,
  mapping_confidence DECIMAL(3,2) DEFAULT 0,
  logged_at TIMESTAMPTZ,
  meal_type VARCHAR(50),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_import_jobs_user ON hc_import_jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_import_jobs_status ON hc_import_jobs(status);
CREATE INDEX IF NOT EXISTS idx_imported_foods_job ON hc_imported_foods(import_job_id);
CREATE INDEX IF NOT EXISTS idx_imported_foods_user ON hc_imported_foods(user_id);
`;

// ==========================================================================
// 6. Food Preferences Schema
// ==========================================================================
const FOOD_PREFERENCES_SCHEMA = `
-- Food preferences table
CREATE TABLE IF NOT EXISTS food_preferences (
  id SERIAL PRIMARY KEY,
  customer_id VARCHAR(255) UNIQUE NOT NULL,

  -- Meal preferences
  meal_style VARCHAR(50) NOT NULL CHECK (meal_style IN ('threePlusSnacks', 'fewerLarger')),
  meal_diversity VARCHAR(50) NOT NULL CHECK (meal_diversity IN ('diverse', 'sameDaily')),

  -- Food selections (stored as arrays)
  favorite_proteins TEXT[] NOT NULL DEFAULT '{}',
  favorite_fruits TEXT[] NOT NULL DEFAULT '{}',
  favorite_cuisines TEXT[] NOT NULL DEFAULT '{}',
  favorite_snacks TEXT[] NOT NULL DEFAULT '{}',

  -- Text preferences
  top_foods TEXT[] NOT NULL DEFAULT '{}',
  hated_foods TEXT DEFAULT '',

  -- Schedule
  cheat_days TEXT[] NOT NULL DEFAULT '{}',
  eat_out_frequency INTEGER NOT NULL DEFAULT 0 CHECK (eat_out_frequency >= 0 AND eat_out_frequency <= 7),

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Foreign key
  CONSTRAINT fk_customer FOREIGN KEY (customer_id) REFERENCES shopify_customers(id) ON DELETE CASCADE
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_food_prefs_customer_id ON food_preferences(customer_id);

-- Table comment
COMMENT ON TABLE food_preferences IS 'User food preferences for personalized meal planning';
`;

// ==========================================================================
// Run All Migrations
// ==========================================================================
async function runMigrations() {
  console.log('Starting Product Improvement migrations...\n');

  const migrations = [
    { name: 'Nutrition Graph', schema: NUTRITION_GRAPH_SCHEMA },
    { name: 'Programs', schema: PROGRAMS_SCHEMA },
    { name: 'Body Scan Reports', schema: BODY_SCAN_REPORTS_SCHEMA },
    { name: 'Social', schema: SOCIAL_SCHEMA },
    { name: 'Import', schema: IMPORT_SCHEMA },
    { name: 'Food Preferences', schema: FOOD_PREFERENCES_SCHEMA },
  ];

  for (const migration of migrations) {
    try {
      console.log(`Running: ${migration.name}...`);
      await pool.query(migration.schema);
      console.log(`✓ ${migration.name} completed\n`);
    } catch (error: any) {
      console.error(`✗ ${migration.name} failed:`, error.message);
      // Continue with other migrations
    }
  }

  console.log('All migrations completed!');
  await pool.end();
}

runMigrations().catch(console.error);
