/*
# Migration 007: Fix match functions to skip NULL embeddings + add ivfflat indexes

The pgvector <=> operator returns NULL when the embedding column is NULL,
causing the WHERE clause to fail silently. We fix both match functions to
only compare rows where embedding IS NOT NULL.

We also add ivfflat approximate-nearest-neighbour indexes for performance
once enough rows exist (ivfflat requires >= 2 * lists rows to build).
The index creation is wrapped in a DO block so it does not fail on empty tables.
*/

-- Fix match_resolved_cases: only compare rows with embeddings
CREATE OR REPLACE FUNCTION match_resolved_cases(
  query_embedding vector(768),
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

-- Fix match_document_chunks: only compare rows with embeddings
CREATE OR REPLACE FUNCTION match_document_chunks(
  query_embedding vector(768),
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

-- ivfflat indexes (approximate nearest neighbour — much faster at scale)
-- Only created if the table has enough rows; otherwise silently skipped.
DO $$
BEGIN
  IF (SELECT COUNT(*) FROM document_chunks WHERE embedding IS NOT NULL) >= 100 THEN
    CREATE INDEX IF NOT EXISTS idx_document_chunks_embedding
      ON document_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 50);
  END IF;

  IF (SELECT COUNT(*) FROM resolved_cases WHERE embedding IS NOT NULL) >= 100 THEN
    CREATE INDEX IF NOT EXISTS idx_resolved_cases_embedding
      ON resolved_cases USING ivfflat (embedding vector_cosine_ops) WITH (lists = 50);
  END IF;
END $$;
