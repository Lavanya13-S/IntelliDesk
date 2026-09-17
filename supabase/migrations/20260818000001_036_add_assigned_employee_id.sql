/*
  Migration 036: Add assigned_employee_id to dept_work_items
  ===========================================================

  Adds a proper foreign-key column so the system can store the employees.id
  of the automatically-resolved assignee alongside the existing assigned_to
  text column (kept for display compatibility).

  This enables:
  - JOIN queries to look up fresh employee name/email from org data
  - Validation that the assignee actually exists in the org directory
  - Future workload queries using employee.id

  Safe to run multiple times (IF NOT EXISTS).
*/

-- ── 1. Add assigned_employee_id column ────────────────────────────────────────

ALTER TABLE dept_work_items
  ADD COLUMN IF NOT EXISTS assigned_employee_id uuid
    REFERENCES employees(id) ON DELETE SET NULL;

COMMENT ON COLUMN dept_work_items.assigned_employee_id
  IS 'FK to employees.id — the org-directory record of the automatically assigned person.';

-- ── 2. Index for fast lookup ───────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_dwi_assigned_employee_id
  ON dept_work_items (assigned_employee_id);

-- ── 3. Refresh valid_log_action constraint ─────────────────────────────────────
-- Ensures 'assigned' is always a valid action, even if an older migration was
-- the last one to define this constraint.

ALTER TABLE dept_work_logs DROP CONSTRAINT IF EXISTS valid_log_action;
ALTER TABLE dept_work_logs ADD CONSTRAINT valid_log_action CHECK (action IN (
  'created', 'assigned', 'accepted', 'started', 'paused', 'waiting',
  'resumed', 'submitted_for_review', 'verified', 'returned',
  'dept_processing_complete',
  'completed', 'escalated', 'commented', 'reassigned', 'sla_breached'
));

-- ── 4. Backfill existing rows where assigned_to name matches an employee ───────
-- Best-effort match on employee_name text (case-insensitive).

UPDATE dept_work_items dwi
SET assigned_employee_id = e.id
FROM employees e
WHERE dwi.assigned_employee_id IS NULL
  AND dwi.assigned_to IS NOT NULL
  AND e.employee_name ILIKE dwi.assigned_to
  AND e.employment_status = 'active';

-- ── 5. Verify ─────────────────────────────────────────────────────────────────

SELECT
  id,
  assigned_to,
  assigned_employee_id,
  status,
  department,
  team_name
FROM dept_work_items
ORDER BY created_at DESC
LIMIT 20;
