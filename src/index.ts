import express from "express";
import crypto from "crypto";
import type { Request, Response, NextFunction } from "express";

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Verify Shopify App Proxy signature (?signature=...)
function verifyAppProxy(req: Request, res: Response, next: NextFunction) {
  const secret = process.env.SHOPIFY_API_SECRET!;
  const q = { ...req.query } as Record<string, unknown>;
  const sig = String(q.signature || "");
  delete (q as any).signature;

  const ordered = Object.keys(q)
    .sort()
    .map((k) => {
      const v = q[k];
      return `${k}=${Array.isArray(v) ? v.join(",") : (v ?? "").toString()}`;
    })
    .join("");

  const hmac = crypto.createHmac("sha256", secret).update(ordered, "utf8").digest("hex");
  if (sig !== hmac) return res.status(401).send("Bad signature");
  return next();
}

// Theme: GET /apps/instacart/build-list?ping=1  ->  Backend: GET /proxy/build-list
app.get("/proxy/build-list", verifyAppProxy, (req: Request, res: Response) => {
  if (req.query.ping) return res.json({ ok: true });
  return res.status(405).json({ ok: false, error: "Use POST for build-list" });
});

// Theme: POST /apps/instacart/build-list  ->  Backend: POST /proxy/build-list
app.post("/proxy/build-list", verifyAppProxy, (req: Request, res: Response) => {
  const { start, plan, recipeLandingUrl } = req.body || {};
  // TODO: build Instacart list here
  return res.json({ ok: true, message: "Instacart list created (stub)." });
});

// Direct health (no proxy/signature needed)
app.get("/api/health", (_req: Request, res: Response) => res.json({ ok: true }));

const port = Number(process.env.PORT || 3000);
app.listen(port, () => {
  console.log(`Heirclark Instacart backend running on port ${port}`);
});
