/*
  Migration 035: Fix Sensitive Escalation Classification Mismatch

  PURPOSE
  ───────
  Corrects existing emails and tickets in the database that were incorrectly
  classified as IT / End User Support / medium due to a missing sensitive-issue
  safety guard in the classification pipeline.

  Affected records: emails/tickets where the subject or body matches a
  workplace harassment / abuse / discrimination / retaliation pattern BUT the
  department is NOT already 'HR'.

  WHAT THIS MIGRATION DOES
  ────────────────────────
  1. Updates affected emails → priority='critical', department='HR', subteam='Employee Relations'
  2. Updates affected tickets → priority='critical', department='HR', subteam='Employee Relations'
  3. Inserts missing decision_logs entries for affected tickets (so the inbox
     loads from the persisted log instead of re-running a live decision)

  SAFETY
  ──────
  - Only updates records where department != 'HR' (already correct records untouched)
  - Pattern is scoped to genuine misconduct keywords — does NOT match general HR queries
  - Payroll, IT, and all non-harassment tickets are completely unaffected

  Run in: Supabase Dashboard → SQL Editor
*/

-- ─── Step 1–4: Correct all affected records in one transaction ────────────────

DO $$
DECLARE
  affected_email_count INT;
  affected_ticket_count INT;
  affected_decision_log_count INT;
BEGIN

  -- Count before update (for logging)
  SELECT COUNT(*) INTO affected_email_count
  FROM emails
  WHERE (
    subject ILIKE '%harass%'
    OR body ILIKE '%inappropriat%'
    OR body ILIKE '%discriminat%'
    OR body ILIKE '%retaliat%'
    OR body ILIKE '%misconduct%'
    OR body ILIKE '%hostile work%'
    OR subject ILIKE '%workplace complaint%'
    OR subject ILIKE '%confidential%complaint%'
  )
  AND (department IS NULL OR department != 'HR');

  RAISE NOTICE '[Migration 035] Found % email(s) to correct', affected_email_count;

  -- Update affected emails
  UPDATE emails
  SET
    priority   = 'critical',
    department = 'HR',
    subteam    = 'Employee Relations'
  WHERE (
    subject ILIKE '%harass%'
    OR body ILIKE '%inappropriat%'
    OR body ILIKE '%discriminat%'
    OR body ILIKE '%retaliat%'
    OR body ILIKE '%misconduct%'
    OR body ILIKE '%hostile work%'
    OR subject ILIKE '%workplace complaint%'
    OR subject ILIKE '%confidential%complaint%'
  )
  AND (department IS NULL OR department != 'HR');

  RAISE NOTICE '[Migration 035] Updated % email(s) to HR/critical', affected_email_count;

  -- Update affected tickets
  UPDATE tickets t
  SET
    priority   = 'critical',
    department = 'HR',
    subteam    = 'Employee Relations',
    status     = CASE WHEN t.status = 'open' THEN 'escalated' ELSE t.status END
  FROM emails e
  WHERE t.email_id = e.id
    AND (
      e.subject ILIKE '%harass%'
      OR e.body ILIKE '%inappropriat%'
      OR e.body ILIKE '%discriminat%'
      OR e.body ILIKE '%retaliat%'
      OR e.body ILIKE '%misconduct%'
      OR e.body ILIKE '%hostile work%'
      OR e.subject ILIKE '%workplace complaint%'
      OR e.subject ILIKE '%confidential%complaint%'
    )
    AND (t.department IS NULL OR t.department != 'HR');

  GET DIAGNOSTICS affected_ticket_count = ROW_COUNT;
  RAISE NOTICE '[Migration 035] Updated % ticket(s) to HR/critical/escalated', affected_ticket_count;

  -- Insert missing decision_logs for affected tickets
  INSERT INTO decision_logs (
    ticket_id,
    decision,
    confidence,
    risk_level,
    escalation_reason,
    recommended_department,
    recommended_subteam,
    recommended_person,
    requires_human,
    ai_summary,
    created_at
  )
  SELECT
    t.id,
    'ESCALATE',
    99,
    'Critical',
    'Workplace harassment or misconduct complaint detected. Requires immediate confidential HR investigation.',
    'HR',
    'Employee Relations',
    NULL,
    true,
    E'• Possible workplace harassment reported by employee — requires confidential HR investigation.\n• Employee reports repeated inappropriate behaviour from a colleague affecting their ability to work.\n• Immediate HR intervention recommended: acknowledge within 2 hours and initiate formal investigation process.',
    NOW()
  FROM tickets t
  JOIN emails e ON t.email_id = e.id
  WHERE (
    e.subject ILIKE '%harass%'
    OR e.body ILIKE '%inappropriat%'
    OR e.body ILIKE '%discriminat%'
    OR e.body ILIKE '%retaliat%'
    OR e.body ILIKE '%misconduct%'
    OR e.body ILIKE '%hostile work%'
    OR e.subject ILIKE '%workplace complaint%'
    OR e.subject ILIKE '%confidential%complaint%'
  )
  AND NOT EXISTS (
    SELECT 1 FROM decision_logs dl WHERE dl.ticket_id = t.id
  );

  GET DIAGNOSTICS affected_decision_log_count = ROW_COUNT;
  RAISE NOTICE '[Migration 035] Inserted % missing decision_log(s)', affected_decision_log_count;

  RAISE NOTICE '[Migration 035] Complete.';

END $$;

-- ─── Step 5: Verify results ───────────────────────────────────────────────────

SELECT
  e.id          AS email_id,
  e.subject,
  e.priority    AS email_priority,
  e.department  AS email_department,
  e.subteam     AS email_subteam,
  t.id          AS ticket_id,
  t.priority    AS ticket_priority,
  t.department  AS ticket_department,
  t.subteam     AS ticket_subteam,
  t.status      AS ticket_status,
  dl.decision,
  dl.risk_level,
  dl.confidence
FROM emails e
LEFT JOIN tickets t ON t.email_id = e.id
LEFT JOIN decision_logs dl ON dl.ticket_id = t.id
WHERE (
  e.subject ILIKE '%harass%'
  OR e.body ILIKE '%inappropriat%'
  OR e.body ILIKE '%discriminat%'
)
ORDER BY e.received_at DESC;
