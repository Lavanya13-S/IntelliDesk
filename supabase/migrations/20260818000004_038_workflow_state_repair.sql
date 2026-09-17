/*
  ┌─────────────────────────────────────────────────────────────────────────────┐
  │  MIGRATION 038 — Workflow state repair for ticket #C51268F8                 │
  │                  + acceptance_requests column (optional, if table supports)  │
  │                                                                             │
  │  Run in: Supabase Dashboard → SQL Editor → Run                              │
  │                                                                             │
  │  What it does:                                                              │
  │  1. If the work item for #C51268F8 is still in 'assigned' status,          │
  │     advance it to 'in_progress' (Priya Nair has already been assigned;     │
  │     this mirrors the merged accept+start action).                           │
  │  2. Sets accepted_at = NOW() and started_at = NOW() if not already set.    │
  │  3. Ensures no duplicate 'accepted' or 'started' work log entries.         │
  │  4. Verifies final state.                                                   │
  │                                                                             │
  │  Safe to run multiple times — all operations use IF/CASE guards.           │
  └─────────────────────────────────────────────────────────────────────────────┘
*/

-- ═══════════════════════════════════════════════════════════════════════════════
-- STEP 1: Diagnose current state
-- ═══════════════════════════════════════════════════════════════════════════════

SELECT
  dwi.id           AS work_item_id,
  dwi.status       AS current_status,
  dwi.assigned_to,
  dwi.accepted_at,
  dwi.started_at,
  dwi.intent,
  dwi.department,
  dwi.team_name,
  dwi.priority,
  dwi.sla_deadline,
  dwi.sla_breached
FROM dept_work_items dwi
JOIN tickets t ON t.id = dwi.ticket_id
JOIN emails e ON e.id = t.email_id
WHERE e.sender ILIKE '%aynaval%'
   OR t.id::text ILIKE 'c51268f8%'
ORDER BY dwi.created_at DESC
LIMIT 5;

-- ═══════════════════════════════════════════════════════════════════════════════
-- STEP 2: If still in 'assigned' status → advance to 'in_progress'
--         (reflects the merged accept+start action applied going forward)
-- ═══════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_dwi_id    uuid;
  v_status    text;
  v_updated   int;
BEGIN
  -- Find the work item
  SELECT dwi.id, dwi.status
  INTO v_dwi_id, v_status
  FROM dept_work_items dwi
  JOIN tickets t ON t.id = dwi.ticket_id
  JOIN emails e ON e.id = t.email_id
  WHERE e.sender ILIKE '%aynaval%'
  ORDER BY dwi.created_at DESC
  LIMIT 1;

  IF v_dwi_id IS NULL THEN
    -- Try by ticket ID prefix
    SELECT dwi.id, dwi.status
    INTO v_dwi_id, v_status
    FROM dept_work_items dwi
    JOIN tickets t ON t.id = dwi.ticket_id
    WHERE t.id::text ILIKE 'c51268f8%'
    ORDER BY dwi.created_at DESC
    LIMIT 1;
  END IF;

  IF v_dwi_id IS NULL THEN
    RAISE NOTICE '[038] No dept_work_items row found — skipping step 2.';
    RETURN;
  END IF;

  RAISE NOTICE '[038] Found work item % with status=%', v_dwi_id, v_status;

  -- Only advance if currently in 'assigned' (not if already in_progress/etc.)
  IF v_status = 'assigned' THEN
    UPDATE dept_work_items
    SET
      status      = 'in_progress',
      accepted_at = COALESCE(accepted_at, NOW()),
      started_at  = COALESCE(started_at,  NOW())
    WHERE id = v_dwi_id;

    GET DIAGNOSTICS v_updated = ROW_COUNT;
    RAISE NOTICE '[038] Advanced status to in_progress for work item %. Rows updated: %', v_dwi_id, v_updated;

    -- Add accepted log entry (idempotent)
    IF NOT EXISTS (
      SELECT 1 FROM dept_work_logs
      WHERE work_item_id = v_dwi_id AND action = 'accepted'
    ) THEN
      INSERT INTO dept_work_logs (work_item_id, actor, action, note)
      VALUES (
        v_dwi_id,
        'system',
        'accepted',
        'Priya Nair accepted and began processing this ticket (repaired by migration 038).'
      );
      RAISE NOTICE '[038] Inserted accepted work log for work item %', v_dwi_id;
    ELSE
      RAISE NOTICE '[038] accepted work log already exists — skipping insert.';
    END IF;

  ELSIF v_status IN ('in_progress', 'customer_resolution', 'completed') THEN
    -- Already past assigned — just ensure accepted_at and started_at are set
    UPDATE dept_work_items
    SET
      accepted_at = COALESCE(accepted_at, NOW()),
      started_at  = COALESCE(started_at,  NOW())
    WHERE id = v_dwi_id;
    RAISE NOTICE '[038] Work item % already in status=%. Set accepted_at/started_at if missing.', v_dwi_id, v_status;

  ELSE
    RAISE NOTICE '[038] Work item % has status=%. No status change applied.', v_dwi_id, v_status;
  END IF;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- STEP 3: Verify — final state
-- ═══════════════════════════════════════════════════════════════════════════════

SELECT
  dwi.id           AS work_item_id,
  dwi.status       AS status,
  dwi.intent,
  dwi.assigned_to,
  dwi.accepted_at,
  dwi.started_at,
  dwi.sla_deadline,
  dwi.sla_breached,
  (dwi.sla_deadline > NOW()) AS sla_valid
FROM dept_work_items dwi
JOIN tickets t ON t.id = dwi.ticket_id
JOIN emails e ON e.id = t.email_id
WHERE e.sender ILIKE '%aynaval%'
   OR t.id::text ILIKE 'c51268f8%'
ORDER BY dwi.created_at DESC
LIMIT 5;

-- Final work logs
SELECT
  l.action,
  l.actor,
  l.note,
  l.created_at
FROM dept_work_logs l
JOIN dept_work_items dwi ON dwi.id = l.work_item_id
JOIN tickets t ON t.id = dwi.ticket_id
JOIN emails e ON e.id = t.email_id
WHERE e.sender ILIKE '%aynaval%'
   OR t.id::text ILIKE 'c51268f8%'
ORDER BY l.created_at ASC;
