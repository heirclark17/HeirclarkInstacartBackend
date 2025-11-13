// src/index.ts
import express, { Request, Response, NextFunction } from "express";
import crypto from "crypto";

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ----- Simple health / root route (used by Shopify App URL) -----
app.get("/", (_req: Request, res: Response) => {
  res.setHeader("Content-Type", "application/json");
  res.status(200).send(
    JSON.stringify({
      ok: true,
      service: "heirclark-backend",
    })
  );
});

// ----- App Proxy HMAC verification (optional, but recommended) -----
function verifyAppProxy(req: Request, res: Response, next: NextFunction) {
  const secret = process.env.SHOPIFY_API_SECRET;

  // If not set, skip verification (useful while testing)
  if (!secret) {
    console.warn("SHOPIFY_API_SECRET not set; skipping HMAC verification");
    return next();
  }

  const q = { ...req.query } as Record<string, unknown>;
  const sig = String(q.signature ?? "");
  delete (q as any).signature;

  const ordered = Object.keys(q)
    .sort()
    .map((k) => {
      const v = q[k];
      return `${k}=${
        Array.isArray(v) ? (v as unknown[]).join(",") : (v ?? "").toString()
      }`;
    })
    .join("");

  const hmac = crypto
    .createHmac("sha256", secret)
    .update(ordered, "utf8")
    .digest("hex");

  if (sig !== hmac) {
    console.warn("Bad App Proxy signature", { expected: hmac, got: sig });
    return res.status(401).json({ ok: false, error: "Bad signature" });
  }

  return next();
}

// ----- App Proxy endpoint for /apps/instacart/build-list -----
app.get(
  "/proxy/build-list",
  verifyAppProxy,
  (req: Request, res: Response) => {
    res.setHeader("Content-Type", "application/json");
    res.status(200).send(
      JSON.stringify({
        ok: true,
        via: "app-proxy",
        ping: req.query.ping ?? null,
      })
    );
  }
);

// ----- Global error handler -----
app.use(
  (err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error("Unhandled error:", err);
    res.status(500).json({ ok: false, error: "Internal server error" });
  }
);

// ----- Start server -----
const port = Number(process.env.PORT) || 3000;
app.listen(port, () => {
  console.log(`Heirclark Instacart backend listening on port ${port}`);
});
