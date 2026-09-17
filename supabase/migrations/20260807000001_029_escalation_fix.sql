/*
  Migration 029: Escalation Architecture Fix (CONSOLIDATED)
  
  Run this in: Supabase Dashboard → SQL Editor
  
  This migration is fully idempotent — safe to re-run if partially applied.
  
  What it does:
  
  1. Adds escalated_from_ticket_id to dept_work_items
     → Identifies which dept_work_items came from escalation (vs approval)
  
  2. Adds investigation_complete to dept_work_items
     → Gates the resolution email — cannot send until true
  
  3. Adds dept_work_item_id to notifications
     → Clicking the notification bell navigates directly to the work item
  
  4. Creates dept_investigations table
     → Stores payroll investigation checklist, notes, evidence per work item
*/

-- ── Step 1: Add escalation columns to dept_work_items ─────────────────────────

ALTER TABLE dept_work_items
  ADD COLUMN IF NOT EXISTS escalated_from_ticket_id uuid
    REFERENCES tickets(id) ON DELETE SET NULL;

ALTER TABLE dept_work_items
  ADD COLUMN IF NOT EXISTS investigation_complete boolean NOT NULL DEFAULT false;

ALTER TABLE dept_work_items
  ADD COLUMN IF NOT EXISTS investigation_completed_at timestamptz;

ALTER TABLE dept_work_items
  ADD COLUMN IF NOT EXISTS investigation_completed_by text;

CREATE INDEX IF NOT EXISTS idx_dwi_escalated_from
  ON dept_work_items(escalated_from_ticket_id);

-- ── Step 2: Add dept_work_item_id to notifications ────────────────────────────

ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS dept_work_item_id uuid
    REFERENCES dept_work_items(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_notifications_dept_work_item_id
  ON notifications(dept_work_item_id);

-- ── Step 3: Create dept_investigations table ──────────────────────────────────

CREATE TABLE IF NOT EXISTS dept_investigations (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  work_item_id         uuid        NOT NULL REFERENCES dept_work_items(id) ON DELETE CASCADE,
  checklist            jsonb       NOT NULL DEFAULT '[]'::jsonb,
  investigation_notes  text,
  corrective_action    text,
  internal_comments    text,
  evidence_urls        text[]      DEFAULT '{}',
  status               text        NOT NULL DEFAULT 'in_progress'
                                   CHECK (status IN ('in_progress', 'complete')),
  completed_at         timestamptz,
  completed_by         text,
  created_at           timestamptz DEFAULT now(),
  updated_at           timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dept_investigations_work_item_id
  ON dept_investigations(work_item_id);

ALTER TABLE dept_investigations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_all_dept_investigations" ON dept_investigations;
CREATE POLICY "anon_all_dept_investigations" ON dept_investigations
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- ── Step 4: Verify the columns exist ─────────────────────────────────────────

SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'dept_work_items'
  AND column_name IN ('escalated_from_ticket_id', 'investigation_complete', 'investigation_completed_at')
ORDER BY column_name;

SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'notifications'
  AND column_name = 'dept_work_item_id';

SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name = 'dept_investigations';
