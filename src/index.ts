// src/index.ts
import express, { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import cors, { CorsOptions } from "cors";
import axios from "axios";
import { BuildListPayloadSchema, BuildListPayload } from "./schema";

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* ---------- Config ---------- */
const PORT = Number(process.env.PORT || 3000);
const SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET || "";
// Make BASE include the common prefix so we don't repeat it
// e.g. https://api.instacart.com/idp/v1
const INSTACART_API_BASE = (process.env.INSTACART_API_BASE || "").replace(/\/+$/,"");
const INSTACART_API_KEY = process.env.INSTACART_API_KEY || "";
const INSTACART_KEY_HEADER = process.env.INSTACART_KEY_HEADER || "X-API-Key";

/* ---------- Helpers ---------- */
function verifyAppProxy(req: Request, res: Response, next: NextFunction) {
  const secret = SHOPIFY_API_SECRET;
  if (!secret) return res.status(500).send("Missing SHOPIFY_API_SECRET");

  const q = { ...req.query } as Record<string, unknown>;
  const sig = String(q.signature || "");
  delete (q as any).signature;

  const ordered = Object.keys(q).sort().map((k) =>
    `${k}=${Array.isArray(q[k]) ? (q[k] as any[]).join(",") : (q[k] ?? "").toString()}`
  ).join("");

  const hmac = crypto.createHmac("sha256", secret).update(ordered, "utf8").digest("hex");
  if (sig !== hmac) return res.status(401).send("Bad signature");
  next();
}

function toInstacartLineItems(items: BuildListPayload["items"]) {
  // Map your Ingredient -> Instacart LineItem contract
  return items.map(i => ({
    // Docs call this “LineItem” product name:
    product_name: i.name,
    // Single-measurement fields:
    quantity: i.quantity,
    unit: i.unit,
    // Optional helpers (if supported by your program/key):
    notes: i.notes || undefined,
    brand: i.brand || undefined,
    // Examples of optional identifiers if your program supports them:
    upc: i.retailer_map?.upc || undefined,
    store_sku: i.retailer_map?.store_sku || undefined
  }));
}

async function callInstacartCreateList(payload: BuildListPayload) {
  if (!INSTACART_API_BASE || !INSTACART_API_KEY) {
    throw new Error("Instacart env vars are not configured");
  }

  // From the docs screenshot: POST /idp/v1/products/products_link
  const url = `${INSTACART_API_BASE}/products/products_link`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    [INSTACART_KEY_HEADER]: INSTACART_API_KEY
  };

  const body = {
    // The Instacart API expects an array of LineItem objects
    line_items: toInstacartLineItems(payload.items),
    // Optional metadata you may want to pass if your program supports it:
    // source: "heirclark-nutrition-calculator",
    // landing_url: payload.recipeLandingUrl
  };

  const { data } = await axios.post(url, body, { headers, timeout: 25_000 });
  return data; // Typically includes a link the user can open
}

/* ---------- Routes ---------- */
app.get("/proxy/build-list", verifyAppProxy, (req: Request, res: Response) => {
  if (req.query.ping) return res.json({ ok: true });
  res.status(405).json({ ok: false, error: "Use POST for /proxy/build-list" });
});

app.post("/proxy/build-list", verifyAppProxy, async (req: Request, res: Response) => {
  try {
    const parsed = BuildListPayloadSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ ok:false, error:"Invalid payload", issues: parsed.error.flatten() });
    }
    const instacart = await callInstacartCreateList(parsed.data);
    res.json({ ok: true, instacart });
  } catch (err:any) {
    console.error("Instacart error:", err?.response?.data || err?.message || err);
    res.status(502).json({ ok:false, error:"Failed to create Instacart list", detail: err?.response?.data || err?.message || "unknown" });
  }
});

/* Optional REST (bypass proxy) */
const corsOptions: CorsOptions = {
  origin: (_origin, cb) => cb(null, true),
  credentials: true
};
app.options("/rest/build-list", cors(corsOptions));
app.post("/rest/build-list", cors(corsOptions), async (req: Request, res: Response) => {
  try {
    const parsed = BuildListPayloadSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ ok:false, error:"Invalid payload", issues: parsed.error.flatten() });
    }
    const instacart = await callInstacartCreateList(parsed.data);
    res.json({ ok: true, instacart });
  } catch (err:any) {
    console.error("Instacart error:", err?.response?.data || err?.message || err);
    res.status(502).json({ ok:false, error:"Failed to create Instacart list", detail: err?.response?.data || err?.message || "unknown" });
  }
});

app.get("/api/health", (_req, res) => res.json({ ok: true }));
app.listen(PORT, () => console.log(`Heirclark Instacart backend running on port ${PORT}`));
