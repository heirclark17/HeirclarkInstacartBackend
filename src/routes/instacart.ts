// src/routes/instacart.ts
import express, { Request, Response } from "express";
import { asyncHandler } from "../middleware/asyncHandler";
import { sendSuccess, sendError, sendServerError } from "../middleware/responseHelper";
import { rateLimitMiddleware } from "../middleware/rateLimiter";

// Using Node 18+ global fetch
const router = express.Router();

// Apply rate limiting to all Instacart routes (10 requests per minute per IP)
router.use(rateLimitMiddleware({
  windowMs: 60000,
  maxRequests: 10,
  message: "Too many Instacart API requests, please try again later",
}));

/**
 * Instacart IDP API Configuration
 * See: https://docs.instacart.com/developer_platform_api/
 *
 * Base URL options:
 * - Production: https://connect.instacart.com (production API key required)
 * - Development: https://connect.dev.instacart.tools (for dev API keys - confirmed by Instacart support)
 * Set INSTACART_ENV=production in Railway when you have a production API key
 */
const INSTACART_BASE_URL = process.env.INSTACART_ENV === 'production'
  ? "https://connect.instacart.com"
  : "https://connect.dev.instacart.tools";
const INSTACART_API_KEY = process.env.INSTACART_API_KEY || "";

// Validate API key at startup
if (!INSTACART_API_KEY && process.env.NODE_ENV === "production") {
  console.warn("[Instacart] WARNING: INSTACART_API_KEY not set. Instacart routes will not work.");
}

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
 * Search for products on Instacart.
 *
 * Expected front-end call (from Shopify):
 *   POST { baseUrl }/api/instacart/search
 *   body: { query: "SALMON", retailerKey?: string | null, postalCode?: string }
 *
 * Response:
 *   {
 *     ok: true,
 *     data: {
 *       products: [ { name, price, price_display, size, web_url, retailer_name }, ... ],
 *       products_link_url: "https://www.instacart.com/store/..."
 *     }
 *   }
 */
router.post("/search", asyncHandler(async (req: Request, res: Response) => {
  const query = (req.body.query || "").toString().trim();
  if (!query) {
    return sendError(res, "Missing query", 400);
  }

  if (!INSTACART_API_KEY) {
    console.error("[Instacart] INSTACART_API_KEY is not set");
    return sendError(res, "Instacart integration not configured", 503);
  }

  // Optional parameters
  const retailerKey = req.body.retailerKey || null;
  const postalCode = req.body.postalCode || null;

  /**
   * Instacart IDP API - Product Search
   * See: https://docs.instacart.com/developer_platform_api/
   *
   * Uses the IDP v1 products endpoint for searching products
   */
  const searchUrl = new URL(`${INSTACART_BASE_URL}/idp/v1/products`);
  searchUrl.searchParams.set("query", query);
  searchUrl.searchParams.set("limit", "20");

  if (retailerKey) {
    searchUrl.searchParams.set("retailer_key", String(retailerKey));
  }
  if (postalCode) {
    searchUrl.searchParams.set("postal_code", String(postalCode));
  }

  try {
    const apiRes = await fetch(searchUrl.toString(), {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${INSTACART_API_KEY}`,
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
    });

    const text = await apiRes.text();
    let data: any = null;

    try {
      data = text ? JSON.parse(text) : null;
    } catch (e) {
      console.error("[Instacart] JSON parse error:", e);
      return sendError(res, "Invalid response from Instacart", 502);
    }

    if (!apiRes.ok) {
      console.error("[Instacart] Search error:", apiRes.status, text);

      // Handle specific error codes
      if (apiRes.status === 401) {
        return sendError(res, "Instacart authentication failed", 502);
      }
      if (apiRes.status === 429) {
        return sendError(res, "Instacart rate limit exceeded", 429);
      }

      return sendError(res, "Instacart search failed", 502);
    }

    // Try to find the list of products in common response formats
    const rawList: any[] =
      (Array.isArray(data?.products) && data.products) ||
      (Array.isArray(data?.items) && data.items) ||
      (Array.isArray(data?.results) && data.results) ||
      (Array.isArray(data?.data?.products) && data.data.products) ||
      [];

    const products = rawList
      .map((p: any) => mapProduct(p, query))
      .filter((p: any) => p !== null);

    // Compose a products_link_url for deep-linking
    const products_link_url: string | null =
      data?.products_link_url ||
      data?.link_url ||
      (products[0] && products[0].web_url) ||
      null;

    if (process.env.NODE_ENV !== "production") {
      console.log("[Instacart] search result keys:", data ? Object.keys(data) : []);
      console.log("[Instacart] mapped products count:", products.length);
    }

    return sendSuccess(res, {
      products,
      products_link_url,
      query,
      count: products.length,
    });
  } catch (err: any) {
    console.error("[Instacart] Unexpected error:", err);

    if (err.code === "ECONNREFUSED" || err.code === "ENOTFOUND") {
      return sendError(res, "Could not connect to Instacart", 502);
    }

    return sendServerError(res, "Failed to search Instacart");
  }
}));

/**
 * POST /instacart/products-link
 *
 * Create a products link for adding items to cart.
 * See: https://docs.instacart.com/connect/api/fulfillment/
 */
router.post("/products-link", asyncHandler(async (req: Request, res: Response) => {
  const { items, landingUrl, partnerId } = req.body;

  if (!items || !Array.isArray(items) || items.length === 0) {
    return sendError(res, "Missing or empty items array", 400);
  }

  if (!INSTACART_API_KEY) {
    return sendError(res, "Instacart integration not configured", 503);
  }

  try {
    // Instacart IDP API - Create products link
    // See: https://docs.instacart.com/developer_platform_api/
    const apiRes = await fetch(`${INSTACART_BASE_URL}/idp/v1/products/products_link`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${INSTACART_API_KEY}`,
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify({
        title: "Shopping List",
        line_items: items.map((item: any) => ({
          name: item.name || item.query,
          quantity: item.quantity || 1,
          unit: item.unit || "each",
        })),
        landing_page_configuration: {
          partner_linkback_url: landingUrl,
        },
      }),
    });

    const data = await apiRes.json();

    if (!apiRes.ok) {
      console.error("[Instacart] Products link error:", apiRes.status, data);
      return sendError(res, "Failed to create products link", 502);
    }

    return sendSuccess(res, {
      link_url: data.products_link_url || data.link_url,
      items_count: items.length,
    });
  } catch (err) {
    console.error("[Instacart] Products link error:", err);
    return sendServerError(res, "Failed to create Instacart link");
  }
}));

/**
 * GET /instacart/retailers
 *
 * Get available retailers for a location.
 */
router.get("/retailers", asyncHandler(async (req: Request, res: Response) => {
  const postalCode = req.query.postalCode as string;

  if (!postalCode) {
    return sendError(res, "Missing postalCode", 400);
  }

  if (!INSTACART_API_KEY) {
    return sendError(res, "Instacart integration not configured", 503);
  }

  try {
    // Note: Retailers endpoint may vary - check Instacart IDP documentation
    const apiRes = await fetch(
      `${INSTACART_BASE_URL}/idp/v1/retailers?postal_code=${encodeURIComponent(postalCode)}`,
      {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${INSTACART_API_KEY}`,
          "Accept": "application/json",
        },
      }
    );

    const data = await apiRes.json();

    if (!apiRes.ok) {
      console.error("[Instacart] Retailers error:", apiRes.status, data);
      return sendError(res, "Failed to fetch retailers", 502);
    }

    const retailers = (data.retailers || data.data || []).map((r: any) => ({
      key: r.retailer_key || r.key || r.id,
      name: r.name || r.retailer_name,
      logo_url: r.logo_url,
      delivery_eta: r.delivery_eta,
    }));

    return sendSuccess(res, { retailers, postalCode });
  } catch (err) {
    console.error("[Instacart] Retailers error:", err);
    return sendServerError(res, "Failed to fetch retailers");
  }
}));

export default router;
