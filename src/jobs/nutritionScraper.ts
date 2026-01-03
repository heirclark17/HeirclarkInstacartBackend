/**
 * Nutrition Scraper Cron Job
 *
 * Daily automated scraping of competitor sites, recipe databases,
 * and nutrition resources for data enrichment.
 *
 * Runs at 3 AM daily in production.
 */

import { CronJob } from 'cron';
import crypto from 'crypto';
import { pool } from '../db/pool';
import {
  scrapeAndExtract,
  deleteOldScrapes,
  isConfigured,
  ScrapeType,
} from '../services/firecrawlService';
import { auditLogger, AuditAction, ResourceType } from '../services/auditLogger';

// Configuration
const SCRAPE_BATCH_SIZE = 5;
const SCRAPE_DELAY_MS = 2000; // 2 second delay between scrapes

interface ScrapeConfig {
  id: string;
  name: string;
  url: string;
  type: ScrapeType;
  enabled: boolean;
  lastScrapedAt: Date | null;
}

/**
 * Get competitor sites to scrape from database
 */
async function getScrapeSites(): Promise<ScrapeConfig[]> {
  const result = await pool.query(`
    SELECT id, name, url, type, enabled, last_scraped_at
    FROM competitor_scrape_config
    WHERE enabled = true
    AND (
      last_scraped_at IS NULL
      OR last_scraped_at < NOW() - INTERVAL '1 hour' * scrape_frequency_hours
    )
    ORDER BY last_scraped_at ASC NULLS FIRST
    LIMIT $1
  `, [SCRAPE_BATCH_SIZE]);

  return result.rows.map(row => ({
    id: row.id,
    name: row.name,
    url: row.url,
    type: row.type,
    enabled: row.enabled,
    lastScrapedAt: row.last_scraped_at,
  }));
}

/**
 * Update last scraped timestamp
 */
async function updateLastScraped(id: string, success: boolean, error?: string): Promise<void> {
  if (success) {
    await pool.query(`
      UPDATE competitor_scrape_config
      SET last_scraped_at = NOW()
      WHERE id = $1
    `, [id]);
  } else {
    // Increment error count but don't update last_scraped_at
    await pool.query(`
      UPDATE nutrition_scrapes ns
      SET error_count = error_count + 1,
          last_error = $2
      FROM competitor_scrape_config csc
      WHERE ns.url = csc.url AND csc.id = $1
    `, [id, error]);
  }
}

/**
 * Run the scraping job
 */
async function runScrapingJob(): Promise<{
  total: number;
  successful: number;
  failed: number;
  details: Array<{ name: string; url: string; success: boolean; error?: string }>;
}> {
  console.log('[NutritionScraper] Starting scheduled scrape job...');

  // Check if service is configured
  if (!isConfigured()) {
    console.warn('[NutritionScraper] Service not configured, skipping.');
    return { total: 0, successful: 0, failed: 0, details: [] };
  }

  const sites = await getScrapeSites();

  if (sites.length === 0) {
    console.log('[NutritionScraper] No sites need scraping.');
    return { total: 0, successful: 0, failed: 0, details: [] };
  }

  console.log(`[NutritionScraper] Scraping ${sites.length} sites...`);

  const results: Array<{ name: string; url: string; success: boolean; error?: string }> = [];
  let successful = 0;
  let failed = 0;

  for (const site of sites) {
    console.log(`[NutritionScraper] Scraping: ${site.name} (${site.url})`);

    try {
      await scrapeAndExtract(site.url, site.type);
      await updateLastScraped(site.id, true);

      results.push({ name: site.name, url: site.url, success: true });
      successful++;

      console.log(`[NutritionScraper] ✓ Success: ${site.name}`);
    } catch (error: any) {
      await updateLastScraped(site.id, false, error.message);

      results.push({ name: site.name, url: site.url, success: false, error: error.message });
      failed++;

      console.error(`[NutritionScraper] ✗ Failed: ${site.name} - ${error.message}`);
    }

    // Delay between scrapes to avoid rate limits
    await new Promise(resolve => setTimeout(resolve, SCRAPE_DELAY_MS));
  }

  // Log summary
  auditLogger.log({
    action: AuditAction.CRON_SCRAPE_COMPLETE,
    userId: 'system',
    resourceType: ResourceType.NUTRITION_SCRAPE,
    correlationId: crypto.randomUUID(),
    metadata: {
      total: sites.length,
      successful,
      failed,
    },
  });

  console.log(`[NutritionScraper] Completed: ${successful}/${sites.length} successful`);

  return {
    total: sites.length,
    successful,
    failed,
    details: results,
  };
}

/**
 * Cleanup old scrapes (runs after main job)
 */
async function runCleanupJob(): Promise<number> {
  console.log('[NutritionScraper] Running cleanup...');

  const retentionDays = parseInt(process.env.SCRAPE_RETENTION_DAYS || '30');
  const deleted = await deleteOldScrapes(retentionDays);

  if (deleted > 0) {
    console.log(`[NutritionScraper] Deleted ${deleted} old scrapes (>${retentionDays} days)`);

    auditLogger.log({
      action: AuditAction.CRON_SCRAPE_CLEANUP,
      userId: 'system',
      resourceType: ResourceType.NUTRITION_SCRAPE,
      correlationId: crypto.randomUUID(),
      metadata: { deleted, retentionDays },
    });
  }

  return deleted;
}

/**
 * Main cron handler - runs scraping and cleanup
 */
async function cronHandler(): Promise<void> {
  try {
    // Run scraping
    await runScrapingJob();

    // Run cleanup
    await runCleanupJob();
  } catch (error) {
    console.error('[NutritionScraper] Cron job error:', error);

    auditLogger.log({
      action: AuditAction.CRON_SCRAPE_ERROR,
      userId: 'system',
      resourceType: ResourceType.NUTRITION_SCRAPE,
      correlationId: crypto.randomUUID(),
      metadata: { error: (error as Error).message },
    });
  }
}

// Cron job instance (not started by default)
let cronJob: CronJob | null = null;

/**
 * Schedule the nutrition scraper cron job
 *
 * @param cronTime - Cron expression (default: "0 3 * * *" = 3 AM daily)
 */
export function scheduleNutritionScraper(cronTime: string = '0 3 * * *'): CronJob {
  if (cronJob) {
    console.log('[NutritionScraper] Job already scheduled');
    return cronJob;
  }

  cronJob = new CronJob(
    cronTime,
    cronHandler,
    null, // onComplete
    false, // start
    'America/New_York'
  );

  cronJob.start();
  console.log(`[NutritionScraper] Cron job scheduled: ${cronTime}`);

  return cronJob;
}

/**
 * Stop the cron job
 */
export function stopNutritionScraper(): void {
  if (cronJob) {
    cronJob.stop();
    cronJob = null;
    console.log('[NutritionScraper] Cron job stopped');
  }
}

/**
 * Run the scraping job immediately (for manual triggering)
 */
export async function runNow(): Promise<{
  scraping: Awaited<ReturnType<typeof runScrapingJob>>;
  cleanup: number;
}> {
  const scraping = await runScrapingJob();
  const cleanup = await runCleanupJob();

  return { scraping, cleanup };
}

/**
 * Add a new site to scrape
 */
export async function addScrapeSite(
  name: string,
  url: string,
  type: ScrapeType,
  frequencyHours: number = 24
): Promise<string> {
  const result = await pool.query(`
    INSERT INTO competitor_scrape_config (name, url, type, scrape_frequency_hours)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (url) DO UPDATE SET
      name = EXCLUDED.name,
      type = EXCLUDED.type,
      scrape_frequency_hours = EXCLUDED.scrape_frequency_hours,
      enabled = true
    RETURNING id
  `, [name, url, type, frequencyHours]);

  return result.rows[0].id;
}

/**
 * Disable a scrape site
 */
export async function disableScrapeSite(urlOrId: string): Promise<boolean> {
  const result = await pool.query(`
    UPDATE competitor_scrape_config
    SET enabled = false
    WHERE id = $1 OR url = $1
  `, [urlOrId]);

  return (result.rowCount || 0) > 0;
}

export default {
  scheduleNutritionScraper,
  stopNutritionScraper,
  runNow,
  addScrapeSite,
  disableScrapeSite,
};
