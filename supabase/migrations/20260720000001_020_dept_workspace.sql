/*
  Migration 020: Enterprise Department Processing Workspace

  Creates:
    - dept_sla_config   : SLA hours per priority (seeded)
    - dept_work_items   : one row per approved ticket routed to a department
    - dept_work_logs    : immutable action/audit log for every work item

  Touch zero existing tables.
  All statements are idempotent (IF NOT EXISTS / OR REPLACE).

  Run in: Supabase Dashboard → SQL Editor
*/

-- ─── dept_sla_config ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS dept_sla_config (
  priority   text PRIMARY KEY,
  sla_hours  int  NOT NULL,
  CONSTRAINT valid_priority CHECK (priority IN ('critical','high','medium','low'))
);

INSERT INTO dept_sla_config (priority, sla_hours) VALUES
  ('critical',  2),
  ('high',      4),
  ('medium',    8),
  ('low',      24)
ON CONFLICT (priority) DO NOTHING;

ALTER TABLE dept_sla_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "dept_sla_select" ON dept_sla_config;
CREATE POLICY "dept_sla_select" ON dept_sla_config FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "dept_sla_insert" ON dept_sla_config;
CREATE POLICY "dept_sla_insert" ON dept_sla_config FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "dept_sla_update" ON dept_sla_config;
CREATE POLICY "dept_sla_update" ON dept_sla_config FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- ─── dept_work_items ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS dept_work_items (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  approval_id      uuid        REFERENCES approval_requests(id) ON DELETE SET NULL,
  ticket_id        uuid        REFERENCES tickets(id)           ON DELETE SET NULL,
  email_id         uuid        REFERENCES emails(id)            ON DELETE SET NULL,
  department       text,
  team_name        text,
  employee_name    text,
  employee_email   text,
  intent           text,
  priority         text        NOT NULL DEFAULT 'medium'
    CONSTRAINT valid_dwi_priority CHECK (priority IN ('critical','high','medium','low')),
  status           text        NOT NULL DEFAULT 'assigned'
    CONSTRAINT valid_dwi_status CHECK (status IN ('assigned','in_progress','waiting','completed')),
  assigned_to      text,
  assigned_at      timestamptz,
  started_at       timestamptz,
  completed_at     timestamptz,
  sla_deadline     timestamptz,
  sla_breached     boolean      NOT NULL DEFAULT false,
  created_at       timestamptz  NOT NULL DEFAULT now(),
  updated_at       timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dwi_department   ON dept_work_items (department);
CREATE INDEX IF NOT EXISTS idx_dwi_status       ON dept_work_items (status);
CREATE INDEX IF NOT EXISTS idx_dwi_priority     ON dept_work_items (priority);
CREATE INDEX IF NOT EXISTS idx_dwi_assigned_to  ON dept_work_items (assigned_to);
CREATE INDEX IF NOT EXISTS idx_dwi_approval_id  ON dept_work_items (approval_id);
CREATE INDEX IF NOT EXISTS idx_dwi_ticket_id    ON dept_work_items (ticket_id);
CREATE INDEX IF NOT EXISTS idx_dwi_created_at   ON dept_work_items (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dwi_sla_deadline ON dept_work_items (sla_deadline);

CREATE OR REPLACE FUNCTION fn_dwi_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_dwi_updated_at ON dept_work_items;
CREATE TRIGGER trg_dwi_updated_at
  BEFORE UPDATE ON dept_work_items
  FOR EACH ROW EXECUTE FUNCTION fn_dwi_updated_at();

CREATE OR REPLACE FUNCTION fn_dwi_check_sla()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.sla_deadline IS NOT NULL AND NEW.sla_deadline < now() AND NEW.status != 'completed' THEN
    NEW.sla_breached = true;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_dwi_check_sla ON dept_work_items;
CREATE TRIGGER trg_dwi_check_sla
  BEFORE INSERT OR UPDATE ON dept_work_items
  FOR EACH ROW EXECUTE FUNCTION fn_dwi_check_sla();

ALTER TABLE dept_work_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "dwi_select" ON dept_work_items;
CREATE POLICY "dwi_select" ON dept_work_items FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "dwi_insert" ON dept_work_items;
CREATE POLICY "dwi_insert" ON dept_work_items FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "dwi_update" ON dept_work_items;
CREATE POLICY "dwi_update" ON dept_work_items FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

-- ─── dept_work_logs ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS dept_work_logs (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  work_item_id   uuid        NOT NULL REFERENCES dept_work_items(id) ON DELETE CASCADE,
  actor          text        NOT NULL DEFAULT 'system',
  action         text        NOT NULL
    CONSTRAINT valid_log_action CHECK (action IN (
      'created','assigned','started','paused','waiting',
      'resumed','completed','escalated','commented','reassigned','sla_breached'
    )),
  note           text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dwl_work_item_id ON dept_work_logs (work_item_id);
CREATE INDEX IF NOT EXISTS idx_dwl_created_at   ON dept_work_logs (created_at DESC);

ALTER TABLE dept_work_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "dwl_select" ON dept_work_logs;
CREATE POLICY "dwl_select" ON dept_work_logs FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "dwl_insert" ON dept_work_logs;
CREATE POLICY "dwl_insert" ON dept_work_logs FOR INSERT TO anon, authenticated WITH CHECK (true);

-- Enable Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE dept_work_items;
ALTER PUBLICATION supabase_realtime ADD TABLE dept_work_logs;

-- Verify
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('dept_work_items','dept_work_logs','dept_sla_config')
ORDER BY table_name;
