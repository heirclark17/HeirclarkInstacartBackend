-- Migration: Add card_background column to user preferences
-- This stores the user's selected card background as JSON

ALTER TABLE hc_user_preferences
ADD COLUMN IF NOT EXISTS card_background JSONB DEFAULT NULL;

-- Add comment for documentation
COMMENT ON COLUMN hc_user_preferences.card_background IS 'User''s selected card background style. JSON with name, type (solid/gradient), and color values.';
