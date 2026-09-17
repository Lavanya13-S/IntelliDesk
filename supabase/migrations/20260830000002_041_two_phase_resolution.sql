-- ============================================================================
-- Migration 041: Two-Phase Resolution
--
-- Separates the resolution process into:
--   Phase 1 (PRIMARY):   Store employee-facing resolution in IntelliDesk DB
--   Phase 2 (SECONDARY): Send real Gmail notification "check IntelliDesk"
--
-- New tables:
--   ticket_resolutions     — the full employee-visible case resolution record
--   notification_deliveries — audit trail for every secondary Gmail notification
--
-- New columns on tickets:
--   resolution_published      — true after Phase 1 completes
--   resolution_published_at   — timestamp of Phase 1
--   notification_status       — NULL | PENDING | SENT | FAILED (Phase 2 state)
--
-- Expanded dept_work_logs CHECK:
--   resolution_published, notification_sent, notification_failed, notification_retried
-- ============================================================================

-- ── 1. ticket_resolutions ───────────────────────────────────────────────────
-- PRIMARY resolution record — the content the employee reads inside IntelliDesk.
-- Stored permanently; associated with ticketId; never deleted after publication.

CREATE TABLE IF NOT EXISTS ticket_resolutions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id        uuid NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  work_item_id     uuid REFERENCES dept_work_items(id) ON DELETE SET NULL,
  title            text NOT NULL,          -- case/ticket title shown to employee
  resolution_text  text NOT NULL,          -- employee-facing resolution (safe, no credentials)
  published_by     text NOT NULL,          -- officer who published it
  published_at     timestamptz NOT NULL DEFAULT now(),
  visible_to_email text NOT NULL,          -- employee email — used for scoped access
  created_at       timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ticket_resolutions_ticket_id  ON ticket_resolutions(ticket_id);
CREATE INDEX IF NOT EXISTS idx_ticket_resolutions_email      ON ticket_resolutions(visible_to_email);

ALTER TABLE ticket_resolutions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_ticket_resolutions" ON ticket_resolutions;
CREATE POLICY "anon_select_ticket_resolutions" ON ticket_resolutions
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_ticket_resolutions" ON ticket_resolutions;
CREATE POLICY "anon_insert_ticket_resolutions" ON ticket_resolutions
  FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_ticket_resolutions" ON ticket_resolutions;
CREATE POLICY "anon_update_ticket_resolutions" ON ticket_resolutions
  FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

-- ── 2. notification_deliveries ──────────────────────────────────────────────
-- Audit record for every SECONDARY Gmail notification attempt.
-- delivery_status: PENDING | SENT | FAILED
-- delivery_mode:   REAL (must never be SIMULATED for final resolution)

CREATE TABLE IF NOT EXISTS notification_deliveries (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id           uuid REFERENCES tickets(id) ON DELETE CASCADE,
  work_item_id        uuid REFERENCES dept_work_items(id) ON DELETE SET NULL,
  recipient_email     text NOT NULL,
  channel             text NOT NULL DEFAULT 'EMAIL',
  notification_type   text NOT NULL DEFAULT 'CASE_UPDATED_CHECK_INTELLIDESK',
  subject             text,
  delivery_status     text NOT NULL DEFAULT 'PENDING'
                      CHECK (delivery_status IN ('PENDING', 'SENT', 'FAILED')),
  delivery_mode       text NOT NULL DEFAULT 'REAL'
                      CHECK (delivery_mode IN ('REAL', 'SIMULATED')),
  provider_message_id text,      -- real Gmail message ID (NOT sim_ prefix)
  provider_thread_id  text,      -- Gmail thread ID if available
  sent_at             timestamptz,
  failed_at           timestamptz,
  error_message       text,
  retry_count         int NOT NULL DEFAULT 0,
  created_at          timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notif_deliveries_ticket_id ON notification_deliveries(ticket_id);
CREATE INDEX IF NOT EXISTS idx_notif_deliveries_status    ON notification_deliveries(delivery_status);

ALTER TABLE notification_deliveries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_notification_deliveries" ON notification_deliveries;
CREATE POLICY "anon_select_notification_deliveries" ON notification_deliveries
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_notification_deliveries" ON notification_deliveries;
CREATE POLICY "anon_insert_notification_deliveries" ON notification_deliveries
  FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_notification_deliveries" ON notification_deliveries;
CREATE POLICY "anon_update_notification_deliveries" ON notification_deliveries
  FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

-- ── 3. New columns on tickets ────────────────────────────────────────────────

ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS resolution_published     boolean     NOT NULL DEFAULT false;

ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS resolution_published_at  timestamptz;

ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS notification_status      text;  -- NULL | PENDING | SENT | FAILED

CREATE INDEX IF NOT EXISTS idx_tickets_notification_status
  ON tickets(notification_status)
  WHERE notification_status IS NOT NULL;

-- ── 4. Expand dept_work_logs action CHECK ────────────────────────────────────
-- Add new two-phase resolution action types.

ALTER TABLE dept_work_logs
  DROP CONSTRAINT IF EXISTS valid_log_action;

ALTER TABLE dept_work_logs
  ADD CONSTRAINT valid_log_action CHECK (action IN (
    'created',
    'assigned',
    'accepted',
    'started',
    'paused',
    'waiting',
    'resumed',
    'submitted_for_review',
    'dept_processing_complete',
    'verified',
    'returned',
    'completed',
    'complete',
    'escalated',
    'commented',
    'reassigned',
    'sla_breached',
    'resolution_sent',
    -- Two-phase resolution actions (Migration 041):
    'resolution_published',   -- Phase 1: stored in IntelliDesk DB
    'notification_sent',      -- Phase 2: real Gmail confirmed sent
    'notification_failed',    -- Phase 2: real Gmail failed
    'notification_retried'    -- Phase 2 retry attempt
  ));

-- ── 5. Verify ────────────────────────────────────────────────────────────────

SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('ticket_resolutions', 'notification_deliveries')
ORDER BY table_name;

SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'tickets'
  AND column_name IN ('resolution_published', 'resolution_published_at', 'notification_status')
ORDER BY column_name;
