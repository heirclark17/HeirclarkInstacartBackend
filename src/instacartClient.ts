// src/instacartClient.ts

const INSTACART_BASE = "https://connect.instacart.com";

// ---- Types matching Instacart "Create shopping list page" ----

export interface InstacartMeasurement {
  quantity?: number; // defaults to 1.0 if omitted
  unit?: string;     // e.g. "each", "cup", "ounce", "lb"
}

export interface InstacartFilter {
  brand_filters?: string[];
  health_filters?: string[]; // ORGANIC, GLUTEN_FREE, etc.
}

export interface InstacartLineItem {
  name: string;                // REQUIRED – product name / search term
  quantity?: number;           // Optional, defaults to 1.0
  unit?: string;               // Optional, defaults to "each"
  display_text?: string;       // Optional friendly text
  product_ids?: number[];      // Optional
  upcs?: string[];             // Optional
  line_item_measurements?: InstacartMeasurement[];
  filters?: InstacartFilter;
}

export interface InstacartProductsLinkPayload {
  title: string;                     // REQUIRED
  image_url?: string;
  link_type?: "shopping_list" | "recipe";
  expires_in?: number;
  instructions?: string[];
  line_items: InstacartLineItem[];   // REQUIRED
  landing_page_configuration?: {
    partner_linkback_url?: string;
    enable_pantry_items?: boolean;   // only honored for link_type = "recipe"
  };
}

export interface InstacartProductsLinkResponse {
  products_link_url?: string;
}

// ---- Client function ----

export async function createInstacartProductsLink(
  payload: InstacartProductsLinkPayload
): Promise<InstacartProductsLinkResponse> {
  const apiKey = (process.env.INSTACART_API_KEY || '').trim();
  if (!apiKey) {
    throw new Error("Missing INSTACART_API_KEY environment variable");
  }

  // Debug: log key format (first/last few chars only)
  console.log('[instacartClient] API key length:', apiKey.length);
  console.log('[instacartClient] API key format:', apiKey.substring(0, 10) + '...' + apiKey.substring(apiKey.length - 5));

  const resp = await fetch(`${INSTACART_BASE}/idp/v1/products/products_link`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`, // Instacart uses API key as Bearer token
      "Content-Type": "application/json",
      "Accept": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const text = await resp.text();
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    data = null;
  }

  console.log("Instacart raw response from /products_link:", text);

  if (!resp.ok) {
    // Surface Instacart’s error body to Railway logs
    throw new Error(
      `Instacart API error: ${resp.status} ${resp.statusText} – ${text}`
    );
  }

  return (data || {}) as InstacartProductsLinkResponse;
}
