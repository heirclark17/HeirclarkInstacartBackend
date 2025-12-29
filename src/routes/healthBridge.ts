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
 */
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: process.env.NODE_ENV === "production"
    ? { rejectUnauthorized: false }
    : undefined,
});

const TOKEN_TTL_MS = 15 * 60 * 1000; // 15 minutes

function genToken(): string {
  return crypto.randomBytes(24).toString("base64url");
}

function normStr(v: any) {
  return String(v ?? "").trim();
}

function toIntOrNull(v: any): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

// Optional: short code for UX (not stored, just derived)
function shortCodeFromToken(token: string) {
  const h = crypto.createHash("sha256").update(token).digest("hex");
  const digits = h.replace(/[a-f]/g, "").slice(0, 6).padEnd(6, "0");
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}`;
}

/* ======================================================================
   PAIRING FLOW
   ====================================================================== */

/**
 * POST /api/v1/health/pair/start
 */
healthBridgeRouter.post("/pair/start", async (req: Request, res: Response) => {
  const shopifyCustomerId = normStr(req.body?.shopifyCustomerId);
  if (!shopifyCustomerId) {
    return res.status(400).json({ ok: false, error: "Missing shopifyCustomerId" });
  }

  const pairingToken = genToken();
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);

  try {
    await pool.query("DELETE FROM hc_pairing_tokens WHERE expires_at < NOW()");
    await pool.query(
      `
      INSERT INTO hc_pairing_tokens (pairing_token, shopify_customer_id, expires_at)
      VALUES ($1, $2, $3)
      `,
      [pairingToken, shopifyCustomerId, expiresAt.toISOString()]
    );

    return res.json({
      ok: true,
      pairingToken,
      shortCode: shortCodeFromToken(pairingToken),
      expiresAt: expiresAt.toISOString(),
    });
  } catch (err) {
    console.error("[healthBridge] pair/start failed:", err);
    return res.status(500).json({ ok: false, error: "pair/start failed" });
  }
});

/**
 * POST /api/v1/health/pair/complete
 */
healthBridgeRouter.post("/pair/complete", async (req: Request, res: Response) => {
  const pairingToken = normStr(req.body?.pairingToken);
  if (!pairingToken) {
    return res.status(400).json({ ok: false, error: "Missing pairingToken" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

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

    const expiresAt = new Date(tok.rows[0].expires_at);
    if (Date.now() > expiresAt.getTime()) {
      await client.query("DELETE FROM hc_pairing_tokens WHERE pairing_token = $1", [pairingToken]);
      await client.query("COMMIT");
      return res.status(401).json({ ok: false, error: "pairingToken expired" });
    }

    const shopifyCustomerId = tok.rows[0].shopify_customer_id;
    await client.query("DELETE FROM hc_pairing_tokens WHERE pairing_token = $1", [pairingToken]);

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
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[healthBridge] pair/complete failed:", err);
    return res.status(500).json({ ok: false, error: "pair/complete failed" });
  } finally {
    client.release();
  }
});

/* ======================================================================
   DEVICE REGISTRATION
   ====================================================================== */

/**
 * POST /api/v1/health/devices
 * POST /api/v1/health/device (alias)
 */
async function createDevice(req: Request, res: Response) {
  const shopifyCustomerId = normStr(req.body?.shopifyCustomerId);
  if (!shopifyCustomerId) {
    return res.status(400).json({ ok: false, error: "Missing shopifyCustomerId" });
  }

  const deviceKey = genToken();

  try {
    await pool.query(
      `
      INSERT INTO hc_health_devices (device_key, shopify_customer_id)
      VALUES ($1, $2)
      `,
      [deviceKey, shopifyCustomerId]
    );

    return res.json({ ok: true, deviceKey });
  } catch (err) {
    console.error("[healthBridge] device create failed:", err);
    return res.status(500).json({ ok: false, error: "device create failed" });
  }
}

healthBridgeRouter.post("/devices", createDevice);
healthBridgeRouter.post("/device", createDevice);

/* ======================================================================
   INGEST
   ====================================================================== */

healthBridgeRouter.post("/ingest", async (req: Request, res: Response) => {
  const deviceKey = normStr(req.body?.deviceKey);
  const tsRaw = normStr(req.body?.ts);

  if (!deviceKey) return res.status(400).json({ ok: false, error: "Missing deviceKey" });
  if (!tsRaw) return res.status(400).json({ ok: false, error: "Missing ts" });

  const ts = new Date(tsRaw);
  if (Number.isNaN(ts.getTime())) {
    return res.status(400).json({ ok: false, error: "Invalid ts" });
  }

  const steps = toIntOrNull(req.body?.steps);
  const activeCalories = toIntOrNull(req.body?.activeCalories);
  const restingEnergy = toIntOrNull(req.body?.restingEnergy) ?? toIntOrNull(req.body?.basalEnergy);
  const latestHeartRateBpm = toIntOrNull(req.body?.latestHeartRateBpm);
  const workoutsToday = toIntOrNull(req.body?.workoutsToday);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

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

    const shopifyCustomerId = dev.rows[0].shopify_customer_id;

    await client.query(
      `UPDATE hc_health_devices SET last_seen_at = NOW() WHERE device_key = $1`,
      [deviceKey]
    );

    await client.query(
      `
      INSERT INTO hc_health_latest (
        shopify_customer_id, ts, steps, active_calories, resting_energy,
        latest_heart_rate_bpm, workouts_today, received_at, source
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), 'shortcut')
      ON CONFLICT (shopify_customer_id)
      DO UPDATE SET
        ts = EXCLUDED.ts,
        steps = EXCLUDED.steps,
        active_calories = EXCLUDED.active_calories,
        resting_energy = EXCLUDED.resting_energy,
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
        restingEnergy,
        latestHeartRateBpm,
        workoutsToday,
      ]
    );

    await client.query("COMMIT");
    return res.json({ ok: true });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[healthBridge] ingest failed:", err);
    return res.status(500).json({ ok: false, error: "ingest failed" });
  } finally {
    client.release();
  }
});

/* ======================================================================
   METRICS + DEVICES
   ====================================================================== */

healthBridgeRouter.get("/metrics", async (req: Request, res: Response) => {
  const shopifyCustomerId = normStr(req.query?.shopifyCustomerId);
  if (!shopifyCustomerId) {
    return res.status(400).json({ ok: false, error: "Missing shopifyCustomerId" });
  }

  try {
    const out = await pool.query(
      `
      SELECT *
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
        restingEnergy: r.resting_energy,
        latestHeartRateBpm: r.latest_heart_rate_bpm,
        workoutsToday: r.workouts_today,
        receivedAt: r.received_at,
        source: r.source,
      },
    });
  } catch (err) {
    console.error("[healthBridge] metrics failed:", err);
    return res.status(500).json({ ok: false, error: "metrics failed" });
  }
});

healthBridgeRouter.get("/devices", async (req: Request, res: Response) => {
  const shopifyCustomerId = normStr(req.query?.shopifyCustomerId);
  if (!shopifyCustomerId) {
    return res.status(400).json({ ok: false, error: "Missing shopifyCustomerId" });
  }

  try {
    const out = await pool.query(
      `
      SELECT device_key, created_at, last_seen_at
      FROM hc_health_devices
      WHERE shopify_customer_id = $1
      ORDER BY last_seen_at DESC NULLS LAST
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
  } catch (err) {
    console.error("[healthBridge] devices failed:", err);
    return res.status(500).json({ ok: false, error: "devices failed" });
  }
});

/**
 * DELETE /api/v1/health/device
 *
 * Recommended behavior:
 * - If shopifyCustomerId + deviceKey provided: delete that device only
 * - If only shopifyCustomerId provided: delete ALL devices for that user
 *
 * This matches real-world UI needs and prevents frontend "deviceKey required" failures.
 */
healthBridgeRouter.delete("/device", async (req: Request, res: Response) => {
  const shopifyCustomerId = normStr(req.body?.shopifyCustomerId);
  const deviceKey = normStr(req.body?.deviceKey);

  if (!shopifyCustomerId) {
    return res.status(400).json({ ok: false, error: "Missing shopifyCustomerId" });
  }

  try {
    if (deviceKey) {
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

      return res.json({ ok: true, removed: del.rowCount });
    }

    // No deviceKey: remove all devices for user
    const delAll = await pool.query(
      `
      DELETE FROM hc_health_devices
      WHERE shopify_customer_id = $1
      `,
      [shopifyCustomerId]
    );

    return res.json({ ok: true, removed: delAll.rowCount });
  } catch (err) {
    console.error("[healthBridge] delete device failed:", err);
    return res.status(500).json({ ok: false, error: "delete device failed" });
  }
});
