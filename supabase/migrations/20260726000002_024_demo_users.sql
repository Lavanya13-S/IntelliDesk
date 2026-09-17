/*
  Migration 024: Demo User Roles

  Seeds the user_roles table with the 5 demo accounts.
  Supabase Auth users (with passwords) must be created separately via
  the seed script: scripts/seed-demo-users.ts

  Note: role 'department_staff' = Engineer in UI
*/

INSERT INTO user_roles (email, role, display_name, department, active)
VALUES
  ('aynaval1213@gmail.com',       'employee',         'Sarah Johnson', 'Finance',    true),
  ('lavanyas4074@gmail.com',        'manager',          'Arjun Menon',   'IT',         true),
  ('support@helpmind.local',      'department_staff', 'Rahul Sharma',  'SAP Basis',  true),
  ('intellidesk.support@gmail.com', 'admin',            'IntelliDesk Admin', 'IT Admin', true),
  ('demo@helpmind.local',         'department_staff', 'Demo User',     'IT Support', true)
ON CONFLICT (email) DO UPDATE SET
  role         = EXCLUDED.role,
  display_name = EXCLUDED.display_name,
  department   = EXCLUDED.department,
  active       = EXCLUDED.active,
  updated_at   = now();

-- Verify
SELECT email, role, display_name, department FROM user_roles ORDER BY created_at;
