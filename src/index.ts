import express, { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import cors, { CorsOptions } from "cors";
import axios from "axios";

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* ---------- Config ---------- */
const PORT = Number(process.env.PORT || 3000);
const SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET || "";
const INSTACART_API_BASE =
  (process.env.INSTACART_API_BASE || "").replace(/\/+$/, ""); // trim trailing slash
const INSTACART_API_KEY = process.env.INSTACART_API_KEY || "";
const INSTACART_KEY_HEADER = process.env.INSTACART_KEY_HEADER || "X-API-Key";

/* ---------- Helpers ---------- */
function verifyAppProxy(req: Request, res: Response, next: NextFunction) {
  // Validates Shopify App Proxy HMAC (query-string based)
  const secret = SHOPIFY_API_SECRET;
  if (!secret) return res.status(500).send("Missing SHOPIFY_API_SECRET");

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

  const hmac = crypto
    .createHmac("sha256", secret)
    .update(ordered, "utf8")
    .digest("hex");

  if (sig !== hmac) return res.status(401).send("Bad signature");
  next();
}

async function forwardToInstacart(payload: any) {
  if (!INSTACART_API_BASE || !INSTACART_API_KEY) {
    throw new Error("Instacart env vars are not configured");
  }

  // Example endpoint. Replace '/lists' with Instacart’s actual path.
  const url = `${INSTACART_API_BASE}/lists`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    [ INSTACART_KEY_HEADER ]: INSTACART_API_KEY
  };

  const { data } = await axios.post(url, payload, { headers, timeout: 25_000 });
  return data; // Return Instacart’s JSON
}

/* ---------- PROXY routes (Shopify → your backend) ---------- */
// GET ping for quick health checks through the proxy (no body)
app.get("/proxy/build-list", verifyAppProxy, (req: Request, res: Response) => {
  if (req.query.ping) return res.json({ ok: true });
  return res
    .status(405)
    .json({ ok: false, error: "Use POST for /proxy/build-list" });
});

// POST payload from theme; forward to Instacart using simple API key
app.post("/proxy/build-list", verifyAppProxy, async (req: Request, res: Response) => {
  try {
    const { start, plan, recipeLandingUrl } = req.body || {};
    if (!plan || !Array.isArray(plan)) {
      return res.status(400).json({ ok: false, error: "Missing or invalid plan" });
    }

    const instacartPayload = {
      start,
      plan,
      source: "heirclark-nutrition-calculator",
      recipeLandingUrl
    };

    const instacartResponse = await forwardToInstacart(instacartPayload);

    return res.json({
      ok: true,
      message: "Instacart list created.",
      instacart: instacartResponse
    });
  } catch (err: any) {
    console.error("Instacart error:", err?.response?.data || err?.message || err);
    return res.status(502).json({
      ok: false,
      error: "Failed to create Instacart list",
      detail: err?.response?.data || err?.message || "unknown"
    });
  }
});

/* ---------- Optional REST fallback (direct call without App Proxy) ---------- */
/*  Use this only if you want to call the backend directly from your theme
    (not recommended unless you must). Add your shop origin(s) to allowlist.  */
const corsOptions: CorsOptions = {
  origin(origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void) {
    // TODO: lock this down to your live domain(s)
    // e.g., const allow = !origin || /https?:\/\/(www\.)?heirclark\.com$/.test(origin);
    const allow = true;
    cb(null, allow);
  },
  credentials: true
};

app.options("/rest/build-list", cors(corsOptions));
app.post("/rest/build-list", cors(corsOptions), async (req: Request, res: Response) => {
  try {
    const { start, plan, recipeLandingUrl } = req.body || {};
    if (!plan || !Array.isArray(plan)) {
      return res.status(400).json({ ok: false, error: "Missing or invalid plan" });
    }

    const instacartPayload = {
      start,
      plan,
      source: "heirclark-nutrition-calculator",
      recipeLandingUrl
    };

    const instacartResponse = await forwardToInstacart(instacartPayload);

    return res.json({
      ok: true,
      message: "Instacart list created.",
      instacart: instacartResponse
    });
  } catch (err: any) {
    console.error("Instacart error:", err?.response?.data || err?.message || err);
    return res.status(502).json({
      ok: false,
      error: "Failed to create Instacart list",
      detail: err?.response?.data || err?.message || "unknown"
    });
  }
});

/* ---------- Basic app pages ---------- */
app.get("/api/auth", (_req: Request, res: Response) =>
  res.send("App installed. Auth not required for proxy-only flow.")
);
app.get("/api/health", (_req: Request, res: Response) => res.json({ ok: true }));

/* ---------- Error fallthrough ---------- */
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ ok: false, error: "Server error" });
});

/* ---------- Start ---------- */
app.listen(PORT, () => {
  console.log(`Heirclark Instacart backend running on port ${PORT}`);
});
