import express, { Request, Response } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool';
import MCPOrchestrator from '../services/mcpOrchestrator';

const mcpSyncRouter = express.Router();

// Initialize MCP Orchestrator
const mcpOrchestrator = new MCPOrchestrator(pool);

// Validation schemas
const syncRequestSchema = z.object({
  provider: z.enum(['fitbit', 'google-fit', 'apple-health']),
  dateRange: z
    .object({
      start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    })
    .optional(),
});

const multiProviderSyncSchema = z.object({
  providers: z.array(z.enum(['fitbit', 'google-fit', 'apple-health'])),
  dateRange: z
    .object({
      start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    })
    .optional(),
});

/**
 * POST /api/v1/mcp/sync
 * Sync data from a single MCP provider
 */
mcpSyncRouter.post('/sync', async (req: Request, res: Response) => {
  const customerId = req.headers['x-shopify-customer-id'] as string;

  if (!customerId) {
    return res.status(401).json({ error: 'Missing customer ID header' });
  }

  try {
    const { provider, dateRange } = syncRequestSchema.parse(req.body);

    console.log(`[MCP Sync API] Starting sync for ${provider}, customer ${customerId}`);
    const startTime = Date.now();

    const result = await mcpOrchestrator.syncProvider(provider, customerId, dateRange);

    const duration = Date.now() - startTime;
    console.log(`[MCP Sync API] Sync completed in ${duration}ms`);

    return res.json({
      success: result.success,
      provider,
      recordsFetched: result.recordsFetched,
      recordsInserted: result.recordsInserted,
      dateRange: dateRange || {
        start: new Date().toISOString().split('T')[0],
        end: new Date().toISOString().split('T')[0],
      },
      durationMs: duration,
      errors: result.errors,
    });
  } catch (error: any) {
    console.error(`[MCP Sync API] Error:`, error);

    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request', details: error.errors });
    }

    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

/**
 * POST /api/v1/mcp/sync-all
 * Sync data from multiple MCP providers in parallel
 */
mcpSyncRouter.post('/sync-all', async (req: Request, res: Response) => {
  const customerId = req.headers['x-shopify-customer-id'] as string;

  if (!customerId) {
    return res.status(401).json({ error: 'Missing customer ID header' });
  }

  try {
    const { providers, dateRange } = multiProviderSyncSchema.parse(req.body);

    console.log(
      `[MCP Sync API] Starting parallel sync for ${providers.join(', ')}, customer ${customerId}`
    );
    const startTime = Date.now();

    // Sync all providers in parallel
    const results = await Promise.allSettled(
      providers.map((provider) =>
        mcpOrchestrator.syncProvider(provider, customerId, dateRange)
      )
    );

    const duration = Date.now() - startTime;

    // Aggregate results
    const syncResults = providers.map((provider, index) => {
      const result = results[index];

      if (result.status === 'fulfilled') {
        return {
          provider,
          success: result.value.success,
          recordsFetched: result.value.recordsFetched,
          recordsInserted: result.value.recordsInserted,
          errors: result.value.errors,
        };
      } else {
        return {
          provider,
          success: false,
          recordsFetched: 0,
          recordsInserted: 0,
          errors: [result.reason.message || 'Unknown error'],
        };
      }
    });

    const totalFetched = syncResults.reduce((sum, r) => sum + r.recordsFetched, 0);
    const totalInserted = syncResults.reduce((sum, r) => sum + r.recordsInserted, 0);
    const allSuccessful = syncResults.every((r) => r.success);

    console.log(`[MCP Sync API] Parallel sync completed in ${duration}ms`);

    return res.json({
      success: allSuccessful,
      results: syncResults,
      summary: {
        totalRecordsFetched: totalFetched,
        totalRecordsInserted: totalInserted,
        providersSucceeded: syncResults.filter((r) => r.success).length,
        providersFailed: syncResults.filter((r) => !r.success).length,
      },
      dateRange: dateRange || {
        start: new Date().toISOString().split('T')[0],
        end: new Date().toISOString().split('T')[0],
      },
      durationMs: duration,
    });
  } catch (error: any) {
    console.error(`[MCP Sync API] Error in sync-all:`, error);

    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid request', details: error.errors });
    }

    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

/**
 * GET /api/v1/mcp/status
 * Get last sync status for all connected providers
 */
mcpSyncRouter.get('/status', async (req: Request, res: Response) => {
  const customerId = req.headers['x-shopify-customer-id'] as string;

  if (!customerId) {
    return res.status(401).json({ error: 'Missing customer ID header' });
  }

  try {
    // Query last sync for each provider
    const result = await pool.query(
      `SELECT
         provider,
         MAX(created_at) as last_sync,
         SUM(CASE WHEN success = true THEN 1 ELSE 0 END) as successful_syncs,
         SUM(CASE WHEN success = false THEN 1 ELSE 0 END) as failed_syncs,
         SUM(record_count) as total_records_synced
       FROM hc_mcp_audit_log
       WHERE customer_id = $1
       GROUP BY provider
       ORDER BY last_sync DESC`,
      [customerId]
    );

    const providers = result.rows.map((row) => ({
      provider: row.provider,
      lastSync: row.last_sync,
      successfulSyncs: parseInt(row.successful_syncs),
      failedSyncs: parseInt(row.failed_syncs),
      totalRecordsSynced: parseInt(row.total_records_synced),
      status: row.last_sync ? 'configured' : 'not_configured',
    }));

    return res.json({
      providers,
      totalProviders: providers.length,
    });
  } catch (error: any) {
    console.error(`[MCP Sync API] Error fetching status:`, error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

/**
 * GET /api/v1/mcp/audit
 * Get audit log for MCP operations (recent 50 entries)
 */
mcpSyncRouter.get('/audit', async (req: Request, res: Response) => {
  const customerId = req.headers['x-shopify-customer-id'] as string;

  if (!customerId) {
    return res.status(401).json({ error: 'Missing customer ID header' });
  }

  try {
    const limit = parseInt((req.query.limit as string) || '50');
    const provider = req.query.provider as string | undefined;

    let query = `
      SELECT id, provider, operation, success, record_count, error_message,
             duration_ms, created_at
      FROM hc_mcp_audit_log
      WHERE customer_id = $1
    `;
    const params: any[] = [customerId];

    if (provider) {
      query += ` AND provider = $2`;
      params.push(provider);
      query += ` ORDER BY created_at DESC LIMIT $3`;
      params.push(limit);
    } else {
      query += ` ORDER BY created_at DESC LIMIT $2`;
      params.push(limit);
    }

    const result = await pool.query(query, params);

    return res.json({
      logs: result.rows,
      count: result.rows.length,
    });
  } catch (error: any) {
    console.error(`[MCP Sync API] Error fetching audit log:`, error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

/**
 * GET /api/v1/mcp/history
 * Get historical health data with optional filtering
 */
mcpSyncRouter.get('/history', async (req: Request, res: Response) => {
  const customerId = req.headers['x-shopify-customer-id'] as string;

  if (!customerId) {
    return res.status(401).json({ error: 'Missing customer ID header' });
  }

  try {
    const startDate = req.query.startDate as string;
    const endDate = req.query.endDate as string;
    const source = req.query.source as string | undefined;
    const dataType = req.query.dataType as string | undefined; // steps, calories, sleep, etc.

    let query = `
      SELECT recorded_date, source_type, steps, active_calories, resting_calories,
             distance_meters, floors_climbed, active_minutes,
             sleep_minutes, resting_heart_rate, weight_kg
      FROM hc_health_history
      WHERE customer_id = $1
    `;
    const params: any[] = [customerId];
    let paramCount = 1;

    if (startDate) {
      paramCount++;
      query += ` AND recorded_date >= $${paramCount}`;
      params.push(startDate);
    }

    if (endDate) {
      paramCount++;
      query += ` AND recorded_date <= $${paramCount}`;
      params.push(endDate);
    }

    if (source) {
      paramCount++;
      query += ` AND source_type = $${paramCount}`;
      params.push(source);
    }

    query += ` ORDER BY recorded_date DESC, source_type`;

    const result = await pool.query(query, params);

    // Filter by data type if specified
    let data = result.rows;
    if (dataType) {
      data = data.map((row) => {
        const filtered: any = {
          recorded_date: row.recorded_date,
          source_type: row.source_type,
        };

        switch (dataType) {
          case 'steps':
            filtered.steps = row.steps;
            break;
          case 'calories':
            filtered.active_calories = row.active_calories;
            filtered.resting_calories = row.resting_calories;
            break;
          case 'sleep':
            filtered.sleep_minutes = row.sleep_minutes;
            break;
          case 'heart_rate':
            filtered.resting_heart_rate = row.resting_heart_rate;
            break;
          case 'weight':
            filtered.weight_kg = row.weight_kg;
            break;
          default:
            return row;
        }

        return filtered;
      });
    }

    return res.json({
      data,
      count: data.length,
      filters: {
        startDate,
        endDate,
        source,
        dataType,
      },
    });
  } catch (error: any) {
    console.error(`[MCP Sync API] Error fetching history:`, error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// Cleanup on server shutdown
process.on('SIGTERM', async () => {
  console.log('[MCP Sync API] Received SIGTERM, disconnecting MCP servers...');
  await mcpOrchestrator.disconnectAll();
});

process.on('SIGINT', async () => {
  console.log('[MCP Sync API] Received SIGINT, disconnecting MCP servers...');
  await mcpOrchestrator.disconnectAll();
});

export default mcpSyncRouter;
