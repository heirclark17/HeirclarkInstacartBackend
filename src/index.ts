// src/index.ts
import express, { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import cors, { CorsOptions } from "cors";
import axios from "axios";
import { ZodError } from "zod";
import { BuildListPayloadSchema } from "./schema";

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* ---------- Config ---------- */
const PORT = Number(process.env.PORT || 3000);
const SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET || "";
const INSTACART_API_BASE = (process.env.INSTACART_API_BASE || "").replace(/\/+$/, "");
const INSTACART_API_KEY = process.env.INSTACART_API_KEY || "";
const INSTACART_KEY_HEADER = process.env.INSTACART_KEY_HEADER || "X-API-Key";

/* ---------- Helpers ---------- */
function verifyAppProxy(req: Request, res: Response, next: NextFunction) {
  // Shopify App Proxy HMAC (query-string) verification
  if (!SHOPIFY_API_SECRET) return res.status(500).send("Missing SHOPIFY_API_SECRET");

  const q = { ...req.query } as Record<string, unknown>;
  const sig = String(q.signature || "");
  delete (q as any).signature;

  const ordered = Object.keys(q)
    .sort()
    .map((k) => `${k}=${Array.isArray(q[k]) ? (q[k] as any[]).join(",") : (q[k] ?? "").toString()}`)
    .join("");

  const hmac = crypto.createHmac("sha256", SHOPIFY_API_SECRET).update(ordered, "utf8").digest("hex");
  if (sig !== hmac) return res.status(401).send("Bad signature");
  next();
}

async function forwardToInstacart(payload: any) {
  if (!INSTACART_API_BASE || !INSTACART_API_KEY) {
    throw new Error("Instacart env vars are not configured");
  }

  // Example path – replace with the real Instacart path your program has access to.
  const url = `${INSTACART_API_BASE}/lists`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    [INSTACART_KEY_HEADER]: INSTACART_API_KEY
  };

  const { data } = await axios.post(url, payload, { headers, timeout: 25_000 });
  return data;
}

/* ---------- PROXY routes (Shopify → your backend) ---------- */
app.get("/proxy/build-list", verifyAppProxy, (req, res) => {
  if (req.query.ping) return res.json({ ok: true });
  return res.status(405).json({ ok: false, error: "Use POST for /proxy/build-list" });
});

app.post("/proxy/build-list", verifyAppProxy, async (req, res) => {
  try {
    // Validate against your schema
    const parsed = BuildListPayloadSchema.parse(req.body);

    // Example transform to Instacart’s shape (see Section 3)
    const instacartPayload = {
      // meta you might want to pass through
      start: parsed.start,
      plan: parsed.plan,
      recipeLandingUrl: parsed.recipeLandingUrl,
      // items normalized
      items: parsed.items.map((it) => ({
        name: it.name,
        quantity: it.quantity,
        unit: it.unit,
        category: it.category,
        pantry: it.pantry,
        notes: it.notes ?? "",
        brand: it.brand ?? undefined,
        size_preference: it.size_preference ?? undefined,
        substitutions_allowed: it.substitutions_allowed ?? true,
        // optional product mapping hints
        retailer_map: it.retailer_map
          ? {
              instacart_query: it.retailer_map.instacart_query,
              upc: it.retailer_map.upc ?? undefined,
              store_sku: it.retailer_map.store_sku ?? undefined
            }
          : undefined
      }))
    };

    const instacartResponse = await forwardToInstacart(instacartPayload);
    return res.json({ ok: true, message: "Instacart list created.", instacart: instacartResponse });
  } catch (err: any) {
    if (err instanceof ZodError) {
      return res.status(400).json({ ok: false, error: "Invalid payload", issues: err.errors });
    }
    console.error("Instacart error:", err?.response?.data || err?.message || err);
    return res.status(502).json({
      ok: false,
      error: "Failed to create Instacart list",
      detail: err?.response?.data || err?.message || "unknown"
    });
  }
});

/* ---------- Optional REST fallback ---------- */
const corsOptions: CorsOptions = {
  origin(_origin, cb) {
    // TODO: tighten to your domain, e.g. https://heirclark.com
    cb(null, true);
  },
  credentials: true
};

app.options("/rest/build-list", cors(corsOptions));
app.post("/rest/build-list", cors(corsOptions), async (req, res) => {
  try {
    const parsed = BuildListPayloadSchema.parse(req.body);

    const instacartPayload = {
      start: parsed.start,
      plan: parsed.plan,
      recipeLandingUrl: parsed.recipeLandingUrl,
      items: parsed.items
    };

    const instacartResponse = await forwardToInstacart(instacartPayload);
    return res.json({ ok: true, message: "Instacart list created.", instacart: instacartResponse });
  } catch (err: any) {
    if (err instanceof ZodError) {
      return res.status(400).json({ ok: false, error: "Invalid payload", issues: err.errors });
    }
    console.error("Instacart error:", err?.response?.data || err?.message || err);
    return res.status(502).json({
      ok: false,
      error: "Failed to create Instacart list",
      detail: err?.response?.data || err?.message || "unknown"
    });
  }
});

/* ---------- Health ---------- */
app.get("/api/health", (_req, res) => res.json({ ok: true }));

/* ---------- Error fallthrough ---------- */
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ ok: false, error: "Server error" });
});

/* ---------- Start ---------- */
app.listen(PORT, () => {
  console.log(`Heirclark Instacart backend running on port ${PORT}`);
});
