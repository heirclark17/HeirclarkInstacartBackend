import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import cors, { CorsOptions } from 'cors';
import crypto from 'crypto';

const app = express();

/* ---------------- CORS (used only for direct /api/* calls) ---------------- */
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

const corsOptions: CorsOptions = {
  origin(origin, cb) {
    if (!origin) return cb(null, true);             // curl / server-to-server
    if (!allowedOrigins.length) return cb(null, true);
    if (allowedOrigins.includes(origin)) return cb(null, true);
    return cb(new Error(`CORS blocked for origin: ${origin}`));
  },
  credentials: false
};

app.use(cors(corsOptions));
app.use(express.json({ limit: '1mb' }));

/* ---------------- Shopify App Proxy verification ----------------
   You MUST set:
     SHOPIFY_API_SECRET   = <your app's API secret key>
     SHOPIFY_PROXY_PATH   = /apps/instacart/build-list   (exact public path)
------------------------------------------------------------------ */
const SHOPIFY_APP_SECRET = process.env.SHOPIFY_API_SECRET || '';
const SHOPIFY_PROXY_PATH = process.env.SHOPIFY_PROXY_PATH || '/apps/instacart/build-list';

function verifyShopifyProxy(req: Request, res: Response, next: NextFunction) {
  try {
    const sig = (req.query?.signature as string) || '';
    if (!sig) return res.status(401).send('Missing signature');

    if (!SHOPIFY_APP_SECRET) {
      console.warn('WARNING: SHOPIFY_API_SECRET not set; skipping signature validation.');
      return next();
    }

    // Use the RAW query string from the URL so we don’t accidentally re-encode.
    const rawQuery = (req.originalUrl.split('?', 2)[1] || '');

    // Remove signature, then sort keys (Shopify expects alphabetical order).
    const params = new URLSearchParams(rawQuery);
    params.delete('signature');
    const ordered = [...params.entries()]
      .sort(([a],[b]) => a.localeCompare(b))
      .map(([k,v]) => `${k}=${v}`)
      .join('&');

    // HMAC over "<public proxy path>?<ordered qs>" or just "<public proxy path>"
    const data = ordered ? `${SHOPIFY_PROXY_PATH}?${ordered}` : SHOPIFY_PROXY_PATH;

    const computed = crypto.createHmac('sha256', SHOPIFY_APP_SECRET)
      .update(data)
      .digest('hex');

    if (computed !== sig) return res.status(401).send('Bad signature');
    return next();
  } catch (e) {
    return res.status(401).send('Signature check failed');
  }
}

/* ---------------- Health / version ---------------- */
app.get('/api/health', (_req, res) => {
  res.status(200).json({ ok: true, service: 'Heirclark Instacart Backend', time: new Date().toISOString() });
});
app.get('/api/version', (_req, res) => res.json({ version: process.env.npm_package_version || '1.0.0' }));

/* ---------------- App Proxy routes (MUST match Shopify config) -------------
   Shopify App proxy:
     Subpath prefix: apps
     Subpath:        instacart
     URL:            https://<your-railway>.up.railway.app/proxy/build-list
   Public path on the shop: /apps/instacart/build-list
--------------------------------------------------------------------------- */

// ✅ App Proxy route — MUST MATCH Shopify App Proxy URL exactly
app.get('/proxy/build-list', verifyShopifyProxy, (req, res) => {
  if (req.query.ping) {
    return res.status(200).json({
      ok: true,
      via: 'shopify-app-proxy',
      shop: req.query.shop,
      time: new Date().toISOString()
    });
  }
  return res.status(200).json({
    ok: true,
    route: '/proxy/build-list',
    method: 'GET'
  });
});

app.post('/proxy/build-list', verifyShopifyProxy, (req, res) => {
  const payload = req.body ?? {};
  return res.status(200).json({
    ok: true,
    received: payload,
    cartUrl: 'https://www.instacart.com/store'
  });
});


/* ---------------- Optional direct REST (non-proxy) ---------------- */
app.post('/api/instacart/cart', (req, res) => {
  res.status(200).json({ ok: true, received: req.body, cartUrl: 'https://www.instacart.com/store' });
});

/* ---------------- Admin landing ---------------- */
app.get('/', (_req, res) => {
  res
    .status(200)
    .type('html')
    .send(`
      <div style="font:14px/1.5 system-ui; padding:16px">
        <h1>Heirclark Instacart Backend</h1>
        <ul>
          <li><a href="/api/health" target="_blank">/api/health</a></li>
          <li><a href="/api/version" target="_blank">/api/version</a></li>
        </ul>
        <p><strong>Storefront App Proxy test:</strong> open your shop and run
        <code>fetch('/apps/instacart/build-list?ping=1').then(r=>r.json())</code> in the console.</p>
      </div>
    `);
});

/* ---------------- 404 JSON ---------------- */
app.use((_req, res) => res.status(404).json({ ok: false, error: 'Not found' }));

/* ---------------- Start ---------------- */
const port = Number(process.env.PORT) || 3000;
app.listen(port, '0.0.0.0', () => {
  console.log(`Heirclark Instacart Backend running on port ${port}`);
});
