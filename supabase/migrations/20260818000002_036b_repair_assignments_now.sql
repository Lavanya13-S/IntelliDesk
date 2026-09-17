/*
  ┌─────────────────────────────────────────────────────────────────────────────┐
  │  IMMEDIATE FIX SCRIPT                                                       │
  │  Run this in: Supabase Dashboard → SQL Editor → Run                         │
  │                                                                             │
  │  What it does:                                                              │
  │  1. Finds ticket #C51268F8's dept_work_items row                            │
  │  2. Looks up the correct active Employee Relations person from org data     │
  │  3. Updates assigned_to + assigned_at (no new columns needed)               │
  │  4. Adds a work log entry                                                   │
  │                                                                             │
  │  Does NOT:                                                                  │
  │  • Create duplicate work items                                               │
  │  • Change classification/priority/department                                │
  │  • Require migration 036                                                    │
  └─────────────────────────────────────────────────────────────────────────────┘
*/

-- ── STEP 1: Diagnose — find the ticket and its work item ──────────────────────

SELECT
  t.id            AS ticket_id,
  t.status        AS ticket_status,
  t.department,
  t.subteam,
  t.priority,
  dwi.id          AS work_item_id,
  dwi.status      AS work_item_status,
  dwi.assigned_to,
  dwi.assigned_at,
  dwi.department  AS dwi_department,
  dwi.team_name   AS dwi_team
FROM tickets t
LEFT JOIN dept_work_items dwi ON dwi.ticket_id = t.id
JOIN emails e ON e.id = t.email_id
WHERE e.sender ILIKE '%aynaval%'
   OR t.id = 'c51268f8-0000-0000-0000-000000000000'::uuid
   OR t.id::text ILIKE 'c51268f8%'
ORDER BY t.created_at DESC
LIMIT 5;

-- ── STEP 2: Find the correct assignee from org data ───────────────────────────
-- This query mirrors exactly what resolveAssignee() does in dept-service.ts
-- For CRITICAL priority: prefer team manager

SELECT
  e.id            AS employee_id,
  e.employee_name,
  e.employee_email,
  e.designation,
  e.employment_status,
  t.team_name,
  t.manager_id,
  CASE WHEN e.id = t.manager_id THEN 'MANAGER' ELSE 'MEMBER' END AS role_in_team
FROM employees e
JOIN teams t ON t.id = e.team_id
JOIN departments d ON d.id = t.department_id
WHERE d.department_name ILIKE '%HR%'
  AND t.team_name ILIKE '%Employee Relations%'
  AND e.employment_status = 'active'
ORDER BY
  CASE WHEN e.id = t.manager_id THEN 0 ELSE 1 END,  -- manager first (CRITICAL priority)
  e.employee_name;

-- ── STEP 3: Repair the work item ─────────────────────────────────────────────
-- Picks the FIRST eligible active Employee Relations person (manager-preferred for CRITICAL)

DO $$
DECLARE
  v_work_item_id  uuid;
  v_employee_name text;
  v_employee_email text;
  v_employee_id   uuid;
  v_designation   text;
  v_team_manager  uuid;
BEGIN

  -- Find the work item for the harassment ticket
  SELECT dwi.id
  INTO v_work_item_id
  FROM dept_work_items dwi
  JOIN tickets t ON t.id = dwi.ticket_id
  JOIN emails e ON e.id = t.email_id
  WHERE (e.sender ILIKE '%aynaval%'
      OR t.department ILIKE '%HR%')
    AND dwi.assigned_to IS NULL
    AND dwi.status IN ('escalated', 'assigned')
  ORDER BY dwi.created_at DESC
  LIMIT 1;

  IF v_work_item_id IS NULL THEN
    RAISE NOTICE '[REPAIR] No unassigned HR work item found for aynaval. Checking all HR escalated items...';
    
    -- Broader search — any unassigned HR escalated item
    SELECT dwi.id
    INTO v_work_item_id
    FROM dept_work_items dwi
    WHERE dwi.department ILIKE '%HR%'
      AND dwi.assigned_to IS NULL
    ORDER BY dwi.created_at DESC
    LIMIT 1;
  END IF;

  IF v_work_item_id IS NULL THEN
    RAISE NOTICE '[REPAIR] No unassigned work items found. Ticket may already be assigned.';
    RETURN;
  END IF;

  RAISE NOTICE '[REPAIR] Found unassigned work item: %', v_work_item_id;

  -- Get the team manager of Employee Relations (preferred for CRITICAL)
  SELECT t.manager_id
  INTO v_team_manager
  FROM teams t
  JOIN departments d ON d.id = t.department_id
  WHERE d.department_name ILIKE '%HR%'
    AND t.team_name ILIKE '%Employee Relations%'
  LIMIT 1;

  -- Pick best assignee: manager first (CRITICAL priority), then any active member
  SELECT e.id, e.employee_name, e.employee_email, e.designation
  INTO v_employee_id, v_employee_name, v_employee_email, v_designation
  FROM employees e
  JOIN teams t ON t.id = e.team_id
  JOIN departments d ON d.id = t.department_id
  WHERE d.department_name ILIKE '%HR%'
    AND t.team_name ILIKE '%Employee Relations%'
    AND e.employment_status = 'active'
  ORDER BY
    CASE WHEN e.id = v_team_manager THEN 0 ELSE 1 END,  -- team manager first
    e.employee_name
  LIMIT 1;

  IF v_employee_name IS NULL THEN
    RAISE NOTICE '[REPAIR] No active Employee Relations employee found in org data.';
    RETURN;
  END IF;

  RAISE NOTICE '[REPAIR] Selected assignee: % (%) — %', v_employee_name, v_employee_email, v_designation;

  -- Update the work item
  UPDATE dept_work_items
  SET
    assigned_to = v_employee_name,
    assigned_at = now()
  WHERE id = v_work_item_id
    AND assigned_to IS NULL;

  -- Work log entry
  INSERT INTO dept_work_logs (work_item_id, actor, action, note)
  VALUES (
    v_work_item_id,
    'system',
    'assigned',
    FORMAT(
      'Automatically assigned to %s (%s) by system (SQL repair). Department: HR, Team: Employee Relations, Priority: Critical. Designation: %s.',
      v_employee_name,
      v_employee_email,
      v_designation
    )
  );

  RAISE NOTICE '[REPAIR] SUCCESS. Work item % assigned to %', v_work_item_id, v_employee_name;

END;
$$;

-- ── STEP 4: Verify ────────────────────────────────────────────────────────────

SELECT
  dwi.id          AS work_item_id,
  dwi.status,
  dwi.department,
  dwi.team_name,
  dwi.priority,
  dwi.assigned_to,
  dwi.assigned_at,
  dwi.employee_name  AS submitted_by
FROM dept_work_items dwi
WHERE dwi.department ILIKE '%HR%'
ORDER BY dwi.created_at DESC
LIMIT 10;

-- ── STEP 5: Repair ALL other unassigned work items ────────────────────────────
-- Runs the generic assignment algorithm for every department/team

DO $$
DECLARE
  rec           RECORD;
  v_assignee_id uuid;
  v_name        text;
  v_email       text;
  v_desig       text;
  v_manager     uuid;
  v_repaired    int := 0;
BEGIN

  FOR rec IN
    SELECT id, department, team_name, priority
    FROM dept_work_items
    WHERE assigned_to IS NULL
      AND status NOT IN ('completed')
  LOOP

    -- Find team manager
    SELECT t.manager_id INTO v_manager
    FROM teams t
    JOIN departments d ON d.id = t.department_id
    WHERE d.department_name ILIKE ('%' || COALESCE(rec.department, '') || '%')
      AND t.team_name ILIKE ('%' || COALESCE(rec.team_name, '') || '%')
    LIMIT 1;

    -- Pick assignee (manager-first for critical/high, member-first otherwise)
    SELECT e.id, e.employee_name, e.employee_email, e.designation
    INTO v_assignee_id, v_name, v_email, v_desig
    FROM employees e
    JOIN teams t ON t.id = e.team_id
    JOIN departments d ON d.id = t.department_id
    WHERE d.department_name ILIKE ('%' || COALESCE(rec.department, '') || '%')
      AND t.team_name ILIKE ('%' || COALESCE(rec.team_name, '') || '%')
      AND e.employment_status = 'active'
    ORDER BY
      CASE
        WHEN rec.priority IN ('critical', 'high') AND e.id = v_manager THEN 0
        WHEN rec.priority IN ('critical', 'high') THEN 1
        WHEN rec.priority NOT IN ('critical', 'high') AND e.id != v_manager THEN 0
        ELSE 1
      END,
      e.employee_name
    LIMIT 1;

    CONTINUE WHEN v_name IS NULL;

    UPDATE dept_work_items
    SET assigned_to = v_name, assigned_at = now()
    WHERE id = rec.id AND assigned_to IS NULL;

    INSERT INTO dept_work_logs (work_item_id, actor, action, note)
    VALUES (
      rec.id, 'system', 'assigned',
      FORMAT(
        'Automatically assigned to %s (%s) by system (SQL repair-all). Department: %s, Team: %s, Priority: %s.',
        v_name, v_email, rec.department, rec.team_name, rec.priority
      )
    );

    v_repaired := v_repaired + 1;
    RAISE NOTICE '[REPAIR-ALL] Work item % → %', rec.id, v_name;

  END LOOP;

  RAISE NOTICE '[REPAIR-ALL] Done. Repaired % work items.', v_repaired;
END;
$$;

-- ── STEP 6: Final status check ────────────────────────────────────────────────

SELECT
  status,
  COUNT(*) FILTER (WHERE assigned_to IS NULL) AS unassigned_count,
  COUNT(*) FILTER (WHERE assigned_to IS NOT NULL) AS assigned_count,
  COUNT(*) AS total
FROM dept_work_items
GROUP BY status
ORDER BY status;
