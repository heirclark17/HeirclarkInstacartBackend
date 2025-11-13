import express from "express";
import crypto from "crypto";

const app = express();

app.disable("x-powered-by");
app.set("trust proxy", true);
app.use(express.json());

// -------------------------------------------------
// 0) Simple health check at root
// -------------------------------------------------
app.get("/", (_req, res) => {
  res.type("application/json").status(200).send({
    ok: true,
    service: "heirclark-instacart-backend",
  });
});

// -------------------------------------------------
// 1) ✅ APP PROXY ROUTES
//    We handle BOTH /build-list and /proxy/build-list
//    so whatever Shopify forwards, we respond correctly.
// -------------------------------------------------

// Open GET for quick pings (no HMAC)
app.get("/proxy/build-list", (req, res) => {
  res.type("application/json").status(200).send({
    ok: true,
    via: "app-proxy",
    path: "/proxy/build-list",
    ping: req.query.ping ?? null,
  });
});

// Same handler on /build-list so Shopify can forward here
app.get("/build-list", (req, res) => {
  res.type("application/json").status(200).send({
    ok: true,
    via: "app-proxy",
    path: "/build-list",
    ping: req.query.ping ?? null,
  });
});

// HMAC verifier (for POST from Shopify App Proxy)
function verifyAppProxy(req: any, res: any, next: any) {
  try {
    const secret = process.env.SHOPIFY_API_SECRET;
    if (!secret) {
      console.error("Missing SHOPIFY_API_SECRET");
      return res
        .status(500)
        .json({ ok: false, error: "Missing SHOPIFY_API_SECRET" });
    }

    const q: Record<string, unknown> = { ...req.query };
    const sig = String(q.signature || "");
    delete (q as any).signature;

    const ordered = Object.keys(q)
      .sort()
      .map((k) => {
        const v = Array.isArray(q[k])
          ? (q[k] as any[]).join(",")
          : (q[k] ?? "").toString();
        return `${k}=${v}`;
      })
      .join("");

    const hmac = crypto
      .createHmac("sha256", secret)
      .update(ordered, "utf8")
      .digest("hex");

    if (sig !== hmac) {
      console.error("Bad signature on app proxy request");
      return res.status(401).json({ ok: false, error: "Bad signature" });
    }

    next();
  } catch (e: any) {
    console.error("verifyAppProxy failed:", e);
    return res
      .status(500)
      .json({ ok: false, error: e?.message || "verifyAppProxy failed" });
  }
}

// Helper to build a simple mock result (you can later wire real weekPlan here)
function buildMockList(body: any) {
  const { start, plan, recipeLandingUrl } = body || {};
  return {
    ok: true,
    message: "Instacart list created (proxy).",
    received: {
      start: start ?? null,
      days: Array.isArray(plan) ? plan.length : 0,
      recipeLandingUrl: recipeLandingUrl ?? null,
    },
    ingredients: [
      "2 eggs",
      "2 egg whites",
      "1 chicken sausage link",
      "1/2 cup oats",
      "1/2 cup blueberries",
    ],
    cart: [
      { name: "Eggs (dozen)", quantity: 1 },
      { name: "Chicken sausage", quantity: 1 },
      { name: "Oats (container)", quantity: 1 },
      { name: "Blueberries (pint)", quantity: 1 },
    ],
  };
}

// POST handler core logic
async function handleBuildListPost(req: any, res: any, next: any) {
  try {
    console.log("POST /build-list body:", JSON.stringify(req.body || {}));
    const result = buildMockList(req.body);
    return res.status(200).json(result);
  } catch (e) {
    console.error("Error in build-list:", e);
    next(e);
  }
}

// Shopify will likely forward to /build-list
app.post("/build-list", verifyAppProxy, handleBuildListPost);

// You also have /proxy/build-list in case you config that path in the proxy URL
app.post("/proxy/build-list", verifyAppProxy, handleBuildListPost);

// -------------------------------------------------
// 4) JSON 404 + error handlers LAST
// -------------------------------------------------
app.use((req, res) => {
  res
    .type("application/json")
    .status(404)
    .send({ ok: false, error: "Not Found", path: req.originalUrl });
});

app.use((err: any, _req: any, res: any, _next: any) => {
  console.error("Proxy error:", err);
  res
    .type("application/json")
    .status(500)
    .send({ ok: false, error: err?.message || "Server error" });
});

const port = Number(process.env.PORT || 8080);
app.listen(port, () =>
  console.log(`Heirclark Instacart backend (proxy) running on ${port}`)
);
