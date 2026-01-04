import { pool } from "./pool";

/**
 * Wearables & Sync Database Migration
 *
 * Creates tables for:
 * - Connected OAuth sources (Fitbit, Garmin, Strava, Oura, WHOOP, Withings)
 * - Native health store connections (Apple Health, Health Connect)
 * - Normalized health data (activity, workouts, sleep, body, heart)
 * - Data source priority configuration
 * - Sync logging and audit trail
 */

async function migrateWearables() {
  console.log("🏃 Starting wearables migration...\n");

  // ============================================
  // TABLE 1: Connected Sources
  // ============================================
  console.log("Creating hc_connected_sources table...");
  await pool.query(`
    CREATE TABLE IF NOT EXISTS hc_connected_sources (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      customer_id VARCHAR(50) NOT NULL,
      source_type VARCHAR(30) NOT NULL,

      -- OAuth tokens (encrypted with AES-256-GCM)
      access_token_encrypted TEXT,
      refresh_token_encrypted TEXT,
      token_expires_at TIMESTAMPTZ,

      -- Source-specific user ID
      source_user_id VARCHAR(100),

      -- Permissions granted (array of scope strings)
      scopes_granted TEXT[] DEFAULT '{}',

      -- Sync configuration
      is_primary_source BOOLEAN DEFAULT false,
      sync_enabled BOOLEAN DEFAULT true,
      last_sync_at TIMESTAMPTZ,
      last_sync_status VARCHAR(20),
      last_error TEXT,

      -- Metadata
      connected_at TIMESTAMPTZ DEFAULT NOW(),
      disconnected_at TIMESTAMPTZ,

      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),

      -- Constraints
      CONSTRAINT hc_connected_sources_unique UNIQUE(customer_id, source_type),
      CONSTRAINT hc_connected_sources_source_type_check CHECK (
        source_type IN (
          'apple_health', 'health_connect',
          'fitbit', 'garmin', 'strava',
          'oura', 'whoop', 'withings', 'manual'
        )
      ),
      CONSTRAINT hc_connected_sources_status_check CHECK (
        last_sync_status IS NULL OR
        last_sync_status IN ('success', 'partial', 'failed', 'pending')
      )
    );
  `);
  console.log("✅ hc_connected_sources table created");

  // ============================================
  // TABLE 2: Source Priority Configuration
  // ============================================
  console.log("Creating hc_source_priority table...");
  await pool.query(`
    CREATE TABLE IF NOT EXISTS hc_source_priority (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      customer_id VARCHAR(50) NOT NULL,
      data_type VARCHAR(30) NOT NULL,
      priority_order TEXT[] NOT NULL DEFAULT '{}',

      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),

      CONSTRAINT hc_source_priority_unique UNIQUE(customer_id, data_type),
      CONSTRAINT hc_source_priority_type_check CHECK (
        data_type IN (
          'steps', 'calories', 'distance', 'sleep',
          'weight', 'heart_rate', 'hrv', 'workout'
        )
      )
    );
  `);
  console.log("✅ hc_source_priority table created");

  // ============================================
  // TABLE 3: Normalized Activity Data
  // ============================================
  console.log("Creating hc_activity_data table...");
  await pool.query(`
    CREATE TABLE IF NOT EXISTS hc_activity_data (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      customer_id VARCHAR(50) NOT NULL,
      source_type VARCHAR(30) NOT NULL,
      source_record_id VARCHAR(100),

      -- Time window
      recorded_date DATE NOT NULL,
      start_time TIMESTAMPTZ,
      end_time TIMESTAMPTZ,

      -- Activity metrics
      steps INTEGER,
      active_calories DECIMAL(10,2),
      resting_calories DECIMAL(10,2),
      total_calories DECIMAL(10,2),
      distance_meters DECIMAL(12,2),
      floors_climbed INTEGER,
      active_minutes INTEGER,

      -- Dedupe tracking
      is_primary BOOLEAN DEFAULT false,
      dedupe_group_id UUID,

      created_at TIMESTAMPTZ DEFAULT NOW(),

      CONSTRAINT hc_activity_data_unique UNIQUE(customer_id, source_type, recorded_date, source_record_id)
    );
  `);
  console.log("✅ hc_activity_data table created");

  // ============================================
  // TABLE 4: Normalized Workout Data
  // ============================================
  console.log("Creating hc_workout_data table...");
  await pool.query(`
    CREATE TABLE IF NOT EXISTS hc_workout_data (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      customer_id VARCHAR(50) NOT NULL,
      source_type VARCHAR(30) NOT NULL,
      source_record_id VARCHAR(100),

      -- Workout details
      workout_type VARCHAR(50),
      start_time TIMESTAMPTZ NOT NULL,
      end_time TIMESTAMPTZ,
      duration_seconds INTEGER,

      -- Metrics
      calories_burned DECIMAL(10,2),
      distance_meters DECIMAL(12,2),
      avg_heart_rate INTEGER,
      max_heart_rate INTEGER,

      -- GPS data
      has_gps_data BOOLEAN DEFAULT false,
      gps_polyline TEXT,

      -- Source-specific metadata
      source_metadata JSONB,

      -- Dedupe tracking
      is_primary BOOLEAN DEFAULT false,
      dedupe_group_id UUID,

      created_at TIMESTAMPTZ DEFAULT NOW(),

      CONSTRAINT hc_workout_data_unique UNIQUE(customer_id, source_type, source_record_id)
    );
  `);
  console.log("✅ hc_workout_data table created");

  // ============================================
  // TABLE 5: Normalized Sleep Data
  // ============================================
  console.log("Creating hc_sleep_data table...");
  await pool.query(`
    CREATE TABLE IF NOT EXISTS hc_sleep_data (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      customer_id VARCHAR(50) NOT NULL,
      source_type VARCHAR(30) NOT NULL,
      source_record_id VARCHAR(100),

      -- Sleep window
      sleep_date DATE NOT NULL,
      bed_time TIMESTAMPTZ,
      wake_time TIMESTAMPTZ,

      -- Duration (minutes)
      total_sleep_minutes INTEGER,
      deep_sleep_minutes INTEGER,
      light_sleep_minutes INTEGER,
      rem_sleep_minutes INTEGER,
      awake_minutes INTEGER,

      -- Quality scores (0-100 normalized)
      sleep_score INTEGER,

      -- Dedupe tracking
      is_primary BOOLEAN DEFAULT false,
      dedupe_group_id UUID,

      created_at TIMESTAMPTZ DEFAULT NOW(),

      CONSTRAINT hc_sleep_data_unique UNIQUE(customer_id, source_type, sleep_date, source_record_id)
    );
  `);
  console.log("✅ hc_sleep_data table created");

  // ============================================
  // TABLE 6: Normalized Body Measurements
  // ============================================
  console.log("Creating hc_body_data table...");
  await pool.query(`
    CREATE TABLE IF NOT EXISTS hc_body_data (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      customer_id VARCHAR(50) NOT NULL,
      source_type VARCHAR(30) NOT NULL,
      source_record_id VARCHAR(100),

      recorded_at TIMESTAMPTZ NOT NULL,

      -- Body measurements (metric units)
      weight_kg DECIMAL(6,2),
      body_fat_percent DECIMAL(5,2),
      muscle_mass_kg DECIMAL(6,2),
      bone_mass_kg DECIMAL(5,2),
      water_percent DECIMAL(5,2),
      bmi DECIMAL(4,1),

      -- Dedupe tracking
      is_primary BOOLEAN DEFAULT false,
      dedupe_group_id UUID,

      created_at TIMESTAMPTZ DEFAULT NOW(),

      CONSTRAINT hc_body_data_unique UNIQUE(customer_id, source_type, recorded_at, source_record_id)
    );
  `);
  console.log("✅ hc_body_data table created");

  // ============================================
  // TABLE 7: Heart Rate / HRV Data
  // ============================================
  console.log("Creating hc_heart_data table...");
  await pool.query(`
    CREATE TABLE IF NOT EXISTS hc_heart_data (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      customer_id VARCHAR(50) NOT NULL,
      source_type VARCHAR(30) NOT NULL,

      recorded_at TIMESTAMPTZ NOT NULL,
      recorded_date DATE NOT NULL,

      -- Heart rate metrics
      heart_rate_bpm INTEGER,
      resting_heart_rate INTEGER,

      -- HRV (from WHOOP, Oura, etc.)
      hrv_rmssd DECIMAL(6,2),

      -- Recovery/strain scores (normalized 0-100)
      recovery_score INTEGER,
      strain_score DECIMAL(4,1),

      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  console.log("✅ hc_heart_data table created");

  // ============================================
  // TABLE 8: Sync Log (Audit Trail)
  // ============================================
  console.log("Creating hc_sync_log table...");
  await pool.query(`
    CREATE TABLE IF NOT EXISTS hc_sync_log (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      customer_id VARCHAR(50) NOT NULL,
      source_type VARCHAR(30) NOT NULL,

      sync_started_at TIMESTAMPTZ NOT NULL,
      sync_completed_at TIMESTAMPTZ,

      sync_type VARCHAR(20),
      status VARCHAR(20),

      records_fetched INTEGER DEFAULT 0,
      records_inserted INTEGER DEFAULT 0,
      records_updated INTEGER DEFAULT 0,
      records_deduped INTEGER DEFAULT 0,

      error_message TEXT,
      error_details JSONB,

      created_at TIMESTAMPTZ DEFAULT NOW(),

      CONSTRAINT hc_sync_log_type_check CHECK (
        sync_type IS NULL OR sync_type IN ('full', 'incremental', 'manual', 'webhook')
      ),
      CONSTRAINT hc_sync_log_status_check CHECK (
        status IS NULL OR status IN ('running', 'success', 'partial', 'failed')
      )
    );
  `);
  console.log("✅ hc_sync_log table created");

  // ============================================
  // INDEXES
  // ============================================
  console.log("\nCreating indexes...");

  // Connected sources indexes
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_connected_sources_customer
    ON hc_connected_sources(customer_id);
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_connected_sources_token_expiry
    ON hc_connected_sources(token_expires_at)
    WHERE token_expires_at IS NOT NULL AND disconnected_at IS NULL;
  `);
  console.log("✅ hc_connected_sources indexes created");

  // Activity data indexes
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_activity_customer_date
    ON hc_activity_data(customer_id, recorded_date);
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_activity_dedupe_group
    ON hc_activity_data(dedupe_group_id)
    WHERE dedupe_group_id IS NOT NULL;
  `);
  console.log("✅ hc_activity_data indexes created");

  // Workout data indexes
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_workout_customer_time
    ON hc_workout_data(customer_id, start_time);
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_workout_dedupe_group
    ON hc_workout_data(dedupe_group_id)
    WHERE dedupe_group_id IS NOT NULL;
  `);
  console.log("✅ hc_workout_data indexes created");

  // Sleep data indexes
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_sleep_customer_date
    ON hc_sleep_data(customer_id, sleep_date);
  `);
  console.log("✅ hc_sleep_data indexes created");

  // Body data indexes
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_body_customer_time
    ON hc_body_data(customer_id, recorded_at);
  `);
  console.log("✅ hc_body_data indexes created");

  // Heart data indexes
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_heart_customer_date
    ON hc_heart_data(customer_id, recorded_date);
  `);
  console.log("✅ hc_heart_data indexes created");

  // Sync log indexes
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_sync_log_customer
    ON hc_sync_log(customer_id, source_type, sync_started_at DESC);
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_sync_log_status
    ON hc_sync_log(status)
    WHERE status = 'running';
  `);
  console.log("✅ hc_sync_log indexes created");

  // ============================================
  // TRIGGERS (updated_at auto-update)
  // ============================================
  console.log("\nCreating triggers...");

  // Create trigger function if not exists
  await pool.query(`
    CREATE OR REPLACE FUNCTION hc_update_updated_at_column()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);

  // Apply to connected_sources
  await pool.query(`
    DROP TRIGGER IF EXISTS hc_connected_sources_updated_at ON hc_connected_sources;
    CREATE TRIGGER hc_connected_sources_updated_at
      BEFORE UPDATE ON hc_connected_sources
      FOR EACH ROW
      EXECUTE FUNCTION hc_update_updated_at_column();
  `);

  // Apply to source_priority
  await pool.query(`
    DROP TRIGGER IF EXISTS hc_source_priority_updated_at ON hc_source_priority;
    CREATE TRIGGER hc_source_priority_updated_at
      BEFORE UPDATE ON hc_source_priority
      FOR EACH ROW
      EXECUTE FUNCTION hc_update_updated_at_column();
  `);
  console.log("✅ Triggers created");

  // ============================================
  // SUMMARY
  // ============================================
  console.log("\n" + "═".repeat(50));
  console.log("🎉 WEARABLES MIGRATION COMPLETED SUCCESSFULLY!");
  console.log("═".repeat(50));
  console.log("\nTables created:");
  console.log("  • hc_connected_sources  - OAuth tokens & connection state");
  console.log("  • hc_source_priority    - User data source preferences");
  console.log("  • hc_activity_data      - Steps, calories, distance");
  console.log("  • hc_workout_data       - Exercise sessions");
  console.log("  • hc_sleep_data         - Sleep tracking");
  console.log("  • hc_body_data          - Weight, body composition");
  console.log("  • hc_heart_data         - Heart rate, HRV, recovery");
  console.log("  • hc_sync_log           - Sync audit trail");
  console.log("\nSupported sources:");
  console.log("  • Native: Apple Health, Android Health Connect");
  console.log("  • OAuth:  Fitbit, Garmin, Strava, Oura, WHOOP, Withings");

  await pool.end();
}

migrateWearables().catch((err) => {
  console.error("❌ Wearables migration failed:", err);
  process.exit(1);
});
