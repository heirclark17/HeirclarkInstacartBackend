// src/instacartClient.ts

const INSTACART_BASE = "https://connect.instacart.com";

export interface InstacartMeasurement {
  quantity: number;
  unit: string; // e.g. "each", "cup", "ounce", "lb"
}

export interface InstacartIngredient {
  name: string;
  display_text?: string;
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

  const text = await resp.text();
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    data = null;
  }

  console.log("Instacart raw response:", text);

  if (!resp.ok) {
    throw new Error(
      `Instacart API error: ${resp.status} ${resp.statusText} – ${text}`
    );
  }

  return (data || {}) as InstacartRecipeResponse;
}
