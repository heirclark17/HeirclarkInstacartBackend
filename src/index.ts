import 'dotenv/config';
import express from 'express';
import cors from 'cors';

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
