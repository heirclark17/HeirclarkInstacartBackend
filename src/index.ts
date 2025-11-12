import express from "express";
import crypto from "crypto";

const app = express();

// ---- Recommended hardening ----
app.disable("x-powered-by");
app.set("trust proxy", true);

// Parse JSON bodies (App Proxy GET has no body; POST will)
app.use(express.json());

// ---------- Root debug (prove service is up) ----------
app.get("/", (_req, res) => {
  res.type("application/json").status(200).send({
    ok: true,
    service: "heirclark-backend",
  });
});

// ---------- OPEN health for App Proxy GET ping (no HMAC) ----------
app.get("/proxy/build-list", (req, res) => {
  res.type("application/json").status(200).send({
    ok: true,
    via: "app-proxy",
    ping: req.query.ping ?? null,
  });
});

// Optional: second health endpoint if you want to curl Railway directly
app.get("/proxy/health", (_req, res) => {
  res.type("application/json").status(200).send({ ok: true, via: "proxy-health" });
});

// ---------- HMAC for App Proxy POST ONLY ----------
function verifyAppProxy(req: any, res: any, next: any) {
  try {
    const secret = process.env.SHOPIFY_API_SECRET;
    if (!secret) {
      // If this fires, the POST will 500 with JSON—not HTML.
      console.error("[verifyAppProxy] Missing SHOPIFY_API_SECRET");
      return res.status(500).json({ ok: false, error: "Missing SHOPIFY_API_SECRET" });
    }

    // Shopify signs the *query string* only.
    // Copy and sort the query params, excluding 'signature'.
    const q: Record<string, unknown> = { ...req.query };
    const sig = String(q.signature || ""); // Shopify sends 'signature'
    delete (q as any).signature;

    const ordered = Object.keys(q)
      .sort()
      .map((k) => {
        const v = Array.isArray(q[k]) ? (q[k] as any[]).join(",") : (q[k] ?? "").toString();
        return `${k}=${v}`;
      })
      .join("");

    const hmac = crypto.createHmac("sha256", secret).update(ordered, "utf8").digest("hex");

    if (sig !== hmac) {
      console.warn("[verifyAppProxy] Bad signature", { shop: q.shop, path_prefix: q.path_prefix });
      return res.status(401).json({ ok: false, error: "Bad signature" });
    }

    return next();
  } catch (err: any) {
    console.error("[verifyAppProxy] Exception:", err);
    return res.status(500).json({ ok: false, error: err?.message || "verifyAppProxy failed" });
  }
}

// ---------- REAL proxy action (POST) ----------
app.post("/proxy/build-list", verifyAppProxy, async (req, res, next) => {
  try {
    // Your theme sends { start, plan, recipeLandingUrl }
    const { start, plan, recipeLandingUrl } = req.body || {};

    // TODO: Transform `plan` → Instacart "Create shopping list page" payload
    // For now, echo back what we received so you can verify end-to-end.
    return res.status(200).json({
      ok: true,
      message: "Instacart list created (proxy).",
      received: {
        start: start ?? null,
        days: Array.isArray(plan) ? plan.length : 0,
        recipeLandingUrl: recipeLandingUrl ?? null,
      },
    });
  } catch (e) {
    return next(e);
  }
});

// ---------- JSON 404 (prevents HTML error pages) ----------
app.use((req, res) => {
  res.type("application/json").status(404).send({
    ok: false,
    error: "Not Found",
    path: req.originalUrl,
  });
});

// ---------- JSON error handler (prevents HTML error pages) ----------
app.use((err: any, _req: any, res: any, _next: any) => {
  console.error("Proxy error:", err);
  res
    .type("application/json")
    .status(500)
    .send({ ok: false, error: err?.message || "Server error" });
});

// ---------- Boot ----------
const port = Number(process.env.PORT || 8080);
app.listen(port, () => {
  console.log(`Heirclark Instacart backend (proxy) running on ${port}`);
});
