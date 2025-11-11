// src/index.ts
import express, { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import cors from "cors";

// ---- ENV ----
// Required
const PORT = Number(process.env.PORT || 3000);
const SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET || ""; // for App Proxy HMAC verification
const INSTACART_API_KEY = process.env.INSTACART_API_KEY || "";   // your Instacart key

// Recommended
// e.g., https://api.instacart.example.com  (set to whatever Instacart gives you)
const INSTACART_BASE_URL = (process.env.INSTACART_BASE_URL || "").replace(/\/$/, "");
// e.g., /v1/lists or /lists/create — whatever their “create list” path is
const INSTACART_CREATE_LIST_PATH = process.env.INSTACART_CREATE_LIST_PATH || "/v1/lists";

// Choose how to send the key: 'x-api-key' | 'bearer' | 'query'
const INSTACART_AUTH_STYLE = (process.env.INSTACART_AUTH_STYLE || "x-api-key") as
  | "x-api-key" | "bearer" | "query";

// Optional: comma-separated origins for /rest/* fallback (theme direct POST)
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

// ---- APP ----
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS for REST fallback only; App Proxy doesn’t need it
if (ALLOWED_ORIGINS.length) {
  app.use(
    "/rest",
    cors({
      origin: (origin, cb) => {
        if (!origin) return cb(null, true);
        if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
        return cb(new Error("Not allowed by CORS"));
      },
      credentials: false,
    })
  );
}

// ---- Helpers ----
function verifyAppProxy(req: Request, res: Response, next: NextFunction) {
  try {
    if (!SHOPIFY_API_SECRET) {
      return res.status(500).json({ ok: false, error: "Missing SHOPIFY_API_SECRET" });
    }

    const q = { ...req.query } as Record<string, unknown>;
    const sig = String(q.signature || "");
    delete (q as any).signature;

    const ordered = Object.keys(q)
      .sort()
      .map((k) =>
        `${k}=${
          Array.isArray(q[k]) ? (q[k] as any[]).join(",") : (q[k] ?? "").toString()
        }`
      )
      .join("");

    const hmac = crypto.createHmac("sha256", SHOPIFY_API_SECRET).update(ordered, "utf8").digest("hex");
    if (sig !== hmac) return res.status(401).send("Bad signature");
    next();
  } catch (e) {
    return res.status(401).send("Bad signature");
  }
}

function buildInstacartUrl(): string {
  if (!INSTACART_BASE_URL) throw new Error("INSTACART_BASE_URL not set");
  const path = INSTACART_CREATE_LIST_PATH.startsWith("/")
    ? INSTACART_CREATE_LIST_PATH
    : `/${INSTACART_CREATE_LIST_PATH}`;
  return `${INSTACART_BASE_URL}${path}`;
}

function addInstacartAuth(url: string, headers: Record<string, string>) {
  if (!INSTACART_API_KEY) throw new Error("INSTACART_API_KEY not set");

  switch (INSTACART_AUTH_STYLE) {
    case "x-api-key":
      headers["x-api-key"] = INSTACART_API_KEY;
      return url;
    case "bearer":
      headers["Authorization"] = `Bearer ${INSTACART_API_KEY}`;
      return url;
    case "query": {
      const u = new URL(url);
      u.searchParams.set("api_key", INSTACART_API_KEY);
      return u.toString();
    }
    default:
      headers["x-api-key"] = INSTACART_API_KEY;
      return url;
  }
}

async function forwardToInstacart(body: any) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const urlWithAuth = addInstacartAuth(buildInstacartUrl(), headers);

  const resp = await fetch(urlWithAuth, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  // Try to decode JSON; fall back to text
  const contentType = resp.headers.get("content-type") || "";
  const data = contentType.includes("application/json") ? await resp.json().catch(() => ({})) : await resp.text();

  if (!resp.ok) {
    const msg = typeof data === "string" ? data : JSON.stringify(data);
    throw new Error(`Instacart error ${resp.status}: ${msg}`);
  }
  return data;
}

// Basic payload validation (lightweight)
function validateBuildListPayload(payload: any) {
  if (!payload || typeof payload !== "object") throw new Error("Missing payload");
  // Expecting: { start: 'YYYY-MM-DD', plan: [...], recipeLandingUrl?: string }
  if (!payload.start || typeof payload.start !== "string") throw new Error("Missing 'start'");
  if (!Array.isArray(payload.plan)) throw new Error("Missing 'plan' array");
  return payload;
}

// ---- Routes: App Proxy (preferred) ----
app.get("/proxy/build-list", verifyAppProxy, (req: Request, res: Response) => {
  if (req.query.ping) return res.json({ ok: true });
  return res.status(405).json({ ok: false, error: "Use POST for build-list" });
});

app.post("/proxy/build-list", verifyAppProxy, async (req: Request, res: Response) => {
  try {
    const payload = validateBuildListPayload(req.body || {});
    // forward to Instacart with your API key
    const ic = await forwardToInstacart(payload);
    // You can shape the response however your frontend expects
    return res.json({ ok: true, message: "Instacart list created.", instacart: ic });
  } catch (e: any) {
    console.error("Build-list (proxy) error:", e?.message || e);
    return res.status(502).json({ ok: false, error: e?.message || "Failed to create list" });
  }
});

// ---- Routes: REST fallback (for direct POST from theme if not using App Proxy) ----
app.post("/rest/build-list", async (req: Request, res: Response) => {
  try {
    const payload = validateBuildListPayload(req.body || {});
    const ic = await forwardToInstacart(payload);
    return res.json({ ok: true, message: "Instacart list created.", instacart: ic });
  } catch (e: any) {
    console.error("Build-list (rest) error:", e?.message || e);
    return res.status(502).json({ ok: false, error: e?.message || "Failed to create list" });
  }
});

// ---- Minimal auxiliary routes (unchanged) ----
app.get("/api/auth", (_req: Request, res: Response) =>
  res.send("App installed. Auth not required for proxy-only flow.")
);

app.get("/api/health", (_req: Request, res: Response) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`Heirclark Instacart backend running on port ${PORT}`);
});
