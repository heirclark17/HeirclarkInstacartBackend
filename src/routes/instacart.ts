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
  const { items, landingUrl, partnerId, title } = req.body;

  if (!items || !Array.isArray(items) || items.length === 0) {
    return sendError(res, "Missing or empty items array", 400);
  }

  if (!INSTACART_API_KEY) {
    return sendError(res, "Instacart integration not configured", 503);
  }

  console.log("[Instacart] Creating products link with", items.length, "items");

  try {
    // Instacart IDP API - Create products link
    // See: https://docs.instacart.com/developer_platform_api/
    const lineItems = items.map((item: any) => ({
      name: item.name || item.query,
      quantity: item.quantity || 1,
      unit: item.unit || "each",
    }));

    console.log("[Instacart] Line items:", JSON.stringify(lineItems, null, 2));

    // Build request body - only include landing_page_configuration if landingUrl is provided
    const requestBody: any = {
      title: title || "Shopping List",
      line_items: lineItems,
    };

    if (landingUrl) {
      requestBody.landing_page_configuration = {
        partner_linkback_url: landingUrl,
      };
    }

    console.log("[Instacart] Request body:", JSON.stringify(requestBody, null, 2));

    const apiRes = await fetch(`${INSTACART_BASE_URL}/idp/v1/products/products_link`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${INSTACART_API_KEY}`,
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    const data = await apiRes.json();
    console.log("[Instacart] API response:", JSON.stringify(data, null, 2));

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

/**
 * POST /instacart/day-plan
 *
 * Generate a single-day AI meal plan with multilingual support.
 * Called from Shopify app proxy: /apps/instacart/day-plan
 */
router.post("/day-plan", asyncHandler(async (req: Request, res: Response) => {
  const { constraints, day } = req.body;

  if (!constraints || !day) {
    return sendError(res, "Missing constraints or day", 400);
  }

  const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
  const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

  if (!OPENAI_API_KEY) {
    return sendError(res, "AI meal planning not configured", 503);
  }

  // Extract constraints
  const dailyCalories = constraints.dailyCalories || 2000;
  const proteinGrams = constraints.proteinGrams || 150;
  const carbsGrams = constraints.carbsGrams || 150;
  const fatsGrams = constraints.fatsGrams || 60;
  const language = constraints.language || "en";

  // Map language codes to full language names
  const languageNames: Record<string, string> = {
    en: "English",
    es: "Spanish",
    fr: "French",
    de: "German",
    "pt-BR": "Portuguese",
    it: "Italian",
    ja: "Japanese",
    ko: "Korean",
    "zh-CN": "Chinese (Simplified)",
    "zh-TW": "Chinese (Traditional)",
  };

  const languageName = languageNames[language] || "English";

  // Extract day info
  const dayIndex = day.dayIndex || 1;
  const dayLabel = day.label || `Day ${dayIndex}`;
  const meals = day.meals || [];

  // Build AI prompt with language support
  const systemPrompt = `You are a meal planning expert. Generate meals for ONE day in ${languageName}. Return ONLY valid JSON with NO markdown code blocks.

CRITICAL REQUIREMENTS:
- ALL text (meal names, descriptions, ingredients, instructions) MUST be in ${languageName}
- Use culturally appropriate dish names for ${languageName} speakers
- Return ONLY the JSON structure below, no explanations

{
  "day": {
    "dayIndex": ${dayIndex},
    "label": "${dayLabel}",
    "isoDate": "${day.isoDate || ""}",
    "meals": [
      {
        "type": "breakfast",
        "title": "Meal name in ${languageName}",
        "name": "Meal name in ${languageName}",
        "description": "Description in ${languageName}",
        "calories": 500,
        "protein": 30,
        "carbs": 50,
        "fat": 15,
        "servings": 1,
        "ingredients": [
          {
            "name": "Ingredient in ${languageName}",
            "quantity": 1,
            "unit": "cup"
          }
        ],
        "instructions": ["Step 1 in ${languageName}", "Step 2 in ${languageName}"]
      }
    ]
  },
  "recipes": []
}`;

  const userPrompt = `Generate a healthy day plan with these targets:
- Calories: ${dailyCalories}
- Protein: ${proteinGrams}g
- Carbs: ${carbsGrams}g
- Fat: ${fatsGrams}g

Include ${meals.length} meals: ${meals.map((m: any) => m.type).join(", ")}

Each meal should have:
- Target calories from meal distribution
- 5-8 ingredients with quantities
- 3-5 cooking steps

Remember: ALL content in ${languageName}.`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.7,
        max_tokens: 3000,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[Instacart] OpenAI error:", response.status, errorText);
      return sendError(res, "AI generation failed", 502);
    }

    const data = await response.json();
    let content = data.choices?.[0]?.message?.content || "";

    // Clean markdown code blocks if present
    if (content.startsWith("```")) {
      content = content.replace(/```json?\n?/g, "").replace(/```$/g, "");
    }

    const parsed = JSON.parse(content.trim());

    return sendSuccess(res, {
      day: parsed.day,
      recipes: parsed.recipes || [],
    });
  } catch (err: any) {
    console.error("[Instacart] Day plan generation error:", err);

    if (err.name === "AbortError") {
      return sendError(res, "Request timeout", 504);
    }

    return sendServerError(res, "Failed to generate day plan");
  }
}));

export default router;
