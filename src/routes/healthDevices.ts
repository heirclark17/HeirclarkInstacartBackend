import { Router } from "express";
import crypto from "crypto";

type DeviceRecord = {
  deviceKey: string;
  shopifyCustomerId: string;
  deviceName?: string | null;
  platform?: string | null;
  createdAt: string;
  lastSeenAt?: string | null;
};

// In-memory store (works immediately; replace with DB later)
const devicesByUser = new Map<string, Record<string, DeviceRecord>>();
const userByDeviceKey = new Map<string, string>();

function nowIso() {
  return new Date().toISOString();
}

function newDeviceKey() {
  return "hc_dev_" + crypto.randomBytes(24).toString("hex");
}

const r = Router();

/**
 * GET /api/v1/health/devices?shopifyCustomerId=...
 * (You already have this in prod, but keeping here for completeness.)
 */
r.get("/devices", (req, res) => {
  const shopifyCustomerId = String(req.query.shopifyCustomerId || "").trim();
  if (!shopifyCustomerId) return res.status(400).json({ ok: false, error: "Missing shopifyCustomerId" });

  const devices = devicesByUser.get(shopifyCustomerId) || {};
  return res.json({ ok: true, devices });
});

/**
 * POST /api/v1/health/devices
 * body: { shopifyCustomerId, deviceName?, platform? }
 */
r.post("/devices", (req, res) => {
  const { shopifyCustomerId, deviceName, platform } = req.body || {};
  const sid = String(shopifyCustomerId || "").trim();
  if (!sid) return res.status(400).json({ ok: false, error: "Missing shopifyCustomerId" });

  const deviceKey = newDeviceKey();

  const record: DeviceRecord = {
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
 * body: { shopifyCustomerId, deviceKey }
 */
r.delete("/devices", (req, res) => {
  const { shopifyCustomerId, deviceKey } = req.body || {};
  const sid = String(shopifyCustomerId || "").trim();
  const dk = String(deviceKey || "").trim();
  if (!sid) return res.status(400).json({ ok: false, error: "Missing shopifyCustomerId" });
  if (!dk) return res.status(400).json({ ok: false, error: "Missing deviceKey" });

  const bucket = devicesByUser.get(sid) || {};
  if (!bucket[dk]) return res.status(404).json({ ok: false, error: "Device not found" });

  delete bucket[dk];
  devicesByUser.set(sid, bucket);
  userByDeviceKey.delete(dk);

  return res.json({ ok: true });
});

/**
 * Helper export so ingest can validate keys.
 */
export function resolveShopifyCustomerIdFromDeviceKey(deviceKey: string): string | null {
  return userByDeviceKey.get(deviceKey) || null;
}

export default r;
