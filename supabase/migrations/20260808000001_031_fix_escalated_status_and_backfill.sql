/*
  Migration 031: Fix Escalated Status + Backfill Payroll Ticket (CONSOLIDATED)
  =============================================================================

  ROOT CAUSE
  ----------
  Migration 030 added 'escalated' to valid_dwi_status, but if it was not applied
  to the live database the INSERT in /api/dept/escalate fails with a CHECK
  constraint violation. The work item is never created, so Department Queue
  shows 0 escalated items.

  This migration is fully idempotent — safe to re-run regardless of which prior
  migrations were applied.

  WHAT IT DOES
  ------------
  1. Drops and re-creates valid_dwi_status to include ALL statuses including 'escalated'.
  2. Backfills any dept_work_items row with approval_id IS NULL and status='assigned'
     to status='escalated' (these were created by escalate route before this fix).
  3. Diagnoses: shows the Sarah Johnson payroll ticket and related work items.
  4. If the payroll ticket exists but has NO dept_work_items row, inserts one.

  Run in: Supabase Dashboard → SQL Editor
*/

-- ─── PHASE 1: Fix the status CHECK constraint ────────────────────────────────

ALTER TABLE dept_work_items
  DROP CONSTRAINT IF EXISTS valid_dwi_status;

ALTER TABLE dept_work_items
  ADD CONSTRAINT valid_dwi_status CHECK (
    status IN (
      'escalated',
      'assigned',
      'accepted',
      'in_progress',
      'waiting',
      'quality_check',
      'customer_resolution',
      'completed'
    )
  );

-- ─── PHASE 2: Backfill orphan 'assigned' rows to 'escalated' ─────────────────

UPDATE dept_work_items
  SET status = 'escalated'
  WHERE status = 'assigned'
    AND approval_id IS NULL;

-- ─── PHASE 3: Diagnose — show the Sarah Johnson payroll ticket ───────────────

SELECT
  t.id            AS ticket_id,
  t.status        AS ticket_status,
  t.department    AS ticket_department,
  t.subteam       AS ticket_subteam,
  t.priority      AS ticket_priority,
  t.created_at    AS ticket_created_at,
  e.sender        AS sender_email,
  e.subject       AS email_subject
FROM tickets t
LEFT JOIN emails e ON e.id = t.email_id
WHERE
  e.sender ILIKE '%aynaval%'
  OR e.subject ILIKE '%salary%'
  OR e.subject ILIKE '%payroll%'
  OR e.subject ILIKE '%credited incorrectly%'
ORDER BY t.created_at DESC
LIMIT 5;

-- ─── PHASE 4: Show all dept_work_items for those tickets ─────────────────────

SELECT
  dwi.id              AS work_item_id,
  dwi.ticket_id,
  dwi.status          AS work_item_status,
  dwi.department,
  dwi.team_name,
  dwi.priority,
  dwi.assigned_to,
  dwi.approval_id,
  dwi.created_at
FROM dept_work_items dwi
WHERE dwi.ticket_id IN (
  SELECT t.id
  FROM tickets t
  LEFT JOIN emails e ON e.id = t.email_id
  WHERE
    e.sender ILIKE '%aynaval%'
    OR e.subject ILIKE '%salary%'
    OR e.subject ILIKE '%payroll%'
    OR e.subject ILIKE '%credited incorrectly%'
)
ORDER BY dwi.created_at DESC;

-- ─── PHASE 5: Insert missing dept_work_items row if none exists ───────────────

DO $$
DECLARE
  v_ticket_id    uuid;
  v_email_id     uuid;
  v_sender       text;
  v_work_item_id uuid;
  v_sla_deadline timestamptz;
BEGIN
  SELECT t.id, t.email_id, e.sender
  INTO v_ticket_id, v_email_id, v_sender
  FROM tickets t
  LEFT JOIN emails e ON e.id = t.email_id
  WHERE
    e.sender ILIKE '%aynaval%'
    OR e.subject ILIKE '%salary%'
    OR e.subject ILIKE '%payroll%'
    OR e.subject ILIKE '%credited incorrectly%'
  ORDER BY t.created_at DESC
  LIMIT 1;

  IF v_ticket_id IS NULL THEN
    RAISE NOTICE '[031] No payroll ticket found — skipping work item insert.';
    RETURN;
  END IF;

  RAISE NOTICE '[031] Found payroll ticket: %', v_ticket_id;

  SELECT id INTO v_work_item_id
  FROM dept_work_items
  WHERE ticket_id = v_ticket_id
  LIMIT 1;

  IF v_work_item_id IS NOT NULL THEN
    RAISE NOTICE '[031] Work item already exists: % — ensuring status = escalated', v_work_item_id;
    UPDATE dept_work_items
      SET status = 'escalated'
      WHERE id = v_work_item_id;
    RAISE NOTICE '[031] Done. Existing work item updated.';
    RETURN;
  END IF;

  -- No work item exists — create it now
  v_sla_deadline := now() + interval '4 hours';

  INSERT INTO dept_work_items (
    approval_id,
    ticket_id,
    email_id,
    department,
    team_name,
    employee_name,
    employee_email,
    intent,
    priority,
    status,
    sla_deadline,
    sla_breached
  ) VALUES (
    NULL,
    v_ticket_id,
    v_email_id,
    'Finance',
    'Payroll Team',
    'Sarah Johnson',
    COALESCE(v_sender, 'aynaval1213@gmail.com'),
    'Payroll Dispute',
    'high',
    'escalated',
    v_sla_deadline,
    false
  )
  RETURNING id INTO v_work_item_id;

  RAISE NOTICE '[031] Created dept_work_items row: %', v_work_item_id;

  UPDATE tickets
    SET status = 'escalated', department = 'Finance', subteam = 'Payroll Team', priority = 'high'
    WHERE id = v_ticket_id;

  INSERT INTO dept_work_logs (work_item_id, actor, action, note)
  VALUES (
    v_work_item_id,
    'system',
    'escalated',
    'Migration 031: Backfilled escalation work item for payroll dispute. Finance — Payroll Team, High priority.'
  );

  RAISE NOTICE '[031] All done. Work item % created for ticket %', v_work_item_id, v_ticket_id;
END;
$$;

-- ─── PHASE 6: Final verification ─────────────────────────────────────────────

SELECT conname, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'dept_work_items'::regclass
  AND conname = 'valid_dwi_status';

SELECT
  id            AS work_item_id,
  ticket_id,
  status,
  department,
  team_name,
  employee_name,
  employee_email,
  priority,
  assigned_to,
  created_at
FROM dept_work_items
WHERE status = 'escalated'
ORDER BY created_at DESC;

SELECT status, count(*) AS count
FROM dept_work_items
GROUP BY status
ORDER BY status;
