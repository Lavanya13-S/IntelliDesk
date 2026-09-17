/*
  Migration 016: Enterprise Approval Workflow

  Creates:
    - approval_requests   : org-directory-linked approval records
    - approval_audit_log  : immutable audit trail for every approval event

  Extends:
    - tickets : adds approval_status + resolved_at columns

  Constraints:
    - approval_token is UNIQUE and expires after 48 hours
    - All manager/employee references use UUID FKs into employees table
    - Full RLS (anon + authenticated full access for single-tenant demo)
*/

-- ─── Extend tickets ───────────────────────────────────────────────────────────

ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS approval_status text NOT NULL DEFAULT 'none'
    CHECK (approval_status IN ('none','pending','approved','rejected')),
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_tickets_approval_status ON tickets (approval_status);

-- ─── approval_requests ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS approval_requests (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id         uuid        REFERENCES tickets(id)   ON DELETE CASCADE,
  email_id          uuid        REFERENCES emails(id)    ON DELETE SET NULL,

  -- org-directory references (no FK constraint so they survive employee deletes)
  employee_id       uuid,       -- employees.id of the sender
  manager_id        uuid,       -- employees.id of the approver
  approval_level    int         NOT NULL DEFAULT 1,

  -- request details (denormalised for audit/history)
  employee_name     text,
  employee_email    text,
  manager_name      text,
  manager_email     text,
  department        text,
  team_name         text,

  -- decision context (from Decision Agent)
  intent            text,
  priority          text,
  risk_level        text,
  ai_reason         text,
  ai_confidence     int,

  -- status lifecycle
  status            text        NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','rejected','expired')),
  comments          text,

  -- secure token for email links
  approval_token    text        UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
  token_expires_at  timestamptz NOT NULL DEFAULT (now() + interval '48 hours'),

  -- timestamps
  approved_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_ar_ticket_id     ON approval_requests (ticket_id);
CREATE INDEX IF NOT EXISTS idx_ar_status        ON approval_requests (status);
CREATE INDEX IF NOT EXISTS idx_ar_manager_id    ON approval_requests (manager_id);
CREATE INDEX IF NOT EXISTS idx_ar_employee_id   ON approval_requests (employee_id);
CREATE INDEX IF NOT EXISTS idx_ar_token         ON approval_requests (approval_token);
CREATE INDEX IF NOT EXISTS idx_ar_created_at    ON approval_requests (created_at DESC);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_approval_requests_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ar_updated_at ON approval_requests;
CREATE TRIGGER trg_ar_updated_at
  BEFORE UPDATE ON approval_requests
  FOR EACH ROW EXECUTE FUNCTION update_approval_requests_updated_at();

-- RLS
ALTER TABLE approval_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_select_approval_requests" ON approval_requests;
CREATE POLICY "anon_select_approval_requests"
  ON approval_requests FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_approval_requests" ON approval_requests;
CREATE POLICY "anon_insert_approval_requests"
  ON approval_requests FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_approval_requests" ON approval_requests;
CREATE POLICY "anon_update_approval_requests"
  ON approval_requests FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_approval_requests" ON approval_requests;
CREATE POLICY "anon_delete_approval_requests"
  ON approval_requests FOR DELETE TO anon, authenticated USING (true);

-- ─── approval_audit_log ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS approval_audit_log (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  approval_id   uuid        REFERENCES approval_requests(id) ON DELETE CASCADE,
  event         text        NOT NULL
    CHECK (event IN ('created','approved','rejected','expired','email_sent','reminder_sent','viewed')),
  actor         text        NOT NULL DEFAULT 'system',
  comments      text,
  ip_address    text,
  user_agent    text,
  metadata      jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_aal_approval_id ON approval_audit_log (approval_id);
CREATE INDEX IF NOT EXISTS idx_aal_event       ON approval_audit_log (event);
CREATE INDEX IF NOT EXISTS idx_aal_created_at  ON approval_audit_log (created_at DESC);

-- RLS
ALTER TABLE approval_audit_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_select_aal" ON approval_audit_log;
CREATE POLICY "anon_select_aal"
  ON approval_audit_log FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_aal" ON approval_audit_log;
CREATE POLICY "anon_insert_aal"
  ON approval_audit_log FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_aal" ON approval_audit_log;
CREATE POLICY "anon_update_aal"
  ON approval_audit_log FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
