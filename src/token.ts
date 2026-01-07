// ...existing code...
// Use a resilient import to handle different export shapes of ./env
const EnvModule = require('./env');
const ENV = (EnvModule as any).ENV ?? (EnvModule as any).default ?? EnvModule;

type TokenRecord = { access_token: string; expires_at: number };
let CACHE: TokenRecord | null = null;

export async function getAccessToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (CACHE && CACHE.expires_at - 60 > now) return CACHE.access_token;

  const body = {
    client_id: ENV.INSTACART_CLIENT_ID,
    client_secret: ENV.INSTACART_CLIENT_SECRET,
    grant_type: 'client_credentials',
    // scope: 'idp:products' // only if your Instacart account requires it
  };

  const res = await fetch(ENV.INSTACART_OAUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Instacart OAuth failed: ${res.status} ${text}`);
  }

  const json: any = await res.json();
  const token = json.access_token;
  const expiresIn = Number(json.expires_in || ENV.TOKEN_CACHE_SECONDS);
  CACHE = { access_token: token, expires_at: now + expiresIn };
  return token;
}
// ...existing code...