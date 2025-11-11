import "dotenv/config";
import express from "express";
import crypto from "crypto";
import type { Request, Response, NextFunction } from "express";
import { BuildListPayloadSchema, type BuildListPayload } from "./schema.js";

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Helpers to ensure required env is present
function mustEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

const SHOPIFY_API_SECRET = mustEnv("SHOPIFY_API_SECRET");
// This should match your Partners "Proxy URL" path after the domain:
const PUBLIC_PROXY_BASE = process.env.PUBLIC_PROXY_BASE_PATH || "/proxy";

// --- Verify Shopify App Proxy signature (query param "signature") ---
function verifyAppProxy(req: Request, res: Response, next: NextFunction) {
  try {
    const q = { ...req.query } as Record<string, unknown>;
    const sig = String(q.signature || "");
    delete q.signature;

    // Shopify: build sorted concatenated "k=v"
    const ordered = Object.keys(q)
      .sort()
      .map((k) => {
        const v = q[k];
        return `${k}=${Array.isArray(v) ? v.join(",") : (v ?? "").toString()}`;
      })
      .join("");

    const hmac = crypto
      .createHmac("sha256", SHOPIFY_API_SECRET)
      .update(ordered, "utf8")
      .digest("hex");

    if (sig !== hmac) return res.status(401).send("Bad signature");
    next();
  } catch (e) {
    console.error(e);
    res.status(400).send("Signature validation error");
  }
}

// --- Health for your theme GET ping ---
// Store calls:  GET /apps/instacart/build-list?ping=1
// Server sees:  GET /proxy/build-list?ping=1&signature=...
app.get(`${PUBLIC_PROXY_BASE}/build-list`, verifyAppProxy, (req, res) => {
  if (req.query.ping) return res.json({ ok: true });
  return res.status(405).json({ ok: false, error: "Use POST for build-list" });
});

// --- Main POST that creates the list ---
app.post(`${PUBLIC_PROXY_BASE}/build-list`, verifyAppProxy, (req, res) => {
  const parse = BuildListPayloadSchema.safeParse(req.body);
  if (!parse.success) {
    // Show exactly what's wrong
    return res.status(400).json({
      ok: false,
      error: "Invalid payload",
      details: parse.error.flatten()
    });
  }

  const payload: BuildListPayload = parse.data;

  // TODO: map payload.items -> Instacart items OR your own storage/action
  // For now, just echo success so you can iterate on the schema safely.
  return res.json({
    ok: true,
    received: {
      count: payload.items.length,
      firstItem: payload.items[0]
    }
  });
});

// --- Direct server health (Railway) ---
app.get("/api/health", (_req, res) => res.json({ ok: true }));

const PORT = Number(process.env.PORT || 3000);
app.listen(PORT, () => {
  console.log(`Heirclark Instacart backend running on port ${PORT}`);
});
