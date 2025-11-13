// src/index.ts
import express, { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { createInstacartRecipe, InstacartIngredient } from "./instacartClient";

const app = express();

// Parse JSON & x-www-form-urlencoded
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ---- Shopify App Proxy verification ----
function verifyAppProxy(req: Request, res: Response, next: NextFunction) {
  try {
    const secret = process.env.SHOPIFY_API_SECRET;
    if (!secret) {
      console.error("Missing SHOPIFY_API_SECRET");
      return res.status(500).json({ ok: false, error: "Missing SHOPIFY_API_SECRET" });
    }

    const q: Record<string, unknown> = { ...req.query };
    const sig = String(q.signature || "");
    delete (q as any).signature;

    const ordered = Object.keys(q)
      .sort()
      .map((k) => {
        const v = q[k];
        return `${k}=${Array.isArray(v) ? v.join(",") : (v ?? "").toString()}`;
      })
      .join("");

    const hmac = crypto
      .createHmac("sha256", secret)
      .update(ordered, "utf8")
      .digest("hex");

    if (sig !== hmac) {
      console.error("App proxy signature mismatch");
      return res.status(401).json({ ok: false, error: "Bad signature" });
    }

    next();
  } catch (err) {
    console.error("verifyAppProxy error:", err);
    return res.status(500).json({ ok: false, error: "App proxy verification failed" });
  }
}

// ---- Simple health root (optional) ----
app.get("/", (_req: Request, res: Response) => {
  res.status(200).json({ ok: true, service: "heirclark-instacart-backend" });
});

// ---- GET /proxy/build-list: quick ping from store (no HMAC) ----
app.get("/proxy/build-list", (req: Request, res: Response) => {
  res.status(200).json({
    ok: true,
    via: "app-proxy",
    ping: req.query.ping ?? null
  });
});

// ---- POST /proxy/build-list: main Instacart recipe generator ----
app.post("/proxy/build-list", verifyAppProxy, async (req: Request, res: Response) => {
  try {
    console.log("Incoming /proxy/build-list body:", JSON.stringify(req.body, null, 2));

    const { items, recipeLandingUrl } = req.body || {};

    if (!Array.isArray(items) || items.length === 0) {
      console.error("No items array received");
      return res.status(400).json({ ok: false, error: "No items provided" });
    }

    // Map your "items" to Instacart ingredients[]
    const ingredients: InstacartIngredient[] = items.map((item: any) => {
      const name = String(item.name || "").trim() || "item";
      const quantity = Number(item.quantity) || 1;
      const unit = String(item.unit || "each");

      return {
        name, // used as Instacart search term
        display_text: `${quantity} ${unit} ${name}`.trim(),
        measurements: [
          {
            quantity,
            unit
          }
        ]
      };
    });

    const partnerLink = recipeLandingUrl || "https://heirclark.com/pages/your-7-day-plan";

    const payload = {
      title: "Your Heirclark 7-Day Plan",
      servings: 1,
      ingredients,
      landing_page_configuration: {
        partner_linkback_url: partnerLink,
        enable_pantry_items: true
      }
    };

    console.log("Calling Instacart with payload:", JSON.stringify(payload, null, 2));

    const instacartResp = await createInstacartRecipe(payload);

    console.log("Instacart response:", JSON.stringify(instacartResp, null, 2));

    if (!instacartResp.products_link_url) {
      return res.status(502).json({
        ok: false,
        error: "Instacart did not return a products_link_url",
        instacart: instacartResp
      });
    }

    return res.status(200).json({
      ok: true,
      products_link_url: instacartResp.products_link_url
    });
  } catch (err: any) {
    console.error("Error in POST /proxy/build-list:", err);
    return res.status(500).json({
      ok: false,
      error: err?.message || "Unknown server error"
    });
  }
});

// ---- Start server ----
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Instacart backend listening on port ${PORT}`);
});
