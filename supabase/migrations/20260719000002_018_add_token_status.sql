-- =============================================================================
-- Migration: 018 - Add token_status to oauth_tokens
-- =============================================================================
-- Problem: Migration 017 (20260719000001_017_oauth_token_status.sql) was written
-- but NEVER executed against the live Supabase database, causing:
--
--   [Gmail] Failed to load tokens from DB:
--   column oauth_tokens.token_status does not exist
--
-- This migration is IDEMPOTENT (safe to run multiple times):
--   - ADD COLUMN IF NOT EXISTS  -> no error if column already exists
--   - UPDATE backfill           -> harmless if all rows already have a value
--
-- HOW TO APPLY:
--   1. Open https://supabase.com/dashboard/project/hayazylykiujdvgnbafk
--   2. Go to SQL Editor
--   3. Paste this entire file and click "Run"
-- =============================================================================

-- Step 1: Add the column (no-op if it already exists)
ALTER TABLE public.oauth_tokens
  ADD COLUMN IF NOT EXISTS token_status text NOT NULL DEFAULT 'active';

-- Step 2: Apply the CHECK constraint
--   (Uses a separate DO block so it does not fail if the constraint already exists)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM   pg_constraint
    WHERE  conname = 'oauth_tokens_token_status_check'
      AND  conrelid = 'public.oauth_tokens'::regclass
  ) THEN
    ALTER TABLE public.oauth_tokens
      ADD CONSTRAINT oauth_tokens_token_status_check
      CHECK (token_status IN ('active', 'expired', 'revoked'));
  END IF;
END $$;

-- Step 3: Backfill any existing rows that may have NULL (edge case safety net)
UPDATE public.oauth_tokens
SET    token_status = 'active'
WHERE  token_status IS NULL;

-- Step 4: Document the column
COMMENT ON COLUMN public.oauth_tokens.token_status IS
  'active   = tokens are valid and usable | expired  = refresh token rejected by Google (invalid_grant) | revoked = user manually disconnected';

-- =============================================================================
-- Verification query (run this after applying to confirm success):
-- =============================================================================
-- SELECT column_name, data_type, column_default, is_nullable
-- FROM   information_schema.columns
-- WHERE  table_name = 'oauth_tokens'
-- ORDER  BY ordinal_position;
--
-- Expected row for token_status:
--   column_name  | data_type | column_default | is_nullable
--   token_status | text      | 'active'::text | NO
-- =============================================================================
