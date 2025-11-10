import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import cors, { CorsOptions } from 'cors';
import crypto from 'crypto';

/**
 * ----- Environment -----
 * Required:
 * - PORT
 * - SHOPIFY_API_SECRET           (from your app's Settings → Credentials → Secret)
 *
 * Optional (nice to have):
 * - ALLOWED_ORIGINS              (comma-separated, for any direct /api/* calls)
 * - SHOPIFY_PROXY_PUBLIC_PREFIX  (default 'apps')
 * - SHOPIFY_PUBLIC_SUBPATH       (default 'instacart')
 */
const PORT = Number(process.env.PORT || 3000);
const SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET || '';
const PUBLIC_PREFIX = (process.env.SHOPIFY_PROXY_PUBLIC_PREFIX || 'apps').replace(/^\/|\/$/g, '');
const PUBLIC_SUBPATH = (process.env.SHOPIFY_PUBLIC_SUBPATH || 'instacart').replace(/^\/|\/$/g, '');

/**
 * The exact public path the browser calls on your storefront.
 * Example: /apps/instacart/build-list
 */
const PUBLIC_PROXY_PATH = `/${PUBLIC_PREFIX}/${PUBLIC_SUBPATH}/build-list`;

/**
 * ----- App & Middleware -----
 */
const app = express();

const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

const corsOptions: CorsOptions = {
  origin(origin, cb) {
    // allow same-origin and server-to-server
    if (!origin) return cb(null, true);
    if (allowedOrigins.length === 0) return cb(null, true);
    if (allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error(`CORS blocked for origin: ${origin}`));
  },
  credentials: false
};

// CORS is useful for /api/* when you call your Railway host directly.
// App Proxy routes don't need CORS (Shopify calls your server from their edge).
app.use('/api', cors(corsOptions));

app.use(express.json({ limit: '1mb' }));

/**
 * ----- Helpers -----
 */

// “Loosen” req.query typing so we don’t fight with ParsedQs.
// We only need string values for signature building.
type QVal = string | string[] | undefined;
const toStr = (v: QVal): string => (Array.isArray(v) ? (v[0] ?? '') : (v ?? ''));

/**
 * Verify Shopify App Proxy signature.
 * Shopify doc: signature = HMAC-SHA256(secret, '<public path>?<sorted querystring-without-signature>')
 */
function verifyShopifyProxy(req: Request, res: Response, next: NextFunction) {
  try {
    const q = (req.query || {}) as Record<string, QVal>;
    const incomingSig = toStr(q.signature);

    if (!incomingSig) {
      res.status(401).send('Missing signature');
      return;
    }
    if (!SHOPIFY_API_SECRET) {
      console.warn('WARNING: SHOPIFY_API_SECRET not set; skipping signature validation.');
      return next();
    }

    const { signature, ...rest } = q;
    const sorted = Object.keys(rest)
      .sort()
      .map(k => `${k}=${toStr(rest[k])}`)
      .join('&');

    // IMPORTANT: HMAC over the **public** path your shopper requested
    // (NOT your backend route).
    const data = sorted ? `${PUBLIC_PROXY_PATH}?${sorted}` : PUBLIC_PROXY_PATH;

    const computed = crypto
      .createHmac('sha256', SHOPIFY_API_SECRET)
      .update(data)
      .digest('hex');

    if (computed !== incomingSig) {
      res.status(401).send('Bad signature');
      return;
    }
    next();
  } catch (e) {
    res.status(401).send('Signature check failed');
  }
}

/**
 * ----- Health & Version -----
 */
app.get('/api/health', (_req, res) => {
  res.status(200).json({
    ok: true,
    service: 'Heirclark Instacart Backend',
    time: new Date().toISOString()
  });
});

app.get('/api/version', (_req, res) => {
  res.json({ version: process.env.npm_package_version || '1.0.0' });
});

/**
 * ----- App Proxy targets -----
 * Shopify forwards:
 *   /apps/instacart/build-list   →   https://your-railway-host/proxy/build-list
 */

// quick ping to prove the mapping works
app.get('/proxy/build-list', verifyShopifyProxy, (req, res) => {
  // if you call /apps/instacart/build-list?ping=1 from the storefront,
  // you should see this JSON (200)
  if (req.query.ping) {
    return res.status(200).json({
      ok: true,
      via: 'shopify-app-proxy',
      shop: (req.query as any).shop || null,
      ts: (req.query as any).timestamp || null
    });
  }
  // Helpful HTML page if someone opens it manually
  res
    .status(200)
    .type('html')
    .send(`<div style="font:14px/1.5 system-ui">Proxy OK for ${toStr((req.query as any).shop)}</div>`);
});

// real “Generate Instacart List” handler
app.post('/proxy/build-list', verifyShopifyProxy, (req, res) => {
  // Payload your theme sends
  const payload = req.body ?? {};

  // TODO: connect to your Instacart flow here.
  // For now, just echo back success and a placeholder URL.
  res.status(200).json({
    ok: true,
    received: payload,
    message: 'Instacart list created (stub)',
    cartUrl: 'https://www.instacart.com/store'
  });
});

/**
 * ----- Catch-all 404 -----
 */
app.use((_req, res) => {
  res.status(404).json({ ok: false, error: 'Not found' });
});

/**
 * ----- Start -----
 */
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Heirclark Instacart Backend running on port ${PORT}`);
  console.log(`Expecting App Proxy public path: ${PUBLIC_PROXY_PATH}`);
});
