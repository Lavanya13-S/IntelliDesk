/*
  ┌──────────────────────────────────────────────────────────────────────────────┐
  │  MIGRATION 039 — Acceptance Approval Type + Ticket #C51268F8 State Repair   │
  │                                                                              │
  │  Run in: Supabase Dashboard → SQL Editor → Run                               │
  │                                                                              │
  │  What it does:                                                               │
  │  1. Adds approval_type column to approval_requests                           │
  │     ('manager_approval' | 'acceptance'). Default = 'manager_approval'        │
  │     so all existing records are unaffected.                                  │
  │  2. Resets dept_work_items for #C51268F8 back to 'assigned' status           │
  │     (undoes migration 038 which auto-advanced it — Priya must explicitly     │
  │     accept before Stage 2 can complete).                                     │
  │  3. Creates exactly ONE pending acceptance approval_requests row for         │
  │     Priya Nair on ticket #C51268F8 (idempotent).                             │
  │  4. Verifies final state.                                                    │
  │                                                                              │
  │  Safe to run multiple times — all operations use IF/DO guards.               │
  └──────────────────────────────────────────────────────────────────────────────┘
*/

-- ═══════════════════════════════════════════════════════════════════════════════
-- STEP 1: Add approval_type column
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE approval_requests
  ADD COLUMN IF NOT EXISTS approval_type text NOT NULL DEFAULT 'manager_approval'
    CHECK (approval_type IN ('manager_approval', 'acceptance'));

CREATE INDEX IF NOT EXISTS idx_approval_requests_type
  ON approval_requests (approval_type);

-- Mark all existing records as manager_approval (they all are)
UPDATE approval_requests
  SET approval_type = 'manager_approval'
  WHERE approval_type IS NULL OR approval_type = '';

-- ═══════════════════════════════════════════════════════════════════════════════
-- STEP 2: Diagnose current state of ticket #C51268F8
-- ═══════════════════════════════════════════════════════════════════════════════

SELECT
  t.id             AS ticket_id,
  t.status         AS ticket_status,
  t.approval_status,
  dwi.id           AS work_item_id,
  dwi.status       AS work_item_status,
  dwi.assigned_to,
  dwi.accepted_at,
  dwi.started_at,
  dwi.intent,
  (SELECT COUNT(*) FROM approval_requests ar WHERE ar.ticket_id = t.id) AS total_approvals,
  (SELECT COUNT(*) FROM approval_requests ar WHERE ar.ticket_id = t.id AND ar.status = 'pending') AS pending_approvals,
  (SELECT COUNT(*) FROM approval_requests ar WHERE ar.ticket_id = t.id AND ar.approval_type = 'acceptance') AS acceptance_approvals
FROM tickets t
LEFT JOIN dept_work_items dwi ON dwi.ticket_id = t.id
LEFT JOIN emails e ON e.id = t.email_id
WHERE e.sender ILIKE '%aynaval%'
   OR t.id::text ILIKE 'c51268f8%'
ORDER BY dwi.created_at DESC NULLS LAST
LIMIT 5;

-- ═══════════════════════════════════════════════════════════════════════════════
-- STEP 3: Reset dept_work_items for #C51268F8 back to 'assigned'
--         (undo migration 038 auto-advance — Priya must explicitly accept)
-- ═══════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_work_item_id   uuid;
  v_current_status text;
BEGIN
  -- Find the work item
  SELECT dwi.id, dwi.status
  INTO v_work_item_id, v_current_status
  FROM dept_work_items dwi
  JOIN tickets t ON t.id = dwi.ticket_id
  LEFT JOIN emails e ON e.id = t.email_id
  WHERE e.sender ILIKE '%aynaval%'
     OR t.id::text ILIKE 'c51268f8%'
  ORDER BY dwi.created_at DESC NULLS LAST
  LIMIT 1;

  IF v_work_item_id IS NULL THEN
    RAISE NOTICE '[039] No work item found for #C51268F8 — skipping reset.';
    RETURN;
  END IF;

  RAISE NOTICE '[039] Work item % current status: %', v_work_item_id, v_current_status;

  -- Only reset if currently in in_progress and was auto-advanced without real acceptance
  -- (accepted by migration 038, not by actual person action)
  -- We check: if there's no accepted/acceptance log from a real person (only 'system' logs)
  IF v_current_status IN ('in_progress', 'accepted') THEN
    -- Check if any real (non-system) acceptance log exists
    IF NOT EXISTS (
      SELECT 1 FROM dept_work_logs
      WHERE work_item_id = v_work_item_id
        AND action = 'accepted'
        AND actor != 'system'
    ) THEN
      -- Reset to assigned — real acceptance is required
      UPDATE dept_work_items
      SET
        status      = 'assigned',
        accepted_at = NULL,
        started_at  = NULL
      WHERE id = v_work_item_id;

      -- Remove the fake 'accepted' log inserted by migration 038
      DELETE FROM dept_work_logs
      WHERE work_item_id = v_work_item_id
        AND action = 'accepted'
        AND actor = 'system'
        AND note ILIKE '%repaired by migration 038%';

      RAISE NOTICE '[039] Reset work item % from % → assigned. Acceptance required.', v_work_item_id, v_current_status;
    ELSE
      RAISE NOTICE '[039] Real acceptance exists for %. No reset needed.', v_work_item_id;
    END IF;
  ELSE
    RAISE NOTICE '[039] Work item % status=%. No reset needed.', v_work_item_id, v_current_status;
  END IF;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- STEP 4: Create pending acceptance approval for Priya Nair (idempotent)
-- ═══════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_ticket_id       uuid;
  v_email_id        uuid;
  v_work_item_id    uuid;
  v_assigned_to     text;
  v_employee_name   text;
  v_employee_email  text;
  v_intent          text;
  v_priority        text;
  v_department      text;
  v_team_name       text;
  v_assignee_email  text;
  v_approval_id     uuid;
BEGIN
  -- Fetch all needed data in one shot
  SELECT
    t.id, t.email_id,
    dwi.id, dwi.assigned_to,
    dwi.employee_name, dwi.employee_email,
    dwi.intent, dwi.priority,
    dwi.department, dwi.team_name
  INTO
    v_ticket_id, v_email_id,
    v_work_item_id, v_assigned_to,
    v_employee_name, v_employee_email,
    v_intent, v_priority,
    v_department, v_team_name
  FROM tickets t
  JOIN dept_work_items dwi ON dwi.ticket_id = t.id
  LEFT JOIN emails e ON e.id = t.email_id
  WHERE e.sender ILIKE '%aynaval%'
     OR t.id::text ILIKE 'c51268f8%'
  ORDER BY dwi.created_at DESC NULLS LAST
  LIMIT 1;

  IF v_ticket_id IS NULL THEN
    RAISE NOTICE '[039] No ticket found for #C51268F8 — skipping acceptance approval creation.';
    RETURN;
  END IF;

  IF v_assigned_to IS NULL THEN
    RAISE NOTICE '[039] Work item % has no assignee — cannot create acceptance approval.', v_work_item_id;
    RETURN;
  END IF;

  -- Idempotency: check if pending acceptance already exists
  IF EXISTS (
    SELECT 1 FROM approval_requests
    WHERE ticket_id = v_ticket_id
      AND approval_type = 'acceptance'
      AND status = 'pending'
  ) THEN
    RAISE NOTICE '[039] Pending acceptance approval already exists for ticket %. Skipping.', v_ticket_id;
    RETURN;
  END IF;

  -- Look up assignee email from employees table
  SELECT e.employee_email INTO v_assignee_email
  FROM employees e
  WHERE e.employee_name ILIKE v_assigned_to
  LIMIT 1;

  -- Insert the acceptance approval record
  INSERT INTO approval_requests (
    ticket_id,
    email_id,
    approval_type,
    employee_name,
    employee_email,
    manager_name,
    manager_email,
    department,
    team_name,
    intent,
    priority,
    status,
    approval_level,
    token_expires_at
  ) VALUES (
    v_ticket_id,
    v_email_id,
    'acceptance',
    v_employee_name,
    v_employee_email,
    v_assigned_to,                   -- Priya Nair as the "approver/acceptor"
    v_assignee_email,
    v_department,
    v_team_name,
    v_intent,
    v_priority,
    'pending',
    1,
    NOW() + INTERVAL '7 days'        -- acceptance window: 7 days
  )
  RETURNING id INTO v_approval_id;

  RAISE NOTICE '[039] Created acceptance approval % for ticket % (assignee: %)', v_approval_id, v_ticket_id, v_assigned_to;

  -- Audit log
  INSERT INTO approval_audit_log (approval_id, event, actor)
  VALUES (v_approval_id, 'created', 'system');

  -- In-app notification
  INSERT INTO notifications (type, title, message, ticket_id, email_id, read)
  VALUES (
    'approval_required',
    'Case Acceptance Required',
    v_assigned_to || ' — please accept the case: ' || COALESCE(v_intent, 'Workplace Harassment Complaint'),
    v_ticket_id,
    v_email_id,
    false
  );

  RAISE NOTICE '[039] Done. Approval Portal should now show Pending=1.';
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- STEP 5: Verify final state
-- ═══════════════════════════════════════════════════════════════════════════════

SELECT
  ar.id              AS approval_id,
  ar.approval_type,
  ar.status          AS approval_status,
  ar.manager_name    AS assigned_officer,
  ar.manager_email   AS officer_email,
  ar.employee_name,
  ar.employee_email,
  ar.intent,
  ar.priority,
  ar.created_at,
  ar.token_expires_at
FROM approval_requests ar
JOIN tickets t ON t.id = ar.ticket_id
LEFT JOIN emails e ON e.id = t.email_id
WHERE e.sender ILIKE '%aynaval%'
   OR t.id::text ILIKE 'c51268f8%'
ORDER BY ar.created_at;

-- Work item final state
SELECT
  dwi.id, dwi.status, dwi.assigned_to,
  dwi.accepted_at, dwi.started_at
FROM dept_work_items dwi
JOIN tickets t ON t.id = dwi.ticket_id
LEFT JOIN emails e ON e.id = t.email_id
WHERE e.sender ILIKE '%aynaval%'
   OR t.id::text ILIKE 'c51268f8%';

-- Overall pending count (should be 1)
SELECT
  approval_type,
  status,
  COUNT(*) AS count
FROM approval_requests
GROUP BY approval_type, status
ORDER BY approval_type, status;
