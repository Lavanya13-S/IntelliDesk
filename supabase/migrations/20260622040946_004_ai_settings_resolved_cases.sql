/*
# Phase 4 Fixes: ai_settings, resolved_cases, document_chunks, pgvector support
*/

-- AI Settings table
CREATE TABLE IF NOT EXISTS ai_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gemini_api_key text,
  auto_generate boolean NOT NULL DEFAULT false,
  auto_approve boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Resolved cases for self-learning
CREATE TABLE IF NOT EXISTS resolved_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid REFERENCES tickets(id) ON DELETE CASCADE,
  email_subject text,
  email_body text,
  final_response text,
  intent text,
  department text,
  subteam text,
  action_taken text,
  embedding vector(768),
  created_at timestamptz DEFAULT now()
);

-- Document chunks for RAG
CREATE TABLE IF NOT EXISTS document_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid REFERENCES documents(id) ON DELETE CASCADE,
  chunk_text text NOT NULL,
  chunk_index int NOT NULL,
  embedding vector(768),
  created_at timestamptz DEFAULT now()
);

-- Add embedding column to documents if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'documents' AND column_name = 'embedding'
  ) THEN
    ALTER TABLE documents ADD COLUMN embedding vector(768);
  END IF;
END $$;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_resolved_cases_ticket_id ON resolved_cases(ticket_id);
CREATE INDEX IF NOT EXISTS idx_document_chunks_document_id ON document_chunks(document_id);

-- Enable RLS
ALTER TABLE ai_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE resolved_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_chunks ENABLE ROW LEVEL SECURITY;

-- RLS Policies
DROP POLICY IF EXISTS "anon_select_ai_settings" ON ai_settings;
CREATE POLICY "anon_select_ai_settings" ON ai_settings FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_ai_settings" ON ai_settings;
CREATE POLICY "anon_insert_ai_settings" ON ai_settings FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_ai_settings" ON ai_settings;
CREATE POLICY "anon_update_ai_settings" ON ai_settings FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_ai_settings" ON ai_settings;
CREATE POLICY "anon_delete_ai_settings" ON ai_settings FOR DELETE TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_select_resolved_cases" ON resolved_cases;
CREATE POLICY "anon_select_resolved_cases" ON resolved_cases FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_resolved_cases" ON resolved_cases;
CREATE POLICY "anon_insert_resolved_cases" ON resolved_cases FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_resolved_cases" ON resolved_cases;
CREATE POLICY "anon_update_resolved_cases" ON resolved_cases FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_resolved_cases" ON resolved_cases;
CREATE POLICY "anon_delete_resolved_cases" ON resolved_cases FOR DELETE TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_select_document_chunks" ON document_chunks;
CREATE POLICY "anon_select_document_chunks" ON document_chunks FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_document_chunks" ON document_chunks;
CREATE POLICY "anon_insert_document_chunks" ON document_chunks FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_document_chunks" ON document_chunks;
CREATE POLICY "anon_update_document_chunks" ON document_chunks FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_document_chunks" ON document_chunks;
CREATE POLICY "anon_delete_document_chunks" ON document_chunks FOR DELETE TO anon, authenticated USING (true);

-- Create match_resolved_cases function for similarity search
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
  WHERE 1 - (rc.embedding <=> query_embedding) > match_threshold
  ORDER BY rc.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- Create match_document_chunks function for similarity search
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
  WHERE 1 - (dc.embedding <=> query_embedding) > match_threshold
  ORDER BY dc.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
