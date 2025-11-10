import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import cors, { CorsOptions } from 'cors';
import crypto from 'crypto';

// ---------- Config ----------
const app = express();

const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

const corsOptions: CorsOptions = {
  origin(origin, cb) {
    if (!origin) return cb(null, true);                // same-origin, curl, server-to-server
    if (allowedOrigins.length === 0) return cb(null, true);
    if (allowedOrigins.includes(origin)) return cb(null, true);
    return cb(new Error(`CORS blocked for origin: ${origin}`));
  },
  credentials: false
};

app.use(cors(corsOptions));
app.use(express.json({ limit: '1mb' }));

// ---------- Shopify App Proxy verification ----------
const SHOPIFY_APP_SECRET = process.env.SHOPIFY_API_SECRET || '';
const PUBLIC_PREFIX = process.env.SHOPIFY_PROXY_PUBLIC_PREFIX || 'apps';
const PUBLIC_SUBPATH = process.env.SHOPIFY_PUBLIC_SUBPATH || 'instacart';
const PUBLIC_BUILD_PATH = `/${PUBLIC_PREFIX}/${PUBLIC_SUBPATH}/build-list`;

// Express' req.query is untyped (ParsedQs). We'll coerce to a simple record of strings.
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

    // Build the canonical string: "<public proxy path>?<sorted query without signature>"
    const sortedPairs = Object.keys(rest)
      .sort()
      .map(k => `${k}=${toStr(rest[k])}`);
    const qs = sortedPairs.join('&');
    const data = qs ? `${PUBLIC_BUILD_PATH}?${qs}` : PUBLIC_BUILD_PATH;

    const expected = crypto.createHmac('sha256', SHOPIFY_APP_SECRET)
      .update(data)
      .digest('hex');

    if (expected !== toStr(signature)) {
      res.status(401).send('Bad signature');
      return;
    }
    next();
  } catch {
    res.status(401).send('Signature check failed');
  }
}

// ---------- Routes ----------

// Health (for Railway + quick browser check)
app.get('/api/health', (_req, res) =>
  res.status(200).json({ ok: true, service: 'Heirclark Instacart Backend', time: new Date().toISOString() })
);

// Optional version endpoint
app.get('/api/version', (_req, res) => {
  res.json({ version: process.env.npm_package_version || '1.0.0' });
});

/**
 * PUBLIC App Proxy endpoints (Shopify calls these at /apps/instacart/build-list[…])
 * We mount the backend handlers under /proxy/build-list and verify with the HMAC above.
 */
app.get('/proxy/build-list', verifyShopifyProxy, (req: Request, res: Response) => {
  // e.g., /apps/instacart/build-list?ping=1
  if (req.query.ping) {
    return res.status(200).json({
      ok: true,
      via: 'shopify-app-proxy',
      shop: req.query.shop,
      time: new Date().toISOString()
    });
  }
  return res.status(200).json({ ok: true });
});

app.post('/proxy/build-list', verifyShopifyProxy, (req: Request, res: Response) => {
  // TODO: create cart with Instacart later; for now, echo payload
  const payload = req.body ?? {};
  return res.status(200).json({
    ok: true,
    received: payload,
    message: 'Build list stub',
    cartUrl: 'https://www.instacart.com/store'
  });
});

// Admin landing page
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
        <p><strong>Storefront App Proxy test</strong>: open your storefront and run<br/>
        <code>fetch('/apps/instacart/build-list?ping=1').then(r=>r.json())</code></p>
      </div>
    `);
});

// JSON 404
app.use((_req, res) => res.status(404).json({ ok: false, error: 'Not found' }));

// ---------- Start ----------
const port = Number(process.env.PORT) || 3000;
app.listen(port, '0.0.0.0', () => {
  console.log(`Heirclark Instacart Backend running on port ${port}`);
});
