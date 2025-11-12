import express from "express";
import crypto from "crypto";

const app = express();
app.use(express.json());

// ---- DEBUG root to prove it's running ----
app.get("/", (_req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.status(200).send(JSON.stringify({ ok: true, service: "heirclark-backend" }));
});

// ---- OPEN health for App Proxy GET ping (no HMAC) ----
app.get("/proxy/build-list", (req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.status(200).send(JSON.stringify({
    ok: true,
    via: "app-proxy",
    ping: req.query.ping ?? null
  }));
});

// ---- HMAC for App Proxy POST ONLY ----
function verifyAppProxy(req: any, res: any, next: any) {
  try {
    const secret = process.env.SHOPIFY_API_SECRET;
    if (!secret) return res.status(500).json({ ok: false, error: "Missing SHOPIFY_API_SECRET" });

    const q: Record<string, unknown> = { ...req.query };
    const signature = String(q.signature || "");
    delete (q as any).signature;

    const ordered = Object.keys(q)
      .sort()
      .map((k) => {
        const v = Array.isArray(q[k]) ? (q[k] as any[]).join(",") : (q[k] ?? "").toString();
        return `${k}=${v}`;
      })
      .join("");

    const hmac = crypto.createHmac("sha256", secret).update(ordered, "utf8").digest("hex");
    if (signature !== hmac) return res.status(401).json({ ok: false, error: "Bad signature" });
    next();
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err?.message || "verifyAppProxy failed" });
  }
}

// ---- REAL proxy action (POST) ----
app.post("/proxy/build-list", verifyAppProxy, async (req, res, next) => {
  try {
    const { start, plan } = req.body || {};
    // TODO: transform `plan` to Instacart products; for now just echo.
    res.json({ ok: true, message: "Instacart list created (proxy).", received: { start, days: plan?.length || 0 } });
  } catch (e) { next(e); }
});

// ---- JSON error handler (prevents HTML error pages) ----
app.use((err: any, _req: any, res: any, _next: any) => {
  console.error("Proxy error:", err);
  res.status(500).json({ ok: false, error: err?.message || "Server error" });
});

const port = Number(process.env.PORT || 8080);
app.listen(port, () => {
  console.log(`Heirclark Instacart backend (proxy) running on ${port}`);
});
