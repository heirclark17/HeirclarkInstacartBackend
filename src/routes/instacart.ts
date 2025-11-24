// src/routes/instacart.ts
import express, { Request, Response } from "express";

const router = express.Router();

/**
 * TEMP STUB VERSION
 * -----------------
 * This IGNOREs the real Instacart API and always returns a fake products[] array.
 * Goal: prove front-end modal + calculator drawer integration works.
 */

router.post("/instacart/search", async (req: Request, res: Response) => {
  try {
    const query = (req.body.query || "").toString().trim() || "Grocery item";

    // Fake set of products to feed the modal
    const products = [
      {
        name: `${query} – 2 lb Family Pack`,
        price: 18.99,
        price_display: "$18.99",
        size: "2 lb",
        web_url: "https://www.instacart.com/store/items/example-2lb",
        retailer_name: "Sample Market",
      },
      {
        name: `${query} – 1 lb`,
        price: 9.99,
        price_display: "$9.99",
        size: "1 lb",
        web_url: "https://www.instacart.com/store/items/example-1lb",
        retailer_name: "Sample Market",
      },
      {
        name: `${query} – 32 oz`,
        price: 16.49,
        price_display: "$16.49",
        size: "32 oz",
        web_url: "https://www.instacart.com/store/items/example-32oz",
        retailer_name: "Sample Market",
      },
    ];

    return res.json({
      success: true,
      products,              // ✅ what hc-instacart-bridge.js is looking for
      products_link_url: null,
    });
  } catch (err) {
    console.error("[Instacart STUB] Unexpected error:", err);
    return res.status(500).json({
      success: false,
      error: "Server error",
    });
  }
});

export default router;
