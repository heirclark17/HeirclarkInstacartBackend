import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import cors, { CorsOptions } from 'cors';
import crypto from 'crypto';

const app = express();

/* ---------- CORS ---------- */
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

/* ---------- Shopify App Proxy verification ---------- */
/*
  Shopify adds a `signature` query using HMAC-SHA256 over:
     "<PUBLIC_PROXY_PATH>?<sorted_query_without_signature>"
  PUBLIC_PROXY_PATH must match the EXACT storefront path the browser calls,
  e.g. "/apps/instacart/build-list"
*/
const SHOPIFY_APP_SECRET = process.env.SHOPIFY_API_SECRET || '';
const PUBLIC_PROXY_PATH  = process.env.SHOPIFY_PROXY_PATH || '/apps/instacart/build-list';

type QVal = string | string[] | undefined;
const toStr = (v: QVal) => (Array.isArray(v) ? (v[0] ?? '') : (v ?? ''));

function verifyShopifyProxy(req: Request, res: Response, next: NextFunction) {
  try {
    const q = req.query as Record<string, QVal>;
    const { signature, ...rest } = q;

    if (!signature) return res.status(401).send('Missing signature');
    if (!SHOPIFY_APP_SECRET) {
      console.warn('WARNING: SHOPIFY_API_SECRET not set; skipping signature validation.');
      return next();
    }

    const sorted = Object.keys(rest)
      .sort()
      .map(k => `${k}=${toStr(rest[k])}`)
      .join('&');

    const data = sorted ? `${PUBLIC_PROXY_PATH}?${sorted}` : PUBLIC_PROXY_PATH;

    const computed = crypto
      .createHmac('sha256', SHOPIFY_APP_SECRET)
      .update(data)
      .digest('hex');

    if (computed !== toStr(signature)) return res.status(401).send('Bad signature');
    return next();
  } catch {
    return res.status(401).send('Signature check failed');
  }
}

/* ---------- Health & version ---------- */
app.get('/api/health', (_req, res) => {
  res.status(200).json({ ok: true, service: 'Heirclark Instacart Backend', time: new Date().toISOString() });
});

app.get('/api/version', (_req, res) => {
  res.json({ version: process.env.npm_package_version || '1.0.0' });
});

/* ---------- App Proxy endpoints ---------- */
/*
  With Shopify App Proxy configured as:
    - Subpath prefix: apps
    - Subpath: instacart
    - Proxy URL: https://<railway-host>
  A storefront call to:
    POST https://heirclark.com/apps/instacart/build-list?shop=...&timestamp=...&signature=...
  will be forwarded to your backend as:
    POST https://<railway-host>/build-list?shop=...&timestamp=...&signature=...
*/
app.post('/build-list', verifyShopifyProxy, (req: Request, res: Response) => {
  // TODO: translate plan -> Instacart cart
  const payload = req.body ?? {};
  return res.status(200).json({
    ok: true,
    received: payload,
    // placeholder; replace once you generate a real Instacart list URL
    cartUrl: 'https://www.instacart.com/store'
  });
});

/* Optional ping for quick proxy sanity check: /apps/instacart/build-list?ping=1 (GET) */
app.get('/build-list', verifyShopifyProxy, (req: Request, res: Response) => {
  if (req.query.ping) {
    return res.status(200).json({ ok: true, via: 'shopify-app-proxy', shop: req.query.shop, ts: req.query.timestamp });
  }
  return res.status(405).json({ ok: false, error: 'Method not allowed' });
});

/* ---------- Admin landing ---------- */
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
        </ul>
        <p>Storefront App Proxy test (open in a storefront tab):</p>
        <code>fetch('/apps/instacart/build-list?ping=1').then(r=>r.json())</code>
      </div>
    `);
});

/* ---------- 404 ---------- */
app.use((_req, res) => res.status(404).json({ ok: false, error: 'Not found' }));

/* ---------- Start ---------- */
const port = Number(process.env.PORT) || 3000;
app.listen(port, '0.0.0.0', () => console.log(`Heirclark Instacart Backend running on port ${port}`));
