// src/services/auditLogger.ts
// Structured audit logging for SOC2 compliance
// SOC2 Controls: CC7.1 Activity Logging, CC7.2 Change Logging, CC7.4 Monitoring

import crypto from 'crypto';
import { pool } from '../db/pool';
import { hashForAudit } from './encryption';

/**
 * Audit action types
 */
export enum AuditAction {
  // Authentication
  AUTH_LOGIN = 'AUTH_LOGIN',
  AUTH_LOGOUT = 'AUTH_LOGOUT',
  AUTH_FAILED = 'AUTH_FAILED',
  AUTH_TOKEN_REFRESH = 'AUTH_TOKEN_REFRESH',

  // Data access
  READ = 'READ',
  CREATE = 'CREATE',
  UPDATE = 'UPDATE',
  DELETE = 'DELETE',

  // External API calls
  EXTERNAL_API_CALL = 'EXTERNAL_API_CALL',

  // System events
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',
  VALIDATION_FAILED = 'VALIDATION_FAILED',
  AUTHORIZATION_DENIED = 'AUTHORIZATION_DENIED',

  // GDPR events
  GDPR_EXPORT = 'GDPR_EXPORT',
  GDPR_DELETE = 'GDPR_DELETE',
  CONSENT_UPDATED = 'CONSENT_UPDATED',

  // Scraping events
  SCRAPE_SUCCESS = 'SCRAPE_SUCCESS',
  SCRAPE_FAILED = 'SCRAPE_FAILED',
  SCRAPE_CACHE_HIT = 'SCRAPE_CACHE_HIT',
  SCRAPE_BATCH = 'SCRAPE_BATCH',
  CRON_SCRAPE_COMPLETE = 'CRON_SCRAPE_COMPLETE',
  CRON_SCRAPE_CLEANUP = 'CRON_SCRAPE_CLEANUP',
  CRON_SCRAPE_ERROR = 'CRON_SCRAPE_ERROR',
}

/**
 * Resource types being accessed
 */
export enum ResourceType {
  USER = 'user',
  HEALTH_DATA = 'health_data',
  NUTRITION = 'nutrition',
  MEALS = 'meals',
  WEIGHT = 'weight',
  HYDRATION = 'hydration',
  PREFERENCES = 'preferences',
  OAUTH_TOKEN = 'oauth_token',
  VIDEO = 'video',
  DEVICE = 'device',
  SYSTEM = 'system',
  NUTRITION_SCRAPE = 'nutrition_scrape',
}

/**
 * Audit log entry structure
 */
export interface AuditLogEntry {
  correlationId: string;
  userId?: string;
  action: AuditAction;
  resourceType: ResourceType;
  resourceId?: string;
  ipAddress?: string;
  userAgent?: string;
  requestMethod?: string;
  requestPath?: string;
  statusCode?: number;
  oldValueHash?: string;  // SHA-256 hash of old value (not the value itself)
  newValueHash?: string;  // SHA-256 hash of new value
  metadata?: Record<string, any>;  // Additional context
  errorMessage?: string;
  durationMs?: number;
}

/**
 * Generate a unique correlation ID for request tracing
 */
export function generateCorrelationId(): string {
  return crypto.randomUUID();
}

/**
 * Audit Logger class for structured logging
 */
class AuditLogger {
  private tableReady = false;
  private logQueue: AuditLogEntry[] = [];
  private flushInterval: NodeJS.Timeout | null = null;
  private batchSize = 50;
  private flushIntervalMs = 5000;

  constructor() {
    this.initTable();
    this.startFlushInterval();
  }

  /**
   * Initialize the audit_logs table if it doesn't exist
   */
  private async initTable() {
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS audit_logs (
          id BIGSERIAL PRIMARY KEY,
          timestamp TIMESTAMPTZ DEFAULT NOW(),
          correlation_id UUID NOT NULL,
          user_id TEXT,
          action TEXT NOT NULL,
          resource_type TEXT NOT NULL,
          resource_id TEXT,
          ip_address TEXT,
          user_agent TEXT,
          request_method TEXT,
          request_path TEXT,
          status_code INTEGER,
          old_value_hash TEXT,
          new_value_hash TEXT,
          metadata JSONB,
          error_message TEXT,
          duration_ms INTEGER
        );

        CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_logs(user_id);
        CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_logs(timestamp);
        CREATE INDEX IF NOT EXISTS idx_audit_resource ON audit_logs(resource_type, resource_id);
        CREATE INDEX IF NOT EXISTS idx_audit_correlation ON audit_logs(correlation_id);
        CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs(action);
      `);
      this.tableReady = true;
      console.log('[audit] Audit logging initialized');
    } catch (err) {
      console.error('[audit] Failed to initialize audit table:', err);
    }
  }

  /**
   * Start the flush interval for batch writes
   */
  private startFlushInterval() {
    this.flushInterval = setInterval(() => {
      this.flush();
    }, this.flushIntervalMs);
  }

  /**
   * Log an audit entry
   */
  async log(entry: AuditLogEntry): Promise<void> {
    // Add to queue for batch processing
    this.logQueue.push(entry);

    // Flush if batch size reached
    if (this.logQueue.length >= this.batchSize) {
      await this.flush();
    }

    // Also log to console in development
    if (process.env.NODE_ENV !== 'production') {
      const { correlationId, userId, action, resourceType, resourceId } = entry;
      console.log(`[audit] ${action} ${resourceType}${resourceId ? ':' + resourceId : ''} by ${userId || 'anonymous'} (${correlationId})`);
    }
  }

  /**
   * Flush queued logs to database
   */
  async flush(): Promise<void> {
    if (!this.tableReady || this.logQueue.length === 0) return;

    const entries = this.logQueue.splice(0, this.batchSize);

    try {
      // Build batch insert
      const values: any[] = [];
      const placeholders: string[] = [];

      entries.forEach((entry, i) => {
        const offset = i * 14;
        placeholders.push(`($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9}, $${offset + 10}, $${offset + 11}, $${offset + 12}, $${offset + 13}, $${offset + 14})`);
        values.push(
          entry.correlationId,
          entry.userId || null,
          entry.action,
          entry.resourceType,
          entry.resourceId || null,
          entry.ipAddress || null,
          entry.userAgent || null,
          entry.requestMethod || null,
          entry.requestPath || null,
          entry.statusCode || null,
          entry.oldValueHash || null,
          entry.newValueHash || null,
          entry.metadata ? JSON.stringify(entry.metadata) : null,
          entry.errorMessage || null
        );
      });

      await pool.query(`
        INSERT INTO audit_logs (
          correlation_id, user_id, action, resource_type, resource_id,
          ip_address, user_agent, request_method, request_path, status_code,
          old_value_hash, new_value_hash, metadata, error_message
        ) VALUES ${placeholders.join(', ')}
      `, values);
    } catch (err) {
      // Put entries back in queue on failure
      this.logQueue.unshift(...entries);
      console.error('[audit] Failed to flush audit logs:', err);
    }
  }

  /**
   * Log an authentication event
   */
  async logAuth(
    correlationId: string,
    action: AuditAction.AUTH_LOGIN | AuditAction.AUTH_LOGOUT | AuditAction.AUTH_FAILED | AuditAction.AUTH_TOKEN_REFRESH,
    userId: string | undefined,
    ipAddress: string,
    userAgent: string,
    metadata?: Record<string, any>,
    errorMessage?: string
  ): Promise<void> {
    await this.log({
      correlationId,
      userId,
      action,
      resourceType: ResourceType.USER,
      ipAddress,
      userAgent,
      metadata,
      errorMessage,
    });
  }

  /**
   * Log a data access event
   */
  async logDataAccess(
    correlationId: string,
    action: AuditAction.READ | AuditAction.CREATE | AuditAction.UPDATE | AuditAction.DELETE,
    resourceType: ResourceType,
    resourceId: string | undefined,
    userId: string | undefined,
    options?: {
      ipAddress?: string;
      oldValue?: any;
      newValue?: any;
      metadata?: Record<string, any>;
    }
  ): Promise<void> {
    await this.log({
      correlationId,
      userId,
      action,
      resourceType,
      resourceId,
      ipAddress: options?.ipAddress,
      oldValueHash: options?.oldValue ? hashForAudit(options.oldValue) : undefined,
      newValueHash: options?.newValue ? hashForAudit(options.newValue) : undefined,
      metadata: options?.metadata,
    });
  }

  /**
   * Log an external API call
   */
  async logExternalCall(
    correlationId: string,
    userId: string | undefined,
    service: string,
    endpoint: string,
    statusCode: number,
    durationMs: number,
    errorMessage?: string
  ): Promise<void> {
    await this.log({
      correlationId,
      userId,
      action: AuditAction.EXTERNAL_API_CALL,
      resourceType: ResourceType.SYSTEM,
      metadata: {
        service,
        endpoint,
      },
      statusCode,
      durationMs,
      errorMessage,
    });
  }

  /**
   * Log a GDPR event
   */
  async logGdpr(
    correlationId: string,
    userId: string,
    action: AuditAction.GDPR_EXPORT | AuditAction.GDPR_DELETE | AuditAction.CONSENT_UPDATED,
    ipAddress: string,
    metadata?: Record<string, any>
  ): Promise<void> {
    await this.log({
      correlationId,
      userId,
      action,
      resourceType: ResourceType.USER,
      ipAddress,
      metadata,
    });
  }

  /**
   * Log a security event
   */
  async logSecurity(
    correlationId: string,
    action: AuditAction.RATE_LIMIT_EXCEEDED | AuditAction.VALIDATION_FAILED | AuditAction.AUTHORIZATION_DENIED,
    userId: string | undefined,
    ipAddress: string,
    requestPath: string,
    errorMessage: string
  ): Promise<void> {
    await this.log({
      correlationId,
      userId,
      action,
      resourceType: ResourceType.SYSTEM,
      ipAddress,
      requestPath,
      errorMessage,
    });
  }

  /**
   * Query audit logs for compliance reporting
   */
  async query(options: {
    userId?: string;
    action?: AuditAction;
    resourceType?: ResourceType;
    startDate?: Date;
    endDate?: Date;
    limit?: number;
    offset?: number;
  }): Promise<any[]> {
    const conditions: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    if (options.userId) {
      conditions.push(`user_id = $${paramIndex++}`);
      params.push(options.userId);
    }

    if (options.action) {
      conditions.push(`action = $${paramIndex++}`);
      params.push(options.action);
    }

    if (options.resourceType) {
      conditions.push(`resource_type = $${paramIndex++}`);
      params.push(options.resourceType);
    }

    if (options.startDate) {
      conditions.push(`timestamp >= $${paramIndex++}`);
      params.push(options.startDate.toISOString());
    }

    if (options.endDate) {
      conditions.push(`timestamp <= $${paramIndex++}`);
      params.push(options.endDate.toISOString());
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = options.limit || 100;
    const offset = options.offset || 0;

    const result = await pool.query(`
      SELECT * FROM audit_logs
      ${whereClause}
      ORDER BY timestamp DESC
      LIMIT $${paramIndex++} OFFSET $${paramIndex++}
    `, [...params, limit, offset]);

    return result.rows;
  }

  /**
   * Shutdown - flush remaining logs
   */
  async shutdown(): Promise<void> {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }
    await this.flush();
  }
}

// Singleton instance
export const auditLogger = new AuditLogger();

// Convenience exports
export const logAuth = auditLogger.logAuth.bind(auditLogger);
export const logDataAccess = auditLogger.logDataAccess.bind(auditLogger);
export const logExternalCall = auditLogger.logExternalCall.bind(auditLogger);
export const logGdpr = auditLogger.logGdpr.bind(auditLogger);
export const logSecurity = auditLogger.logSecurity.bind(auditLogger);

export default auditLogger;
