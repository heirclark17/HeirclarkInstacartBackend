import "dotenv/config";
import express, { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { createProductsLink } from "./instacart";

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const PORT = Number(process.env.PORT || 8080);
const SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET!;

/** Shopify App Proxy HMAC verifier (query signature) */
function verifyAppProxy(req: Request, res: Response, next: NextFunction) {
  const q = { ...req.query } as Record<string, unknown>;
  const sig = String(q.signature || "");
  delete (q as any).signature;

  const ordered = Object.keys(q)
    .sort()
    .map((k) => `${k}=${Array.isArray((q as any)[k]) ? (q as any)[k].join(",") : String((q as any)[k] ?? "")}`)
    .join("");

  const hmac = crypto.createHmac("sha256", SHOPIFY_API_SECRET).update(ordered, "utf8").digest("hex");
  if (sig !== hmac) return res.status(401).json({ error: "Bad signature" });
  next();
}

/** Health check */
app.get("/api/health", (_req, res) => res.json({ ok: true }));

/**
 * Public route for Shopify App Proxy:
 * GET /apps/instacart/build-list
 * - Accepts optional ?demo=1 to use sample items
 * - In production, POST your real 7-day plan ingredients to /api/products-link instead.
 */
app.get("/proxy/build-list", verifyAppProxy, async (req, res) => {
  try {
    const demo = String(req.query.demo || "") === "1";

    // In your real flow, build these from your 7-day plan:
    const line_items = demo
      ? [
          { name: "Salmon fillet", quantity: 2, unit: "lb" },
          { name: "Quinoa", quantity: 1, unit: "lb" },
          {
            name: "Flour",
            line_item_measurements: [
              { quantity: 1, unit: "cup" },
              { quantity: 16, unit: "tbsp" } // multiple measurement example
            ]
          }
        ]
      : []; // if not demo, expect your frontend to call the POST route below

    if (!line_items.length) {
      return res.status(400).json({ error: "No items. Use ?demo=1 or POST to /api/products-link." });
    }

    const { url } = await createProductsLink({ line_items });
    return res.json({ url });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "Failed to build Instacart list" });
  }
});

/** JSON API you can call from your theme/app to generate a list from real items */
app.post("/api/products-link", async (req, res) => {
  try {
    const { line_items } = req.body || {};
    if (!Array.isArray(line_items) || line_items.length === 0) {
      return res.status(400).json({ error: "line_items[] required" });
    }

    const { url } = await createProductsLink({ line_items });
    res.json({ url });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to create Instacart link" });
  }
});

app.listen(PORT, () => {
  console.log(`🔥 Heirclark Instacart backend running on port ${PORT}`);
});
