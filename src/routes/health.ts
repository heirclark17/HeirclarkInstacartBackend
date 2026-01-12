// src/routes/health.ts
import { Router, Request, Response } from "express";
import { randomUUID } from "crypto";
import {
  createPairingTokenMap,
  createDeviceMap,
  createHealthSnapshotMap,
} from "../services/memoryCleanup";
import { authMiddleware, getCustomerId, AuthenticatedRequest } from "../middleware/auth";

export const healthRouter = Router();

// ✅ SECURITY FIX: Apply STRICT authentication to all health routes (OWASP A01: IDOR Protection)
// strictAuth: true blocks legacy X-Shopify-Customer-Id headers to prevent IDOR attacks
healthRouter.use(authMiddleware({ strictAuth: true }));

/**
 * IN-MEMORY STORE WITH TTL-BASED CLEANUP
 * Uses cleanup-enabled Maps to prevent unbounded memory growth.
 * For production persistence, use the healthBridge routes which use PostgreSQL.
 */

interface PairingTokenEntry {
  shopifyCustomerId: string;
  createdAt: number;
  expiresAt: number;
}

interface DeviceEntry {
  shopifyCustomerId: string;
  createdAt: number;
  lastSeenAt: number;
}

interface HealthSnapshotEntry {
  ts: string;
  steps?: number;
  activeCalories?: number;
  restingEnergy?: number;
  latestHeartRateBpm?: number;
  workoutsToday?: number;
  source: "shortcut";
  receivedAt: number;
  createdAt: number;
}

// pairingToken -> { shopifyCustomerId, createdAt, expiresAt }
const pairingTokens = createPairingTokenMap<PairingTokenEntry>();

// deviceKey -> { shopifyCustomerId, createdAt, lastSeenAt }
const devices = createDeviceMap<DeviceEntry>();

// shopifyCustomerId -> latest snapshot
const latestByUser = createHealthSnapshotMap<HealthSnapshotEntry>();

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
  const expiresAt = createdAt + 15 * 60 * 1000; // 15 minutes
  pairingTokens.set(pairingToken, { shopifyCustomerId, createdAt, expiresAt });

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
  const restingEnergy = toNumOrUndef(req.body?.restingEnergy) ?? toNumOrUndef(req.body?.basalEnergy);
  const latestHeartRateBpm = toNumOrUndef(req.body?.latestHeartRateBpm);
  const workoutsToday = toNumOrUndef(req.body?.workoutsToday);

  latestByUser.set(device.shopifyCustomerId, {
    ts,
    steps,
    activeCalories,
    restingEnergy,
    latestHeartRateBpm,
    workoutsToday,
    source: "shortcut",
    receivedAt: Date.now(),
    createdAt: Date.now(),
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
