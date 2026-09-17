/*
  Migration 026: Ticket Resolution Fields — Module 4

  Adds resolution metadata to tickets + sent_emails for the
  Final Resolution Email + Gmail Thread Reply + Ticket Closure module.

  All statements are idempotent (ADD COLUMN IF NOT EXISTS).
  Safe to run multiple times.
*/

-- ─── 1. tickets: resolution fields ───────────────────────────────────────────

ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS resolved_by       text;

ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS workflow_stage    text;

ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS resolution_sent   boolean NOT NULL DEFAULT false;

ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS gmail_sent        boolean NOT NULL DEFAULT false;

ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS gmail_message_id  text;

ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS gmail_thread_id   text;

ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS resolution_version int NOT NULL DEFAULT 1;

-- resolved_at already exists in some environments; guard it
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'tickets'
      AND column_name  = 'resolved_at'
  ) THEN
    ALTER TABLE tickets ADD COLUMN resolved_at timestamptz;
  END IF;
END $$;

-- ─── 2. sent_emails: delivery metadata ───────────────────────────────────────

-- Ensure sent_emails has delivery tracking
ALTER TABLE sent_emails
  ADD COLUMN IF NOT EXISTS delivery_status   text     NOT NULL DEFAULT 'sent';

ALTER TABLE sent_emails
  ADD COLUMN IF NOT EXISTS email_sent_at     timestamptz;

ALTER TABLE sent_emails
  ADD COLUMN IF NOT EXISTS gmail_message_id  text;

ALTER TABLE sent_emails
  ADD COLUMN IF NOT EXISTS gmail_thread_id   text;

ALTER TABLE sent_emails
  ADD COLUMN IF NOT EXISTS resolved_by       text;

-- ─── 3. dept_work_logs: add 'complete' to valid actions (belt-and-suspenders) ─
-- The service layer uses 'completed'; this ensures 'complete' (alternate form) also works.
-- We expand the CHECK to include both so legacy callers don't break.

ALTER TABLE dept_work_logs
  DROP CONSTRAINT IF EXISTS valid_log_action;

ALTER TABLE dept_work_logs
  ADD CONSTRAINT valid_log_action CHECK (action IN (
    'created',
    'assigned',
    'accepted',
    'started',
    'paused',
    'waiting',
    'resumed',
    'submitted_for_review',
    'verified',
    'returned',
    'completed',
    'complete',
    'escalated',
    'commented',
    'reassigned',
    'sla_breached',
    'resolution_sent'
  ));

-- ─── 4. Indexes ───────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_tickets_workflow_stage  ON tickets (workflow_stage);
CREATE INDEX IF NOT EXISTS idx_tickets_resolved_by     ON tickets (resolved_by);
CREATE INDEX IF NOT EXISTS idx_tickets_resolved_at     ON tickets (resolved_at DESC);

-- ─── 5. Verify ────────────────────────────────────────────────────────────────

SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'tickets'
  AND column_name IN (
    'resolved_by','workflow_stage','resolution_sent',
    'gmail_sent','gmail_message_id','gmail_thread_id',
    'resolution_version','resolved_at'
  )
ORDER BY column_name;
