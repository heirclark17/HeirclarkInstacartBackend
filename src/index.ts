import express from "express";
import crypto from "crypto";
// import nextHandler from './next'          // if you have one
// import { vite } from './vite'              // if you have one
// import path from "path";

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", true);
app.use(express.json());

// 1) ✅ YOUR APP PROXY ROUTES FIRST
// -------------------------------------------------
app.get("/proxy/build-list", (req, res) => {
  res.type("application/json").status(200).send({
    ok: true,
    via: "app-proxy",
    ping: req.query.ping ?? null,
  });
});

function verifyAppProxy(req: any, res: any, next: any) {
  try {
    const secret = process.env.SHOPIFY_API_SECRET;
    if (!secret) return res.status(500).json({ ok: false, error: "Missing SHOPIFY_API_SECRET" });

    const q: Record<string, unknown> = { ...req.query };
    const sig = String(q.signature || "");
    delete (q as any).signature;

    const ordered = Object.keys(q)
      .sort()
      .map((k) => {
        const v = Array.isArray(q[k]) ? (q[k] as any[]).join(",") : (q[k] ?? "").toString();
        return `${k}=${v}`;
      })
      .join("");

    const hmac = crypto.createHmac("sha256", secret).update(ordered, "utf8").digest("hex");
    if (sig !== hmac) return res.status(401).json({ ok: false, error: "Bad signature" });
    next();
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || "verifyAppProxy failed" });
  }
}

app.post("/proxy/build-list", verifyAppProxy, async (req, res, next) => {
  try {
    const { start, plan, recipeLandingUrl } = req.body || {};
    return res.status(200).json({
      ok: true,
      message: "Instacart list created (proxy).",
      received: {
        start: start ?? null,
        days: Array.isArray(plan) ? plan.length : 0,
        recipeLandingUrl: recipeLandingUrl ?? null,
      },
    });
  } catch (e) { next(e); }
});
// -------------------------------------------------


// 2) OPTIONAL: other specific API routes (if any)
// app.get('/api/health', ...);

// 3) THEN static hosting / framework middlewares
// app.use(express.static(path.join(__dirname, 'public')));   // AFTER proxy routes
// app.use(vite.middlewares);                                 // AFTER proxy routes
// app.all('*', (req, res) => nextHandler(req, res));         // AFTER proxy routes

// 4) JSON 404 + error handlers LAST
app.use((req, res) => {
  res.type("application/json").status(404).send({ ok: false, error: "Not Found", path: req.originalUrl });
});

app.use((err: any, _req: any, res: any, _next: any) => {
  console.error("Proxy error:", err);
  res.type("application/json").status(500).send({ ok: false, error: err?.message || "Server error" });
});

const port = Number(process.env.PORT || 8080);
app.listen(port, () => console.log(`Heirclark Instacart backend (proxy) running on ${port}`));
