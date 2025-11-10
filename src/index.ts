// ----- Config -----
import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import cors, { CorsOptions } from 'cors';
import crypto from 'crypto';
import qs from 'querystring';

const app = express();

// CORS is only for direct REST hits; App Proxy does not use CORS
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

const corsOptions: CorsOptions = {
  origin(origin, cb) {
    if (!origin) return cb(null, true);
    if (allowedOrigins.length === 0) return cb(null, true);
    cb(allowedOrigins.includes(origin) ? null : new Error(`CORS blocked: ${origin}`), allowedOrigins.includes(origin));
  },
  credentials: false,
};

app.use(cors(corsOptions));
app.use(express.json({ limit: '1mb' }));

// ===== Shopify App Proxy verification =====
const SHOPIFY_APP_SECRET = process.env.SHOPIFY_API_SECRET || '';
// EXACT public proxy path configured in Shopify:
// /apps/instacart/build-list  (matches your screenshots)
const SHOPIFY_PROXY_PATH = process.env.SHOPIFY_PROXY_PATH || '/apps/instacart/build-list';

type QVal = string | string[] | undefined;
const toStr = (v: QVal) => (Array.isArray(v) ? (v[0] ?? '') : (v ?? ''));

function verifyShopifyProxy(req: Request, res: Response, next: NextFunction) {
  try {
    const q = req.query as Record<string, QVal>;
    const { signature, ...rest } = q;

    if (!signature) return res.status(401).send('Missing signature');
    if (!SHOPIFY_APP_SECRET) return res.status(401).send('Missing app secret');

    // Shopify requires the sorted, unescaped query string (excluding signature)
    const sortedPairs = Object.keys(rest)
      .sort()
      .map(k => `${k}=${toStr(rest[k])}`);
    const qsJoined = sortedPairs.join('&');

    // Data is the EXACT public proxy path you configured (+ "?qs" if any)
    const data = qsJoined ? `${SHOPIFY_PROXY_PATH}?${qsJoined}` : SHOPIFY_PROXY_PATH;

    const computed = crypto
      .createHmac('sha256', SHOPIFY_APP_SECRET)
      .update(data)
      .digest('hex');

    if (computed !== toStr(signature)) return res.status(401).send('Bad signature');
    next();
  } catch (e) {
    res.status(401).send('Signature check failed');
  }
}

// ----- Health (works either way) -----
app.get('/api/health', (_req, res) => {
  res.status(200).json({ ok: true, service: 'Heirclark Instacart Backend', time: new Date().toISOString() });
});

// ====== App Proxy targets (MUST MATCH Shopify Proxy URL) ======
// Quick ping (GET):  /apps/instacart/build-list?ping=1
app.get('/proxy/build-list', verifyShopifyProxy, (req, res) => {
  if (req.query.ping) return res.status(200).json({ ok: true, via: 'shopify-app-proxy', ts: new Date().toISOString() });
  res.status(200).json({ ok: true, message: 'build-list GET ready' });
});

// Button POST:  /apps/instacart/build-list
app.post('/proxy/build-list', verifyShopifyProxy, (req, res) => {
  // TODO: call your Instacart logic here
  res.status(200).json({
    ok: true,
    received: req.body ?? {},
    cartUrl: 'https://www.instacart.com/store',
  });
});

// Admin landing
app.get('/', (_req, res) => {
  res
    .status(200)
    .type('html')
    .send(`<div style="font:14px/1.5 system-ui; padding:16px">
      <h1>Heirclark Instacart Backend</h1>
      <ul>
        <li><a href="/api/health" target="_blank">/api/health</a></li>
      </ul>
      <p>Storefront App Proxy test (open in storefront DevTools Console):</p>
      <pre>fetch('/apps/instacart/build-list?ping=1').then(r=>r.json()).then(console.log)</pre>
    </div>`);
});

// 404
app.use((_req, res) => res.status(404).json({ ok: false, error: 'Not found' }));

const port = Number(process.env.PORT) || 3000;
app.listen(port, '0.0.0.0', () => console.log(`Heirclark Instacart Backend running on port ${port}`));
