import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import cors, { CorsOptions } from 'cors';
import crypto from 'crypto';

// ----------------------------
// Config
// ----------------------------
const app = express();

// Comma-separated list, e.g. "https://heirclark.com,https://admin.shopify.com"
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

// CORS (not used when you go through App Proxy, but kept for direct tests)
const corsOptions: CorsOptions = {
  origin(origin, cb) {
    if (!origin) return cb(null, true);
    if (allowedOrigins.length === 0) return cb(null, true);
    if (allowedOrigins.includes(origin)) return cb(null, true);
    return cb(new Error(`CORS blocked for origin: ${origin}`));
  },
  credentials: false
};
app.use(cors(corsOptions));
app.use(express.json({ limit: '1mb' }));

// ----------------------------
// Shopify App Proxy verification
// ----------------------------
// IMPORTANT: this MUST match the public proxy prefix you configured in Shopify
//   Dev dashboard → App → App proxy →
//     Subpath prefix:  apps
//     Subpath:         instacart
//
// Requests your theme makes to:
//   /apps/instacart/build-list
// are forwarded by Shopify to your backend Proxy URL, e.g.:
//   https://<railway-host>/proxy/build-list
//
// For HMAC, Shopify expects you to sign the *public* path it received
//   (e.g. "/apps/instacart/build-list?sorted=query") using SHOPIFY_API_SECRET.

const SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET || '';
const PUBLIC_PROXY_PREFIX = process.env.SHOPIFY_PROXY_PUBLIC_PREFIX || '/apps/instacart'; // do NOT include trailing slash

type QVal = string | string[] | undefined;
const toStr = (v: QVal): string => (Array.isArray(v) ? (v[0] ?? '') : (v ?? ''));

// Build the public path used for signature: PUBLIC_PREFIX + (backend path minus "/proxy")
function publicPathFor(req: Request): string {
  // e.g. req.path === "/proxy/build-list"  -> suffix "/build-list"
  const suffix = req.path.replace(/^\/proxy/, '');
  return `${PUBLIC_PROXY_PREFIX}${suffix}`;
}

function verifyShopifyProxy(req: Request, res: Response, next: NextFunction): void {
  const q = req.query as Record<string, QVal>;
  const receivedSig = toStr(q.signature);

  if (!receivedSig) {
    res.status(401).send('Missing signature');
    return;
  }
  if (!SHOPIFY_API_SECRET) {
    console.warn('WARNING: SHOPIFY_API_SECRET not set; skipping signature validation.');
    next();
    return;
  }

  // Remove signature from query and sort the rest
  const { signature, ...rest } = q;
  const sortedPairs = Object.keys(rest)
    .sort()
    .map(k => `${k}=${toStr(rest[k])}`);
  const qs = sortedPairs.join('&');

  const pubPath = publicPathFor(req); // e.g. "/apps/instacart/build-list"
  const data = qs.length ? `${pubPath}?${qs}` : pubPath;

  const computed = crypto.createHmac('sha256', SHOPIFY_API_SECRET).update(data).digest('hex');

  if (computed !== receivedSig) {
    res.status(401).send('Bad signature');
    return;
  }
  next();
}

// ----------------------------
// Health & version
// ----------------------------
app.get('/api/health', (_req, res) =>
  res.status(200).json({ ok: true, service: 'Heirclark Instacart Backend', time: new Date().toISOString() })
);
app.get('/api/version', (_req, res) => res.json({ version: process.env.npm_package_version || '1.0.0' }));

// ----------------------------
// App Proxy endpoints
// Public →  /apps/instacart/build-list[?ping=1]
// Backend → /proxy/build-list
// ----------------------------

// Quick GET ping (useful for debugging the signature)
app.get('/proxy/build-list', verifyShopifyProxy, (req, res) => {
  if (toStr(req.query.ping)) {
    return res.status(200).json({
      ok: true,
      via: 'shopify-app-proxy',
      service: 'Heirclark Instacart Backend',
      time: new Date().toISOString()
    });
  }
  // If someone GETs without ping, just acknowledge
  res.status(200).json({ ok: true, via: 'shopify-app-proxy' });
});

// Primary POST handler called by your “Generate Instacart List” button
app.post('/proxy/build-list', verifyShopifyProxy, (req, res) => {
  // Payload shape from the widget
  // { start: 'YYYY-MM-DD', plan: [...], recipeLandingUrl: '/collections/recipes' }
  const payload = req.body ?? {};

  // TODO: exchange with Instacart here...
  // For now, echo back success with placeholder URL.
  return res.status(200).json({
    ok: true,
    message: 'Instacart list created (stub)',
    cartUrl: 'https://www.instacart.com/store',
    received: payload
  });
});

// Admin landing
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
        <p>Storefront proxy test (open from a storefront tab): <code>/apps/instacart/build-list?ping=1</code></p>
      </div>
    `);
});

// JSON 404
app.use((_req, res) => res.status(404).json({ ok: false, error: 'Not found' }));

// Start
const port = Number(process.env.PORT) || 3000;
app.listen(port, '0.0.0.0', () => {
  console.log(`Heirclark Instacart Backend running on port ${port}`);
});
