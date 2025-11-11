// src/index.ts
import express, { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import dotenv from "dotenv";

dotenv.config();

/**
 * Environment helpers
 */
function getEnv(name: string, fallback?: string): string {
  const v = process.env[name];
  if (v && v.trim().length > 0) return v;
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing required env var: ${name}`);
}

const PORT = Number(process.env.PORT || 8080);
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

// If you plan to verify Shopify App Proxy calls, set this
// in Railway variables. If not set, verification is skipped.
const SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET || "";

/**
 * Basic server
 */
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/**
 * Minimal CORS (optional; safe defaults)
 */
app.use((req, res, next) => {
  const origin = req.headers.origin as string | undefined;
  if (origin && (ALLOWED_ORIGINS.length === 0 || ALLOWED_ORIGINS.includes(origin))) {
    res.header("Access-Control-Allow-Origin", origin);
    res.header("Vary", "Origin");
    res.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type,Authorization");
  }
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

/**
 * Health check for Railway
 * GET /api/health -> { ok: true }
 */
app.get("/api/health", (_req: Request, res: Response) => {
  res.json({ ok: true, service: "heirclark-instacart-backend", node: process.version });
});

/**
 * Optional Shopify App Proxy verification middleware.
 * If SHOPIFY_API_SECRET is not set, this middleware is a no-op.
 *
 * App Proxy computes signature as HMAC-SHA256 over the sorted query string
 * (without `signature`) using the app secret.
 */
function verifyAppProxy(req: Request, res: Response, next: NextFunction) {
  if (!SHOPIFY_API_SECRET) return next(); // Skip if not configured
  const q = { ...req.query } as Record<string, unknown>;
  const provided = String(q.signature || "");
  delete (q as Record<string, unknown>).signature;

  // Flatten values into comma-joined strings and sort keys
  const ordered = Object.keys(q)
    .sort()
    .map((k) => {
      const v = q[k];
      if (Array.isArray(v)) return `${k}=${v.join(",")}`;
      if (v === undefined || v === null) return `${k}=`;
      return `${k}=${String(v)}`;
    })
    .join("");

  const hmac = crypto.createHmac("sha256", SHOPIFY_API_SECRET).update(ordered, "utf8").digest("hex");
  if (provided !== hmac) {
    return res.status(401).json({ ok: false, error: "Bad signature" });
  }
  next();
}

/**
 * Simple GET ping for App Proxy:
 * GET /apps/instacart/build-list?ping=1 -> { ok: true }
 */
app.get("/apps/instacart/build-list", verifyAppProxy, (req: Request, res: Response) => {
  if (req.query.ping) return res.json({ ok: true });
  // If you want to return something else for GET without ping:
  return res.json({ ok: true, message: "Use POST to generate a list." });
});

/**
 * Payload types and safe guards
 */
type BuildListItem = {
  name: string;
  qty?: number;
  unit?: string;
  sku?: string;
};

type BuildListBody = {
  // items can be missing; we guard against it
  items?: BuildListItem[];
  // you can add other fields as needed (e.g., planId, customerId, etc.)
};

function isValidItem(x: any): x is BuildListItem {
  return x && typeof x.name === "string" && x.name.trim().length > 0;
}

/**
 * POST /apps/instacart/build-list
 * Accepts { items: BuildListItem[] } and returns a placeholder response.
 * This validates `items` defensively to avoid TS18048 ("possibly undefined").
 */
app.post("/apps/instacart/build-list", verifyAppProxy, (req: Request, res: Response) => {
  const body: BuildListBody = req.body ?? {};
  const itemsRaw = body.items;

  if (!Array.isArray(itemsRaw) || itemsRaw.length === 0) {
    return res.status(400).json({ ok: false, error: "Body must include a non-empty 'items' array." });
  }

  // Filter and coerce items safely
  const items: BuildListItem[] = itemsRaw.filter(isValidItem).map((it) => ({
    name: it.name.trim(),
    qty: typeof it.qty === "number" && !Number.isNaN(it.qty) ? it.qty : 1,
    unit: typeof it.unit === "string" ? it.unit : "ea",
    sku: typeof it.sku === "string" ? it.sku : undefined,
  }));

  if (items.length === 0) {
    return res.status(400).json({ ok: false, error: "No valid items provided." });
  }

  // TODO: Integrate with Instacart API here. For now return a stub.
  return res.json({
    ok: true,
    message: "List received. (Stub response — connect to Instacart here.)",
    count: items.length,
    items,
    // Example: you might eventually return a generated URL to the cart
    instacart_url: null,
  });
});

/**
 * Root
 */
app.get("/", (_req: Request, res: Response) => {
  res.json({ ok: true, routes: ["/api/health", "/apps/instacart/build-list"] });
});

/**
 * Start server
 */
app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`🔥 Heirclark Instacart backend running on port ${PORT}`);
});

export default app;
