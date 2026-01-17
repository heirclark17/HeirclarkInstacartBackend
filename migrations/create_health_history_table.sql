-- Migration: Create Health History Table for MCP Sync
-- Description: Historical health data aggregated from multiple MCP sources (Fitbit, Google Fit, Apple Health)
-- Date: 2026-01-16

CREATE TABLE IF NOT EXISTS hc_health_history (
  id BIGSERIAL PRIMARY KEY,
  customer_id VARCHAR(255) NOT NULL,
  source_type VARCHAR(50) NOT NULL CHECK (source_type IN ('fitbit', 'google-fit', 'apple-health', 'manual')),
  recorded_date DATE NOT NULL,

  -- Activity metrics
  steps INTEGER,
  active_calories INTEGER,
  resting_calories INTEGER,
  distance_meters INTEGER,
  floors_climbed INTEGER,
  active_minutes INTEGER,

  -- Sleep metrics (optional - may be in separate table)
  sleep_minutes INTEGER,
  deep_sleep_minutes INTEGER,
  light_sleep_minutes INTEGER,
  rem_sleep_minutes INTEGER,
  awake_minutes INTEGER,
  sleep_efficiency INTEGER,

  -- Heart rate metrics
  resting_heart_rate INTEGER,
  avg_heart_rate INTEGER,
  max_heart_rate INTEGER,
  min_heart_rate INTEGER,

  -- Weight metrics
  weight_kg DECIMAL(10,2),
  body_fat_percentage DECIMAL(5,2),
  bmi DECIMAL(5,2),

  -- Metadata
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  -- Unique constraint: one record per customer, source, and date
  UNIQUE (customer_id, source_type, recorded_date)
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_health_history_customer_date
  ON hc_health_history (customer_id, recorded_date DESC);

CREATE INDEX IF NOT EXISTS idx_health_history_source_date
  ON hc_health_history (source_type, recorded_date DESC);

CREATE INDEX IF NOT EXISTS idx_health_history_customer_source
  ON hc_health_history (customer_id, source_type, recorded_date DESC);

-- Add comment
COMMENT ON TABLE hc_health_history IS 'Historical health and fitness data synced from MCP servers (Fitbit, Google Fit, Apple Health)';
