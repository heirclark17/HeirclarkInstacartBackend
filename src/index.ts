import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import cors, { CorsOptions } from 'cors';
import crypto from 'crypto';

// ----- Config -----
const app = express();

// Allow multiple origins via comma-separated env (e.g. https://heirclark.com,https://admin.heirclark.com)
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

// Type the origin callback so TS doesn’t complain
const corsOptions: CorsOptions = {
  origin(origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void): void {
    // Allow same-origin / curl / server-to-server (no origin)
    if (!origin) return callback(null, true);
    // If not set, allow all
    if (allowedOrigins.length === 0) return callback(null, true);
    // Allow if in the list
    if (allowedOrigins.includes(origin)) return callback(null, true);
    // Otherwise block
    return callback(new Error(`CORS blocked for origin: ${origin}`));
  },
  credentials: false
};

app.use(cors(corsOptions));
app.use(express.json({ limit: '1mb' }));

// ===== Shopify App Proxy verification (typed) =====
const SHOPIFY_APP_SECRET = process.env.SHOPIFY_API_SECRET || '';
const SHOPIFY_PROXY_PATH = process.env.SHOPIFY_PROXY_PATH || '/apps/instacart'; // <— this should match your App Proxy Subpath

type QVal = string | string[] | undefined;
const toStr = (v: QVal): string => (Array.isArray(v) ? (v[0] ?? '') : (v ?? ''));

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
    const data = qs.length ? `${SHOPIFY_PROXY_PATH}?${qs}` : SHOPIFY_PROXY_PATH;

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

// ----- Routes -----

// Health (for Railway + browser checks)
app.get('/api/health', (_req: Request, res: Response) => {
  res.status(200).json({
    ok: true,
    service: 'Heirclark Instacart Backend',
    time: new Date().toISOString()
  });
});

// Simple version endpoint (optional)
app.get('/api/version', (_req: Request, res: Response) => {
  res.json({ version: process.env.npm_package_version || '1.0.0' });
});

/**
 * App Proxy health (Shopify -> your backend)
 * Frontend probe: GET https://heirclark.com/apps/instacart/health?ping=1
 * Shopify forwards to:    https://<railway-app>/proxy/health?shop=...&timestamp=...&signature=...
 */
app.get('/proxy/health', verifyShopifyProxy, (req: Request, res: Response) => {
  const ping = (req.query?.ping as string) ?? '';
  res.status(200).json({
    ok: true,
    via: 'shopify-app-proxy',
    path: '/proxy/health',
    ping: !!ping,
    shop: req.query.shop,
    ts: req.query.timestamp
  });
});

/**
 * App Proxy "build list"
 * Frontend calls:
 *   GET  /apps/instacart/build-list?ping=1     -> 200 ok if proxy/verification works
 *   POST /apps/instacart/build-list            -> creates a stubbed cart response for now
 *
 * Shopify forwards those to:
 *   GET/POST /proxy/build-list
 */
app.all('/proxy/build-list', verifyShopifyProxy, (req: Request, res: Response) => {
  // ping check to debug proxy wiring
  if (req.method === 'GET' && 'ping' in req.query) {
    res.status(200).json({
      ok: true,
      via: 'shopify-app-proxy',
      path: '/proxy/build-list',
      shop: req.query.shop,
      ts: req.query.timestamp
    });
    return;
  }

  if (req.method === 'POST') {
    const payload = req.body ?? {};
    // TODO: Replace with real Instacart integration
    return res.status(200).json({
      ok: true,
      message: 'Stub: Instacart list created.',
      received: payload,
      cartUrl: 'https://www.instacart.com/store'
    });
  }

  res.status(405).json({ ok: false, error: 'Method not allowed' });
});

/**
 * Legacy demo proxy root (optional)
 */
app.get('/proxy', verifyShopifyProxy, (req: Request, res: Response) => {
  const ping = (req.query?.ping as string) ?? '';
  if (ping) {
    res.status(200).json({
      ok: true,
      via: 'shopify-app-proxy',
      shop: req.query.shop,
      ts: req.query.timestamp
    });
    return;
  }
  res
    .status(200)
    .type('html')
    .send(`<div style="font:14px/1.4 system-ui">Proxy OK for ${req.query.shop || 'unknown shop'}</div>`);
});

/**
 * Direct (non-proxy) REST stub
 */
app.post('/api/instacart/cart', (req: Request, res: Response) => {
  const payload = req.body ?? {};
  res.status(200).json({
    ok: true,
    received: payload,
    cartUrl: 'https://www.instacart.com/store'
  });
});

// Admin landing (App URL target)
app.get('/', (_req: Request, res: Response) => {
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
        <p><strong>Storefront App Proxy tests (open in storefront):</strong></p>
        <ul>
          <li><code>https://heirclark.com/apps/instacart/health?ping=1</code></li>
          <li><code>https://heirclark.com/apps/instacart/build-list?ping=1</code></li>
        </ul>
      </div>
    `);
});

// Catch-all for 404 JSON
app.use((_req: Request, res: Response) => {
  res.status(404).json({ ok: false, error: 'Not found' });
});

// ----- Start server -----
const port = Number(process.env.PORT) || 3000;
app.listen(port, '0.0.0.0', () => {
  console.log(`Heirclark Instacart Backend running on port ${port}`);
});
