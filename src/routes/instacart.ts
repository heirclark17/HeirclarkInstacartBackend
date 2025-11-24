// src/routes/instacart.ts
import express, { Request, Response } from "express";

const router = express.Router();

const INSTACART_BASE_URL =
  process.env.INSTACART_BASE_URL || "https://api.instacart.com"; // adjust to your real base
const INSTACART_API_KEY = process.env.INSTACART_API_KEY || "";

// Helper to normalize Instacart products into a shape the front-end expects
function mapInstacartProducts(rawData: any) {
  // Adjust these paths to match the actual Instacart response you get:
  const rawProducts =
    rawData?.products ||
    rawData?.items ||
    rawData?.results ||
    [];

  if (!Array.isArray(rawProducts)) return [];

  return rawProducts.map((p: any) => {
    const priceNumber =
      typeof p.price === "number"
        ? p.price
        : undefined;

    const priceDisplay =
      p.price_display ||
      (typeof p.price === "number"
        ? `$${p.price.toFixed(2)}`
        : undefined);

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
      // The front-end only cares about these keys:
      name: p.name || "",
      price: priceNumber ?? null,
      price_display: priceDisplay ?? null,
      size,
      web_url: webUrl,
      retailer_name: retailerName,
    };
  });
}

router.post("/instacart/search", async (req: Request, res: Response) => {
  try {
    const query = (req.body.query || "").toString().trim();
    if (!query) {
      return res.status(400).json({ success: false, error: "Missing query" });
    }

    // TODO: Replace this path + params with your actual Instacart search endpoint.
    // This is pseudo-code – plug in your real URL & params from the Instacart docs.
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
    } catch {
      console.error("[Instacart] Failed to parse JSON:", text);
    }

    if (!apiRes.ok) {
      console.error("[Instacart] Search error:", apiRes.status, text);
      return res.status(502).json({
        success: false,
        error: "Instacart search failed",
      });
    }

    // Normalize products for the modal
    const products = mapInstacartProducts(data);

    // OPTIONAL: some Instacart responses also have a "products_link_url"
    const productsLinkUrl =
      data?.products_link_url ||
      data?.url ||
      data?.product_url ||
      null;

    if (!products.length && !productsLinkUrl) {
      return res.json({
        success: true,
        products: [],
        products_link_url: null,
        message: `No results for "${query}"`,
      });
    }

    return res.json({
      success: true,
      products,
      products_link_url: productsLinkUrl,
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
