// src/proxy.ts
import type { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import qs from 'qs';

const APP_PROXY_SECRET = process.env.SHOPIFY_API_SECRET!; // same as in your Shopify app

function verifyAppProxySignature(req: Request): boolean {
  // Shopify sends ?signature=<md5> alongside other query params
  const { signature, ...rest } = req.query as Record<string, unknown>;

  // Build the query string with keys sorted and RFC1738 encoding (space => +)
  const sorted = Object.keys(rest).sort().reduce<Record<string, unknown>>((acc, k) => {
    acc[k] = (rest as any)[k];
    return acc;
  }, {});
  const serialized = qs.stringify(sorted, { encode: true, sort: (a, b) => a.localeCompare(b), format: 'RFC1738' });

  const digest = crypto.createHash('md5').update(APP_PROXY_SECRET + serialized).digest('hex');
  const sig = typeof signature === 'string' ? signature : Array.isArray(signature) ? signature[0] : '';

  return crypto.timingSafeEqual(Buffer.from(digest, 'utf8'), Buffer.from(sig, 'utf8'));
}

export function requireAppProxy(req: Request, res: Response, next: NextFunction) {
  try {
    if (!verifyAppProxySignature(req)) {
      return res.status(401).json({ ok: false, error: 'Bad signature' });
    }
    return next();
  } catch (e) {
    return res.status(401).json({ ok: false, error: 'Signature validation error' });
  }
}

// Routes mounted under /proxy
export function registerProxyRoutes(app: import('express').Express) {
  // Health/ping for your front-end GET ?ping=1 probe
  app.get('/proxy/build-list', requireAppProxy, (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.status(200).json({ ok: true, message: 'proxy healthy' });
  });

  // Create the Instacart list (payload comes from your JS)
  app.post('/proxy/build-list', requireAppProxy, (req, res) => {
    // Example: validate body then do your logic
    const { start, plan, recipeLandingUrl } = req.body || {};
    if (!start || !Array.isArray(plan)) {
      return res.status(400).json({ ok: false, error: 'Invalid payload' });
    }

    // TODO: call your Instacart logic here…

    res.status(200).json({ ok: true, message: 'Instacart list created.' });
  });
}
