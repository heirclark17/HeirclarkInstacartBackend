// src/index.ts
import express, { Request, Response, NextFunction } from "express";
import crypto from "crypto";

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- Verify Shopify App Proxy signature ---
function verifyAppProxy(req: Request, res: Response, next: NextFunction) {
  const secret = process.env.SHOPIFY_API_SECRET || "";
  const q: Record<string, unknown> = { ...req.query };
  const sig = String(q.signature ?? "");
  delete q.signature;

  const ordered = Object.keys(q)
    .sort()
    .map((k) => `${k}=${Array.isArray(q[k]) ? (q[k] as unknown[]).join(",") : (q[k] ?? "").toString()}`)
    .join("");

  const hmac = crypto.createHmac("sha256", secret).update(ordered, "utf8").digest("hex");
  if (sig !== hmac) return res.status(401).send("Bad signature");
  next();
}

// --- App Proxy GET health: storefront calls /apps/instacart/build-list?ping=1 ---
app.get("/proxy/build-list", verifyAppProxy, (req: Request, res: Response) => {
  if (req.query.ping) return res.json({ ok: true });
  return res.status(405).json({ ok: false, error: "Use POST for build-list" });
});

// --- App Proxy POST: main action ---
app.post("/proxy/build-list", verifyAppProxy, (req: Request, res: Response) => {
  const { start, plan, recipeLandingUrl } = (req.body ?? {}) as {
    start?: string;
    plan?: unknown;
    recipeLandingUrl?: string;
  };
  // TODO: create the Instacart list here
  return res.json({ ok: true, received: { start, recipeLandingUrl } });
});

// --- Admin landing + health so the app opens in Shopify Admin ---
app.get("/api/auth", (_req: Request, res: Response) => {
  res.type("html").send("<h1>Heirclark Instabridge</h1><p>App is installed.</p>");
});

app.get("/api/health", (_req: Request, res: Response) => res.json({ ok: true }));

app.listen(process.env.PORT || 3000, () => {
  console.log(`Heirclark Instacart backend running on port ${process.env.PORT || 3000}`);
});
