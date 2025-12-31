// src/middleware/auth.ts
// Zero-trust authentication middleware
// SOC2 Controls: CC6.1 Logical Access, CC6.2 Access Enforcement

import { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { logAuthSuccess, logAuthFailure } from "./auditMiddleware";

/**
 * JWT-like authentication middleware.
 * Uses HMAC-SHA256 for token signing (lightweight, no external dependencies).
 *
 * Token format: base64url(header).base64url(payload).base64url(signature)
 *
 * DEPRECATION NOTICE:
 * Legacy auth methods (X-Shopify-Customer-Id header, shopifyCustomerId param)
 * are deprecated and will be removed after 2025-01-30.
 * Migrate to: Authorization: Bearer <token>
 */

// Deprecation date for legacy auth methods (30 days from implementation)
const LEGACY_AUTH_DEPRECATION_DATE = new Date('2025-01-30T00:00:00Z');

export interface AuthPayload {
  customerId: string;
  iat: number;  // issued at (unix timestamp)
  exp: number;  // expires at (unix timestamp)
}

export interface AuthenticatedRequest extends Request {
  auth?: AuthPayload;
}

function base64urlEncode(data: string): string {
  return Buffer.from(data)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64urlDecode(data: string): string {
  const padded = data + "=".repeat((4 - (data.length % 4)) % 4);
  return Buffer.from(padded.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString();
}

function sign(payload: string, secret: string): string {
  return crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Create an authentication token for a customer.
 */
export function createToken(customerId: string, secret: string, expiresIn: string = "7d"): string {
  const now = Math.floor(Date.now() / 1000);

  // Parse expiresIn (e.g., "7d", "24h", "60m")
  let expiresInSeconds = 7 * 24 * 60 * 60; // default 7 days
  const match = expiresIn.match(/^(\d+)(d|h|m|s)$/);
  if (match) {
    const value = parseInt(match[1], 10);
    const unit = match[2];
    switch (unit) {
      case "d": expiresInSeconds = value * 24 * 60 * 60; break;
      case "h": expiresInSeconds = value * 60 * 60; break;
      case "m": expiresInSeconds = value * 60; break;
      case "s": expiresInSeconds = value; break;
    }
  }

  const header = { alg: "HS256", typ: "JWT" };
  const payload: AuthPayload = {
    customerId,
    iat: now,
    exp: now + expiresInSeconds,
  };

  const headerB64 = base64urlEncode(JSON.stringify(header));
  const payloadB64 = base64urlEncode(JSON.stringify(payload));
  const signature = sign(`${headerB64}.${payloadB64}`, secret);

  return `${headerB64}.${payloadB64}.${signature}`;
}

/**
 * Verify and decode an authentication token.
 */
export function verifyToken(token: string, secret: string): AuthPayload | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;

    const [headerB64, payloadB64, signature] = parts;

    // Verify signature
    const expectedSig = sign(`${headerB64}.${payloadB64}`, secret);
    if (signature !== expectedSig) return null;

    // Decode payload
    const payload = JSON.parse(base64urlDecode(payloadB64)) as AuthPayload;

    // Check expiration
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp < now) return null;

    return payload;
  } catch {
    return null;
  }
}

/**
 * Check if legacy auth methods should still be allowed
 */
function isLegacyAuthAllowed(): boolean {
  return new Date() < LEGACY_AUTH_DEPRECATION_DATE;
}

/**
 * Add deprecation warning headers for legacy auth
 */
function addDeprecationWarning(res: Response, method: string): void {
  const deprecationDate = LEGACY_AUTH_DEPRECATION_DATE.toISOString().split('T')[0];
  res.setHeader('X-Auth-Deprecation-Warning',
    `${method} is deprecated and will be removed after ${deprecationDate}. ` +
    'Migrate to: Authorization: Bearer <token>'
  );
  res.setHeader('Deprecation', deprecationDate);
  res.setHeader('Sunset', LEGACY_AUTH_DEPRECATION_DATE.toUTCString());
}

/**
 * Authentication middleware.
 * Extracts and validates JWT from Authorization header.
 *
 * Auth methods (in priority order):
 * 1. Authorization: Bearer <token> (RECOMMENDED)
 * 2. X-Shopify-Customer-Id header (DEPRECATED - removed after 2025-01-30)
 * 3. shopifyCustomerId query/body parameter (DEPRECATED - removed after 2025-01-30)
 */
export function authMiddleware(options: { required?: boolean } = {}) {
  const { required = true } = options;

  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const secret = process.env.JWT_SECRET;

    if (!secret) {
      console.error("[auth] JWT_SECRET not configured");
      logAuthFailure(req, "JWT_SECRET not configured");
      if (required) {
        return res.status(500).json({ ok: false, error: "Authentication not configured" });
      }
      return next();
    }

    // Try Bearer token first (recommended method)
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith("Bearer ")) {
      const token = authHeader.slice(7);
      const payload = verifyToken(token, secret);

      if (payload) {
        req.auth = payload;
        logAuthSuccess(req, payload.customerId, 'jwt');
        return next();
      }

      logAuthFailure(req, "Invalid or expired JWT token");
      if (required) {
        return res.status(401).json({ ok: false, error: "Invalid or expired token" });
      }
    }

    // Legacy: X-Shopify-Customer-Id header (DEPRECATED)
    const legacyHeader = req.headers["x-shopify-customer-id"] as string | undefined;
    if (legacyHeader) {
      if (!isLegacyAuthAllowed()) {
        logAuthFailure(req, "Legacy X-Shopify-Customer-Id header no longer accepted");
        return res.status(401).json({
          ok: false,
          error: "X-Shopify-Customer-Id authentication is no longer supported. Use Bearer token.",
        });
      }

      // Allow but warn
      console.warn(`[auth] DEPRECATED: X-Shopify-Customer-Id header used by ${legacyHeader}`);
      addDeprecationWarning(res, 'X-Shopify-Customer-Id header');

      req.auth = {
        customerId: legacyHeader.trim(),
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600, // 1 hour validity for legacy
      };
      logAuthSuccess(req, legacyHeader.trim(), 'legacy_header');
      return next();
    }

    // Legacy: query/body parameter (DEPRECATED)
    const legacyQuery = (req.query?.shopifyCustomerId as string) || "";
    const legacyBody = (req.body as any)?.shopifyCustomerId || "";
    const legacyId = String(legacyQuery || legacyBody || "").trim();

    if (legacyId) {
      if (!isLegacyAuthAllowed()) {
        logAuthFailure(req, "Legacy shopifyCustomerId parameter no longer accepted");
        return res.status(401).json({
          ok: false,
          error: "shopifyCustomerId parameter is no longer supported. Use Bearer token.",
        });
      }

      // Allow but warn
      console.warn(`[auth] DEPRECATED: shopifyCustomerId param used by ${legacyId}`);
      addDeprecationWarning(res, 'shopifyCustomerId parameter');

      req.auth = {
        customerId: legacyId,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
      };
      logAuthSuccess(req, legacyId, 'legacy_param');
      return next();
    }

    if (required) {
      logAuthFailure(req, "No authentication provided");
      return res.status(401).json({ ok: false, error: "Authentication required" });
    }

    next();
  };
}

/**
 * Helper to get customer ID from authenticated request.
 */
export function getCustomerId(req: AuthenticatedRequest): string | null {
  return req.auth?.customerId || null;
}

export default authMiddleware;
