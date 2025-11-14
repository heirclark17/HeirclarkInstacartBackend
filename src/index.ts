// src/index.ts
import express, { Request, Response, NextFunction } from "express";
import crypto from "crypto";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Root health
app.get("/", (_req: Request, res: Response) => {
  res.status(200).json({ ok: true, service: "heirclark-backend" });
});

// OPEN GET ping for app proxy (debug)
app.get("/proxy/build-list", (req: Request, res: Response) => {
  res.status(200).json({
    ok: true,
    via: "app-proxy",
    ping: req.query.ping ?? null,
  });
});

// --- HMAC verification for App Proxy POST ---
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
      .map((k) =>
        `${k}=${
          Array.isArray(q[k])
            ? (q[k] as any[]).join(",")
            : (q[k] ?? "").toString()
        }`
      )
      .join("");

    const hmac = crypto.createHmac("sha256", secret).update(ordered, "utf8").digest("hex");

    if (sig !== hmac) {
      return res.status(401).json({ ok: false, error: "Bad signature" });
    }

    next();
  } catch (err) {
    console.error("verifyAppProxy error", err);
    return res.status(500).json({ ok: false, error: "verifyAppProxy crashed" });
  }
}

// Types for the incoming payload from hc-seven-day-plan.js
interface HcItem {
  name: string;
  quantity?: number;
  unit?: string;
  category?: string;
  pantry?: boolean;
  displayText?: string;
  productIds?: number[];
  upcs?: string[];
  measurements?: Array<{ quantity?: number; unit?: string }>;
  filters?: {
    brand_filters?: string[];
    health_filters?: string[];
  };
}

interface HcRequestBody {
  meta?: any;
  days?: any[];
  items?: HcItem[];
  lineItems?: HcItem[];
  recipeLandingUrl?: string;
}

// POST from Shopify app proxy – now calls Instacart
app.post("/proxy/build-list", verifyAppProxy, async (req: Request, res: Response) => {
  try {
    const apiKey = process.env.INSTACART_API_KEY;
    if (!apiKey) {
      console.error("Missing INSTACART_API_KEY");
      return res.status(500).json({ ok: false, error: "Missing INSTACART_API_KEY" });
    }

    const body = req.body as HcRequestBody;
    console.log("POST /proxy/build-list body:", JSON.stringify(body));

    const items: HcItem[] = Array.isArray(body.items) ? body.items : [];
    const lineItemsSource: HcItem[] = Array.isArray(body.lineItems) && body.lineItems.length
      ? body.lineItems
      : items;

    if (!lineItemsSource.length) {
      return res.status(400).json({
        ok: false,
        error: "No lineItems or items provided from frontend.",
      });
    }

    // Map Heirclark items -> Instacart LineItem objects
    const instacartLineItems = lineItemsSource
      .filter((i) => i && i.name)
      .map((item) => ({
        name: item.name,
        quantity: typeof item.quantity === "number" && item.quantity > 0 ? item.quantity : 1,
        unit: item.unit || "each",
        display_text: item.displayText || item.name,
        product_ids: item.productIds,
        upcs: item.upcs,
        line_item_measurements: item.measurements?.map((m) => ({
          quantity: typeof m.quantity === "number" && m.quantity > 0 ? m.quantity : 1,
          unit: m.unit || "each",
        })),
        filters: item.filters,
      }));

    if (!instacartLineItems.length) {
      return res.status(400).json({
        ok: false,
        error: "No valid line items after mapping.",
      });
    }

    const partnerLinkbackUrl = body.recipeLandingUrl;

    // Build Instacart request body (Create Shopping List Page)
    const instacartBody: any = {
      title: "Heirclark 7-Day Nutrition Plan",
      link_type: "shopping_list",
      instructions: [
        "Built from your Heirclark Wellness Plan 7-day nutrition recommendations.",
      ],
      line_items: instacartLineItems,
    };

    if (partnerLinkbackUrl) {
      instacartBody.landing_page_configuration = {
        partner_linkback_url: partnerLinkbackUrl,
      };
    }

    // Call Instacart /idp/v1/products/products_link
    const instacartResp = await fetch(
      "https://connect.instacart.com/idp/v1/products/products_link",
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(instacartBody),
      }
    );

    const instacartText = await instacartResp.text();
    let instacartData: any;
    try {
      instacartData = JSON.parse(instacartText);
    } catch {
      instacartData = null;
    }

    console.log("Instacart response status:", instacartResp.status);
    console.log("Instacart response body:", instacartText);

        if (!instacartResp.ok) {
      // Try to pull a useful error message from Instacart's response
      let message = "";

      if (typeof instacartData === "string") {
        message = instacartData;
      } else if (instacartData && typeof instacartData === "object") {
        message =
          (instacartData.error as string) ||
          (instacartData.message as string) ||
          (Array.isArray(instacartData.errors) && instacartData.errors[0]?.message) ||
          JSON.stringify(instacartData).slice(0, 200);
      }

      if (!message) {
        message = `HTTP ${instacartResp.status}`;
      }

      return res.status(instacartResp.status).json({
        ok: false,
        error: `Instacart: ${message}`,
        status: instacartResp.status,
        details: instacartData || instacartText,
      });
    }


    const productsLinkUrl = instacartData?.products_link_url;
    if (!productsLinkUrl) {
      return res.status(500).json({
        ok: false,
        error: "Instacart did not return products_link_url",
        details: instacartData || instacartText,
      });
    }

    // ✅ Shape your frontend already expects
    return res.status(200).json({
      ok: true,
      products_link_url: productsLinkUrl,
    });
  } catch (err) {
    console.error("Handler error in /proxy/build-list:", err);
    return res.status(500).json({
      ok: false,
      error: "Server error in /proxy/build-list",
    });
  }
});

app.listen(PORT, () => {
  console.log(`Heirclark Instacart backend listening on port ${PORT}`);
});
