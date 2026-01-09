-- Migration: Create food_preferences table
-- Description: Stores user food preferences for meal planning

CREATE TABLE IF NOT EXISTS food_preferences (
  id SERIAL PRIMARY KEY,
  customer_id VARCHAR(255) UNIQUE NOT NULL,

  -- Meal preferences
  meal_style VARCHAR(50) NOT NULL CHECK (meal_style IN ('threePlusSnacks', 'fewerLarger')),
  meal_diversity VARCHAR(50) NOT NULL CHECK (meal_diversity IN ('diverse', 'sameDaily')),

  -- Food selections (stored as JSON arrays)
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
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  -- Index for faster lookups
  CONSTRAINT fk_customer FOREIGN KEY (customer_id) REFERENCES shopify_customers(id) ON DELETE CASCADE
);

-- Create index on customer_id for faster queries
CREATE INDEX IF NOT EXISTS idx_food_prefs_customer_id ON food_preferences(customer_id);

-- Add comment
COMMENT ON TABLE food_preferences IS 'User food preferences for personalized meal planning';
