import { NextRequest, NextResponse } from 'next/server';

/**
 * middleware.ts
 *
 * NOTE: Supabase JS v2 (createClient) stores the session in browser localStorage,
 * NOT in HTTP cookies. This means middleware running on the server can never read
 * the Supabase auth token — any cookie-based session check here will always fail
 * and redirect every authenticated user back to /login (redirect loop).
 *
 * Auth protection is handled client-side:
 *   - Each protected page calls supabase.auth.getUser() on mount
 *   - Unauthenticated users are redirected to /auth/login from the page itself
 *   - The login page redirects via window.location.href (full reload) so the
 *     session is live in localStorage before the next page initialises
 *
 * This middleware is kept as a pass-through so Next.js routing works normally.
 * If you need SSR-based auth in future, install @supabase/ssr and use
 * createServerClient with cookie persistence.
 */

export function middleware(_req: NextRequest) {
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
