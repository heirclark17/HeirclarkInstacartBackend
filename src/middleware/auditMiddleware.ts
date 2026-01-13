// src/middleware/auditMiddleware.ts
// Request audit logging middleware for SOC2 compliance
// SOC2 Controls: CC7.1 Activity Logging, CC7.2 Change Logging

import { Request, Response, NextFunction } from 'express';
import { auditLogger, generateCorrelationId, AuditAction, ResourceType } from '../services/auditLogger';
import { AuthenticatedRequest } from './auth';

// Extend Express Request with correlation ID
declare global {
  namespace Express {
    interface Request {
      correlationId?: string;
    }
  }
}

/**
 * Map request paths to resource types
 */
function getResourceType(path: string): ResourceType {
  if (path.includes('/health') || path.includes('/metrics')) return ResourceType.HEALTH_DATA;
  if (path.includes('/nutrition') || path.includes('/meals')) return ResourceType.NUTRITION;
  if (path.includes('/meal')) return ResourceType.MEALS;
  if (path.includes('/weight')) return ResourceType.WEIGHT;
  if (path.includes('/hydration') || path.includes('/water')) return ResourceType.HYDRATION;
  if (path.includes('/preferences')) return ResourceType.PREFERENCES;
  if (path.includes('/auth') || path.includes('/token')) return ResourceType.OAUTH_TOKEN;
  if (path.includes('/video') || path.includes('/heygen')) return ResourceType.VIDEO;
  if (path.includes('/device') || path.includes('/pairing')) return ResourceType.DEVICE;
  if (path.includes('/user')) return ResourceType.USER;
  return ResourceType.SYSTEM;
}

/**
 * Map HTTP methods to audit actions
 */
type DataAuditAction = AuditAction.READ | AuditAction.CREATE | AuditAction.UPDATE | AuditAction.DELETE;

function getAuditAction(method: string): DataAuditAction {
  switch (method.toUpperCase()) {
    case 'GET':
    case 'HEAD':
      return AuditAction.READ;
    case 'POST':
      return AuditAction.CREATE;
    case 'PUT':
    case 'PATCH':
      return AuditAction.UPDATE;
    case 'DELETE':
      return AuditAction.DELETE;
    default:
      return AuditAction.READ;
  }
}

/**
 * Extract client IP address
 */
function getClientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    const ips = Array.isArray(forwarded) ? forwarded[0] : forwarded.split(',')[0];
    return ips?.trim() || 'unknown';
  }
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

/**
 * Extract resource ID from request
 */
function getResourceId(req: Request): string | undefined {
  // Check common parameter names
  const paramNames = ['id', 'userId', 'customerId', 'videoId', 'mealId', 'deviceKey'];
  for (const name of paramNames) {
    if (req.params?.[name]) return req.params[name];
  }

  // Check body for IDs
  const body = req.body as Record<string, any>;
  if (body?.id) return body.id;
  if (body?.userId) return body.userId;
  if (body?.shopifyCustomerId) return body.shopifyCustomerId;

  return undefined;
}

/**
 * Paths to skip auditing (health checks, static assets)
 */
const SKIP_PATHS = [
  '/health',
  '/healthz',
  '/ready',
  '/favicon.ico',
  '/_ah/health',
];

/**
 * Check if path should be skipped
 */
function shouldSkip(path: string): boolean {
  return SKIP_PATHS.some(skip => path === skip || path.startsWith(skip));
}

/**
 * Audit middleware - logs all HTTP requests
 */
export function auditMiddleware() {
  return (req: Request, res: Response, next: NextFunction) => {
    // Skip health checks and static assets
    if (shouldSkip(req.path)) {
      return next();
    }

    // Generate correlation ID for request tracing
    const correlationId = (req.headers['x-correlation-id'] as string) || generateCorrelationId();
    req.correlationId = correlationId;

    // Set correlation ID in response header
    res.setHeader('X-Correlation-Id', correlationId);

    const startTime = Date.now();
    const originalEnd = res.end;

    // Capture response
    res.end = function(chunk?: any, encoding?: any, cb?: any): Response {
      const durationMs = Date.now() - startTime;
      const authReq = req as AuthenticatedRequest;

      // Log the request
      auditLogger.log({
        correlationId,
        userId: authReq.auth?.customerId,
        action: getAuditAction(req.method),
        resourceType: getResourceType(req.path),
        resourceId: getResourceId(req),
        ipAddress: getClientIp(req),
        userAgent: req.headers['user-agent'],
        requestMethod: req.method,
        requestPath: req.path,
        statusCode: res.statusCode,
        durationMs,
        metadata: {
          query: Object.keys(req.query).length > 0 ? req.query : undefined,
          contentType: req.headers['content-type'],
        },
        errorMessage: res.statusCode >= 400 ? `HTTP ${res.statusCode}` : undefined,
      });

      return originalEnd.call(this, chunk, encoding, cb);
    };

    next();
  };
}

/**
 * Enhanced audit middleware for data mutation endpoints
 * Captures old/new value hashes for change tracking
 */
export function auditDataChangeMiddleware() {
  return async (req: Request, res: Response, next: NextFunction) => {
    // Only track mutations
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method.toUpperCase())) {
      return next();
    }

    const correlationId = req.correlationId || generateCorrelationId();
    const authReq = req as AuthenticatedRequest;

    // Store the original JSON method
    const originalJson = res.json.bind(res);

    // Override json to capture response
    res.json = function(data: any) {
      // Log data change
      auditLogger.logDataAccess(
        correlationId,
        getAuditAction(req.method),
        getResourceType(req.path),
        getResourceId(req),
        authReq.auth?.customerId,
        {
          ipAddress: getClientIp(req),
          newValue: req.body,
          metadata: {
            responseOk: data?.ok ?? (res.statusCode < 400),
          },
        }
      );

      return originalJson(data);
    };

    next();
  };
}

/**
 * Log authentication failure events
 */
export function logAuthFailure(
  req: Request,
  reason: string
): void {
  const correlationId = req.correlationId || generateCorrelationId();

  auditLogger.logAuth(
    correlationId,
    AuditAction.AUTH_FAILED,
    undefined,
    getClientIp(req),
    req.headers['user-agent'] || 'unknown',
    {
      path: req.path,
      method: req.method,
    },
    reason
  );
}

/**
 * Log successful authentication
 */
export function logAuthSuccess(
  req: Request,
  userId: string,
  method: 'jwt' | 'legacy_header' | 'legacy_param' | 'customer_id_header' | 'customer_id_param'
): void {
  const correlationId = req.correlationId || generateCorrelationId();

  auditLogger.logAuth(
    correlationId,
    AuditAction.AUTH_LOGIN,
    userId,
    getClientIp(req),
    req.headers['user-agent'] || 'unknown',
    {
      method,
      path: req.path,
    }
  );
}

/**
 * Log rate limit exceeded
 */
export function logRateLimitExceeded(req: Request): void {
  const correlationId = req.correlationId || generateCorrelationId();
  const authReq = req as AuthenticatedRequest;

  auditLogger.logSecurity(
    correlationId,
    AuditAction.RATE_LIMIT_EXCEEDED,
    authReq.auth?.customerId,
    getClientIp(req),
    req.path,
    'Rate limit exceeded'
  );
}

/**
 * Log authorization denied
 */
export function logAuthorizationDenied(
  req: Request,
  reason: string
): void {
  const correlationId = req.correlationId || generateCorrelationId();
  const authReq = req as AuthenticatedRequest;

  auditLogger.logSecurity(
    correlationId,
    AuditAction.AUTHORIZATION_DENIED,
    authReq.auth?.customerId,
    getClientIp(req),
    req.path,
    reason
  );
}

export default auditMiddleware;
