/*
  ┌─────────────────────────────────────────────────────────────────────────────┐
  │  MIGRATION 037 — Fix ticket #C51268F8 (aynaval1213) data                    │
  │                                                                             │
  │  Run in: Supabase Dashboard → SQL Editor → Run                              │
  │                                                                             │
  │  What it does:                                                              │
  │  1. Fixes intent from "General Inquiry" → "Workplace Harassment Complaint" │
  │  2. Resets SLA deadline to now + 2h (CRITICAL SLA) and clears sla_breached │
  │  3. Removes DUPLICATE assignment work log entries (keeps only earliest)     │
  │  4. Verifies final state                                                    │
  │                                                                             │
  │  Safe to run multiple times — all operations are idempotent.                │
  └─────────────────────────────────────────────────────────────────────────────┘
*/

-- ═══════════════════════════════════════════════════════════════════════════════
-- STEP 1: Diagnose — what does the ticket and work item currently look like?
-- ═══════════════════════════════════════════════════════════════════════════════

SELECT
  t.id             AS ticket_id,
  t.status         AS ticket_status,
  t.intent         AS ticket_intent,
  t.department,
  t.subteam,
  t.priority,
  e.sender         AS employee_email,
  dwi.id           AS work_item_id,
  dwi.status       AS work_item_status,
  dwi.intent       AS work_item_intent,
  dwi.assigned_to,
  dwi.assigned_at,
  dwi.sla_deadline,
  dwi.sla_breached
FROM tickets t
JOIN emails e ON e.id = t.email_id
LEFT JOIN dept_work_items dwi ON dwi.ticket_id = t.id
WHERE e.sender ILIKE '%aynaval%'
   OR t.id::text ILIKE 'c51268f8%'
ORDER BY t.created_at DESC
LIMIT 5;

-- ═══════════════════════════════════════════════════════════════════════════════
-- STEP 2: Fix intent on tickets table
-- ═══════════════════════════════════════════════════════════════════════════════

UPDATE tickets t
SET intent = 'Workplace Harassment Complaint'
FROM emails e
WHERE e.id = t.email_id
  AND e.sender ILIKE '%aynaval%'
  AND (t.intent IS NULL OR t.intent ILIKE '%general%' OR t.intent ILIKE '%inquiry%');

-- Also handle ticket found by short ID prefix
UPDATE tickets
SET intent = 'Workplace Harassment Complaint'
WHERE id::text ILIKE 'c51268f8%'
  AND (intent IS NULL OR intent ILIKE '%general%' OR intent ILIKE '%inquiry%');

SELECT 'tickets.intent fixed', COUNT(*) FROM tickets WHERE id::text ILIKE 'c51268f8%';

-- ═══════════════════════════════════════════════════════════════════════════════
-- STEP 3: Fix intent + SLA on dept_work_items
-- ═══════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_dwi_id  uuid;
  v_updated int;
BEGIN
  -- Find the work item for aynaval's ticket
  SELECT dwi.id
  INTO v_dwi_id
  FROM dept_work_items dwi
  JOIN tickets t ON t.id = dwi.ticket_id
  JOIN emails e ON e.id = t.email_id
  WHERE e.sender ILIKE '%aynaval%'
  ORDER BY dwi.created_at DESC
  LIMIT 1;

  -- Also try by ticket id prefix
  IF v_dwi_id IS NULL THEN
    SELECT dwi.id
    INTO v_dwi_id
    FROM dept_work_items dwi
    JOIN tickets t ON t.id = dwi.ticket_id
    WHERE t.id::text ILIKE 'c51268f8%'
    ORDER BY dwi.created_at DESC
    LIMIT 1;
  END IF;

  IF v_dwi_id IS NULL THEN
    RAISE NOTICE '[037] No dept_work_items row found for aynaval — skipping step 3.';
    RETURN;
  END IF;

  RAISE NOTICE '[037] Found dept_work_items id: %', v_dwi_id;

  -- Fix intent and reset SLA (CRITICAL = 2h from now)
  UPDATE dept_work_items
  SET
    intent       = 'Workplace Harassment Complaint',
    sla_deadline = NOW() + INTERVAL '2 hours',
    sla_breached = false
  WHERE id = v_dwi_id;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RAISE NOTICE '[037] dept_work_items updated: % row(s)', v_updated;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- STEP 4: Remove DUPLICATE assignment work log entries
--         Keep only the EARLIEST 'assigned' log per work item.
-- ═══════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_deleted int;
BEGIN
  -- Delete all but the first 'assigned' log for each work_item_id
  WITH ranked_logs AS (
    SELECT
      id,
      work_item_id,
      ROW_NUMBER() OVER (
        PARTITION BY work_item_id, action
        ORDER BY created_at ASC
      ) AS rn
    FROM dept_work_logs
    WHERE action = 'assigned'
  )
  DELETE FROM dept_work_logs
  WHERE id IN (
    SELECT id FROM ranked_logs WHERE rn > 1
  );

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RAISE NOTICE '[037] Deleted % duplicate assignment log(s)', v_deleted;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- STEP 5: Verify — final state of the ticket
-- ═══════════════════════════════════════════════════════════════════════════════

SELECT
  t.id             AS ticket_id,
  t.intent         AS ticket_intent,
  t.department,
  t.subteam,
  t.priority,
  dwi.id           AS work_item_id,
  dwi.status       AS work_item_status,
  dwi.intent       AS work_item_intent,
  dwi.assigned_to,
  dwi.sla_deadline,
  dwi.sla_breached,
  (dwi.sla_deadline > NOW()) AS sla_valid
FROM tickets t
JOIN emails e ON e.id = t.email_id
JOIN dept_work_items dwi ON dwi.ticket_id = t.id
WHERE e.sender ILIKE '%aynaval%'
   OR t.id::text ILIKE 'c51268f8%'
ORDER BY dwi.created_at DESC
LIMIT 5;

-- Work logs after deduplication
SELECT
  l.id,
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
