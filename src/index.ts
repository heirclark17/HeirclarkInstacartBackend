// src/index.ts
import express, { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { createInstacartRecipe } from "./instacartClient";

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ---- existing verifyAppProxy (you already had something like this) ----
function verifyAppProxy(req: Request, res: Response, next: NextFunction) {
  try {
    const secret = process.env.SHOPIFY_API_SECRET;
    if (!secret) {
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
      return res.status(401).send("Bad signature");
    }

    next();
  } catch (err) {
    console.error("verifyAppProxy error", err);
    return res.status(500).send("App proxy verification failed");
  }
}

// ---- GET for quick ping (optional) ----
app.get("/proxy/build-list", (req: Request, res: Response) => {
  res.status(200).json({
    ok: true,
    via: "app-proxy",
    ping: req.query.ping ?? null
  });
});

// ---- POST: main Instacart recipe endpoint used by your theme ----
app.post("/proxy/build-list", verifyAppProxy, async (req: Request, res: Response) => {
  try {
    // This is the payload from your hc-instacart.js
    const { start, plan, recipeLandingUrl, items } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        ok: false,
        error: "No items provided"
      });
    }

    // Map your "items" into Instacart ingredients[]
    const ingredients = items.map((item: any) => {
      const quantity = Number(item.quantity) || 1;
      const unit = item.unit || "each";
      const name = item.name || "item";

      return {
        name, // search term
        display_text: `${quantity} ${unit} ${name}`.trim(),
        measurements: [
          {
            quantity,
            unit
          }
        ]
      };
    });

    // Build Instacart recipe payload
    const payload = {
      title: "Your Heirclark 7-Day Plan",
      servings: 1,
      ingredients,
      landing_page_configuration: {
        partner_linkback_url: recipeLandingUrl || "https://heirclark.com/pages/your-7-day-plan",
        enable_pantry_items: true
      }
    };

    const instacartResp = await createInstacartRecipe(payload);

    if (!instacartResp.products_link_url) {
      return res.status(502).json({
        ok: false,
        error: "Instacart did not return a products_link_url",
        instacart: instacartResp
      });
    }

    // Return a simple, front-end-friendly response
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

// ---- rest of your app / listener ----
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Backend listening on port ${PORT}`);
});
