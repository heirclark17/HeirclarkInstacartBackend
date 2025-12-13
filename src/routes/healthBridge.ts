// src/routes/healthBridge.ts
import { Router, Request, Response } from "express";
import crypto from "crypto";

export const healthBridgeRouter = Router();

/**
 * DEV/DEMO ONLY: in-memory storage
 * Railway restarts wipe this. Replace with DB/Redis for production.
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

// shopifyCustomerId -> latest metrics snapshot
const latestMetricsByUser = new Map<
  string,
  {
    ts: string;
    steps?: number;
    activeCalories?: number;
    latestHeartRateBpm?: number;
    workoutsToday?: number;
    receivedAt: number;
    source: "shortcut";
  }
>();

const TOKEN_TTL_MS = 15 * 60 * 1000; // 15 minutes

function genToken(): string {
  // URL-safe token
  return crypto.randomBytes(24).toString("base64url");
}

function toNumOrUndef(v: any): number | undefined {
  if (v === null || v === undefined || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * OPTIONAL (but recommended):
 * Website calls this to create the pairingToken the user pastes into Shortcut.
 *
 * POST /api/v1/health/pair/start
 * Body: { shopifyCustomerId: "123" }
 * Returns: { ok: true, pairingToken, expiresAt }
 */
healthBridgeRouter.post("/pair/start", (req: Request, res: Response) => {
  const shopifyCustomerId = String(req.body?.shopifyCustomerId || "").trim();
  if (!shopifyCustomerId) {
    return res.status(400).json({ ok: false, error: "Missing shopifyCustomerId" });
  }

  const pairingToken = genToken();
  const createdAt = Date.now();
  pairingTokens.set(pairingToken, { shopifyCustomerId, createdAt });

  return res.json({ ok: true, pairingToken, expiresAt: createdAt + TOKEN_TTL_MS });
});

/**
 * ✅ REQUIRED (Shortcut pairing)
 * POST /api/v1/health/pair/complete
 * Body: { pairingToken: "..." }
 * Returns: { ok: true, deviceKey: "..." }
 */
healthBridgeRouter.post("/pair/complete", (req: Request, res: Response) => {
  const pairingToken = String(req.body?.pairingToken || "").trim();
  if (!pairingToken) {
    return res.status(400).json({ ok: false, error: "Missing pairingToken" });
  }

  const rec = pairingTokens.get(pairingToken);
  if (!rec) {
    return res.status(401).json({ ok: false, error: "Invalid or expired pairingToken" });
  }

  // Expire + one-time use
  const age = Date.now() - rec.createdAt;
  if (age > TOKEN_TTL_MS) {
    pairingTokens.delete(pairingToken);
    return res.status(401).json({ ok: false, error: "pairingToken expired" });
  }
  pairingTokens.delete(pairingToken);

  // Create a persistent deviceKey
  const deviceKey = genToken();
  devices.set(deviceKey, {
    shopifyCustomerId: rec.shopifyCustomerId,
    createdAt: Date.now(),
    lastSeenAt: Date.now(),
  });

  return res.json({ ok: true, deviceKey });
});

/**
 * ✅ REQUIRED (Shortcut ingestion)
 * POST /api/v1/health/ingest
 * Body:
 * {
 *   deviceKey: "YOUR_SAVED_DEVICE_KEY",
 *   ts: "2025-12-13T17:22:00Z",
 *   steps: 8421,
 *   activeCalories: 612,
 *   latestHeartRateBpm: 74,
 *   workoutsToday: 1
 * }
 */
healthBridgeRouter.post("/ingest", (req: Request, res: Response) => {
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

  latestMetricsByUser.set(device.shopifyCustomerId, {
    ts,
    steps,
    activeCalories,
    latestHeartRateBpm,
    workoutsToday,
    receivedAt: Date.now(),
    source: "shortcut",
  });

  devices.set(deviceKey, { ...device, lastSeenAt: Date.now() });

  return res.json({ ok: true });
});

/**
 * OPTIONAL read endpoint for your website widget:
 * GET /api/v1/health/metrics?shopifyCustomerId=123
 * Returns: { ok: true, data: {...} | null }
 */
healthBridgeRouter.get("/metrics", (req: Request, res: Response) => {
  const shopifyCustomerId = String(req.query?.shopifyCustomerId || "").trim();
  if (!shopifyCustomerId) {
    return res.status(400).json({ ok: false, error: "Missing shopifyCustomerId" });
  }

  const data = latestMetricsByUser.get(shopifyCustomerId) || null;
  return res.json({ ok: true, data });
});
