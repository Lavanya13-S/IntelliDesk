/**
 * POST /api/dept/escalate
 *
 * Atomically escalates a ticket by:
 *   1. Updating the ticket status → 'escalated'
 *   2. Looking up the team manager from the org directory (teams + employees)
 *   3. Creating a dept_work_items row (status='escalated', approval_id=null initially)
 *   4. Creating an approval_request (status='pending') so the escalation
 *      appears on the Approvals page for manager review
 *   5. Linking the approval_request to the dept_work_item (approval_id)
 *   6. Writing an audit log entry
 *   7. Inserting a notification
 *
 * Why approval_request is created here:
 *   Escalated tickets must go through the manager approval flow before being
 *   formally assigned to a department officer. Without an approval_request row,
 *   the Approvals page shows Pending=0 and the ticket is stuck as unassigned.
 *
 * Returns: { workItemId, approvalId, ticketId, managerName, managerEmail }
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

// SLA hours by priority
const SLA_HOURS: Record<string, number> = { critical: 2, high: 4, medium: 8, low: 24 };

// ── Resolve team manager from org directory ────────────────────────────────────
// Looks up: teams.team_name (case-insensitive) → teams.manager_id → employees
// Falls back to department head if no team manager found.
async function resolveTeamManager(teamName: string | null, department: string | null): Promise<{
  managerId:    string | null;
  managerName:  string | null;
  managerEmail: string | null;
}> {
  const FALLBACK = { managerId: null, managerName: null, managerEmail: null };
  if (!teamName && !department) return FALLBACK;

  // Try team-level lookup first
  if (teamName) {
    const { data: team } = await supabaseAdmin
      .from('teams')
      .select('manager_id')
      .ilike('team_name', teamName.trim())
      .maybeSingle();

    if (team?.manager_id) {
      const { data: emp } = await supabaseAdmin
        .from('employees')
        .select('id, employee_name, employee_email')
        .eq('id', team.manager_id)
        .maybeSingle();

      if (emp) {
        return {
          managerId:    emp.id,
          managerName:  emp.employee_name,
          managerEmail: emp.employee_email,
        };
      }
    }
  }

  // Fallback: department head
  if (department) {
    const { data: dept } = await supabaseAdmin
      .from('departments')
      .select('head_employee_id')
      .ilike('department_name', department.trim())
      .maybeSingle();

    if (dept?.head_employee_id) {
      const { data: emp } = await supabaseAdmin
        .from('employees')
        .select('id, employee_name, employee_email')
        .eq('id', dept.head_employee_id)
        .maybeSingle();

      if (emp) {
        return {
          managerId:    emp.id,
          managerName:  emp.employee_name,
          managerEmail: emp.employee_email,
        };
      }
    }
  }

  return FALLBACK;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      ticketId,
      emailId,
      department,
      subteam,
      risk,
      reason,
      subject,
      employeeName,
      employeeEmail,
      intent,
      priority: rawPriority,
    } = body;

    if (!ticketId) {
      return NextResponse.json({ error: 'ticketId is required' }, { status: 400 });
    }

    // Derive escalation priority
    const priority: 'critical' | 'high' | 'medium' | 'low' =
      risk === 'Critical' ? 'critical'
      : risk === 'High'   ? 'high'
      : (['critical','high','medium','low'].includes(rawPriority) ? rawPriority : 'high');

    // ── Step 0: Idempotency — if work item already exists, return it ─────────
    const { data: existing } = await supabaseAdmin
      .from('dept_work_items')
      .select('id, approval_id')
      .eq('ticket_id', ticketId)
      .maybeSingle();

    if (existing) {
      // If a work item exists but no approval record, create the approval now
      if (!existing.approval_id) {
        const manager = await resolveTeamManager(subteam, department);
        await ensureApprovalRecord({
          workItemId: existing.id, ticketId, emailId,
          department, subteam, employeeName, employeeEmail,
          intent, priority, risk, reason,
          managerId: manager.managerId, managerName: manager.managerName, managerEmail: manager.managerEmail,
        });
      }
      console.log('[escalate] work item already exists:', existing.id);
      return NextResponse.json({ workItemId: existing.id, ticketId, duplicate: true });
    }

    // ── Step 1: Resolve team manager from org directory ───────────────────────
    const manager = await resolveTeamManager(subteam, department);
    console.log(`[escalate] resolved manager: ${manager.managerName} (${manager.managerEmail}) for team=${subteam} dept=${department}`);

    // ── Step 2: Update ticket to escalated ───────────────────────────────────
    const { error: ticketErr } = await supabaseAdmin
      .from('tickets')
      .update({
        status:          'escalated',
        approval_status: 'pending',
        department:      department || null,
        subteam:         subteam    || null,
        priority,
      })
      .eq('id', ticketId);

    if (ticketErr) {
      console.error('[escalate] ticket update failed:', ticketErr);
      return NextResponse.json(
        { error: `Failed to update ticket: ${ticketErr.message}` },
        { status: 500 }
      );
    }

    // ── Step 3: Create dept_work_items row ────────────────────────────────────
    const slaHours = SLA_HOURS[priority] ?? 4;
    const slaDeadline = new Date(Date.now() + slaHours * 3_600_000).toISOString();

    const { data: workItem, error: wiErr } = await supabaseAdmin
      .from('dept_work_items')
      .insert({
        approval_id:    null,          // Linked after approval_request is created below
        ticket_id:      ticketId,
        email_id:       emailId       || null,
        department:     department    || null,
        team_name:      subteam       || null,
        employee_name:  employeeName  || null,
        employee_email: employeeEmail || null,
        intent:         intent        || null,
        priority,
        status:         'escalated',
        sla_deadline:   slaDeadline,
        sla_breached:   false,
      })
      .select()
      .single();

    if (wiErr || !workItem) {
      // Race condition: another request created it
      if (wiErr?.code === '23505') {
        const { data: raceWI } = await supabaseAdmin
          .from('dept_work_items').select('*').eq('ticket_id', ticketId).maybeSingle();
        if (raceWI) return NextResponse.json({ workItemId: raceWI.id, ticketId, duplicate: true });
      }
      console.error('[escalate] dept_work_items insert failed:', wiErr);
      await supabaseAdmin.from('tickets').update({ status: 'open', approval_status: 'none' }).eq('id', ticketId);
      return NextResponse.json({ error: `Failed to create work item: ${wiErr?.message}` }, { status: 500 });
    }

    // ── Step 4: Create approval_request so escalation appears in Approvals page
    const approvalId = await ensureApprovalRecord({
      workItemId: workItem.id, ticketId, emailId,
      department, subteam, employeeName, employeeEmail,
      intent, priority, risk, reason,
      managerId: manager.managerId, managerName: manager.managerName, managerEmail: manager.managerEmail,
    });

    // ── Step 5: Write escalation fields (migration 029 columns) ──────────────
    await supabaseAdmin
      .from('dept_work_items')
      .update({ escalated_from_ticket_id: ticketId })
      .eq('id', workItem.id)
      .then(({ error }) => {
        if (error) console.warn('[escalate] escalated_from_ticket_id update skipped:', error.message);
      });

    // ── Step 6: Write audit log ───────────────────────────────────────────────
    await supabaseAdmin.from('dept_work_logs').insert({
      work_item_id: workItem.id,
      actor:        'system',
      action:       'escalated',
      note:         `Ticket escalated to ${department ?? 'department'}${subteam ? ` — ${subteam}` : ''} with ${priority} priority. Approval pending from ${manager.managerName ?? 'manager'}. ${reason ?? ''}`.trim(),
    });

    // ── Step 7: Insert notification ───────────────────────────────────────────
    const notifRow = {
      type:              'critical' as const,
      title:             `🚨 Escalated — ${risk ?? priority} Priority`,
      message:           `"${subject ?? 'Ticket'}" escalated to ${department ?? 'Department'}${subteam ? ` — ${subteam}` : ''}. Pending approval from ${manager.managerName ?? 'manager'}.`.trim(),
      ticket_id:         ticketId,
      email_id:          emailId || null,
      dept_work_item_id: workItem.id,
      read:              false,
    };

    const { error: notifErr } = await supabaseAdmin.from('notifications').insert(notifRow);
    if (notifErr) {
      // dept_work_item_id column missing — insert without it
      await supabaseAdmin.from('notifications').insert({
        type: 'critical', title: notifRow.title, message: notifRow.message,
        ticket_id: ticketId, email_id: emailId || null, read: false,
      });
    }

    console.log(
      `[ESCALATION] ticketId=${ticketId} workItemId=${workItem.id} approvalId=${approvalId}` +
      ` department=${department} team=${subteam} manager=${manager.managerName} status=escalated`
    );

    return NextResponse.json({
      workItemId:   workItem.id,
      approvalId:   approvalId,
      managerName:  manager.managerName,
      managerEmail: manager.managerEmail,
      ticketId,
      duplicate:    false,
    });

  } catch (err: any) {
    console.error('[POST /api/dept/escalate] unhandled error:', err);
    return NextResponse.json({ error: err.message ?? 'Internal server error' }, { status: 500 });
  }
}

// ── Helper: create approval_request and link it to the work item ──────────────
async function ensureApprovalRecord(opts: {
  workItemId:   string;
  ticketId:     string;
  emailId?:     string | null;
  department?:  string | null;
  subteam?:     string | null;
  employeeName?: string | null;
  employeeEmail?: string | null;
  intent?:      string | null;
  priority:     string;
  risk?:        string | null;
  reason?:      string | null;
  managerId?:   string | null;
  managerName?: string | null;
  managerEmail?:string | null;
}): Promise<string | null> {
  try {
    // Check if approval already exists for this ticket
    const { data: existing } = await supabaseAdmin
      .from('approval_requests')
      .select('id')
      .eq('ticket_id', opts.ticketId)
      .maybeSingle();

    if (existing) {
      // Link existing approval to the work item if not already linked
      await supabaseAdmin
        .from('dept_work_items')
        .update({ approval_id: existing.id })
        .eq('id', opts.workItemId);
      return existing.id;
    }

    const { data: approval, error } = await supabaseAdmin
      .from('approval_requests')
      .insert({
        ticket_id:     opts.ticketId,
        email_id:      opts.emailId   || null,
        manager_id:    opts.managerId || null,
        employee_name: opts.employeeName  || null,
        employee_email:opts.employeeEmail || null,
        manager_name:  opts.managerName   || null,
        manager_email: opts.managerEmail  || null,
        department:    opts.department    || null,
        team_name:     opts.subteam       || null,
        intent:        opts.intent        || null,
        priority:      opts.priority,
        risk_level:    opts.risk          || null,
        ai_reason:     opts.reason        || `Ticket escalated to ${opts.department ?? 'department'} — ${opts.subteam ?? 'team'}.`,
        ai_confidence: 90,
        status:        'pending',
      })
      .select('id')
      .single();

    if (error || !approval) {
      console.error('[escalate] approval_request creation failed:', error?.message);
      return null;
    }

    // Link the approval to the work item
    await supabaseAdmin
      .from('dept_work_items')
      .update({ approval_id: approval.id })
      .eq('id', opts.workItemId);

    console.log(`[escalate] approval_request created: ${approval.id} manager=${opts.managerName}`);
    return approval.id;
  } catch (e: any) {
    console.error('[escalate] ensureApprovalRecord failed:', e.message);
    return null;
  }
}
