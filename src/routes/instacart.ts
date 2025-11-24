// src/routes/instacart.ts
import express, { Request, Response } from "express";

// Using Node 18+ global fetch
const router = express.Router();

// Base URL and API key for Instacart – configure these in Railway
const INSTACART_BASE_URL =
  process.env.INSTACART_BASE_URL || "https://api.instacart.com"; // TODO: set your real base
const INSTACART_API_KEY = process.env.INSTACART_API_KEY || "";

/**
 * Helper: map one raw Instacart product into the shape
 * the front-end (modal + calculator) expects.
 */
function mapProduct(raw: any, fallbackQuery: string) {
  if (!raw) return null;

  // ----- NAME -----
  const name: string = (raw.name || raw.title || fallbackQuery || "").toString();

  // ----- PRICE (NUMBER) -----
  let priceNumber: number | null = null;

  // 1) direct numeric price
  if (typeof raw.price === "number") {
    priceNumber = raw.price;
  }

  // 2) other numeric price fields
  else if (typeof raw.unit_price === "number") {
    priceNumber = raw.unit_price;
  } else if (typeof raw.base_price === "number") {
    priceNumber = raw.base_price;
  } else if (typeof raw.current_price === "number") {
    priceNumber = raw.current_price;
  }

  // 3) price in cents
  else if (typeof raw.price_in_cents === "number") {
    priceNumber = raw.price_in_cents / 100;
  }

  // 4) nested object like { amount: 12.34 }
  else if (raw.current_price && typeof raw.current_price.amount === "number") {
    priceNumber = raw.current_price.amount;
  }

  // 5) "9.99" or "$9.99" as string
  else if (typeof raw.price === "string") {
    const parsed = parseFloat(raw.price.replace(/[^\d.]/g, ""));
    if (Number.isFinite(parsed)) priceNumber = parsed;
  } else if (typeof raw.unit_price === "string") {
    const parsed = parseFloat(raw.unit_price.replace(/[^\d.]/g, ""));
    if (Number.isFinite(parsed)) priceNumber = parsed;
  }

  // ----- PRICE (DISPLAY STRING) -----
  let priceDisplay: string | null = null;

  if (typeof raw.price_display === "string" && raw.price_display.trim()) {
    priceDisplay = raw.price_display;
  } else if (typeof raw.price_text === "string" && raw.price_text.trim()) {
    priceDisplay = raw.price_text;
  } else if (typeof raw.display_price === "string" && raw.display_price.trim()) {
    priceDisplay = raw.display_price;
  } else if (typeof raw.price === "string" && raw.price.trim()) {
    priceDisplay = raw.price;
  } else if (typeof priceNumber === "number") {
    priceDisplay = `$${priceNumber.toFixed(2)}`;
  } else {
    priceDisplay = null;
  }

  // ----- SIZE / WEIGHT -----
  const size: string =
    raw.size ||
    raw.package_size ||
    raw.unit_size ||
    raw.quantity_text ||
    raw.package_text ||
    "";

  // ----- PRODUCT URL -----
  const webUrl: string | null =
    raw.web_url ||
    raw.url ||
    raw.product_url ||
    raw.product_details_page_url ||
    null;

  // ----- RETAILER NAME -----
  const retailerName: string =
    raw.retailer_name ||
    raw.store_name ||
    raw.retailer ||
    "";

  return {
    name,
    price: priceNumber,
    price_display: priceDisplay,
    size,
    web_url: webUrl,
    retailer_name: retailerName,
  };
}

/**
 * POST /instacart/search
 *
 * Expected front-end call (from Shopify):
 *   POST { baseUrl }/api/instacart/search
 *   body: { query: "SALMON", retailerKey?: string | null, recipeLandingUrl?: string }
 *
 * Response:
 *   {
 *     success: true,
 *     products: [ { name, price, price_display, size, web_url, retailer_name }, ... ],
 *     products_link_url: "https://www.instacart.com/store/..."
 *   }
 */
router.post("/instacart/search", async (req: Request, res: Response) => {
  try {
    const query = (req.body.query || "").toString().trim();
    if (!query) {
      return res.status(400).json({ success: false, error: "Missing query" });
    }

    // Optional extras from front-end – not strictly required here,
    // but you can plumb them into the Instacart call if needed.
    const retailerKey = req.body.retailerKey || null;
    const recipeLandingUrl = req.body.recipeLandingUrl || null;

    if (!INSTACART_API_KEY) {
      console.error("[Instacart] INSTACART_API_KEY is not set");
      return res.status(500).json({
        success: false,
        error: "Instacart configuration missing",
      });
    }

    // TODO: Replace this with your real Instacart Developer endpoint + query params
    // This is pseudo – check Instacart docs for the correct path.
    const searchUrl = new URL(
      `${INSTACART_BASE_URL}/products/search`
    );
    searchUrl.searchParams.set("q", query);
    if (retailerKey) {
      searchUrl.searchParams.set("retailer_key", String(retailerKey));
    }
    if (recipeLandingUrl) {
      searchUrl.searchParams.set("landing_url", String(recipeLandingUrl));
    }

    const apiRes = await fetch(searchUrl.toString(), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${INSTACART_API_KEY}`,
        "Content-Type": "application/json",
      },
    });

    const text = await apiRes.text();
    let data: any = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch (e) {
      console.error("[Instacart] JSON parse error:", e);
    }

    if (!apiRes.ok) {
      console.error("[Instacart] Search error:", apiRes.status, text);
      return res
        .status(502)
        .json({ success: false, error: "Instacart search failed" });
    }

    // Try to find the list of products in common keys
    const rawList: any[] =
      (Array.isArray(data?.products) && data.products) ||
      (Array.isArray(data?.items) && data.items) ||
      (Array.isArray(data?.results) && data.results) ||
      [];

    const products = rawList
      .map((p: any) => mapProduct(p, query))
      .filter((p: any) => p !== null);

    // Compose a products_link_url for deep-linking
    const products_link_url: string | null =
      data?.products_link_url ||
      (products[0] && products[0].web_url) ||
      null;

    // Helpful debug log – you can comment this out once stable
    console.log("[Instacart] search result keys:", data ? Object.keys(data) : []);
    console.log(
      "[Instacart] mapped products count:",
      products.length,
      "products_link_url:",
      products_link_url
    );

    return res.json({
      success: true,
      products,
      products_link_url,
    });
  } catch (err) {
    console.error("[Instacart] Unexpected error:", err);
    return res
      .status(500)
      .json({ success: false, error: "Server error" });
  }
});

export default router;
