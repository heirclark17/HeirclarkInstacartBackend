// src/middleware/auth.ts
import { Request, Response, NextFunction } from "express";
import crypto from "crypto";

/**
 * JWT-like authentication middleware.
 * Uses HMAC-SHA256 for token signing (lightweight, no external dependencies).
 *
 * Token format: base64url(header).base64url(payload).base64url(signature)
 */

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
 * Authentication middleware.
 * Extracts and validates JWT from Authorization header or query parameter.
 *
 * Supports multiple auth methods for backward compatibility:
 * 1. Authorization: Bearer <token>
 * 2. X-Shopify-Customer-Id header (legacy, for gradual migration)
 * 3. shopifyCustomerId query/body parameter (legacy)
 */
export function authMiddleware(options: { required?: boolean } = {}) {
  const { required = true } = options;

  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const secret = process.env.JWT_SECRET;

    if (!secret) {
      console.error("JWT_SECRET not configured");
      if (required) {
        return res.status(500).json({ ok: false, error: "Authentication not configured" });
      }
      return next();
    }

    // Try Bearer token first
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith("Bearer ")) {
      const token = authHeader.slice(7);
      const payload = verifyToken(token, secret);

      if (payload) {
        req.auth = payload;
        return next();
      }

      if (required) {
        return res.status(401).json({ ok: false, error: "Invalid or expired token" });
      }
    }

    // Legacy: X-Shopify-Customer-Id header
    const legacyHeader = req.headers["x-shopify-customer-id"] as string | undefined;
    if (legacyHeader) {
      req.auth = {
        customerId: legacyHeader.trim(),
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600, // 1 hour validity for legacy
      };
      return next();
    }

    // Legacy: query/body parameter
    const legacyQuery = (req.query?.shopifyCustomerId as string) || "";
    const legacyBody = (req.body as any)?.shopifyCustomerId || "";
    const legacyId = String(legacyQuery || legacyBody || "").trim();

    if (legacyId) {
      req.auth = {
        customerId: legacyId,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
      };
      return next();
    }

    if (required) {
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
