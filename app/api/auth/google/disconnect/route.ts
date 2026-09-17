/**
 * POST /api/auth/google/disconnect
 *
 * Revokes the Google OAuth token and removes it from Supabase.
 * After this call, the user must re-authorize via /api/auth/google/connect.
 *
 * SERVER-SIDE ONLY — no tokens are exposed to the caller.
 */
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { revokeToken } from '@/lib/google-oauth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY in environment variables.');
  }

  return createClient(url, serviceKey, {
    auth: { persistSession: false },
  });
}

export async function POST() {
  try {
    const supabase = getServiceClient();

    // ── Fetch the refresh token (server-side only, never returned to client) ──
    const { data, error: fetchError } = await supabase
      .from('oauth_tokens')
      .select('id, refresh_token, account_email')
      .eq('provider', 'google')
      .maybeSingle();

    if (fetchError) {
      console.error('[OAuth Disconnect] DB fetch error:', fetchError);
      return NextResponse.json({ success: false, error: 'db_error' }, { status: 500 });
    }

    if (!data) {
      // Nothing to disconnect
      return NextResponse.json({ success: true, message: 'No connection found' });
    }

    // ── Revoke the token with Google (best-effort — non-fatal if it fails) ──
    try {
      await revokeToken(data.refresh_token);
      console.log(`[OAuth Disconnect] Revoked token for ${data.account_email}`);
    } catch (revokeErr) {
      console.warn('[OAuth Disconnect] Token revocation warning (continuing):', revokeErr);
    }

    // ── Delete the token row from Supabase ──────────────────────────────────
    const { error: deleteError } = await supabase
      .from('oauth_tokens')
      .delete()
      .eq('id', data.id);

    if (deleteError) {
      console.error('[OAuth Disconnect] DB delete error:', deleteError);
      return NextResponse.json({ success: false, error: 'db_delete_error' }, { status: 500 });
    }

    console.log(`[OAuth Disconnect] Successfully disconnected ${data.account_email}`);
    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('[OAuth Disconnect] Unexpected error:', err);
    return NextResponse.json(
      { success: false, error: err.message || 'unknown_error' },
      { status: 500 }
    );
  }
}
