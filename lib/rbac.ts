/**
 * lib/rbac.ts
 *
 * Module 2C — Role-Based Access Control
 *
 * Roles: employee | manager | department_staff | admin
 *
 * In single-tenant demo mode:
 *  - Role is stored in the `user_roles` table
 *  - Current user is identified by a stored email (localStorage in browser,
 *    or the connected Gmail account on the server)
 *  - Managers see only their own approval queue (filtered by manager_email)
 *  - Admins and department_staff see all approvals
 *
 * All functions are safe to call server-side (no window references).
 */

import { supabase } from './supabase';

// ─── Types ────────────────────────────────────────────────────────────────────

export type UserRole = 'employee' | 'manager' | 'department_staff' | 'admin';

export interface UserRoleRecord {
  id: string;
  email: string;
  role: UserRole;
  department: string | null;
  display_name: string | null;
  active: boolean;
}

// ─── Lookup user role by email ────────────────────────────────────────────────

/**
 * Returns the role record for a given email.
 * Returns null if the user is not in the user_roles table.
 */
export async function getUserRole(email: string): Promise<UserRoleRecord | null> {
  try {
    const { data, error } = await supabase
      .from('user_roles')
      .select('*')
      .ilike('email', email.toLowerCase().trim())
      .eq('active', true)
      .maybeSingle();

    if (error || !data) return null;
    return data as UserRoleRecord;
  } catch {
    return null;
  }
}

/**
 * Upsert a user role record.
 * Admin-only in production — not enforced here for single-tenant demo.
 */
export async function upsertUserRole(payload: {
  email: string;
  role: UserRole;
  department?: string;
  displayName?: string;
}): Promise<UserRoleRecord | null> {
  try {
    const { data, error } = await supabase
      .from('user_roles')
      .upsert({
        email: payload.email.toLowerCase().trim(),
        role: payload.role,
        department: payload.department ?? null,
        display_name: payload.displayName ?? null,
        active: true,
      }, { onConflict: 'email' })
      .select()
      .single();

    if (error || !data) return null;
    return data as UserRoleRecord;
  } catch {
    return null;
  }
}

/**
 * Get all users with manager or admin roles.
 * Used by the role management UI.
 */
export async function getAllRoles(): Promise<UserRoleRecord[]> {
  try {
    const { data, error } = await supabase
      .from('user_roles')
      .select('*')
      .order('role', { ascending: true });
    if (error || !data) return [];
    return data as UserRoleRecord[];
  } catch {
    return [];
  }
}

// ─── Connected Gmail account helper (server-side) ────────────────────────────

/**
 * Returns the email of the currently connected Gmail account
 * from the oauth_tokens table. Used on server to identify the current user.
 */
export async function getConnectedAccountEmail(): Promise<string | null> {
  try {
    const { data } = await supabase
      .from('oauth_tokens')
      .select('account_email')
      .eq('provider', 'google')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    return data?.account_email ?? null;
  } catch {
    return null;
  }
}

// ─── Permission guards ────────────────────────────────────────────────────────

export function canApprove(role: UserRole): boolean {
  return role === 'manager' || role === 'admin';
}

export function canViewAllApprovals(role: UserRole): boolean {
  return role === 'admin' || role === 'department_staff';
}

export function canManageRules(role: UserRole): boolean {
  return role === 'admin';
}

// ─── Approval queue scoping ───────────────────────────────────────────────────

/**
 * Returns the query filter for the approval queue based on role.
 * Managers see only their own approvals; admins/staff see all.
 */
export function getApprovalQueueScope(role: UserRole, userEmail: string): {
  managerEmail: string | null;
  scopeAll: boolean;
} {
  if (role === 'manager') {
    return { managerEmail: userEmail, scopeAll: false };
  }
  return { managerEmail: null, scopeAll: true };
}
