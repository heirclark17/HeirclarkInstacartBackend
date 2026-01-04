// src/jobs/wearablesSync.ts
// Background cron job for syncing wearable data from all connected sources

import cron from 'node-cron';
import { pool } from '../db/pool';
import { syncOrchestrator, tokenManager, SourceType } from '../services/wearables';

/**
 * Configuration
 */
const SYNC_CONFIG = {
  // Max concurrent syncs per run
  maxConcurrentSyncs: 5,
  // Minimum time between syncs for the same source (hours)
  minSyncIntervalHours: 4,
  // Sources to skip (native health stores are synced by mobile app)
  skipSources: ['apple_health', 'health_connect', 'manual'] as SourceType[],
  // Maximum days to sync on each run
  syncDaysBack: 2,
};

/**
 * Get all sources that need syncing
 */
async function getSourcesNeedingSync(): Promise<Array<{
  customerId: string;
  sourceType: SourceType;
  lastSyncAt: Date | null;
}>> {
  const minSyncTime = new Date(
    Date.now() - SYNC_CONFIG.minSyncIntervalHours * 60 * 60 * 1000
  );

  const result = await pool.query(
    `SELECT customer_id, source_type, last_sync_at
     FROM hc_connected_sources
     WHERE disconnected_at IS NULL
       AND sync_enabled = true
       AND source_type NOT IN (${SYNC_CONFIG.skipSources.map((_, i) => `$${i + 1}`).join(', ')})
       AND (last_sync_at IS NULL OR last_sync_at < $${SYNC_CONFIG.skipSources.length + 1})
       AND last_sync_status != 'failed'
     ORDER BY last_sync_at ASC NULLS FIRST
     LIMIT 50`,
    [...SYNC_CONFIG.skipSources, minSyncTime]
  );

  return result.rows.map(row => ({
    customerId: row.customer_id,
    sourceType: row.source_type as SourceType,
    lastSyncAt: row.last_sync_at,
  }));
}

/**
 * Run sync for a batch of sources
 */
async function syncBatch(sources: Array<{
  customerId: string;
  sourceType: SourceType;
}>): Promise<{ success: number; failed: number }> {
  let success = 0;
  let failed = 0;

  // Process in parallel with concurrency limit
  const chunks: typeof sources[] = [];
  for (let i = 0; i < sources.length; i += SYNC_CONFIG.maxConcurrentSyncs) {
    chunks.push(sources.slice(i, i + SYNC_CONFIG.maxConcurrentSyncs));
  }

  for (const chunk of chunks) {
    const results = await Promise.allSettled(
      chunk.map(async ({ customerId, sourceType }) => {
        const dateRange = {
          start: new Date(Date.now() - SYNC_CONFIG.syncDaysBack * 24 * 60 * 60 * 1000),
          end: new Date(),
        };

        await syncOrchestrator.syncSource(customerId, sourceType, { dateRange });
      })
    );

    for (const result of results) {
      if (result.status === 'fulfilled') {
        success++;
      } else {
        failed++;
        console.error('Sync failed:', result.reason);
      }
    }
  }

  return { success, failed };
}

/**
 * Main sync job function
 */
async function runWearablesSyncJob(): Promise<void> {
  const startTime = Date.now();
  console.log(`[${new Date().toISOString()}] Starting wearables sync job...`);

  try {
    // Get sources needing sync
    const sources = await getSourcesNeedingSync();
    console.log(`Found ${sources.length} sources needing sync`);

    if (sources.length === 0) {
      console.log('No sources to sync');
      return;
    }

    // Run sync
    const { success, failed } = await syncBatch(sources);

    const duration = Math.round((Date.now() - startTime) / 1000);
    console.log(
      `[${new Date().toISOString()}] Wearables sync completed in ${duration}s: ` +
      `${success} successful, ${failed} failed`
    );

    // Log job completion
    await pool.query(
      `INSERT INTO hc_sync_log (
        id, customer_id, source_type, sync_started_at, sync_completed_at,
        sync_type, status, records_fetched
      ) VALUES (
        gen_random_uuid(), 'system', 'manual',
        $1, NOW(), 'background_job', 'success', $2
      )`,
      [new Date(startTime), sources.length]
    );
  } catch (error: any) {
    console.error(`[${new Date().toISOString()}] Wearables sync job failed:`, error);

    // Log job failure
    await pool.query(
      `INSERT INTO hc_sync_log (
        id, customer_id, source_type, sync_started_at, sync_completed_at,
        sync_type, status, error_message
      ) VALUES (
        gen_random_uuid(), 'system', 'manual',
        $1, NOW(), 'background_job', 'failed', $2
      )`,
      [new Date(startTime), error.message]
    );
  }
}

/**
 * Retry failed syncs
 */
async function retryFailedSyncs(): Promise<void> {
  console.log(`[${new Date().toISOString()}] Checking for failed syncs to retry...`);

  // Get sources that failed in the last 24 hours with fewer than 3 retries
  const result = await pool.query(
    `SELECT customer_id, source_type
     FROM hc_connected_sources
     WHERE disconnected_at IS NULL
       AND sync_enabled = true
       AND last_sync_status = 'failed'
       AND last_sync_at > NOW() - INTERVAL '24 hours'
       AND source_type NOT IN (${SYNC_CONFIG.skipSources.map((_, i) => `$${i + 1}`).join(', ')})
     LIMIT 10`,
    SYNC_CONFIG.skipSources
  );

  if (result.rows.length === 0) {
    console.log('No failed syncs to retry');
    return;
  }

  console.log(`Retrying ${result.rows.length} failed syncs...`);

  for (const row of result.rows) {
    try {
      // Reset status to pending before retry
      await tokenManager.updateSyncStatus(
        row.customer_id,
        row.source_type as SourceType,
        'pending'
      );

      const dateRange = {
        start: new Date(Date.now() - 24 * 60 * 60 * 1000), // Last 24 hours
        end: new Date(),
      };

      await syncOrchestrator.syncSource(
        row.customer_id,
        row.source_type as SourceType,
        { dateRange }
      );

      console.log(`Retry successful for ${row.customer_id}/${row.source_type}`);
    } catch (error: any) {
      console.error(`Retry failed for ${row.customer_id}/${row.source_type}:`, error.message);
    }
  }
}

/**
 * Schedule the wearables sync job
 * @param cronExpression - Cron expression (default: every 4 hours)
 */
export function scheduleWearablesSyncJob(cronExpression: string = '0 */4 * * *'): void {
  // Main sync job - runs every 4 hours by default
  cron.schedule(cronExpression, () => {
    runWearablesSyncJob().catch(console.error);
  });

  console.log(`Wearables sync job scheduled: ${cronExpression}`);

  // Retry job - runs every hour at :30
  cron.schedule('30 * * * *', () => {
    retryFailedSyncs().catch(console.error);
  });

  console.log('Wearables retry job scheduled: every hour at :30');
}

/**
 * Run sync job immediately (for manual triggering)
 */
export async function runWearablesSyncNow(): Promise<void> {
  await runWearablesSyncJob();
}

/**
 * Run sync for a specific customer
 */
export async function syncCustomerWearables(customerId: string): Promise<{
  success: number;
  failed: number;
  results: Array<{ sourceType: SourceType; status: 'success' | 'failed'; error?: string }>;
}> {
  const sources = await tokenManager.getAllSources(customerId);
  const results: Array<{ sourceType: SourceType; status: 'success' | 'failed'; error?: string }> = [];

  let success = 0;
  let failed = 0;

  for (const source of sources) {
    // Skip native and disabled sources
    if (
      SYNC_CONFIG.skipSources.includes(source.sourceType) ||
      !source.syncEnabled
    ) {
      continue;
    }

    try {
      const dateRange = {
        start: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // Last 7 days
        end: new Date(),
      };

      await syncOrchestrator.syncSource(customerId, source.sourceType, { dateRange });

      results.push({ sourceType: source.sourceType, status: 'success' });
      success++;
    } catch (error: any) {
      results.push({
        sourceType: source.sourceType,
        status: 'failed',
        error: error.message,
      });
      failed++;
    }
  }

  return { success, failed, results };
}
