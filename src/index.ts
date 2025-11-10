import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import cors, { CorsOptions } from 'cors';
import crypto from 'crypto';
import type { ParsedQs } from 'qs';

// ----- Config -----
const app = express();

// Allow multiple origins via comma-separated env (e.g. https://heirclark.com,https://admin.heirclark.com)
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

const corsOptions: CorsOptions = {
  origin(origin, callback) {
    if (!origin) return callback(null, true);                // curl / same-origin
    if (allowedOrigins.length === 0) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error(`CORS blocked for origin: ${origin}`));
  },
  credentials: false
};

app.use(cors(corsOptions));
app.use(express.json({ limit: '1mb' }));

// ===== Shopify App Proxy verification =====
const SHOPIFY_APP_SECRET = process.env.SHOPIFY_API_SECRET || '';
/**
 * When Shopify forwards a proxied request, the HMAC is computed over the
 * ORIGINAL storefront path & query, e.g. "/apps/instacart/build-list?..."
 * Prefer the "x-shopify-forwarded-path" header if sent. Otherwise, we fall
 * back to an env-configured prefix you control.
 */
const SHOPIFY_PROXY_FALLBACK_PATH = process.env.SHOPIFY_PROXY_FALLBACK_PATH || '/apps/instacart';

type QVal = string | string[] | undefined; // we’ll coerce ParsedQs → string below

function toStr(v: QVal): string {
  if (Array.isArray(v)) return String(v[0] ?? '');
  return (v ?? '') as string;
}

// Convert Express/qs query into plain strings (Shopify proxy sends flat strings)
function flattenQuery(q: ParsedQs): Record<string, string | string[] | undefined> {
  const out: Record<string, string | string[] | undefined> = {};
  for (const [k, v] of Object.entries(q)) {
    if (v == null) { out[k] = undefined; continue; }
    if (Array.isArray(v)) out[k] = v.map(x => (typeof x === 'string' ? x : String(x)));
    else out[k] = typeof v === 'string' ? v : String(v);
  }
  return out;
}

function getOriginalProxyPath(req: Request): string {
  // Shopify usually sends this header with the original path like "/apps/instacart/build-list"
  const hdr = req.headers['x-shopify-forwarded-path'];
  if (typeof hdr === 'string' && hdr.startsWith('/')) return hdr;
  // Fallback to a configured base path (you can set to "/apps/instacart/build-list" if you want to pin)
  return SHOPIFY_PROXY_FALLBACK_PATH;
}

function verifyShopifyProxy(req: Request, res: Response, next: NextFunction): void {
  try {
    // Coerce query into strings
    const q = flattenQuery(req.query as ParsedQs);

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

    // Build sorted query string WITHOUT "signature"
    const sortedPairs = Object.keys(rest)
      .sort()
      .map(k => {
        const val = rest[k];
        if (Array.isArray(val)) return `${k}=${toStr(val)}`;
        return `${k}=${toStr(val)}`;
      });

    const qs = sortedPairs.join('&');
    const originalPath = getOriginalProxyPath(req); // e.g. "/apps/instacart/build-list"
    const data = qs.length ? `${originalPath}?${qs}` : originalPath;

    const computed = crypto
      .createHmac('sha256', SHOPIFY_APP_SECRET)
      .update(data)
      .digest('hex');

    if (computed !== toStr(signature)) {
      res.status(401).send('Bad signature');
      return;
    }
    next();
  } catch (e) {
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
 * === App Proxy targets ===
 * Shopify App Proxy config:
 *   Subpath prefix: apps
 *   Subpath: instacart
 *   Proxy URL: https://<railway-app>.up.railway.app/proxy
 *
 * Storefront calls you want to support:
 *   GET  /apps/instacart/build-list?ping=1  → forwarded to GET  /proxy/build-list?ping=1
 *   POST /apps/instacart/build-list         → forwarded to POST /proxy/build-list
 *
 * Optional health probe through proxy:
 *   GET  /apps/instacart/health             → forwarded to GET  /proxy/health
 */

// Health through proxy (optional)
app.get('/proxy/health', verifyShopifyProxy, (req: Request, res: Response) => {
  res.status(200).json({ ok: true, via: 'shopify-app-proxy', endpoint: 'health' });
});

// Build-list proxy GET: support ?ping=1
app.get('/proxy/build-list', verifyShopifyProxy, (req: Request, res: Response) => {
  if (req.query.ping) {
    return res.status(200).json({
      ok: true,
      via: 'shopify-app-proxy',
      endpoint: 'build-list',
      shop: req.query.shop ?? null,
      ts: req.query.timestamp ?? null
    });
  }
  // If someone GETs without ping, just acknowledge
  res.status(200).json({ ok: true, via: 'shopify-app-proxy', endpoint: 'build-list' });
});

// Build-list proxy POST: your main action
app.post('/proxy/build-list', verifyShopifyProxy, (req: Request, res: Response) => {
  const payload = req.body ?? {};
  // TODO: transform payload → Instacart API here
  res.status(200).json({
    ok: true,
    received: payload,
    message: 'Instacart list created (stub).',
    cartUrl: 'https://www.instacart.com/store'
  });
});

// Non-proxy REST (optional)
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
        <h3>App Proxy (from storefront)</h3>
        <code>GET  /apps/instacart/build-list?ping=1</code><br/>
        <code>POST /apps/instacart/build-list</code>
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
