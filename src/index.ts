import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import crypto from 'crypto';

// ----- Config -----
const app = express();

// Allow multiple origins via comma-separated env (e.g. https://heirclark.com,https://admin.heirclark.com)
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, cb) => {
      // Allow same-origin / curl / server-to-server (no origin)
      if (!origin) return cb(null, true);
      if (allowedOrigins.length === 0) return cb(null, true); // allow all if not set
      if (allowedOrigins.includes(origin)) return cb(null, true);
      return cb(new Error(`CORS blocked for origin: ${origin}`));
    },
    credentials: false
  })
);

app.use(express.json({ limit: '1mb' }));

// ===== Shopify App Proxy verification (recommended) =====
/**
 * Verifies the HMAC signature for App Proxy requests.
 * Shopify computes HMAC over: "<shopifyProxyPath>?<sortedQueryString>"
 * where shopifyProxyPath is the public storefront path (e.g. "/apps/heirclark").
 */
const SHOPIFY_APP_SECRET = process.env.SHOPIFY_API_SECRET || '';
const SHOPIFY_PROXY_PATH = process.env.SHOPIFY_PROXY_PATH || '/apps/heirclark'; // must match your App Proxy

function verifyShopifyProxy(req, res, next) {
  try {
    const { signature, ...rest } = req.query || {};
    if (!signature) {
      return res.status(401).send('Missing signature');
    }
    if (!SHOPIFY_APP_SECRET) {
      // Allow through but warn if you haven't set your secret yet.
      console.warn('WARNING: SHOPIFY_API_SECRET not set; skipping signature validation.');
      return next();
    }

    // Build sorted query string excluding "signature"
    const sortedPairs = Object.keys(rest)
      .sort()
      .map(k => `${k}=${rest[k]}`);
    const qs = sortedPairs.join('&');

    // HMAC over "<public path>?<sorted qs>"
    const data = qs.length ? `${SHOPIFY_PROXY_PATH}?${qs}` : SHOPIFY_PROXY_PATH;

    const computed = crypto
      .createHmac('sha256', SHOPIFY_APP_SECRET)
      .update(data)
      .digest('hex');

    if (computed !== signature) {
      return res.status(401).send('Bad signature');
    }
    return next();
  } catch (err) {
    return res.status(401).send('Signature check failed');
  }
}

// ----- Routes -----

// Health (for Railway + browser checks)
app.get('/api/health', (_req, res) => {
  res.status(200).json({
    ok: true,
    service: 'Heirclark Instacart Backend',
    time: new Date().toISOString()
  });
});

// Simple version endpoint (optional)
app.get('/api/version', (_req, res) => {
  res.json({ version: process.env.npm_package_version || '1.0.0' });
});

/**
 * Shopify App Proxy target
 * Your App Proxy config:
 *   Subpath prefix: apps
 *   Subpath: heirclark
 *   Proxy URL: https://heirclarkinstacartbackend-production.up.railway.app/proxy
 *
 * Test in browser:
 *   https://heirclark.com/apps/heirclark?ping=1
 */
app.get('/proxy', verifyShopifyProxy, (req, res) => {
  // You can branch behavior by query params here
  const { ping } = req.query;

  if (ping) {
    return res.status(200).json({
      ok: true,
      via: 'shopify-app-proxy',
      shop: req.query.shop,
      ts: req.query.timestamp
    });
  }

  // Example: return HTML that can be embedded on the storefront
  res
    .status(200)
    .type('html')
    .send(`<div style="font:14px/1.4 system-ui">Proxy OK for ${req.query.shop || 'unknown shop'}</div>`);
});

/**
 * Placeholder endpoint your Shopify section can call when
 * you wire in Instacart later. Accepts a weekly macro plan
 * and responds with a stub “cartUrl”.
 *
 * POST /api/instacart/cart
 * {
 *   "weekOf": "2025-11-10",
 *   "plan": [{ day: "Mon", meals: [...] }],
 *   "macros": { calories: 2400, protein: 180, fat: 70, carbs: 270 }
 * }
 */
app.post('/api/instacart/cart', (req, res) => {
  const payload = req.body ?? {};
  // TODO: translate plan -> ingredients -> Instacart link
  return res.status(200).json({
    ok: true,
    received: payload,
    // Replace with your real cart URL generator when ready:
    cartUrl: 'https://www.instacart.com/store'
  });
});

// Catch-all for 404 JSON
app.use((_req, res) => {
  res.status(404).json({ ok: false, error: 'Not found' });
});

// ----- Start server -----
const port = Number(process.env.PORT) || 3000;
// Railway requires 0.0.0.0
app.listen(port, '0.0.0.0', () => {
  console.log(`Heirclark Instacart Backend running on port ${port}`);
});
