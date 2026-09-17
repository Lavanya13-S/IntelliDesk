/*
  Migration 015: Enterprise Organization Directory (Module 2A)

  Creates the core org-directory tables that power data-driven routing.
  All agents (Decision, Department, Routing, Approval) query these tables
  instead of using hardcoded department/team/manager strings.

  Tables:
    departments        — All enterprise departments with SLA and head
    teams              — Sub-teams per department with assigned manager
    employees          — 40+ employees with email, designation, dept, team, manager
    managers           — Manager capabilities and approval authority
    approval_hierarchy — Multi-level approval chain per dept/team

  Seed Data:
    10 departments | 40+ employees | 10 managers | 5 dept heads
    Realistic Indian names throughout.
*/

-- ─── 1. DEPARTMENTS ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS departments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  department_name  text NOT NULL UNIQUE,
  department_code  text NOT NULL UNIQUE,
  description      text,
  head_employee_id uuid,           -- FK set after employees are inserted
  sla_hours        int  NOT NULL DEFAULT 24,
  created_at       timestamptz DEFAULT now()
);

-- ─── 2. TEAMS ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS teams (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id uuid NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  team_name     text NOT NULL,
  team_code     text NOT NULL UNIQUE,
  manager_id    uuid,              -- FK set after employees are inserted
  created_at    timestamptz DEFAULT now()
);

-- ─── 3. EMPLOYEES ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS employees (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id       text NOT NULL UNIQUE,
  employee_name     text NOT NULL,
  employee_email    text NOT NULL UNIQUE,
  designation       text NOT NULL,
  department_id     uuid REFERENCES departments(id),
  team_id           uuid REFERENCES teams(id),
  manager_id        uuid REFERENCES employees(id),
  employment_status text NOT NULL DEFAULT 'active' CHECK (employment_status IN ('active','inactive','on_leave')),
  location          text,
  phone             text,
  created_at        timestamptz DEFAULT now()
);

-- ─── 4. MANAGERS ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS managers (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id         uuid NOT NULL UNIQUE REFERENCES employees(id) ON DELETE CASCADE,
  approval_level      int  NOT NULL DEFAULT 1 CHECK (approval_level BETWEEN 1 AND 5),
  can_approve_finance boolean NOT NULL DEFAULT false,
  can_approve_it      boolean NOT NULL DEFAULT false,
  can_approve_hr      boolean NOT NULL DEFAULT false,
  max_approval_amount numeric(12,2) DEFAULT 0,
  created_at          timestamptz DEFAULT now()
);

-- ─── 5. APPROVAL HIERARCHY ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS approval_hierarchy (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id       uuid NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  team_id             uuid REFERENCES teams(id) ON DELETE CASCADE,
  level               int  NOT NULL CHECK (level BETWEEN 1 AND 5),
  approver_employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  created_at          timestamptz DEFAULT now(),
  UNIQUE (department_id, team_id, level)
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- SEED DATA
-- ═══════════════════════════════════════════════════════════════════════════════

-- ─── DEPARTMENTS ───────────────────────────────────────────────────────────────

INSERT INTO departments (id, department_name, department_code, description, sla_hours) VALUES
  ('a1000000-0000-0000-0000-000000000001', 'Human Resources',      'HR',    'Employee lifecycle, compliance, and people operations',           8),
  ('a1000000-0000-0000-0000-000000000002', 'Finance',              'FIN',   'Payroll, accounts, budgeting, and financial controls',           12),
  ('a1000000-0000-0000-0000-000000000003', 'IT Support',           'ITS',   'End-user support, devices, network, and software',               4),
  ('a1000000-0000-0000-0000-000000000004', 'SAP Basis',            'SAP',   'SAP system administration, access provisioning, and ERP ops',    8),
  ('a1000000-0000-0000-0000-000000000005', 'Security',             'SEC',   'Cybersecurity, compliance, access control, and incident response',2),
  ('a1000000-0000-0000-0000-000000000006', 'Facilities',           'FAC',   'Office management, assets, infrastructure, and health & safety', 24),
  ('a1000000-0000-0000-0000-000000000007', 'Legal',                'LEG',   'Contract management, compliance, litigation, and regulatory',     4),
  ('a1000000-0000-0000-0000-000000000008', 'Travel',               'TRV',   'Business travel, hotel, flight, and visa management',            8),
  ('a1000000-0000-0000-0000-000000000009', 'Procurement',          'PRO',   'Vendor management, purchasing, and contract negotiations',       24),
  ('a1000000-0000-0000-0000-000000000010', 'Training & Development','TRD',  'Learning programs, certifications, and L&D operations',         24)
ON CONFLICT (id) DO NOTHING;

-- ─── EMPLOYEES — DEPARTMENT HEADS & SENIOR MANAGERS ────────────────────────────
-- Insert senior employees first (no manager_id dependency for heads)

INSERT INTO employees (id, employee_id, employee_name, employee_email, designation, department_id, team_id, manager_id, location, phone) VALUES

  -- ── HR Department Head ──────────────────────────────────────────────────────
  ('e1000000-0000-0000-0000-000000000001', 'EMP001', 'Ananya Krishnan',
   'ananya.krishnan@company.com', 'VP Human Resources',
   'a1000000-0000-0000-0000-000000000001', NULL, NULL, 'Mumbai', '+91-98200-11001'),

  -- ── Finance Department Head ─────────────────────────────────────────────────
  ('e1000000-0000-0000-0000-000000000002', 'EMP002', 'Arun Kumar',
   'arun.kumar@company.com', 'CFO',
   'a1000000-0000-0000-0000-000000000002', NULL, NULL, 'Mumbai', '+91-98200-11002'),

  -- ── IT Support Department Head ──────────────────────────────────────────────
  ('e1000000-0000-0000-0000-000000000003', 'EMP003', 'Karthik Iyer',
   'karthik.iyer@company.com', 'VP IT Operations',
   'a1000000-0000-0000-0000-000000000003', NULL, NULL, 'Bangalore', '+91-98200-11003'),

  -- ── SAP Basis Department Head ───────────────────────────────────────────────
  ('e1000000-0000-0000-0000-000000000004', 'EMP004', 'Vikram Nambiar',
   'vikram.nambiar@company.com', 'SAP Director',
   'a1000000-0000-0000-0000-000000000004', NULL, NULL, 'Hyderabad', '+91-98200-11004'),

  -- ── Security Department Head ────────────────────────────────────────────────
  ('e1000000-0000-0000-0000-000000000005', 'EMP005', 'Deepa Menon',
   'deepa.menon@company.com', 'CISO',
   'a1000000-0000-0000-0000-000000000005', NULL, NULL, 'Bangalore', '+91-98200-11005')

ON CONFLICT (id) DO NOTHING;

-- ─── TEAMS — insert before team members ────────────────────────────────────────

INSERT INTO teams (id, department_id, team_name, team_code, manager_id) VALUES

  -- HR Teams
  ('b1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'Employee Relations',   'HR-ER',  NULL),
  ('b1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001', 'Leave Management',     'HR-LM',  NULL),
  ('b1000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000001', 'HR Business Partner',  'HR-BP',  NULL),
  ('b1000000-0000-0000-0000-000000000004', 'a1000000-0000-0000-0000-000000000001', 'Talent Management',    'HR-TM',  NULL),

  -- Finance Teams
  ('b1000000-0000-0000-0000-000000000005', 'a1000000-0000-0000-0000-000000000002', 'Payroll Team',         'FIN-PR', NULL),
  ('b1000000-0000-0000-0000-000000000006', 'a1000000-0000-0000-0000-000000000002', 'Accounts Payable',     'FIN-AP', NULL),
  ('b1000000-0000-0000-0000-000000000007', 'a1000000-0000-0000-0000-000000000002', 'Finance Transformation','FIN-FT', NULL),

  -- IT Support Teams
  ('b1000000-0000-0000-0000-000000000008', 'a1000000-0000-0000-0000-000000000003', 'Service Desk',         'ITS-SD', NULL),
  ('b1000000-0000-0000-0000-000000000009', 'a1000000-0000-0000-0000-000000000003', 'Network & Infra',      'ITS-NI', NULL),
  ('b1000000-0000-0000-0000-000000000010', 'a1000000-0000-0000-0000-000000000003', 'End User Computing',   'ITS-EUC',NULL),

  -- SAP Basis Teams
  ('b1000000-0000-0000-0000-000000000011', 'a1000000-0000-0000-0000-000000000004', 'SAP Access Management','SAP-AM', NULL),
  ('b1000000-0000-0000-0000-000000000012', 'a1000000-0000-0000-0000-000000000004', 'SAP Basis Operations', 'SAP-BO', NULL),

  -- Security Teams
  ('b1000000-0000-0000-0000-000000000013', 'a1000000-0000-0000-0000-000000000005', 'Cyber Security',       'SEC-CS', NULL),
  ('b1000000-0000-0000-0000-000000000014', 'a1000000-0000-0000-0000-000000000005', 'Identity & Access',    'SEC-IAM',NULL),

  -- Facilities Teams
  ('b1000000-0000-0000-0000-000000000015', 'a1000000-0000-0000-0000-000000000006', 'Office Management',    'FAC-OM', NULL),
  ('b1000000-0000-0000-0000-000000000016', 'a1000000-0000-0000-0000-000000000006', 'Emergency Response',   'FAC-ER', NULL),

  -- Legal Teams
  ('b1000000-0000-0000-0000-000000000017', 'a1000000-0000-0000-0000-000000000007', 'Compliance',           'LEG-CO', NULL),
  ('b1000000-0000-0000-0000-000000000018', 'a1000000-0000-0000-0000-000000000007', 'Contract Management',  'LEG-CM', NULL),

  -- Travel Team
  ('b1000000-0000-0000-0000-000000000019', 'a1000000-0000-0000-0000-000000000008', 'Travel Operations',    'TRV-OP', NULL),

  -- Procurement Team
  ('b1000000-0000-0000-0000-000000000020', 'a1000000-0000-0000-0000-000000000009', 'Vendor Management',    'PRO-VM', NULL),

  -- Training Team
  ('b1000000-0000-0000-0000-000000000021', 'a1000000-0000-0000-0000-000000000010', 'Learning & Development','TRD-LD', NULL)

ON CONFLICT (id) DO NOTHING;

-- ─── EMPLOYEES — MANAGERS (level 2, report to dept heads) ──────────────────────

INSERT INTO employees (id, employee_id, employee_name, employee_email, designation, department_id, team_id, manager_id, location, phone) VALUES

  -- HR Managers
  ('e1000000-0000-0000-0000-000000000010', 'EMP010', 'Priya Nair',
   'priya.nair@company.com', 'HR Manager — Employee Relations',
   'a1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001',
   'e1000000-0000-0000-0000-000000000001', 'Mumbai', '+91-98200-11010'),

  ('e1000000-0000-0000-0000-000000000011', 'EMP011', 'Rohit Pillai',
   'rohit.pillai@company.com', 'HR Manager — Talent & L&D',
   'a1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000004',
   'e1000000-0000-0000-0000-000000000001', 'Mumbai', '+91-98200-11011'),

  -- Finance Managers
  ('e1000000-0000-0000-0000-000000000012', 'EMP012', 'Sneha Rao',
   'sneha.rao@company.com', 'Finance Manager — Payroll & AP',
   'a1000000-0000-0000-0000-000000000002', 'b1000000-0000-0000-0000-000000000005',
   'e1000000-0000-0000-0000-000000000002', 'Mumbai', '+91-98200-11012'),

  ('e1000000-0000-0000-0000-000000000013', 'EMP013', 'Arjun Menon',
   'arjun.menon@company.com', 'Finance Manager — Transformation',
   'a1000000-0000-0000-0000-000000000002', 'b1000000-0000-0000-0000-000000000007',
   'e1000000-0000-0000-0000-000000000002', 'Pune', '+91-98200-11013'),

  -- IT Support Managers
  ('e1000000-0000-0000-0000-000000000014', 'EMP014', 'Rahul Sharma',
   'rahul.sharma@company.com', 'IT Support Manager — Service Desk',
   'a1000000-0000-0000-0000-000000000003', 'b1000000-0000-0000-0000-000000000008',
   'e1000000-0000-0000-0000-000000000003', 'Bangalore', '+91-98200-11014'),

  ('e1000000-0000-0000-0000-000000000015', 'EMP015', 'Meera Subramaniam',
   'meera.subramaniam@company.com', 'IT Infrastructure Manager',
   'a1000000-0000-0000-0000-000000000003', 'b1000000-0000-0000-0000-000000000009',
   'e1000000-0000-0000-0000-000000000003', 'Bangalore', '+91-98200-11015'),

  -- SAP Manager
  ('e1000000-0000-0000-0000-000000000016', 'EMP016', 'Suresh Bhat',
   'suresh.bhat@company.com', 'SAP Basis Manager',
   'a1000000-0000-0000-0000-000000000004', 'b1000000-0000-0000-0000-000000000012',
   'e1000000-0000-0000-0000-000000000004', 'Hyderabad', '+91-98200-11016'),

  -- Security Manager
  ('e1000000-0000-0000-0000-000000000017', 'EMP017', 'Lakshmi Rajan',
   'lakshmi.rajan@company.com', 'Security Operations Manager',
   'a1000000-0000-0000-0000-000000000005', 'b1000000-0000-0000-0000-000000000013',
   'e1000000-0000-0000-0000-000000000005', 'Bangalore', '+91-98200-11017'),

  -- Legal Manager
  ('e1000000-0000-0000-0000-000000000018', 'EMP018', 'Nandini Joshi',
   'nandini.joshi@company.com', 'Legal Counsel & Compliance Manager',
   'a1000000-0000-0000-0000-000000000007', 'b1000000-0000-0000-0000-000000000017',
   NULL, 'Mumbai', '+91-98200-11018'),

  -- Procurement Manager
  ('e1000000-0000-0000-0000-000000000019', 'EMP019', 'Ganesh Iyer',
   'ganesh.iyer@company.com', 'Procurement Manager',
   'a1000000-0000-0000-0000-000000000009', 'b1000000-0000-0000-0000-000000000020',
   NULL, 'Chennai', '+91-98200-11019')

ON CONFLICT (id) DO NOTHING;

-- ─── UPDATE TEAM MANAGERS ───────────────────────────────────────────────────────

UPDATE teams SET manager_id = 'e1000000-0000-0000-0000-000000000010' WHERE id = 'b1000000-0000-0000-0000-000000000001';
UPDATE teams SET manager_id = 'e1000000-0000-0000-0000-000000000010' WHERE id = 'b1000000-0000-0000-0000-000000000002';
UPDATE teams SET manager_id = 'e1000000-0000-0000-0000-000000000011' WHERE id = 'b1000000-0000-0000-0000-000000000003';
UPDATE teams SET manager_id = 'e1000000-0000-0000-0000-000000000011' WHERE id = 'b1000000-0000-0000-0000-000000000004';
UPDATE teams SET manager_id = 'e1000000-0000-0000-0000-000000000012' WHERE id = 'b1000000-0000-0000-0000-000000000005';
UPDATE teams SET manager_id = 'e1000000-0000-0000-0000-000000000012' WHERE id = 'b1000000-0000-0000-0000-000000000006';
UPDATE teams SET manager_id = 'e1000000-0000-0000-0000-000000000013' WHERE id = 'b1000000-0000-0000-0000-000000000007';
UPDATE teams SET manager_id = 'e1000000-0000-0000-0000-000000000014' WHERE id = 'b1000000-0000-0000-0000-000000000008';
UPDATE teams SET manager_id = 'e1000000-0000-0000-0000-000000000015' WHERE id = 'b1000000-0000-0000-0000-000000000009';
UPDATE teams SET manager_id = 'e1000000-0000-0000-0000-000000000014' WHERE id = 'b1000000-0000-0000-0000-000000000010';
UPDATE teams SET manager_id = 'e1000000-0000-0000-0000-000000000016' WHERE id = 'b1000000-0000-0000-0000-000000000011';
UPDATE teams SET manager_id = 'e1000000-0000-0000-0000-000000000016' WHERE id = 'b1000000-0000-0000-0000-000000000012';
UPDATE teams SET manager_id = 'e1000000-0000-0000-0000-000000000017' WHERE id = 'b1000000-0000-0000-0000-000000000013';
UPDATE teams SET manager_id = 'e1000000-0000-0000-0000-000000000017' WHERE id = 'b1000000-0000-0000-0000-000000000014';
UPDATE teams SET manager_id = 'e1000000-0000-0000-0000-000000000018' WHERE id = 'b1000000-0000-0000-0000-000000000017';
UPDATE teams SET manager_id = 'e1000000-0000-0000-0000-000000000018' WHERE id = 'b1000000-0000-0000-0000-000000000018';
UPDATE teams SET manager_id = 'e1000000-0000-0000-0000-000000000019' WHERE id = 'b1000000-0000-0000-0000-000000000020';

-- ─── EMPLOYEES — REGULAR STAFF (40 individual contributors) ────────────────────

INSERT INTO employees (id, employee_id, employee_name, employee_email, designation, department_id, team_id, manager_id, location, phone) VALUES

  -- ── Finance — Finance Transformation team (validation: sarah.johnson) ────────
  ('e2000000-0000-0000-0000-000000000001', 'EMP020', 'Sarah Johnson',
   'sarah.johnson@company.com', 'Senior Financial Analyst',
   'a1000000-0000-0000-0000-000000000002', 'b1000000-0000-0000-0000-000000000007',
   'e1000000-0000-0000-0000-000000000013', 'Pune', '+91-98200-12001'),

  ('e2000000-0000-0000-0000-000000000002', 'EMP021', 'Kavitha Suresh',
   'kavitha.suresh@company.com', 'Financial Analyst',
   'a1000000-0000-0000-0000-000000000002', 'b1000000-0000-0000-0000-000000000007',
   'e1000000-0000-0000-0000-000000000013', 'Pune', '+91-98200-12002'),

  ('e2000000-0000-0000-0000-000000000003', 'EMP022', 'Vishal Gupta',
   'vishal.gupta@company.com', 'Finance Business Analyst',
   'a1000000-0000-0000-0000-000000000002', 'b1000000-0000-0000-0000-000000000007',
   'e1000000-0000-0000-0000-000000000013', 'Pune', '+91-98200-12003'),

  -- ── Finance — Payroll Team ────────────────────────────────────────────────────
  ('e2000000-0000-0000-0000-000000000004', 'EMP023', 'Pooja Balan',
   'pooja.balan@company.com', 'Payroll Specialist',
   'a1000000-0000-0000-0000-000000000002', 'b1000000-0000-0000-0000-000000000005',
   'e1000000-0000-0000-0000-000000000012', 'Mumbai', '+91-98200-12004'),

  ('e2000000-0000-0000-0000-000000000005', 'EMP024', 'Ravi Chandran',
   'ravi.chandran@company.com', 'Senior Payroll Executive',
   'a1000000-0000-0000-0000-000000000002', 'b1000000-0000-0000-0000-000000000005',
   'e1000000-0000-0000-0000-000000000012', 'Mumbai', '+91-98200-12005'),

  -- ── Finance — Accounts Payable ───────────────────────────────────────────────
  ('e2000000-0000-0000-0000-000000000006', 'EMP025', 'Divya Nair',
   'divya.nair@company.com', 'Accounts Payable Executive',
   'a1000000-0000-0000-0000-000000000002', 'b1000000-0000-0000-0000-000000000006',
   'e1000000-0000-0000-0000-000000000012', 'Mumbai', '+91-98200-12006'),

  -- ── HR — Employee Relations ──────────────────────────────────────────────────
  ('e2000000-0000-0000-0000-000000000007', 'EMP026', 'Meenakshi Pillai',
   'meenakshi.pillai@company.com', 'HR Executive — Employee Relations',
   'a1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001',
   'e1000000-0000-0000-0000-000000000010', 'Mumbai', '+91-98200-12007'),

  ('e2000000-0000-0000-0000-000000000008', 'EMP027', 'Ashwin Rajan',
   'ashwin.rajan@company.com', 'HR Business Partner',
   'a1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000003',
   'e1000000-0000-0000-0000-000000000011', 'Mumbai', '+91-98200-12008'),

  ('e2000000-0000-0000-0000-000000000009', 'EMP028', 'Shilpa Verma',
   'shilpa.verma@company.com', 'Talent Acquisition Specialist',
   'a1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000004',
   'e1000000-0000-0000-0000-000000000011', 'Delhi', '+91-98200-12009'),

  ('e2000000-0000-0000-0000-000000000010', 'EMP029', 'Krishnapriya Menon',
   'krishnapriya.menon@company.com', 'Leave & Attendance Coordinator',
   'a1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000002',
   'e1000000-0000-0000-0000-000000000010', 'Mumbai', '+91-98200-12010'),

  -- ── IT Support — Service Desk ────────────────────────────────────────────────
  ('e2000000-0000-0000-0000-000000000011', 'EMP030', 'Aditya Kumar',
   'aditya.kumar@company.com', 'IT Support Engineer L1',
   'a1000000-0000-0000-0000-000000000003', 'b1000000-0000-0000-0000-000000000008',
   'e1000000-0000-0000-0000-000000000014', 'Bangalore', '+91-98200-12011'),

  ('e2000000-0000-0000-0000-000000000012', 'EMP031', 'Sunita Rao',
   'sunita.rao@company.com', 'IT Support Engineer L2',
   'a1000000-0000-0000-0000-000000000003', 'b1000000-0000-0000-0000-000000000008',
   'e1000000-0000-0000-0000-000000000014', 'Bangalore', '+91-98200-12012'),

  ('e2000000-0000-0000-0000-000000000013', 'EMP032', 'Manoj Tiwari',
   'manoj.tiwari@company.com', 'Desktop Support Technician',
   'a1000000-0000-0000-0000-000000000003', 'b1000000-0000-0000-0000-000000000010',
   'e1000000-0000-0000-0000-000000000014', 'Bangalore', '+91-98200-12013'),

  -- ── IT Support — Network & Infra ─────────────────────────────────────────────
  ('e2000000-0000-0000-0000-000000000014', 'EMP033', 'Chandrasekhar Reddy',
   'chandrasekhar.reddy@company.com', 'Network Engineer',
   'a1000000-0000-0000-0000-000000000003', 'b1000000-0000-0000-0000-000000000009',
   'e1000000-0000-0000-0000-000000000015', 'Hyderabad', '+91-98200-12014'),

  ('e2000000-0000-0000-0000-000000000015', 'EMP034', 'Bhavna Singh',
   'bhavna.singh@company.com', 'Systems Administrator',
   'a1000000-0000-0000-0000-000000000003', 'b1000000-0000-0000-0000-000000000009',
   'e1000000-0000-0000-0000-000000000015', 'Bangalore', '+91-98200-12015'),

  -- ── SAP Basis ────────────────────────────────────────────────────────────────
  ('e2000000-0000-0000-0000-000000000016', 'EMP035', 'Sriram Venkatesh',
   'sriram.venkatesh@company.com', 'SAP Basis Consultant',
   'a1000000-0000-0000-0000-000000000004', 'b1000000-0000-0000-0000-000000000012',
   'e1000000-0000-0000-0000-000000000016', 'Hyderabad', '+91-98200-12016'),

  ('e2000000-0000-0000-0000-000000000017', 'EMP036', 'Padma Lakshmi',
   'padma.lakshmi@company.com', 'SAP Access Coordinator',
   'a1000000-0000-0000-0000-000000000004', 'b1000000-0000-0000-0000-000000000011',
   'e1000000-0000-0000-0000-000000000016', 'Hyderabad', '+91-98200-12017'),

  ('e2000000-0000-0000-0000-000000000018', 'EMP037', 'Jayesh Patel',
   'jayesh.patel@company.com', 'SAP Technical Analyst',
   'a1000000-0000-0000-0000-000000000004', 'b1000000-0000-0000-0000-000000000012',
   'e1000000-0000-0000-0000-000000000016', 'Hyderabad', '+91-98200-12018'),

  -- ── Security ─────────────────────────────────────────────────────────────────
  ('e2000000-0000-0000-0000-000000000019', 'EMP038', 'Tanvir Ahmed',
   'tanvir.ahmed@company.com', 'Cybersecurity Analyst',
   'a1000000-0000-0000-0000-000000000005', 'b1000000-0000-0000-0000-000000000013',
   'e1000000-0000-0000-0000-000000000017', 'Bangalore', '+91-98200-12019'),

  ('e2000000-0000-0000-0000-000000000020', 'EMP039', 'Asha Thomas',
   'asha.thomas@company.com', 'IAM Analyst',
   'a1000000-0000-0000-0000-000000000005', 'b1000000-0000-0000-0000-000000000014',
   'e1000000-0000-0000-0000-000000000017', 'Bangalore', '+91-98200-12020'),

  -- ── Facilities ───────────────────────────────────────────────────────────────
  ('e2000000-0000-0000-0000-000000000021', 'EMP040', 'Ramesh Naidu',
   'ramesh.naidu@company.com', 'Facilities Coordinator',
   'a1000000-0000-0000-0000-000000000006', 'b1000000-0000-0000-0000-000000000015',
   NULL, 'Mumbai', '+91-98200-12021'),

  ('e2000000-0000-0000-0000-000000000022', 'EMP041', 'Geeta Sharma',
   'geeta.sharma@company.com', 'Office Manager',
   'a1000000-0000-0000-0000-000000000006', 'b1000000-0000-0000-0000-000000000015',
   NULL, 'Delhi', '+91-98200-12022'),

  -- ── Legal ────────────────────────────────────────────────────────────────────
  ('e2000000-0000-0000-0000-000000000023', 'EMP042', 'Preethi Suresh',
   'preethi.suresh@company.com', 'Legal Associate',
   'a1000000-0000-0000-0000-000000000007', 'b1000000-0000-0000-0000-000000000018',
   'e1000000-0000-0000-0000-000000000018', 'Mumbai', '+91-98200-12023'),

  ('e2000000-0000-0000-0000-000000000024', 'EMP043', 'Vikash Pandey',
   'vikash.pandey@company.com', 'Compliance Analyst',
   'a1000000-0000-0000-0000-000000000007', 'b1000000-0000-0000-0000-000000000017',
   'e1000000-0000-0000-0000-000000000018', 'Mumbai', '+91-98200-12024'),

  -- ── Travel ───────────────────────────────────────────────────────────────────
  ('e2000000-0000-0000-0000-000000000025', 'EMP044', 'Anita Kapoor',
   'anita.kapoor@company.com', 'Travel Coordinator',
   'a1000000-0000-0000-0000-000000000008', 'b1000000-0000-0000-0000-000000000019',
   NULL, 'Mumbai', '+91-98200-12025'),

  ('e2000000-0000-0000-0000-000000000026', 'EMP045', 'Sudeep Nair',
   'sudeep.nair@company.com', 'Senior Travel Executive',
   'a1000000-0000-0000-0000-000000000008', 'b1000000-0000-0000-0000-000000000019',
   NULL, 'Mumbai', '+91-98200-12026'),

  -- ── Procurement ──────────────────────────────────────────────────────────────
  ('e2000000-0000-0000-0000-000000000027', 'EMP046', 'Natarajan Subramanian',
   'natarajan.subramanian@company.com', 'Procurement Analyst',
   'a1000000-0000-0000-0000-000000000009', 'b1000000-0000-0000-0000-000000000020',
   'e1000000-0000-0000-0000-000000000019', 'Chennai', '+91-98200-12027'),

  ('e2000000-0000-0000-0000-000000000028', 'EMP047', 'Rekha Balakrishnan',
   'rekha.balakrishnan@company.com', 'Vendor Relations Executive',
   'a1000000-0000-0000-0000-000000000009', 'b1000000-0000-0000-0000-000000000020',
   'e1000000-0000-0000-0000-000000000019', 'Chennai', '+91-98200-12028'),

  -- ── Training & Development ────────────────────────────────────────────────────
  ('e2000000-0000-0000-0000-000000000029', 'EMP048', 'Manju Krishnan',
   'manju.krishnan@company.com', 'L&D Specialist',
   'a1000000-0000-0000-0000-000000000010', 'b1000000-0000-0000-0000-000000000021',
   'e1000000-0000-0000-0000-000000000011', 'Bangalore', '+91-98200-12029'),

  ('e2000000-0000-0000-0000-000000000030', 'EMP049', 'Tarun Mehta',
   'tarun.mehta@company.com', 'Training Coordinator',
   'a1000000-0000-0000-0000-000000000010', 'b1000000-0000-0000-0000-000000000021',
   'e1000000-0000-0000-0000-000000000011', 'Delhi', '+91-98200-12030'),

  -- ── Extra cross-dept employees to hit 40+ total ───────────────────────────────
  ('e2000000-0000-0000-0000-000000000031', 'EMP050', 'Nalini Prasad',
   'nalini.prasad@company.com', 'HR Executive — Onboarding',
   'a1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000003',
   'e1000000-0000-0000-0000-000000000011', 'Bangalore', '+91-98200-12031'),

  ('e2000000-0000-0000-0000-000000000032', 'EMP051', 'Prashanth Kumar',
   'prashanth.kumar@company.com', 'IT Security Analyst',
   'a1000000-0000-0000-0000-000000000005', 'b1000000-0000-0000-0000-000000000013',
   'e1000000-0000-0000-0000-000000000017', 'Bangalore', '+91-98200-12032'),

  ('e2000000-0000-0000-0000-000000000033', 'EMP052', 'Harini Iyer',
   'harini.iyer@company.com', 'Finance Controller',
   'a1000000-0000-0000-0000-000000000002', 'b1000000-0000-0000-0000-000000000006',
   'e1000000-0000-0000-0000-000000000012', 'Mumbai', '+91-98200-12033'),

  ('e2000000-0000-0000-0000-000000000034', 'EMP053', 'Balaji Natarajan',
   'balaji.natarajan@company.com', 'SAP MM Consultant',
   'a1000000-0000-0000-0000-000000000004', 'b1000000-0000-0000-0000-000000000011',
   'e1000000-0000-0000-0000-000000000016', 'Hyderabad', '+91-98200-12034'),

  ('e2000000-0000-0000-0000-000000000035', 'EMP054', 'Shalini Dixit',
   'shalini.dixit@company.com', 'IT Support Engineer L3',
   'a1000000-0000-0000-0000-000000000003', 'b1000000-0000-0000-0000-000000000010',
   'e1000000-0000-0000-0000-000000000014', 'Delhi', '+91-98200-12035'),

  ('e2000000-0000-0000-0000-000000000036', 'EMP055', 'Girish Menon',
   'girish.menon@company.com', 'Compliance Officer',
   'a1000000-0000-0000-0000-000000000007', 'b1000000-0000-0000-0000-000000000017',
   'e1000000-0000-0000-0000-000000000018', 'Mumbai', '+91-98200-12036'),

  ('e2000000-0000-0000-0000-000000000037', 'EMP056', 'Uma Devi',
   'uma.devi@company.com', 'Payroll Executive',
   'a1000000-0000-0000-0000-000000000002', 'b1000000-0000-0000-0000-000000000005',
   'e1000000-0000-0000-0000-000000000012', 'Mumbai', '+91-98200-12037'),

  ('e2000000-0000-0000-0000-000000000038', 'EMP057', 'Naveen Thampi',
   'naveen.thampi@company.com', 'Facilities Engineer',
   'a1000000-0000-0000-0000-000000000006', 'b1000000-0000-0000-0000-000000000016',
   NULL, 'Hyderabad', '+91-98200-12038'),

  ('e2000000-0000-0000-0000-000000000039', 'EMP058', 'Savitha Rao',
   'savitha.rao@company.com', 'Procurement Executive',
   'a1000000-0000-0000-0000-000000000009', 'b1000000-0000-0000-0000-000000000020',
   'e1000000-0000-0000-0000-000000000019', 'Chennai', '+91-98200-12039'),

  ('e2000000-0000-0000-0000-000000000040', 'EMP059', 'Rajesh Pillai',
   'rajesh.pillai@company.com', 'Network Security Engineer',
   'a1000000-0000-0000-0000-000000000005', 'b1000000-0000-0000-0000-000000000013',
   'e1000000-0000-0000-0000-000000000017', 'Bangalore', '+91-98200-12040')

ON CONFLICT (id) DO NOTHING;

-- ─── SET DEPARTMENT HEADS ───────────────────────────────────────────────────────

UPDATE departments SET head_employee_id = 'e1000000-0000-0000-0000-000000000001' WHERE id = 'a1000000-0000-0000-0000-000000000001';
UPDATE departments SET head_employee_id = 'e1000000-0000-0000-0000-000000000002' WHERE id = 'a1000000-0000-0000-0000-000000000002';
UPDATE departments SET head_employee_id = 'e1000000-0000-0000-0000-000000000003' WHERE id = 'a1000000-0000-0000-0000-000000000003';
UPDATE departments SET head_employee_id = 'e1000000-0000-0000-0000-000000000004' WHERE id = 'a1000000-0000-0000-0000-000000000004';
UPDATE departments SET head_employee_id = 'e1000000-0000-0000-0000-000000000005' WHERE id = 'a1000000-0000-0000-0000-000000000005';
UPDATE departments SET head_employee_id = 'e1000000-0000-0000-0000-000000000018' WHERE id = 'a1000000-0000-0000-0000-000000000007';
UPDATE departments SET head_employee_id = 'e1000000-0000-0000-0000-000000000019' WHERE id = 'a1000000-0000-0000-0000-000000000009';

-- ─── MANAGERS TABLE ─────────────────────────────────────────────────────────────

INSERT INTO managers (employee_id, approval_level, can_approve_finance, can_approve_it, can_approve_hr, max_approval_amount) VALUES

  -- Dept Heads (Level 5)
  ('e1000000-0000-0000-0000-000000000001', 5, true,  true,  true,  500000.00), -- Ananya Krishnan VP HR
  ('e1000000-0000-0000-0000-000000000002', 5, true,  false, true,  5000000.00),-- Arun Kumar CFO
  ('e1000000-0000-0000-0000-000000000003', 5, false, true,  false, 1000000.00),-- Karthik Iyer VP IT
  ('e1000000-0000-0000-0000-000000000004', 5, false, true,  false, 500000.00), -- Vikram Nambiar SAP Dir
  ('e1000000-0000-0000-0000-000000000005', 5, false, true,  false, 500000.00), -- Deepa Menon CISO

  -- Mid Managers (Level 3)
  ('e1000000-0000-0000-0000-000000000010', 3, false, false, true,  100000.00), -- Priya Nair HR Mgr
  ('e1000000-0000-0000-0000-000000000011', 3, false, false, true,  100000.00), -- Rohit Pillai HR Mgr
  ('e1000000-0000-0000-0000-000000000012', 3, true,  false, false, 250000.00), -- Sneha Rao Finance Mgr
  ('e1000000-0000-0000-0000-000000000013', 3, true,  false, false, 250000.00), -- Arjun Menon Finance Mgr
  ('e1000000-0000-0000-0000-000000000014', 3, false, true,  false, 150000.00), -- Rahul Sharma IT Mgr
  ('e1000000-0000-0000-0000-000000000015', 3, false, true,  false, 150000.00), -- Meera Subramaniam IT Mgr
  ('e1000000-0000-0000-0000-000000000016', 3, false, true,  false, 200000.00), -- Suresh Bhat SAP Mgr
  ('e1000000-0000-0000-0000-000000000017', 3, false, true,  false, 100000.00), -- Lakshmi Rajan Sec Mgr
  ('e1000000-0000-0000-0000-000000000018', 4, true,  false, false, 300000.00), -- Nandini Joshi Legal
  ('e1000000-0000-0000-0000-000000000019', 3, true,  false, false, 500000.00) -- Ganesh Iyer Procurement

ON CONFLICT (employee_id) DO NOTHING;

-- ─── APPROVAL HIERARCHY ─────────────────────────────────────────────────────────

INSERT INTO approval_hierarchy (department_id, team_id, level, approver_employee_id) VALUES

  -- HR — Employee Relations
  ('a1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001', 1, 'e1000000-0000-0000-0000-000000000010'), -- Priya Nair
  ('a1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001', 2, 'e1000000-0000-0000-0000-000000000001'), -- Ananya Krishnan VP

  -- HR — Leave Management
  ('a1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000002', 1, 'e1000000-0000-0000-0000-000000000010'), -- Priya Nair
  ('a1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000002', 2, 'e1000000-0000-0000-0000-000000000001'), -- Ananya Krishnan VP

  -- HR — HR Business Partner
  ('a1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000003', 1, 'e1000000-0000-0000-0000-000000000011'), -- Rohit Pillai
  ('a1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000003', 2, 'e1000000-0000-0000-0000-000000000001'), -- Ananya Krishnan VP

  -- HR — Talent Management
  ('a1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000004', 1, 'e1000000-0000-0000-0000-000000000011'), -- Rohit Pillai
  ('a1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000004', 2, 'e1000000-0000-0000-0000-000000000001'), -- Ananya Krishnan VP

  -- Finance — Finance Transformation (sarah.johnson's team)
  ('a1000000-0000-0000-0000-000000000002', 'b1000000-0000-0000-0000-000000000007', 1, 'e1000000-0000-0000-0000-000000000013'), -- Arjun Menon (direct mgr)
  ('a1000000-0000-0000-0000-000000000002', 'b1000000-0000-0000-0000-000000000007', 2, 'e1000000-0000-0000-0000-000000000002'), -- Arun Kumar CFO

  -- Finance — Payroll Team
  ('a1000000-0000-0000-0000-000000000002', 'b1000000-0000-0000-0000-000000000005', 1, 'e1000000-0000-0000-0000-000000000012'), -- Sneha Rao
  ('a1000000-0000-0000-0000-000000000002', 'b1000000-0000-0000-0000-000000000005', 2, 'e1000000-0000-0000-0000-000000000002'), -- Arun Kumar CFO

  -- Finance — Accounts Payable
  ('a1000000-0000-0000-0000-000000000002', 'b1000000-0000-0000-0000-000000000006', 1, 'e1000000-0000-0000-0000-000000000012'), -- Sneha Rao
  ('a1000000-0000-0000-0000-000000000002', 'b1000000-0000-0000-0000-000000000006', 2, 'e1000000-0000-0000-0000-000000000002'), -- Arun Kumar CFO

  -- IT — Service Desk
  ('a1000000-0000-0000-0000-000000000003', 'b1000000-0000-0000-0000-000000000008', 1, 'e1000000-0000-0000-0000-000000000014'), -- Rahul Sharma
  ('a1000000-0000-0000-0000-000000000003', 'b1000000-0000-0000-0000-000000000008', 2, 'e1000000-0000-0000-0000-000000000003'), -- Karthik Iyer VP IT

  -- IT — Network & Infra
  ('a1000000-0000-0000-0000-000000000003', 'b1000000-0000-0000-0000-000000000009', 1, 'e1000000-0000-0000-0000-000000000015'), -- Meera Subramaniam
  ('a1000000-0000-0000-0000-000000000003', 'b1000000-0000-0000-0000-000000000009', 2, 'e1000000-0000-0000-0000-000000000003'), -- Karthik Iyer VP IT

  -- IT — End User Computing
  ('a1000000-0000-0000-0000-000000000003', 'b1000000-0000-0000-0000-000000000010', 1, 'e1000000-0000-0000-0000-000000000014'), -- Rahul Sharma
  ('a1000000-0000-0000-0000-000000000003', 'b1000000-0000-0000-0000-000000000010', 2, 'e1000000-0000-0000-0000-000000000003'), -- Karthik Iyer VP IT

  -- SAP — Access Management
  ('a1000000-0000-0000-0000-000000000004', 'b1000000-0000-0000-0000-000000000011', 1, 'e1000000-0000-0000-0000-000000000016'), -- Suresh Bhat
  ('a1000000-0000-0000-0000-000000000004', 'b1000000-0000-0000-0000-000000000011', 2, 'e1000000-0000-0000-0000-000000000004'), -- Vikram Nambiar

  -- SAP — Basis Operations
  ('a1000000-0000-0000-0000-000000000004', 'b1000000-0000-0000-0000-000000000012', 1, 'e1000000-0000-0000-0000-000000000016'), -- Suresh Bhat
  ('a1000000-0000-0000-0000-000000000004', 'b1000000-0000-0000-0000-000000000012', 2, 'e1000000-0000-0000-0000-000000000004'), -- Vikram Nambiar

  -- Security — Cyber Security
  ('a1000000-0000-0000-0000-000000000005', 'b1000000-0000-0000-0000-000000000013', 1, 'e1000000-0000-0000-0000-000000000017'), -- Lakshmi Rajan
  ('a1000000-0000-0000-0000-000000000005', 'b1000000-0000-0000-0000-000000000013', 2, 'e1000000-0000-0000-0000-000000000005'), -- Deepa Menon CISO

  -- Security — IAM
  ('a1000000-0000-0000-0000-000000000005', 'b1000000-0000-0000-0000-000000000014', 1, 'e1000000-0000-0000-0000-000000000017'), -- Lakshmi Rajan
  ('a1000000-0000-0000-0000-000000000005', 'b1000000-0000-0000-0000-000000000014', 2, 'e1000000-0000-0000-0000-000000000005'), -- Deepa Menon CISO

  -- Legal — Compliance
  ('a1000000-0000-0000-0000-000000000007', 'b1000000-0000-0000-0000-000000000017', 1, 'e1000000-0000-0000-0000-000000000018'), -- Nandini Joshi
  -- Legal — Contract
  ('a1000000-0000-0000-0000-000000000007', 'b1000000-0000-0000-0000-000000000018', 1, 'e1000000-0000-0000-0000-000000000018'), -- Nandini Joshi

  -- Procurement
  ('a1000000-0000-0000-0000-000000000009', 'b1000000-0000-0000-0000-000000000020', 1, 'e1000000-0000-0000-0000-000000000019'), -- Ganesh Iyer

  -- Training
  ('a1000000-0000-0000-0000-000000000010', 'b1000000-0000-0000-0000-000000000021', 1, 'e1000000-0000-0000-0000-000000000011'), -- Rohit Pillai
  ('a1000000-0000-0000-0000-000000000010', 'b1000000-0000-0000-0000-000000000021', 2, 'e1000000-0000-0000-0000-000000000001') -- Ananya Krishnan VP

ON CONFLICT (department_id, team_id, level) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════════════
-- INDEXES
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_employees_email       ON employees (employee_email);
CREATE INDEX IF NOT EXISTS idx_employees_dept        ON employees (department_id);
CREATE INDEX IF NOT EXISTS idx_employees_team        ON employees (team_id);
CREATE INDEX IF NOT EXISTS idx_employees_manager     ON employees (manager_id);
CREATE INDEX IF NOT EXISTS idx_employees_status      ON employees (employment_status);
CREATE INDEX IF NOT EXISTS idx_teams_dept            ON teams (department_id);
CREATE INDEX IF NOT EXISTS idx_approval_dept_team    ON approval_hierarchy (department_id, team_id, level);
CREATE INDEX IF NOT EXISTS idx_managers_approval_lvl ON managers (approval_level);

-- ═══════════════════════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE departments       ENABLE ROW LEVEL SECURITY;
ALTER TABLE teams             ENABLE ROW LEVEL SECURITY;
ALTER TABLE employees         ENABLE ROW LEVEL SECURITY;
ALTER TABLE managers          ENABLE ROW LEVEL SECURITY;
ALTER TABLE approval_hierarchy ENABLE ROW LEVEL SECURITY;

-- Departments
DROP POLICY IF EXISTS "anon_all_departments" ON departments;
CREATE POLICY "anon_all_departments" ON departments FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- Teams
DROP POLICY IF EXISTS "anon_all_teams" ON teams;
CREATE POLICY "anon_all_teams" ON teams FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- Employees
DROP POLICY IF EXISTS "anon_all_employees" ON employees;
CREATE POLICY "anon_all_employees" ON employees FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- Managers
DROP POLICY IF EXISTS "anon_all_managers" ON managers;
CREATE POLICY "anon_all_managers" ON managers FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- Approval Hierarchy
DROP POLICY IF EXISTS "anon_all_approval_hierarchy" ON approval_hierarchy;
CREATE POLICY "anon_all_approval_hierarchy" ON approval_hierarchy FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
