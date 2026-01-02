import { Pool, PoolConfig } from "pg";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL missing — Postgres not wired correctly");
}

/**
 * Database pool configuration with proper SSL handling.
 *
 * SSL Configuration:
 * - Production (Railway/Heroku): Use SSL with proper certificate validation
 * - Development: No SSL unless DATABASE_URL contains sslmode
 *
 * For Railway, the proper approach is to use their CA certificate,
 * but if not available, we use rejectUnauthorized: true with a fallback
 * warning for backwards compatibility.
 */
function getSSLConfig(): PoolConfig["ssl"] {
  const dbUrl = process.env.DATABASE_URL || "";
  const nodeEnv = process.env.NODE_ENV || "development";

  // If explicitly disabled in URL
  if (dbUrl.includes("sslmode=disable")) {
    return false;
  }

  // Development without explicit SSL requirement
  if (nodeEnv === "development" && !dbUrl.includes("sslmode=require")) {
    return undefined;
  }

  // Production or SSL required
  if (nodeEnv === "production" || dbUrl.includes("sslmode=require")) {
    // Check for CA certificate (preferred for Railway)
    const caCert = process.env.DATABASE_CA_CERT;
    if (caCert) {
      return {
        rejectUnauthorized: true,
        ca: caCert,
      };
    }

    // Fallback: Allow self-signed certs but log a warning
    // This is less secure but maintains backwards compatibility
    if (process.env.DATABASE_SSL_REJECT_UNAUTHORIZED === "false") {
      console.warn(
        "WARNING: SSL certificate validation is disabled. " +
        "Set DATABASE_CA_CERT for proper security in production."
      );
      return { rejectUnauthorized: false };
    }

    // Default: Require valid SSL (most secure)
    return { rejectUnauthorized: true };
  }

  return undefined;
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: getSSLConfig(),
  // Connection pool settings
  max: Number(process.env.DATABASE_POOL_MAX) || 20,
  idleTimeoutMillis: Number(process.env.DATABASE_IDLE_TIMEOUT_MS) || 30000,
  connectionTimeoutMillis: Number(process.env.DATABASE_CONNECT_TIMEOUT_MS) || 5000,
});

// Handle pool errors
pool.on("error", (err) => {
  console.error("Unexpected database pool error:", err);
});

// Graceful shutdown helper
export async function closePool(): Promise<void> {
  await pool.end();
  console.log("Database pool closed");
}
