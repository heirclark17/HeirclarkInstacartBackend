// src/db/migrations/runFoodPrefsMigration.ts
// Run food preferences migration without foreign key constraint

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

const FOOD_PREFERENCES_SCHEMA = `
-- Food preferences table (without foreign key constraint)
CREATE TABLE IF NOT EXISTS food_preferences (
  id SERIAL PRIMARY KEY,
  customer_id VARCHAR(255) UNIQUE NOT NULL,

  -- Meal preferences
  meal_style VARCHAR(50) NOT NULL CHECK (meal_style IN ('threePlusSnacks', 'fewerLarger')),
  meal_diversity VARCHAR(50) NOT NULL CHECK (meal_diversity IN ('diverse', 'sameDaily')),

  -- Food selections (stored as arrays)
  favorite_proteins TEXT[] NOT NULL DEFAULT '{}',
  favorite_fruits TEXT[] NOT NULL DEFAULT '{}',
  favorite_vegetables TEXT[] NOT NULL DEFAULT '{}',
  favorite_starches TEXT[] NOT NULL DEFAULT '{}',
  favorite_cuisines TEXT[] NOT NULL DEFAULT '{}',
  favorite_snacks TEXT[] NOT NULL DEFAULT '{}',

  -- Text preferences
  top_foods TEXT[] DEFAULT '{}',
  hated_foods TEXT DEFAULT '',

  -- Schedule (optional)
  cheat_days TEXT[] DEFAULT '{}',
  eat_out_frequency INTEGER DEFAULT 0 CHECK (eat_out_frequency >= 0 AND eat_out_frequency <= 7),

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_food_prefs_customer_id ON food_preferences(customer_id);

-- Table comment
COMMENT ON TABLE food_preferences IS 'User food preferences for personalized meal planning';
`;

const UPDATE_EXISTING_SCHEMA = `
-- Add new columns if they don't exist
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='food_preferences' AND column_name='favorite_vegetables') THEN
    ALTER TABLE food_preferences ADD COLUMN favorite_vegetables TEXT[] DEFAULT '{}';
    ALTER TABLE food_preferences ALTER COLUMN favorite_vegetables SET NOT NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='food_preferences' AND column_name='favorite_starches') THEN
    ALTER TABLE food_preferences ADD COLUMN favorite_starches TEXT[] DEFAULT '{}';
    ALTER TABLE food_preferences ALTER COLUMN favorite_starches SET NOT NULL;
  END IF;
END $$;

-- Make old columns nullable (for backward compatibility)
DO $$
BEGIN
  ALTER TABLE food_preferences ALTER COLUMN top_foods DROP NOT NULL;
  ALTER TABLE food_preferences ALTER COLUMN cheat_days DROP NOT NULL;
  ALTER TABLE food_preferences ALTER COLUMN eat_out_frequency DROP NOT NULL;
EXCEPTION
  WHEN OTHERS THEN
    -- Ignore errors if constraints don't exist
    NULL;
END $$;

-- Update existing rows to have default values for new columns
UPDATE food_preferences
SET favorite_vegetables = COALESCE(favorite_vegetables, '{}'),
    favorite_starches = COALESCE(favorite_starches, '{}')
WHERE favorite_vegetables IS NULL OR favorite_starches IS NULL;
`;

async function runMigration() {
  console.log('Starting food preferences migration...\n');

  try {
    console.log('Creating food_preferences table...');
    await pool.query(FOOD_PREFERENCES_SCHEMA);
    console.log('✓ Food preferences table created successfully\n');

    console.log('Updating existing schema (adding new columns)...');
    await pool.query(UPDATE_EXISTING_SCHEMA);
    console.log('✓ Schema updated successfully\n');
  } catch (error: any) {
    console.error('✗ Migration failed:', error.message);
    process.exit(1);
  }

  await pool.end();
  console.log('Migration complete!');
}

runMigration().catch(console.error);
