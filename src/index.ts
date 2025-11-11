// src/index.ts
import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import crypto from "crypto";

/* ----------------------------- ENV MANAGEMENT ----------------------------- */

function getEnv(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) {
    // For non-critical vars, pass a fallback above; for critical, throw.
    // throw new Error(`Missing required env var: ${name}`);
    return ""; // keep server booting if you prefer non-fatal
  }
  return v;
}

const PORT = Number(process.env.PORT || 8080);
const ALLOWED_ORIGINS = getEnv("ALLOWED_ORIGINS", "*");
const SHOPIFY_API_SECRET = getEnv("SHOPIFY_API_SECRET", ""); // optional if you don't use proxy HMAC

/* --------------------------------- TYPES ---------------------------------- */

type QVal = string | string[];

interface BuildItem {
  name: string;
  quantity?: number;
  unit?: string;
}

interface BuildListPayload {
  items: BuildItem[];
  // optional contextual fields you may add later
  planId?: string;
  userId?: string;
}

/* ----------------------------- RUNTIME GUARDS ----------------------------- */

function isString(v: unknown): v is string {
  return typeof v === "string";
}

function isBuildItem(v: unknown): v is BuildItem {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return isString(o.name) && (o.quantity === undefined || typeof o.quantity === "number") && (o.unit === undefined || isString(o.unit));
}

function normalizePayload(body: unknown): BuildListPayload {
  const fallback: BuildListPayload = { items: [] };
  if (!body || typeof body !== "object") return fallback;

  const o = body as Record<string, unknown>;
  const rawItems = o.items;

  const items: BuildItem[] = Array.isArray(rawItems)
    ? rawItems.filter(isBuildItem)
    : [];

  return {
    items,
    planId: isString(o.planId) ? o.planId : undefined,
    userId: isString(o.userId) ? o.userId : undefined,
  };
}

/* ------------------------------ APP PROXY HMAC ---------------------------- */
/**
 * If you are calling this server through a Shopify App Proxy route, you can
 * protect it with the HMAC signature check below. Set SHOPIFY_API_SECRET.
 * If you are NOT using an app proxy, you can leave SHOPIFY_API_SECRET blank
 * and the middleware will no-op (allow).
 */
function verifyShopifyProxy(req: Request, res: Response, next: NextFunction) {
  if (!SHOPIFY_API_SECRET) return next(); // not enforcing when no secret is set

  // Signature format (classic app proxy): build a sorted query string without "signature"
  const q = { ...req.query } as Record<string, QVal>;
  const sig = String(q.signature ?? "");
  delete q.signature;

  // turn arrays into comma-joined strings, then sort "key=value" lexicographically
  const ordered = Object.keys(q)
    .sort()
    .map((k) => {
      const val = Array.isArray(q[k]) ? (q[k] as string[]).join(",") : String(q[k] ?? "");
      return `${k}=${val}`;
    })
    .join("");

  const hmac = crypto.createHmac("sha256", SHOPIFY_API_SECRET).update(ordered, "utf8").digest("hex");

  if (sig !== hmac) return res.status(401).json({ ok: false, error: "Bad signature" });
  return next();
}

/* --------------------------------- SERVER --------------------------------- */

const app = express();
app.set("trust proxy", true);

app.use(
  cors({
    origin: ALLOWED_ORIGINS === "*"
      ? true
      : (origin, cb) => {
          if (!origin) return cb(null, true);
          const allowed = ALLOWED_ORIGINS.split(",").map((s) => s.trim());
          cb(null, allowed.includes(origin));
        },
    credentials: true,
  })
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* --------------------------------- ROUTES --------------------------------- */

// Basic liveness
app.get("/", (_req, res) => {
  res.type("text/plain").send("Heirclark Instacart backend is running");
});

// Programmatic health check
app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    uptime: process.uptime(),
    node: process.version,
    timestamp: new Date().toISOString(),
  });
});

// App Proxy ping (GET) and build-list (POST) under /apps/instacart/...
app.get("/apps/instacart/build-list", verifyShopifyProxy, (req, res) => {
  // e.g., GET /apps/instacart/build-list?ping=1
  if (req.query.ping) return res.json({ ok: true });
  res.status(400).json({ ok: false, error: "Missing action. Use POST for build-list, or ?ping=1" });
});

app.post("/apps/instacart/build-list", verifyShopifyProxy, (req, res) => {
  const payload = normalizePayload(req.body);

  // At this point you'd exchange OAuth and call Instacart’s real APIs.
  // For now, echo back a well-formed response so the frontend can proceed.
  // This prevents TS errors by guaranteeing payload.items is always an array.
  const items = payload.items;

  if (!items.length) {
    return res.status(400).json({ ok: false, error: "No items provided" });
  }

  // TODO: integrate with Instacart — create a list, add items, return a deep link.
  // Placeholder response:
  return res.json({
    ok: true,
    created: true,
    count: items.length,
    items,
    // link: "https://instacart.example/list/abc123" // populate when integrated
  });
});

// Plain REST variant for non-proxy calls (useful for local testing)
app.post("/api/build-list", (req, res) => {
  const payload = normalizePayload(req.body);
  const items = payload.items;

  if (!items.length) {
    return res.status(400).json({ ok: false, error: "No items provided" });
  }

  return res.json({
    ok: true,
    created: true,
    count: items.length,
    items,
  });
});

/* ----------------------------- ERROR HANDLERS ----------------------------- */

app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  // eslint-disable-next-line no-console
  console.error("Unhandled error:", err);
  res.status(500).json({ ok: false, error: "Internal Server Error" });
});

/* --------------------------------- BOOT ----------------------------------- */

const server = app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`🔥 Heirclark Instacart backend running on port ${PORT}`);
});

process.on("SIGTERM", () => {
  server.close(() => process.exit(0));
});
process.on("SIGINT", () => {
  server.close(() => process.exit(0));
});
