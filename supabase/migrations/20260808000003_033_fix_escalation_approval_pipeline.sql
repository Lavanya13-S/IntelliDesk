-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 033: Fix Escalation → Approval → Assignment Pipeline
--
-- Run in: Supabase Dashboard → SQL Editor
-- Ticket:  #B937FC72 (1d8414b8-1e39-4fae-bbc1-dae2109fb3e2)
-- Employee: Sarah Johnson / aynaval1213@gmail.com
-- Department: Finance / Payroll Team
-- ═══════════════════════════════════════════════════════════════════════════

-- ── STEP 0: Verify current state ────────────────────────────────────────────

SELECT 'DEPT_WORK_ITEMS' AS tbl,
  id, ticket_id, status, department, team_name,
  assigned_to, assigned_at, approval_id, created_at
FROM dept_work_items
WHERE ticket_id = '1d8414b8-1e39-4fae-bbc1-dae2109fb3e2';

SELECT 'TICKETS' AS tbl,
  id, status, approval_status, department, subteam, priority
FROM tickets
WHERE id = '1d8414b8-1e39-4fae-bbc1-dae2109fb3e2';

SELECT 'APPROVAL_REQUESTS' AS tbl,
  id, ticket_id, status, employee_name, manager_name, department, team_name, created_at
FROM approval_requests
WHERE ticket_id = '1d8414b8-1e39-4fae-bbc1-dae2109fb3e2';

-- ── STEP 1: Ensure log constraint includes dept_processing_complete ──────────

ALTER TABLE dept_work_logs DROP CONSTRAINT IF EXISTS valid_log_action;
ALTER TABLE dept_work_logs ADD CONSTRAINT valid_log_action CHECK (action IN (
  'created', 'assigned', 'accepted', 'started', 'paused', 'waiting',
  'resumed', 'submitted_for_review', 'verified', 'returned',
  'dept_processing_complete',
  'completed', 'escalated', 'commented', 'reassigned', 'sla_breached'
));

-- ── STEP 2: Confirm Payroll Team manager (Sneha Rao) ────────────────────────

SELECT
  t.id          AS team_id,
  t.team_name,
  t.team_code,
  e.id          AS manager_employee_id,
  e.employee_name AS manager_name,
  e.employee_email AS manager_email,
  e.designation
FROM teams t
JOIN employees e ON e.id = t.manager_id
WHERE t.id = 'b1000000-0000-0000-0000-000000000005';

-- ── STEP 3: Create approval_request for the current Payroll ticket ───────────
-- Only insert if one doesn't already exist for this ticket_id

DO $$
DECLARE
  v_ticket_id    uuid := '1d8414b8-1e39-4fae-bbc1-dae2109fb3e2';
  v_email_id     uuid;
  v_approval_id  uuid;
  v_wi_id        uuid;
BEGIN
  -- Skip if approval already exists
  SELECT id INTO v_approval_id
  FROM approval_requests
  WHERE ticket_id = v_ticket_id
  LIMIT 1;

  IF v_approval_id IS NOT NULL THEN
    RAISE NOTICE 'Approval already exists: %. Skipping creation.', v_approval_id;
  ELSE
    -- Get email_id from ticket
    SELECT email_id INTO v_email_id FROM tickets WHERE id = v_ticket_id;

    -- Create the approval_request
    INSERT INTO approval_requests (
      ticket_id, email_id,
      employee_name, employee_email,
      manager_id, manager_name, manager_email,
      department, team_name,
      intent, priority, risk_level,
      ai_reason, ai_confidence,
      status
    ) VALUES (
      v_ticket_id, v_email_id,
      'Sarah Johnson', 'aynaval1213@gmail.com',
      'e1000000-0000-0000-0000-000000000012', -- Sneha Rao
      'Sneha Rao',
      'sneha.rao@company.com',
      'Finance', 'Payroll Team',
      'Payroll Dispute', 'high', 'High',
      'Payroll discrepancy escalated to Finance — Payroll Team for investigation.',
      90,
      'pending'
    )
    RETURNING id INTO v_approval_id;

    RAISE NOTICE 'Created approval_request: %', v_approval_id;

    -- Link the approval to the existing dept_work_items row
    UPDATE dept_work_items
    SET approval_id = v_approval_id
    WHERE ticket_id = v_ticket_id
    RETURNING id INTO v_wi_id;

    RAISE NOTICE 'Linked approval % to work item %', v_approval_id, v_wi_id;

    -- Update ticket approval_status to pending
    UPDATE tickets
    SET approval_status = 'pending'
    WHERE id = v_ticket_id;

    RAISE NOTICE 'Ticket approval_status set to pending';
  END IF;
END;
$$;

-- ── STEP 4: Verify results ───────────────────────────────────────────────────

SELECT 'approval_requests' AS tbl,
  id, ticket_id, status, manager_name, manager_email, department, team_name, created_at
FROM approval_requests
WHERE ticket_id = '1d8414b8-1e39-4fae-bbc1-dae2109fb3e2';

SELECT 'dept_work_items' AS tbl,
  id, ticket_id, status, department, team_name,
  assigned_to, approval_id, created_at
FROM dept_work_items
WHERE ticket_id = '1d8414b8-1e39-4fae-bbc1-dae2109fb3e2';

SELECT 'tickets' AS tbl,
  id, status, approval_status, department, subteam, priority
FROM tickets
WHERE id = '1d8414b8-1e39-4fae-bbc1-dae2109fb3e2';

-- Expected after this script:
-- approval_requests: 1 row, status='pending', manager_name='Sneha Rao'
-- dept_work_items:   status='escalated', approval_id=<new uuid>
-- tickets:           approval_status='pending'
