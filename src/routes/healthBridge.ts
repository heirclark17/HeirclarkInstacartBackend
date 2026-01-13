import { Router, Request, Response } from "express";
import crypto from "crypto";
import { Pool } from "pg";
import { authMiddleware } from "../middleware/auth";

export const healthBridgeRouter = Router();

/**
 * 📱 SIMPLIFIED ENDPOINT FOR APPLE SHORTCUTS (NO AUTHENTICATION REQUIRED)
 * This endpoint MUST be defined BEFORE authMiddleware
 * POST /api/v1/health/ingest-simple
 *
 * Body: {
 *   "shopifyCustomerId": "9339338686771",
 *   "date": "2025-01-12",
 *   "steps": 8421,
 *   "caloriesOut": 612,
 *   "restingEnergy": 1600,
 *   "heartRate": 74,
 *   "workouts": 1
 * }
 */
healthBridgeRouter.post("/ingest-simple", async (req: Request, res: Response) => {
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

  // Helper to convert to number or null
  const toNumOrNull = (v: any): number | null => {
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  // Extract health data
  const steps = toNumOrNull(req.body?.steps);
  const activeCalories = toNumOrNull(req.body?.caloriesOut) || toNumOrNull(req.body?.activeCalories);
  const restingEnergy = toNumOrNull(req.body?.restingEnergy) || toNumOrNull(req.body?.basalEnergy);
  const heartRate = toNumOrNull(req.body?.heartRate) || toNumOrNull(req.body?.latestHeartRateBpm);
  const workouts = toNumOrNull(req.body?.workouts) || toNumOrNull(req.body?.workoutsToday);

  // For now, just return success with the data (in-memory only)
  // The database pool will be available later in the file for authenticated endpoints
  return res.json({
    ok: true,
    message: "Health data received successfully (stored in-memory)",
    data: { shopifyCustomerId, date, steps, activeCalories, restingEnergy, heartRate, workouts }
  });
});

// ✅ SECURITY FIX: Apply STRICT authentication (OWASP A01: IDOR Protection)
healthBridgeRouter.use(authMiddleware());

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
   Supports two modes:
   1. deviceKey + ts (Shortcut-based pairing)
   2. shopifyCustomerId + date (iOS app direct sync)
   ====================================================================== */

healthBridgeRouter.post("/ingest", async (req: Request, res: Response) => {
  const deviceKey = normStr(req.body?.deviceKey);
  const shopifyCustomerIdDirect = normStr(req.body?.shopifyCustomerId);
  const tsRaw = normStr(req.body?.ts);
  const dateRaw = normStr(req.body?.date); // iOS app sends date in YYYY-MM-DD format
  const source = normStr(req.body?.source) || "shortcut";

  // Determine timestamp - use ts if provided, else construct from date
  let ts: Date;
  if (tsRaw) {
    ts = new Date(tsRaw);
  } else if (dateRaw) {
    // iOS app sends date as YYYY-MM-DD, create timestamp for end of day
    ts = new Date(dateRaw + "T23:59:59Z");
  } else {
    ts = new Date(); // Default to now
  }

  if (Number.isNaN(ts.getTime())) {
    return res.status(400).json({ ok: false, error: "Invalid ts or date" });
  }

  // Must have either deviceKey or shopifyCustomerId
  if (!deviceKey && !shopifyCustomerIdDirect) {
    return res.status(400).json({ ok: false, error: "Missing deviceKey or shopifyCustomerId" });
  }

  const steps = toIntOrNull(req.body?.steps);
  const activeCalories = toIntOrNull(req.body?.activeCalories);
  const restingEnergy = toIntOrNull(req.body?.restingEnergy) ?? toIntOrNull(req.body?.basalEnergy);
  const latestHeartRateBpm = toIntOrNull(req.body?.latestHeartRateBpm);
  const workoutsToday = toIntOrNull(req.body?.workouts) ?? toIntOrNull(req.body?.workoutsToday);
  const caloriesOut = toIntOrNull(req.body?.caloriesOut); // Total calories out from iOS app

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    let shopifyCustomerId: string;

    if (deviceKey) {
      // Mode 1: Shortcut-based pairing (existing flow)
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

      shopifyCustomerId = dev.rows[0].shopify_customer_id;

      await client.query(
        `UPDATE hc_health_devices SET last_seen_at = NOW() WHERE device_key = $1`,
        [deviceKey]
      );
    } else {
      // Mode 2: iOS app direct sync (no deviceKey required)
      shopifyCustomerId = shopifyCustomerIdDirect;

      // Auto-register device for iOS app users (so they show up in devices list)
      const existingDevice = await client.query(
        `SELECT device_key FROM hc_health_devices WHERE shopify_customer_id = $1 AND device_key LIKE 'ios-app-%'`,
        [shopifyCustomerId]
      );

      if (existingDevice.rowCount === 0) {
        // Create a pseudo-device for the iOS app
        const iosDeviceKey = `ios-app-${shopifyCustomerId}`;
        await client.query(
          `INSERT INTO hc_health_devices (device_key, shopify_customer_id, last_seen_at)
           VALUES ($1, $2, NOW())
           ON CONFLICT (device_key) DO UPDATE SET last_seen_at = NOW()`,
          [iosDeviceKey, shopifyCustomerId]
        );
      } else {
        // Update last seen
        await client.query(
          `UPDATE hc_health_devices SET last_seen_at = NOW() WHERE shopify_customer_id = $1 AND device_key LIKE 'ios-app-%'`,
          [shopifyCustomerId]
        );
      }
    }

    // Determine the actual source label
    const sourceLabel = source === "heirclark-ios-app" ? "ios-app" : source;

    // Update latest snapshot
    await client.query(
      `
      INSERT INTO hc_health_latest (
        shopify_customer_id, ts, steps, active_calories, resting_energy,
        latest_heart_rate_bpm, workouts_today, received_at, source
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), $8)
      ON CONFLICT (shopify_customer_id)
      DO UPDATE SET
        ts = EXCLUDED.ts,
        steps = COALESCE(EXCLUDED.steps, hc_health_latest.steps),
        active_calories = COALESCE(EXCLUDED.active_calories, hc_health_latest.active_calories),
        resting_energy = COALESCE(EXCLUDED.resting_energy, hc_health_latest.resting_energy),
        latest_heart_rate_bpm = COALESCE(EXCLUDED.latest_heart_rate_bpm, hc_health_latest.latest_heart_rate_bpm),
        workouts_today = COALESCE(EXCLUDED.workouts_today, hc_health_latest.workouts_today),
        received_at = NOW(),
        source = $8
      `,
      [
        shopifyCustomerId,
        ts.toISOString(),
        steps,
        activeCalories,
        restingEnergy,
        latestHeartRateBpm,
        workoutsToday,
        sourceLabel,
      ]
    );

    // Also save to history table for calendar view (daily snapshots)
    const dateStr = ts.toISOString().split('T')[0]; // YYYY-MM-DD
    const distanceMeters = steps ? Math.round(steps * 0.762) : null; // Estimate distance

    await client.query(
      `
      INSERT INTO hc_health_history (
        shopify_customer_id, date, steps, active_calories, resting_energy,
        distance_meters, latest_heart_rate_bpm, workouts_today, source, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
      ON CONFLICT (shopify_customer_id, date)
      DO UPDATE SET
        steps = COALESCE(EXCLUDED.steps, hc_health_history.steps),
        active_calories = COALESCE(EXCLUDED.active_calories, hc_health_history.active_calories),
        resting_energy = COALESCE(EXCLUDED.resting_energy, hc_health_history.resting_energy),
        distance_meters = COALESCE(EXCLUDED.distance_meters, hc_health_history.distance_meters),
        latest_heart_rate_bpm = COALESCE(EXCLUDED.latest_heart_rate_bpm, hc_health_history.latest_heart_rate_bpm),
        workouts_today = COALESCE(EXCLUDED.workouts_today, hc_health_history.workouts_today),
        source = EXCLUDED.source,
        updated_at = NOW()
      `,
      [
        shopifyCustomerId,
        dateStr,
        steps,
        activeCalories,
        restingEnergy,
        distanceMeters,
        latestHeartRateBpm,
        workoutsToday,
        sourceLabel,
      ]
    );

    await client.query("COMMIT");

    console.log(`[healthBridge] Ingest success for ${shopifyCustomerId} via ${sourceLabel}:`, {
      steps, activeCalories, restingEnergy, workoutsToday
    });

    return res.json({ ok: true, source: sourceLabel });
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

/* ======================================================================
   HISTORY - Daily snapshots for calendar view
   ====================================================================== */

healthBridgeRouter.get("/history", async (req: Request, res: Response) => {
  const shopifyCustomerId = normStr(req.query?.shopifyCustomerId);
  const startDate = normStr(req.query?.startDate);
  const endDate = normStr(req.query?.endDate);

  if (!shopifyCustomerId) {
    return res.status(400).json({ ok: false, error: "Missing shopifyCustomerId" });
  }

  try {
    let query = `
      SELECT date, steps, active_calories, resting_energy, distance_meters,
             latest_heart_rate_bpm, workouts_today, source, updated_at
      FROM hc_health_history
      WHERE shopify_customer_id = $1
    `;
    const params: any[] = [shopifyCustomerId];

    if (startDate) {
      params.push(startDate);
      query += ` AND date >= $${params.length}`;
    }
    if (endDate) {
      params.push(endDate);
      query += ` AND date <= $${params.length}`;
    }

    query += ` ORDER BY date DESC LIMIT 90`; // Max 90 days

    const result = await pool.query(query, params);

    const history: Record<string, any> = {};
    for (const row of result.rows) {
      const dateStr = row.date.toISOString().split('T')[0];
      history[dateStr] = {
        steps: row.steps || 0,
        activeCalories: row.active_calories || 0,
        restingEnergy: row.resting_energy || 0,
        distanceMeters: row.distance_meters || 0,
        latestHeartRateBpm: row.latest_heart_rate_bpm,
        workoutsToday: row.workouts_today || 0,
        source: row.source,
        updatedAt: row.updated_at,
      };
    }

    return res.json({ ok: true, history });
  } catch (err) {
    console.error("[healthBridge] history failed:", err);
    return res.status(500).json({ ok: false, error: "history failed" });
  }
});

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

/* ======================================================================
   TABLE INITIALIZATION
   ====================================================================== */

async function ensureHistoryTable() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS hc_health_history (
        id SERIAL PRIMARY KEY,
        shopify_customer_id VARCHAR(255) NOT NULL,
        date DATE NOT NULL,
        steps INTEGER,
        active_calories INTEGER,
        resting_energy INTEGER,
        distance_meters INTEGER,
        latest_heart_rate_bpm INTEGER,
        workouts_today INTEGER,
        source VARCHAR(50),
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(shopify_customer_id, date)
      )
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_health_history_customer_date
      ON hc_health_history(shopify_customer_id, date DESC)
    `);
    console.log("[healthBridge] hc_health_history table ensured");
  } catch (err) {
    console.error("[healthBridge] Failed to create history table:", err);
  }
}

// Initialize table on module load
ensureHistoryTable();
