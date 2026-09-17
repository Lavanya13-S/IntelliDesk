/*
  Migration 030: Escalated Status Value for Department Work Items

  The previous migrations only had 'assigned' as the initial status for escalated
  tickets. This makes it impossible to distinguish them from normal department work
  items in the queue without relying on the escalated_from_ticket_id column.

  This migration adds 'escalated' as an explicit status value so that:
  - The Department Queue can filter escalated tickets reliably
  - All pages reading dept_work_items see the correct state immediately
  - No dependency on migration 029 columns for basic queue display

  Run in: Supabase Dashboard → SQL Editor
  This migration is idempotent — safe to re-run.
*/

-- ── 1. Expand status CHECK to include 'escalated' ────────────────────────────

ALTER TABLE dept_work_items
  DROP CONSTRAINT IF EXISTS valid_dwi_status;

ALTER TABLE dept_work_items
  ADD CONSTRAINT valid_dwi_status CHECK (
    status IN (
      'escalated',          -- NEW: just escalated, waiting to be assigned to an officer
      'assigned',           -- Assigned via approval workflow, not yet accepted
      'accepted',           -- Officer claimed the ticket
      'in_progress',        -- Officer actively working
      'waiting',            -- Waiting for employee/customer response
      'quality_check',      -- Internal QV review
      'customer_resolution',-- Resolution email stage
      'completed'           -- Fully resolved
    )
  );

-- ── 2. Update any existing escalated items that have status='assigned' and no approval_id
-- (These were created by the escalate route before this migration)
UPDATE dept_work_items
  SET status = 'escalated'
  WHERE status = 'assigned'
    AND approval_id IS NULL;

-- ── 3. Verify ─────────────────────────────────────────────────────────────────

SELECT conname, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'dept_work_items'::regclass
  AND conname = 'valid_dwi_status';

-- Show any escalated items
SELECT id, ticket_id, status, department, team_name, priority, created_at
FROM dept_work_items
WHERE status = 'escalated'
ORDER BY created_at DESC
LIMIT 10;
