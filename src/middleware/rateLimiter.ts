// src/middleware/rateLimiter.ts
import { Request, Response, NextFunction } from "express";

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

/**
 * Simple in-memory rate limiter.
 * For production, consider using Redis for distributed rate limiting.
 */
class RateLimiter {
  private store = new Map<string, RateLimitEntry>();
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    // Cleanup expired entries every minute
    this.cleanupInterval = setInterval(() => this.cleanup(), 60000);
  }

  private cleanup() {
    const now = Date.now();
    for (const [key, entry] of this.store.entries()) {
      if (entry.resetAt < now) {
        this.store.delete(key);
      }
    }
  }

  check(key: string, windowMs: number, maxRequests: number): { allowed: boolean; remaining: number; resetAt: number } {
    const now = Date.now();
    const entry = this.store.get(key);

    if (!entry || entry.resetAt < now) {
      // New window
      const resetAt = now + windowMs;
      this.store.set(key, { count: 1, resetAt });
      return { allowed: true, remaining: maxRequests - 1, resetAt };
    }

    if (entry.count >= maxRequests) {
      return { allowed: false, remaining: 0, resetAt: entry.resetAt };
    }

    entry.count++;
    return { allowed: true, remaining: maxRequests - entry.count, resetAt: entry.resetAt };
  }

  destroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.store.clear();
  }
}

const limiter = new RateLimiter();

export interface RateLimitOptions {
  windowMs?: number;      // Time window in milliseconds (default: 60000 = 1 minute)
  maxRequests?: number;   // Max requests per window (default: 100)
  keyGenerator?: (req: Request) => string;  // Custom key generator
  skip?: (req: Request) => boolean;         // Skip rate limiting for certain requests
  message?: string;       // Custom error message
}

/**
 * Rate limiting middleware.
 * Limits requests per IP address by default.
 */
export function rateLimitMiddleware(options: RateLimitOptions = {}) {
  const {
    windowMs = Number(process.env.RATE_LIMIT_WINDOW_MS) || 60000,
    maxRequests = Number(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
    keyGenerator = (req) => {
      // Use X-Forwarded-For for proxied requests, fallback to IP
      const forwarded = req.headers["x-forwarded-for"];
      const ip = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(",")[0]?.trim();
      return ip || req.ip || req.socket.remoteAddress || "unknown";
    },
    skip = () => false,
    message = "Too many requests, please try again later",
  } = options;

  return (req: Request, res: Response, next: NextFunction) => {
    if (skip(req)) {
      return next();
    }

    const key = keyGenerator(req);
    const result = limiter.check(key, windowMs, maxRequests);

    // Set rate limit headers
    res.setHeader("X-RateLimit-Limit", maxRequests);
    res.setHeader("X-RateLimit-Remaining", result.remaining);
    res.setHeader("X-RateLimit-Reset", Math.ceil(result.resetAt / 1000));

    if (!result.allowed) {
      res.setHeader("Retry-After", Math.ceil((result.resetAt - Date.now()) / 1000));
      return res.status(429).json({
        ok: false,
        error: message,
        retryAfter: Math.ceil((result.resetAt - Date.now()) / 1000),
      });
    }

    next();
  };
}

/**
 * Stricter rate limiter for sensitive endpoints (auth, AI calls).
 */
export function strictRateLimitMiddleware() {
  return rateLimitMiddleware({
    windowMs: 60000,      // 1 minute
    maxRequests: 10,      // 10 requests per minute
    message: "Rate limit exceeded for this endpoint",
  });
}

/**
 * Rate limiter for AI endpoints (expensive operations).
 */
export function aiRateLimitMiddleware() {
  return rateLimitMiddleware({
    windowMs: 60000,      // 1 minute
    maxRequests: 20,      // 20 AI requests per minute
    message: "AI request rate limit exceeded",
  });
}

export default rateLimitMiddleware;
