// src/middleware/rateLimiter.ts
// ✅ SECURITY FIX: Redis-backed rate limiting for distributed environments
// Fixes penetration test finding: Rate limiting not working (OWASP A04)

import { Request, Response, NextFunction } from "express";
import Redis from "ioredis";

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

/**
 * Abstract rate limiter interface
 */
interface IRateLimiter {
  check(key: string, windowMs: number, maxRequests: number): Promise<RateLimitResult>;
  destroy(): void;
}

/**
 * Redis-backed rate limiter (production)
 * Supports distributed rate limiting across multiple Railway containers
 */
class RedisRateLimiter implements IRateLimiter {
  private redis: Redis;

  constructor(redisUrl: string) {
    this.redis = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      retryStrategy(times) {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
    });

    this.redis.on('error', (err) => {
      console.error('[RateLimit] Redis connection error:', err.message);
    });

    this.redis.on('connect', () => {
      console.log('[RateLimit] Redis connected successfully');
    });
  }

  async check(key: string, windowMs: number, maxRequests: number): Promise<RateLimitResult> {
    const now = Date.now();
    const resetAt = now + windowMs;
    const redisKey = `ratelimit:${key}`;

    try {
      // Use Redis INCR for atomic increment
      const count = await this.redis.incr(redisKey);

      if (count === 1) {
        // First request in window - set expiration
        await this.redis.pexpire(redisKey, windowMs);
      }

      if (count > maxRequests) {
        // Get TTL for resetAt
        const ttl = await this.redis.pttl(redisKey);
        const actualResetAt = ttl > 0 ? now + ttl : resetAt;
        return { allowed: false, remaining: 0, resetAt: actualResetAt };
      }

      return { allowed: true, remaining: maxRequests - count, resetAt };
    } catch (err) {
      console.error('[RateLimit] Redis check error:', err);
      // Fail open - allow request on Redis error
      return { allowed: true, remaining: maxRequests, resetAt };
    }
  }

  destroy() {
    this.redis.disconnect();
  }
}

/**
 * In-memory rate limiter (fallback for development)
 */
class InMemoryRateLimiter implements IRateLimiter {
  private store = new Map<string, RateLimitEntry>();
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.cleanupInterval = setInterval(() => this.cleanup(), 60000);
    console.warn('[RateLimit] Using in-memory rate limiter (not recommended for production)');
  }

  private cleanup() {
    const now = Date.now();
    for (const [key, entry] of this.store.entries()) {
      if (entry.resetAt < now) {
        this.store.delete(key);
      }
    }
  }

  async check(key: string, windowMs: number, maxRequests: number): Promise<RateLimitResult> {
    const now = Date.now();
    const entry = this.store.get(key);

    if (!entry || entry.resetAt < now) {
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

// Initialize rate limiter based on environment
let limiter: IRateLimiter;

if (process.env.REDIS_URL) {
  console.log('[RateLimit] Initializing Redis-backed rate limiter');
  limiter = new RedisRateLimiter(process.env.REDIS_URL);
} else {
  console.log('[RateLimit] REDIS_URL not found, using in-memory fallback');
  limiter = new InMemoryRateLimiter();
}

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

  return async (req: Request, res: Response, next: NextFunction) => {
    if (skip(req)) {
      return next();
    }

    const key = keyGenerator(req);
    const result = await limiter.check(key, windowMs, maxRequests);

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

/**
 * Rate limiter for video generation (very expensive operations).
 * HeyGen API costs money per video, so limit strictly.
 */
export function videoRateLimitMiddleware() {
  return rateLimitMiddleware({
    windowMs: 3600000,    // 1 hour
    maxRequests: 5,       // 5 videos per hour per user
    message: "Video generation limit exceeded. Maximum 5 videos per hour.",
    keyGenerator: (req) => {
      // Rate limit by userId if available, otherwise by IP
      const userId = req.body?.userId || req.params?.userId;
      if (userId) return `video:user:${userId}`;

      const forwarded = req.headers["x-forwarded-for"];
      const ip = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(",")[0]?.trim();
      return `video:ip:${ip || req.ip || "unknown"}`;
    },
  });
}

export default rateLimitMiddleware;
