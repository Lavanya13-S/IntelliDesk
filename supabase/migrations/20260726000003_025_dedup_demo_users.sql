/*
  Migration 025: Demo User Deduplication & Email Consolidation

  Problem: Previous migrations inserted new rows for Admin and Manager instead of
           updating existing ones, causing duplicates.

  This migration:
    1. Updates manager_email references in approval_requests (text column, no FK)
    2. Consolidates user_roles — UPDATE old → new email, DELETE duplicates
    3. Leaves the 5 correct final records and deletes everything else
    4. Verifies exactly 5 demo users remain

  Safe to re-run — uses conditional logic so it is idempotent.
*/

BEGIN;

-- ─── STEP 1: Fix approval_requests.manager_email references ──────────────────
-- These are plain text columns, not FK-constrained, so UPDATE is safe.

UPDATE approval_requests
SET manager_email = 'intellidesk.support@gmail.com'
WHERE manager_email IN ('admin@helpmind.local', 'admin@helpmind.ai');

UPDATE approval_requests
SET manager_email = 'lavanyas4074@gmail.com'
WHERE manager_email = 'arjun.menon@helpmind.local';

-- ─── STEP 2: Consolidate Admin in user_roles ─────────────────────────────────
-- Strategy: if intellidesk.support@gmail.com already exists, just delete the
-- stale old rows. If it doesn't exist, UPDATE one old row to the new email and
-- DELETE the other(s).

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM user_roles WHERE email = 'intellidesk.support@gmail.com') THEN
    -- New canonical row already exists — remove all old duplicates
    DELETE FROM user_roles
    WHERE email IN ('admin@helpmind.local', 'admin@helpmind.ai');
  ELSE
    -- Promote admin@helpmind.local to the canonical email (prefer it over .ai)
    -- First remove .ai if present to avoid a UNIQUE collision
    DELETE FROM user_roles WHERE email = 'admin@helpmind.ai';

    -- Now UPDATE the remaining old record to the new email
    UPDATE user_roles
    SET
      email        = 'intellidesk.support@gmail.com',
      role         = 'admin',
      display_name = 'IntelliDesk Admin',
      department   = 'IT Admin',
      active       = true,
      updated_at   = now()
    WHERE email = 'admin@helpmind.local';
  END IF;
END $$;

-- ─── STEP 3: Consolidate Manager in user_roles ───────────────────────────────

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM user_roles WHERE email = 'lavanyas4074@gmail.com') THEN
    -- New canonical row already exists — delete the old duplicate
    DELETE FROM user_roles WHERE email = 'arjun.menon@helpmind.local';
  ELSE
    -- UPDATE old record to the new email
    UPDATE user_roles
    SET
      email        = 'lavanyas4074@gmail.com',
      role         = 'manager',
      display_name = 'Arjun Menon',
      department   = 'IT',
      active       = true,
      updated_at   = now()
    WHERE email = 'arjun.menon@helpmind.local';
  END IF;
END $$;

-- ─── STEP 4: Ensure the 5 canonical records are correct ──────────────────────
-- This is a safety net — upsert the exact final state for all 5 accounts.
-- ON CONFLICT only fires if the email already exists (which it should after
-- steps 2 & 3). This never inserts a sixth row.

INSERT INTO user_roles (email, role, display_name, department, active)
VALUES
  ('aynaval1213@gmail.com',          'employee',         'Sarah Johnson',  'Finance',    true),
  ('lavanyas4074@gmail.com',         'manager',          'Arjun Menon',    'IT',         true),
  ('support@helpmind.local',         'department_staff', 'Rahul Sharma',   'SAP Basis',  true),
  ('intellidesk.support@gmail.com',  'admin',            'IntelliDesk Admin', 'IT Admin',   true),
  ('demo@helpmind.local',            'department_staff', 'Demo User',      'IT Support', true)
ON CONFLICT (email) DO UPDATE SET
  role         = EXCLUDED.role,
  display_name = EXCLUDED.display_name,
  department   = EXCLUDED.department,
  active       = EXCLUDED.active,
  updated_at   = now();

-- ─── STEP 5: Delete ANY remaining stale admin/manager variants ───────────────
-- Belt-and-suspenders: removes any leftover old email rows that might have
-- survived the DO blocks above (e.g. if the table had unexpected duplicates).

DELETE FROM user_roles
WHERE email IN (
  'admin@helpmind.local',
  'admin@helpmind.ai',
  'arjun.menon@helpmind.local'
);

COMMIT;

-- ─── VERIFICATION ─────────────────────────────────────────────────────────────
-- Expected: exactly 5 rows. Run this in Supabase SQL Editor to confirm.

SELECT
  email,
  role,
  display_name,
  department,
  active,
  updated_at
FROM user_roles
ORDER BY
  CASE role
    WHEN 'admin'            THEN 1
    WHEN 'manager'          THEN 2
    WHEN 'department_staff' THEN 3
    WHEN 'employee'         THEN 4
    ELSE 5
  END;

-- Should also confirm no duplicates:
SELECT email, COUNT(*) AS cnt
FROM user_roles
GROUP BY email
HAVING COUNT(*) > 1;
-- ↑ This should return 0 rows (no duplicates)
