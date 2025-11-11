// src/index.ts
import express, { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import cors, { CorsOptions } from "cors";
import axios from "axios";
import { BuildListPayloadSchema } from "./schema";  // <-- use your schema

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
  const secret = SHOPIFY_API_SECRET;
  if (!secret) return res.status(500).send("Missing SHOPIFY_API_SECRET");

  const q = { ...req.query } as Record<string, unknown>;
  const sig = String(q.signature || "");
  delete (q as any).signature;

  const ordered = Object.keys(q)
    .sort()
    .map((k) => `${k}=${Array.isArray(q[k]) ? (q[k] as any[]).join(",") : (q[k] ?? "").toString()}`)
    .join("");

  const hmac = crypto.createHmac("sha256", secret).update(ordered, "utf8").digest("hex");
  if (sig !== hmac) return res.status(401).send("Bad signature");
  next();
}

// Map your Ingredient to Instacart LineItem (adjust field names to your contract)
function mapToInstacartLineItem(item: any) {
  return {
    product_name: item.name,     // Instacart uses product name matching
    quantity: item.quantity,     // number
    unit: item.unit,             // must match Instacart’s "Units of measurement" list
    notes: item.notes || undefined,
    // You can pass search hints if allowed:
    // upc: item?.retailer_map?.upc ?? undefined,
    // store_sku: item?.retailer_map?.store_sku ?? undefined
  };
}

async function forwardToInstacart(payload: any) {
  if (!INSTACART_API_BASE || !INSTACART_API_KEY) {
    throw new Error("Instacart env vars are not configured");
  }

  // Per the Instacart doc you shared, the path is:
  // POST /idp/v1/products/products_link
  const url = `${INSTACART_API_BASE}/idp/v1/products/products_link`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    [INSTACART_KEY_HEADER]: INSTACART_API_KEY,
  };

  const { data } = await axios.post(url, payload, { headers, timeout: 25_000 });
  return data;
}

/* ---------- PROXY routes (Shopify → your backend) ---------- */
app.get("/proxy/build-list", verifyAppProxy, (req: Request, res: Response) => {
  if (req.query.ping) return res.json({ ok: true });
  return res.status(405).json({ ok: false, error: "Use POST for /proxy/build-list" });
});

app.post("/proxy/build-list", verifyAppProxy, async (req: Request, res: Response) => {
  try {
    // 1) Validate the incoming body
    const parsed = BuildListPayloadSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ ok: false, error: "Invalid payload", issues: parsed.error.flatten() });
    }
    const body = parsed.data;

    // 2) Map your items to Instacart "line_items"
    const line_items = body.items.map(mapToInstacartLineItem);

    // 3) Compose Instacart request body (based on their "Create shopping list page" endpoint)
    const instacartBody = {
      line_items,
      // Optional:
      // page_config, retailer, redirect_url, etc. — include if your contract supports these
    };

    // 4) Send to Instacart
    const instacartResp = await forwardToInstacart(instacartBody);

    return res.json({
      ok: true,
      message: "Instacart list link created",
      instacart: instacartResp, // response typically includes a link/URL
      meta: { start: body.start, plan: body.plan, recipeLandingUrl: body.recipeLandingUrl },
    });
  } catch (err: any) {
    console.error("Instacart error:", err?.response?.data || err?.message || err);
    return res.status(502).json({
      ok: false,
      error: "Failed to create Instacart list",
      detail: err?.response?.data || err?.message || "unknown",
    });
  }
});

/* ---------- Optional REST fallback ---------- */
const corsOptions: CorsOptions = {
  origin(_origin, cb) { cb(null, true); },
  credentials: true,
};
app.options("/rest/build-list", cors(corsOptions));
app.post("/rest/build-list", cors(corsOptions), async (req: Request, res: Response) => {
  try {
    const parsed = BuildListPayloadSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ ok: false, error: "Invalid payload", issues: parsed.error.flatten() });
    }
    const body = parsed.data;
    const line_items = body.items.map(mapToInstacartLineItem);
    const instacartResp = await forwardToInstacart({ line_items });
    return res.json({ ok: true, instacart: instacartResp });
  } catch (err: any) {
    console.error("Instacart error:", err?.response?.data || err?.message || err);
    return res.status(502).json({ ok: false, error: "Failed to create Instacart list" });
  }
});

/* ---------- Basics ---------- */
app.get("/api/health", (_req: Request, res: Response) => res.json({ ok: true }));
app.listen(PORT, () => console.log(`Heirclark Instacart backend running on port ${PORT}`));
