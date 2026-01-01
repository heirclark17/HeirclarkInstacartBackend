/**
 * RAG Service
 * Core service for Retrieval-Augmented Generation
 * Handles document ingestion, embedding, and retrieval
 */

import { Pool } from 'pg';
import OpenAI from 'openai';
import { pool } from '../../db/pool';
import {
  RagDocument,
  RagChunk,
  RetrievedChunk,
  RetrievalOptions,
  ChunkingOptions,
  UpsertDocumentOptions,
  DocumentType,
  DocumentSource,
} from './types';

// ============================================================================
// Configuration
// ============================================================================

const EMBEDDINGS_MODEL = process.env.EMBEDDINGS_MODEL || 'text-embedding-3-small';
const EMBEDDINGS_DIM = parseInt(process.env.EMBEDDINGS_DIM || '1536', 10);
const DEFAULT_CHUNK_SIZE = 500; // approximate tokens
const DEFAULT_OVERLAP = 50;
const DEFAULT_K = 8;
const DEFAULT_SIMILARITY_THRESHOLD = 0.5;

// Initialize OpenAI client (optional - for embedding generation)
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const openai = OPENAI_API_KEY
  ? new OpenAI({ apiKey: OPENAI_API_KEY })
  : null;

// ============================================================================
// Text Chunking
// ============================================================================

/**
 * Estimate token count (rough approximation: ~4 chars per token)
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Split text into chunks with overlap
 */
export function chunkText(
  text: string,
  options: ChunkingOptions = {}
): string[] {
  const chunkSize = options.chunkSize || DEFAULT_CHUNK_SIZE;
  const overlap = options.overlap || DEFAULT_OVERLAP;
  const separator = options.separator || '\n\n';

  // First, split by separator (paragraphs)
  const paragraphs = text.split(separator).filter(p => p.trim());

  const chunks: string[] = [];
  let currentChunk = '';
  let currentTokens = 0;

  for (const paragraph of paragraphs) {
    const paragraphTokens = estimateTokens(paragraph);

    // If single paragraph exceeds chunk size, split it further
    if (paragraphTokens > chunkSize) {
      // Flush current chunk first
      if (currentChunk.trim()) {
        chunks.push(currentChunk.trim());
        currentChunk = '';
        currentTokens = 0;
      }

      // Split long paragraph by sentences
      const sentences = paragraph.split(/(?<=[.!?])\s+/);
      for (const sentence of sentences) {
        const sentenceTokens = estimateTokens(sentence);
        if (currentTokens + sentenceTokens > chunkSize && currentChunk.trim()) {
          chunks.push(currentChunk.trim());
          // Keep overlap
          const words = currentChunk.split(' ');
          const overlapWords = words.slice(-Math.floor(overlap / 2));
          currentChunk = overlapWords.join(' ') + ' ' + sentence;
          currentTokens = estimateTokens(currentChunk);
        } else {
          currentChunk += (currentChunk ? ' ' : '') + sentence;
          currentTokens += sentenceTokens;
        }
      }
    } else if (currentTokens + paragraphTokens > chunkSize) {
      // Flush and start new chunk with overlap
      chunks.push(currentChunk.trim());

      // Create overlap from end of current chunk
      const words = currentChunk.split(' ');
      const overlapWords = words.slice(-Math.floor(overlap / 2));
      currentChunk = overlapWords.join(' ') + separator + paragraph;
      currentTokens = estimateTokens(currentChunk);
    } else {
      currentChunk += (currentChunk ? separator : '') + paragraph;
      currentTokens += paragraphTokens;
    }
  }

  // Don't forget the last chunk
  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }

  return chunks;
}

// ============================================================================
// Embedding Generation
// ============================================================================

/**
 * Check if embeddings are available
 */
export function embeddingsAvailable(): boolean {
  return openai !== null;
}

/**
 * Generate embedding for text using OpenAI
 * Returns empty array if OpenAI is not configured
 */
export async function embedText(text: string): Promise<number[]> {
  if (!openai) {
    console.warn('[RAG] OpenAI not configured, skipping embedding generation');
    return [];
  }

  try {
    const response = await openai.embeddings.create({
      model: EMBEDDINGS_MODEL,
      input: text.slice(0, 8000), // Limit input length
      dimensions: EMBEDDINGS_DIM,
    });

    return response.data[0].embedding;
  } catch (error) {
    console.error('[RAG] Embedding error:', error);
    return []; // Return empty array on error (graceful degradation)
  }
}

/**
 * Generate embeddings for multiple texts (batched)
 * Returns empty arrays if OpenAI is not configured
 */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  if (!openai) {
    console.warn('[RAG] OpenAI not configured, skipping embedding generation');
    return texts.map(() => []); // Return empty arrays
  }

  try {
    const response = await openai.embeddings.create({
      model: EMBEDDINGS_MODEL,
      input: texts.map(t => t.slice(0, 8000)),
      dimensions: EMBEDDINGS_DIM,
    });

    return response.data.map(d => d.embedding);
  } catch (error) {
    console.error('[RAG] Batch embedding error:', error);
    return texts.map(() => []); // Return empty arrays on error
  }
}

// ============================================================================
// Document Ingestion
// ============================================================================

/**
 * Upsert a document with its chunks and embeddings
 */
export async function upsertDocumentWithChunks(
  options: UpsertDocumentOptions
): Promise<{ documentId: string; chunkCount: number }> {
  const { title, source, docType, text, metadata = {}, chunkingOptions } = options;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Check if document with same title exists
    const existingDoc = await client.query(
      'SELECT id FROM rag_documents WHERE title = $1',
      [title]
    );

    let documentId: string;

    if (existingDoc.rows.length > 0) {
      // Update existing document
      documentId = existingDoc.rows[0].id;
      await client.query(
        `UPDATE rag_documents
         SET source = $2, doc_type = $3, metadata = $4, updated_at = NOW()
         WHERE id = $1`,
        [documentId, source, docType, JSON.stringify(metadata)]
      );

      // Delete old chunks
      await client.query('DELETE FROM rag_chunks WHERE document_id = $1', [documentId]);
    } else {
      // Insert new document
      const docResult = await client.query(
        `INSERT INTO rag_documents (title, source, doc_type, metadata)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [title, source, docType, JSON.stringify(metadata)]
      );
      documentId = docResult.rows[0].id;
    }

    // Chunk the text
    const chunks = chunkText(text, chunkingOptions);

    // Generate embeddings in batches
    const batchSize = 20;
    let chunkCount = 0;

    for (let i = 0; i < chunks.length; i += batchSize) {
      const batch = chunks.slice(i, i + batchSize);
      const embeddings = await embedTexts(batch);

      for (let j = 0; j < batch.length; j++) {
        const chunkIndex = i + j;
        const chunkText = batch[j];
        const embedding = embeddings[j];
        const tokens = estimateTokens(chunkText);

        // Store embedding as JSON or null if empty
        const embeddingJson = embedding && embedding.length > 0
          ? JSON.stringify(embedding)
          : null;

        await client.query(
          `INSERT INTO rag_chunks
           (document_id, chunk_index, chunk_text, chunk_metadata, embedding_json, tokens)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            documentId,
            chunkIndex,
            chunkText,
            JSON.stringify({ ...metadata, chunk_index: chunkIndex }),
            embeddingJson,
            tokens,
          ]
        );
        chunkCount++;
      }
    }

    await client.query('COMMIT');
    console.log(`[RAG] Ingested document "${title}" with ${chunkCount} chunks`);

    return { documentId, chunkCount };
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[RAG] Document ingestion error:', error);
    throw error;
  } finally {
    client.release();
  }
}

// ============================================================================
// Retrieval
// ============================================================================

/**
 * Retrieve top-K similar chunks for a query
 * Uses text-based search (pg_trgm) as fallback when pgvector is not available
 */
export async function retrieveTopK(
  options: RetrievalOptions
): Promise<RetrievedChunk[]> {
  const {
    query,
    k = DEFAULT_K,
    filters = {},
    similarityThreshold = DEFAULT_SIMILARITY_THRESHOLD,
  } = options;

  try {
    // Build filter conditions
    const filterTypes = filters.types?.length ? filters.types : null;

    // Use text-based search with pg_trgm (fallback for non-pgvector databases)
    const result = await pool.query(
      `SELECT * FROM search_rag_chunks_text($1, $2, $3)`,
      [query, k, filterTypes]
    );

    return result.rows.map((row: Record<string, unknown>) => ({
      chunkId: row.chunk_id as string,
      documentId: row.document_id as string,
      chunkText: row.chunk_text as string,
      chunkMetadata: row.chunk_metadata as Record<string, unknown>,
      docTitle: row.doc_title as string,
      docType: row.doc_type as DocumentType,
      similarity: parseFloat(row.similarity as string) || 0.5,
    }));
  } catch (error) {
    console.error('[RAG] Retrieval error:', error);
    // Return empty array on error (graceful degradation)
    return [];
  }
}

/**
 * Retrieve chunks for meal estimation (rules + food types)
 */
export async function retrieveForMealEstimation(
  query: string,
  k: number = 8
): Promise<RetrievedChunk[]> {
  return retrieveTopK({
    query,
    k,
    filters: {
      types: ['rules', 'food', 'portion', 'conversion'],
    },
    similarityThreshold: 0.4,
  });
}

/**
 * Retrieve chunks for healthier swaps (rules + support types)
 */
export async function retrieveForSwaps(
  query: string,
  k: number = 4
): Promise<RetrievedChunk[]> {
  return retrieveTopK({
    query,
    k,
    filters: {
      types: ['rules', 'support', 'food'],
    },
    similarityThreshold: 0.4,
  });
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Format retrieved chunks for LLM prompt
 */
export function formatChunksForPrompt(chunks: RetrievedChunk[]): string {
  if (chunks.length === 0) {
    return 'No relevant knowledge base entries found.';
  }

  return chunks
    .map((chunk, i) => {
      const score = (chunk.similarity * 100).toFixed(0);
      return `[Source ${i + 1}: ${chunk.docTitle} (${chunk.docType}, ${score}% match)]
${chunk.chunkText}
[/Source ${i + 1}]`;
    })
    .join('\n\n');
}

/**
 * Get chunk IDs as citations
 */
export function getChunkCitations(chunks: RetrievedChunk[]): string[] {
  return chunks.map(c => c.chunkId);
}

/**
 * Check if retrieval is strong enough for confident estimation
 */
export function isRetrievalStrong(chunks: RetrievedChunk[]): boolean {
  if (chunks.length === 0) return false;

  // At least 2 chunks with >60% similarity
  const strongMatches = chunks.filter(c => c.similarity > 0.6);
  return strongMatches.length >= 2;
}

// ============================================================================
// AI Request Logging
// ============================================================================

/**
 * Log an AI request for auditing
 */
export async function logAiRequest(params: {
  shopifyCustomerId?: string;
  mode: 'meal_text' | 'meal_photo' | 'barcode';
  queryText?: string;
  imageHash?: string;
  retrievedChunkIds: string[];
  llmModel: string;
  llmResponse?: Record<string, unknown>;
  confidence?: number;
  processingTimeMs?: number;
}): Promise<string> {
  try {
    const result = await pool.query(
      `INSERT INTO ai_request_logs
       (shopify_customer_id, mode, query_text, image_hash, retrieved_chunk_ids,
        llm_model, llm_response, confidence, processing_time_ms)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id`,
      [
        params.shopifyCustomerId || null,
        params.mode,
        params.queryText || null,
        params.imageHash || null,
        JSON.stringify(params.retrievedChunkIds),
        params.llmModel,
        params.llmResponse ? JSON.stringify(params.llmResponse) : null,
        params.confidence || null,
        params.processingTimeMs || null,
      ]
    );
    return result.rows[0].id;
  } catch (error) {
    console.error('[RAG] Failed to log AI request:', error);
    return '';
  }
}

// ============================================================================
// Database Health Check
// ============================================================================

/**
 * Check if RAG tables exist (pgvector is optional - uses text search fallback)
 */
export async function checkRagHealth(): Promise<{
  ok: boolean;
  pgvector: boolean;
  tables: { documents: boolean; chunks: boolean; logs: boolean };
  documentCount: number;
  chunkCount: number;
}> {
  try {
    // Check pgvector extension (optional - text search fallback available)
    const extResult = await pool.query(
      "SELECT 1 FROM pg_extension WHERE extname = 'vector'"
    );
    const pgvector = extResult.rows.length > 0;

    // Check tables exist
    const tablesResult = await pool.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public'
      AND table_name IN ('rag_documents', 'rag_chunks', 'ai_request_logs')
    `);
    const tables = tablesResult.rows.map((r: { table_name: string }) => r.table_name);

    let documentCount = 0;
    let chunkCount = 0;

    if (tables.includes('rag_documents')) {
      const docCountResult = await pool.query('SELECT COUNT(*) FROM rag_documents');
      documentCount = parseInt(docCountResult.rows[0].count, 10);
    }

    if (tables.includes('rag_chunks')) {
      const chunkCountResult = await pool.query('SELECT COUNT(*) FROM rag_chunks');
      chunkCount = parseInt(chunkCountResult.rows[0].count, 10);
    }

    // RAG is OK if tables exist (pgvector is optional, text search works as fallback)
    return {
      ok: tables.length === 3,
      pgvector,
      tables: {
        documents: tables.includes('rag_documents'),
        chunks: tables.includes('rag_chunks'),
        logs: tables.includes('ai_request_logs'),
      },
      documentCount,
      chunkCount,
    };
  } catch (error) {
    console.error('[RAG] Health check error:', error);
    return {
      ok: false,
      pgvector: false,
      tables: { documents: false, chunks: false, logs: false },
      documentCount: 0,
      chunkCount: 0,
    };
  }
}

export default {
  chunkText,
  embedText,
  embedTexts,
  upsertDocumentWithChunks,
  retrieveTopK,
  retrieveForMealEstimation,
  retrieveForSwaps,
  formatChunksForPrompt,
  getChunkCitations,
  isRetrievalStrong,
  logAiRequest,
  checkRagHealth,
};
