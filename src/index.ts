// src/index.ts
import express, { Request, Response, NextFunction } from "express";
import crypto from "crypto";

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

function verifyAppProxy(req: Request, res: Response, next: NextFunction) {
  const secret = process.env.SHOPIFY_API_SECRET!;
  const q = { ...req.query } as Record<string, unknown>;
  const sig = String(q.signature || "");
  delete (q as any).signature;

  const ordered = Object.keys(q)
    .sort()
    .map((k) =>
      `${k}=${Array.isArray(q[k]) ? (q[k] as any[]).join(",") : (q[k] ?? "").toString()}`
    )
    .join("");

  const hmac = crypto.createHmac("sha256", secret).update(ordered, "utf8").digest("hex");
  if (sig !== hmac) return res.status(401).send("Bad signature");
  next();
}

app.get("/proxy/build-list", verifyAppProxy, (req, res) => {
  if (req.query.ping) return res.json({ ok: true });
  return res.status(405).json({ ok: false, error: "Use POST for build-list" });
});

app.post("/proxy/build-list", verifyAppProxy, async (req: Request, res: Response) => {
  try {
    const { start, plan, recipeLandingUrl } = req.body || {};
    // Validate minimal payload
    if (!start || !Array.isArray(plan)) {
      return res.status(400).json({ ok: false, error: "Missing start or plan" });
    }

    // === Instacart call ===
    const apiKey = process.env.INSTACART_API_KEY!;
    const instacartUrl = process.env.INSTACART_BUILD_URL!; // e.g. https://api.instacart.com/vX/your/endpoint
    const authHeaderName = process.env.INSTACART_AUTH_HEADER_NAME || "x-api-key";

    const instacartResp = await fetch(instacartUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [authHeaderName]: apiKey,                // “simple API key” style (header name configurable)
        // If Instacart expects query or a different header (e.g., Authorization), just adjust here.
        // Authorization: `ApiKey ${apiKey}`,    // alternative pattern some APIs use
      },
      body: JSON.stringify({
        start,
        plan,               // send your 7-day plan (kcal/macros/items) or transform to Instacart’s schema here
        source: "heirclark",
        recipeLandingUrl,
      }),
    });

    if (!instacartResp.ok) {
      const text = await instacartResp.text().catch(() => "");
      return res.status(502).json({ ok: false, error: "Instacart error", detail: text });
    }

    const result = await instacartResp.json().catch(() => ({}));
    // Return a friendly message + any deep link Instacart returns
    return res.json({
      ok: true,
      message: "Instacart list created.",
      instacart: result,
    });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: "Server error", detail: String(e?.message || e) });
  }
});

// Minimal routes
app.get("/api/auth", (_req, res) => res.send("App installed. Auth not required for proxy-only flow."));
app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.listen(process.env.PORT || 3000, () => {
  console.log(`Heirclark Instacart backend running on port ${process.env.PORT || 3000}`);
});
