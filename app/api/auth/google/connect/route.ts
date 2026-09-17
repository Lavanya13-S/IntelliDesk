/**
 * GET /api/auth/google/connect
 *
 * Generates a CSRF-safe state token, stores it in an HTTP-only cookie,
 * then redirects the browser to Google's OAuth consent screen.
 *
 * This route is SERVER-SIDE ONLY. No tokens are ever passed to the client.
 */
import { NextResponse } from 'next/server';
import { buildAuthorizationUrl, requireGoogleOAuthEnv } from '@/lib/google-oauth';
import { randomBytes } from 'crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  // ── Validate env vars before doing anything ─────────────────────────────
  try {
    requireGoogleOAuthEnv();
  } catch (err: any) {
    return NextResponse.json(
      {
        error: 'configuration_error',
        message: err.message,
      },
      { status: 500 }
    );
  }

  // ── Generate CSRF state token ────────────────────────────────────────────
  const state = randomBytes(32).toString('hex');
  const authUrl = buildAuthorizationUrl(state);

  // ── Redirect to Google with state in HTTP-only cookie ───────────────────
  const response = NextResponse.redirect(authUrl);
  response.cookies.set('oauth_state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 10, // 10 minutes — long enough to complete OAuth flow
    path: '/',
  });

  return response;
}
