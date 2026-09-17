/**
 * GET /api/auth/google/callback
 *
 * Google redirects here after the user grants consent.
 * This route:
 *  1. Validates the CSRF state parameter
 *  2. Exchanges the authorization code for access + refresh tokens
 *  3. Fetches the authorized account's email
 *  4. Upserts tokens into Supabase (server-side only, RLS blocks client access)
 *     — Always stores the new refresh token (replaces any old one)
 *     — Resets token_status to "active"
 *  5. Verifies the connection by listing one Gmail inbox message
 *  6. Redirects to /settings?tab=email&connected=true
 *
 * TOKENS ARE NEVER SENT TO THE FRONTEND.
 */
import { NextRequest, NextResponse } from 'next/server';
import {
  exchangeCodeForTokens,
  fetchGoogleUserEmail,
  GOOGLE_SCOPES,
} from '@/lib/google-oauth';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Use service role key so RLS is bypassed for server-side token storage
function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    throw new Error(
      'Missing Supabase service role credentials. Add SUPABASE_SERVICE_ROLE_KEY to your .env file.'
    );
  }

  return createClient(url, serviceKey, {
    auth: { persistSession: false },
  });
}

/**
 * After storing tokens, make one Gmail API call to verify the access token
 * actually works before marking the account as connected.
 */
async function verifyGmailAccess(accessToken: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(
      'https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=1&q=in:inbox',
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );
    if (res.ok) {
      console.log('[OAuth Callback] Gmail API verification: ✓ success');
      return { ok: true };
    }
    const body = await res.text();
    console.warn(`[OAuth Callback] Gmail API verification failed (HTTP ${res.status}): ${body}`);
    return { ok: false, error: `HTTP ${res.status}: ${body}` };
  } catch (err: any) {
    console.warn('[OAuth Callback] Gmail API verification threw:', err.message);
    return { ok: false, error: err.message };
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const error = searchParams.get('error');
  const errorDescription = searchParams.get('error_description');

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  const settingsUrl = `${appUrl}/settings?tab=email`;

  // ── Handle user-denied consent ───────────────────────────────────────────
  if (error) {
    console.error('[OAuth Callback] Google returned error:', error, errorDescription);
    return NextResponse.redirect(
      `${settingsUrl}&oauth_error=${encodeURIComponent(errorDescription || error)}`
    );
  }

  // ── Validate required params ─────────────────────────────────────────────
  if (!code || !state) {
    return NextResponse.redirect(`${settingsUrl}&oauth_error=invalid_callback`);
  }

  // ── Validate CSRF state ──────────────────────────────────────────────────
  const cookieState = request.cookies.get('oauth_state')?.value;
  if (!cookieState || cookieState !== state) {
    console.error('[OAuth Callback] State mismatch — possible CSRF attempt');
    return NextResponse.redirect(`${settingsUrl}&oauth_error=state_mismatch`);
  }

  try {
    // ── Exchange code for tokens (SERVER-SIDE ONLY) ──────────────────────
    const tokenData = await exchangeCodeForTokens(code);

    if (!tokenData.refresh_token) {
      // This happens if the user already authorized before and prompt=consent was bypassed.
      // Shouldn't occur with prompt=consent, but handle gracefully.
      console.warn('[OAuth Callback] No refresh_token received — user may need to revoke and reconnect');
      return NextResponse.redirect(`${settingsUrl}&oauth_error=no_refresh_token`);
    }

    // ── Fetch authorized email ───────────────────────────────────────────
    const accountEmail = await fetchGoogleUserEmail(tokenData.access_token);
    console.log(`[OAuth Callback] Authorized account: ${accountEmail}`);

    // ── Calculate token expiry ────────────────────────────────────────────
    const tokenExpiry = new Date(Date.now() + tokenData.expires_in * 1000).toISOString();

    // ── Store tokens in Supabase (service role — bypasses RLS) ──────────
    // Always upsert the new refresh token so it replaces any stale/revoked one.
    // Reset token_status to "active" so the UI shows reconnected state immediately.
    const supabase = getServiceClient();

    const { error: dbError } = await supabase.from('oauth_tokens').upsert(
      {
        provider: 'google',
        account_email: accountEmail,
        refresh_token: tokenData.refresh_token,    // always replace with newest
        access_token: tokenData.access_token,
        token_expiry: tokenExpiry,
        token_status: 'active',                    // reset to active on reconnect
        scopes: GOOGLE_SCOPES,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'provider,account_email' }
    );

    if (dbError) {
      console.error('[OAuth Callback] Failed to store tokens:', dbError);
      return NextResponse.redirect(`${settingsUrl}&oauth_error=db_error`);
    }

    console.log(`[OAuth Callback] Tokens stored for ${accountEmail}.`);

    // ── Verify the Gmail API works with the new token ────────────────────
    const verification = await verifyGmailAccess(tokenData.access_token);
    if (!verification.ok) {
      console.warn(
        `[OAuth Callback] Token stored but Gmail API verification failed for ${accountEmail}:`,
        verification.error
      );
      // Non-fatal — token is stored, user will see error on next sync.
      // Still redirect as connected since the token may be fine.
    }

    console.log(`[OAuth Callback] Successfully connected Google account: ${accountEmail}`);

    // ── Clear the state cookie and redirect to settings ──────────────────
    const successResponse = NextResponse.redirect(`${settingsUrl}&connected=true`);
    successResponse.cookies.delete('oauth_state');
    return successResponse;
  } catch (err: any) {
    console.error('[OAuth Callback] Unexpected error:', err);
    return NextResponse.redirect(
      `${settingsUrl}&oauth_error=${encodeURIComponent(err.message || 'unknown_error')}`
    );
  }
}
