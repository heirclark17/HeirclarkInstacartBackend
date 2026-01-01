-- RAG System Migration: Without pgvector (text-based fallback)
-- Use this when pgvector is not available

-- Enable pg_trgm for fuzzy text matching
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Step 1: RAG Documents table (source documents for knowledge base)
CREATE TABLE IF NOT EXISTS rag_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  source TEXT NOT NULL,  -- 'seed', 'usda', 'user_feedback', 'nutritionist'
  doc_type TEXT NOT NULL DEFAULT 'general',  -- 'rules', 'food', 'support', 'portion', 'conversion'
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Step 2: RAG Chunks table (text chunks - embeddings stored as JSONB for future use)
CREATE TABLE IF NOT EXISTS rag_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES rag_documents(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL DEFAULT 0,
  chunk_text TEXT NOT NULL,
  chunk_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  embedding_json JSONB,  -- Store embeddings as JSON array (fallback without pgvector)
  tokens INTEGER,  -- approximate token count
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Step 3: AI Request Logs table (for auditing and improving)
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

-- Step 4: Top Foods Cache table (for performance)
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

-- Step 5: Create indexes

-- GIN index for fuzzy text search using pg_trgm
CREATE INDEX IF NOT EXISTS idx_rag_chunks_text_trgm
ON rag_chunks
USING GIN (chunk_text gin_trgm_ops);

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

-- Step 6: Create update trigger for rag_documents
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

-- Step 7: Text-based search function (fallback without vector similarity)
CREATE OR REPLACE FUNCTION search_rag_chunks_text(
  query_text TEXT,
  match_count INTEGER DEFAULT 8,
  filter_types TEXT[] DEFAULT NULL
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
    similarity(c.chunk_text, query_text)::NUMERIC AS similarity
  FROM rag_chunks c
  JOIN rag_documents d ON d.id = c.document_id
  WHERE
    (filter_types IS NULL OR d.doc_type = ANY(filter_types))
    AND c.chunk_text % query_text  -- pg_trgm similarity operator
  ORDER BY similarity(c.chunk_text, query_text) DESC
  LIMIT match_count;
END;
$$ LANGUAGE plpgsql;

-- Done!
COMMENT ON TABLE rag_documents IS 'Source documents for RAG knowledge base';
COMMENT ON TABLE rag_chunks IS 'Text chunks for search (embeddings stored as JSON for future pgvector use)';
COMMENT ON TABLE ai_request_logs IS 'Audit log for AI requests with RAG context';
COMMENT ON TABLE top_foods_cache IS 'Cached top foods for quick discovery';
