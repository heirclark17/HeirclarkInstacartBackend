import express, { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import cors, { CorsOptions } from "cors";
import axios from "axios";
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

async function forwardToInstacart(body: any) {
  if (!INSTACART_API_BASE || !INSTACART_API_KEY) {
    throw new Error("Instacart env vars are not configured");
  }
  const url = `${INSTACART_API_BASE}/lists`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    [INSTACART_KEY_HEADER]: INSTACART_API_KEY
  };
  const { data } = await axios.post(url, body, { headers, timeout: 25_000 });
  return data;
}

/* ---------- PROXY routes ---------- */
app.get("/proxy/build-list", verifyAppProxy, (req: Request, res: Response) => {
  if (req.query.ping) return res.json({ ok: true });
  res.status(405).json({ ok: false, error: "Use POST for /proxy/build-list" });
});

app.post("/proxy/build-list", verifyAppProxy, async (req: Request, res: Response) => {
  // Validate with Zod
  const parsed = BuildListPayloadSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      ok: false,
      error: "Invalid payload",
      issues: parsed.error.flatten()
    });
  }
  const payload = parsed.data;

  try {
    // Map to Instacart’s expected shape (example shown in section 3)
    const instacartBody = {
      title: payload.plan ? `Heirclark ${payload.plan} plan` : "Heirclark list",
      source: "heirclark-nutrition-calculator",
      recipeLandingUrl: payload.recipeLandingUrl,
      items: payload.items.map(i => ({
        name: i.name,
        quantity: i.quantity,
        unit: i.unit,
        notes: i.notes || i.prep || undefined,
        category: i.category,
        pantry: i.pantry,
        substitutions_allowed: i.substitutions_allowed,
        retailer_map: i.retailer_map
      }))
    };

    const instacartResp = await forwardToInstacart(instacartBody);
    res.json({ ok: true, message: "Instacart list created.", instacart: instacartResp });
  } catch (err: any) {
    console.error("Instacart error:", err?.response?.data || err?.message || err);
    res.status(502).json({
      ok: false,
      error: "Failed to create Instacart list",
      detail: err?.response?.data || err?.message || "unknown"
    });
  }
});

/* ---------- Optional REST fallback ---------- */
const corsOptions: CorsOptions = {
  origin(_origin, cb) { cb(null, true); }, credentials: true
};
app.post("/rest/build-list", cors(corsOptions), async (req: Request, res: Response) => {
  const parsed = BuildListPayloadSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: "Invalid payload", issues: parsed.error.flatten() });
  }
  try {
    const p = parsed.data;
    const instacartBody = {
      title: p.plan ? `Heirclark ${p.plan} plan` : "Heirclark list",
      source: "heirclark-nutrition-calculator",
      recipeLandingUrl: p.recipeLandingUrl,
      items: p.items.map(i => ({
        name: i.name, quantity: i.quantity, unit: i.unit,
        notes: i.notes || i.prep || undefined,
        category: i.category, pantry: i.pantry,
        substitutions_allowed: i.substitutions_allowed,
        retailer_map: i.retailer_map
      }))
    };
    const instacartResp = await forwardToInstacart(instacartBody);
    res.json({ ok: true, message: "Instacart list created.", instacart: instacartResp });
  } catch (err: any) {
    res.status(502).json({ ok: false, error: "Failed to create Instacart list", detail: err?.message });
  }
});

/* ---------- Health ---------- */
app.get("/api/health", (_req, res) => res.json({ ok: true }));

/* ---------- Start ---------- */
app.listen(PORT, () => {
  console.log(`Heirclark Instacart backend running on port ${PORT}`);
});
