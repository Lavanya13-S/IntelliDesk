/*
  Migration 034: Internal Resolution Details Persistence

  Adds structured internal resolution storage to dept_investigations.
  This allows Step 5 (Dept Processing) field values to be saved as
  a confidential internal record, separate from the customer-facing Gmail.

  Two separate outputs after this migration:
    A) Internal: dept_investigations.resolution_fields  → full payroll/provisioning details
    B) External: customer-facing Gmail                  → safe generic notification only

  Run in: Supabase Dashboard → SQL Editor
*/

-- ─── 1. Add resolution_fields (jsonb) to dept_investigations ─────────────────
-- Stores the complete Step 5 form data (pay period, issue type, corrected
-- amount, payout date, resolution summary, etc.) as structured JSON.
-- NEVER sent to the employee — internal confidential record only.

ALTER TABLE dept_investigations
  ADD COLUMN IF NOT EXISTS resolution_fields       jsonb;

ALTER TABLE dept_investigations
  ADD COLUMN IF NOT EXISTS resolution_summary_safe text;

COMMENT ON COLUMN dept_investigations.resolution_fields IS
  'Internal confidential Step 5 provisioning form data. Never sent to employee.';

COMMENT ON COLUMN dept_investigations.resolution_summary_safe IS
  'Safe high-level summary used to brief Gemini for customer email generation.';

-- ─── 2. Add internal_resolution_fields to dept_work_items (denormalised) ─────
-- Kept on the work item for fast lookup without a join.
-- Same data as dept_investigations.resolution_fields — written at completion.

ALTER TABLE dept_work_items
  ADD COLUMN IF NOT EXISTS internal_resolution_fields jsonb;

ALTER TABLE dept_work_items
  ADD COLUMN IF NOT EXISTS resolution_safe_summary    text;

COMMENT ON COLUMN dept_work_items.internal_resolution_fields IS
  'Denormalised copy of the Step 5 internal form fields. Confidential.';

COMMENT ON COLUMN dept_work_items.resolution_safe_summary IS
  'Customer-safe summary sent to Gemini for email generation.';

-- ─── 3. Verify ───────────────────────────────────────────────────────────────

SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('dept_investigations', 'dept_work_items')
  AND column_name IN (
    'resolution_fields', 'resolution_summary_safe',
    'internal_resolution_fields', 'resolution_safe_summary'
  )
ORDER BY table_name, column_name;
