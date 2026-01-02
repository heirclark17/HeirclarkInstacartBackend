-- RAG System Migration: pgvector extension and tables
-- Run this migration to enable RAG for meal estimation

-- Step 1: Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Step 2: RAG Documents table (source documents for knowledge base)
CREATE TABLE IF NOT EXISTS rag_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  source TEXT NOT NULL,  -- 'seed', 'usda', 'user_feedback', 'nutritionist'
  doc_type TEXT NOT NULL DEFAULT 'general',  -- 'rules', 'food', 'support', 'portion', 'conversion'
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Step 3: RAG Chunks table (embedded text chunks)
CREATE TABLE IF NOT EXISTS rag_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES rag_documents(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL DEFAULT 0,
  chunk_text TEXT NOT NULL,
  chunk_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  embedding vector(1536),  -- OpenAI text-embedding-3-small dimension
  tokens INTEGER,  -- approximate token count
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Step 4: AI Request Logs table (for auditing and improving)
CREATE TABLE IF NOT EXISTS ai_request_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shopify_customer_id TEXT,
  mode TEXT NOT NULL,  -- 'meal_text', 'meal_photo', 'barcode'
  query_text TEXT,
  image_hash TEXT,  -- hash of image if photo mode
  retrieved_chunk_ids JSONB,  -- array of chunk UUIDs used
  llm_model TEXT,
  llm_response JSONB,
  confidence NUMERIC(5,2),
  processing_time_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Step 5: Top Foods Cache table (for performance)
CREATE TABLE IF NOT EXISTS top_foods_cache (
  id SERIAL PRIMARY KEY,
  scope TEXT NOT NULL,  -- 'global' or shopify_customer_id
  food_name TEXT NOT NULL,
  occurrence_count INTEGER NOT NULL DEFAULT 1,
  avg_calories NUMERIC(8,2),
  avg_protein NUMERIC(8,2),
  avg_carbs NUMERIC(8,2),
  avg_fat NUMERIC(8,2),
  last_updated TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(scope, food_name)
);

-- Step 6: Create indexes

-- HNSW index for fast similarity search (better than IVFFlat for most cases)
CREATE INDEX IF NOT EXISTS idx_rag_chunks_embedding_hnsw
ON rag_chunks
USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);

-- GIN index on chunk metadata for filtering
CREATE INDEX IF NOT EXISTS idx_rag_chunks_metadata
ON rag_chunks
USING GIN (chunk_metadata);

-- Index on document type for filtering
CREATE INDEX IF NOT EXISTS idx_rag_documents_type
ON rag_documents (doc_type);

-- Index on document source
CREATE INDEX IF NOT EXISTS idx_rag_documents_source
ON rag_documents (source);

-- Index for AI logs by customer
CREATE INDEX IF NOT EXISTS idx_ai_request_logs_customer
ON ai_request_logs (shopify_customer_id, created_at DESC);

-- Index for AI logs by mode
CREATE INDEX IF NOT EXISTS idx_ai_request_logs_mode
ON ai_request_logs (mode, created_at DESC);

-- Index for top foods lookup
CREATE INDEX IF NOT EXISTS idx_top_foods_scope
ON top_foods_cache (scope, occurrence_count DESC);

-- Step 7: Create update trigger for rag_documents
CREATE OR REPLACE FUNCTION update_rag_documents_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_rag_documents_updated_at ON rag_documents;
CREATE TRIGGER trg_rag_documents_updated_at
  BEFORE UPDATE ON rag_documents
  FOR EACH ROW
  EXECUTE FUNCTION update_rag_documents_updated_at();

-- Step 8: Helper function to search similar chunks
CREATE OR REPLACE FUNCTION search_rag_chunks(
  query_embedding vector(1536),
  match_count INTEGER DEFAULT 8,
  filter_types TEXT[] DEFAULT NULL,
  similarity_threshold NUMERIC DEFAULT 0.5
)
RETURNS TABLE (
  chunk_id UUID,
  document_id UUID,
  chunk_text TEXT,
  chunk_metadata JSONB,
  doc_title TEXT,
  doc_type TEXT,
  similarity NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    c.id AS chunk_id,
    c.document_id,
    c.chunk_text,
    c.chunk_metadata,
    d.title AS doc_title,
    d.doc_type,
    (1 - (c.embedding <=> query_embedding))::NUMERIC AS similarity
  FROM rag_chunks c
  JOIN rag_documents d ON d.id = c.document_id
  WHERE
    c.embedding IS NOT NULL
    AND (filter_types IS NULL OR d.doc_type = ANY(filter_types))
    AND (1 - (c.embedding <=> query_embedding)) >= similarity_threshold
  ORDER BY c.embedding <=> query_embedding
  LIMIT match_count;
END;
$$ LANGUAGE plpgsql;

-- Done!
COMMENT ON TABLE rag_documents IS 'Source documents for RAG knowledge base';
COMMENT ON TABLE rag_chunks IS 'Embedded text chunks for semantic search';
COMMENT ON TABLE ai_request_logs IS 'Audit log for AI requests with RAG context';
COMMENT ON TABLE top_foods_cache IS 'Cached top foods for quick discovery';
