/*
  Migration 017: Module 2C — Approval Rule Engine + RBAC

  Creates:
    - approval_rules  : configurable routing rules per intent/category
    - user_roles      : email → role mapping for RBAC (manager, admin, etc.)

  Seeds:
    - 15 default approval rules matching the enterprise spec
*/

-- ─── approval_rules ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS approval_rules (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Intent matching (fuzzy ILIKE pattern, e.g. '%sap access%')
  intent_pattern       text        NOT NULL,

  -- Human-readable rule name
  rule_name            text        NOT NULL,

  -- Core routing decision
  requires_approval    boolean     NOT NULL DEFAULT true,
  skip_manager         boolean     NOT NULL DEFAULT false,  -- bypass reporting manager
  critical_escalation  boolean     NOT NULL DEFAULT false,  -- mark as critical + extra teams

  -- Where to route after decision
  target_department    text,        -- e.g. 'SAP Basis', 'IT IAM', 'HR Leave Team'
  secondary_department text,        -- second destination (e.g. 'Legal' for harassment)

  -- Approval level required (1 = reporting manager, 2 = dept head, etc.)
  required_approval_level int       NOT NULL DEFAULT 1,

  -- Metadata
  description          text,
  priority             int         NOT NULL DEFAULT 100,   -- lower = matched first
  active               boolean     NOT NULL DEFAULT true,

  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ar_rules_pattern  ON approval_rules (intent_pattern);
CREATE INDEX IF NOT EXISTS idx_ar_rules_active   ON approval_rules (active);
CREATE INDEX IF NOT EXISTS idx_ar_rules_priority ON approval_rules (priority);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_approval_rules_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_approval_rules_updated_at ON approval_rules;
CREATE TRIGGER trg_approval_rules_updated_at
  BEFORE UPDATE ON approval_rules
  FOR EACH ROW EXECUTE FUNCTION update_approval_rules_updated_at();

-- RLS
ALTER TABLE approval_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_select_approval_rules" ON approval_rules;
CREATE POLICY "anon_select_approval_rules"
  ON approval_rules FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_approval_rules" ON approval_rules;
CREATE POLICY "anon_insert_approval_rules"
  ON approval_rules FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_approval_rules" ON approval_rules;
CREATE POLICY "anon_update_approval_rules"
  ON approval_rules FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_approval_rules" ON approval_rules;
CREATE POLICY "anon_delete_approval_rules"
  ON approval_rules FOR DELETE TO anon, authenticated USING (true);

-- ─── user_roles ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS user_roles (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  email        text        UNIQUE NOT NULL,
  role         text        NOT NULL DEFAULT 'employee'
    CHECK (role IN ('employee', 'manager', 'department_staff', 'admin')),
  department   text,
  display_name text,
  active       boolean     NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_roles_email ON user_roles (email);
CREATE INDEX IF NOT EXISTS idx_user_roles_role  ON user_roles (role);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_user_roles_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_user_roles_updated_at ON user_roles;
CREATE TRIGGER trg_user_roles_updated_at
  BEFORE UPDATE ON user_roles
  FOR EACH ROW EXECUTE FUNCTION update_user_roles_updated_at();

-- RLS
ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_select_user_roles" ON user_roles;
CREATE POLICY "anon_select_user_roles"
  ON user_roles FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_user_roles" ON user_roles;
CREATE POLICY "anon_insert_user_roles"
  ON user_roles FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_user_roles" ON user_roles;
CREATE POLICY "anon_update_user_roles"
  ON user_roles FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_user_roles" ON user_roles;
CREATE POLICY "anon_delete_user_roles"
  ON user_roles FOR DELETE TO anon, authenticated USING (true);

-- ─── Seed: 15 Default Approval Rules ─────────────────────────────────────────
-- Priority: lower number = checked first (more specific patterns first)

INSERT INTO approval_rules
  (rule_name, intent_pattern, requires_approval, skip_manager, critical_escalation, target_department, secondary_department, required_approval_level, description, priority)
VALUES
  -- NO approval needed — auto-route directly
  ('Password Reset',
   '%password reset%',
   false, false, false,
   'IT IAM', null, 1,
   'Password reset requests are handled directly by IT IAM without manager approval.',
   10),

  ('VPN Issue',
   '%vpn%',
   false, false, false,
   'Network Team', null, 1,
   'VPN access issues handled directly by Network Team.',
   20),

  ('Travel Reimbursement',
   '%travel reimbursement%',
   false, false, false,
   'Finance Expense Team', null, 1,
   'Reimbursement claims processed directly by Finance Expense Team.',
   30),

  ('Payroll Issue',
   '%payroll%',
   false, false, false,
   'Finance Payroll Team', null, 1,
   'Payroll issues handled directly by Finance Payroll Team.',
   40),

  ('Insurance Claim',
   '%insurance%',
   false, false, false,
   'HR Benefits Team', null, 1,
   'Insurance claims processed by HR Benefits Team without approval.',
   50),

  -- SKIP MANAGER — special routing
  ('Harassment Complaint',
   '%harassment%',
   false, true, true,
   'HR Employee Relations', 'Legal',
   2,
   'Harassment complaints bypass reporting manager and route directly to HR Employee Relations and Legal. Marked critical.',
   5),

  ('Security Incident',
   '%security incident%',
   false, true, true,
   'Security Team', null,
   2,
   'Security incidents bypass manager and escalate directly to Security Team as critical.',
   15),

  -- REQUIRES APPROVAL — reporting manager + department
  ('SAP Access',
   '%sap%',
   true, false, false,
   'SAP Basis', null, 1,
   'SAP access requires reporting manager approval, then routes to SAP Basis team.',
   100),

  ('Oracle Access',
   '%oracle%',
   true, false, false,
   'Database Team', null, 1,
   'Oracle DB access requires reporting manager approval, then routes to Database Team.',
   110),

  ('Software Installation',
   '%software%',
   true, false, false,
   'IT Support', null, 1,
   'Software installation requests require reporting manager approval.',
   120),

  ('Laptop Replacement',
   '%laptop%',
   true, false, false,
   'IT Assets', null, 1,
   'Hardware replacement requires reporting manager approval, then IT Assets.',
   130),

  ('Leave Request',
   '%leave%',
   true, false, false,
   'HR Leave Team', null, 1,
   'Leave requests require reporting manager approval, then HR Leave Team processes.',
   140),

  ('Travel Request',
   '%travel request%',
   true, false, false,
   'Travel Desk', null, 1,
   'Travel requests require reporting manager approval before Travel Desk processing.',
   150),

  ('Procurement Request',
   '%procurement%',
   true, false, false,
   'Procurement', null, 1,
   'Procurement requests require reporting manager approval before Procurement.',
   160),

  -- Generic system access fallback
  ('System Access Request',
   '%access%',
   true, false, false,
   'IT Support', null, 1,
   'Generic system access requests require reporting manager approval.',
   200)

ON CONFLICT DO NOTHING;

-- ─── Seed: Default Admin Role ─────────────────────────────────────────────────
-- The system admin — override with your actual email

INSERT INTO user_roles (email, role, display_name, department)
VALUES ('admin@helpmind.ai', 'admin', 'HelpMind Admin', 'IT')
ON CONFLICT (email) DO UPDATE
  SET role = 'admin', display_name = 'HelpMind Admin';
