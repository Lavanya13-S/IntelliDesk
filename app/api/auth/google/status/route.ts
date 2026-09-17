/**
 * GET /api/auth/google/status
 *
 * Returns the current Gmail/Google connection status for the frontend.
 *
 * Response shapes:
 *   { connected: true,  email: "...", tokenStatus: "active"  }
 *   { connected: true,  email: "...", tokenStatus: "expired" }  ← needs reconnect
 *   { connected: false }
 *   { connected: false, error: "configuration_error", details: "..." }
 *
 * IMPORTANT: This endpoint NEVER returns token values.
 * It only returns whether a token exists, the associated email, and the token_status.
 */
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    return null;
  }

  return createClient(url, serviceKey, {
    auth: { persistSession: false },
  });
}

export async function GET() {
  // ── Check env vars ────────────────────────────────────────────────────────
  const missingVars: string[] = [];
  if (!process.env.GOOGLE_CLIENT_ID) missingVars.push('GOOGLE_CLIENT_ID');
  if (!process.env.GOOGLE_CLIENT_SECRET) missingVars.push('GOOGLE_CLIENT_SECRET');
  if (!process.env.NEXT_PUBLIC_APP_URL) missingVars.push('NEXT_PUBLIC_APP_URL');
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) missingVars.push('SUPABASE_SERVICE_ROLE_KEY');

  if (missingVars.length > 0) {
    return NextResponse.json({
      connected: false,
      error: 'configuration_error',
      missingVars,
      details:
        `The following environment variables are required but missing:\n` +
        missingVars.map((v) => `  • ${v}`).join('\n'),
    });
  }

  const supabase = getServiceClient();
  if (!supabase) {
    return NextResponse.json({ connected: false });
  }

  try {
    // Only select non-sensitive columns — never select refresh_token or access_token
    const { data, error } = await supabase
      .from('oauth_tokens')
      .select('account_email, token_expiry, token_status, scopes, updated_at')
      .eq('provider', 'google')
      .maybeSingle();

    if (error) {
      console.error('[OAuth Status] DB error:', error);
      return NextResponse.json({ connected: false });
    }

    if (!data) {
      return NextResponse.json({ connected: false });
    }

    const tokenStatus: string = (data as any).token_status ?? 'active';

    return NextResponse.json({
      connected: true,
      email: data.account_email,
      scopes: data.scopes,
      connectedAt: data.updated_at,
      tokenExpiry: data.token_expiry,
      // "active" = healthy  |  "expired" = invalid_grant — must reconnect
      tokenStatus,
    });
  } catch (err: any) {
    console.error('[OAuth Status] Unexpected error:', err);
    return NextResponse.json({ connected: false });
  }
}
