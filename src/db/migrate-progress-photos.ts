import { pool } from "./pool";

async function migrateProgressPhotos() {
  console.log("Starting progress photos migration...\n");

  // Create hc_progress_photos table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS hc_progress_photos (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      shopify_customer_id TEXT NOT NULL,
      image_url TEXT NOT NULL,
      weight_lbs NUMERIC(6,2),
      notes TEXT,
      photo_type TEXT DEFAULT 'front',
      taken_at TIMESTAMPTZ DEFAULT NOW(),
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  console.log("✅ hc_progress_photos table created");

  // Create indexes
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_hc_progress_photos_customer
    ON hc_progress_photos(shopify_customer_id);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_hc_progress_photos_customer_date
    ON hc_progress_photos(shopify_customer_id, taken_at DESC);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_hc_progress_photos_type
    ON hc_progress_photos(shopify_customer_id, photo_type, taken_at DESC);
  `);
  console.log("✅ Indexes created");

  console.log("\n🎉 Progress photos migration completed successfully!");
  await pool.end();
}

migrateProgressPhotos().catch((err) => {
  console.error("❌ Progress photos migration failed", err);
  process.exit(1);
});
