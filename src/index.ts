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
    const q = req.query as Record<string, QVal>;
    const signature = toStr(q.signature);
    if (!signature) { res.status(401).send('Missing signature'); return; }

    if (!SHOPIFY_APP_SECRET) {
      console.warn('WARNING: SHOPIFY_API_SECRET not set; skipping signature validation.');
      return next();
    }

    // 1) Build the public path Shopify used (what the customer sees)
    const pathPrefix = toStr(q.path_prefix) || '/apps/instacart'; // fallback
    // forwarded path on your server (e.g. '/proxy/build-list'), strip the '/proxy' base
    const forwardedPath = req.path.replace(/^\/proxy/, '') || '/';
    const publicPath = `${pathPrefix}${forwardedPath}`; // e.g. '/apps/instacart/build-list'

    // 2) Build the sorted querystring excluding `signature`
    const { signature: _sig, ...rest } = q;
    const sortedPairs = Object.keys(rest)
      .sort()
      .map(k => `${k}=${toStr(rest[k])}`);
    const qs = sortedPairs.join('&');

    // 3) Compute HMAC of "<publicPath>?<sorted qs>"
    const payload = qs.length ? `${publicPath}?${qs}` : publicPath;
    const computed = crypto
      .createHmac('sha256', SHOPIFY_APP_SECRET)
      .update(payload)
      .digest('hex');

    if (computed !== signature) { res.status(401).send('Bad signature'); return; }
    next();
  } catch (e) {
    res.status(401).send('Signature check failed');
  }
}


// ------------ Routes ------------

// App Proxy landing (GET ping or simple HTML)
app.get('/proxy', verifyShopifyProxy, (req, res) => {
  if (req.query.ping) return res.json({ ok: true, via: 'shopify-app-proxy', shop: req.query.shop, ts: req.query.timestamp });
  res.type('html').send(`<div style="font:14px system-ui">Proxy OK for ${req.query.shop || 'unknown shop'}</div>`);
});

// Build-list action (POST) – this is your button target
app.post('/proxy/build-list', verifyShopifyProxy, (req, res) => {
  const payload = req.body ?? {};
  return res.json({ ok: true, received: payload, cartUrl: 'https://www.instacart.com/store' });
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
