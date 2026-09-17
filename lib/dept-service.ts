/**
 * lib/dept-service.ts
 *
 * Department Processing Workspace — core service layer.
 *
 * Enterprise 7-stage workflow:
 *   assigned → accepted → in_progress → [waiting] → customer_resolution → completed
 *   (quality_check is a parallel QV path, still supported)
 *
 * Functions:
 *   createWorkItem      — idempotent; deduplicates by approval_id AND ticket_id
 *   getWorkQueue        — filtered queue list
 *   getDeptStats        — KPI data (live counts)
 *   getWorkItem         — single item with email/ticket/approval/logs
 *   executeAction       — state machine transitions + automatic work logs
 *   getSlaHours         — priority → hours lookup
 */

import { createClient } from '@supabase/supabase-js';
import type { DeptWorkItem, DeptWorkLog, DeptStats, DeptLogAction, DeptWorkStatus } from './types';
// NOTE: createAcceptanceApproval is imported lazily inside createWorkItem
// to avoid a circular dependency issue between dept-service ↔ approval-service.


// ── Supabase admin client (service-role bypasses RLS) ─────────────────────────
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

// ── SLA hours lookup ──────────────────────────────────────────────────────────

const DEFAULT_SLA: Record<string, number> = {
  critical: 2,
  high:     4,
  medium:   8,
  low:      24,
};

export async function getSlaHours(priority: string): Promise<number> {
  const { data } = await supabaseAdmin
    .from('dept_sla_config')
    .select('sla_hours')
    .eq('priority', priority)
    .maybeSingle();
  return data?.sla_hours ?? DEFAULT_SLA[priority] ?? 8;
}

// ── Create Work Item ──────────────────────────────────────────────────────────

export interface CreateWorkItemInput {
  approval_id:    string;
  ticket_id:      string | null;
  email_id:       string | null;
  department:     string | null;
  team_name:      string | null;
  employee_name:  string | null;
  employee_email: string | null;
  intent:         string | null;
  priority:       string;
}

// ── Resolved Assignee Result ─────────────────────────────────────────────────

export interface ResolvedAssignee {
  employee_id: string;   // employees.id (UUID)
  employee_name: string;
  employee_email: string;
  designation: string;
}

/**
 * resolveAssignee
 *
 * Data-driven, priority-aware assignee resolution from org directory.
 *
 * Strategy:
 *   1. Match the target team by name (fuzzy) within the target department.
 *   2. Fetch all ACTIVE employees in that team.
 *   3. For CRITICAL / HIGH priority → prefer team manager, then most senior member.
 *   4. For MEDIUM / LOW priority → prefer a non-manager active member (load balance),
 *      fallback to team manager.
 *   5. If no team match, fall back to department head.
 *   6. Returns null only if no eligible active person exists.
 *
 * Never hardcodes employee names or department→person mappings.
 */
export async function resolveAssignee(
  teamName: string | null,
  department: string | null,
  priority: string = 'medium'
): Promise<ResolvedAssignee | null> {
  const isCriticalOrHigh = ['critical', 'high'].includes((priority || 'medium').toLowerCase());

  // ── STEP 1: Resolve department record ────────────────────────────────────
  let deptId: string | null = null;
  let deptHeadId: string | null = null;

  if (department) {
    const { data: deptRow } = await supabaseAdmin
      .from('departments')
      .select('id, head_employee_id')
      .or(`department_name.ilike.%${department.trim()}%,department_code.ilike.${department.trim()}%`)
      .maybeSingle();
    if (deptRow) {
      deptId = deptRow.id;
      deptHeadId = deptRow.head_employee_id ?? null;
    }
  }

  // ── STEP 2: Find the team ─────────────────────────────────────────────────
  let teamId: string | null = null;
  let teamManagerId: string | null = null;

  if (teamName) {
    let teamQuery = supabaseAdmin
      .from('teams')
      .select('id, manager_id')
      .ilike('team_name', `%${teamName.trim()}%`);
    if (deptId) teamQuery = teamQuery.eq('department_id', deptId);

    const { data: teamRow } = await teamQuery.maybeSingle();
    if (teamRow) {
      teamId = teamRow.id;
      teamManagerId = teamRow.manager_id ?? null;
    }
  }

  // ── STEP 3: Load all ACTIVE employees in this team ────────────────────────
  let candidates: Array<{ id: string; employee_name: string; employee_email: string; designation: string }> = [];

  if (teamId) {
    const { data: members } = await supabaseAdmin
      .from('employees')
      .select('id, employee_name, employee_email, designation')
      .eq('team_id', teamId)
      .eq('employment_status', 'active');
    candidates = (members ?? []) as typeof candidates;
  }

  // ── STEP 4: Pick the best candidate based on priority ─────────────────────

  if (candidates.length > 0) {
    // Identify the team manager among candidates
    const managerCandidate = teamManagerId
      ? candidates.find(c => c.id === teamManagerId) ?? null
      : null;
    const nonManagerCandidates = candidates.filter(c => c.id !== teamManagerId);

    let chosen: typeof candidates[0] | null = null;

    if (isCriticalOrHigh) {
      // CRITICAL / HIGH: prefer the team manager (senior); fallback to first active member
      chosen = managerCandidate ?? nonManagerCandidates[0] ?? null;
    } else {
      // MEDIUM / LOW: prefer a non-manager team member (distribute load); fallback to manager
      chosen = nonManagerCandidates[0] ?? managerCandidate ?? null;
    }

    if (chosen) {
      return {
        employee_id:    chosen.id,
        employee_name:  chosen.employee_name,
        employee_email: chosen.employee_email,
        designation:    chosen.designation,
      };
    }
  }

  // ── STEP 5: No team match — fall back to department head ──────────────────
  if (deptHeadId) {
    const { data: head } = await supabaseAdmin
      .from('employees')
      .select('id, employee_name, employee_email, designation')
      .eq('id', deptHeadId)
      .eq('employment_status', 'active')
      .maybeSingle();
    if (head) {
      return {
        employee_id:    head.id,
        employee_name:  head.employee_name,
        employee_email: head.employee_email,
        designation:    head.designation,
      };
    }
  }

  // No eligible person found
  console.warn(
    `[dept-service] resolveAssignee: no active eligible employee found for ` +
    `department="${department}" team="${teamName}" priority="${priority}"`
  );
  return null;
}

/**
 * repairUnassignedItem
 *
 * Resolves the correct assignee for a work item that currently has
 * assigned_to = NULL and updates the row + adds a work log entry.
 * Used by the repair-assignments route and the backfill route.
 *
 * Returns true if an assignee was found and persisted.
 */
export async function repairUnassignedItem(
  workItemId: string,
  department: string | null,
  teamName: string | null,
  priority: string
): Promise<{ repaired: boolean; assignee: ResolvedAssignee | null }> {
  const assignee = await resolveAssignee(teamName, department, priority);
  if (!assignee) return { repaired: false, assignee: null };

  const now = new Date().toISOString();

  // Build update payload — try with assigned_employee_id first, fall back if column missing
  const updatePayload: Record<string, any> = {
    assigned_to:          assignee.employee_name,
    assigned_employee_id: assignee.employee_id,
    assigned_at:          now,
  };

  const { error } = await supabaseAdmin
    .from('dept_work_items')
    .update(updatePayload)
    .eq('id', workItemId)
    .is('assigned_to', null);   // safety: only update truly unassigned rows

  if (error) {
    const isColumnMissing =
      error.message?.includes('assigned_employee_id') || error.code === '42703';

    if (isColumnMissing) {
      // Retry without FK column (migration 036 not yet applied)
      const { assigned_employee_id: _drop, ...payloadWithoutFk } = updatePayload;
      const { error: retryErr } = await supabaseAdmin
        .from('dept_work_items')
        .update(payloadWithoutFk)
        .eq('id', workItemId)
        .is('assigned_to', null);
      if (retryErr) {
        console.error(`[dept-service] repairUnassignedItem retry failed for ${workItemId}:`, retryErr.message);
        return { repaired: false, assignee };
      }
    } else {
      console.error(`[dept-service] repairUnassignedItem update failed for ${workItemId}:`, error.message);
      return { repaired: false, assignee };
    }
  }


  // Work log — 'assigned' action
  await supabaseAdmin.from('dept_work_logs').insert({
    work_item_id: workItemId,
    actor:        'system',
    action:       'assigned',
    note:
      `Automatically assigned to ${assignee.employee_name} (${assignee.employee_email}) ` +
      `by system. Department: ${department ?? 'Unknown'}, Team: ${teamName ?? 'Unknown'}, ` +
      `Priority: ${priority}. Designation: ${assignee.designation}.`,
  });

  return { repaired: true, assignee };
}

export async function createWorkItem(input: CreateWorkItemInput): Promise<DeptWorkItem | null> {
  // ── Duplicate protection: check by approval_id (primary) ─────────────────
  const { data: byApproval } = await supabaseAdmin
    .from('dept_work_items')
    .select('id')
    .eq('approval_id', input.approval_id)
    .maybeSingle();
  if (byApproval) return null;

  // ── Duplicate protection: check by ticket_id (secondary) ──────────────────
  // Prevents a second entry if the same ticket gets re-approved somehow.
  if (input.ticket_id) {
    const { data: byTicket } = await supabaseAdmin
      .from('dept_work_items')
      .select('id')
      .eq('ticket_id', input.ticket_id)
      .maybeSingle();
    if (byTicket) return null;
  }

  // ── Resolve the correct assignee from org directory ──────────────────────
  const assignee = await resolveAssignee(input.team_name, input.department, input.priority);
  const now2 = new Date().toISOString();

  const slaHours = await getSlaHours(input.priority);
  const slaDeadline = new Date(Date.now() + slaHours * 60 * 60 * 1000).toISOString();

  // ── Build insert payload — omit assigned_employee_id if column not yet in DB ──
  const insertPayload: Record<string, any> = {
    approval_id:    input.approval_id,
    ticket_id:      input.ticket_id,
    email_id:       input.email_id,
    department:     input.department,
    team_name:      input.team_name,
    employee_name:  input.employee_name,
    employee_email: input.employee_email,
    intent:         input.intent,
    priority:       input.priority || 'medium',
    status:         'assigned',
    assigned_to:    assignee?.employee_name ?? null,
    assigned_at:    assignee ? now2 : null,
    sla_deadline:   slaDeadline,
  };

  // Include FK column only when migration 036 has been applied
  if (assignee?.employee_id) {
    insertPayload.assigned_employee_id = assignee.employee_id;
  }


  let item: any = null;

  // First attempt — with assigned_employee_id if present
  const { data: firstData, error: firstError } = await supabaseAdmin
    .from('dept_work_items')
    .insert(insertPayload)
    .select()
    .single();

  if (firstError) {
    // If the failure is because assigned_employee_id column doesn't exist yet,
    // retry without it so the work item is still created correctly.
    const isColumnMissing =
      firstError.message?.includes('assigned_employee_id') ||
      firstError.code === '42703';

    if (isColumnMissing && insertPayload.assigned_employee_id !== undefined) {
      console.warn('[dept-service] assigned_employee_id column not found — retrying without it (run migration 036 to add it)');
      const { assigned_employee_id: _drop, ...payloadWithoutFk } = insertPayload;
      const { data: retryData, error: retryError } = await supabaseAdmin
        .from('dept_work_items')
        .insert(payloadWithoutFk)
        .select()
        .single();
      if (retryError) {
        console.error('[dept-service] createWorkItem retry error:', retryError.message);
        return null;
      }
      item = retryData;
    } else {
      console.error('[dept-service] createWorkItem error:', firstError.message);
      return null;
    }
  } else {
    item = firstData;
  }

  // Automatic work log — "created"
  await supabaseAdmin.from('dept_work_logs').insert({
    work_item_id: item.id,
    actor:        'system',
    action:       'created',
    note:         `Ticket routed to ${input.department ?? 'department'} queue after manager approval.`,
  });

  // Automatic work log — "assigned" (only when an assignee was resolved)
  if (assignee) {
    await supabaseAdmin.from('dept_work_logs').insert({
      work_item_id: item.id,
      actor:        'system',
      action:       'assigned',
      note:
        `Automatically assigned to ${assignee.employee_name} (${assignee.employee_email}) ` +
        `by system. Department: ${input.department ?? 'Unknown'}, ` +
        `Team: ${input.team_name ?? 'Unknown'}, Priority: ${input.priority}. ` +
        `Designation: ${assignee.designation}.`,
    });

    // Create a REAL pending acceptance approval in the DB (not just a log comment).
    // This is what makes the Approval Portal show Pending=1.
    // Lazy import to avoid circular dependency.
    try {
      const { createAcceptanceApproval } = await import('./approval-service');
      await createAcceptanceApproval({
        ticketId:      input.ticket_id ?? '',
        emailId:       input.email_id ?? null,
        workItemId:    item.id,
        assigneeName:  assignee.employee_name,
        assigneeEmail: assignee.employee_email ?? null,
        employeeName:  input.employee_name ?? null,
        employeeEmail: input.employee_email ?? null,
        department:    input.department ?? null,
        teamName:      input.team_name ?? null,
        intent:        input.intent ?? null,
        priority:      input.priority,
      });
    } catch (accErr: any) {
      console.warn('[dept-service] createAcceptanceApproval (non-fatal):', accErr?.message);
    }
  } else {
    console.warn(
      `[dept-service] createWorkItem: no eligible assignee found for ` +
      `dept="${input.department}" team="${input.team_name}" priority="${input.priority}". ` +
      `Work item ${item.id} left unassigned for manual assignment.`
    );
  }

  return item as DeptWorkItem;
}

// ── Queue Filters ─────────────────────────────────────────────────────────────

export interface QueueFilters {
  department?:   string;
  status?:       string;
  priority?:     string;
  assignedTo?:   string;
  search?:       string;
  ticketId?:     string;
  dateRange?:    'today' | 'week' | 'month';
  limit?:        number;
  offset?:       number;
}

export async function getWorkQueue(filters: QueueFilters = {}): Promise<DeptWorkItem[]> {
  let query = supabaseAdmin
    .from('dept_work_items')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(filters.limit ?? 100);

  if (filters.department)  query = query.ilike('department',   `%${filters.department}%`);
  if (filters.status)      query = query.eq('status',         filters.status);
  if (filters.priority)    query = query.eq('priority',       filters.priority);
  if (filters.assignedTo)  query = query.ilike('assigned_to', `%${filters.assignedTo}%`);
  if (filters.ticketId)    query = query.eq('ticket_id',      filters.ticketId);

  if (filters.search) {
    query = query.or(
      `employee_name.ilike.%${filters.search}%,` +
      `employee_email.ilike.%${filters.search}%,` +
      `department.ilike.%${filters.search}%,` +
      `intent.ilike.%${filters.search}%`
    );
  }

  if (filters.dateRange) {
    const now = new Date();
    let from: string;
    if (filters.dateRange === 'today') {
      from = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    } else if (filters.dateRange === 'week') {
      from = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    } else {
      from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    }
    query = query.gte('created_at', from);
  }

  const { data, error } = await query;
  if (error) {
    console.error('[dept-service] getWorkQueue error:', error.message);
    return [];
  }
  return (data ?? []) as DeptWorkItem[];
}

// ── Department Stats ──────────────────────────────────────────────────────────

export async function getDeptStats(department?: string): Promise<DeptStats> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayIso = today.toISOString();

  let baseQuery = supabaseAdmin.from('dept_work_items').select('*');
  if (department) baseQuery = baseQuery.ilike('department', `%${department}%`);

  const { data: all } = await baseQuery;
  const items = (all ?? []) as DeptWorkItem[];

  const assignedToday  = items.filter(i => i.created_at >= todayIso).length;
  const open           = items.filter(i => i.status === 'assigned' || i.status === 'accepted').length;
  const inProgress     = items.filter(i => i.status === 'in_progress' || i.status === 'waiting' || i.status === 'customer_resolution').length;
  const qualityCheck   = items.filter(i => i.status === 'quality_check').length;
  const completedToday = items.filter(i => i.status === 'completed' && i.completed_at && i.completed_at >= todayIso).length;
  const slaBreached    = items.filter(i => i.sla_breached && i.status !== 'completed').length;

  const resolved = items.filter(i => i.status === 'completed' && i.completed_at && i.started_at);
  const avgResolutionHours = resolved.length > 0
    ? resolved.reduce((acc, i) => {
        const ms = new Date(i.completed_at!).getTime() - new Date(i.started_at!).getTime();
        return acc + ms / (1000 * 60 * 60);
      }, 0) / resolved.length
    : 0;

  return { assignedToday, open, inProgress, qualityCheck, completedToday, slaBreached, avgResolutionHours };
}

// ── Single Work Item with context ─────────────────────────────────────────────

export interface WorkItemDetail {
  item:               DeptWorkItem;
  logs:               DeptWorkLog[];
  email:              Record<string, any> | null;
  ticket:             Record<string, any> | null;
  approval:           Record<string, any> | null;  // manager approval
  acceptanceApproval: Record<string, any> | null;  // pending acceptance by assigned officer
}

export async function getWorkItem(id: string): Promise<WorkItemDetail | null> {
  const { data: item, error } = await supabaseAdmin
    .from('dept_work_items')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error || !item) return null;

  const { data: logs } = await supabaseAdmin
    .from('dept_work_logs')
    .select('*')
    .eq('work_item_id', id)
    .order('created_at', { ascending: true });

  let email = null;
  if (item.email_id) {
    const { data } = await supabaseAdmin.from('emails').select('*').eq('id', item.email_id).maybeSingle();
    email = data;
  }

  let ticket = null;
  if (item.ticket_id) {
    const { data } = await supabaseAdmin.from('tickets').select('*').eq('id', item.ticket_id).maybeSingle();
    ticket = data;
  }

  let approval = null;
  if (item.approval_id) {
    const { data } = await supabaseAdmin.from('approval_requests').select('*').eq('id', item.approval_id).maybeSingle();
    approval = data;
  }

  // Fetch the pending acceptance approval for this ticket (type='acceptance', status='pending')
  // This is what powers the Approval Portal Pending count and the Accept button on the dept page.
  let acceptanceApproval = null;
  if (item.ticket_id) {
    const { data: acc } = await supabaseAdmin
      .from('approval_requests')
      .select('*')
      .eq('ticket_id', item.ticket_id)
      .eq('approval_type', 'acceptance')
      .in('status', ['pending', 'approved'])  // show even if already approved
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    acceptanceApproval = acc ?? null;
  }

  return {
    item:               item as DeptWorkItem,
    logs:               (logs ?? []) as DeptWorkLog[],
    email,
    ticket,
    approval,
    acceptanceApproval,
  };
}

// ── Enterprise State Machine ──────────────────────────────────────────────────
//
//  assigned ──► accepted ──► in_progress ──► quality_check ──► completed
//                                  ▲               │
//                                  │    (returned)  │
//                              waiting ◄────────────┘
//                              (waiting for employee reply)

export type WorkAction =
  | 'accept'                   // assigned          → accepted           (Assign to Me)
  | 'start'                    // accepted          → in_progress        (Start Work)
  | 'request_info'             // in_progress       → waiting            (Request More Info)
  | 'resume'                   // waiting           → in_progress        (Resume / Employee Replied)
  | 'complete_dept_processing' // in_progress       → customer_resolution (Complete Dept Processing)
  | 'submit_for_review'        // in_progress       → quality_check      (→ QV path)
  | 'verify_approve'           // quality_check     → completed
  | 'verify_return'            // quality_check     → in_progress        (Return for Rework)
  | 'escalate'                 // any               → in_progress        (escalation note)
  | 'comment'                  // any               → same               (add work log note)
  | 'reassign';                // any               → assigned           (reassign to another)

export interface ActionInput {
  action:      WorkAction;
  actor:       string;
  note?:       string;
  reassignTo?: string;
}

// Map action → next status (undefined = no status change)
const ACTION_STATUS_MAP: Partial<Record<WorkAction, DeptWorkStatus>> = {
  // accept: the dept-page "Accept & Begin Processing" button
  //   - If a pending acceptance approval exists → the API route will call processAcceptanceApproval
  //     which sets status=in_progress and accepted_at.
  //   - If no acceptance approval exists (self-assign path) → go directly to in_progress here.
  //   Either way the DB ends up in_progress once accepted_at is set.
  accept:                    'in_progress',
  start:                     'in_progress',
  request_info:              'waiting',
  resume:                    'in_progress',
  complete_dept_processing:  'customer_resolution',
  submit_for_review:         'quality_check',
  verify_approve:            'completed',
  verify_return:             'in_progress',
  reassign:                  'assigned',
  // escalate, comment — no status change
};

// Map action → log entry action text
const ACTION_LOG_MAP: Record<WorkAction, DeptLogAction> = {
  accept:                    'accepted',
  start:                     'started',
  request_info:              'waiting',
  resume:                    'resumed',
  complete_dept_processing:  'dept_processing_complete',
  submit_for_review:         'submitted_for_review',
  verify_approve:            'verified',
  verify_return:             'returned',
  escalate:                  'escalated',
  comment:                   'commented',
  reassign:                  'reassigned',
};

// Auto-generated log note templates
function autoNote(action: WorkAction, actor: string, extra?: string): string {
  switch (action) {
    case 'accept':                    return `${actor} accepted and began processing this ticket.`;
    case 'start':                     return `${actor} started work.`;
    case 'request_info':              return extra ?? `${actor} requested more information from employee.`;
    case 'resume':                    return `${actor} resumed work.`;
    case 'complete_dept_processing':  return `${actor} completed department processing. Advancing to Customer Resolution.`;
    case 'submit_for_review':         return `${actor} submitted work for quality verification.`;
    case 'verify_approve':            return `Quality verified. ${actor} marked this ticket as completed.`;
    case 'verify_return':             return `${actor} returned ticket for rework: ${extra ?? 'see comments'}`;
    case 'escalate':                  return extra ?? `${actor} escalated this ticket.`;
    case 'comment':                   return extra ?? '';
    case 'reassign':                  return `${actor} reassigned ticket to ${extra ?? 'another engineer'}.`;
  }
}

export async function executeAction(
  workItemId: string,
  input: ActionInput
): Promise<{ success: boolean; item?: DeptWorkItem; error?: string }> {
  const { data: current, error: fetchErr } = await supabaseAdmin
    .from('dept_work_items')
    .select('*')
    .eq('id', workItemId)
    .maybeSingle();

  if (fetchErr || !current) return { success: false, error: 'Work item not found' };

  // Guard: nothing can act on a completed item except comment
  if (current.status === 'completed' && input.action !== 'comment') {
    return { success: false, error: 'Work item is already completed' };
  }

  // Guard: complete_dept_processing valid only after the ticket has been accepted.
  // 'assigned' is explicitly excluded — the officer must accept first.
  // Escalated tickets that are already in_progress may proceed directly.
  const COMPLETABLE_STATUSES = ['accepted', 'in_progress', 'waiting', 'escalated'];
  if (input.action === 'complete_dept_processing' && !COMPLETABLE_STATUSES.includes(current.status)) {
    return { success: false, error: `Cannot complete dept processing from status: ${current.status}. Please accept the ticket first.` };
  }
  console.log(`[DEPT_COMPLETE] workItemId=${workItemId} action=${input.action} fromStatus=${current.status} actor=${input.actor}`);

  const now = new Date().toISOString();
  const newStatus  = ACTION_STATUS_MAP[input.action];
  const logAction  = ACTION_LOG_MAP[input.action];
  const note       = input.note || autoNote(input.action, input.actor, input.note);

  // Build DB update payload
  const updatePayload: Record<string, any> = {};
  if (newStatus) updatePayload.status = newStatus;

  switch (input.action) {
    case 'accept':
      // The dept-page "Accept & Begin Processing" button:
      // Sets accepted_at + started_at and advances to in_progress.
      // IMPORTANT: do NOT overwrite assigned_to if already set by the auto-assignment system.
      // Only self-assign when the ticket was previously unassigned.
      updatePayload.accepted_at = now;
      updatePayload.started_at  = now;
      if (!current.assigned_to) updatePayload.assigned_to = input.actor;
      break;
    case 'start':
      updatePayload.started_at   = now;
      if (!current.assigned_to)  updatePayload.assigned_to = input.actor;
      break;
    case 'complete_dept_processing':
      // If ticket was never explicitly started (escalated direct path), set started_at now
      if (!current.started_at) updatePayload.started_at = now;
      // If unassigned, set the actor as the completing officer
      if (!current.assigned_to) updatePayload.assigned_to = input.actor;
      break;
    case 'verify_approve':
      updatePayload.completed_at = now;
      break;
    case 'reassign':
      updatePayload.assigned_to  = input.reassignTo ?? input.actor;
      updatePayload.assigned_at  = now;
      updatePayload.accepted_at  = null;  // reset — new assignee needs to accept
      break;
  }

  // Persist state change
  if (Object.keys(updatePayload).length > 0) {
    const { error: updateErr } = await supabaseAdmin
      .from('dept_work_items')
      .update(updatePayload)
      .eq('id', workItemId);
    if (updateErr) return { success: false, error: updateErr.message };
  }

  // Automatic work log entry
  await supabaseAdmin.from('dept_work_logs').insert({
    work_item_id: workItemId,
    actor:        input.actor,
    action:       logAction,
    note,
  });

  // Return updated item
  const { data: updated } = await supabaseAdmin
    .from('dept_work_items').select('*').eq('id', workItemId).maybeSingle();

  return { success: true, item: updated as DeptWorkItem };
}
