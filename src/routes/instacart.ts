// src/routes/instacart.ts
import express, { Request, Response } from "express";
// NOTE: No node-fetch import – we use the global fetch from Node 18+

const router = express.Router();

const INSTACART_BASE_URL =
  process.env.INSTACART_BASE_URL || "https://api.instacart.com"; // or your dev base
const INSTACART_API_KEY = process.env.INSTACART_API_KEY || "";

router.post("/instacart/search", async (req: Request, res: Response) => {
  try {
    const query = (req.body.query || "").toString().trim();
    if (!query) {
      return res.status(400).json({ success: false, error: "Missing query" });
    }

    // TODO: Replace this with the *actual* Instacart Developer search endpoint you use.
    // This is PSEUDO-CODE – plug in the real path + params from your Instacart docs.
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
      const text = await apiRes.text();
      console.error("[Instacart] Search error:", apiRes.status, text);
      return res.status(502).json({
        success: false,
        error: "Instacart search failed",
      });
    }

    const data = await apiRes.json();

    // You need to adjust this shape based on Instacart’s response format.
    const first = data?.results?.[0] || data?.items?.[0] || null;

    if (!first) {
      return res.json({
        success: true,
        url: null,
        message: `No results for "${query}"`,
      });
    }

    // Whatever field is the web URL:
    const productUrl =
      first.web_url ||
      first.url ||
      first.product_url ||
      null;

    return res.json({
      success: true,
      url: productUrl,
      name: first.name || query,
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
