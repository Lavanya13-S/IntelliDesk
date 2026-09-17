/*
  Migration 022: Fix dept_work_items / dept_work_logs Schema
  ============================================================

  ROOT CAUSE
  ----------
  Migration 021 (20260720000002_021_dept_workflow_expand.sql) was never
  applied to the live Supabase database. As a result, the following were
  absent from the live schema, causing the "Assign to Me" action to fail
  with: "Could not find the 'accepted_at' column of 'dept_work_items'
  in the schema cache."

  This migration re-applies all 021 changes idempotently and is safe to
  run even if 021 was partially applied. Every statement uses IF NOT EXISTS
  / DROP IF EXISTS guards.

  Changes applied
  ---------------
  1. Add  accepted_at timestamptz  to dept_work_items
  2. Expand valid_dwi_status CHECK  → adds 'accepted', 'quality_check'
  3. Expand valid_log_action CHECK  → adds 13 total action types
  4. Add partial unique index on ticket_id (null-safe duplicate protection)

  Run in: Supabase Dashboard → SQL Editor  (or supabase db push)
*/

-- ─── 1. Add accepted_at column ────────────────────────────────────────────────

ALTER TABLE dept_work_items
  ADD COLUMN IF NOT EXISTS accepted_at timestamptz;

COMMENT ON COLUMN dept_work_items.accepted_at
  IS 'Timestamp when the engineer accepted/claimed this ticket (Assign to Me).';

-- ─── 2. Expand status CHECK on dept_work_items ────────────────────────────────
-- PostgreSQL requires DROP + ADD to modify a named CHECK constraint.
-- The DROP is safe even if the old constraint never existed.

ALTER TABLE dept_work_items
  DROP CONSTRAINT IF EXISTS valid_dwi_status;

ALTER TABLE dept_work_items
  ADD CONSTRAINT valid_dwi_status CHECK (
    status IN (
      'assigned',
      'accepted',
      'in_progress',
      'waiting',
      'quality_check',
      'completed'
    )
  );

-- ─── 3. Expand action CHECK on dept_work_logs ─────────────────────────────────

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

-- ─── 4. Partial unique index — one queue row per ticket ───────────────────────
-- WHERE ticket_id IS NOT NULL lets multiple NULL rows coexist (no false conflicts).

CREATE UNIQUE INDEX IF NOT EXISTS idx_dwi_ticket_unique
  ON dept_work_items (ticket_id)
  WHERE ticket_id IS NOT NULL;

-- ─── 5. Verify ────────────────────────────────────────────────────────────────

-- Shows all columns on dept_work_items after migration (including accepted_at)
SELECT
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'dept_work_items'
ORDER BY ordinal_position;
