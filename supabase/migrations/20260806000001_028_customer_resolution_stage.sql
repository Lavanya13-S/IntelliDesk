/*
  Migration 028: Customer Resolution Stage

  Splits "Department Processing" and "Customer Resolution" into two distinct workflow stages.

  New status: customer_resolution
    - Entered when engineer clicks "Complete Department Processing" (in_progress → customer_resolution)
    - Exited when Gmail confirms delivery (customer_resolution → completed)
    - Ticket is NEVER marked completed before this stage

  New log action: dept_processing_complete
    - Written when the engineer finishes internal provisioning work

  Run in: Supabase Dashboard → SQL Editor
*/

-- ─── 1. Expand status CHECK on dept_work_items ───────────────────────────────

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
      'customer_resolution',
      'completed'
    )
  );

-- ─── 2. Expand action CHECK on dept_work_logs ────────────────────────────────

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
    'dept_processing_complete',
    'verified',
    'returned',
    'completed',
    'escalated',
    'commented',
    'reassigned',
    'sla_breached'
  ));

-- ─── 3. Verify ───────────────────────────────────────────────────────────────

SELECT
  conname,
  pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'dept_work_items'::regclass
  AND conname = 'valid_dwi_status';
