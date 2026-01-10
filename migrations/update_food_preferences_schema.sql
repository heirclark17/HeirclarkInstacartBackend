-- Migration: Update food_preferences table schema
-- Remove: topFoods, eatOutFrequency
-- Add: favoriteVegetables, favoriteStarches
-- Make cheatDays optional

-- Add new columns
ALTER TABLE food_preferences
ADD COLUMN IF NOT EXISTS favorite_vegetables TEXT[] DEFAULT '{}',
ADD COLUMN IF NOT EXISTS favorite_starches TEXT[] DEFAULT '{}';

-- Make old columns nullable (for backward compatibility)
ALTER TABLE food_preferences
ALTER COLUMN top_foods DROP NOT NULL,
ALTER COLUMN eat_out_frequency DROP NOT NULL,
ALTER COLUMN cheat_days DROP NOT NULL;

-- Update existing rows to have empty arrays for new fields
UPDATE food_preferences
SET favorite_vegetables = '{}', favorite_starches = '{}'
WHERE favorite_vegetables IS NULL OR favorite_starches IS NULL;
