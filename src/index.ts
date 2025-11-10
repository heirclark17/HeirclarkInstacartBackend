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
// IMPORTANT: this must match your App Proxy public path exactly
//   Prefix: apps, Subpath: instacart  ->  /apps/instacart
const SHOPIFY_PROXY_PATH = process.env.SHOPIFY_PROXY_PATH || '/apps/instacart';

// Helper to coerce Express query values to strings
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
 * Shopify App Proxy target (optional GET)
 *   Storefront test: https://heirclark.com/apps/instacart?ping=1
 *   Proxies to this server's /proxy
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
 * === NEW ===
 * App Proxy POST used by your "Generate Instacart List" button
 * Frontend calls:  POST  /apps/instacart/build-list
 * Shopify forwards to this server: POST /build-list  (signature in query string)
 */
app.post('/build-list', verifyShopifyProxy, (req: Request, res: Response) => {
  // Payload sent from the theme/js
  const { start, plan, recipeLandingUrl } = (req.body ?? {}) as {
    start?: string;
    plan?: unknown;
    recipeLandingUrl?: string;
  };

  // TODO: Replace this stub with your Instacart API integration.
  // For now, just echo and return a placeholder cart URL.
  return res.status(200).json({
    ok: true,
    message: 'Instacart list created (stub).',
    received: { start, plan, recipeLandingUrl },
    cartUrl: 'https://www.instacart.com/store'
  });
});

/**
 * Direct REST fallback (not used when you have App Proxy configured)
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
        <p><strong>Storefront App Proxy test (open in storefront):</strong><br/>
        Visit <code>https://heirclark.com/apps/instacart?ping=1</code> in a storefront tab.</p>
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
