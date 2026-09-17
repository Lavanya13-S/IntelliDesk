/**
 * lib/org-directory.ts
 *
 * Enterprise Organization Directory — data-driven routing service.
 *
 * All agents (Decision, Department, Routing, Approval) call functions from
 * this module to resolve employee context instead of using hardcoded strings.
 *
 * Primary entry point: lookupEmployeeByEmail(email)
 * Returns a fully-enriched EmployeeProfile with dept, team, manager, dept-head,
 * and the complete approval chain — ready to inject into any AI prompt.
 */

import { supabase } from './supabase';
import type {
  Department,
  Team,
  Employee,
  OrgManager,
  ApprovalChainEntry,
  EmployeeProfile,
} from './types';

// ─── Internal helpers ─────────────────────────────────────────────────────────

/** Normalise email for case-insensitive lookup */
const norm = (email: string) => email.toLowerCase().trim();

// ─── Core lookup: employee by email ──────────────────────────────────────────

/**
 * Looks up an employee by their email address and returns a fully enriched
 * EmployeeProfile — department, team, direct manager, department head, and
 * the complete approval chain.
 *
 * Returns null if the email is not found in the organization directory.
 */
export async function lookupEmployeeByEmail(
  email: string
): Promise<EmployeeProfile | null> {
  try {
    // Step 1: Find the employee record
    const { data: emp, error: empErr } = await supabase
      .from('employees')
      .select('*')
      .ilike('employee_email', norm(email))
      .maybeSingle();

    if (empErr || !emp) return null;

    // Step 2: Fetch dept, team, manager in parallel
    const [deptRes, teamRes, mgrRes] = await Promise.all([
      emp.department_id
        ? supabase.from('departments').select('*').eq('id', emp.department_id).maybeSingle()
        : Promise.resolve({ data: null, error: null }),

      emp.team_id
        ? supabase.from('teams').select('*').eq('id', emp.team_id).maybeSingle()
        : Promise.resolve({ data: null, error: null }),

      emp.manager_id
        ? supabase.from('employees').select('id, employee_name, employee_email, designation').eq('id', emp.manager_id).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);

    const dept: Department | null = deptRes.data;
    const team: Team | null = teamRes.data;
    const mgrEmp = mgrRes.data;

    // Step 3: Fetch manager capability (approval level)
    let mgrCapability: OrgManager | null = null;
    if (mgrEmp) {
      const { data: mc } = await supabase
        .from('managers')
        .select('*')
        .eq('employee_id', mgrEmp.id)
        .maybeSingle();
      mgrCapability = mc;
    }

    // Step 4: Department head
    let deptHead: { id: string; name: string; email: string; designation: string } | null = null;
    if (dept?.head_employee_id) {
      const { data: hd } = await supabase
        .from('employees')
        .select('id, employee_name, employee_email, designation')
        .eq('id', dept.head_employee_id)
        .maybeSingle();
      if (hd) {
        deptHead = {
          id: hd.id,
          name: hd.employee_name,
          email: hd.employee_email,
          designation: hd.designation,
        };
      }
    }

    // Step 5: Approval chain for this employee's team
    const chain = await getApprovalChain(emp.department_id, emp.team_id);

    const profile: EmployeeProfile = {
      id: emp.id,
      employee_id: emp.employee_id,
      employee_name: emp.employee_name,
      employee_email: emp.employee_email,
      designation: emp.designation,
      employment_status: emp.employment_status,
      location: emp.location,
      phone: emp.phone,

      department: dept
        ? { id: dept.id, name: dept.department_name, code: dept.department_code, sla_hours: dept.sla_hours }
        : null,

      team: team
        ? { id: team.id, name: team.team_name, code: team.team_code }
        : null,

      manager: mgrEmp
        ? {
            id: mgrEmp.id,
            name: mgrEmp.employee_name,
            email: mgrEmp.employee_email,
            designation: mgrEmp.designation,
            approval_level: mgrCapability?.approval_level ?? 1,
          }
        : null,

      department_head: deptHead,
      approval_chain: chain,
    };

    return profile;
  } catch (err) {
    console.error('[OrgDirectory] lookupEmployeeByEmail failed:', err);
    return null;
  }
}

// ─── Approval chain for a dept/team ──────────────────────────────────────────

/**
 * Returns the ordered approval chain for a given department and team.
 * Level 1 = direct approver, Level 2 = secondary, etc.
 */
export async function getApprovalChain(
  departmentId: string | null,
  teamId: string | null
): Promise<ApprovalChainEntry[]> {
  if (!departmentId) return [];

  try {
    // Build query — try team-specific first, fall back to dept-wide
    let query = supabase
      .from('approval_hierarchy')
      .select('level, approver_employee_id')
      .eq('department_id', departmentId)
      .order('level', { ascending: true });

    if (teamId) {
      query = query.eq('team_id', teamId);
    }

    const { data: hierRows, error } = await query;
    if (error || !hierRows || hierRows.length === 0) return [];

    // Fetch all approver details in one query
    const approverIds = hierRows.map((r: any) => r.approver_employee_id);
    const { data: approverEmps } = await supabase
      .from('employees')
      .select('id, employee_name, employee_email, designation')
      .in('id', approverIds);

    const { data: approverMgrs } = await supabase
      .from('managers')
      .select('employee_id, approval_level, can_approve_finance, can_approve_it, can_approve_hr')
      .in('employee_id', approverIds);

    const empMap = new Map((approverEmps ?? []).map((e: any) => [e.id, e]));
    const mgrMap = new Map((approverMgrs ?? []).map((m: any) => [m.employee_id, m]));

    return hierRows
      .map((row: any) => {
        const e = empMap.get(row.approver_employee_id);
        const m = mgrMap.get(row.approver_employee_id);
        if (!e) return null;
        return {
          level: row.level,
          approver_id: e.id,
          approver_name: e.employee_name,
          approver_email: e.employee_email,
          approver_designation: e.designation,
          approval_level: m?.approval_level ?? 1,
          can_approve_finance: m?.can_approve_finance ?? false,
          can_approve_it: m?.can_approve_it ?? false,
          can_approve_hr: m?.can_approve_hr ?? false,
        } satisfies ApprovalChainEntry;
      })
      .filter(Boolean) as ApprovalChainEntry[];
  } catch (err) {
    console.error('[OrgDirectory] getApprovalChain failed:', err);
    return [];
  }
}

// ─── Directory-wide queries ───────────────────────────────────────────────────

export async function getAllDepartments(): Promise<Department[]> {
  try {
    const { data, error } = await supabase
      .from('departments')
      .select('*')
      .order('department_name');
    if (error || !data) return [];
    return data as Department[];
  } catch {
    return [];
  }
}

export async function getAllTeams(): Promise<(Team & { department_name?: string })[]> {
  try {
    const { data, error } = await supabase
      .from('teams')
      .select(`*, departments(department_name)`)
      .order('team_name');
    if (error || !data) return [];
    return data.map((t: any) => ({
      ...t,
      department_name: t.departments?.department_name ?? '',
    }));
  } catch {
    return [];
  }
}

export async function getAllEmployees(): Promise<
  (Employee & { department_name?: string; team_name?: string; manager_name?: string })[]
> {
  try {
    const { data, error } = await supabase
      .from('employees')
      .select(`
        *,
        departments(department_name),
        teams(team_name),
        manager:manager_id(employee_name)
      `)
      .order('employee_name');
    if (error || !data) return [];
    return data.map((e: any) => ({
      ...e,
      department_name: e.departments?.department_name ?? '',
      team_name: e.teams?.team_name ?? '',
      manager_name: e.manager?.employee_name ?? '',
    }));
  } catch {
    return [];
  }
}

export async function getAllManagers(): Promise<
  (OrgManager & { employee_name?: string; employee_email?: string; designation?: string; department_name?: string })[]
> {
  try {
    const { data, error } = await supabase
      .from('managers')
      .select(`
        *,
        employees(employee_name, employee_email, designation, departments(department_name))
      `)
      .order('approval_level', { ascending: false });
    if (error || !data) return [];
    return data.map((m: any) => ({
      ...m,
      employee_name: m.employees?.employee_name ?? '',
      employee_email: m.employees?.employee_email ?? '',
      designation: m.employees?.designation ?? '',
      department_name: m.employees?.departments?.department_name ?? '',
    }));
  } catch {
    return [];
  }
}

export async function searchEmployees(query: string): Promise<
  (Employee & { department_name?: string; team_name?: string; manager_name?: string })[]
> {
  if (!query.trim()) return getAllEmployees();
  try {
    const q = query.trim().toLowerCase();
    const { data, error } = await supabase
      .from('employees')
      .select(`
        *,
        departments(department_name),
        teams(team_name),
        manager:manager_id(employee_name)
      `)
      .or(`employee_name.ilike.%${q}%,employee_email.ilike.%${q}%,designation.ilike.%${q}%`)
      .order('employee_name')
      .limit(50);
    if (error || !data) return [];
    return data.map((e: any) => ({
      ...e,
      department_name: e.departments?.department_name ?? '',
      team_name: e.teams?.team_name ?? '',
      manager_name: e.manager?.employee_name ?? '',
    }));
  } catch {
    return [];
  }
}

// ─── Build org-context string for AI prompts ──────────────────────────────────

/**
 * Formats an EmployeeProfile into a compact context block
 * suitable for injection into any AI agent prompt.
 *
 * Example output:
 *   EMPLOYEE CONTEXT (Organization Directory):
 *   - Name: Sarah Johnson
 *   - Designation: Senior Financial Analyst
 *   - Department: Finance (FIN) | SLA: 12h
 *   - Team: Finance Transformation (FIN-FT)
 *   - Direct Manager: Arjun Menon <arjun.menon@company.com> [Approval Level 3]
 *   - Department Head: Arun Kumar <arun.kumar@company.com> [CFO]
 *   - Approval Chain: Level 1 → Arjun Menon | Level 2 → Arun Kumar
 */
export function buildOrgContextPrompt(profile: EmployeeProfile | null): string {
  if (!profile) return '';

  const chain = profile.approval_chain
    .map((a) => `Level ${a.level} → ${a.approver_name} (${a.approver_designation})`)
    .join(' | ');

  return [
    'EMPLOYEE CONTEXT (Organization Directory):',
    `- Name: ${profile.employee_name}`,
    `- Designation: ${profile.designation}`,
    `- Status: ${profile.employment_status}`,
    profile.department
      ? `- Department: ${profile.department.name} (${profile.department.code}) | SLA: ${profile.department.sla_hours}h`
      : '- Department: Unknown',
    profile.team
      ? `- Team: ${profile.team.name} (${profile.team.code})`
      : '',
    profile.manager
      ? `- Direct Manager: ${profile.manager.name} <${profile.manager.email}> [Approval Level ${profile.manager.approval_level}]`
      : '- Direct Manager: Not assigned',
    profile.department_head
      ? `- Department Head: ${profile.department_head.name} <${profile.department_head.email}> [${profile.department_head.designation}]`
      : '',
    chain
      ? `- Approval Chain: ${chain}`
      : '',
  ]
    .filter(Boolean)
    .join('\n');
}
