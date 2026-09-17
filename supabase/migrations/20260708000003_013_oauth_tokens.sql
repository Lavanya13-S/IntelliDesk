-- Migration: 013 - OAuth Tokens
-- Stores server-side OAuth refresh tokens for Google integrations.
-- Tokens are NEVER exposed to the frontend; all reads happen server-side only.

CREATE TABLE IF NOT EXISTS public.oauth_tokens (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider       text NOT NULL DEFAULT 'google',
  account_email  text NOT NULL,
  -- Encrypted at rest by Supabase (pgcrypto / column-level encryption can be added later)
  refresh_token  text NOT NULL,
  access_token   text,
  token_expiry   timestamptz,
  scopes         text[],
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT oauth_tokens_provider_email_unique UNIQUE (provider, account_email)
);

-- Prevent any SELECT / INSERT / UPDATE / DELETE from anonymous (browser) clients.
-- Only service_role (server-side API routes) can access this table.
ALTER TABLE public.oauth_tokens ENABLE ROW LEVEL SECURITY;

-- Explicitly deny all operations from the anon/authenticated roles.
-- Server-side code uses the SUPABASE_SERVICE_ROLE_KEY which bypasses RLS.
CREATE POLICY "no_anon_access" ON public.oauth_tokens
  FOR ALL TO anon, authenticated
  USING (false)
  WITH CHECK (false);

-- Auto-update updated_at on row changes
CREATE OR REPLACE FUNCTION public.set_oauth_tokens_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_oauth_tokens_updated_at
  BEFORE UPDATE ON public.oauth_tokens
  FOR EACH ROW EXECUTE FUNCTION public.set_oauth_tokens_updated_at();
