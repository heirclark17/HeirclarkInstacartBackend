// src/routes/appleHealth.ts
import { Router, Request, Response } from "express";
import {
  appleAuthToken,
  appleCompleteLink,
  appleCreateLinkCode,
  appleGetToday,
  appleUpsertSamples,
} from "../utils/services/appleHealthStore";
import { authMiddleware } from "../middleware/auth";

export const appleHealthRouter = Router();

// ✅ SECURITY FIX: Apply STRICT authentication (OWASP A01: IDOR Protection)
appleHealthRouter.use(authMiddleware({ strictAuth: true }));

// Web app: start link flow
// POST /api/v1/wearables/apple/link/start  { shopifyCustomerId }
appleHealthRouter.post("/link/start", (req: Request, res: Response) => {
  const shopifyCustomerId = String(req.body?.shopifyCustomerId || "").trim();
  if (!shopifyCustomerId) return res.status(400).json({ error: "Missing shopifyCustomerId" });

  const { code, expiresAt } = appleCreateLinkCode(shopifyCustomerId);
  res.json({ linkCode: code, expiresAt });
});

// iOS app: complete link with code -> receive sync token
// POST /api/v1/wearables/apple/link/complete { linkCode }
appleHealthRouter.post("/link/complete", (req: Request, res: Response) => {
  const linkCode = String(req.body?.linkCode || "").trim();
  if (!linkCode) return res.status(400).json({ error: "Missing linkCode" });

  const out = appleCompleteLink(linkCode);
  if (!out) return res.status(401).json({ error: "Invalid or expired linkCode" });

  res.json({ appleSyncToken: out.token, expiresAt: out.expiresAt });
});

// iOS app: push deltas
// POST /api/v1/wearables/apple/sync
// Header: Authorization: Bearer <appleSyncToken>
appleHealthRouter.post("/sync", async (req: Request, res: Response) => {
  const auth = String(req.headers.authorization || "");
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) return res.status(401).json({ error: "Missing bearer token" });

  const tok = await appleAuthToken(token);
  if (!tok) return res.status(401).json({ error: "Invalid/expired token" });

  const type = req.body?.type;
  const samples = Array.isArray(req.body?.samples) ? req.body.samples : [];

  if (type !== "active_energy_burned" && type !== "dietary_energy_consumed") {
    return res.status(400).json({ error: "Invalid type" });
  }

  const updated = appleUpsertSamples(tok.shopifyCustomerId, { type, samples });
  res.json({ ok: true, updated });
});

// Web app: read today Apple totals
// GET /api/v1/wearables/apple/today?shopifyCustomerId=123
appleHealthRouter.get("/today", (req: Request, res: Response) => {
  const shopifyCustomerId = String(req.query.shopifyCustomerId || "").trim();
  if (!shopifyCustomerId) return res.status(400).json({ error: "Missing shopifyCustomerId" });

  const v = appleGetToday(shopifyCustomerId);
  res.json({ source: "apple_health", ...v });
});
