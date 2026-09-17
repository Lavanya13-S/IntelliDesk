/*
  Migration 009: Extended ai_settings + resolved_cases attachment_summary
*/

-- Add attachment_summary to resolved_cases for Module 8 self-learning
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'resolved_cases' AND column_name = 'attachment_summary'
  ) THEN
    ALTER TABLE resolved_cases ADD COLUMN attachment_summary text;
  END IF;
END $$;

-- Extend ai_settings to store all module configuration (Module 9)
DO $$
BEGIN
  -- Notification preferences
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ai_settings' AND column_name = 'notify_new_email') THEN
    ALTER TABLE ai_settings ADD COLUMN notify_new_email boolean NOT NULL DEFAULT true;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ai_settings' AND column_name = 'notify_critical') THEN
    ALTER TABLE ai_settings ADD COLUMN notify_critical boolean NOT NULL DEFAULT true;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ai_settings' AND column_name = 'notify_approval') THEN
    ALTER TABLE ai_settings ADD COLUMN notify_approval boolean NOT NULL DEFAULT true;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ai_settings' AND column_name = 'notify_sent') THEN
    ALTER TABLE ai_settings ADD COLUMN notify_sent boolean NOT NULL DEFAULT true;
  END IF;
  -- Voice settings
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ai_settings' AND column_name = 'voice_enabled') THEN
    ALTER TABLE ai_settings ADD COLUMN voice_enabled boolean NOT NULL DEFAULT true;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ai_settings' AND column_name = 'voice_language') THEN
    ALTER TABLE ai_settings ADD COLUMN voice_language text NOT NULL DEFAULT 'en-US';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ai_settings' AND column_name = 'voice_rate') THEN
    ALTER TABLE ai_settings ADD COLUMN voice_rate float NOT NULL DEFAULT 1.0;
  END IF;
  -- Attachment settings
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ai_settings' AND column_name = 'attachment_ocr_enabled') THEN
    ALTER TABLE ai_settings ADD COLUMN attachment_ocr_enabled boolean NOT NULL DEFAULT true;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ai_settings' AND column_name = 'attachment_max_size_mb') THEN
    ALTER TABLE ai_settings ADD COLUMN attachment_max_size_mb int NOT NULL DEFAULT 10;
  END IF;
  -- RAG settings
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ai_settings' AND column_name = 'rag_threshold') THEN
    ALTER TABLE ai_settings ADD COLUMN rag_threshold float NOT NULL DEFAULT 0.25;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ai_settings' AND column_name = 'rag_max_results') THEN
    ALTER TABLE ai_settings ADD COLUMN rag_max_results int NOT NULL DEFAULT 5;
  END IF;
  -- LangGraph settings
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ai_settings' AND column_name = 'langgraph_enabled') THEN
    ALTER TABLE ai_settings ADD COLUMN langgraph_enabled boolean NOT NULL DEFAULT true;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ai_settings' AND column_name = 'langgraph_max_retries') THEN
    ALTER TABLE ai_settings ADD COLUMN langgraph_max_retries int NOT NULL DEFAULT 3;
  END IF;
END $$;

-- Update match_resolved_cases to include attachment_summary
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
  attachment_summary text,
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
    rc.attachment_summary,
    1 - (rc.embedding <=> query_embedding) AS similarity
  FROM resolved_cases rc
  WHERE rc.embedding IS NOT NULL
    AND 1 - (rc.embedding <=> query_embedding) > match_threshold
  ORDER BY rc.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
