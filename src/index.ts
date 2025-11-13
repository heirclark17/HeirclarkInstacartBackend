// src/index.ts
import express, { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import {
  createInstacartProductsLink,
  InstacartLineItem,
  InstacartProductsLinkPayload
} from "./instacartClient";

const app = express();

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

    // Copy query params & remove signature
    const q: Record<string, unknown> = { ...req.query };
    const sig = String(q.signature || "");
    delete (q as any).signature;

    // Build ordered query string: key1=val1key2=val2...
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

// ---- Basic health check ----
app.get("/", (_req: Request, res: Response) => {
  res.status(200).json({ ok: true, service: "heirclark-instacart-backend" });
});

// ---- GET /proxy/build-list?ping=1 (simple JSON ping) ----
app.get("/proxy/build-list", (req: Request, res: Response) => {
  console.log("💓 /proxy/build-list GET ping", req.query);
  res.status(200).json({
    ok: true,
    via: "proxy",
    ping: req.query.ping ?? null
  });
});

// ---- POST /proxy/build-list (main Instacart shopping list generator) ----
app.post(
  "/proxy/build-list",
  verifyAppProxy,
  async (req: Request, res: Response) => {
    try {
      console.log(
        "📦 Incoming /proxy/build-list body:",
        JSON.stringify(req.body, null, 2)
      );

      const { items, recipeLandingUrl } = req.body || {};

      if (!Array.isArray(items) || items.length === 0) {
        console.error("No items array received");
        return res.status(400).json({ ok: false, error: "No items provided" });
      }

      // Map your generic items → Instacart LineItem format
      const lineItems: InstacartLineItem[] = items.map((item: any) => {
        const name = String(item.name || "").trim() || "item";
        const quantity = item.quantity != null ? Number(item.quantity) : 1;
        const unit = String(item.unit || "each");

        const lineItem: InstacartLineItem = {
          name,
          quantity: quantity > 0 ? quantity : 1,
          unit,
          display_text: item.display_text || `${quantity} ${unit} ${name}`.trim()
        };

        if (Array.isArray(item.upcs) && item.upcs.length > 0) {
          lineItem.upcs = item.upcs;
        }
        if (item.filters) {
          lineItem.filters = item.filters;
        }

        return lineItem;
      });

      const partnerLink =
        recipeLandingUrl || "https://heirclark.com/pages/7-day-nutrition-plan";

      const productsLinkPayload: InstacartProductsLinkPayload = {
        title: "Your Heirclark 7-Day Plan",
        image_url: undefined,
        // let Instacart default link_type to "shopping_list" if omitted,
        // or explicitly set it:
        link_type: "shopping_list",
        instructions: [
          "Review your list, choose your store, and check out on Instacart."
        ],
        line_items: lineItems,
        landing_page_configuration: {
          partner_linkback_url: partnerLink
        }
      };

      console.log(
        "🚀 Calling Instacart /products_link with payload:",
        JSON.stringify(productsLinkPayload, null, 2)
      );

      const instacartResp = await createInstacartProductsLink(
        productsLinkPayload
      );

      console.log(
        "✅ Instacart products_link response object:",
        instacartResp
      );

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
      console.error("❌ Error in POST /proxy/build-list:", err);
      return res.status(500).json({
        ok: false,
        error: err?.message || "Unknown server error"
      });
    }
  }
);

// ---- Start server ----
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Instacart backend listening on port ${PORT}`);
});
