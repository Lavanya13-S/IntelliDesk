/**
 * lib/approval-service.ts
 *
 * Enterprise Approval Workflow — core service layer.
 *
 * Handles the full lifecycle:
 *   createApprovalRequest  → DB insert + audit log + Gmail notification
 *   processApprovalToken   → validate token → approve/reject → downstream actions
 *   sendApprovalEmail      → rich HTML email to manager via Gmail API
 *   sendRejectionEmail     → Gemini-generated rejection email to employee
 *   getApprovalStats       → KPI data for dashboard
 *   getApprovalQueue       → manager portal list with joins
 *
 * All manager/employee resolution is done via the org-directory service.
 * No hardcoded email addresses or department names.
 */

import { supabase } from './supabase';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { lookupEmployeeByEmail } from './org-directory';
import type { EmployeeProfile } from './types';

const APP_URL =
  typeof window !== 'undefined'
    ? window.location.origin
    : process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ApprovalRequest {
  id: string;
  ticket_id: string;
  email_id: string | null;
  employee_id: string | null;
  manager_id: string | null;
  approval_level: number;
  employee_name: string | null;
  employee_email: string | null;
  manager_name: string | null;
  manager_email: string | null;
  department: string | null;
  team_name: string | null;
  intent: string | null;
  priority: string | null;
  risk_level: string | null;
  ai_reason: string | null;
  ai_confidence: number | null;
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  comments: string | null;
  approval_token: string;
  token_expires_at: string;
  approved_at: string | null;
  approved_by: string | null;   // manager identity who approved
  rejected_at: string | null;  // timestamp of rejection
  rejected_by: string | null;  // manager identity who rejected
  created_at: string;
  updated_at: string;
}

export interface ApprovalStats {
  pending: number;
  approvedToday: number;
  rejectedToday: number;
  avgApprovalHours: number;
}

export interface ApprovalActionResult {
  success: boolean;
  approval?: ApprovalRequest;
  error?: string;
}

// ─── Create Approval Request ──────────────────────────────────────────────────

/**
 * Creates an approval request record by resolving the sender's manager
 * from the Organization Directory. Sends the approval email.
 *
 * @param ticketId      UUID of the ticket
 * @param emailId       UUID of the source email
 * @param senderEmail   Email address of the sender (employee)
 * @param decisionCtx   Context from Decision Agent (intent, priority, risk, reason, confidence)
 * @param orgProfile    Optional pre-resolved org profile (avoids double DB lookup)
 */
export async function createApprovalRequest(params: {
  ticketId: string;
  emailId: string | null;
  senderEmail: string;
  subject: string;
  body: string;
  decisionCtx: {
    intent: string;
    priority: string;
    risk: string;
    reason: string;
    confidence: number;
    department?: string;
    subteam?: string;
  };
  orgProfile?: EmployeeProfile | null;
}): Promise<ApprovalRequest | null> {
  try {
    const { ticketId, emailId, senderEmail, subject, body, decisionCtx, orgProfile } = params;

    // ── IDEMPOTENCY GATE ──────────────────────────────────────────────────────
    // Check for an existing approval by ticket_id ONLY.
    // We do NOT fall back to email_id lookup because that could return a stale
    // approval from a PREVIOUS ticket for the same email (different classification).
    // Every ticket must have its own approval scoped to the CURRENT ticketId.
    let existingAr: ApprovalRequest | null = null;

    const { data: byTicket } = await supabase
      .from('approval_requests')
      .select('*')
      .eq('ticket_id', ticketId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (byTicket) {
      existingAr = byTicket as ApprovalRequest;
    }

    if (existingAr) {
      console.log(
        `[ApprovalService] Approval already exists (${existingAr.id}, status: ${existingAr.status}) ` +
        `for ticket ${ticketId} — returning existing record without creating duplicate.`
      );
      return existingAr;
    }
    // ─────────────────────────────────────────────────────────────────────────

    // Step 1: Resolve employee org profile
    const profile = orgProfile ?? await lookupEmployeeByEmail(senderEmail);

    // Step 2: Build approval record fields
    const managerInfo = profile?.manager ?? null;
    const employeeInfo = profile
      ? {
          id: profile.id,
          name: profile.employee_name,
          email: profile.employee_email,
        }
      : { id: null, name: senderEmail.split('@')[0], email: senderEmail };

    const approvalLevel = managerInfo
      ? (profile?.approval_chain?.[0]?.approval_level ?? 1)
      : 1;

    // Step 3: Insert approval_requests row
    const { data: ar, error: arErr } = await supabase
      .from('approval_requests')
      .insert({
        ticket_id: ticketId,
        email_id: emailId,
        employee_id: employeeInfo.id,
        manager_id: managerInfo?.id ?? null,
        approval_level: approvalLevel,
        employee_name: employeeInfo.name,
        employee_email: employeeInfo.email,
        manager_name: managerInfo?.name ?? null,
        manager_email: managerInfo?.email ?? null,
        department: profile?.department?.name ?? decisionCtx.department ?? null,
        team_name: profile?.team?.name ?? decisionCtx.subteam ?? null,
        intent: decisionCtx.intent,
        priority: decisionCtx.priority,
        risk_level: decisionCtx.risk,
        ai_reason: decisionCtx.reason,
        ai_confidence: decisionCtx.confidence,
        status: 'pending',
      })
      .select()
      .single();

    if (arErr || !ar) {
      console.error('[ApprovalService] Failed to create approval_request:', arErr?.message);
      return null;
    }

    // Structured routing log — confirms the ticketId used for this approval
    console.log(
      `[ROUTING] ticketId=${ticketId} approvalId=${ar.id} ` +
      `intent="${decisionCtx.intent}" department="${decisionCtx.department ?? 'Unknown'}" ` +
      `subteam="${decisionCtx.subteam ?? 'Unknown'}" ` +
      `employee="${employeeInfo.email}" manager="${managerInfo?.email ?? 'Unassigned'}"`
    );

    // Step 4: Update ticket approval_status → pending
    await supabase
      .from('tickets')
      .update({ approval_status: 'pending' })
      .eq('id', ticketId);

    // Step 5: Audit log — created
    await logAuditEvent(ar.id, 'created', 'system');

    // Step 6: Fire in-app notification
    await supabase.from('notifications').insert({
      type: 'approval_required',
      title: 'Approval Required',
      message: `${employeeInfo.name} needs approval — ${decisionCtx.intent}. Manager: ${managerInfo?.name ?? 'Unassigned'}`,
      ticket_id: ticketId,
      email_id: emailId,
      read: false,
    });

    // Step 7: Send approval email (server-side only via API route to avoid bundling gmail-client in edge)
    if (managerInfo?.email) {
      try {
        await fetch(`${APP_URL}/api/approvals/send-email`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            approvalId: ar.id,
            managerEmail: managerInfo.email,
            managerName: managerInfo.name,
            employeeName: employeeInfo.name,
            employeeEmail: employeeInfo.email,
            department: profile?.department?.name ?? decisionCtx.department,
            designation: profile?.designation ?? '',
            subject,
            body: body.slice(0, 800),
            intent: decisionCtx.intent,
            priority: decisionCtx.priority,
            risk: decisionCtx.risk,
            reason: decisionCtx.reason,
            confidence: decisionCtx.confidence,
            token: ar.approval_token,
          }),
        });
      } catch (emailErr) {
        console.warn('[ApprovalService] Email send failed (non-fatal):', emailErr);
      }
    }

    console.log(`[ApprovalService] Created approval ${ar.id} for ticket ${ticketId}`);
    return ar as ApprovalRequest;
  } catch (err) {
    console.error('[ApprovalService] createApprovalRequest error:', err);
    return null;
  }
}

// ─── Process Token (approve / reject) ────────────────────────────────────────

/**
 * Validates an approval token and processes the action.
 * Called by the token API routes (/api/approval/[token]/approve|reject).
 */
export async function processApprovalToken(params: {
  token: string;
  action: 'approved' | 'rejected';
  comments?: string;
  ipAddress?: string;
  userAgent?: string;
}): Promise<ApprovalActionResult> {
  try {
    const { token, action, comments, ipAddress, userAgent } = params;

    // Step 1: Fetch the approval record
    const { data: ar, error } = await supabase
      .from('approval_requests')
      .select('*')
      .eq('approval_token', token)
      .maybeSingle();

    if (error || !ar) {
      return { success: false, error: 'Invalid or expired approval link.' };
    }

    // Step 2: Validate status and expiry
    if (ar.status !== 'pending') {
      return { success: false, error: `This request has already been ${ar.status}.` };
    }
    if (new Date(ar.token_expires_at) < new Date()) {
      await supabase.from('approval_requests').update({ status: 'expired' }).eq('id', ar.id);
      return { success: false, error: 'This approval link has expired (48-hour limit).' };
    }

    // Step 3: Update approval record (state machine: pending → approved|rejected only)
    const now = new Date().toISOString();
    const actorIdentity = ar.manager_email ?? ar.manager_name ?? 'manager';
    const { data: updated } = await supabase
      .from('approval_requests')
      .update({
        status: action,
        comments: comments ?? null,
        // Separate timestamps and actor fields per decision type
        ...(action === 'approved'
          ? { approved_at: now, approved_by: actorIdentity }
          : { rejected_at: now, rejected_by: actorIdentity }
        ),
      })
      .eq('id', ar.id)
      .select()
      .single();

    // Step 4: Update ticket
    await supabase
      .from('tickets')
      .update({
        approval_status: action,
        status: action === 'approved' ? 'approved' : 'rejected',
        ...(action === 'rejected' ? { resolved_at: new Date().toISOString() } : {}),
      })
      .eq('id', ar.ticket_id);

    // Step 5: Audit log — record state transition with previous/new status
    await logAuditEvent(
      ar.id,
      action,
      ar.manager_email ?? ar.manager_name ?? 'manager',
      comments,
      ipAddress,
      userAgent,
      { previous_status: 'pending', new_status: action }
    );

    // Step 6: In-app notification
    await supabase.from('notifications').insert({
      type: action === 'approved' ? 'approval_required' : 'system',
      title: action === 'approved' ? 'Request Approved ✓' : 'Request Rejected',
      message: `${ar.manager_name ?? 'Manager'} ${action} the request from ${ar.employee_name ?? ar.employee_email}`,
      ticket_id: ar.ticket_id,
      email_id: ar.email_id,
      read: false,
    });

    // Step 7: If rejected — trigger rejection email to employee
    if (action === 'rejected' && ar.employee_email) {
      try {
        await fetch(`${APP_URL}/api/approvals/send-rejection`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            approvalId: ar.id,
            employeeEmail: ar.employee_email,
            employeeName: ar.employee_name,
            managerName: ar.manager_name,
            intent: ar.intent,
            comments: comments ?? '',
          }),
        });
      } catch (e) {
        console.warn('[ApprovalService] Rejection email failed (non-fatal):', e);
      }
    }

    return { success: true, approval: updated as ApprovalRequest };
  } catch (err) {
    console.error('[ApprovalService] processApprovalToken error:', err);
    return { success: false, error: 'Internal error processing approval.' };
  }
}

// ─── Stats for Dashboard ──────────────────────────────────────────────────────

export async function getApprovalStats(managerEmail?: string): Promise<ApprovalStats> {
  try {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    let query = supabase
      .from('approval_requests')
      .select('status, approved_at, created_at');

    // Scope to manager if provided (RBAC)
    if (managerEmail) {
      query = query.ilike('manager_email', managerEmail);
    }

    const { data, error } = await query;

    if (error || !data) return { pending: 0, approvedToday: 0, rejectedToday: 0, avgApprovalHours: 0 };

    const today = todayStart.toISOString();
    const pending = data.filter((r: any) => r.status === 'pending').length;
    const approvedToday = data.filter((r: any) => r.status === 'approved' && r.approved_at >= today).length;
    const rejectedToday = data.filter((r: any) => r.status === 'rejected' && r.approved_at >= today).length;

    const resolved = data.filter((r: any) => r.approved_at && r.created_at);
    const avgMs = resolved.length > 0
      ? resolved.reduce((sum: number, r: any) =>
          sum + (new Date(r.approved_at).getTime() - new Date(r.created_at).getTime()), 0
        ) / resolved.length
      : 0;
    const avgApprovalHours = Math.round(avgMs / 3600000 * 10) / 10;

    return { pending, approvedToday, rejectedToday, avgApprovalHours };
  } catch {
    return { pending: 0, approvedToday: 0, rejectedToday: 0, avgApprovalHours: 0 };
  }
}

// ─── Queue for Manager Portal ─────────────────────────────────────────────────

export async function getApprovalQueue(filters?: {
  status?: string;
  department?: string;
  priority?: string;
  search?: string;
  managerEmail?: string;
  dateRange?: 'today' | 'week' | 'month';
}): Promise<ApprovalRequest[]> {
  try {
    let query = supabase
      .from('approval_requests')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(200);

    if (filters?.status && filters.status !== 'all') {
      query = query.eq('status', filters.status);
    }
    if (filters?.department) {
      query = query.ilike('department', `%${filters.department}%`);
    }
    if (filters?.priority) {
      query = query.eq('priority', filters.priority);
    }
    if (filters?.search) {
      query = query.or(
        `employee_name.ilike.%${filters.search}%,employee_email.ilike.%${filters.search}%,intent.ilike.%${filters.search}%`
      );
    }
    // RBAC scoping — managers see only their own approvals
    if (filters?.managerEmail) {
      query = query.ilike('manager_email', filters.managerEmail);
    }
    // Date range filter
    if (filters?.dateRange) {
      const now = new Date();
      let from: Date;
      if (filters.dateRange === 'today') {
        from = new Date(now); from.setHours(0, 0, 0, 0);
      } else if (filters.dateRange === 'week') {
        from = new Date(now); from.setDate(now.getDate() - 7);
      } else {
        from = new Date(now); from.setMonth(now.getMonth() - 1);
      }
      query = query.gte('created_at', from.toISOString());
    }

    const { data, error } = await query;
    if (error || !data) return [];
    return data as ApprovalRequest[];
  } catch {
    return [];
  }
}

// ─── Single approval by ID ────────────────────────────────────────────────────

export async function getApprovalById(id: string): Promise<ApprovalRequest | null> {
  try {
    const { data, error } = await supabase
      .from('approval_requests')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error || !data) return null;
    return data as ApprovalRequest;
  } catch {
    return null;
  }
}

// ─── Single approval WITH full ticket context ─────────────────────────────────
//
// Extends getApprovalById by also fetching the decision_logs row for the same
// ticket_id. This ensures the Approval Detail page displays the CORRECT AI
// decision, confidence, risk, escalation reason, and ai_summary — all scoped
// to the exact ticket, never from another ticket's stale rows.

export interface ApprovalWithContext {
  approval: ApprovalRequest;
  decisionLog: import('./types').DecisionLog | null;
}

export async function getApprovalWithContext(id: string): Promise<ApprovalWithContext | null> {
  try {
    // 1. Fetch the approval record
    const { data: ar, error: arErr } = await supabase
      .from('approval_requests')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (arErr || !ar) return null;

    // 2. Fetch the most recent decision_log for this ticket_id
    let decisionLog = null;
    if (ar.ticket_id) {
      const { data: dl } = await supabase
        .from('decision_logs')
        .select('*')
        .eq('ticket_id', ar.ticket_id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      decisionLog = dl ?? null;
    }

    return {
      approval:    ar as ApprovalRequest,
      decisionLog: decisionLog as import('./types').DecisionLog | null,
    };
  } catch {
    return null;
  }
}


// ─── Single approval by token ─────────────────────────────────────────────────

export async function getApprovalByToken(token: string): Promise<ApprovalRequest | null> {
  try {
    const { data, error } = await supabase
      .from('approval_requests')
      .select('*')
      .eq('approval_token', token)
      .maybeSingle();
    if (error || !data) return null;
    return data as ApprovalRequest;
  } catch {
    return null;
  }
}

// ─── Audit log helper ─────────────────────────────────────────────────────────

export async function logAuditEvent(
  approvalId: string,
  event: string,
  actor: string,
  comments?: string,
  ipAddress?: string,
  userAgent?: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  try {
    await supabase.from('approval_audit_log').insert({
      approval_id: approvalId,
      event,
      actor,
      comments: comments ?? null,
      ip_address: ipAddress ?? null,
      user_agent: userAgent ?? null,
      // Store previous_status / new_status as top-level columns if present
      previous_status: (metadata?.previous_status as string) ?? null,
      new_status: (metadata?.new_status as string) ?? null,
      // Keep full metadata blob for extensibility
      metadata: metadata ?? null,
    });
  } catch (err) {
    console.warn('[ApprovalService] audit log insert failed:', err);
  }
}

// ─── Audit log fetch ──────────────────────────────────────────────────────────

export async function getAuditLog(approvalId: string) {
  try {
    const { data } = await supabase
      .from('approval_audit_log')
      .select('*')
      .eq('approval_id', approvalId)
      .order('created_at', { ascending: true });
    return data ?? [];
  } catch {
    return [];
  }
}

// ─── Create Acceptance Approval ───────────────────────────────────────────────
//
// Called after automatic person-assignment to create a PENDING acceptance record.
// This is distinct from a manager approval — the assigned officer (e.g. Priya Nair)
// must explicitly accept before Stage 2 (Accepted) can complete.
//
// Idempotent: will not create a duplicate if a pending acceptance already exists
// for the same ticket_id.
//
// Uses supabaseAdmin (server-only) so this must only be called from API routes.


function getAdminClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

export interface CreateAcceptanceApprovalParams {
  ticketId: string;
  emailId: string | null;
  workItemId: string;
  assigneeName: string;        // e.g. "Priya Nair"
  assigneeEmail: string | null;// e.g. "priya.nair@company.com"
  assigneeEmployeeId?: string | null;
  employeeName: string | null; // e.g. "aynaval1213"
  employeeEmail: string | null;// e.g. "aynaval1213@gmail.com"
  department: string | null;
  teamName: string | null;
  intent: string | null;
  priority: string;
}

export async function createAcceptanceApproval(
  params: CreateAcceptanceApprovalParams
): Promise<ApprovalRequest | null> {
  try {
    const admin = getAdminClient();
    const {
      ticketId, emailId, assigneeName, assigneeEmail,
      employeeName, employeeEmail, department, teamName,
      intent, priority,
    } = params;

    // ── Idempotency: check for existing pending acceptance for this ticket ───
    const { data: existing } = await admin
      .from('approval_requests')
      .select('*')
      .eq('ticket_id', ticketId)
      .eq('approval_type', 'acceptance')
      .eq('status', 'pending')
      .maybeSingle();

    if (existing) {
      console.log(
        `[AcceptanceApproval] Pending acceptance already exists (${existing.id}) ` +
        `for ticket ${ticketId} — returning existing record.`
      );
      return existing as ApprovalRequest;
    }

    // Also check for an already-approved acceptance (idempotency for approved state)
    const { data: approvedExisting } = await admin
      .from('approval_requests')
      .select('id, status')
      .eq('ticket_id', ticketId)
      .eq('approval_type', 'acceptance')
      .eq('status', 'approved')
      .maybeSingle();

    if (approvedExisting) {
      console.log(
        `[AcceptanceApproval] Acceptance already APPROVED (${approvedExisting.id}) ` +
        `for ticket ${ticketId} — skipping creation.`
      );
      return null;
    }

    // ── Insert acceptance approval ────────────────────────────────────────────
    const { data: ar, error: arErr } = await admin
      .from('approval_requests')
      .insert({
        ticket_id:        ticketId,
        email_id:         emailId,
        approval_type:    'acceptance',
        employee_name:    employeeName,
        employee_email:   employeeEmail,
        manager_name:     assigneeName,   // assigned officer is the "approver"
        manager_email:    assigneeEmail,
        department,
        team_name:        teamName,
        intent,
        priority,
        status:           'pending',
        approval_level:   1,
        token_expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      })
      .select()
      .single();

    if (arErr || !ar) {
      console.error('[AcceptanceApproval] Insert failed:', arErr?.message);
      return null;
    }

    // Audit log — non-fatal
    try {
      await admin.from('approval_audit_log').insert({
        approval_id: ar.id,
        event:       'created',
        actor:       'system',
      });
    } catch { /* non-fatal */ }

    // In-app notification — non-fatal
    try {
      await admin.from('notifications').insert({
        type:      'approval_required',
        title:     'Case Acceptance Required',
        message:   `${assigneeName} — please accept the case: ${intent ?? 'Workplace Issue'}`,
        ticket_id: ticketId,
        email_id:  emailId,
        read:      false,
      });
    } catch { /* non-fatal */ }

    console.log(
      `[AcceptanceApproval] Created acceptance approval ${ar.id} ` +
      `for ticket ${ticketId} — assigned to ${assigneeName}`
    );
    return ar as ApprovalRequest;
  } catch (err) {
    console.error('[AcceptanceApproval] createAcceptanceApproval error:', err);
    return null;
  }
}

// ─── Process Acceptance (approve/reject by the assigned officer) ───────────────
//
// Called by:
//   - /api/approvals/[id]/action route (when approval_type = 'acceptance')
//   - /api/dept/[id]/action route (when action = 'accept' on the dept page)
//
// On APPROVE:
//   - approval_requests → status = 'approved'
//   - dept_work_items   → status = 'in_progress', accepted_at = now, started_at = now
//
// On REJECT:
//   - approval_requests → status = 'rejected'
//   - dept_work_items   → status = 'assigned', assigned_to = NULL (triggers reassignment)

export interface ProcessAcceptanceResult {
  success: boolean;
  approval?: ApprovalRequest;
  error?: string;
}

export async function processAcceptanceApproval(params: {
  approvalId: string;
  action: 'approved' | 'rejected';
  actorName: string;
  comments?: string;
}): Promise<ProcessAcceptanceResult> {
  try {
    const admin = getAdminClient();
    const { approvalId, action, actorName, comments } = params;
    const now = new Date().toISOString();

    // Fetch current acceptance approval
    const { data: ar, error: fetchErr } = await admin
      .from('approval_requests')
      .select('*')
      .eq('id', approvalId)
      .eq('approval_type', 'acceptance')
      .maybeSingle();

    if (fetchErr || !ar) {
      return { success: false, error: 'Acceptance approval not found.' };
    }
    if (ar.status !== 'pending') {
      return { success: false, error: `Already ${ar.status}.` };
    }

    // ── Update approval record ────────────────────────────────────────────────
    const approvalUpdate: Record<string, unknown> = {
      status:     action,
      comments:   comments ?? null,
      approved_at: now,
      updated_at:  now,
    };
    if (action === 'approved') {
      approvalUpdate.approved_by = actorName;
    } else {
      approvalUpdate.rejected_at = now;
      approvalUpdate.rejected_by = actorName;
    }

    const { data: updatedAr } = await admin
      .from('approval_requests')
      .update(approvalUpdate)
      .eq('id', approvalId)
      .eq('status', 'pending')
      .select()
      .maybeSingle();

    // ── Update dept_work_items ────────────────────────────────────────────────
    if (ar.ticket_id) {
      if (action === 'approved') {
        // Advance to in_progress — Stage 2 (Accepted) is now complete
        await admin
          .from('dept_work_items')
          .update({
            status:      'in_progress',
            accepted_at: now,
            started_at:  now,
          })
          .eq('ticket_id', ar.ticket_id)
          .in('status', ['assigned', 'accepted']);

        // Work log: accepted — non-fatal
        const { data: wi } = await admin
          .from('dept_work_items')
          .select('id')
          .eq('ticket_id', ar.ticket_id)
          .maybeSingle();

        if (wi) {
          try {
            // Idempotency: only insert if no real (non-system) acceptance log exists yet
            const { data: existingAcceptLog } = await admin
              .from('dept_work_logs')
              .select('id')
              .eq('work_item_id', wi.id)
              .eq('action', 'accepted')
              .neq('actor', 'system')
              .limit(1)
              .maybeSingle();

            if (!existingAcceptLog) {
              await admin.from('dept_work_logs').insert({
                work_item_id: wi.id,
                actor:        actorName,
                action:       'accepted',
                note:         `${actorName} accepted this case and began department processing.`,
              });
            }
          } catch { /* non-fatal */ }
        }

        // ── CRITICAL: Sync ticket workflow_stage to 'Dept Processing' ──────────
        // This is the single write that makes ALL UI components derive the correct stage.
        // We only advance — never move backward. Never touch resolved/completed tickets.
        try {
          await admin
            .from('tickets')
            .update({
              workflow_stage: 'Dept Processing',
              status:         'in_progress',
            })
            .eq('id', ar.ticket_id)
            .not('status', 'in', '(resolved,completed,customer_resolution)');
        } catch { /* non-fatal — ticket sync failure should not block acceptance */ }

        // ── Dismiss stale "Case Acceptance Required" notifications ────────────
        // Once accepted, any unread acceptance-required notification becomes stale.
        // Mark them read so they don't appear as pending actions.
        try {
          await admin
            .from('notifications')
            .update({ read: true })
            .eq('ticket_id', ar.ticket_id)
            .eq('type', 'approval_required')
            .ilike('title', '%Acceptance Required%')
            .eq('read', false);
        } catch { /* non-fatal */ }

      } else {
        // Rejected — clear assignment for reassignment
        await admin
          .from('dept_work_items')
          .update({
            status:      'assigned',
            assigned_to: null,
            accepted_at: null,
            started_at:  null,
          })
          .eq('ticket_id', ar.ticket_id)
          .in('status', ['assigned', 'accepted', 'in_progress']);

        const { data: wi } = await admin
          .from('dept_work_items')
          .select('id')
          .eq('ticket_id', ar.ticket_id)
          .maybeSingle();

        if (wi) {
          try {
            await admin.from('dept_work_logs').insert({
              work_item_id: wi.id,
              actor:        actorName,
              action:       'commented',
              note:         `${actorName} declined this case. Ticket returned to queue for reassignment.`,
            });
          } catch { /* non-fatal */ }
        }
      }
    }

    // Audit log — non-fatal
    try {
      await admin.from('approval_audit_log').insert({
        approval_id:     approvalId,
        event:           action,
        actor:           actorName,
        comments:        comments ?? null,
        previous_status: 'pending',
        new_status:      action,
      });
    } catch { /* non-fatal */ }

    // In-app notification — non-fatal
    try {
      await admin.from('notifications').insert({
        type:      action === 'approved' ? 'approval_required' : 'system',
        title:     action === 'approved' ? `✓ Case Accepted` : `✗ Case Declined`,
        message:   `${actorName} ${action === 'approved' ? 'accepted' : 'declined'} the case: ${ar.intent ?? 'ticket'}`,
        ticket_id: ar.ticket_id,
        email_id:  ar.email_id,
        read:      false,
      });
    } catch { /* non-fatal */ }

    return { success: true, approval: updatedAr as ApprovalRequest };
  } catch (err) {
    console.error('[AcceptanceApproval] processAcceptanceApproval error:', err);
    return { success: false, error: 'Internal error processing acceptance.' };
  }
}
