/**
 * Scrape Routes - Web Scraping for Nutrition Data
 *
 * Endpoints for scraping recipes, nutrition info, and competitor data.
 * Uses Firecrawl for scraping and OpenAI for extraction.
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import { asyncHandler } from '../middleware/asyncHandler';
import { sendSuccess, sendError } from '../middleware/responseHelper';
import { auditLogger, AuditAction, ResourceType } from '../services/auditLogger';
import {
  scrapeAndExtract,
  getCachedScrape,
  getRecentScrapes,
  batchScrape,
  isConfigured,
  ScrapeType,
} from '../services/firecrawlService';

const router = Router();

// Validation schemas
const ScrapeRequestSchema = z.object({
  url: z.string().url('Invalid URL format'),
  type: z.enum(['recipe', 'nutrition', 'competitor']),
  useCache: z.boolean().optional().default(true),
});

const BatchScrapeSchema = z.object({
  urls: z.array(z.object({
    url: z.string().url('Invalid URL format'),
    type: z.enum(['recipe', 'nutrition', 'competitor']),
  })).min(1).max(10, 'Maximum 10 URLs per batch'),
});

/**
 * POST /api/v1/scrape
 *
 * Scrape a URL and extract structured nutrition data.
 *
 * Body:
 * - url: string - The URL to scrape
 * - type: 'recipe' | 'nutrition' | 'competitor' - Type of content
 * - useCache: boolean - Use cached result if available (default: true)
 */
router.post(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    // Validate request body
    const parseResult = ScrapeRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      return sendError(res, 'Validation error', 400, {
        errors: parseResult.error.flatten().fieldErrors,
      });
    }

    const { url, type, useCache } = parseResult.data;

    // Check if service is configured
    if (!isConfigured()) {
      return sendError(
        res,
        'Scraping service not configured. Please set FIRECRAWL_API_KEY and OPENAI_API_KEY.',
        503
      );
    }

    // Get user ID for audit logging
    const userId = (req as any).customerId || 'anonymous';

    // Check cache if enabled
    if (useCache) {
      const cached = await getCachedScrape(url);
      if (cached) {
        auditLogger.log({
          action: AuditAction.SCRAPE_CACHE_HIT,
          userId,
          resourceType: ResourceType.NUTRITION_SCRAPE,
          resourceId: cached.id,
          correlationId: crypto.randomUUID(),
          metadata: { url, type },
        });

        return sendSuccess(res, {
          cached: true,
          ...cached,
        });
      }
    }

    // Perform scraping
    try {
      const result = await scrapeAndExtract(url, type as ScrapeType);

      auditLogger.log({
        action: AuditAction.SCRAPE_SUCCESS,
        userId,
        resourceType: ResourceType.NUTRITION_SCRAPE,
        resourceId: result.id,
        correlationId: crypto.randomUUID(),
        metadata: { url, type },
      });

      return sendSuccess(res, {
        cached: false,
        ...result,
      });
    } catch (error: any) {
      auditLogger.log({
        action: AuditAction.SCRAPE_FAILED,
        userId,
        resourceType: ResourceType.NUTRITION_SCRAPE,
        correlationId: crypto.randomUUID(),
        metadata: { url, type, error: error.message },
      });

      // Handle specific errors
      if (error.message.includes('Rate limit')) {
        return sendError(res, error.message, 429);
      }
      if (error.message.includes('Invalid URL') || error.message.includes('not allowed')) {
        return sendError(res, error.message, 400);
      }

      return sendError(res, `Scraping failed: ${error.message}`, 500);
    }
  })
);

/**
 * POST /api/v1/scrape/batch
 *
 * Batch scrape multiple URLs.
 *
 * Body:
 * - urls: Array<{url: string, type: ScrapeType}> - URLs to scrape (max 10)
 */
router.post(
  '/batch',
  asyncHandler(async (req: Request, res: Response) => {
    const parseResult = BatchScrapeSchema.safeParse(req.body);
    if (!parseResult.success) {
      return sendError(res, 'Validation error', 400, {
        errors: parseResult.error.flatten().fieldErrors,
      });
    }

    if (!isConfigured()) {
      return sendError(
        res,
        'Scraping service not configured',
        503
      );
    }

    const results = await batchScrape(parseResult.data.urls);

    const userId = (req as any).customerId || 'anonymous';
    auditLogger.log({
      action: AuditAction.SCRAPE_BATCH,
      userId,
      resourceType: ResourceType.NUTRITION_SCRAPE,
      correlationId: crypto.randomUUID(),
      metadata: {
        total: results.length,
        successful: results.filter(r => r.success).length,
        failed: results.filter(r => !r.success).length,
      },
    });

    return sendSuccess(res, {
      total: results.length,
      successful: results.filter(r => r.success).length,
      results,
    });
  })
);

/**
 * GET /api/v1/scrape/recent
 *
 * Get recent scrapes, optionally filtered by type.
 *
 * Query:
 * - type: 'recipe' | 'nutrition' | 'competitor' (optional)
 * - limit: number (default: 20, max: 100)
 */
router.get(
  '/recent',
  asyncHandler(async (req: Request, res: Response) => {
    const type = req.query.type as ScrapeType | undefined;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);

    if (type && !['recipe', 'nutrition', 'competitor'].includes(type)) {
      return sendError(res, 'Invalid type. Must be recipe, nutrition, or competitor.', 400);
    }

    const scrapes = await getRecentScrapes(type, limit);

    return sendSuccess(res, {
      count: scrapes.length,
      scrapes,
    });
  })
);

/**
 * GET /api/v1/scrape/lookup
 *
 * Check if a URL has been scraped (useful for cache check).
 *
 * Query:
 * - url: string - The URL to check
 */
router.get(
  '/lookup',
  asyncHandler(async (req: Request, res: Response) => {
    const url = req.query.url as string;

    if (!url) {
      return sendError(res, 'URL parameter required', 400);
    }

    try {
      new URL(url);
    } catch {
      return sendError(res, 'Invalid URL format', 400);
    }

    const cached = await getCachedScrape(url);

    if (!cached) {
      return sendSuccess(res, {
        found: false,
        url,
      });
    }

    return sendSuccess(res, {
      found: true,
      scrape: cached,
    });
  })
);

/**
 * GET /api/v1/scrape/status
 *
 * Check if the scraping service is configured and ready.
 */
router.get(
  '/status',
  asyncHandler(async (_req: Request, res: Response) => {
    const configured = isConfigured();

    return sendSuccess(res, {
      configured,
      firecrawl: !!process.env.FIRECRAWL_API_KEY,
      openai: !!process.env.OPENAI_API_KEY,
      message: configured
        ? 'Scraping service is ready'
        : 'Missing FIRECRAWL_API_KEY or OPENAI_API_KEY',
    });
  })
);

/**
 * POST /api/v1/scrape/enrich
 *
 * Convenience endpoint to enrich a food/meal with web data.
 * Searches for the food name and returns nutrition info.
 *
 * Body:
 * - query: string - Food name or recipe to search for
 */
router.post(
  '/enrich',
  asyncHandler(async (req: Request, res: Response) => {
    const { query } = req.body;

    if (!query || typeof query !== 'string') {
      return sendError(res, 'Query string required', 400);
    }

    if (!isConfigured()) {
      return sendError(res, 'Scraping service not configured', 503);
    }

    // Construct a search URL (using a reliable nutrition database)
    // We'll try USDA FoodData Central or similar
    const searchUrl = `https://fdc.nal.usda.gov/fdc-app.html#/food-search?query=${encodeURIComponent(query)}`;

    try {
      const result = await scrapeAndExtract(searchUrl, 'nutrition');

      return sendSuccess(res, {
        query,
        ...result,
      });
    } catch (error: any) {
      // Fallback: return a helpful message
      return sendError(
        res,
        `Could not enrich "${query}": ${error.message}`,
        500
      );
    }
  })
);

export { router as scrapeRouter };
