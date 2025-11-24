// src/routes/instacart.ts
import express, { Request, Response } from "express";
// NOTE: No node-fetch import – we use the global fetch from Node 18+

const router = express.Router();

// -----------------------------------------------------------------------------
// ENV CONFIG
// -----------------------------------------------------------------------------
const INSTACART_BASE_URL =
  process.env.INSTACART_BASE_URL || "https://api.instacart.com"; // or your dev base

// Single token/key used for both search + product detail.
// Name it however you like in your .env (Bearer token, API key, etc.).
const INSTACART_API_KEY = process.env.INSTACART_API_KEY || "";

// Retailer you want to target in Instacart
const INSTACART_RETAILER_ID = process.env.INSTACART_RETAILER_ID || "";

// Public base URL where THIS app is reachable, used to construct return URLs.
// Example: https://heirclark.com/apps/hc-proxy
const APP_PUBLIC_BASE_URL = process.env.APP_PUBLIC_BASE_URL || "";

// -----------------------------------------------------------------------------
// Utility: basic timeout wrapper around global fetch
// -----------------------------------------------------------------------------
function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs = 15000
): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);

  return fetch(url, { ...options, signal: controller.signal }).finally(() =>
    clearTimeout(id)
  );
}

// -----------------------------------------------------------------------------
// Helper: Fetch product details from Instacart by product_id
// NOTE: This is PSEUDO-CODE – adjust path/fields per your Instacart docs.
// -----------------------------------------------------------------------------
async function fetchInstacartProduct(productId: string) {
  if (!INSTACART_API_KEY) {
    throw new Error("Missing INSTACART_API_KEY in environment");
  }

  // Replace `/products/${id}` with the actual product-detail path from Instacart.
  const url = `${INSTACART_BASE_URL}/products/${encodeURIComponent(
    productId
  )}?retailer_id=${encodeURIComponent(INSTACART_RETAILER_ID)}`;

  const resp = await fetchWithTimeout(
    url,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${INSTACART_API_KEY}`,
        "Content-Type": "application/json",
      },
    },
    15000
  );

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(
      `Instacart product fetch failed: ${resp.status} ${resp.statusText} - ${text}`
    );
  }

  const data = await resp.json();

  // Shape this into a clean object for the front-end.
  // Adjust field names to match Instacart’s real response.
  const product = {
    id: data.id ?? productId,
    name: data.name ?? data.title ?? "",
    price:
      typeof data.price === "number"
        ? data.price
        : typeof data.price_in_cents === "number"
        ? data.price_in_cents / 100
        : null,
    currency: data.currency ?? "USD",
    size: data.size ?? data.package_size ?? "",
    image_url: data.image_url ?? (data.images && data.images[0]) ?? "",
    retailer_id: INSTACART_RETAILER_ID,
    raw: data, // keep raw payload if you want more fields client-side
  };

  return product;
}

// -----------------------------------------------------------------------------
// EXISTING ROUTE (KEEP): POST /instacart/search
// Used by your app to find a product URL for a text query.
// -----------------------------------------------------------------------------
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
    )}&retailer_id=${encodeURIComponent(INSTACART_RETAILER_ID)}`;

    const apiRes = await fetchWithTimeout(url, {
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
      first.web_url || first.url || first.product_url || null;

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

// -----------------------------------------------------------------------------
// NEW (OPTIONAL): GET /instacart/deeplink
// Helper to build the Instacart search deeplink + return URL.
// You don't *have* to use this if you construct the deeplink on the front-end,
// but it's here if you want a server-side helper.
// -----------------------------------------------------------------------------
router.get("/instacart/deeplink", (req: Request, res: Response) => {
  try {
    const { q, rowId } = req.query;

    if (!APP_PUBLIC_BASE_URL) {
      return res.status(500).json({
        success: false,
        error: "APP_PUBLIC_BASE_URL is not configured on the server.",
      });
    }

    const query =
      typeof q === "string" && q.trim().length > 0 ? q.trim() : "grocery";
    const safeRowId =
      typeof rowId === "string" && rowId.trim().length > 0
        ? rowId.trim()
        : `row-${Date.now()}`;

    // This is a *placeholder* deep link pattern.
    // Use the correct partner deeplink URL from Instacart’s documentation.
    const callbackUrl = `${APP_PUBLIC_BASE_URL}/instacart/return?rowId=${encodeURIComponent(
      safeRowId
    )}`;

    const instacartDeepLink = `https://www.instacart.com/v3/partner/deeplink?retailer_id=${encodeURIComponent(
      INSTACART_RETAILER_ID
    )}&q=${encodeURIComponent(query)}&return_url=${encodeURIComponent(
      callbackUrl
    )}`;

    return res.json({
      success: true,
      deeplink: instacartDeepLink,
      rowId: safeRowId,
    });
  } catch (err) {
    console.error("[Instacart] Deeplink error:", err);
    return res.status(500).json({
      success: false,
      error: "Failed to create Instacart deeplink.",
    });
  }
});

// -----------------------------------------------------------------------------
// NEW (OPTION C CORE): GET /instacart/return
// This is the URL Instacart redirects back to after the user selects an item.
// Flow:
//   1. Instacart sends the user here with `product_id` (+ your `rowId`).
//   2. We call Instacart to get full product details.
//   3. We render a small HTML page that uses window.opener.postMessage()
//      to send the product details back to your main app window.
// -----------------------------------------------------------------------------
router.get("/instacart/return", async (req: Request, res: Response) => {
  try {
    const { product_id, rowId } = req.query;

    if (!product_id || typeof product_id !== "string") {
      return res
        .status(400)
        .send("Missing product_id from Instacart return URL.");
    }

    const safeRowId =
      typeof rowId === "string" && rowId.trim().length > 0
        ? rowId.trim()
        : `row-${Date.now()}`;

    const product = await fetchInstacartProduct(product_id);

    // IMPORTANT:
    // This HTML runs on YOUR domain and immediately posts the product info
    // back to the opener window, then closes itself.
    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Heirclark · Instacart Selection</title>
</head>
<body>
  <script>
    (function () {
      var payload = {
        type: "HC_INSTACART_SELECTED",
        rowId: ${JSON.stringify(safeRowId)},
        product: ${JSON.stringify(product)}
      };

      try {
        if (window.opener && typeof window.opener.postMessage === "function") {
          // In production, you should restrict this to your real origin:
          // window.opener.postMessage(payload, "https://heirclark.com");
          window.opener.postMessage(payload, "*");
        } else if (window.parent && window.parent !== window && typeof window.parent.postMessage === "function") {
          window.parent.postMessage(payload, "*");
        }
      } catch (err) {
        console.error("Error posting Instacart selection back to opener:", err);
      }

      // Give it a moment, then close.
      setTimeout(function () {
        window.close();
      }, 250);
    })();
  </script>
  <p>You can close this window.</p>
</body>
</html>
    `.trim();

    res.status(200).send(html);
  } catch (err) {
    console.error("[Instacart] Return handler error:", err);
    res
      .status(500)
      .send("There was a problem retrieving the product from Instacart.");
  }
});

export default router;
