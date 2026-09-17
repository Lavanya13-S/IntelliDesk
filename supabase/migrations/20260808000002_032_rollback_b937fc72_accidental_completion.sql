-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK: Ticket #B937FC72 (Sarah Johnson — Payroll Dispute)
-- Work item ID prefix: b937fc72-...
-- Ticket ID: 1d8414b8-1e39-4fae-bbc1-dae2109fb3e2
--
-- Reverts the accidental "Complete Department Processing" action:
--   dept_work_items.status      : customer_resolution → escalated
--   dept_work_items.started_at  : clear (was set by the accidental action)
--   dept_work_items.assigned_to : clear (was set by the accidental action)
--   tickets.status              : revert to 'escalated'
--   dept_work_logs              : remove the accidental 'dept_processing_complete' log
--
-- Does NOT touch: emails, AI classification, original escalation log,
--                 the old SAP ticket (#6F309DCB), any other ticket.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── STEP 0: Inspect current state before rollback ────────────────────────────

SELECT
  id,
  ticket_id,
  status,
  department,
  team_name,
  priority,
  assigned_to,
  started_at,
  accepted_at,
  completed_at,
  created_at
FROM dept_work_items
WHERE id::text ILIKE 'b937fc72%'
   OR ticket_id = '1d8414b8-1e39-4fae-bbc1-dae2109fb3e2';

SELECT id, status, department, subteam, priority FROM tickets
WHERE id = '1d8414b8-1e39-4fae-bbc1-dae2109fb3e2';

SELECT id, work_item_id, action, actor, note, created_at
FROM dept_work_logs
WHERE work_item_id IN (
  SELECT id FROM dept_work_items
  WHERE id::text ILIKE 'b937fc72%'
     OR ticket_id = '1d8414b8-1e39-4fae-bbc1-dae2109fb3e2'
)
ORDER BY created_at DESC;

-- ── STEP 1: Rollback dept_work_items ─────────────────────────────────────────
-- Revert to escalated, clear all timestamps set by the accidental completion.

UPDATE dept_work_items
SET
  status      = 'escalated',
  assigned_to = NULL,
  started_at  = NULL,
  accepted_at = NULL,
  completed_at = NULL
WHERE
  ticket_id = '1d8414b8-1e39-4fae-bbc1-dae2109fb3e2'
  AND status IN ('customer_resolution', 'in_progress', 'assigned', 'accepted', 'completed');

-- ── STEP 2: Rollback ticket status ───────────────────────────────────────────

UPDATE tickets
SET status = 'escalated'
WHERE id = '1d8414b8-1e39-4fae-bbc1-dae2109fb3e2'
  AND status IN ('customer_resolution', 'in_progress', 'completed');

-- ── STEP 3: Remove only the accidental dept_processing_complete log entry ─────
-- We keep the original 'escalated' log entry intact.

DELETE FROM dept_work_logs
WHERE
  work_item_id IN (
    SELECT id FROM dept_work_items
    WHERE ticket_id = '1d8414b8-1e39-4fae-bbc1-dae2109fb3e2'
  )
  AND action = 'dept_processing_complete';

-- Also remove any 'started' log that was created alongside it
-- (only if created within the last hour — to avoid removing legitimate starts)
DELETE FROM dept_work_logs
WHERE
  work_item_id IN (
    SELECT id FROM dept_work_items
    WHERE ticket_id = '1d8414b8-1e39-4fae-bbc1-dae2109fb3e2'
  )
  AND action = 'started'
  AND created_at > now() - interval '2 hours';

-- ── STEP 4: Verify rollback result ───────────────────────────────────────────

SELECT
  id,
  ticket_id,
  status,
  department,
  team_name,
  priority,
  assigned_to,
  started_at,
  accepted_at,
  completed_at,
  created_at
FROM dept_work_items
WHERE ticket_id = '1d8414b8-1e39-4fae-bbc1-dae2109fb3e2';

SELECT id, status, department, subteam, priority FROM tickets
WHERE id = '1d8414b8-1e39-4fae-bbc1-dae2109fb3e2';

SELECT id, action, actor, note, created_at
FROM dept_work_logs
WHERE work_item_id IN (
  SELECT id FROM dept_work_items
  WHERE ticket_id = '1d8414b8-1e39-4fae-bbc1-dae2109fb3e2'
)
ORDER BY created_at ASC;

-- ── STEP 5: Confirm the old SAP ticket is untouched ──────────────────────────
-- #6F309DCB = work item starting with 6f309dcb

SELECT id, ticket_id, status, department, team_name, completed_at
FROM dept_work_items
WHERE id::text ILIKE '6f309dcb%'
   OR department ILIKE '%SAP%'
   OR team_name ILIKE '%Finance Transformation%';
