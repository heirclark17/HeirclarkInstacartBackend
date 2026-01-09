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
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_food_prefs_customer_id ON food_preferences(customer_id);

-- Table comment
COMMENT ON TABLE food_preferences IS 'User food preferences for personalized meal planning';
`;

async function runMigration() {
  console.log('Starting food preferences migration...\n');

  try {
    console.log('Creating food_preferences table...');
    await pool.query(FOOD_PREFERENCES_SCHEMA);
    console.log('✓ Food preferences table created successfully\n');
  } catch (error: any) {
    console.error('✗ Migration failed:', error.message);
    process.exit(1);
  }

  await pool.end();
  console.log('Migration complete!');
}

runMigration().catch(console.error);
