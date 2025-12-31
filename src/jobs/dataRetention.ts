// src/jobs/dataRetention.ts
// Data retention and cleanup job for GDPR/SOC2 compliance
// GDPR Article 5(1)(e) - Storage Limitation, SOC2 Control P7.1

import { pool } from '../db/pool';
import { auditLogger, AuditAction, ResourceType, generateCorrelationId } from '../services/auditLogger';

// Configuration (can be overridden via env vars)
const CONFIG = {
  // Data retention periods
  healthDataRetentionDays: parseInt(process.env.DATA_RETENTION_DAYS || '730', 10),      // 2 years
  auditLogRetentionDays: parseInt(process.env.AUDIT_RETENTION_DAYS || '2555', 10),      // 7 years
  inactiveAccountDays: parseInt(process.env.INACTIVE_ACCOUNT_DAYS || '365', 10),        // 1 year

  // Notification thresholds
  inactiveWarningDays: 335,  // 11 months - send warning before deletion

  // Batch sizes for performance
  deletionBatchSize: 1000,
};

interface RetentionJobResult {
  startedAt: string;
  completedAt: string;
  durationMs: number;
  deletedRecords: {
    category: string;
    count: number;
  }[];
  anonymizedAuditLogs: number;
  inactiveAccountsWarned: number;
  inactiveAccountsDeleted: number;
  errors: string[];
}

/**
 * Main data retention job
 * Should be run daily via cron (recommended: 2 AM)
 */
export async function runDataRetentionJob(): Promise<RetentionJobResult> {
  const correlationId = generateCorrelationId();
  const startedAt = new Date();
  const errors: string[] = [];
  const deletedRecords: { category: string; count: number }[] = [];
  let anonymizedAuditLogs = 0;
  let inactiveAccountsWarned = 0;
  let inactiveAccountsDeleted = 0;

  console.log(`[retention] Starting data retention job at ${startedAt.toISOString()}`);

  // Log job start
  await auditLogger.log({
    correlationId,
    action: AuditAction.DELETE,
    resourceType: ResourceType.SYSTEM,
    metadata: {
      job: 'data_retention',
      status: 'started',
      config: CONFIG,
    },
  });

  try {
    // 1. Delete old health metrics
    console.log('[retention] Cleaning old health metrics...');
    const healthCutoff = new Date();
    healthCutoff.setDate(healthCutoff.getDate() - CONFIG.healthDataRetentionDays);

    const healthDelete = await pool.query(`
      DELETE FROM hc_health_latest
      WHERE received_at < $1
    `, [healthCutoff.toISOString()]);
    deletedRecords.push({ category: 'health_metrics', count: healthDelete.rowCount || 0 });

    // 2. Delete old Apple Health daily data
    const appleDelete = await pool.query(`
      DELETE FROM hc_apple_health_daily
      WHERE last_updated_at < $1
    `, [healthCutoff.toISOString()]);
    deletedRecords.push({ category: 'apple_health_daily', count: appleDelete.rowCount || 0 });

    // 3. Delete old meal logs
    console.log('[retention] Cleaning old meal logs...');
    const mealsDelete = await pool.query(`
      DELETE FROM hc_meals
      WHERE created_at < $1
    `, [healthCutoff.toISOString()]);
    deletedRecords.push({ category: 'meals', count: mealsDelete.rowCount || 0 });

    // 4. Delete old water logs
    const waterDelete = await pool.query(`
      DELETE FROM hc_water_logs
      WHERE created_at < $1
    `, [healthCutoff.toISOString()]);
    deletedRecords.push({ category: 'water_logs', count: waterDelete.rowCount || 0 });

    // 5. Delete old weight logs
    const weightDelete = await pool.query(`
      DELETE FROM hc_weight_logs
      WHERE created_at < $1
    `, [healthCutoff.toISOString()]);
    deletedRecords.push({ category: 'weight_logs', count: weightDelete.rowCount || 0 });

    // 6. Delete expired pairing tokens
    console.log('[retention] Cleaning expired pairing tokens...');
    const pairingDelete = await pool.query(`
      DELETE FROM hc_pairing_tokens
      WHERE expires_at < NOW()
    `);
    deletedRecords.push({ category: 'pairing_tokens', count: pairingDelete.rowCount || 0 });

    // 7. Delete expired Apple tokens
    const appleTokenDelete = await pool.query(`
      DELETE FROM hc_apple_tokens
      WHERE expires_at < NOW()
    `);
    deletedRecords.push({ category: 'apple_tokens', count: appleTokenDelete.rowCount || 0 });

    // 8. Delete expired wearable tokens
    const wearableDelete = await pool.query(`
      DELETE FROM wearable_tokens
      WHERE expires_at < NOW()
    `);
    deletedRecords.push({ category: 'wearable_tokens', count: wearableDelete.rowCount || 0 });

    // 9. Delete expired videos (already expired in HeyGen)
    const videoDelete = await pool.query(`
      DELETE FROM hc_user_videos
      WHERE expires_at < NOW()
    `);
    deletedRecords.push({ category: 'expired_videos', count: videoDelete.rowCount || 0 });

    // 10. Anonymize old audit logs (keep for 7 years, anonymize PII)
    console.log('[retention] Anonymizing old audit logs...');
    const auditCutoff = new Date();
    auditCutoff.setDate(auditCutoff.getDate() - CONFIG.auditLogRetentionDays);

    const auditAnonymize = await pool.query(`
      UPDATE audit_logs
      SET user_id = 'ANONYMIZED',
          ip_address = NULL,
          user_agent = NULL,
          metadata = jsonb_set(
            COALESCE(metadata, '{}'::jsonb),
            '{retention_anonymized}',
            to_jsonb(NOW()::TEXT)
          )
      WHERE timestamp < $1
        AND user_id != 'ANONYMIZED'
        AND user_id != 'DELETED_USER'
    `, [auditCutoff.toISOString()]);
    anonymizedAuditLogs = auditAnonymize.rowCount || 0;

    // 11. Find inactive accounts (no activity in past year)
    // Note: In production, this would send notification emails before deletion
    console.log('[retention] Checking for inactive accounts...');

    // Get accounts with warning threshold
    const warningCutoff = new Date();
    warningCutoff.setDate(warningCutoff.getDate() - CONFIG.inactiveWarningDays);

    const inactiveWarningQuery = await pool.query(`
      SELECT DISTINCT h.shopify_customer_id
      FROM hc_health_latest h
      WHERE h.received_at < $1
        AND h.received_at > $2
        AND NOT EXISTS (
          SELECT 1 FROM hc_meals m
          WHERE m.shopify_customer_id = h.shopify_customer_id
          AND m.created_at > $1
        )
    `, [warningCutoff.toISOString(), healthCutoff.toISOString()]);

    inactiveAccountsWarned = inactiveWarningQuery.rows.length;
    if (inactiveAccountsWarned > 0) {
      console.log(`[retention] Found ${inactiveAccountsWarned} accounts approaching inactivity threshold`);
      // In production: Send warning emails to these users
      // For now, just log
      await auditLogger.log({
        correlationId,
        action: AuditAction.READ,
        resourceType: ResourceType.USER,
        metadata: {
          job: 'data_retention',
          action: 'inactive_account_warning',
          count: inactiveAccountsWarned,
          accountIds: inactiveWarningQuery.rows.map(r => r.shopify_customer_id),
        },
      });
    }

    // Accounts past the deletion threshold
    const inactiveCutoff = new Date();
    inactiveCutoff.setDate(inactiveCutoff.getDate() - CONFIG.inactiveAccountDays);

    const inactiveDeleteQuery = await pool.query(`
      SELECT DISTINCT h.shopify_customer_id
      FROM hc_health_latest h
      WHERE h.received_at < $1
        AND NOT EXISTS (
          SELECT 1 FROM hc_meals m
          WHERE m.shopify_customer_id = h.shopify_customer_id
          AND m.created_at > $1
        )
        AND NOT EXISTS (
          SELECT 1 FROM hc_weight_logs w
          WHERE w.shopify_customer_id = h.shopify_customer_id
          AND w.created_at > $1
        )
    `, [inactiveCutoff.toISOString()]);

    inactiveAccountsDeleted = inactiveDeleteQuery.rows.length;

    // Note: Automatic account deletion is commented out for safety
    // In production, this should require explicit configuration
    /*
    if (inactiveAccountsDeleted > 0 && process.env.ENABLE_AUTO_DELETE === 'true') {
      for (const row of inactiveDeleteQuery.rows) {
        await deleteUserData(row.shopify_customer_id, 'retention_job');
      }
    }
    */

    if (inactiveAccountsDeleted > 0) {
      console.log(`[retention] Found ${inactiveAccountsDeleted} accounts past inactivity threshold (not auto-deleted)`);
    }

  } catch (err: any) {
    console.error('[retention] Job error:', err);
    errors.push(err.message);
  }

  const completedAt = new Date();
  const durationMs = completedAt.getTime() - startedAt.getTime();

  const result: RetentionJobResult = {
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    durationMs,
    deletedRecords,
    anonymizedAuditLogs,
    inactiveAccountsWarned,
    inactiveAccountsDeleted,
    errors,
  };

  // Log job completion
  await auditLogger.log({
    correlationId,
    action: AuditAction.DELETE,
    resourceType: ResourceType.SYSTEM,
    metadata: {
      job: 'data_retention',
      status: errors.length > 0 ? 'completed_with_errors' : 'completed',
      result,
    },
  });

  console.log(`[retention] Job completed in ${durationMs}ms`);
  console.log('[retention] Results:', JSON.stringify(result, null, 2));

  return result;
}

/**
 * Schedule the retention job to run daily
 * Call this from your application startup or use a proper scheduler
 */
export function scheduleRetentionJob(runAt: string = '02:00'): void {
  const [targetHour, targetMinute] = runAt.split(':').map(Number);

  function scheduleNext() {
    const now = new Date();
    const next = new Date(now);

    next.setHours(targetHour, targetMinute, 0, 0);

    // If time has passed today, schedule for tomorrow
    if (next <= now) {
      next.setDate(next.getDate() + 1);
    }

    const msUntilNext = next.getTime() - now.getTime();

    console.log(`[retention] Next job scheduled for ${next.toISOString()} (in ${Math.round(msUntilNext / 60000)} minutes)`);

    setTimeout(async () => {
      try {
        await runDataRetentionJob();
      } catch (err) {
        console.error('[retention] Scheduled job failed:', err);
      }
      scheduleNext();  // Schedule next run
    }, msUntilNext);
  }

  scheduleNext();
}

/**
 * Get retention job status and last run info
 */
export async function getRetentionJobStatus(): Promise<{
  lastRun: string | null;
  nextRun: string;
  config: typeof CONFIG;
}> {
  // Query last job run from audit logs
  const lastRunQuery = await pool.query(`
    SELECT timestamp, metadata
    FROM audit_logs
    WHERE action = 'DELETE'
      AND resource_type = 'system'
      AND metadata->>'job' = 'data_retention'
      AND metadata->>'status' = 'completed'
    ORDER BY timestamp DESC
    LIMIT 1
  `);

  const lastRun = lastRunQuery.rows[0]?.timestamp || null;

  // Calculate next run (2 AM)
  const now = new Date();
  const next = new Date(now);
  next.setHours(2, 0, 0, 0);
  if (next <= now) {
    next.setDate(next.getDate() + 1);
  }

  return {
    lastRun,
    nextRun: next.toISOString(),
    config: CONFIG,
  };
}

// CLI entry point for manual runs
if (require.main === module) {
  console.log('[retention] Running data retention job manually...');
  runDataRetentionJob()
    .then((result) => {
      console.log('[retention] Manual run completed');
      process.exit(result.errors.length > 0 ? 1 : 0);
    })
    .catch((err) => {
      console.error('[retention] Manual run failed:', err);
      process.exit(1);
    });
}

export default {
  runDataRetentionJob,
  scheduleRetentionJob,
  getRetentionJobStatus,
};
