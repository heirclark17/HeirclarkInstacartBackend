// src/instacartClient.ts

const INSTACART_BASE = "https://connect.instacart.com";

export interface InstacartMeasurement {
  quantity: number;
  unit: string; // e.g. "each", "cup", "ounce", "lb"
}

export interface InstacartIngredient {
  name: string;                // search term, e.g. "salmon fillet"
  display_text?: string;       // how it shows on the Instacart page
  measurements?: InstacartMeasurement[];
}

export interface InstacartRecipePayload {
  title: string;
  servings: number;
  image_url?: string;
  author?: string;
  cooking_time?: number;
  instructions?: string[];
  ingredients: InstacartIngredient[];
  landing_page_configuration?: {
    partner_linkback_url?: string;
    enable_pantry_items?: boolean;
  };
}

export interface InstacartRecipeResponse {
  products_link_url?: string;
  // Instacart returns other fields, but this is the one we care about
}

export async function createInstacartRecipe(
  payload: InstacartRecipePayload
): Promise<InstacartRecipeResponse> {
  const apiKey = process.env.INSTACART_API_KEY;
  if (!apiKey) {
    throw new Error("Missing INSTACART_API_KEY environment variable");
  }

  const resp = await fetch(`${INSTACART_BASE}/idp/v1/products/recipe`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Accept": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const data = await resp.json().catch(() => ({}));

  if (!resp.ok) {
    console.error("Instacart API error:", resp.status, resp.statusText, data);
    throw new Error(`Instacart API error: ${resp.status} ${resp.statusText}`);
  }

  return data as InstacartRecipeResponse;
}
