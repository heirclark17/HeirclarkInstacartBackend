// src/index.ts
import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import cors, { CorsOptions } from 'cors';
import crypto from 'crypto';

// ---------------------------
// Basic app & CORS (for direct calls only; App Proxy doesn't need CORS)
// ---------------------------
const app = express();

const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const corsOptions: CorsOptions = {
  origin(origin, cb) {
    if (!origin) return cb(null, true); // curl / server-to-server
    if (allowedOrigins.length === 0) return cb(null, true);
    if (allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error(`CORS blocked for origin: ${origin}`));
  },
  credentials: false,
};

app.use(cors(corsOptions));
app.use(express.json({ limit: '1mb' }));

// ---------------------------
// Shopify App Proxy verification
// ---------------------------
const SHOPIFY_APP_SECRET = process.env.SHOPIFY_API_SECRET || '';
/**
 * Must equal your public storefront base path, e.g. "/apps/instacart"
 * from Shopify App Proxy: Subpath prefix "apps" + Subpath "instacart".
 */
const SHOPIFY_PROXY_PUBLIC_BASE = process.env.SHOPIFY_PROXY_PUBLIC_BASE || '/apps/instacart';

/**
 * We mount all proxy targets under /proxy on the backend. Shopify forwards:
 *   /apps/instacart/<suffix>  --->  https://backend/proxy/<suffix>
 */
const PROXY_BACKEND_MOUNT = '/proxy';

/**
 * Build the *public* path (the one Shopify used to sign), by taking the backend
 * path after the /proxy mount and prefixing with the public base.
 * Example:
 *   req.path === "/proxy/build-list"  ->  "/apps/instacart/build-list"
 */
function publicPathForRequest(req: Request): string {
  const suffix = req.path.replace(PROXY_BACKEND_MOUNT, '') || '';
  return `${SHOPIFY_PROXY_PUBLIC_BASE}${suffix}`;
}

/**
 * Get the *original* query string exactly as Shopify sent it, but remove
 * the trailing &signature=... (order must be preserved!).
 */
function originalQueryWithoutSignature(req: Request): string {
  const original = req.originalUrl; // e.g. /proxy/build-list?shop=...&timestamp=...&signature=abc
  const qIndex = original.indexOf('?');
  if (qIndex < 0) return '';
  const raw = original.slice(qIndex + 1);
  // Remove only the signature parameter; keep order of the rest intact
  return raw
    .split('&')
    .filter((pair) => !pair.startsWith('signature='))
    .join('&');
}

// index.ts (replace your verifyShopifyProxy with this)
const SHOPIFY_PUBLIC_PREFIX = process.env.SHOPIFY_PUBLIC_PREFIX || '/apps/instacart';

function verifyShopifyProxy(req: Request, res: Response, next: NextFunction): void {
  try {
    const q = req.query as Record<string, QVal>;
    const { signature, ...rest } = q;

    if (!signature) return void res.status(401).send('Missing signature');
    if (!SHOPIFY_APP_SECRET) return void res.status(401).send('No app secret');

    // 1) Sort params (excluding signature)
    const sorted = Object.keys(rest)
      .sort()
      .map(k => `${k}=${toStr(rest[k])}`)
      .join('&');

    // 2) Build the EXACT public path Shopify used to sign:
    //    <public prefix><actual route on the proxy>
    //    e.g. /apps/instacart + /build-list  => /apps/instacart/build-list
    const publicPath = `${SHOPIFY_PUBLIC_PREFIX}${req.path}`;

    // 3) HMAC over "<publicPath>?<sorted>" (omit '?' if no params)
    const data = sorted ? `${publicPath}?${sorted}` : publicPath;

    const computed = crypto.createHmac('sha256', SHOPIFY_APP_SECRET).update(data).digest('hex');
    if (computed !== toStr(signature)) return void res.status(401).send('Bad signature');

    next();
  } catch {
    res.status(401).send('Signature check failed');
  }
}


// ---------------------------
// Public API (direct/backend checks)
// ---------------------------
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

// ---------------------------
// App Proxy endpoints (Shopify → your backend)
// Public path seen by Shopify:  /apps/instacart/*
// Backend path implemented here: /proxy/*
// ---------------------------

// Simple GET for quick ping
app.get('/build-list', verifyShopifyProxy, (req, res) => {
  if (req.query.ping) return res.json({ ok: true, via: 'proxy-get' });
  res.json({ ok: true });
});

// Your POST for Generate List
app.post('/build-list', verifyShopifyProxy, (req, res) => {
  const payload = req.body ?? {};
  // TODO: call your Instacart logic here
  res.json({ ok: true, received: payload, cartUrl: 'https://www.instacart.com/store' });
});

// Real POST handler used by your “Generate Instacart List” button
// Frontend calls (via App Proxy):  fetch('/apps/instacart/build-list', { method:'POST', ... })
app.post(`${PROXY_BACKEND_MOUNT}/build-list`, verifyShopifyProxy, (req, res) => {
  const payload = req.body ?? {};
  // TODO: Replace this stub with your Instacart integration.
  // For now we echo what we received so you can confirm the flow end-to-end.
  res.status(200).json({
    ok: true,
    received: payload,
    cartUrl: 'https://www.instacart.com/store',
  });
});

// Optional health under the proxy namespace so you can test:
//   https://heirclark.com/apps/instacart/api/health  →  forwards to  /proxy/api/health
app.get(`${PROXY_BACKEND_MOUNT}/api/health`, verifyShopifyProxy, (_req, res) => {
  res.status(200).json({ ok: true, service: 'Proxy health', time: new Date().toISOString() });
});

// ---------------------------
// Admin landing
// ---------------------------
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
        <p><strong>Storefront App Proxy tests:</strong></p>
        <ol>
          <li>Open your storefront and visit <code>${SHOPIFY_PROXY_PUBLIC_BASE}/api/health</code></li>
          <li>Open your storefront and visit <code>${SHOPIFY_PROXY_PUBLIC_BASE}/build-list?ping=1</code></li>
        </ol>
      </div>
    `);
});

// ---------------------------
// 404 fallback (JSON)
// ---------------------------
app.use((_req, res) => {
  res.status(404).json({ ok: false, error: 'Not found' });
});

// ---------------------------
// Start server
// ---------------------------
const port = Number(process.env.PORT) || 3000;
app.listen(port, '0.0.0.0', () => {
  console.log(`Heirclark Instacart Backend running on port ${port}`);
});
