/**
 * Database Migration: Firecrawl Nutrition Scrapes Table
 *
 * Creates the nutrition_scrapes table for storing scraped web content
 * and extracted nutrition data.
 *
 * Run with: npx ts-node src/db/migrate-firecrawl.ts
 */

import { pool } from './pool';

async function migrate() {
  console.log('Starting Firecrawl migration...');

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Create enum type for scrape types
    await client.query(`
      DO $$ BEGIN
        CREATE TYPE scrape_type AS ENUM ('recipe', 'nutrition', 'competitor');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);
    console.log('✓ Created scrape_type enum');

    // Create nutrition_scrapes table
    await client.query(`
      CREATE TABLE IF NOT EXISTS nutrition_scrapes (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        url TEXT NOT NULL UNIQUE,
        type scrape_type NOT NULL,
        markdown TEXT NOT NULL,
        extracted_json JSONB NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),

        -- Metadata for tracking
        scrape_source TEXT DEFAULT 'manual',  -- 'manual', 'cron', 'enrich'
        error_count INTEGER DEFAULT 0,
        last_error TEXT
      );
    `);
    console.log('✓ Created nutrition_scrapes table');

    // Create indexes for efficient queries
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_nutrition_scrapes_type
        ON nutrition_scrapes(type);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_nutrition_scrapes_created_at
        ON nutrition_scrapes(created_at DESC);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_nutrition_scrapes_url_hash
        ON nutrition_scrapes USING hash(url);
    `);

    // GIN index for JSON queries
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_nutrition_scrapes_json
        ON nutrition_scrapes USING gin(extracted_json);
    `);

    console.log('✓ Created indexes');

    // Create competitor_sites table for cron job tracking
    await client.query(`
      CREATE TABLE IF NOT EXISTS competitor_scrape_config (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL,
        url TEXT NOT NULL UNIQUE,
        type scrape_type NOT NULL DEFAULT 'competitor',
        enabled BOOLEAN DEFAULT true,
        scrape_frequency_hours INTEGER DEFAULT 24,
        last_scraped_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    console.log('✓ Created competitor_scrape_config table');

    // Insert default competitor sites
    await client.query(`
      INSERT INTO competitor_scrape_config (name, url, type, enabled)
      VALUES
        ('MyFitnessPal Recipes', 'https://www.myfitnesspal.com/recipe/box', 'recipe', true),
        ('NIH Nutrient Database', 'https://ods.od.nih.gov/factsheets/list-all/', 'nutrition', true),
        ('Cronometer Features', 'https://cronometer.com/features/', 'competitor', true),
        ('Lose It App', 'https://www.loseit.com/', 'competitor', true),
        ('Noom Recipes', 'https://www.noom.com/blog/category/recipes/', 'recipe', true)
      ON CONFLICT (url) DO NOTHING;
    `);
    console.log('✓ Inserted default competitor sites');

    // Create audit trigger for updates
    await client.query(`
      CREATE OR REPLACE FUNCTION update_nutrition_scrapes_updated_at()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = NOW();
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);

    await client.query(`
      DROP TRIGGER IF EXISTS trigger_nutrition_scrapes_updated_at ON nutrition_scrapes;
      CREATE TRIGGER trigger_nutrition_scrapes_updated_at
        BEFORE UPDATE ON nutrition_scrapes
        FOR EACH ROW
        EXECUTE FUNCTION update_nutrition_scrapes_updated_at();
    `);
    console.log('✓ Created update trigger');

    await client.query('COMMIT');
    console.log('\n✅ Firecrawl migration completed successfully!');

    // Print table info
    const tableInfo = await client.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'nutrition_scrapes'
      ORDER BY ordinal_position;
    `);

    console.log('\nnutrition_scrapes table structure:');
    console.table(tableInfo.rows);

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Migration failed:', error);
    throw error;
  } finally {
    client.release();
  }
}

// Run migration if called directly
if (require.main === module) {
  migrate()
    .then(() => {
      console.log('Migration complete');
      process.exit(0);
    })
    .catch((err) => {
      console.error('Migration error:', err);
      process.exit(1);
    });
}

export { migrate };
