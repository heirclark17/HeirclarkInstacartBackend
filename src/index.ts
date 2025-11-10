import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import cors, { CorsOptions } from 'cors';
import crypto from 'crypto';

const app = express();

/* ========= CORS (for direct /api/* tests, not used by App Proxy) ========= */
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

const corsOptions: CorsOptions = {
  origin(origin, cb) {
    if (!origin) return cb(null, true);                     // server-to-server, curl, etc.
    if (allowedOrigins.length === 0) return cb(null, true); // allow all if not configured
    return cb(null, allowedOrigins.includes(origin));
  },
  credentials: false
};

app.use(cors(corsOptions));
app.use(express.json({ limit: '1mb' }));

/* ========= App Proxy verification =========
   Shopify signs the public path the shopper hits:
     e.g. /apps/instacart/build-list?shop=...&timestamp=...&signature=...
   Shopify then forwards to your backend at:
     https://<your-backend>/proxy/build-list
   We must recreate the *public* path and HMAC it with SHOPIFY_API_SECRET.
*/
const SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET || '';
const PUBLIC_PREFIX = process.env.SHOPIFY_PUBLIC_PREFIX || '/apps';
const PUBLIC_SUBPATH = process.env.SHOPIFY_PUBLIC_SUBPATH || '/instacart'; // begin with slash
const BACKEND_PROXY_BASE = process.env.SHOPIFY_PROXY_BASE || '/proxy';      // where Shopify points to on your server

type QVal = string | string[] | undefined;
const toStr = (v: QVal) => (Array.isArray(v) ? v[0] ?? '' : v ?? '');

function verifyShopifyProxy(req: Request, res: Response, next: NextFunction) {
  try {
    // 1) Extract and remove signature from the query
    const q = req.query as Record<string, QVal>;
    const signature = toStr(q.signature);
    if (!signature) return res.status(401).send('Missing signature');

    if (!SHOPIFY_API_SECRET) {
      console.warn('WARNING: SHOPIFY_API_SECRET not set; skipping signature validation.');
      return next();
    }

    // 2) Sort remaining query into "k=v" pairs
    const pairs = Object.keys(q)
      .filter(k => k !== 'signature')
      .sort()
      .map(k => `${k}=${toStr(q[k])}`);
    const sortedQS = pairs.join('&');

    // 3) Reconstruct the *public* path that Shopify signed.
    //    Example: if our backend route is /proxy/build-list, then
    //    the public path is /apps/instacart/build-list
    let tail = req.path.startsWith(BACKEND_PROXY_BASE)
      ? req.path.slice(BACKEND_PROXY_BASE.length)
      : req.path; // includes "/build-list"
    if (!tail.startsWith('/')) tail = `/${tail}`;

    const publicPath = `${PUBLIC_PREFIX}${PUBLIC_SUBPATH}${tail}`; // "/apps/instacart/build-list"

    const data = sortedQS ? `${publicPath}?${sortedQS}` : publicPath;

    // 4) Compute HMAC
    const computed = crypto.createHmac('sha256', SHOPIFY_API_SECRET).update(data).digest('hex');

    if (computed !== signature) return res.status(401).send('Bad signature');
    return next();
  } catch (e) {
    return res.status(401).send('Signature check failed');
  }
}

/* ===================== Basic API checks ===================== */
app.get('/api/health', (_req, res) =>
  res.status(200).json({ ok: true, service: 'Heirclark Instacart Backend', time: new Date().toISOString() })
);

app.get('/api/version', (_req, res) =>
  res.json({ version: process.env.npm_package_version || '1.0.0' })
);

/* ===================== App Proxy endpoints ===================== */
/* Middleware: verify signature for EVERYTHING under /proxy/* */
app.use(`${BACKEND_PROXY_BASE}/*`, verifyShopifyProxy);

/* Ping (optional): GET https://heirclark.com/apps/instacart?ping=1  ->  forwards to*
