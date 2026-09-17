/**
 * lib/google-oauth.ts
 *
 * Server-side helper for Google OAuth 2.0.
 * All functions in this file run EXCLUSIVELY on the server (API routes).
 * Tokens are NEVER returned to or stored on the client.
 */

export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/calendar.events',
  'email',   // needed to retrieve the connected account email
  'profile',
];

export const OAUTH_CALLBACK_PATH = '/api/auth/google/callback';

/** Validate that all required env vars exist and throw a descriptive error if not. */
export function requireGoogleOAuthEnv(): {
  clientId: string;
  clientSecret: string;
  appUrl: string;
} {
  const missing: string[] = [];

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;

  if (!clientId) missing.push('GOOGLE_CLIENT_ID');
  if (!clientSecret) missing.push('GOOGLE_CLIENT_SECRET');
  if (!appUrl) missing.push('NEXT_PUBLIC_APP_URL');

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables for Google OAuth:\n\n` +
      missing.map((v) => `  • ${v}`).join('\n') +
      `\n\nAdd them to your .env file:\n` +
      `  GOOGLE_CLIENT_ID=<your_client_id>\n` +
      `  GOOGLE_CLIENT_SECRET=<your_client_secret>\n` +
      `  NEXT_PUBLIC_APP_URL=http://localhost:3000\n\n` +
      `Get credentials at: https://console.cloud.google.com/apis/credentials`
    );
  }

  return { clientId: clientId!, clientSecret: clientSecret!, appUrl: appUrl! };
}

/** Build the full redirect URI based on the app URL env var. */
export function getRedirectUri(appUrl: string): string {
  return `${appUrl}${OAUTH_CALLBACK_PATH}`;
}

/** Generate the Google OAuth 2.0 authorization URL. */
export function buildAuthorizationUrl(state: string): string {
  const { clientId, appUrl } = requireGoogleOAuthEnv();
  const redirectUri = getRedirectUri(appUrl);

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GOOGLE_SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    state,
    login_hint: 'intellidesk.support@gmail.com',
  });

  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export interface GoogleTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
  scope: string;
  id_token?: string;
}

/** Exchange an authorization code for access + refresh tokens (server-side only). */
export async function exchangeCodeForTokens(code: string): Promise<GoogleTokenResponse> {
  const { clientId, clientSecret, appUrl } = requireGoogleOAuthEnv();
  const redirectUri = getRedirectUri(appUrl);

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Google token exchange failed (${res.status}): ${body}`);
  }

  return res.json() as Promise<GoogleTokenResponse>;
}

/** Fetch the email address associated with the access token. */
export async function fetchGoogleUserEmail(accessToken: string): Promise<string> {
  const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch Google user info (${res.status})`);
  }

  const data = await res.json();
  return data.email as string;
}

/** Revoke a refresh token with Google (called on disconnect). */
export async function revokeToken(token: string): Promise<void> {
  await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  // Revocation errors are non-fatal — we still delete from our DB
}
