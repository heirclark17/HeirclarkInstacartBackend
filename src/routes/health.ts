// src/routes/health.ts
import { Router, Request, Response } from "express";
import { randomUUID } from "crypto";

export const healthRouter = Router();

/**
 * DEV/DEMO IN-MEMORY STORE
 * Replace with DB/Redis for production (Railway restarts wipe memory).
 */

// pairingToken -> { shopifyCustomerId, createdAt }
const pairingTokens = new Map<
  string,
  { shopifyCustomerId: string; createdAt: number }
>();

// deviceKey -> { shopifyCustomerId, createdAt, lastSeenAt }
const devices = new Map<
  string,
  { shopifyCustomerId: string; createdAt: number; lastSeenAt: number }
>();

// shopifyCustomerId -> latest snapshot
const latestByUser = new Map<
  string,
  {
    ts: string;
    steps?: number;
    activeCalories?: number;
    latestHeartRateBpm?: number;
    workoutsToday?: number;
    source: "shortcut";
    receivedAt: number;
  }
>();

/**
 * OPTIONAL helper:
 * Web creates pairingToken (you can call this from Shopify when user clicks "Connect Apple Health")
 *
 * POST /api/v1/health/pair/start
 * Body: { shopifyCustomerId: "123" }
 * Returns: { ok: true, pairingToken, expiresAt }
 */
healthRouter.post("/pair/start", (req: Request, res: Response) => {
  const shopifyCustomerId = String(req.body?.shopifyCustomerId || "").trim();
  if (!shopifyCustomerId) {
    return res.status(400).json({ ok: false, error: "Missing shopifyCustomerId" });
  }

  const pairingToken = randomUUID();
  const createdAt = Date.now();
  pairingTokens.set(pairingToken, { shopifyCustomerId, createdAt });

  const expiresAt = createdAt + 15 * 60 * 1000; // 15 minutes
  return res.json({ ok: true, pairingToken, expiresAt });
});

/**
 * ✅ REQUIRED (Shortcut step 1)
 * POST /api/v1/health/pair/complete
 * Body: { "pairingToken": "..." }
 * Returns: { ok: true, deviceKey: "..." }
 */
healthRouter.post("/pair/complete", (req: Request, res: Response) => {
  const pairingToken = String(req.body?.pairingToken || "").trim();
  if (!pairingToken) {
    return res.status(400).json({ ok: false, error: "Missing pairingToken" });
  }

  const rec = pairingTokens.get(pairingToken);
  if (!rec) {
    return res.status(401).json({ ok: false, error: "Invalid or expired pairingToken" });
  }

  const MAX_AGE_MS = 15 * 60 * 1000;
  if (Date.now() - rec.createdAt > MAX_AGE_MS) {
    pairingTokens.delete(pairingToken);
    return res.status(401).json({ ok: false, error: "pairingToken expired" });
  }

  // One-time use
  pairingTokens.delete(pairingToken);

  const deviceKey = randomUUID();
  devices.set(deviceKey, {
    shopifyCustomerId: rec.shopifyCustomerId,
    createdAt: Date.now(),
    lastSeenAt: Date.now(),
  });

  return res.json({ ok: true, deviceKey });
});

/**
 * ✅ REQUIRED (Shortcut step 2)
 * POST /api/v1/health/ingest
 *
 * Body example:
 * {
 *   "deviceKey": "YOUR_SAVED_DEVICE_KEY",
 *   "ts": "2025-12-13T17:22:00Z",
 *   "steps": 8421,
 *   "activeCalories": 612,
 *   "latestHeartRateBpm": 74,
 *   "workoutsToday": 1
 * }
 */
healthRouter.post("/ingest", (req: Request, res: Response) => {
  const deviceKey = String(req.body?.deviceKey || "").trim();
  const ts = String(req.body?.ts || "").trim();

  if (!deviceKey) return res.status(400).json({ ok: false, error: "Missing deviceKey" });
  if (!ts) return res.status(400).json({ ok: false, error: "Missing ts" });

  const device = devices.get(deviceKey);
  if (!device) return res.status(401).json({ ok: false, error: "Invalid deviceKey" });

  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) {
    return res.status(400).json({ ok: false, error: "ts must be a valid ISO date string" });
  }

  const steps = toNumOrUndef(req.body?.steps);
  const activeCalories = toNumOrUndef(req.body?.activeCalories);
  const latestHeartRateBpm = toNumOrUndef(req.body?.latestHeartRateBpm);
  const workoutsToday = toNumOrUndef(req.body?.workoutsToday);

  latestByUser.set(device.shopifyCustomerId, {
    ts,
    steps,
    activeCalories,
    latestHeartRateBpm,
    workoutsToday,
    source: "shortcut",
    receivedAt: Date.now(),
  });

  devices.set(deviceKey, { ...device, lastSeenAt: Date.now() });

  return res.json({ ok: true });
});

/**
 * OPTIONAL read endpoint for your website widget:
 * GET /api/v1/health/latest?shopifyCustomerId=123
 */
healthRouter.get("/latest", (req: Request, res: Response) => {
  const shopifyCustomerId = String(req.query?.shopifyCustomerId || "").trim();
  if (!shopifyCustomerId) {
    return res.status(400).json({ ok: false, error: "Missing shopifyCustomerId" });
  }

  const data = latestByUser.get(shopifyCustomerId) || null;
  return res.json({ ok: true, data });
});

function toNumOrUndef(v: any): number | undefined {
  if (v === null || v === undefined || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}
