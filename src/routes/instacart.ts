// src/routes/instacart.ts
import express, { Request, Response } from "express";

const router = express.Router();

const INSTACART_BASE_URL =
  process.env.INSTACART_BASE_URL || "https://api.instacart.com"; // TODO: set your real base
const INSTACART_API_KEY = process.env.INSTACART_API_KEY || "";

/**
 * Map one Instacart product object into the shape your front end expects.
 */
function mapProduct(raw: any, fallbackQuery: string) {
  if (!raw) return null;

  const name: string = (raw.name || raw.title || fallbackQuery || "").toString();

  let priceNumber: number | null = null;
  if (typeof raw.price === "number") {
    priceNumber = raw.price;
  }

  const priceDisplay: string | null =
    raw.price_display ||
    (typeof raw.price === "number" ? `$${raw.price.toFixed(2)}` : null) ||
    null;

  const size: string =
    raw.size ||
    raw.package_size ||
    raw.unit_size ||
    raw.quantity_text ||
    "";

  const webUrl: string | null =
    raw.web_url ||
    raw.url ||
    raw.product_url ||
    raw.product_details_page_url ||
    null;

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

router.post("/instacart/search", async (req: Request, res: Response) => {
  try {
    const query = (req.body.query || "").toString().trim();
    if (!query) {
      return res.status(400).json({ success: false, error: "Missing query" });
    }

    // TODO: swap this for your actual Instacart endpoint + params
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
      console.error("[Instacart] JSON parse error:", e);
    }

    if (!apiRes.ok) {
      console.error("[Instacart] Search error:", apiRes.status, text);
      return res
        .status(502)
        .json({ success: false, error: "Instacart search failed" });
    }

    // Adjust these keys to match your actual Instacart payload:
    const rawList: any[] =
      (Array.isArray(data?.products) && data.products) ||
      (Array.isArray(data?.items) && data.items) ||
      (Array.isArray(data?.results) && data.results) ||
      [];

    const products = rawList
      .map((p: any) => mapProduct(p, query))
      .filter((p: any) => p !== null);

    // If we still don't have any products but backend gave us a link, at least return that
    const products_link_url: string | null =
      data?.products_link_url ||
      (products[0] && products[0].web_url) ||
      null;

    return res.json({
      success: true,
      products,          // 👈 this is what your modal + calculator use
      products_link_url, // 👈 still keep this for deep-link fallback
    });
  } catch (err) {
    console.error("[Instacart] Unexpected error:", err);
    return res
      .status(500)
      .json({ success: false, error: "Server error" });
  }
});

export default router;
