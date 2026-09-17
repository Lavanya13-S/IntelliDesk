/*
  Migration 012: Fix vector dimensions — 768 → 3072

  ROOT CAUSE
  ----------
  The project was migrated from text-embedding-004 (768-dim) to
  gemini-embedding-001 (3072-dim). All vector(768) columns and every
  PostgreSQL function that accepts a query_embedding vector(768) parameter
  must be updated to vector(3072) so pgvector accepts the new embeddings.

  TABLES AFFECTED
  ---------------
  • document_chunks.embedding    vector(768) → vector(3072)
  • resolved_cases.embedding     vector(768) → vector(3072)
  • documents.embedding          vector(768) → vector(3072)

  FUNCTIONS AFFECTED
  ------------------
  • match_document_chunks(query_embedding vector(768), ...)
  • match_resolved_cases(query_embedding vector(768), ...)

  INDEXES
  -------
  Existing ivfflat indexes are dropped and recreated after the column
  type change (pgvector requires this).

  NOTE: Existing 768-dim embeddings become unusable after this change.
  Re-upload your documents to regenerate 3072-dim embeddings.
*/

-- ─── 1. Drop ivfflat indexes that depend on the embedding columns ────────────
DROP INDEX IF EXISTS idx_document_chunks_embedding;
DROP INDEX IF EXISTS idx_resolved_cases_embedding;

-- ─── 2. Drop existing match functions (parameter type is part of the signature)
DROP FUNCTION IF EXISTS match_document_chunks(vector(768), float, int);
DROP FUNCTION IF EXISTS match_resolved_cases(vector(768), float, int);

-- ─── 3. Alter embedding columns to vector(3072) ───────────────────────────────

-- document_chunks
ALTER TABLE document_chunks
  ALTER COLUMN embedding TYPE vector(3072) USING NULL;

-- resolved_cases
ALTER TABLE resolved_cases
  ALTER COLUMN embedding TYPE vector(3072) USING NULL;

-- documents (if it has an embedding column)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'documents' AND column_name = 'embedding'
  ) THEN
    ALTER TABLE documents
      ALTER COLUMN embedding TYPE vector(3072) USING NULL;
  END IF;
END $$;

-- ─── 4. Recreate match_document_chunks with vector(3072) ─────────────────────
CREATE OR REPLACE FUNCTION match_document_chunks(
  query_embedding vector(3072),
  match_threshold float,
  match_count int
)
RETURNS TABLE(
  id uuid,
  document_id uuid,
  chunk_text text,
  chunk_index int,
  similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    dc.id,
    dc.document_id,
    dc.chunk_text,
    dc.chunk_index,
    1 - (dc.embedding <=> query_embedding) AS similarity
  FROM document_chunks dc
  WHERE dc.embedding IS NOT NULL
    AND 1 - (dc.embedding <=> query_embedding) > match_threshold
  ORDER BY dc.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- ─── 5. Recreate match_resolved_cases with vector(3072) ──────────────────────
CREATE OR REPLACE FUNCTION match_resolved_cases(
  query_embedding vector(3072),
  match_threshold float,
  match_count int
)
RETURNS TABLE(
  id uuid,
  ticket_id uuid,
  email_subject text,
  email_body text,
  final_response text,
  intent text,
  department text,
  subteam text,
  action_taken text,
  similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    rc.id,
    rc.ticket_id,
    rc.email_subject,
    rc.email_body,
    rc.final_response,
    rc.intent,
    rc.department,
    rc.subteam,
    rc.action_taken,
    1 - (rc.embedding <=> query_embedding) AS similarity
  FROM resolved_cases rc
  WHERE rc.embedding IS NOT NULL
    AND 1 - (rc.embedding <=> query_embedding) > match_threshold
  ORDER BY rc.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- ─── 6. Clear stale 768-dim embeddings that pgvector would reject ─────────────
UPDATE document_chunks SET embedding = NULL WHERE embedding IS NOT NULL;
UPDATE resolved_cases   SET embedding = NULL WHERE embedding IS NOT NULL;

-- ─── 7. Recreate ivfflat indexes (will be populated on next upload) ───────────
-- Wrapped in DO block so they are skipped silently on empty tables
DO $$
BEGIN
  IF (SELECT COUNT(*) FROM document_chunks WHERE embedding IS NOT NULL) >= 100 THEN
    CREATE INDEX idx_document_chunks_embedding
      ON document_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 50);
  END IF;

  IF (SELECT COUNT(*) FROM resolved_cases WHERE embedding IS NOT NULL) >= 100 THEN
    CREATE INDEX idx_resolved_cases_embedding
      ON resolved_cases USING ivfflat (embedding vector_cosine_ops) WITH (lists = 50);
  END IF;
END $$;
