// src/routes/healthBridge.ts
import { Router, Request, Response } from "express";
import crypto from "crypto";
import { Pool } from "pg";

export const healthBridgeRouter = Router();

/**
 * Railway Postgres: DATABASE_URL should be set in your Node service Variables as:
 *   DATABASE_URL = ${{ Postgres.DATABASE_URL }}
 */
const DATABASE_URL = process.env.DATABASE_URL || "";
if (!DATABASE_URL) {
  console.warn("[healthBridge] DATABASE_URL is not set. Health bridge routes will fail.");
}

/**
 * Railway / managed Postgres commonly requires SSL.
 * If you connect over Railway’s public proxy, rejectUnauthorized:false prevents cert issues.
 */
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : undefined,
});

const TOKEN_TTL_MS = 15 * 60 * 1000; // 15 minutes

function genToken(): string {
  // URL-safe token
  return crypto.randomBytes(24).toString("base64url");
}

function toIntOrNull(v: any): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

/**
 * POST /api/v1/health/pair/start
 * Body: { shopifyCustomerId: "123" }
 * Returns: { ok: true, pairingToken, expiresAt }
 */
healthBridgeRouter.post("/pair/start", async (req: Request, res: Response) => {
  const shopifyCustomerId = String(req.body?.shopifyCustomerId || "").trim();
  if (!shopifyCustomerId) {
    return res.status(400).json({ ok: false, error: "Missing shopifyCustomerId" });
  }

  const pairingToken = genToken();
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);

  try {
    // Keep table small: remove expired tokens
    await pool.query("DELETE FROM hc_pairing_tokens WHERE expires_at < NOW()");

    await pool.query(
      `
      INSERT INTO hc_pairing_tokens (pairing_token, shopify_customer_id, expires_at)
      VALUES ($1, $2, $3)
      `,
      [pairingToken, shopifyCustomerId, expiresAt.toISOString()]
    );

    return res.json({ ok: true, pairingToken, expiresAt: expiresAt.toISOString() });
  } catch (err: any) {
    console.error("[healthBridge] pair/start failed:", err);
    return res.status(500).json({ ok: false, error: "pair/start failed" });
  }
});

/**
 * POST /api/v1/health/pair/complete
 * Body: { pairingToken: "..." }
 * Returns: { ok: true, deviceKey }
 */
healthBridgeRouter.post("/pair/complete", async (req: Request, res: Response) => {
  const pairingToken = String(req.body?.pairingToken || "").trim();
  if (!pairingToken) {
    return res.status(400).json({ ok: false, error: "Missing pairingToken" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // lock row so token can only be used once
    const tok = await client.query(
      `
      SELECT shopify_customer_id, expires_at
      FROM hc_pairing_tokens
      WHERE pairing_token = $1
      FOR UPDATE
      `,
      [pairingToken]
    );

    if (tok.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(401).json({ ok: false, error: "Invalid or expired pairingToken" });
    }

    const shopifyCustomerId = String(tok.rows[0].shopify_customer_id || "");
    const expiresAt = new Date(tok.rows[0].expires_at);

    if (Date.now() > expiresAt.getTime()) {
      // token expired: delete + reject
      await client.query("DELETE FROM hc_pairing_tokens WHERE pairing_token = $1", [pairingToken]);
      await client.query("COMMIT");
      return res.status(401).json({ ok: false, error: "pairingToken expired" });
    }

    // one-time use: delete token
    await client.query("DELETE FROM hc_pairing_tokens WHERE pairing_token = $1", [pairingToken]);

    // create deviceKey
    const deviceKey = genToken();
    await client.query(
      `
      INSERT INTO hc_health_devices (device_key, shopify_customer_id)
      VALUES ($1, $2)
      `,
      [deviceKey, shopifyCustomerId]
    );

    await client.query("COMMIT");
    return res.json({ ok: true, deviceKey });
  } catch (err: any) {
    await client.query("ROLLBACK");
    console.error("[healthBridge] pair/complete failed:", err);
    return res.status(500).json({ ok: false, error: "pair/complete failed" });
  } finally {
    client.release();
  }
});

/**
 * POST /api/v1/health/ingest
 * Body:
 * {
 *   deviceKey: "...",
 *   ts: "2025-12-13T17:22:00Z",
 *   steps?: number,
 *   activeCalories?: number,
 *   latestHeartRateBpm?: number,
 *   workoutsToday?: number
 * }
 * Returns: { ok: true }
 */
healthBridgeRouter.post("/ingest", async (req: Request, res: Response) => {
  const deviceKey = String(req.body?.deviceKey || "").trim();
  const tsRaw = String(req.body?.ts || "").trim();

  if (!deviceKey) return res.status(400).json({ ok: false, error: "Missing deviceKey" });
  if (!tsRaw) return res.status(400).json({ ok: false, error: "Missing ts" });

  const ts = new Date(tsRaw);
  if (Number.isNaN(ts.getTime())) {
    return res.status(400).json({ ok: false, error: "ts must be a valid ISO date string" });
  }

  const steps = toIntOrNull(req.body?.steps);
  const activeCalories = toIntOrNull(req.body?.activeCalories);
  const latestHeartRateBpm = toIntOrNull(req.body?.latestHeartRateBpm);
  const workoutsToday = toIntOrNull(req.body?.workoutsToday);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // lock device row to update last_seen safely
    const dev = await client.query(
      `
      SELECT shopify_customer_id
      FROM hc_health_devices
      WHERE device_key = $1
      FOR UPDATE
      `,
      [deviceKey]
    );

    if (dev.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(401).json({ ok: false, error: "Invalid deviceKey" });
    }

    const shopifyCustomerId = String(dev.rows[0].shopify_customer_id || "");

    await client.query(
      `UPDATE hc_health_devices SET last_seen_at = NOW() WHERE device_key = $1`,
      [deviceKey]
    );

    // upsert latest snapshot per user
    await client.query(
      `
      INSERT INTO hc_health_latest (
        shopify_customer_id, ts, steps, active_calories, latest_heart_rate_bpm, workouts_today, received_at, source
      ) VALUES ($1, $2, $3, $4, $5, $6, NOW(), 'shortcut')
      ON CONFLICT (shopify_customer_id)
      DO UPDATE SET
        ts = EXCLUDED.ts,
        steps = EXCLUDED.steps,
        active_calories = EXCLUDED.active_calories,
        latest_heart_rate_bpm = EXCLUDED.latest_heart_rate_bpm,
        workouts_today = EXCLUDED.workouts_today,
        received_at = NOW(),
        source = 'shortcut'
      `,
      [
        shopifyCustomerId,
        ts.toISOString(),
        steps,
        activeCalories,
        latestHeartRateBpm,
        workoutsToday,
      ]
    );

    await client.query("COMMIT");
    return res.json({ ok: true });
  } catch (err: any) {
    await client.query("ROLLBACK");
    console.error("[healthBridge] ingest failed:", err);
    return res.status(500).json({ ok: false, error: "ingest failed" });
  } finally {
    client.release();
  }
});

/**
 * GET /api/v1/health/metrics?shopifyCustomerId=123
 * Returns: { ok: true, data: null | { ... } }
 */
healthBridgeRouter.get("/metrics", async (req: Request, res: Response) => {
  const shopifyCustomerId = String(req.query?.shopifyCustomerId || "").trim();
  if (!shopifyCustomerId) {
    return res.status(400).json({ ok: false, error: "Missing shopifyCustomerId" });
  }

  try {
    const out = await pool.query(
      `
      SELECT
        shopify_customer_id,
        ts,
        steps,
        active_calories,
        latest_heart_rate_bpm,
        workouts_today,
        received_at,
        source
      FROM hc_health_latest
      WHERE shopify_customer_id = $1
      `,
      [shopifyCustomerId]
    );

    if (out.rowCount === 0) {
      return res.json({ ok: true, data: null });
    }

    const r = out.rows[0];
    return res.json({
      ok: true,
      data: {
        shopifyCustomerId: r.shopify_customer_id,
        ts: r.ts,
        steps: r.steps,
        activeCalories: r.active_calories,
        latestHeartRateBpm: r.latest_heart_rate_bpm,
        workoutsToday: r.workouts_today,
        receivedAt: r.received_at,
        source: r.source,
      },
    });
  } catch (err: any) {
    console.error("[healthBridge] metrics failed:", err);
    return res.status(500).json({ ok: false, error: "metrics failed" });
  }
});

/**
 * GET /api/v1/health/devices?shopifyCustomerId=123
 * Returns: { ok: true, devices: [{ deviceKey, createdAt, lastSeenAt }, ...] }
 */
healthBridgeRouter.get("/devices", async (req: Request, res: Response) => {
  const shopifyCustomerId = String(req.query?.shopifyCustomerId || "").trim();
  if (!shopifyCustomerId) {
    return res.status(400).json({ ok: false, error: "Missing shopifyCustomerId" });
  }

  try {
    const out = await pool.query(
      `
      SELECT device_key, created_at, last_seen_at
      FROM hc_health_devices
      WHERE shopify_customer_id = $1
      ORDER BY last_seen_at DESC
      `,
      [shopifyCustomerId]
    );

    return res.json({
      ok: true,
      devices: out.rows.map((r) => ({
        deviceKey: r.device_key,
        createdAt: r.created_at,
        lastSeenAt: r.last_seen_at,
      })),
    });
  } catch (err: any) {
    console.error("[healthBridge] devices failed:", err);
    return res.status(500).json({ ok: false, error: "devices failed" });
  }
});

/**
 * DELETE /api/v1/health/device
 * Body: { shopifyCustomerId: "123", deviceKey: "..." }
 * Returns: { ok: true }
 *
 * This "disconnects" by deleting the device row.
 * After this, ingests using that deviceKey will fail as "Invalid deviceKey".
 */
healthBridgeRouter.delete("/device", async (req: Request, res: Response) => {
  const shopifyCustomerId = String(req.body?.shopifyCustomerId || "").trim();
  const deviceKey = String(req.body?.deviceKey || "").trim();

  if (!shopifyCustomerId) {
    return res.status(400).json({ ok: false, error: "Missing shopifyCustomerId" });
  }
  if (!deviceKey) {
    return res.status(400).json({ ok: false, error: "Missing deviceKey" });
  }

  try {
    const del = await pool.query(
      `
      DELETE FROM hc_health_devices
      WHERE device_key = $1 AND shopify_customer_id = $2
      `,
      [deviceKey, shopifyCustomerId]
    );

    if (del.rowCount === 0) {
      return res.status(404).json({ ok: false, error: "Device not found for user" });
    }

    return res.json({ ok: true });
  } catch (err: any) {
    console.error("[healthBridge] delete device failed:", err);
    return res.status(500).json({ ok: false, error: "delete device failed" });
  }
});
