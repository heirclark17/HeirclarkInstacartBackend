-- Enhanced Features Migration
-- Adds dietary restrictions, pricing, location, social features, and image recognition

-- Add dietary and price columns to restaurant_menu_items
ALTER TABLE restaurant_menu_items
ADD COLUMN IF NOT EXISTS price_cents INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS dietary_flags JSONB DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS allergens JSONB DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS is_vegetarian BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS is_vegan BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS is_gluten_free BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS is_dairy_free BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS is_keto_friendly BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS protein_per_dollar NUMERIC(8,2) GENERATED ALWAYS AS (
  CASE WHEN price_cents > 0 THEN (protein / (price_cents::numeric / 100)) ELSE 0 END
) STORED;

-- Create indexes for dietary filtering
CREATE INDEX IF NOT EXISTS idx_restaurant_menu_items_vegetarian
  ON restaurant_menu_items(restaurant_id) WHERE is_vegetarian = true;
CREATE INDEX IF NOT EXISTS idx_restaurant_menu_items_vegan
  ON restaurant_menu_items(restaurant_id) WHERE is_vegan = true;
CREATE INDEX IF NOT EXISTS idx_restaurant_menu_items_gluten_free
  ON restaurant_menu_items(restaurant_id) WHERE is_gluten_free = true;
CREATE INDEX IF NOT EXISTS idx_restaurant_menu_items_dietary_flags
  ON restaurant_menu_items USING GIN (dietary_flags);
CREATE INDEX IF NOT EXISTS idx_restaurant_menu_items_allergens
  ON restaurant_menu_items USING GIN (allergens);
CREATE INDEX IF NOT EXISTS idx_restaurant_menu_items_price
  ON restaurant_menu_items(restaurant_id, price_cents);

-- Restaurant locations table
CREATE TABLE IF NOT EXISTS restaurant_locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id VARCHAR(100) NOT NULL,
  restaurant_name VARCHAR(255) NOT NULL,

  -- Location data
  place_id VARCHAR(255) UNIQUE,
  address TEXT,
  city VARCHAR(100),
  state VARCHAR(50),
  zip_code VARCHAR(20),
  country VARCHAR(50) DEFAULT 'USA',

  -- Coordinates
  latitude NUMERIC(10,8),
  longitude NUMERIC(11,8),

  -- Contact
  phone VARCHAR(50),
  website TEXT,

  -- Metadata
  is_chain_location BOOLEAN DEFAULT false,
  chain_name VARCHAR(255),
  rating NUMERIC(2,1),
  total_ratings INTEGER DEFAULT 0,

  -- Hours (stored as JSONB for flexibility)
  hours JSONB,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Spatial index for nearby restaurant queries
CREATE INDEX IF NOT EXISTS idx_restaurant_locations_coords
  ON restaurant_locations USING GIST (
    ll_to_earth(latitude::float8, longitude::float8)
  );

CREATE INDEX IF NOT EXISTS idx_restaurant_locations_city
  ON restaurant_locations(city, state);

-- User favorite orders table
CREATE TABLE IF NOT EXISTS user_favorite_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR(100) NOT NULL,
  restaurant_id VARCHAR(100) NOT NULL,
  menu_item_id UUID REFERENCES restaurant_menu_items(id) ON DELETE CASCADE,

  -- Custom order details
  order_name VARCHAR(255),
  customizations TEXT,

  -- Tracking
  times_ordered INTEGER DEFAULT 1,
  last_ordered_at TIMESTAMPTZ DEFAULT NOW(),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_favorite_orders_user
  ON user_favorite_orders(user_id);
CREATE INDEX IF NOT EXISTS idx_favorite_orders_restaurant
  ON user_favorite_orders(user_id, restaurant_id);

-- User ratings and reviews
CREATE TABLE IF NOT EXISTS restaurant_item_ratings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR(100) NOT NULL,
  menu_item_id UUID NOT NULL REFERENCES restaurant_menu_items(id) ON DELETE CASCADE,
  restaurant_id VARCHAR(100) NOT NULL,

  -- Rating data
  rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  review_text TEXT,

  -- Accuracy ratings
  calories_accurate BOOLEAN,
  protein_accurate BOOLEAN,
  taste_rating INTEGER CHECK (taste_rating >= 1 AND taste_rating <= 5),
  value_rating INTEGER CHECK (value_rating >= 1 AND value_rating <= 5),

  -- Metadata
  verified_order BOOLEAN DEFAULT false,
  helpful_count INTEGER DEFAULT 0,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(user_id, menu_item_id)
);

CREATE INDEX IF NOT EXISTS idx_item_ratings_item
  ON restaurant_item_ratings(menu_item_id);
CREATE INDEX IF NOT EXISTS idx_item_ratings_user
  ON restaurant_item_ratings(user_id);
CREATE INDEX IF NOT EXISTS idx_item_ratings_rating
  ON restaurant_item_ratings(menu_item_id, rating DESC);

-- Shared orders/recommendations
CREATE TABLE IF NOT EXISTS shared_recommendations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  share_id VARCHAR(50) UNIQUE NOT NULL,
  user_id VARCHAR(100) NOT NULL,

  -- What's being shared
  restaurant_id VARCHAR(100) NOT NULL,
  restaurant_name VARCHAR(255) NOT NULL,
  menu_item_ids UUID[],

  -- Share details
  title VARCHAR(255),
  description TEXT,
  photo_url TEXT,

  -- Privacy
  visibility VARCHAR(20) DEFAULT 'public'
    CHECK (visibility IN ('public', 'friends', 'private')),

  -- Engagement
  view_count INTEGER DEFAULT 0,
  like_count INTEGER DEFAULT 0,
  save_count INTEGER DEFAULT 0,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_shared_recommendations_user
  ON shared_recommendations(user_id);
CREATE INDEX IF NOT EXISTS idx_shared_recommendations_share_id
  ON shared_recommendations(share_id);
CREATE INDEX IF NOT EXISTS idx_shared_recommendations_restaurant
  ON shared_recommendations(restaurant_id);

-- Menu photo uploads (for AI recognition)
CREATE TABLE IF NOT EXISTS menu_photo_uploads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR(100) NOT NULL,
  restaurant_id VARCHAR(100),
  restaurant_name VARCHAR(255),

  -- Photo data
  photo_url TEXT NOT NULL,
  thumbnail_url TEXT,

  -- AI analysis results
  ai_analyzed BOOLEAN DEFAULT false,
  detected_items JSONB,
  confidence_score NUMERIC(3,2),

  -- User corrections
  user_confirmed BOOLEAN DEFAULT false,
  user_corrections JSONB,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_menu_photos_user
  ON menu_photo_uploads(user_id);
CREATE INDEX IF NOT EXISTS idx_menu_photos_restaurant
  ON menu_photo_uploads(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_menu_photos_analyzed
  ON menu_photo_uploads(ai_analyzed) WHERE ai_analyzed = false;

-- User dietary preferences
CREATE TABLE IF NOT EXISTS user_dietary_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR(100) NOT NULL UNIQUE,

  -- Dietary restrictions
  is_vegetarian BOOLEAN DEFAULT false,
  is_vegan BOOLEAN DEFAULT false,
  is_gluten_free BOOLEAN DEFAULT false,
  is_dairy_free BOOLEAN DEFAULT false,
  is_keto BOOLEAN DEFAULT false,
  is_paleo BOOLEAN DEFAULT false,
  is_halal BOOLEAN DEFAULT false,
  is_kosher BOOLEAN DEFAULT false,

  -- Allergens
  allergens JSONB DEFAULT '[]'::jsonb,

  -- Dislikes
  disliked_foods JSONB DEFAULT '[]'::jsonb,

  -- Budget
  max_meal_budget_cents INTEGER,
  prefer_value_options BOOLEAN DEFAULT false,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Update metadata to include aggregate ratings
ALTER TABLE restaurant_metadata
ADD COLUMN IF NOT EXISTS avg_rating NUMERIC(2,1),
ADD COLUMN IF NOT EXISTS total_ratings INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS total_favorites INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS avg_price_cents INTEGER;

-- Function to update item ratings
CREATE OR REPLACE FUNCTION update_item_rating_stats()
RETURNS TRIGGER AS $$
BEGIN
  -- Update the menu item with latest rating info
  UPDATE restaurant_menu_items
  SET recommendation_count = (
    SELECT COUNT(*) FROM restaurant_item_ratings
    WHERE menu_item_id = NEW.menu_item_id
  )
  WHERE id = NEW.menu_item_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_item_ratings ON restaurant_item_ratings;
CREATE TRIGGER trigger_update_item_ratings
  AFTER INSERT OR UPDATE ON restaurant_item_ratings
  FOR EACH ROW
  EXECUTE FUNCTION update_item_rating_stats();
