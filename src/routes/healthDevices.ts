import { Router } from "express";
import crypto from "crypto";
import { authMiddleware } from "../middleware/auth";

export type HealthDevice = {
  deviceKey: string;
  shopifyCustomerId: string;
  deviceName?: string | null;
  platform?: string | null;
  createdAt: string;
  lastSeenAt?: string | null;

  // ✅ NEW (optional but useful for debugging)
  lastSource?: string | null;
  lastTs?: string | null;
};

const devicesByUser = new Map<string, Record<string, HealthDevice>>();
const userByDeviceKey = new Map<string, string>();

function nowIso() {
  return new Date().toISOString();
}

function newDeviceKey() {
  return "hc_dev_" + crypto.randomBytes(24).toString("hex");
}

// ✅ NEW: normalize IDs consistently everywhere
function normId(v: any) {
  return String(v ?? "").trim();
}

// ✅ Existing: used by ingest to validate deviceKey → user
export function resolveUserFromDeviceKey(deviceKey: string): string | null {
  const dk = normId(deviceKey);
  return dk ? userByDeviceKey.get(dk) || null : null;
}

// ✅ NEW: used by ingest to mark device as active + attach metadata
export function markDeviceSeen(params: {
  deviceKey: string;
  seenAtIso?: string;
  source?: string | null;
  payloadTs?: string | null;
}): boolean {
  const dk = normId(params.deviceKey);
  if (!dk) return false;

  const sid = userByDeviceKey.get(dk);
  if (!sid) return false;

  const bucket = devicesByUser.get(sid);
  const rec = bucket?.[dk];
  if (!rec) return false;

  rec.lastSeenAt = params.seenAtIso || nowIso();
  if (params.source !== undefined) rec.lastSource = params.source;
  if (params.payloadTs !== undefined) rec.lastTs = params.payloadTs;

  return true;
}

// ✅ NEW: convenience helper (optional)
export function getDevicesForUser(shopifyCustomerId: string): Record<string, HealthDevice> {
  const sid = normId(shopifyCustomerId);
  return (sid && devicesByUser.get(sid)) || {};
}

const r = Router();

// ✅ SECURITY FIX: Apply STRICT authentication (OWASP A01: IDOR Protection)
r.use(authMiddleware());

/**
 * GET /api/v1/health/devices?shopifyCustomerId=...
 */
r.get("/devices", (req, res) => {
  const sid = normId(req.query.shopifyCustomerId);
  if (!sid) {
    return res.status(400).json({ ok: false, error: "Missing shopifyCustomerId" });
  }

  return res.json({
    ok: true,
    devices: devicesByUser.get(sid) || {},
  });
});

/**
 * POST /api/v1/health/devices
 * body: { shopifyCustomerId, deviceName?, platform? }
 */
r.post("/devices", (req, res) => {
  const sid = normId(req.body?.shopifyCustomerId);
  if (!sid) {
    return res.status(400).json({ ok: false, error: "Missing shopifyCustomerId" });
  }

  // ✅ NEW: mild input hygiene (avoid huge strings)
  const deviceNameRaw = req.body?.deviceName;
  const platformRaw = req.body?.platform;

  const deviceName =
    typeof deviceNameRaw === "string" ? deviceNameRaw.trim().slice(0, 80) : null;

  const platform =
    typeof platformRaw === "string" ? platformRaw.trim().slice(0, 20) : null;

  const deviceKey = newDeviceKey();

  const record: HealthDevice = {
    deviceKey,
    shopifyCustomerId: sid,
    deviceName,
    platform,
    createdAt: nowIso(),
    lastSeenAt: null,
    lastSource: null,
    lastTs: null,
  };

  const bucket = devicesByUser.get(sid) || {};
  bucket[deviceKey] = record;
  devicesByUser.set(sid, bucket);
  userByDeviceKey.set(deviceKey, sid);

  return res.json({ ok: true, deviceKey, device: record });
});

/**
 * DELETE /api/v1/health/devices
 * body: { shopifyCustomerId, deviceKey }
 */
r.delete("/devices", (req, res) => {
  const sid = normId(req.body?.shopifyCustomerId);
  const dk = normId(req.body?.deviceKey);

  if (!sid || !dk) {
    return res.status(400).json({ ok: false, error: "Missing params" });
  }

  const bucket = devicesByUser.get(sid) || {};
  if (!bucket[dk]) {
    return res.status(404).json({ ok: false, error: "Device not found" });
  }

  delete bucket[dk];
  userByDeviceKey.delete(dk);

  // ✅ NEW: if user has no devices left, clean up map entry
  if (Object.keys(bucket).length === 0) {
    devicesByUser.delete(sid);
  } else {
    devicesByUser.set(sid, bucket);
  }

  return res.json({ ok: true });
});

export default r;
