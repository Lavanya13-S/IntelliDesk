/*
  Migration 021: Enterprise Workflow Stage Expansion

  Updates dept_work_items:
    - Adds accepted, quality_check to status CHECK
    - Adds accepted_at column
    - Adds ticket_id UNIQUE constraint (duplicate protection)

  Updates dept_work_logs:
    - Expands action CHECK to include new log types

  Run in: Supabase Dashboard → SQL Editor
*/

-- ─── 1. Expand status CHECK on dept_work_items ───────────────────────────────
-- PostgreSQL requires DROP + ADD to modify a CHECK constraint

ALTER TABLE dept_work_items
  DROP CONSTRAINT IF EXISTS valid_dwi_status;

ALTER TABLE dept_work_items
  ADD CONSTRAINT valid_dwi_status CHECK (
    status IN ('assigned','accepted','in_progress','waiting','quality_check','completed')
  );

-- ─── 2. Add accepted_at column ───────────────────────────────────────────────

ALTER TABLE dept_work_items
  ADD COLUMN IF NOT EXISTS accepted_at timestamptz;

COMMENT ON COLUMN dept_work_items.accepted_at IS 'Timestamp when the engineer accepted/claimed this ticket.';

-- ─── 3. Duplicate protection: unique on ticket_id (one queue row per ticket) ──
-- Only add if the column exists and has no duplicates already.
-- Use a partial unique index (allows NULLs to be non-unique).

CREATE UNIQUE INDEX IF NOT EXISTS idx_dwi_ticket_unique
  ON dept_work_items (ticket_id)
  WHERE ticket_id IS NOT NULL;

-- ─── 4. Expand action CHECK on dept_work_logs ────────────────────────────────

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
    'escalated',
    'commented',
    'reassigned',
    'sla_breached'
  ));

-- ─── 5. Verify ───────────────────────────────────────────────────────────────

SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'dept_work_items'
ORDER BY ordinal_position;
