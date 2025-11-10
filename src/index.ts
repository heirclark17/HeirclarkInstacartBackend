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
  origin(origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void) {
    if (!origin) return cb(null, true);                 // server-to-server / curl
    if (allowedOrigins.length === 0) return cb(null, true);
    if (allowedOrigins.includes(origin)) return cb(null, true);
    return cb(new Error(`CORS blocked for origin: ${origin}`));
  },
  credentials: false
};

app.use(cors(corsOptions));
app.use(express.json({ limit: '1mb' }));

/* ---------- Shopify App Proxy HMAC ---------- */
const SHOPIFY_APP_SECRET = process.env.SHOPIFY_API_SECRET || '';
const SHOPIFY_PROXY_PATH = process.env.SHOPIFY_PROXY_PATH || '/apps/instacart'; // <- MUST match your Shopify App Proxy

type QVal = string | string[] | undefined;
const toStr = (v: QVal): string => (Array.isArray(v) ? (v[0] ?? '') : (v ?? ''));

function verifyShopifyProxy(req: Request, res: Response, next: NextFunction): void {
  try {
    const q = req.query as Record<string, QVal>;
    const sig = toStr(q.signature);
    if (!sig) return void res.status(401).send('Missing signature');

    if (!SHOPIFY_APP_SECRET) {
      console.warn('WARNING: SHOPIFY_API_SECRET not set; skipping signature validation.');
      return void next();
    }

    // Build sorted query string without signature
    const { signature, ...rest } = q;
    const sortedPairs = Object.keys(rest).sort().map(k => `${k}=${toStr(rest[k])}`);
    const qs = sortedPairs.join('&');

    // HMAC over "<public proxy path>?<sorted qs>"
    // IMPORTANT: use the exact public path configured in Shopify (e.g. /apps/instacart)
    const data = qs.length ? `${SHOPIFY_PROXY_PATH}?${qs}` : SHOPIFY_PROXY_PATH;

    const computed = crypto.createHmac('sha256', SHOPIFY_APP_SECRET).update(data).digest('hex');
    if (computed !== sig) return void res.status(401).send('Bad signature');

    return void next();
  } catch (e) {
    return void res.status(401).send('Signature check failed');
  }
}

/* ---------- Public health/version ---------- */
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

/* ---------- PROXY namespace (Shopify → your app) ---------- */
/* All /proxy/* require a valid Shopify App Proxy signature */
app.use('/proxy', verifyShopifyProxy);

/** Health for your front-end probe via proxy:
 *  Storefront GET  /apps/instacart/api/health   → backend GET /proxy/api/health
 */
app.get('/proxy/api/health', (_req, res) => {
  res.status(200).json({ ok: true, via: 'shopify-app-proxy', endpoint: 'api/health' });
});

/** Simple echo/ping for build-list:
 *  Storefront GET  /apps/instacart/build-list?ping=1  → 200 JSON
 *  Storefront POST /apps/instacart/build-list         → returns stub cartUrl
 */
app.get('/proxy/build-list', (req, res) => {
  const ping = toStr(req.query.ping);
  if (ping) {
    return void res.status(200).json({
      ok: true,
      via: 'shopify-app-proxy',
      endpoint: 'build-list',
      shop: req.query.shop,
      ts: req.query.timestamp
    });
  }
  res.status(404).json({ ok: false, error: 'Not found' });
});

app.post('/proxy/build-list', (req, res) => {
  const payload = req.body ?? {};
  // TODO: translate your meal plan payload to Instacart request here.
  return void res.status(200).json({
    ok: true,
    received: payload,
    message: 'Instacart list created (stub)',
    cartUrl: 'https://www.instacart.com/store'
  });
});

/* ---------- Optional direct (non-proxy) REST for testing ---------- */
app.post('/api/instacart/cart', (req, res) => {
  const payload = req.body ?? {};
  res.status(200).json({ ok: true, received: payload, cartUrl: 'https://www.instacart.com/store' });
});

/* ---------- Root ---------- */
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
        <p><strong>Storefront App Proxy tests (open from the storefront domain):</strong></p>
        <ul>
          <li><code>GET  https://heirclark.com/apps/instacart/api/health</code></li>
          <li><code>GET  https://heirclark.com/apps/instacart/build-list?ping=1</code></li>
          <li><code>POST https://heirclark.com/apps/instacart/build-list</code></li>
        </ul>
      </div>
    `);
});

/* ---------- 404 JSON ---------- */
app.use((_req, res) => res.status(404).json({ ok: false, error: 'Not found' }));

/* ---------- Start ---------- */
const port = Number(process.env.PORT) || 3000;
app.listen(port, '0.0.0.0', () => {
  console.log(`Heirclark Instacart Backend running on port ${port}`);
});
