// src/routes/instacart.ts
import express, { Request, Response } from "express";
// Node 18+ global fetch

const router = express.Router();

const INSTACART_BASE_URL =
  process.env.INSTACART_BASE_URL || "https://api.instacart.com";
const INSTACART_API_KEY = process.env.INSTACART_API_KEY || "";

// Helper to normalize price into a number
function normalizePrice(raw: any): number | null {
  if (raw == null) return null;
  if (typeof raw === "number") return raw;
  const asStr = String(raw);
  const parsed = parseFloat(asStr.replace(/[^\d.]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

router.post("/instacart/search", async (req: Request, res: Response) => {
  try {
    const query = (req.body.query || "").toString().trim();
    if (!query) {
      return res.status(400).json({ success: false, error: "Missing query" });
    }

    if (!INSTACART_API_KEY) {
      return res.status(500).json({
        success: false,
        error: "Instacart API key is not configured on the server",
      });
    }

    // TODO: Replace with your real Instacart search endpoint.
    // This path + params are PSEUDO and must match your developer docs.
    const url = `${INSTACART_BASE_URL}/products/search?q=${encodeURIComponent(
      query
    )}`;

    const apiRes = await fetch(url, {
      headers: {
        Authorization: `Bearer ${INSTACART_API_KEY}`,
        "Content-Type": "application/json",
      },
    });

    if (!apiRes.ok) {
      const text = await apiRes.text().catch(() => "");
      console.error("[Instacart] Search error:", apiRes.status, text);
      return res.status(502).json({
        success: false,
        error: "Instacart search failed",
      });
    }

    const data: any = await apiRes.json().catch(() => ({}));

    const rawResults: any[] = Array.isArray(data?.results)
      ? data.results
      : Array.isArray(data?.items)
      ? data.items
      : [];

    // Take the first 12 products & normalize
    const products = rawResults.slice(0, 12).map((p) => {
      const priceRaw =
        p.price ??
        p.unit_price ??
        p.retail_price ??
        p.pricing?.price ??
        null;

      const priceNumber = normalizePrice(priceRaw);
      const priceDisplay =
        typeof priceRaw === "string"
          ? priceRaw
          : priceNumber != null
          ? `$${priceNumber.toFixed(2)}`
          : null;

      return {
        id: p.id ?? p.product_id ?? null,
        name: p.name ?? query,
        size: p.package_size ?? p.size ?? p.unit_size ?? null,
        price: priceNumber, // numeric for math
        price_display: priceDisplay, // pretty string for UI
        currency: p.currency ?? "USD",
        web_url: p.web_url ?? p.url ?? p.product_url ?? null,
      };
    });

    return res.json({
      success: true,
      query,
      products,
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
