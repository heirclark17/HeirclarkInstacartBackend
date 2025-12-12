// src/utils/services/appleHealthStore.ts
import crypto from "crypto";

type LinkRecord = {
  shopifyCustomerId: string;
  expiresAt: number; // epoch ms
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

const LINK_CODE_TTL_MIN = Number(process.env.HC_APPLE_LINK_CODE_TTL_MINUTES || 10);
const TOKEN_TTL_DAYS = Number(process.env.HC_APPLE_TOKEN_TTL_DAYS || 365);
const SIGN_SECRET = process.env.HC_APPLE_SYNC_SIGNING_SECRET || "dev-secret-change-me";

const linkCodes = new Map<string, LinkRecord>();
const tokens = new Map<string, TokenRecord>();

// store samples by user+day
// key = `${shopifyCustomerId}|${yyyy-mm-dd}`
const dailyApple = new Map<
  string,
  {
    burnedKcal: number;
    consumedKcal: number;
    lastUpdatedAt: number;
  }
>();

function now() {
  return Date.now();
}

function randCode(len = 24) {
  return crypto.randomBytes(len).toString("hex");
}

function dayKeyISO(date = new Date()) {
  // yyyy-mm-dd in server local time (OK for v1; later use user tz)
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
  const expiresAt = now() + LINK_CODE_TTL_MIN * 60_000;
  linkCodes.set(code, { shopifyCustomerId, expiresAt });
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

  return { token, expiresAt, shopifyCustomerId: rec.shopifyCustomerId };
}

export function appleAuthToken(token: string) {
  const rec = tokens.get(token);
  if (!rec) return null;
  if (rec.expiresAt < now()) {
    tokens.delete(token);
    return null;
  }
  return rec;
}

export function appleUpsertSamples(shopifyCustomerId: string, payload: SyncPayload) {
  // roll-up to “today” by sample start date (v1)
  // If you want historical: we can bucket by each sample’s day.
  const todayKey = `${shopifyCustomerId}|${dayKeyISO(new Date())}`;

  const curr = dailyApple.get(todayKey) || {
    burnedKcal: 0,
    consumedKcal: 0,
    lastUpdatedAt: 0,
  };

  let delta = 0;
  for (const s of payload.samples || []) {
    const kcal = Number(s.kcal || 0);
    if (!Number.isFinite(kcal)) continue;
    delta += kcal;
  }

  if (payload.type === "active_energy_burned") curr.burnedKcal += delta;
  if (payload.type === "dietary_energy_consumed") curr.consumedKcal += delta;

  curr.lastUpdatedAt = now();
  dailyApple.set(todayKey, curr);

  return { ...curr };
}

export function appleGetToday(shopifyCustomerId: string) {
  const todayKey = `${shopifyCustomerId}|${dayKeyISO(new Date())}`;
  const v = dailyApple.get(todayKey);
  return (
    v || {
      burnedKcal: 0,
      consumedKcal: 0,
      lastUpdatedAt: 0,
    }
  );
}
