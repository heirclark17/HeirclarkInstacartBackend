import express from "express";
import crypto from "crypto";
import type { Request, Response, NextFunction } from "express";
import { BuildListRequestSchema } from "./schema.js";

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const PUBLIC_SUBPATH = process.env.SHOPIFY_PUBLIC_SUBPATH || "instacart";

/** Shopify App Proxy signature verifier */
function verifyAppProxy(req: Request, res: Response, next: NextFunction) {
  const secret = process.env.SHOPIFY_API_SECRET;
  if (!secret) return res.status(500).send("Server misconfigured: SHOPIFY_API_SECRET is missing");

  // Copy & sort query params; remove 'signature'
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
  if (sig !== hmac) return res.status(401).send("Bad signature");
  next();
}

/** Theme ping via App Proxy (GET /apps/<PUBLIC_SUBPATH>/build-list?ping=1) */
app.get(`/proxy/build-list`, verifyAppProxy, (req, res) => {
  if (req.query.ping) return res.json({ ok: true });
  return res.status(405).json({ ok: false, error: "Use POST for build-list" });
});

/** Main POST handler: validate payload, then (later) call Instacart */
app.post(`/proxy/build-list`, verifyAppProxy, async (req: Request, res: Response) => {
  const parse = BuildListRequestSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({
      ok: false,
      error: "Invalid payload",
      issues: parse.error.issues
    });
  }

  const { plan, start, recipeLandingUrl } = parse.data;

  // 👇 this is where you'd build the Instacart list using plan.ingredients
  // For now, just echo back the validated payload.
  return res.json({
    ok: true,
    received: { start, recipeLandingUrl, items: plan.ingredients.length },
    message: "Validated. (Stub) Create Instacart list here."
  });
});

/** Direct health endpoint for Railway */
app.get("/api/health", (_req, res) => res.json({ ok: true }));

const PORT = Number(process.env.PORT) || 3000;
app.listen(PORT, () => {
  console.log(`Heirclark Instacart backend running on port ${PORT}`);
});
