// src/db/migrate-encryption.ts
// Migration to add encrypted columns for SOC2/GDPR compliance
// Run after main migrate.ts: npx ts-node src/db/migrate-encryption.ts

import { pool } from "./pool";
import { encrypt, decrypt, isEncrypted, FieldContext, validateEncryptionConfig } from "../services/encryption";

async function migrateEncryption() {
  console.log("🔐 Starting encryption migration...\n");

  // Validate encryption key is configured
  const keyCheck = validateEncryptionConfig();
  if (!keyCheck.valid) {
    console.error(`❌ Encryption key not configured: ${keyCheck.error}`);
    console.error("Set ENCRYPTION_KEY environment variable before running this migration.");
    console.error("Generate with: openssl rand -base64 32");
    process.exit(1);
  }
  console.log("✅ Encryption key validated\n");

  // Phase 1: Add encrypted columns (nullable, alongside existing)
  console.log("Phase 1: Adding encrypted columns...\n");

  // 1. wearable_tokens - OAuth tokens
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'wearable_tokens' AND column_name = 'access_token_enc'
      ) THEN
        ALTER TABLE wearable_tokens ADD COLUMN access_token_enc TEXT;
        ALTER TABLE wearable_tokens ADD COLUMN refresh_token_enc TEXT;
      END IF;
    END $$;
  `);
  console.log("  ✅ wearable_tokens: added encrypted columns");

  // 2. hc_apple_tokens - Apple Health sync tokens
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'hc_apple_tokens' AND column_name = 'token_enc'
      ) THEN
        ALTER TABLE hc_apple_tokens ADD COLUMN token_enc TEXT;
      END IF;
    END $$;
  `);
  console.log("  ✅ hc_apple_tokens: added encrypted column");

  // 3. hc_health_latest - Health metrics (bundle into JSON for encryption)
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'hc_health_latest' AND column_name = 'metrics_enc'
      ) THEN
        ALTER TABLE hc_health_latest ADD COLUMN metrics_enc TEXT;
      END IF;
    END $$;
  `);
  console.log("  ✅ hc_health_latest: added encrypted column");

  // 4. hc_user_preferences - PII (goals, targets)
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'hc_user_preferences' AND column_name = 'pii_enc'
      ) THEN
        ALTER TABLE hc_user_preferences ADD COLUMN pii_enc TEXT;
      END IF;
    END $$;
  `);
  console.log("  ✅ hc_user_preferences: added encrypted column");

  // 5. hc_weight_logs - Weight data (sensitive health info)
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'hc_weight_logs' AND column_name = 'weight_enc'
      ) THEN
        ALTER TABLE hc_weight_logs ADD COLUMN weight_enc TEXT;
      END IF;
    END $$;
  `);
  console.log("  ✅ hc_weight_logs: added encrypted column");

  // 6. hc_meals - Nutrition data (items JSONB contains food details)
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'hc_meals' AND column_name = 'items_enc'
      ) THEN
        ALTER TABLE hc_meals ADD COLUMN items_enc TEXT;
      END IF;
    END $$;
  `);
  console.log("  ✅ hc_meals: added encrypted column");

  // 7. Add encryption_version column to track key versions
  const tables = [
    'wearable_tokens',
    'hc_apple_tokens',
    'hc_health_latest',
    'hc_user_preferences',
    'hc_weight_logs',
    'hc_meals',
  ];

  for (const table of tables) {
    await pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = '${table}' AND column_name = 'encryption_migrated_at'
        ) THEN
          ALTER TABLE ${table} ADD COLUMN encryption_migrated_at TIMESTAMPTZ;
        END IF;
      END $$;
    `);
  }
  console.log("  ✅ Added encryption_migrated_at to all tables\n");

  // Phase 2: Migrate existing data to encrypted columns
  console.log("Phase 2: Migrating existing data to encrypted format...\n");

  // Migrate wearable_tokens
  const wearableTokens = await pool.query(`
    SELECT id, access_token, refresh_token
    FROM wearable_tokens
    WHERE access_token_enc IS NULL AND access_token IS NOT NULL
  `);

  let migratedCount = 0;
  for (const row of wearableTokens.rows) {
    try {
      const accessEnc = encrypt(row.access_token, FieldContext.OAUTH_TOKEN);
      const refreshEnc = encrypt(row.refresh_token, FieldContext.REFRESH_TOKEN);

      await pool.query(`
        UPDATE wearable_tokens
        SET access_token_enc = $1,
            refresh_token_enc = $2,
            encryption_migrated_at = NOW()
        WHERE id = $3
      `, [accessEnc, refreshEnc, row.id]);
      migratedCount++;
    } catch (err) {
      console.error(`  ⚠️ Failed to encrypt wearable_tokens id=${row.id}:`, err);
    }
  }
  console.log(`  ✅ wearable_tokens: migrated ${migratedCount} rows`);

  // Migrate hc_apple_tokens
  const appleTokens = await pool.query(`
    SELECT id, token
    FROM hc_apple_tokens
    WHERE token_enc IS NULL AND token IS NOT NULL
  `);

  migratedCount = 0;
  for (const row of appleTokens.rows) {
    try {
      const tokenEnc = encrypt(row.token, FieldContext.OAUTH_TOKEN);

      await pool.query(`
        UPDATE hc_apple_tokens
        SET token_enc = $1,
            encryption_migrated_at = NOW()
        WHERE id = $2
      `, [tokenEnc, row.id]);
      migratedCount++;
    } catch (err) {
      console.error(`  ⚠️ Failed to encrypt hc_apple_tokens id=${row.id}:`, err);
    }
  }
  console.log(`  ✅ hc_apple_tokens: migrated ${migratedCount} rows`);

  // Migrate hc_health_latest (bundle all metrics into encrypted JSON)
  // Note: This table uses shopify_customer_id as unique key, not id
  const healthMetrics = await pool.query(`
    SELECT shopify_customer_id, steps, active_calories, resting_energy, latest_heart_rate_bpm, workouts_today
    FROM hc_health_latest
    WHERE metrics_enc IS NULL
  `);

  migratedCount = 0;
  for (const row of healthMetrics.rows) {
    try {
      const metrics = {
        steps: row.steps,
        activeCalories: row.active_calories,
        restingEnergy: row.resting_energy,
        heartRate: row.latest_heart_rate_bpm,
        workouts: row.workouts_today,
      };
      const metricsEnc = encrypt(metrics, FieldContext.HEALTH_METRICS);

      await pool.query(`
        UPDATE hc_health_latest
        SET metrics_enc = $1,
            encryption_migrated_at = NOW()
        WHERE shopify_customer_id = $2
      `, [metricsEnc, row.shopify_customer_id]);
      migratedCount++;
    } catch (err) {
      console.error(`  ⚠️ Failed to encrypt hc_health_latest customer=${row.shopify_customer_id}:`, err);
    }
  }
  console.log(`  ✅ hc_health_latest: migrated ${migratedCount} rows`);

  // Migrate hc_user_preferences (goals are PII)
  const userPrefs = await pool.query(`
    SELECT id, goal_weight_lbs, hydration_target_ml, calories_target,
           protein_target, carbs_target, fat_target
    FROM hc_user_preferences
    WHERE pii_enc IS NULL
  `);

  migratedCount = 0;
  for (const row of userPrefs.rows) {
    try {
      const pii = {
        goalWeight: row.goal_weight_lbs,
        hydrationTarget: row.hydration_target_ml,
        caloriesTarget: row.calories_target,
        proteinTarget: row.protein_target,
        carbsTarget: row.carbs_target,
        fatTarget: row.fat_target,
      };
      const piiEnc = encrypt(pii, FieldContext.PII);

      await pool.query(`
        UPDATE hc_user_preferences
        SET pii_enc = $1,
            encryption_migrated_at = NOW()
        WHERE id = $2
      `, [piiEnc, row.id]);
      migratedCount++;
    } catch (err) {
      console.error(`  ⚠️ Failed to encrypt hc_user_preferences id=${row.id}:`, err);
    }
  }
  console.log(`  ✅ hc_user_preferences: migrated ${migratedCount} rows`);

  // Migrate hc_weight_logs
  const weightLogs = await pool.query(`
    SELECT id, weight_lbs
    FROM hc_weight_logs
    WHERE weight_enc IS NULL AND weight_lbs IS NOT NULL
  `);

  migratedCount = 0;
  for (const row of weightLogs.rows) {
    try {
      const weightEnc = encrypt(row.weight_lbs.toString(), FieldContext.WEIGHT_DATA);

      await pool.query(`
        UPDATE hc_weight_logs
        SET weight_enc = $1,
            encryption_migrated_at = NOW()
        WHERE id = $2
      `, [weightEnc, row.id]);
      migratedCount++;
    } catch (err) {
      console.error(`  ⚠️ Failed to encrypt hc_weight_logs id=${row.id}:`, err);
    }
  }
  console.log(`  ✅ hc_weight_logs: migrated ${migratedCount} rows`);

  // Migrate hc_meals (items JSONB contains food details)
  const meals = await pool.query(`
    SELECT id, items
    FROM hc_meals
    WHERE items_enc IS NULL AND items IS NOT NULL
  `);

  migratedCount = 0;
  for (const row of meals.rows) {
    try {
      const itemsEnc = encrypt(row.items, FieldContext.NUTRITION_DATA);

      await pool.query(`
        UPDATE hc_meals
        SET items_enc = $1,
            encryption_migrated_at = NOW()
        WHERE id = $2
      `, [itemsEnc, row.id]);
      migratedCount++;
    } catch (err) {
      console.error(`  ⚠️ Failed to encrypt hc_meals id=${row.id}:`, err);
    }
  }
  console.log(`  ✅ hc_meals: migrated ${migratedCount} rows`);

  // Phase 3: Create indexes for encrypted columns
  console.log("\nPhase 3: Creating indexes...\n");

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_wearable_tokens_migrated
    ON wearable_tokens(encryption_migrated_at) WHERE encryption_migrated_at IS NOT NULL;
  `);
  console.log("  ✅ Created migration tracking indexes");

  // Summary
  console.log("\n🎉 Encryption migration completed!");
  console.log("\n⚠️  IMPORTANT: Plaintext columns are preserved for rollback.");
  console.log("    After verifying encrypted data, run the cleanup migration");
  console.log("    to remove plaintext columns (src/db/cleanup-plaintext.ts).\n");

  await pool.end();
}

migrateEncryption().catch((err) => {
  console.error("❌ Encryption migration failed:", err);
  process.exit(1);
});
