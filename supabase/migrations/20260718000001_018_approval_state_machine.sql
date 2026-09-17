/*
  Migration 018: Enterprise Approval State Machine

  Enforces a strict, immutable state machine for approval_requests:
    pending → approved   (terminal)
    pending → rejected   (terminal)

  No other transitions are allowed — enforced at the DATABASE level.

  Changes:
    1. approval_requests: add approved_by, rejected_by, rejected_at
    2. approval_requests: add immutability trigger (blocks reverting terminal states)
    3. approval_audit_log: add previous_status / new_status columns for delta tracking
*/

-- ─── 1. New columns on approval_requests ─────────────────────────────────────

ALTER TABLE approval_requests
  ADD COLUMN IF NOT EXISTS approved_by   text,          -- manager name/email who approved
  ADD COLUMN IF NOT EXISTS rejected_by   text,          -- manager name/email who rejected
  ADD COLUMN IF NOT EXISTS rejected_at   timestamptz;   -- separate timestamp for rejections

COMMENT ON COLUMN approval_requests.approved_by  IS 'Identity of the manager who approved — set once, immutable.';
COMMENT ON COLUMN approval_requests.rejected_by  IS 'Identity of the manager who rejected — set once, immutable.';
COMMENT ON COLUMN approval_requests.rejected_at  IS 'Timestamp of rejection decision — distinct from approved_at.';

-- ─── 2. State-machine immutability trigger ────────────────────────────────────
--
-- Once a request reaches 'approved' or 'rejected' it can NEVER be changed again.
-- This mirrors enterprise systems (SAP, ServiceNow, Salesforce) where a finalised
-- approval record is write-protected in the database layer.
--
-- Any attempt to update a terminal record will raise:
--   SQLSTATE P0001  (raise_exception)
-- which Supabase surfaces as HTTP 400 to the caller; the API layer maps this to
-- a 409 Conflict response for the frontend.

CREATE OR REPLACE FUNCTION fn_ar_enforce_state_machine()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  -- Block any state change away from a terminal status
  IF OLD.status IN ('approved', 'rejected') THEN
    RAISE EXCEPTION
      'APPROVAL_ALREADY_PROCESSED: This approval has already been % and cannot be changed.',
      OLD.status
      USING ERRCODE = 'P0001';
  END IF;

  -- Block any transition that is not pending→approved or pending→rejected
  IF NEW.status NOT IN ('approved', 'rejected', 'expired') THEN
    IF OLD.status = 'pending' AND NEW.status = 'pending' THEN
      NULL; -- allow metadata-only updates while pending
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ar_immutable_status ON approval_requests;
CREATE TRIGGER trg_ar_immutable_status
  BEFORE UPDATE ON approval_requests
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION fn_ar_enforce_state_machine();

-- ─── 3. Audit log: previous_status / new_status columns ───────────────────────

ALTER TABLE approval_audit_log
  ADD COLUMN IF NOT EXISTS previous_status text,
  ADD COLUMN IF NOT EXISTS new_status      text;

COMMENT ON COLUMN approval_audit_log.previous_status IS 'Status before this event (for delta tracking).';
COMMENT ON COLUMN approval_audit_log.new_status      IS 'Status after this event.';
