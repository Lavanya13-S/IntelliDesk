/*
# Phase 4: Response Generator, Approval Flow, and Email Drafts
*/

CREATE TABLE IF NOT EXISTS drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid REFERENCES tickets(id) ON DELETE CASCADE,
  content text NOT NULL,
  version int NOT NULL DEFAULT 1,
  created_by text DEFAULT 'system',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  response_id uuid REFERENCES responses(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending',
  requested_by text DEFAULT 'system',
  approved_by text,
  notes text,
  requested_at timestamptz DEFAULT now(),
  resolved_at timestamptz
);

CREATE TABLE IF NOT EXISTS response_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  response_id uuid REFERENCES responses(id) ON DELETE CASCADE,
  content text NOT NULL,
  version_number int NOT NULL,
  change_summary text,
  created_at timestamptz DEFAULT now()
);

-- Enhance responses table
ALTER TABLE responses ADD COLUMN IF NOT EXISTS draft_mode boolean NOT NULL DEFAULT false;
ALTER TABLE responses ADD COLUMN IF NOT EXISTS generated_by text DEFAULT 'ai';
ALTER TABLE responses ADD COLUMN IF NOT EXISTS tone text DEFAULT 'professional';

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_drafts_ticket_id ON drafts(ticket_id);
CREATE INDEX IF NOT EXISTS idx_approvals_response_id ON approvals(response_id);
CREATE INDEX IF NOT EXISTS idx_approvals_status ON approvals(status);
CREATE INDEX IF NOT EXISTS idx_response_versions_response_id ON response_versions(response_id);

-- Enable RLS
ALTER TABLE drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE response_versions ENABLE ROW LEVEL SECURITY;

-- RLS Policies
DROP POLICY IF EXISTS "anon_select_drafts" ON drafts;
CREATE POLICY "anon_select_drafts" ON drafts FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_drafts" ON drafts;
CREATE POLICY "anon_insert_drafts" ON drafts FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_drafts" ON drafts;
CREATE POLICY "anon_update_drafts" ON drafts FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_drafts" ON drafts;
CREATE POLICY "anon_delete_drafts" ON drafts FOR DELETE TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_select_approvals" ON approvals;
CREATE POLICY "anon_select_approvals" ON approvals FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_approvals" ON approvals;
CREATE POLICY "anon_insert_approvals" ON approvals FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_approvals" ON approvals;
CREATE POLICY "anon_update_approvals" ON approvals FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_approvals" ON approvals;
CREATE POLICY "anon_delete_approvals" ON approvals FOR DELETE TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_select_response_versions" ON response_versions;
CREATE POLICY "anon_select_response_versions" ON response_versions FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_response_versions" ON response_versions;
CREATE POLICY "anon_insert_response_versions" ON response_versions FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_response_versions" ON response_versions;
CREATE POLICY "anon_update_response_versions" ON response_versions FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_response_versions" ON response_versions;
CREATE POLICY "anon_delete_response_versions" ON response_versions FOR DELETE TO anon, authenticated USING (true);
