/**
 * lib/auth.ts
 *
 * Supabase Auth helpers and RBAC utilities.
 * All role checks use the existing user_roles table.
 *
 * Roles (from migration 017):
 *   employee         → can submit tickets, track status
 *   manager          → can approve/reject
 *   department_staff → engineer: full app access
 *   admin            → full access
 */

import { supabase } from './supabase';

export type AppRole = 'employee' | 'manager' | 'department_staff' | 'admin';

export interface UserProfile {
  id:          string;
  email:       string;
  role:        AppRole;
  displayName: string;
  department:  string | null;
}

// ── Current session ────────────────────────────────────────────────────────────

export async function getCurrentUser() {
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return null;
  return user;
}

// ── Full profile (auth user + role from user_roles table) ─────────────────────

export async function getCurrentProfile(): Promise<UserProfile | null> {
  const user = await getCurrentUser();
  if (!user?.email) return null;

  const { data: roleRow } = await supabase
    .from('user_roles')
    .select('role, display_name, department')
    .eq('email', user.email)
    .maybeSingle();

  return {
    id:          user.id,
    email:       user.email,
    role:        (roleRow?.role as AppRole) || 'employee',
    displayName: roleRow?.display_name || user.email.split('@')[0],
    department:  roleRow?.department   || null,
  };
}

// ── Role checks ───────────────────────────────────────────────────────────────

export function isEngineer(role: AppRole)  { return role === 'department_staff' || role === 'admin'; }
export function isManager(role: AppRole)   { return role === 'manager'          || role === 'admin'; }
export function isEmployee(role: AppRole)  { return role === 'employee'; }
export function isAdmin(role: AppRole)     { return role === 'admin'; }

/** Returns the default redirect path for each role after login */
export function getRoleHome(role: AppRole): string {
  switch (role) {
    case 'employee':         return '/dashboard';
    case 'manager':          return '/approvals';
    case 'department_staff': return '/dashboard';
    case 'admin':            return '/dashboard';
    default:                 return '/dashboard';
  }
}

/** Pages each role can access (used by middleware) */
export const ROLE_ALLOWED_PREFIXES: Record<AppRole, string[]> = {
  employee:         ['/employee', '/auth', '/dashboard'],
  manager:          ['/approvals', '/approval', '/auth', '/dashboard'],
  department_staff: ['/dashboard', '/inbox', '/department', '/knowledge', '/analytics', '/settings', '/validation', '/approvals', '/approval', '/org', '/auth'],
  admin:            ['/'],  // full access
};
