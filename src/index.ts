// index.ts (core pieces)
import express from "express";
import crypto from "crypto";
import type { Request, Response, NextFunction } from "express";

const app = express();
app.use(express.json());

// ------- App Proxy signature check (query param "signature") -------
function verifyAppProxy(req: Request, res: Response, next: NextFunction) {
  const secret = process.env.SHOPIFY_API_SECRET!;
  const q = { ...req.query } as Record<string, unknown>;
  const sig = String(q.signature || "");
  delete q.signature;

  // Build sorted query string "key=value" (values joined with ",")
  const ordered = Object.keys(q)
    .sort()
    .map((k) => {
      const v = q[k];
      return `${k}=${
        Array.isArray(v) ? v.join(",") : (v ?? "").toString()
      }`;
    })
    .join("");

  const hmac = crypto.createHmac("sha256", secret).update(ordered, "utf8").digest("hex");

  if (sig !== hmac) return res.status(401).send("Bad signature");
  return next();
}

// ------- Health for your theme's GET ping -------
app.get(`/${process.env.SHOPIFY_PUBLIC_SUBPATH}/build-list`, verifyAppProxy, (req, res) => {
  // If ?ping=1 is present we just say hello
  if (req.query.ping) return res.json({ ok: true });
  return res.status(405).json({ ok: false, error: "Use POST for build-list" });
});

// ------- Main POST handler your theme calls -------
app.post(`/${process.env.SHOPIFY_PUBLIC_SUBPATH}/build-list`, verifyAppProxy, (req, res) => {
  const { start, plan, recipeLandingUrl } = req.body || {};
  // …do your work here (create list, etc.) …
  return res.json({ ok: true, message: "Instacart list created (stub)." });
});

app.get(`/${process.env.SHOPIFY_PUBLIC_SUBPATH}/api/health`, (_req, res) => {
  res.json({ ok: true });
});

app.listen(process.env.PORT || 8080, () => {
  console.log("Heirclark Instacart backend running");
});
