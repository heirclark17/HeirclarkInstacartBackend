// src/routes/instacart.ts
import express, { Request, Response } from "express";

const router = express.Router();

const INSTACART_BASE_URL =
  process.env.INSTACART_BASE_URL || "https://api.instacart.com"; // adjust to your real base
const INSTACART_API_KEY = process.env.INSTACART_API_KEY || "";

// Helper: normalize a single Instacart product into the shape the front-end expects
function mapSingleProduct(p: any, fallbackQuery: string) {
  if (!p) return null;

  const name = (p.name || fallbackQuery || "").toString();

  // Try to find a numeric price
  let priceNumber: number | null = null;
  if (typeof p.price === "number") {
    priceNumber = p.price;
  }

  const priceDisplay =
    p.price_display ||
    (typeof p.price === "number" ? `$${p.price.toFixed(2)}` : null) ||
    null;

  const size =
    p.size ||
    p.package_size ||
    p.unit_size ||
    "";

  const webUrl =
    p.web_url ||
    p.url ||
    p.product_url ||
    null;

  const retailerName =
    p.retailer_name ||
    p.store_name ||
    p.retailer ||
    "";

  return {
    // These keys are what hc-instacart-bridge.js looks for:
    name,
    price: priceNumber,
    price_display: priceDisplay,
    size,
    web_url: webUrl,
    retailer_name: retailerName,
  };
}

router.post("/instacart/search", async (req: Request, res: Response) => {
  try {
    const query = (req.body.query || "").toString().trim();
    if (!query) {
      return res.status(400).json({ success: false, error: "Missing query" });
    }

    // TODO: Replace this with your real Instacart search endpoint + params
    const url = `${INSTACART_BASE_URL}/products/search?q=${encodeURIComponent(
      query
    )}`;

    const apiRes = await fetch(url, {
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
      console.error("[Instacart] Failed to parse JSON:", e);
    }

    if (!apiRes.ok) {
      console.error("[Instacart] Search error:", apiRes.status, text);
      return res.status(502).json({
        success: false,
        error: "Instacart search failed",
      });
    }

    // Try to find the "first" product in the response, using same logic you had
    const first =
      data?.results?.[0] ||
      data?.items?.[0] ||
      data?.products?.[0] ||
      null;

    if (!first) {
      return res.json({
        success: true,
        products: [],
        products_link_url: null,
        message: `No results for "${query}"`,
      });
    }

    const mapped = mapSingleProduct(first, query);
    const products = mapped ? [mapped] : [];

    // Keep a top-level link field as well (optional)
    const productUrl =
      mapped?.web_url ||
      data?.products_link_url ||
      data?.url ||
      data?.product_url ||
      null;

    return res.json({
      success: true,
      products,           // ✅ this is what the modal looks for
      products_link_url: productUrl, // optional fallback
    });
  } catch (err) {
    console.error("[Instacart] Unexpected error:", err);
    return res.status(500).json({
      success: false,
      error: "Server error",
    });
  }
});

export default router;
