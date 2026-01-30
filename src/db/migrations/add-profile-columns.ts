import { pool } from "../pool";

/**
 * Migration: Add profile columns to hc_user_preferences
 *
 * Adds physical profile data for weight goal alignment:
 * - height_cm: User's height in centimeters
 * - current_weight_kg: User's current weight in kg
 * - age: User's age in years
 * - sex: 'male' or 'female'
 * - activity_level: 'sedentary', 'light', 'moderate', 'active', 'very_active'
 * - goal_type: 'lose', 'maintain', 'gain'
 * - target_weight_kg: Target weight in kg (separate from goal_weight_lbs)
 * - target_date: Date to reach target weight
 */
async function migrateProfileColumns() {
  console.log("Starting profile columns migration...\n");

  try {
    // Add height_cm column
    await pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'hc_user_preferences' AND column_name = 'height_cm'
        ) THEN
          ALTER TABLE hc_user_preferences ADD COLUMN height_cm NUMERIC(5,1);
        END IF;
      END $$;
    `);
    console.log("✅ height_cm column ready");

    // Add current_weight_kg column
    await pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'hc_user_preferences' AND column_name = 'current_weight_kg'
        ) THEN
          ALTER TABLE hc_user_preferences ADD COLUMN current_weight_kg NUMERIC(5,1);
        END IF;
      END $$;
    `);
    console.log("✅ current_weight_kg column ready");

    // Add age column
    await pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'hc_user_preferences' AND column_name = 'age'
        ) THEN
          ALTER TABLE hc_user_preferences ADD COLUMN age INTEGER;
        END IF;
      END $$;
    `);
    console.log("✅ age column ready");

    // Add sex column
    await pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'hc_user_preferences' AND column_name = 'sex'
        ) THEN
          ALTER TABLE hc_user_preferences ADD COLUMN sex VARCHAR(10);
        END IF;
      END $$;
    `);
    console.log("✅ sex column ready");

    // Add activity_level column
    await pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'hc_user_preferences' AND column_name = 'activity_level'
        ) THEN
          ALTER TABLE hc_user_preferences ADD COLUMN activity_level VARCHAR(20);
        END IF;
      END $$;
    `);
    console.log("✅ activity_level column ready");

    // Add goal_type column
    await pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'hc_user_preferences' AND column_name = 'goal_type'
        ) THEN
          ALTER TABLE hc_user_preferences ADD COLUMN goal_type VARCHAR(20);
        END IF;
      END $$;
    `);
    console.log("✅ goal_type column ready");

    // Add target_weight_kg column
    await pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'hc_user_preferences' AND column_name = 'target_weight_kg'
        ) THEN
          ALTER TABLE hc_user_preferences ADD COLUMN target_weight_kg NUMERIC(5,1);
        END IF;
      END $$;
    `);
    console.log("✅ target_weight_kg column ready");

    // Add target_date column
    await pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'hc_user_preferences' AND column_name = 'target_date'
        ) THEN
          ALTER TABLE hc_user_preferences ADD COLUMN target_date DATE;
        END IF;
      END $$;
    `);
    console.log("✅ target_date column ready");

    console.log("\n🎉 Profile columns migration completed successfully!");
  } catch (error) {
    console.error("❌ Migration failed:", error);
    throw error;
  } finally {
    await pool.end();
  }
}

// Run migration if executed directly
migrateProfileColumns().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});

export { migrateProfileColumns };
