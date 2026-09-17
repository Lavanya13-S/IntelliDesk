-- ============================================================================
-- Migration 040: Workflow Stage Backward Repair
--
-- Problem: Tickets that were accepted BEFORE the workflow_stage sync fix have:
--   approval_requests.status = 'approved'   (acceptance type)
--   dept_work_items.status = 'assigned'      (never advanced to in_progress
--                                            because the old code used a broken
--                                            .not('status','in',...) filter)
--   tickets.workflow_stage = NULL            (never written)
--
-- This migration:
--   1. Advances dept_work_items.status to 'in_progress' and sets accepted_at/started_at
--      for items where the acceptance approval is APPROVED but status is still 'assigned'.
--   2. Sets tickets.workflow_stage from dept_work_items.status.
--   3. Dismisses stale "Case Acceptance Required" notifications.
--
-- Safety guarantees:
--   1. Never moves a ticket BACKWARD  (WHERE clause excludes already-advanced records)
--   2. Never touches resolved/completed tickets
--   3. Idempotent — re-running produces identical results
--   4. All updates are atomic per ticket
-- ============================================================================

-- ── Step 0: Fix dept_work_items.status for accepted but still-assigned items ─
-- If an acceptance approval is APPROVED (officer accepted via approval portal)
-- but the work item is still 'assigned', set it to 'in_progress' and stamp
-- accepted_at + started_at with the approval's approved_at timestamp.
UPDATE dept_work_items wi
SET status      = 'in_progress',
    accepted_at = COALESCE(wi.accepted_at, ar.approved_at, NOW()),
    started_at  = COALESCE(wi.started_at,  ar.approved_at, NOW()),
    updated_at  = NOW()
FROM approval_requests ar
WHERE ar.ticket_id   = wi.ticket_id
  AND ar.approval_type = 'acceptance'
  AND ar.status        = 'approved'
  AND wi.status        = 'assigned'    -- Only advance, never go backward
  AND wi.accepted_at IS NULL;          -- Guard: already accepted items are skipped

-- ── Step 1: Repair tickets where dept work item is in_progress / waiting / quality_check
--   → workflow_stage = 'Dept Processing'
UPDATE tickets t
SET workflow_stage = 'Dept Processing',
    status         = CASE
                       WHEN t.status = 'assigned' THEN 'in_progress'
                       ELSE t.status
                     END
WHERE EXISTS (
  SELECT 1 FROM dept_work_items wi
  WHERE wi.ticket_id = t.id
    AND wi.status IN ('in_progress', 'waiting', 'quality_check', 'accepted')
    AND wi.accepted_at IS NOT NULL
)
AND (t.workflow_stage IS NULL OR t.workflow_stage IN ('Assigned', ''))
AND t.status NOT IN ('resolved', 'completed', 'customer_resolution');

-- ── Step 2: Repair tickets where dept work item is customer_resolution
--   → workflow_stage = 'Customer Resolution'
UPDATE tickets t
SET workflow_stage = 'Customer Resolution',
    status         = 'customer_resolution'
WHERE EXISTS (
  SELECT 1 FROM dept_work_items wi
  WHERE wi.ticket_id = t.id
    AND wi.status = 'customer_resolution'
)
AND (t.workflow_stage IS NULL OR t.workflow_stage NOT IN ('Resolved', 'Customer Resolution'))
AND t.status NOT IN ('resolved', 'completed');

-- ── Step 3: Repair tickets where dept work item is completed but ticket not resolved
--   → workflow_stage = 'Resolved'
UPDATE tickets t
SET workflow_stage = 'Resolved',
    status         = 'resolved'
WHERE EXISTS (
  SELECT 1 FROM dept_work_items wi
  WHERE wi.ticket_id = t.id
    AND wi.status = 'completed'
    AND wi.completed_at IS NOT NULL
)
AND t.workflow_stage IS NULL
AND t.status NOT IN ('resolved', 'completed');

-- ── Step 4: Dismiss stale "Case Acceptance Required" notifications
--   for tickets that are now past the acceptance stage.
UPDATE notifications n
SET read = true
WHERE n.type = 'approval_required'
  AND n.title ILIKE '%Acceptance Required%'
  AND n.read = false
  AND EXISTS (
    SELECT 1 FROM tickets t
    WHERE t.id = n.ticket_id
      AND t.workflow_stage IN ('Dept Processing', 'Customer Resolution', 'Resolved')
  );

-- ── Log summary ───────────────────────────────────────────────────────────────
DO $$
DECLARE
  dept_wi_fixed          integer;
  dept_processing_count  integer;
  customer_res_count     integer;
  resolved_count         integer;
  notification_count     integer;
BEGIN
  SELECT COUNT(*) INTO dept_wi_fixed
  FROM dept_work_items wi
  JOIN approval_requests ar ON ar.ticket_id = wi.ticket_id
  WHERE ar.approval_type = 'acceptance'
    AND ar.status = 'approved'
    AND wi.status = 'in_progress'
    AND wi.accepted_at IS NOT NULL;

  SELECT COUNT(*) INTO dept_processing_count
  FROM tickets WHERE workflow_stage = 'Dept Processing';

  SELECT COUNT(*) INTO customer_res_count
  FROM tickets WHERE workflow_stage = 'Customer Resolution';

  SELECT COUNT(*) INTO resolved_count
  FROM tickets WHERE workflow_stage = 'Resolved';

  SELECT COUNT(*) INTO notification_count
  FROM notifications WHERE type = 'approval_required' AND read = true AND title ILIKE '%Acceptance Required%';

  RAISE NOTICE 'Migration 040 complete:';
  RAISE NOTICE '  dept_work_items repaired to in_progress: %', dept_wi_fixed;
  RAISE NOTICE '  Tickets at Dept Processing:     %', dept_processing_count;
  RAISE NOTICE '  Tickets at Customer Resolution: %', customer_res_count;
  RAISE NOTICE '  Tickets Resolved:               %', resolved_count;
  RAISE NOTICE '  Stale notifications dismissed:  %', notification_count;
END;
$$;
