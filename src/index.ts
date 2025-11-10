// index.ts
import express from "express";
import crypto from "crypto";
import type { Request, Response, NextFunction } from "express";

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- App Proxy signature check ---
function verifyAppProxy(req: Request, res: Response, next: NextFunction) {
  const secret = process.env.SHOPIFY_API_SECRET!;
  const q = { ...req.query } as Record<string, unknown>;
  const sig = String(q.signature || "");
  delete q.signature;

  // Build sorted "k=v" string per Shopify app proxy spec
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

// --- Health that your THEME can hit via proxy ---
// Theme calls:  GET /apps/instacart/build-list?ping=1
// Server sees:  GET /proxy/build-list?ping=1&signature=...
app.get("/proxy/build-list", verifyAppProxy, (req, res) => {
  if (req.query.ping) return res.json({ ok: true });
  return res.status(405).json({ ok: false, error: "Use POST for build-list" });
});

// --- Main POST handler your theme will use to create the list ---
app.post("/proxy/build-list", verifyAppProxy, (req, res) => {
  const { start, plan, recipeLandingUrl } = req.body || {};
  // TODO: create Instacart list here
  return res.json({ ok: true, message: "Instacart list created (stub)." });
});

// --- Direct server health (for Railway) ---
app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.listen(process.env.PORT || 3000, () => {
  console.log(`Heirclark Instacart backend running on port ${process.env.PORT || 3000}`);
});
