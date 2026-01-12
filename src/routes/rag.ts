/**
 * RAG Routes
 * Endpoints for RAG system management and top foods discovery
 */

import { Router, Request, Response } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';
import { sendSuccess, sendError } from '../middleware/responseHelper';
import {
  checkRagHealth,
  getTopFoods,
  getUserTopFoods,
  refreshTopFoodsCache,
  upsertDocumentWithChunks,
  retrieveTopK,
} from '../services/rag';
import { authMiddleware } from '../middleware/auth';

const router = Router();

// ✅ SECURITY FIX: Apply STRICT authentication (OWASP A01: IDOR Protection)
router.use(authMiddleware({ strictAuth: true }));

// ============================================================================
// Health Check
// ============================================================================

/**
 * GET /api/v1/rag/health
 * Check RAG system health and status
 */
router.get('/health', asyncHandler(async (req: Request, res: Response) => {
  const health = await checkRagHealth();

  sendSuccess(res, {
    status: health.ok ? 'healthy' : 'degraded',
    pgvector_enabled: health.pgvector,
    tables: health.tables,
    document_count: health.documentCount,
    chunk_count: health.chunkCount,
    message: health.ok
      ? 'RAG system is operational'
      : 'RAG system needs setup. Run migrations and seed data.',
  });
}));

// ============================================================================
// Top Foods Discovery
// ============================================================================

/**
 * GET /api/v1/rag/top-foods
 * Get most common foods from meal history or fallback list
 *
 * Query params:
 * - limit: number (default 25, max 100)
 * - scope: 'global' | 'user' (default 'global')
 * - shopifyCustomerId: string (required if scope=user)
 */
router.get('/top-foods', asyncHandler(async (req: Request, res: Response) => {
  const limit = Math.min(parseInt(req.query.limit as string) || 25, 100);
  const scope = req.query.scope as string || 'global';
  const customerId = req.query.shopifyCustomerId as string ||
    req.headers['x-shopify-customer-id'] as string;

  let result;

  if (scope === 'user' && customerId) {
    result = await getUserTopFoods(customerId, limit);
  } else {
    result = await getTopFoods(limit);
  }

  sendSuccess(res, {
    foods: result.foods,
    count: result.foods.length,
    source: result.source,
    last_updated: result.lastUpdated?.toISOString(),
  });
}));

/**
 * POST /api/v1/rag/top-foods/refresh
 * Refresh the top foods cache (admin use)
 */
router.post('/top-foods/refresh', asyncHandler(async (req: Request, res: Response) => {
  await refreshTopFoodsCache();

  sendSuccess(res, {
    message: 'Top foods cache refreshed',
    timestamp: new Date().toISOString(),
  });
}));

// ============================================================================
// Document Management
// ============================================================================

/**
 * POST /api/v1/rag/documents
 * Ingest a new document into the RAG system
 */
router.post('/documents', asyncHandler(async (req: Request, res: Response) => {
  const { title, source, docType, text, metadata, chunkingOptions } = req.body;

  if (!title || !source || !docType || !text) {
    return sendError(res, 'Missing required fields: title, source, docType, text', 400);
  }

  const result = await upsertDocumentWithChunks({
    title,
    source,
    docType,
    text,
    metadata,
    chunkingOptions,
  });

  sendSuccess(res, {
    message: 'Document ingested successfully',
    document_id: result.documentId,
    chunk_count: result.chunkCount,
  }, 201);
}));

/**
 * POST /api/v1/rag/search
 * Search for similar chunks (for testing/debugging)
 */
router.post('/search', asyncHandler(async (req: Request, res: Response) => {
  const { query, k, types, similarityThreshold } = req.body;

  if (!query) {
    return sendError(res, 'Missing required field: query', 400);
  }

  const chunks = await retrieveTopK({
    query,
    k: k || 8,
    filters: {
      types: types || undefined,
    },
    similarityThreshold: similarityThreshold || 0.5,
  });

  sendSuccess(res, {
    query,
    chunks: chunks.map(c => ({
      id: c.chunkId,
      document_id: c.documentId,
      doc_title: c.docTitle,
      doc_type: c.docType,
      similarity: c.similarity,
      text_preview: c.chunkText.slice(0, 200) + (c.chunkText.length > 200 ? '...' : ''),
    })),
    count: chunks.length,
  });
}));

// ============================================================================
// Stats
// ============================================================================

/**
 * GET /api/v1/rag/stats
 * Get RAG system statistics
 */
router.get('/stats', asyncHandler(async (req: Request, res: Response) => {
  const health = await checkRagHealth();

  sendSuccess(res, {
    documents: health.documentCount,
    chunks: health.chunkCount,
    pgvector_enabled: health.pgvector,
    system_ready: health.ok,
  });
}));

export default router;
