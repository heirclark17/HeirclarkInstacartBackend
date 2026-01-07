// src/db/runMigrations.ts
// Auto-run database migrations on startup
import { Pool } from 'pg';
import * as fs from 'fs';
import * as path from 'path';

export async function runMigrations(pool: Pool): Promise<void> {
  console.log('[Migrations] Running database migrations...');

  try {
    // Check if restaurant_menu_items table exists
    const checkTable = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_name = 'restaurant_menu_items'
      );
    `);

    // Check if enhanced features columns exist
    const checkEnhanced = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.columns
        WHERE table_name = 'restaurant_menu_items'
        AND column_name = 'dietary_flags'
      );
    `);

    const tableExists = checkTable.rows[0]?.exists;

    if (!tableExists) {
      console.log('[Migrations] restaurant_menu_items table does not exist. Running migration...');

      // Inline migration SQL (easier than reading files in deployed environment)
      const migration = `
        -- Restaurant Menu Cache Schema
        CREATE TABLE IF NOT EXISTS restaurant_menu_items (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          restaurant_id VARCHAR(100) NOT NULL,
          restaurant_name VARCHAR(255) NOT NULL,
          name VARCHAR(500) NOT NULL,
          category VARCHAR(100) NOT NULL,
          calories INTEGER NOT NULL,
          protein NUMERIC(6,1) NOT NULL,
          carbs NUMERIC(6,1) NOT NULL,
          fat NUMERIC(6,1) NOT NULL,
          fiber NUMERIC(6,1),
          sugar NUMERIC(6,1),
          sodium_mg INTEGER,
          customizable BOOLEAN DEFAULT false,
          customization_tips TEXT,
          source VARCHAR(50) NOT NULL DEFAULT 'ai'
            CHECK (source IN ('ai', 'manual', 'api', 'scraped')),
          confidence_score INTEGER DEFAULT 75
            CHECK (confidence_score >= 0 AND confidence_score <= 100),
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          last_recommended_at TIMESTAMPTZ,
          recommendation_count INTEGER DEFAULT 0,
          UNIQUE(restaurant_id, name)
        );

        CREATE INDEX IF NOT EXISTS idx_restaurant_menu_items_restaurant
          ON restaurant_menu_items(restaurant_id);
        CREATE INDEX IF NOT EXISTS idx_restaurant_menu_items_category
          ON restaurant_menu_items(restaurant_id, category);
        CREATE INDEX IF NOT EXISTS idx_restaurant_menu_items_calories
          ON restaurant_menu_items(restaurant_id, calories);
        CREATE INDEX IF NOT EXISTS idx_restaurant_menu_items_source
          ON restaurant_menu_items(source);

        CREATE TABLE IF NOT EXISTS restaurant_metadata (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          restaurant_id VARCHAR(100) NOT NULL UNIQUE,
          restaurant_name VARCHAR(255) NOT NULL,
          total_items INTEGER DEFAULT 0,
          ai_generated_items INTEGER DEFAULT 0,
          manual_items INTEGER DEFAULT 0,
          total_recommendations INTEGER DEFAULT 0,
          last_recommended_at TIMESTAMPTZ,
          menu_last_updated TIMESTAMPTZ,
          needs_refresh BOOLEAN DEFAULT false,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE OR REPLACE FUNCTION update_restaurant_menu_updated_at()
        RETURNS TRIGGER AS $$
        BEGIN
          NEW.updated_at = NOW();
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

        DROP TRIGGER IF EXISTS trigger_restaurant_menu_items_updated_at ON restaurant_menu_items;
        CREATE TRIGGER trigger_restaurant_menu_items_updated_at
          BEFORE UPDATE ON restaurant_menu_items
          FOR EACH ROW
          EXECUTE FUNCTION update_restaurant_menu_updated_at();

        DROP TRIGGER IF EXISTS trigger_restaurant_metadata_updated_at ON restaurant_metadata;
        CREATE TRIGGER trigger_restaurant_metadata_updated_at
          BEFORE UPDATE ON restaurant_metadata
          FOR EACH ROW
          EXECUTE FUNCTION update_restaurant_menu_updated_at();

        CREATE OR REPLACE FUNCTION update_restaurant_metadata_stats()
        RETURNS TRIGGER AS $$
        BEGIN
          INSERT INTO restaurant_metadata (restaurant_id, restaurant_name)
          VALUES (NEW.restaurant_id, NEW.restaurant_name)
          ON CONFLICT (restaurant_id) DO NOTHING;

          UPDATE restaurant_metadata
          SET
            total_items = (SELECT COUNT(*) FROM restaurant_menu_items WHERE restaurant_id = NEW.restaurant_id),
            ai_generated_items = (SELECT COUNT(*) FROM restaurant_menu_items WHERE restaurant_id = NEW.restaurant_id AND source = 'ai'),
            manual_items = (SELECT COUNT(*) FROM restaurant_menu_items WHERE restaurant_id = NEW.restaurant_id AND source = 'manual'),
            menu_last_updated = NOW()
          WHERE restaurant_id = NEW.restaurant_id;

          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

        DROP TRIGGER IF EXISTS trigger_update_restaurant_stats ON restaurant_menu_items;
        CREATE TRIGGER trigger_update_restaurant_stats
          AFTER INSERT OR UPDATE ON restaurant_menu_items
          FOR EACH ROW
          EXECUTE FUNCTION update_restaurant_metadata_stats();
      `;

      await pool.query(migration);
      console.log('[Migrations] ✅ Migration completed successfully!');

      // Seed initial data
      console.log('[Migrations] Seeding initial restaurant data...');
      await seedInitialData(pool);
      console.log('[Migrations] ✅ Seeding completed!');
    } else {
      console.log('[Migrations] ✅ Database already migrated');
    }

    // Run enhanced features migration if needed
    const enhancedExists = checkEnhanced.rows[0]?.exists;

    if (!enhancedExists && tableExists) {
      console.log('[Migrations] Running enhanced features migration...');

      const enhancedMigration = `
        -- Add dietary and price columns to restaurant_menu_items
        ALTER TABLE restaurant_menu_items
        ADD COLUMN IF NOT EXISTS price_cents INTEGER DEFAULT 0,
        ADD COLUMN IF NOT EXISTS dietary_flags JSONB DEFAULT '[]'::jsonb,
        ADD COLUMN IF NOT EXISTS allergens JSONB DEFAULT '[]'::jsonb,
        ADD COLUMN IF NOT EXISTS is_vegetarian BOOLEAN DEFAULT false,
        ADD COLUMN IF NOT EXISTS is_vegan BOOLEAN DEFAULT false,
        ADD COLUMN IF NOT EXISTS is_gluten_free BOOLEAN DEFAULT false,
        ADD COLUMN IF NOT EXISTS is_dairy_free BOOLEAN DEFAULT false,
        ADD COLUMN IF NOT EXISTS is_keto_friendly BOOLEAN DEFAULT false;

        -- Add protein per dollar calculated column
        ALTER TABLE restaurant_menu_items
        ADD COLUMN IF NOT EXISTS protein_per_dollar NUMERIC(8,2);

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

        -- User dietary preferences
        CREATE TABLE IF NOT EXISTS user_dietary_preferences (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id VARCHAR(100) NOT NULL UNIQUE,
          is_vegetarian BOOLEAN DEFAULT false,
          is_vegan BOOLEAN DEFAULT false,
          is_gluten_free BOOLEAN DEFAULT false,
          is_dairy_free BOOLEAN DEFAULT false,
          is_keto BOOLEAN DEFAULT false,
          is_paleo BOOLEAN DEFAULT false,
          is_halal BOOLEAN DEFAULT false,
          is_kosher BOOLEAN DEFAULT false,
          allergens JSONB DEFAULT '[]'::jsonb,
          disliked_foods JSONB DEFAULT '[]'::jsonb,
          max_meal_budget_cents INTEGER,
          prefer_value_options BOOLEAN DEFAULT false,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        -- Restaurant locations table
        CREATE TABLE IF NOT EXISTS restaurant_locations (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          restaurant_id VARCHAR(100) NOT NULL,
          restaurant_name VARCHAR(255) NOT NULL,
          place_id VARCHAR(255) UNIQUE,
          address TEXT,
          city VARCHAR(100),
          state VARCHAR(50),
          zip_code VARCHAR(20),
          country VARCHAR(50) DEFAULT 'USA',
          latitude NUMERIC(10,8),
          longitude NUMERIC(11,8),
          phone VARCHAR(50),
          website TEXT,
          is_chain_location BOOLEAN DEFAULT false,
          chain_name VARCHAR(255),
          rating NUMERIC(2,1),
          total_ratings INTEGER DEFAULT 0,
          hours JSONB,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE INDEX IF NOT EXISTS idx_restaurant_locations_city
          ON restaurant_locations(city, state);

        -- User ratings and reviews
        CREATE TABLE IF NOT EXISTS restaurant_item_ratings (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id VARCHAR(100) NOT NULL,
          menu_item_id UUID NOT NULL REFERENCES restaurant_menu_items(id) ON DELETE CASCADE,
          restaurant_id VARCHAR(100) NOT NULL,
          rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
          review_text TEXT,
          calories_accurate BOOLEAN,
          protein_accurate BOOLEAN,
          taste_rating INTEGER CHECK (taste_rating >= 1 AND taste_rating <= 5),
          value_rating INTEGER CHECK (value_rating >= 1 AND value_rating <= 5),
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

        -- User favorite orders
        CREATE TABLE IF NOT EXISTS user_favorite_orders (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id VARCHAR(100) NOT NULL,
          restaurant_id VARCHAR(100) NOT NULL,
          menu_item_id UUID REFERENCES restaurant_menu_items(id) ON DELETE CASCADE,
          order_name VARCHAR(255),
          customizations TEXT,
          times_ordered INTEGER DEFAULT 1,
          last_ordered_at TIMESTAMPTZ DEFAULT NOW(),
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE INDEX IF NOT EXISTS idx_favorite_orders_user
          ON user_favorite_orders(user_id);

        -- Shared recommendations
        CREATE TABLE IF NOT EXISTS shared_recommendations (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          share_id VARCHAR(50) UNIQUE NOT NULL,
          user_id VARCHAR(100) NOT NULL,
          restaurant_id VARCHAR(100) NOT NULL,
          restaurant_name VARCHAR(255) NOT NULL,
          menu_item_ids UUID[],
          title VARCHAR(255),
          description TEXT,
          photo_url TEXT,
          visibility VARCHAR(20) DEFAULT 'public'
            CHECK (visibility IN ('public', 'friends', 'private')),
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

        -- Menu photo uploads
        CREATE TABLE IF NOT EXISTS menu_photo_uploads (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id VARCHAR(100) NOT NULL,
          restaurant_id VARCHAR(100),
          restaurant_name VARCHAR(255),
          photo_url TEXT NOT NULL,
          thumbnail_url TEXT,
          ai_analyzed BOOLEAN DEFAULT false,
          detected_items JSONB,
          confidence_score NUMERIC(3,2),
          user_confirmed BOOLEAN DEFAULT false,
          user_corrections JSONB,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE INDEX IF NOT EXISTS idx_menu_photos_user
          ON menu_photo_uploads(user_id);
        CREATE INDEX IF NOT EXISTS idx_menu_photos_analyzed
          ON menu_photo_uploads(ai_analyzed) WHERE ai_analyzed = false;

        -- Update metadata
        ALTER TABLE restaurant_metadata
        ADD COLUMN IF NOT EXISTS avg_rating NUMERIC(2,1),
        ADD COLUMN IF NOT EXISTS total_ratings INTEGER DEFAULT 0,
        ADD COLUMN IF NOT EXISTS total_favorites INTEGER DEFAULT 0,
        ADD COLUMN IF NOT EXISTS avg_price_cents INTEGER;
      `;

      await pool.query(enhancedMigration);
      console.log('[Migrations] ✅ Enhanced features migration completed!');
    } else if (enhancedExists) {
      console.log('[Migrations] ✅ Enhanced features already migrated');
    }

  } catch (error: any) {
    console.error('[Migrations] ❌ Migration failed:', error.message);
    // Don't crash the app, just log the error
  }
}

async function seedInitialData(pool: Pool): Promise<void> {
  const restaurants = [
    {
      id: 'chipotle',
      name: 'Chipotle',
      items: [
        { name: 'Chicken Burrito Bowl', category: 'bowls', calories: 665, protein: 53, carbs: 55, fat: 24, customizable: true },
        { name: 'Steak Burrito Bowl', category: 'bowls', calories: 700, protein: 51, carbs: 55, fat: 28, customizable: true },
        { name: 'Chicken Salad', category: 'salads', calories: 480, protein: 45, carbs: 20, fat: 28, customizable: true },
        { name: 'Veggie Bowl', category: 'bowls', calories: 550, protein: 15, carbs: 72, fat: 22, customizable: true },
      ]
    },
    {
      id: 'chickfila',
      name: 'Chick-fil-A',
      items: [
        { name: 'Grilled Chicken Sandwich', category: 'sandwiches', calories: 380, protein: 28, carbs: 44, fat: 6, customizable: false },
        { name: 'Chicken Nuggets (12-count)', category: 'entrees', calories: 380, protein: 40, carbs: 16, fat: 17, customizable: false },
        { name: 'Spicy Southwest Salad', category: 'salads', calories: 450, protein: 33, carbs: 28, fat: 23, customizable: true },
        { name: 'Grilled Chicken Cool Wrap', category: 'wraps', calories: 350, protein: 37, carbs: 29, fat: 13, customizable: false },
        { name: 'Chicken Sandwich', category: 'sandwiches', calories: 440, protein: 28, carbs: 41, fat: 17, customizable: false },
        { name: 'Cobb Salad', category: 'salads', calories: 510, protein: 40, carbs: 27, fat: 28, customizable: true },
        { name: 'Waffle Potato Fries (Medium)', category: 'sides', calories: 360, protein: 5, carbs: 43, fat: 18, customizable: false },
        { name: 'Hash Browns', category: 'breakfast', calories: 270, protein: 3, carbs: 25, fat: 18, customizable: false },
      ]
    },
    {
      id: 'panera',
      name: 'Panera Bread',
      items: [
        { name: 'Mediterranean Bowl with Chicken', category: 'bowls', calories: 520, protein: 35, carbs: 40, fat: 25, customizable: false },
        { name: 'Asian Sesame Salad with Chicken', category: 'salads', calories: 400, protein: 30, carbs: 32, fat: 18, customizable: false },
        { name: 'Turkey Avocado BLT', category: 'sandwiches', calories: 620, protein: 38, carbs: 50, fat: 32, customizable: false },
        { name: 'Greek Salad with Chicken', category: 'salads', calories: 380, protein: 32, carbs: 15, fat: 23, customizable: false },
      ]
    },
    {
      id: 'sweetgreen',
      name: 'Sweetgreen',
      items: [
        { name: 'Harvest Bowl', category: 'bowls', calories: 555, protein: 23, carbs: 48, fat: 33, customizable: false },
        { name: 'Chicken Pesto Parm', category: 'bowls', calories: 630, protein: 42, carbs: 44, fat: 34, customizable: false },
        { name: 'Kale Caesar', category: 'salads', calories: 450, protein: 28, carbs: 25, fat: 30, customizable: false },
        { name: 'Super Green Goddess', category: 'salads', calories: 310, protein: 9, carbs: 38, fat: 14, customizable: false },
      ]
    },
    {
      id: 'subway',
      name: 'Subway',
      items: [
        { name: "6\" Turkey Breast", category: "sandwiches", calories: 280, protein: 18, carbs: 46, fat: 3.5, customizable: true },
        { name: "6\" Chicken & Bacon Ranch", category: "sandwiches", calories: 530, protein: 36, carbs: 45, fat: 24, customizable: true },
        { name: "6\" Veggie Delite", category: "sandwiches", calories: 230, protein: 8, carbs: 44, fat: 2.5, customizable: true },
        { name: "Rotisserie Chicken Salad", category: "salads", calories: 350, protein: 29, carbs: 11, fat: 22, customizable: true },
        { name: "6\" Steak & Cheese", category: "sandwiches", calories: 380, protein: 23, carbs: 48, fat: 10, customizable: true },
        { name: "6\" Tuna", category: "sandwiches", calories: 470, protein: 20, carbs: 45, fat: 23, customizable: true },
        { name: "Egg & Cheese Wrap", category: "breakfast", calories: 390, protein: 19, carbs: 38, fat: 17, customizable: true },
        { name: "6\" Sweet Onion Chicken Teriyaki", category: "sandwiches", calories: 370, protein: 25, carbs: 57, fat: 4.5, customizable: true },
      ]
    },
    {
      id: 'mcdonalds',
      name: "McDonald's",
      items: [
        { name: "Big Mac", category: "burgers", calories: 550, protein: 25, carbs: 45, fat: 30, customizable: false },
        { name: "Quarter Pounder with Cheese", category: "burgers", calories: 520, protein: 26, carbs: 42, fat: 26, customizable: false },
        { name: "10-Piece Chicken McNuggets", category: "chicken", calories: 420, protein: 23, carbs: 25, fat: 24, customizable: false },
        { name: "Premium Southwest Salad (Grilled)", category: "salads", calories: 350, protein: 37, carbs: 27, fat: 12, customizable: true },
        { name: "Artisan Grilled Chicken Sandwich", category: "chicken", calories: 380, protein: 37, carbs: 44, fat: 7, customizable: false },
        { name: "Filet-O-Fish", category: "fish", calories: 380, protein: 15, carbs: 39, fat: 18, customizable: false },
        { name: "Egg McMuffin", category: "breakfast", calories: 300, protein: 17, carbs: 30, fat: 13, customizable: false },
        { name: "Fruit & Maple Oatmeal", category: "breakfast", calories: 320, protein: 6, carbs: 64, fat: 4.5, customizable: false },
      ]
    },
    {
      id: 'wendys',
      name: "Wendy's",
      items: [
        { name: "Dave's Single", category: "burgers", calories: 570, protein: 29, carbs: 41, fat: 34, customizable: true },
        { name: "Grilled Chicken Sandwich", category: "chicken", calories: 370, protein: 34, carbs: 37, fat: 10, customizable: false },
        { name: "Spicy Chicken Sandwich", category: "chicken", calories: 490, protein: 29, carbs: 48, fat: 20, customizable: false },
        { name: "Southwest Avocado Chicken Salad", category: "salads", calories: 520, protein: 33, carbs: 31, fat: 31, customizable: true },
        { name: "Apple Pecan Chicken Salad", category: "salads", calories: 560, protein: 34, carbs: 39, fat: 30, customizable: true },
        { name: "Homestyle Chicken Go Wrap (Grilled)", category: "wraps", calories: 270, protein: 18, carbs: 25, fat: 10, customizable: false },
        { name: "Jr. Bacon Cheeseburger", category: "burgers", calories: 370, protein: 19, carbs: 26, fat: 21, customizable: true },
        { name: "Chili (Small)", category: "sides", calories: 250, protein: 17, carbs: 23, fat: 9, customizable: false },
      ]
    },
    {
      id: 'tacobell',
      name: 'Taco Bell',
      items: [
        { name: "Chicken Power Bowl", category: "bowls", calories: 470, protein: 26, carbs: 50, fat: 17, customizable: true },
        { name: "Chicken Soft Taco", category: "tacos", calories: 160, protein: 12, carbs: 15, fat: 5, customizable: true },
        { name: "Crunchy Taco", category: "tacos", calories: 170, protein: 8, carbs: 13, fat: 10, customizable: true },
        { name: "Chicken Burrito", category: "burritos", calories: 350, protein: 13, carbs: 48, fat: 11, customizable: true },
        { name: "Grilled Steak Soft Taco", category: "tacos", calories: 180, protein: 12, carbs: 17, fat: 6, customizable: true },
        { name: "Black Beans & Rice", category: "sides", calories: 180, protein: 5, carbs: 33, fat: 3.5, customizable: false },
        { name: "Veggie Power Bowl", category: "bowls", calories: 450, protein: 13, carbs: 62, fat: 16, customizable: true },
        { name: "Breakfast Crunchwrap (Steak)", category: "breakfast", calories: 680, protein: 21, carbs: 71, fat: 35, customizable: true },
      ]
    }
  ];

  for (const restaurant of restaurants) {
    for (const item of restaurant.items) {
      try {
        await pool.query(
          `INSERT INTO restaurant_menu_items
           (restaurant_id, restaurant_name, name, category, calories, protein, carbs, fat, customizable, source, confidence_score)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'manual', 100)
           ON CONFLICT (restaurant_id, name) DO NOTHING`,
          [
            restaurant.id,
            restaurant.name,
            item.name,
            item.category,
            item.calories,
            item.protein,
            item.carbs,
            item.fat,
            item.customizable
          ]
        );
      } catch (err: any) {
        console.error(`[Migrations] Error seeding ${item.name}:`, err.message);
      }
    }
  }
}
