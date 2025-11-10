import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import cors, { CorsOptions } from 'cors';
import crypto from 'crypto';
import type { ParsedQs } from 'qs';

const app = express();

/* ---------- CORS ---------- */
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

const corsOptions: CorsOptions = {
  origin(origin, cb) {
    if (!origin) return cb(null, true);
    if (allowedOrigins.length === 0) return cb(null, true);
    if (allowedOrigins.includes(origin)) return cb(null, true);
    return cb(new Error(`CORS blocked for origin: ${origin}`));
  },
  credentials: false,
};

app.use(cors(corsOptions));
app.use(express.json({ limit: '1mb' }));

/* ---------- Shopify App Proxy signature ---------- */
// MUST match your Shopify “App proxy” public path exactly: /apps/<subpath_prefix>/<subpath>
const SHOPIFY_PROXY_PATH = process.env.SHOPIFY_PROXY_PATH || '/apps/instacart';
const SHOPIFY_APP_SECRET = process.env.SHOPIFY_API_SECRET || '';

// Express puts query params as ParsedQs. Handle that safely:
type QVal = string | string[] | ParsedQs | ParsedQs[] | undefined;
const asStr = (v: QVal): string => {
  if (Array.isArray(v)) v = v[0];
  if (v == null) return '';
  return typeof v === 'string' ? v : String(v);
};

function verifyShopifyProxy(req: Request, res: Response, next: NextFunction): void {
  const q = req.query as Record<string, QVal>;
  const { signature, ...rest } = q;

  if (!signature) {
    res.status(401).send('Missing signature');
    return;
  }
  if (!SHOPIFY_APP_SECRET) {
    console.warn('WARNING: SHOPIFY_API_SECRET not set; skipping signature validation.');
    next();
    return;
  }

  // Build sorted query string WITHOUT signature
  const sortedPairs = Object.keys(rest)
    .sort()
    .map(k => `${k}=${asStr(rest[k])}`);
  const qs = sortedPairs.join('&');

  // HMAC over "<public proxy path>?<sorted qs>" (or just the path if no qs)
  const data = qs.length ? `${SHOPIFY_PROXY_PATH}?${qs}` : SHOPIFY_PROXY_PATH;

  const computed = crypto.createHmac('sha256', SHOPIFY_APP_SECRET).update(data).digest('hex');
  if (computed !== asStr(signature)) {
    res.status(401).send('Bad signature');
    return;
  }
  next();
}

/* ---------- Routes ---------- */
// Direct checks (bypass App Proxy / signature)
app.get('/api/health', (_req, res) =>
  res.status(200).json({ ok: true, service: 'Heirclark Instacart Backend', time: new Date().toISOString() })
);
app.get('/api/version', (_req, res) => res.json({ version: process.env.npm_package_version || '1.0.0' }));

// App Proxy base is configured to forward to /proxy/* on your backend.
// So /apps/instacart/build-list -> https://<railway>/proxy/build-list
app.get('/proxy/health', verifyShopifyProxy, (_req, res) => res.json({ ok: true, via: 'shopify-app-proxy' }));

app.post('/proxy/build-list', verifyShopifyProxy, (req, res) => {
  const payload = req.body ?? {};
  return res.status(200).json({
    ok: true,
    received: payload,
    cartUrl: 'https://www.instacart.com/store'
  });
});



// Optional GET for quick browser sanity checks: /apps/instacart/build-list?ping=1
app.get('/proxy/build-list', verifyShopifyProxy, (req, res) => {
  if ('ping' in req.query) return res.json({ ok: true, pong: true, ts: Date.now() });
  res.status(405).json({ ok: false, error: 'Use POST' });
});

/* 404 JSON */
app.use((_req, res) => res.status(404).json({ ok: false, error: 'Not found' }));

/* Start */
const port = Number(process.env.PORT) || 3000;
app.listen(port, '0.0.0.0', () => console.log(`Heirclark Instacart Backend running on port ${port}`));
