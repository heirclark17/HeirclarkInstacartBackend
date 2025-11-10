// src/index.ts
import express, { Request, Response, NextFunction } from "express";
import crypto from "crypto";

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/** Verify Shopify App Proxy signature (uses APP "API secret key") */
function verifyAppProxy(req: Request, res: Response, next: NextFunction) {
  const secret = process.env.SHOPIFY_API_SECRET || "";
  const q = { ...req.query } as Record<string, unknown>;
  const sig = String(q.signature || "");
  delete q.signature;

  const ordered = Object.keys(q)
    .sort()
    .map((k) => {
      const v = q[k];
      return `${k}=${Array.isArray(v) ? v.join(",") : (v ?? "").toString()}`;
    })
    .join("");

  const hmac = crypto.createHmac("sha256", secret).update(ordered, "utf8").digest("hex");
  if (!sig || sig !== hmac) return res.status(401).send("Bad signature");
  next();
}

/** App proxy health: storefront GET /apps/instacart/build-list?ping=1 */
app.get("/proxy/build-list", verifyAppProxy, (req: Request, res: Response) => {
  if (req.query.ping) return res.json({ ok: true });
  res.status(405).json({ ok: false, error: "Use POST for build-list" });
});

/** Main POST used by your theme to create the Instacart list */
app.post("/proxy/build-list", verifyAppProxy, (req: Request, res: Response) => {
  const { start, plan, recipeLandingUrl } = req.body || {};
  // TODO: call Instacart here
  res.json({ ok: true, message: "Instacart list created (stub)." });
});

/** Simple health endpoints so Admin and Railway have something real to hit */
app.get("/", (_req: Request, res: Response) => res.send("Heirclark backend OK"));
app.get("/api/health", (_req: Request, res: Response) => res.json({ ok: true }));

/** Optional: avoid "Cannot GET /api/auth" in Admin by returning a simple page */
app.get("/api/auth", (_req: Request, res: Response) =>
  res.send("Installed. No OAuth UI; use App Proxy endpoints.")
);

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => console.log(`Heirclark Instacart backend running on port ${port}`));
