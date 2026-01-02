// src/utils/services/appleHealthStore.ts
import crypto from "crypto";
import { pool } from "../../db/pool";
import {
  createPairingTokenMap,
  createDailyDataMap,
} from "../../services/memoryCleanup";

type LinkRecord = {
  shopifyCustomerId: string;
  expiresAt: number; // epoch ms
  createdAt: number;
};

type TokenRecord = {
  shopifyCustomerId: string;
  createdAt: number;
  expiresAt: number;
};

type Sample = {
  start: string; // ISO
  end: string;   // ISO
  kcal: number;
  sourceName?: string;
  sourceBundleId?: string;
};

type SyncPayload = {
  type: "active_energy_burned" | "dietary_energy_consumed";
  samples: Sample[];
  deleted?: { start: string; end: string }[];
};

type DailyAppleData = {
  burnedKcal: number;
  consumedKcal: number;
  lastUpdatedAt: number;
  createdAt: number;
};

const LINK_CODE_TTL_MIN = Number(process.env.HC_APPLE_LINK_CODE_TTL_MINUTES || 10);
const TOKEN_TTL_DAYS = Number(process.env.HC_APPLE_TOKEN_TTL_DAYS || 365);

// SECURITY: Require proper secret in production, fail loudly if not set
function getSigningSecret(): string {
  const secret = process.env.HC_APPLE_SYNC_SIGNING_SECRET;

  if (!secret) {
    const nodeEnv = process.env.NODE_ENV || "development";
    if (nodeEnv === "production") {
      throw new Error(
        "CRITICAL: HC_APPLE_SYNC_SIGNING_SECRET must be set in production. " +
        "Generate a secure random string of at least 32 characters."
      );
    }
    console.warn(
      "WARNING: HC_APPLE_SYNC_SIGNING_SECRET not set. Using insecure default for development only."
    );
    return "dev-only-insecure-secret-do-not-use-in-prod";
  }

  if (secret.length < 16) {
    throw new Error(
      "HC_APPLE_SYNC_SIGNING_SECRET must be at least 16 characters for security."
    );
  }

  return secret;
}

const SIGN_SECRET = getSigningSecret();

// Use cleanup-enabled Maps instead of plain Maps
const linkCodes = createPairingTokenMap<LinkRecord>();
const tokens = createPairingTokenMap<TokenRecord>();
const dailyApple = createDailyDataMap<DailyAppleData>();

function now() {
  return Date.now();
}

function randCode(len = 24) {
  return crypto.randomBytes(len).toString("hex");
}

function dayKeyISO(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function hmacToken(raw: string) {
  return crypto.createHmac("sha256", SIGN_SECRET).update(raw).digest("hex");
}

export function appleCreateLinkCode(shopifyCustomerId: string) {
  const code = randCode(12);
  const createdAt = now();
  const expiresAt = createdAt + LINK_CODE_TTL_MIN * 60_000;
  linkCodes.set(code, { shopifyCustomerId, expiresAt, createdAt });
  return { code, expiresAt };
}

export function appleCompleteLink(code: string) {
  const rec = linkCodes.get(code);
  if (!rec) return null;
  if (rec.expiresAt < now()) {
    linkCodes.delete(code);
    return null;
  }

  // mint long-lived sync token
  const createdAt = now();
  const expiresAt = createdAt + TOKEN_TTL_DAYS * 24 * 60 * 60_000;
  const raw = `${rec.shopifyCustomerId}|${createdAt}|${randCode(8)}`;
  const token = `hc_apple_${hmacToken(raw)}`;

  tokens.set(token, { shopifyCustomerId: rec.shopifyCustomerId, createdAt, expiresAt });
  linkCodes.delete(code);

  // Also persist to database for durability
  persistToken(token, rec.shopifyCustomerId, expiresAt).catch((err) => {
    console.error("[appleHealthStore] Failed to persist token:", err);
  });

  return { token, expiresAt, shopifyCustomerId: rec.shopifyCustomerId };
}

async function persistToken(token: string, customerId: string, expiresAt: number): Promise<void> {
  await pool.query(
    `INSERT INTO hc_apple_tokens (token, shopify_customer_id, expires_at)
     VALUES ($1, $2, $3)
     ON CONFLICT (token) DO UPDATE SET expires_at = $3`,
    [token, customerId, new Date(expiresAt).toISOString()]
  );
}

export async function appleAuthToken(token: string): Promise<TokenRecord | null> {
  // Check in-memory cache first
  const cached = tokens.get(token);
  if (cached) {
    if (cached.expiresAt < now()) {
      tokens.delete(token);
      return null;
    }
    return cached;
  }

  // Fall back to database
  try {
    const result = await pool.query(
      `SELECT shopify_customer_id, created_at, expires_at
       FROM hc_apple_tokens
       WHERE token = $1 AND expires_at > NOW()`,
      [token]
    );

    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    const rec: TokenRecord = {
      shopifyCustomerId: row.shopify_customer_id,
      createdAt: new Date(row.created_at).getTime(),
      expiresAt: new Date(row.expires_at).getTime(),
    };

    // Cache for future requests
    tokens.set(token, rec);
    return rec;
  } catch (err) {
    console.error("[appleHealthStore] Failed to lookup token:", err);
    return null;
  }
}

export async function appleUpsertSamples(
  shopifyCustomerId: string,
  payload: SyncPayload
): Promise<{ burnedKcal: number; consumedKcal: number; lastUpdatedAt: number }> {
  const today = dayKeyISO(new Date());
  const cacheKey = `${shopifyCustomerId}|${today}`;

  // Get current values (from cache or DB)
  let curr = dailyApple.get(cacheKey);
  if (!curr) {
    curr = await loadDailyFromDb(shopifyCustomerId, today);
  }

  let delta = 0;
  for (const s of payload.samples || []) {
    const kcal = Number(s.kcal || 0);
    if (!Number.isFinite(kcal)) continue;
    delta += kcal;
  }

  if (payload.type === "active_energy_burned") curr.burnedKcal += delta;
  if (payload.type === "dietary_energy_consumed") curr.consumedKcal += delta;
  curr.lastUpdatedAt = now();

  // Update cache
  dailyApple.set(cacheKey, curr);

  // Persist to database
  await persistDailyToDb(shopifyCustomerId, today, curr);

  return {
    burnedKcal: curr.burnedKcal,
    consumedKcal: curr.consumedKcal,
    lastUpdatedAt: curr.lastUpdatedAt,
  };
}

async function loadDailyFromDb(
  customerId: string,
  date: string
): Promise<DailyAppleData> {
  try {
    const result = await pool.query(
      `SELECT burned_kcal, consumed_kcal, last_updated_at
       FROM hc_apple_health_daily
       WHERE shopify_customer_id = $1 AND date = $2`,
      [customerId, date]
    );

    if (result.rows.length > 0) {
      const row = result.rows[0];
      return {
        burnedKcal: Number(row.burned_kcal) || 0,
        consumedKcal: Number(row.consumed_kcal) || 0,
        lastUpdatedAt: new Date(row.last_updated_at).getTime(),
        createdAt: Date.now(),
      };
    }
  } catch (err) {
    console.error("[appleHealthStore] Failed to load daily data:", err);
  }

  return {
    burnedKcal: 0,
    consumedKcal: 0,
    lastUpdatedAt: 0,
    createdAt: Date.now(),
  };
}

async function persistDailyToDb(
  customerId: string,
  date: string,
  data: DailyAppleData
): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO hc_apple_health_daily
       (shopify_customer_id, date, burned_kcal, consumed_kcal, last_updated_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (shopify_customer_id, date)
       DO UPDATE SET
         burned_kcal = $3,
         consumed_kcal = $4,
         last_updated_at = NOW()`,
      [customerId, date, data.burnedKcal, data.consumedKcal]
    );
  } catch (err) {
    console.error("[appleHealthStore] Failed to persist daily data:", err);
  }
}

export async function appleGetToday(shopifyCustomerId: string): Promise<{
  burnedKcal: number;
  consumedKcal: number;
  lastUpdatedAt: number;
}> {
  const today = dayKeyISO(new Date());
  const cacheKey = `${shopifyCustomerId}|${today}`;

  // Check cache first
  const cached = dailyApple.get(cacheKey);
  if (cached) {
    return {
      burnedKcal: cached.burnedKcal,
      consumedKcal: cached.consumedKcal,
      lastUpdatedAt: cached.lastUpdatedAt,
    };
  }

  // Load from database
  const data = await loadDailyFromDb(shopifyCustomerId, today);
  dailyApple.set(cacheKey, data);

  return {
    burnedKcal: data.burnedKcal,
    consumedKcal: data.consumedKcal,
    lastUpdatedAt: data.lastUpdatedAt,
  };
}

/**
 * Get historical Apple Health data for a date range.
 */
export async function appleGetHistory(
  shopifyCustomerId: string,
  startDate: string,
  endDate: string
): Promise<Array<{ date: string; burnedKcal: number; consumedKcal: number }>> {
  try {
    const result = await pool.query(
      `SELECT date, burned_kcal, consumed_kcal
       FROM hc_apple_health_daily
       WHERE shopify_customer_id = $1
         AND date >= $2
         AND date <= $3
       ORDER BY date DESC`,
      [shopifyCustomerId, startDate, endDate]
    );

    return result.rows.map((row) => ({
      date: row.date.toISOString().slice(0, 10),
      burnedKcal: Number(row.burned_kcal) || 0,
      consumedKcal: Number(row.consumed_kcal) || 0,
    }));
  } catch (err) {
    console.error("[appleHealthStore] Failed to get history:", err);
    return [];
  }
}
