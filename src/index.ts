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

// keep this middleware
app.use(express.json({ limit: '1mb' }));

// HMAC check stays the same, but make sure this value matches your app proxy PATH:
const SHOPIFY_PROXY_PATH = process.env.SHOPIFY_PROXY_PATH || '/apps/instacart';

// --- App Proxy health/ping via GET
app.get('/proxy/build-list', verifyShopifyProxy, (req: Request, res: Response) => {
  // optional ping check like /apps/instacart/build-list?ping=1
  if (req.query.ping) {
    return res.status(200).json({
      ok: true,
      service: 'Heirclark Instacart Backend',
      time: new Date().toISOString()
    });
  }
  return res.status(200).json({ ok: true });
});

// --- Main button POST (Generate Instacart List)
app.post('/proxy/build-list', verifyShopifyProxy, (req: Request, res: Response) => {
  const payload = req.body ?? {};
  // For now just echo back that we received it; you’ll wire Instacart later
  return res.status(200).json({
    ok: true,
    received: payload,
    message: 'Proxy OK (next: call Instacart here)'
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
