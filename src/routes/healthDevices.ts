import { Router } from "express";
import crypto from "crypto";

export type HealthDevice = {
  deviceKey: string;
  shopifyCustomerId: string;
  deviceName?: string | null;
  platform?: string | null;
  createdAt: string;
  lastSeenAt?: string | null;
};

const devicesByUser = new Map<string, Record<string, HealthDevice>>();
const userByDeviceKey = new Map<string, string>();

function nowIso() {
  return new Date().toISOString();
}

function newDeviceKey() {
  return "hc_dev_" + crypto.randomBytes(24).toString("hex");
}

export function resolveUserFromDeviceKey(deviceKey: string): string | null {
  return userByDeviceKey.get(deviceKey) || null;
}

const r = Router();

/**
 * GET /api/v1/health/devices?shopifyCustomerId=...
 */
r.get("/devices", (req, res) => {
  const sid = String(req.query.shopifyCustomerId || "").trim();
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
 */
r.post("/devices", (req, res) => {
  const { shopifyCustomerId, deviceName, platform } = req.body || {};
  const sid = String(shopifyCustomerId || "").trim();
  if (!sid) {
    return res.status(400).json({ ok: false, error: "Missing shopifyCustomerId" });
  }

  const deviceKey = newDeviceKey();

  const record: HealthDevice = {
    deviceKey,
    shopifyCustomerId: sid,
    deviceName: deviceName ?? null,
    platform: platform ?? null,
    createdAt: nowIso(),
    lastSeenAt: null,
  };

  const bucket = devicesByUser.get(sid) || {};
  bucket[deviceKey] = record;
  devicesByUser.set(sid, bucket);
  userByDeviceKey.set(deviceKey, sid);

  return res.json({ ok: true, deviceKey, device: record });
});

/**
 * DELETE /api/v1/health/devices
 */
r.delete("/devices", (req, res) => {
  const { shopifyCustomerId, deviceKey } = req.body || {};
  if (!shopifyCustomerId || !deviceKey) {
    return res.status(400).json({ ok: false, error: "Missing params" });
  }

  const bucket = devicesByUser.get(String(shopifyCustomerId)) || {};
  if (!bucket[deviceKey]) {
    return res.status(404).json({ ok: false, error: "Device not found" });
  }

  delete bucket[deviceKey];
  userByDeviceKey.delete(deviceKey);

  return res.json({ ok: true });
});

export default r;
