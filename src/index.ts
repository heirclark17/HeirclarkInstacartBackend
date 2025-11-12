// index.ts
import express from 'express';
import crypto from 'crypto';

const app = express();
app.use(express.json());

// --- HMAC just for POST ---
function verifyAppProxy(req: any, res: any, next: any) {
  const secret = process.env.SHOPIFY_API_SECRET;  // MUST be set in Railway → Variables
  if (!secret) return res.status(500).json({ ok:false, error: 'Missing SHOPIFY_API_SECRET' });

  const q: Record<string, unknown> = { ...req.query };
  const sig = String(q.signature || '');
  delete (q as any).signature;

  const ordered = Object.keys(q).sort().map(k => {
    const v = Array.isArray(q[k]) ? (q[k] as any[]).join(',') : (q[k] ?? '').toString();
    return `${k}=${v}`;
  }).join('');

  const hmac = crypto.createHmac('sha256', secret).update(ordered, 'utf8').digest('hex');
  if (sig !== hmac) return res.status(401).json({ ok:false, error: 'Bad signature' });
  return next();
}

// --- HEALTH (GET) — leave OPEN, no HMAC ---
app.get('/proxy/build-list', (req, res) => {
  res.json({ ok: true, via: 'app-proxy', ping: req.query.ping ?? null });
});

// --- REAL ACTION (POST) — PROTECTED ---
app.post('/proxy/build-list', verifyAppProxy, async (req, res, next) => {
  try {
    const { start, plan, recipeLandingUrl } = req.body || {};
    // TODO: build Instacart list here
    return res.json({ ok: true, message: 'Instacart list created (proxy).' });
  } catch (err) {
    next(err);
  }
});

// --- JSON error handler so the theme sees JSON, not HTML ---
app.use((err: any, _req: any, res: any, _next: any) => {
  console.error('Proxy error:', err);
  res.status(500).json({ ok: false, error: err?.message || 'Server error' });
});

app.listen(process.env.PORT || 8080, () => {
  console.log('Heirclark Instacart backend (proxy) running');
});
