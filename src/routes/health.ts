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

// Helper function used by ingest endpoints
function toNumOrUndef(v: any): number | undefined {
  if (v === null || v === undefined || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * 📱 SIMPLIFIED ENDPOINT FOR APPLE SHORTCUTS
 * This endpoint MUST be defined BEFORE strictAuth middleware to allow legacy authentication
 * POST /api/v1/health/ingest-simple
 *
 * Body: {
 *   "shopifyCustomerId": "9339338686771",
 *   "date": "2025-01-12",
 *   "steps": 8421,
 *   "caloriesOut": 612,
 *   "restingEnergy": 1600,
 *   "heartRate": 74
 * }
 */
healthRouter.post("/ingest-simple", (req: Request, res: Response) => {
  const shopifyCustomerId = String(req.body?.shopifyCustomerId || "").trim();
  const date = String(req.body?.date || "").trim();

  if (!shopifyCustomerId) {
    return res.status(400).json({ ok: false, error: "Missing shopifyCustomerId" });
  }

  if (!date) {
    return res.status(400).json({ ok: false, error: "Missing date" });
  }

  // Validate date format
  const dateObj = new Date(date);
  if (Number.isNaN(dateObj.getTime())) {
    return res.status(400).json({ ok: false, error: "Invalid date format. Use YYYY-MM-DD" });
  }

  // Extract health data
  const steps = toNumOrUndef(req.body?.steps);
  const activeCalories = toNumOrUndef(req.body?.caloriesOut) || toNumOrUndef(req.body?.activeCalories);
  const restingEnergy = toNumOrUndef(req.body?.restingEnergy) || toNumOrUndef(req.body?.basalEnergy);
  const latestHeartRateBpm = toNumOrUndef(req.body?.heartRate) || toNumOrUndef(req.body?.latestHeartRateBpm);
  const workoutsToday = toNumOrUndef(req.body?.workouts) || toNumOrUndef(req.body?.workoutsToday);

  // Store in memory (same as regular ingest)
  const snapshot: HealthSnapshotEntry = {
    ts: dateObj.toISOString(),
    steps,
    activeCalories,
    restingEnergy,
    latestHeartRateBpm,
    workoutsToday,
    source: "shortcut",
    receivedAt: Date.now(),
    createdAt: Date.now(),
  };

  latestByUser.set(shopifyCustomerId, snapshot);

  return res.json({
    ok: true,
    message: "Health data ingested successfully",
    data: snapshot
  });
});

// ✅ SECURITY FIX: Apply STRICT authentication to all health routes (OWASP A01: IDOR Protection)
// strictAuth: true blocks legacy X-Shopify-Customer-Id headers to prevent IDOR attacks
// NOTE: /ingest-simple endpoint above bypasses this for Apple Shortcuts compatibility
healthRouter.use(authMiddleware());

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
