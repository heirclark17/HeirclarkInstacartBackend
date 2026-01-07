-- Restaurant Menu Cache Schema
-- Stores AI-generated and manually-added restaurant menu items

-- Restaurant menu items cache
CREATE TABLE IF NOT EXISTS restaurant_menu_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id VARCHAR(100) NOT NULL,
  restaurant_name VARCHAR(255) NOT NULL,

  -- Menu item details
  name VARCHAR(500) NOT NULL,
  category VARCHAR(100) NOT NULL,

  -- Nutrition information
  calories INTEGER NOT NULL,
  protein NUMERIC(6,1) NOT NULL,
  carbs NUMERIC(6,1) NOT NULL,
  fat NUMERIC(6,1) NOT NULL,
  fiber NUMERIC(6,1),
  sugar NUMERIC(6,1),
  sodium_mg INTEGER,

  -- Metadata
  customizable BOOLEAN DEFAULT false,
  customization_tips TEXT,
  source VARCHAR(50) NOT NULL DEFAULT 'ai'
    CHECK (source IN ('ai', 'manual', 'api', 'scraped')),
  confidence_score INTEGER DEFAULT 75
    CHECK (confidence_score >= 0 AND confidence_score <= 100),

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_recommended_at TIMESTAMPTZ,
  recommendation_count INTEGER DEFAULT 0,

  -- Deduplication
  UNIQUE(restaurant_id, name)
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_restaurant_menu_items_restaurant
  ON restaurant_menu_items(restaurant_id);

CREATE INDEX IF NOT EXISTS idx_restaurant_menu_items_category
  ON restaurant_menu_items(restaurant_id, category);

CREATE INDEX IF NOT EXISTS idx_restaurant_menu_items_calories
  ON restaurant_menu_items(restaurant_id, calories);

CREATE INDEX IF NOT EXISTS idx_restaurant_menu_items_source
  ON restaurant_menu_items(source);

-- Restaurant metadata table
CREATE TABLE IF NOT EXISTS restaurant_metadata (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id VARCHAR(100) NOT NULL UNIQUE,
  restaurant_name VARCHAR(255) NOT NULL,

  -- Menu stats
  total_items INTEGER DEFAULT 0,
  ai_generated_items INTEGER DEFAULT 0,
  manual_items INTEGER DEFAULT 0,

  -- Usage stats
  total_recommendations INTEGER DEFAULT 0,
  last_recommended_at TIMESTAMPTZ,

  -- Menu freshness
  menu_last_updated TIMESTAMPTZ,
  needs_refresh BOOLEAN DEFAULT false,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_restaurant_menu_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_restaurant_menu_items_updated_at
  ON restaurant_menu_items;
CREATE TRIGGER trigger_restaurant_menu_items_updated_at
  BEFORE UPDATE ON restaurant_menu_items
  FOR EACH ROW
  EXECUTE FUNCTION update_restaurant_menu_updated_at();

DROP TRIGGER IF EXISTS trigger_restaurant_metadata_updated_at
  ON restaurant_metadata;
CREATE TRIGGER trigger_restaurant_metadata_updated_at
  BEFORE UPDATE ON restaurant_metadata
  FOR EACH ROW
  EXECUTE FUNCTION update_restaurant_menu_updated_at();

-- Function to update restaurant metadata after menu item changes
CREATE OR REPLACE FUNCTION update_restaurant_metadata_stats()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO restaurant_metadata (restaurant_id, restaurant_name)
  VALUES (NEW.restaurant_id, NEW.restaurant_name)
  ON CONFLICT (restaurant_id) DO NOTHING;

  UPDATE restaurant_metadata
  SET
    total_items = (
      SELECT COUNT(*)
      FROM restaurant_menu_items
      WHERE restaurant_id = NEW.restaurant_id
    ),
    ai_generated_items = (
      SELECT COUNT(*)
      FROM restaurant_menu_items
      WHERE restaurant_id = NEW.restaurant_id AND source = 'ai'
    ),
    manual_items = (
      SELECT COUNT(*)
      FROM restaurant_menu_items
      WHERE restaurant_id = NEW.restaurant_id AND source = 'manual'
    ),
    menu_last_updated = NOW()
  WHERE restaurant_id = NEW.restaurant_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_restaurant_stats
  ON restaurant_menu_items;
CREATE TRIGGER trigger_update_restaurant_stats
  AFTER INSERT OR UPDATE ON restaurant_menu_items
  FOR EACH ROW
  EXECUTE FUNCTION update_restaurant_metadata_stats();
