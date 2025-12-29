import { pool } from "./pool";

async function migrate() {
  console.log("Starting database migration...\n");

  // 1. Wearable tokens (Fitbit, Apple Health OAuth)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS wearable_tokens (
      id BIGSERIAL PRIMARY KEY,
      customer_id TEXT NOT NULL,
      provider TEXT NOT NULL, -- 'fitbit' | 'apple'
      access_token TEXT NOT NULL,
      refresh_token TEXT NOT NULL,
      token_type TEXT,
      scope TEXT,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (customer_id, provider)
    );
  `);
  console.log("✅ wearable_tokens table ready");

  // 2. Health Bridge pairing tokens (temporary tokens for device linking)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS hc_pairing_tokens (
      id BIGSERIAL PRIMARY KEY,
      pairing_token TEXT NOT NULL UNIQUE,
      shopify_customer_id TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  // Index for cleanup queries
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_hc_pairing_tokens_expires
    ON hc_pairing_tokens(expires_at);
  `);
  console.log("✅ hc_pairing_tokens table ready");

  // 3. Health devices (linked iPhone shortcuts / devices)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS hc_health_devices (
      id BIGSERIAL PRIMARY KEY,
      device_key TEXT NOT NULL UNIQUE,
      shopify_customer_id TEXT NOT NULL,
      device_name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      last_seen_at TIMESTAMPTZ
    );
  `);
  // Index for customer lookups
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_hc_health_devices_customer
    ON hc_health_devices(shopify_customer_id);
  `);
  console.log("✅ hc_health_devices table ready");

  // 4. Latest health metrics (one row per customer, upserted on each sync)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS hc_health_latest (
      id BIGSERIAL PRIMARY KEY,
      shopify_customer_id TEXT NOT NULL UNIQUE,
      ts TIMESTAMPTZ NOT NULL,
      steps INTEGER,
      active_calories INTEGER,
      resting_energy INTEGER,
      latest_heart_rate_bpm INTEGER,
      workouts_today INTEGER,
      received_at TIMESTAMPTZ DEFAULT NOW(),
      source TEXT DEFAULT 'shortcut'
    );
  `);
  // Add resting_energy column if it doesn't exist (for existing databases)
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'hc_health_latest' AND column_name = 'resting_energy'
      ) THEN
        ALTER TABLE hc_health_latest ADD COLUMN resting_energy INTEGER;
      END IF;
    END $$;
  `);
  console.log("✅ hc_health_latest table ready");

  // 5. Apple Health sync data (persistent storage for Apple Health samples)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS hc_apple_health_daily (
      id BIGSERIAL PRIMARY KEY,
      shopify_customer_id TEXT NOT NULL,
      date DATE NOT NULL,
      burned_kcal NUMERIC(10,2) DEFAULT 0,
      consumed_kcal NUMERIC(10,2) DEFAULT 0,
      last_updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (shopify_customer_id, date)
    );
  `);
  // Index for date range queries
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_hc_apple_health_daily_customer_date
    ON hc_apple_health_daily(shopify_customer_id, date);
  `);
  console.log("✅ hc_apple_health_daily table ready");

  // 6. Apple Health sync tokens (persistent device tokens)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS hc_apple_tokens (
      id BIGSERIAL PRIMARY KEY,
      token TEXT NOT NULL UNIQUE,
      shopify_customer_id TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL
    );
  `);
  console.log("✅ hc_apple_tokens table ready");

  // 7. User preferences (goals, settings)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS hc_user_preferences (
      id BIGSERIAL PRIMARY KEY,
      shopify_customer_id TEXT NOT NULL UNIQUE,
      goal_weight_lbs NUMERIC(6,2),
      hydration_target_ml INTEGER DEFAULT 3000,
      calories_target INTEGER DEFAULT 2200,
      protein_target INTEGER DEFAULT 190,
      carbs_target INTEGER DEFAULT 190,
      fat_target INTEGER DEFAULT 60,
      timezone TEXT DEFAULT 'America/New_York',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  console.log("✅ hc_user_preferences table ready");

  // 8. Meals (persistent meal storage - replacing in-memory)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS hc_meals (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      shopify_customer_id TEXT NOT NULL,
      datetime TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      label TEXT,
      items JSONB NOT NULL DEFAULT '[]',
      total_calories INTEGER DEFAULT 0,
      total_protein INTEGER DEFAULT 0,
      total_carbs INTEGER DEFAULT 0,
      total_fat INTEGER DEFAULT 0,
      source TEXT DEFAULT 'manual',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  // Indexes for common queries
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_hc_meals_customer
    ON hc_meals(shopify_customer_id);
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_hc_meals_customer_date
    ON hc_meals(shopify_customer_id, datetime);
  `);
  console.log("✅ hc_meals table ready");

  // 9. Water logs (hydration tracking)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS hc_water_logs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      shopify_customer_id TEXT NOT NULL,
      datetime TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      amount_ml INTEGER NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_hc_water_logs_customer_date
    ON hc_water_logs(shopify_customer_id, datetime);
  `);
  console.log("✅ hc_water_logs table ready");

  // 10. Weight logs
  await pool.query(`
    CREATE TABLE IF NOT EXISTS hc_weight_logs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      shopify_customer_id TEXT NOT NULL,
      date DATE NOT NULL,
      weight_lbs NUMERIC(6,2) NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (shopify_customer_id, date)
    );
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_hc_weight_logs_customer_date
    ON hc_weight_logs(shopify_customer_id, date);
  `);
  console.log("✅ hc_weight_logs table ready");

  // Cleanup job: Create a function to clean expired pairing tokens
  await pool.query(`
    CREATE OR REPLACE FUNCTION cleanup_expired_pairing_tokens()
    RETURNS void AS $$
    BEGIN
      DELETE FROM hc_pairing_tokens WHERE expires_at < NOW();
    END;
    $$ LANGUAGE plpgsql;
  `);
  console.log("✅ cleanup function ready");

  console.log("\n🎉 All migrations completed successfully!");
  await pool.end();
}

migrate().catch((err) => {
  console.error("❌ migration failed", err);
  process.exit(1);
});
