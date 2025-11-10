import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import cors, { CorsOptions } from 'cors';
import crypto from 'crypto';

// ------------ App + CORS ------------
const app = express();

// Allow multiple origins via comma-separated env (e.g. https://heirclark.com,https://admin.heirclark.com)
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

const corsOptions: CorsOptions = {
  origin(origin, cb) {
    if (!origin) return cb(null, true);                 // same-origin / curl
    if (allowedOrigins.length === 0) return cb(null, true);
    if (allowedOrigins.includes(origin)) return cb(null, true);
    return cb(new Error(`CORS blocked for origin: ${origin}`));
  },
  credentials: false
};

app.use(cors(corsOptions));
app.use(express.json({ limit: '1mb' }));

// ------------ Shopify App Proxy HMAC ------------
const SHOPIFY_APP_SECRET = process.env.SHOPIFY_API_SECRET || '';
// IMPORTANT: for Subpath prefix "apps" and Subpath "instacart"
const SHOPIFY_PROXY_PATH = process.env.SHOPIFY_PROXY_PATH || '/apps/instacart';

/**
 * Convert unknown query value to string for HMAC input.
 * Shopify signs the string: "<SHOPIFY_PROXY_PATH>?<sorted qs without signature>"
 */
function toStr(v: unknown): string {
  if (v == null) return '';
  if (Array.isArray(v)) return v[0] ?? '';
  if (typeof v === 'string') return v;
  return String(v);
}

function verifyShopifyProxy(req: Request, res: Response, next: NextFunction): void {
  try {
    const q = req.query as Record<string, unknown>;
    const sig = toStr(q.signature);
    if (!sig) {
      res.status(401).send('Missing signature');
      return;
    }
    if (!SHOPIFY_APP_SECRET) {
      console.warn('WARNING: SHOPIFY_API_SECRET not set; skipping signature validation.');
      next();
      return;
    }

    // Remove "signature" from the query and sort the rest
    const sortedPairs = Object.keys(q)
      .filter(k => k !== 'signature')
      .sort()
      .map(k => `${k}=${toStr(q[k])}`);

    const qs = sortedPairs.join('&');
    // Shopify signs ONLY the base proxy path (no trailing route),
    // not the extra path like "/build-list".
    const data = qs.length ? `${SHOPIFY_PROXY_PATH}?${qs}` : SHOPIFY_PROXY_PATH;

    const computed = crypto
      .createHmac('sha256', SHOPIFY_APP_SECRET)
      .update(data)
      .digest('hex');

    if (computed !== sig) {
      res.status(401).send('Bad signature');
      return;
    }
    next();
  } catch (e) {
    res.status(401).send('Signature check failed');
  }
}

// ------------ Routes ------------

// Health (direct)
app.get('/api/health', (_req, res) => {
  res.status(200).json({
    ok: true,
    service: 'Heirclark Instacart Backend',
    time: new Date().toISOString(),
  });
});

// Optional version
app.get('/api/version', (_req, res) => {
  res.json({ version: process.env.npm_package_version || '1.0.0' });
});

/**
 * App Proxy target:
 * Storefront calls:
 *   GET  /apps/instacart/build-list?ping=1   -> GET /build-list (this route), returns pong
 *   POST /apps/instacart/build-list          -> POST /build-list (this route), returns ok + echo
 *
 * Shopify forwards to our base URL and appends "/build-list".
 */
app.get('/build-list', verifyShopifyProxy, (req, res) => {
  // quick ping sanity
  if (req.query.ping === '1') {
    return res.status(200).json({
      ok: true,
      via: 'shopify-app-proxy',
      shop: req.query.shop,
      ts: req.query.timestamp,
    });
  }
  // No ping -> show simple info page
  res
    .status(200)
    .type('html')
    .send(`<div style="font:14px/1.4 system-ui">Proxy OK for ${req.query.shop || 'unknown shop'}</div>`);
});

app.post('/build-list', verifyShopifyProxy, (req, res) => {
  // This is what your "Generate Instacart List" button will hit.
  const payload = req.body ?? {};
  // TODO: call your Instacart flow here and return the created cart/link.
  res.status(200).json({
    ok: true,
    message: 'Instacart list created (stub).',
    received: payload,
    cartUrl: 'https://www.instacart.com/store',
  });
});

// Admin landing (App URL target)
app.get('/', (_req, res) => {
  res
    .status(200)
    .type('html')
    .send(`
      <div style="font:14px/1.5 system-ui; padding:16px">
        <h1>Heirclark Instacart Backend</h1>
        <p>Backend is running.</p>
        <ul>
          <li><a href="/api/health" target="_blank">/api/health</a></li>
          <li><a href="/api/version" target="_blank">/api/version</a></li>
          <li>Storefront test: open your storefront and run <code>fetch('/apps/instacart/build-list?ping=1').then(r=>r.json())</code></li>
        </ul>
      </div>
    `);
});

// Catch-all 404 JSON
app.use((_req, res) => {
  res.status(404).json({ ok: false, error: 'Not found' });
});

// ------------ Start ------------
const port = Number(process.env.PORT) || 3000;
app.listen(port, '0.0.0.0', () => {
  console.log(`Heirclark Instacart Backend running on port ${port}`);
});
