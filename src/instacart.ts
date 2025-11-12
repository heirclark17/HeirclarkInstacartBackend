import fetch from "cross-fetch";

type Token = { access_token: string; expires_in: number };
let cachedToken: { value: string; exp: number } | null = null;

const OAUTH_URL = process.env.INSTACART_OAUTH_URL!;
const CLIENT_ID = process.env.INSTACART_CLIENT_ID!;
const CLIENT_SECRET = process.env.INSTACART_CLIENT_SECRET!;
const IDP_BASE = process.env.INSTACART_IDP_BASE!; // e.g. https://api.instacart.com

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

export async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.exp > nowSec() + 30) {
    return cachedToken.value;
  }

  const body = new URLSearchParams();
  body.set("grant_type", "client_credentials");
  body.set("client_id", CLIENT_ID);
  body.set("client_secret", CLIENT_SECRET);

  const res = await fetch(OAUTH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OAuth failed: ${res.status} ${text}`);
  }

  const tok = (await res.json()) as Token;
  cachedToken = { value: tok.access_token, exp: nowSec() + tok.expires_in };
  return cachedToken.value;
}

/**
 * Calls Instacart "Create shopping list page" endpoint
 * POST /idp/v1/products/products_link
 */
export async function createProductsLink(payload: {
  line_items: Array<{
    name: string;
    quantity?: number;
    unit?: string;
    line_item_measurements?: Array<{ quantity: number; unit: string }>;
    image_url?: string;
    description?: string;
    instructions?: string;
    allow_customer_to_remove?: boolean;
  }>;
  // optional extras you might support later:
  // return_url?: string;
  // source?: string;
}): Promise<{ url: string }> {
  const token = await getAccessToken();

  const res = await fetch(`${IDP_BASE}/idp/v1/products/products_link`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Instacart link failed: ${res.status} ${text}`);
  }

  const data = await res.json() as { url: string };
  if (!data?.url) throw new Error("No URL in Instacart response.");
  return data;
}
