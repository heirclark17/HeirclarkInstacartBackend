import { pool } from "./pool";

async function migrateFavorites() {
  console.log("Starting favorites migration...\n");

  // Create hc_meal_favorites table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS hc_meal_favorites (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      shopify_customer_id TEXT NOT NULL,
      name TEXT NOT NULL,
      label TEXT,
      items JSONB NOT NULL DEFAULT '[]',
      total_calories INTEGER DEFAULT 0,
      total_protein INTEGER DEFAULT 0,
      total_carbs INTEGER DEFAULT 0,
      total_fat INTEGER DEFAULT 0,
      use_count INTEGER DEFAULT 0,
      last_used_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  console.log("✅ hc_meal_favorites table created");

  // Create indexes
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_hc_meal_favorites_customer
    ON hc_meal_favorites(shopify_customer_id);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_hc_meal_favorites_use_count
    ON hc_meal_favorites(shopify_customer_id, use_count DESC);
  `);
  console.log("✅ Indexes created");

  console.log("\n🎉 Favorites migration completed successfully!");
  await pool.end();
}

migrateFavorites().catch((err) => {
  console.error("❌ Favorites migration failed", err);
  process.exit(1);
});
