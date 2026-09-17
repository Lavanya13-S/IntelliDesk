-- Migration: 017 - OAuth token status column
-- Adds a `token_status` column to oauth_tokens so the server can mark
-- a connection as expired (e.g. invalid_grant) without deleting the row.
-- The UI reads this column via the /api/auth/google/status endpoint.

ALTER TABLE public.oauth_tokens
  ADD COLUMN IF NOT EXISTS token_status text NOT NULL DEFAULT 'active'
    CHECK (token_status IN ('active', 'expired', 'revoked'));

COMMENT ON COLUMN public.oauth_tokens.token_status IS
  'active = tokens are valid | expired = refresh token rejected by Google (invalid_grant) | revoked = user manually revoked';
