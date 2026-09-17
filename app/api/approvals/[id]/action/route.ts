/**
 * POST /api/approvals/[id]/action
 *
 * Enterprise Approval State Machine — Manager Portal action endpoint.
 *
 * State transitions allowed:
 *   pending  → approved   (terminal)
 *   pending  → rejected   (terminal)
 *
 * For approval_type = 'acceptance':
 *   Delegates to processAcceptanceApproval() which also advances dept_work_items.
 *
 * Body: { action: 'approved' | 'rejected', comments?: string }
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { createClient } from '@supabase/supabase-js';
import { createWorkItem } from '@/lib/dept-service';
import { processAcceptanceApproval } from '@/lib/approval-service';

// Admin client for org directory lookups (bypasses RLS)
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

/** Looks up the team manager name from the org directory (teams → employees). */
async function resolveTeamManagerName(teamName: string | null, department: string | null): Promise<string | null> {
  if (!teamName && !department) return null;
  if (teamName) {
    const { data: team } = await supabaseAdmin
      .from('teams').select('manager_id').ilike('team_name', (teamName ?? '').trim()).maybeSingle();
    if (team?.manager_id) {
      const { data: emp } = await supabaseAdmin
        .from('employees').select('employee_name').eq('id', team.manager_id).maybeSingle();
      if (emp?.employee_name) return emp.employee_name;
    }
  }
  if (department) {
    const { data: dept } = await supabaseAdmin
      .from('departments').select('head_employee_id').ilike('department_name', department.trim()).maybeSingle();
    if (dept?.head_employee_id) {
      const { data: emp } = await supabaseAdmin
        .from('employees').select('employee_name').eq('id', dept.head_employee_id).maybeSingle();
      if (emp?.employee_name) return emp.employee_name;
    }
  }
  return null;
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { action, comments } = await req.json();

    // ── Validate action value ────────────────────────────────────────────────
    if (action !== 'approved' && action !== 'rejected') {
      return NextResponse.json(
        { error: 'action must be "approved" or "rejected"' },
        { status: 400 }
      );
    }

    const approvalId = params.id;

    // ── Step 1: Fetch current record ─────────────────────────────────────────
    const { data: existing, error: fetchErr } = await supabase
      .from('approval_requests')
      .select('*')
      .eq('id', approvalId)
      .maybeSingle();

    if (fetchErr || !existing) {
      return NextResponse.json({ error: 'Approval not found' }, { status: 404 });
    }

    // ── Step 2: State-machine gate ────────────────────────────────────────────
    if (existing.status !== 'pending') {
      return NextResponse.json(
        {
          error: 'This approval has already been processed.',
          code: 'APPROVAL_ALREADY_PROCESSED',
          currentStatus: existing.status,
          approval: existing,
        },
        { status: 409 }
      );
    }

    // ── Step 3: Route by approval_type ────────────────────────────────────────
    // Acceptance approvals have different downstream effects than manager approvals.
    // The "approver" for an acceptance is the assigned officer (stored in manager_name).
    if (existing.approval_type === 'acceptance') {
      const actorName = existing.manager_name ?? existing.manager_email ?? 'Assigned Officer';
      const result = await processAcceptanceApproval({
        approvalId,
        action,
        actorName,
        comments,
      });

      if (!result.success) {
        return NextResponse.json({ error: result.error }, { status: 500 });
      }
      return NextResponse.json({ success: true, approval: result.approval });
    }

    // ── Step 4 (Manager approval path): Build core update payload ─────────────
    // ONLY use columns that exist in the ORIGINAL schema (migration 016).
    // This guarantees the UPDATE works even if migration 018 has not been applied.
    const now = new Date().toISOString();
    const actorIdentity =
      existing.manager_email ?? existing.manager_name ?? 'manager';

    const corePayload = {
      status: action,                 // 'approved' | 'rejected'
      comments: comments ?? null,
      approved_at: now,               // single timestamp — always-safe column
      updated_at: now,
    };

    // ── Step 5: Persist core state transition ─────────────────────────────────
    const { data: updated, error: updateErr } = await supabase
      .from('approval_requests')
      .update(corePayload)
      .eq('id', approvalId)
      .eq('status', 'pending')        // optimistic concurrency: only match pending
      .select()
      .maybeSingle();

    if (updateErr) {
      if (
        updateErr.message?.includes('APPROVAL_ALREADY_PROCESSED') ||
        updateErr.code === 'P0001'
      ) {
        const { data: latest } = await supabase
          .from('approval_requests')
          .select('*')
          .eq('id', approvalId)
          .maybeSingle();
        return NextResponse.json(
          {
            error: 'This approval has already been processed.',
            code: 'APPROVAL_ALREADY_PROCESSED',
            currentStatus: latest?.status ?? 'unknown',
            approval: latest,
          },
          { status: 409 }
        );
      }
      console.error('[action/route] UPDATE failed:', updateErr.message, updateErr.code);
      return NextResponse.json(
        { error: updateErr.message ?? 'Failed to update approval status' },
        { status: 500 }
      );
    }

    if (!updated) {
      const { data: latest } = await supabase
        .from('approval_requests')
        .select('*')
        .eq('id', approvalId)
        .maybeSingle();
      return NextResponse.json(
        {
          error: 'This approval has already been processed.',
          code: 'APPROVAL_ALREADY_PROCESSED',
          currentStatus: latest?.status ?? 'unknown',
          approval: latest,
        },
        { status: 409 }
      );
    }

    // ── Step 5b: Best-effort write of migration-018 columns ──────────────────
    try {
      const extraPayload: Record<string, string> = {};
      if (action === 'approved') {
        extraPayload.approved_by = actorIdentity;
      } else {
        extraPayload.rejected_at = now;
        extraPayload.rejected_by = actorIdentity;
      }
      await supabase
        .from('approval_requests')
        .update(extraPayload)
        .eq('id', approvalId);
    } catch {
      // Silently ignore — columns not yet in DB (migration 018 not yet applied)
    }

    // ── Step 6: Update the linked ticket ─────────────────────────────────────
    if (existing.ticket_id) {
      const ticketUpdate =
        action === 'approved'
          ? { approval_status: 'approved', status: 'open' }
          : { approval_status: 'rejected', status: 'rejected', resolved_at: now };

      const { error: ticketErr } = await supabase
        .from('tickets')
        .update(ticketUpdate)
        .eq('id', existing.ticket_id);

      if (ticketErr) {
        console.warn('[action/route] ticket UPDATE (non-fatal):', ticketErr.message);
      }
    }

    // ── Step 7: Audit log ─────────────────────────────────────────────────────
    const ipAddress =
      req.headers.get('x-forwarded-for') ??
      req.headers.get('x-real-ip') ??
      'unknown';

    await supabase.from('approval_audit_log').insert({
      approval_id: approvalId,
      event: action,
      actor: actorIdentity,
      comments: comments ?? null,
      ip_address: ipAddress,
      user_agent: req.headers.get('user-agent') ?? 'unknown',
      metadata: {
        managed_via: 'manager_portal',
        ticket_id: existing.ticket_id,
        employee_email: existing.employee_email,
        previous_status: 'pending',
        new_status: action,
      },
    });

    // ── Step 8: In-app notification ───────────────────────────────────────────
    await supabase.from('notifications').insert({
      type: action === 'approved' ? 'approval_required' : 'system',
      title: action === 'approved' ? '✓ Request Approved' : '✗ Request Rejected',
      message: `${existing.manager_name ?? 'Manager'} ${action} the request from ${existing.employee_name ?? existing.employee_email}`,
      ticket_id: existing.ticket_id,
      email_id: existing.email_id,
      read: false,
    });

    // ── Step 9: If rejected — send rejection email to employee ────────────────
    if (action === 'rejected' && existing.employee_email) {
      const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
      try {
        await fetch(`${APP_URL}/api/approvals/send-rejection`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            approvalId,
            employeeEmail: existing.employee_email,
            employeeName: existing.employee_name,
            managerName: existing.manager_name,
            intent: existing.intent,
            comments: comments ?? '',
          }),
        });
      } catch (e) {
        console.warn('[action/route] rejection email (non-fatal):', e);
      }
    }

    // ── Step 10: Create or Update Department Work Item (manager approval only) ─
    if (action === 'approved') {
      try {
        const now2 = new Date().toISOString();

        const assignedTo = await resolveTeamManagerName(
          existing.team_name,
          existing.department
        );
        console.log(
          `[action/route] resolved manager: "${assignedTo}" for team=${existing.team_name} dept=${existing.department}`
        );

        let existingWI: { id: string; status: string } | null = null;
        if (existing.ticket_id) {
          const { data: foundWI } = await supabaseAdmin
            .from('dept_work_items')
            .select('id, status')
            .eq('ticket_id', existing.ticket_id)
            .maybeSingle();
          existingWI = foundWI ?? null;
        }

        if (existingWI) {
          console.log(
            `[action/route] escalation path — updating existing work item ${existingWI.id}` +
            ` from status=${existingWI.status} → assigned, assignedTo=${assignedTo}`
          );
          const { error: upErr } = await supabaseAdmin
            .from('dept_work_items')
            .update({
              status:      'assigned',
              approval_id: approvalId,
              assigned_to: assignedTo ?? null,
              assigned_at: now2,
            })
            .eq('id', existingWI.id);

          if (upErr) {
            console.warn('[action/route] work item update failed:', upErr.message);
          } else {
            await supabaseAdmin.from('dept_work_logs').insert({
              work_item_id: existingWI.id,
              actor:        actorIdentity,
              action:       'assigned',
              note:         `Approved by ${actorIdentity}. Assigned to ${
                assignedTo ?? 'department queue'
              } (${existing.team_name ?? existing.department ?? 'team'}).`,
            });
          }
        } else {
          console.log(`[action/route] normal approval path — creating new work item`);
          await createWorkItem({
            approval_id:    approvalId,
            ticket_id:      existing.ticket_id    ?? null,
            email_id:       existing.email_id     ?? null,
            department:     existing.department   ?? null,
            team_name:      existing.team_name    ?? null,
            employee_name:  existing.employee_name  ?? null,
            employee_email: existing.employee_email ?? null,
            intent:         existing.intent       ?? null,
            priority:       existing.priority     ?? 'medium',
          });
          console.log(`[action/route] new dept work item created for approval ${approvalId}`);
        }
      } catch (e: any) {
        console.warn('[action/route] dept work item update/create failed (non-fatal):', e?.message);
      }
    }

    return NextResponse.json({ success: true, approval: updated });
  } catch (err: any) {
    console.error('[action/route] unhandled error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
