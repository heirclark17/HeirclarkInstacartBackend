import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import cors, { CorsOptions } from 'cors';
import crypto from 'crypto';

// ---- Config & env ----
const app = express();

const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

const corsOptions: CorsOptions = {
  origin(origin, cb) {
    if (!origin) return cb(null, true);                 // same-origin, curl, server-to-server
    if (allowedOrigins.length === 0) return cb(null, true);
    if (allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error(`CORS blocked for origin: ${origin}`));
  },
  credentials: false,
};

app.use(cors(corsOptions));
app.use(express.json({ limit: '1mb' }));

const SHOPIFY_APP_SECRET = process.env.SHOPIFY_API_SECRET || '';
const SHOPIFY_PROXY_PUBLIC_PREFIX = process.env.SHOPIFY_PROXY_PUBLIC_PREFIX || '/apps';
const SHOPIFY_PUBLIC_SUBPATH = process.env.SHOPIFY_PUBLIC_SUBPATH || '/instacart';

// This is where Shopify will forward the request to your backend:
const INTERNAL_PROXY_PATH = '/proxy/build-list';

// ---- Helpers ----
type QVal = string | string[] | undefined;
const toStr = (v: QVal): string => (Array.isArray(v) ? (v[0] ?? '') : (v ?? ''));

// Verify Shopify App Proxy signature
function verifyShopifyProxy(req: Request, res: Response, next: NextFunction): void {
  try {
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

    const sortedPairs = Object.keys(rest)
      .sort()
      .map(k => `${k}=${toStr(rest[k])}`);
    const qs = sortedPairs.join('&');

    // HMAC over "<public proxy path>?<sorted qs>"
    // Example public proxy path: /apps/instacart/build-list
    const publicPath = `${SHOPIFY_PROXY_PUBLIC_PREFIX}${SHOPIFY_PUBLIC_SUBPATH}/build-list`;
    const data = qs.length ? `${publicPath}?${qs}` : publicPath;

    const computed = crypto
      .createHmac('sha256', SHOPIFY_APP_SECRET)
      .update(data)
      .digest('hex');

    if (computed !== toStr(signature)) {
      res.status(401).send('Bad signature');
      return;
    }
    next();
  } catch {
    res.status(401).send('Signature check failed');
  }
}

// ---- Health & version ----
app.get('/api/health', (_req, res) => {
  res.status(200).json({
    ok: true,
    service: 'Heirclark Instacart Backend',
    time: new Date().toISOString(),
  });
});

app.get('/api/version', (_req, res) => {
  res.json({ version: process.env.npm_package_version || '1.0.0' });
});

// ---- App Proxy routes ----
// accept both "/proxy/build-list" and "/build-list"
const paths = ['/proxy/build-list', '/build-list'];

paths.forEach(path => {
  app.get(path, verifyShopifyProxy, (req, res) => {
    if (req.query.ping) {
      return res.status(200).json({ ok: true, via: 'shopify-app-proxy' });
    }
    res.status(200).type('html').send('<div style="font:14px/1.5 system-ui">Proxy OK</div>');
  });

  app.post(path, verifyShopifyProxy, (req, res) => {
    const payload = req.body ?? {};
    res.status(200).json({
      ok: true,
      received: payload,
      message: 'Instacart list created (stub)',
      cartUrl: 'https://www.instacart.com/store'
    });
  });
});


// ---- Admin landing (optional) ----
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
        <p><strong>Public App Proxy path (theme should call):</strong><br/>
        <code>${SHOPIFY_PROXY_PUBLIC_PREFIX}${SHOPIFY_PUBLIC_SUBPATH}/build-list</code></p>
      </div>
    `);
});

// ---- Catch-all 404 (JSON) ----
app.use((_req, res) => {
  res.status(404).json({ ok: false, error: 'Not found' });
});

// ---- Start ----
const port = Number(process.env.PORT) || 3000;
app.listen(port, '0.0.0.0', () => {
  console.log(`Heirclark Instacart Backend running on port ${port}`);
  console.log(
    `Expecting App Proxy public path: ${SHOPIFY_PROXY_PUBLIC_PREFIX}${SHOPIFY_PUBLIC_SUBPATH}/build-list`
  );
});
