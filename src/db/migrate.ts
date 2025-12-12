import { pool } from "./pool";

async function migrate() {
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
  await pool.end();
}

migrate().catch((err) => {
  console.error("❌ migration failed", err);
  process.exit(1);
});
