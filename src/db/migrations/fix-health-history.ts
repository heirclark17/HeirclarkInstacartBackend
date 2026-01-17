import { pool } from '../pool';

async function fixHealthHistoryTable() {
  console.log('Fixing hc_health_history table schema...\n');

  try {
    // Drop the existing table if it exists
    console.log('Dropping existing hc_health_history table...');
    await pool.query('DROP TABLE IF EXISTS hc_health_history CASCADE');
    console.log('✅ Dropped existing table\n');

    // Create the table with correct schema
    console.log('Creating hc_health_history table with correct schema...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS hc_health_history (
        id BIGSERIAL PRIMARY KEY,
        customer_id VARCHAR(255) NOT NULL,
        source_type VARCHAR(50) NOT NULL CHECK (source_type IN ('fitbit', 'google-fit', 'apple-health', 'manual')),
        recorded_date DATE NOT NULL,

        steps INTEGER,
        active_calories INTEGER,
        resting_calories INTEGER,
        distance_meters INTEGER,
        floors_climbed INTEGER,
        active_minutes INTEGER,

        sleep_minutes INTEGER,
        deep_sleep_minutes INTEGER,
        light_sleep_minutes INTEGER,
        rem_sleep_minutes INTEGER,
        awake_minutes INTEGER,
        sleep_efficiency INTEGER,

        resting_heart_rate INTEGER,
        avg_heart_rate INTEGER,
        max_heart_rate INTEGER,
        min_heart_rate INTEGER,

        weight_kg DECIMAL(10,2),
        body_fat_percentage DECIMAL(5,2),
        bmi DECIMAL(5,2),

        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

        UNIQUE (customer_id, source_type, recorded_date)
      );
    `);
    console.log('✅ Created hc_health_history table\n');

    // Create indexes
    console.log('Creating indexes...');
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_health_history_customer_date
      ON hc_health_history (customer_id, recorded_date DESC);
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_health_history_source_date
      ON hc_health_history (source_type, recorded_date DESC);
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_health_history_customer_source
      ON hc_health_history (customer_id, source_type, recorded_date DESC);
    `);
    console.log('✅ Created indexes\n');

    console.log('✅ Health history table fixed successfully!\n');
    await pool.end();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error fixing health history table:', error);
    await pool.end();
    process.exit(1);
  }
}

fixHealthHistoryTable();
