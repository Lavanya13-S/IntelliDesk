/*
# Data Integrity + Storage Setup

1. Enforce one response per ticket and one latest approval row per response for deterministic writes.
2. Provision storage bucket for uploaded knowledge PDFs.
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'responses_ticket_id_key'
  ) THEN
    ALTER TABLE responses
      ADD CONSTRAINT responses_ticket_id_key UNIQUE (ticket_id);
  END IF;
END $$;

ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'approvals_response_id_key'
  ) THEN
    ALTER TABLE approvals
      ADD CONSTRAINT approvals_response_id_key UNIQUE (response_id);
  END IF;
END $$;

INSERT INTO storage.buckets (id, name, public)
VALUES ('knowledge-documents', 'knowledge-documents', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Public can read knowledge docs" ON storage.objects;
CREATE POLICY "Public can read knowledge docs"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'knowledge-documents');

DROP POLICY IF EXISTS "Anon can upload knowledge docs" ON storage.objects;
CREATE POLICY "Anon can upload knowledge docs"
  ON storage.objects FOR INSERT TO anon, authenticated
  WITH CHECK (bucket_id = 'knowledge-documents');

DROP POLICY IF EXISTS "Anon can update knowledge docs" ON storage.objects;
CREATE POLICY "Anon can update knowledge docs"
  ON storage.objects FOR UPDATE TO anon, authenticated
  USING (bucket_id = 'knowledge-documents')
  WITH CHECK (bucket_id = 'knowledge-documents');

DROP POLICY IF EXISTS "Anon can delete knowledge docs" ON storage.objects;
CREATE POLICY "Anon can delete knowledge docs"
  ON storage.objects FOR DELETE TO anon, authenticated
  USING (bucket_id = 'knowledge-documents');
