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
    .map((k) => `${k}=${Array.isArray(q[k]) ? (q[k] as any[]).join(",") : (q[k] ?? "").toString()}`)
    .join("");

  const hmac = crypto.createHmac("sha256", secret).update(ordered, "utf8").digest("hex");
  if (sig !== hmac) return res.status(401).send("Bad signature");
  next();
}

// Called via Shopify App Proxy from your theme
app.get("/proxy/build-list", verifyAppProxy, (req: Request, res: Response) => {
  if (req.query.ping) return res.json({ ok: true });
  return res.status(405).json({ ok: false, error: "Use POST for build-list" });
});

app.post("/proxy/build-list", verifyAppProxy, (req: Request, res: Response) => {
  const { start, plan, recipeLandingUrl } = req.body || {};
  return res.json({ ok: true, message: "Instacart list created (stub)." });
});

// Minimal route so the embedded app doesn't show “Cannot GET /api/auth”
app.get("/api/auth", (_req: Request, res: Response) => res.send("App installed. Auth not required for proxy-only flow."));

app.get("/api/health", (_req: Request, res: Response) => res.json({ ok: true }));

app.listen(process.env.PORT || 3000, () => {
  console.log(`Heirclark Instacart backend running on port ${process.env.PORT || 3000}`);
});
