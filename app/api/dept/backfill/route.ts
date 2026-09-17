/**
 * POST /api/dept/backfill
 *
 * Self-healing: Creates dept_work_items rows for any tickets that are missing them,
 * and repairs existing rows where assigned_to is NULL.
 *
 * Three parts:
 *   A. Backfill from approved approval_requests (approval-based workflow)
 *   B. Backfill escalated tickets with no dept_work_items row
 *   C. Repair existing unassigned work items (assigned_to IS NULL)
 *
 * Called automatically when the Department Queue page loads.
 * Idempotent — safe to call multiple times.
 */
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createWorkItem, resolveAssignee } from '@/lib/dept-service';
import { createAcceptanceApproval } from '@/lib/approval-service';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const SLA_HOURS: Record<string, number> = { critical: 2, high: 4, medium: 8, low: 24 };

export async function POST() {
  try {
    let created = 0;
    let repaired = 0;
    const errors: string[] = [];

    // ── Part A: Backfill from approved approval_requests ──────────────────────
    const { data: approvals, error: approvalsErr } = await supabaseAdmin
      .from('approval_requests')
      .select('id, ticket_id, email_id, department, team_name, employee_name, employee_email, intent, priority')
      .eq('status', 'approved');

    if (approvalsErr) {
      console.error('[dept/backfill] fetch error:', approvalsErr.message);
      return NextResponse.json({ error: approvalsErr.message }, { status: 500 });
    }

    if (approvals && approvals.length > 0) {
      const { data: existing } = await supabaseAdmin
        .from('dept_work_items')
        .select('approval_id')
        .in('approval_id', approvals.map(a => a.id));

      const existingIds = new Set((existing ?? []).map((e: any) => e.approval_id));
      const missing = approvals.filter(a => !existingIds.has(a.id));

      for (const approval of missing) {
        try {
          const item = await createWorkItem({
            approval_id:    approval.id,
            ticket_id:      approval.ticket_id    ?? null,
            email_id:       approval.email_id     ?? null,
            department:     approval.department   ?? null,
            team_name:      approval.team_name    ?? null,
            employee_name:  approval.employee_name  ?? null,
            employee_email: approval.employee_email ?? null,
            intent:         approval.intent       ?? null,
            priority:       approval.priority     ?? 'medium',
          });
          if (item) created++;
        } catch (e: any) {
          errors.push(`approval ${approval.id}: ${e?.message}`);
        }
      }

      console.log(`[dept/backfill] approvals: total=${approvals.length} already=${approvals.length - missing.length} created=${created}`);
    }

    // ── Part B: Backfill escalated tickets with no dept_work_items row ────────
    const { data: escalatedTickets } = await supabaseAdmin
      .from('tickets')
      .select('id, email_id, department, subteam, priority, intent')
      .eq('status', 'escalated');

    const escalatedCount = (escalatedTickets ?? []).length;
    console.log(`[dept/backfill] escalated tickets in DB: ${escalatedCount}`);

    if (escalatedTickets && escalatedTickets.length > 0) {
      const { data: existingWI } = await supabaseAdmin
        .from('dept_work_items')
        .select('ticket_id')
        .in('ticket_id', escalatedTickets.map(t => t.id));

      const existingTicketIds = new Set((existingWI ?? []).map((w: any) => w.ticket_id));
      const orphanTickets = escalatedTickets.filter(t => !existingTicketIds.has(t.id));

      console.log(`[dept/backfill] escalated tickets needing backfill: ${orphanTickets.length}`);

      for (const ticket of orphanTickets) {
        try {
          let employeeName: string | null = null;
          let employeeEmail: string | null = null;
          const emailId: string | null = ticket.email_id ?? null;

          if (emailId) {
            const { data: emailRow } = await supabaseAdmin
              .from('emails')
              .select('sender')
              .eq('id', emailId)
              .maybeSingle();
            if (emailRow) {
              employeeEmail = (emailRow as any).sender ?? null;
              employeeName = employeeEmail ? employeeEmail.split('@')[0] : null;
            }
          }

          const priority = (['critical','high','medium','low'].includes(ticket.priority))
            ? ticket.priority as 'critical'|'high'|'medium'|'low'
            : 'high';

          const slaDeadline = new Date(Date.now() + (SLA_HOURS[priority] ?? 4) * 3_600_000).toISOString();

          // ── Resolve assignee from org directory ──────────────────────────────
          const assignee = await resolveAssignee(ticket.subteam ?? null, ticket.department ?? null, priority);

          // ── Build insert payload — safe even before migration 036 ───────────
          const wiPayload: Record<string, any> = {
            approval_id:          null,
            ticket_id:            ticket.id,
            email_id:             emailId,
            department:           ticket.department ?? null,
            team_name:            ticket.subteam ?? null,
            employee_name:        employeeName,
            employee_email:       employeeEmail,
            intent:               ticket.intent ?? null,
            priority,
            status:               'escalated',
            assigned_to:          assignee?.employee_name ?? null,
            assigned_at:          assignee ? new Date().toISOString() : null,
            sla_deadline:         slaDeadline,
            sla_breached:         false,
          };
          if (assignee?.employee_id) {
            wiPayload.assigned_employee_id = assignee.employee_id;
          }

          let wi: { id: string } | null = null;
          const { data: wiData, error: wiErr } = await supabaseAdmin
            .from('dept_work_items')
            .insert(wiPayload)
            .select('id')
            .single();

          if (wiErr) {
            const isColMissing =
              wiErr.message?.includes('assigned_employee_id') || wiErr.code === '42703';
            if (isColMissing && wiPayload.assigned_employee_id !== undefined) {
              const { assigned_employee_id: _d, ...payloadNofk } = wiPayload;
              const { data: retryWi, error: retryErr } = await supabaseAdmin
                .from('dept_work_items').insert(payloadNofk).select('id').single();
              if (retryErr) {
                console.error(`[dept/backfill] escalated ticket ${ticket.id} retry failed:`, retryErr.message);
                errors.push(`escalated ticket ${ticket.id}: ${retryErr.message}`);
              } else { wi = retryWi; }
            } else {
              console.error(`[dept/backfill] escalated ticket ${ticket.id} work item insert failed:`, wiErr.message);
              errors.push(`escalated ticket ${ticket.id}: ${wiErr.message}`);
            }
          } else { wi = wiData; }

          if (wi) {

            console.log(
              `[ESCALATION] ticketId=${ticket.id} workItemId=${wi.id} ` +
              `department=${ticket.department} team=${ticket.subteam} status=escalated ` +
              `assignedTo=${assignee?.employee_name ?? 'UNASSIGNED'}`
            );

            await supabaseAdmin.from('dept_work_logs').insert({
              work_item_id: wi.id,
              actor:        'system',
              action:       'escalated',
              note:         `Backfilled by dept/backfill: escalated ticket missing work item. Department: ${ticket.department ?? 'Unknown'}.`,
            });

            if (assignee) {
              await supabaseAdmin.from('dept_work_logs').insert({
                work_item_id: wi.id,
                actor:        'system',
                action:       'assigned',
                note:
                  `Automatically assigned to ${assignee.employee_name} (${assignee.employee_email}) ` +
                  `by system. Department: ${ticket.department ?? 'Unknown'}, ` +
                  `Team: ${ticket.subteam ?? 'Unknown'}, Priority: ${priority}. ` +
                  `Designation: ${assignee.designation}.`,
              });
            }

            created++;
          }
        } catch (e: any) {
          errors.push(`escalated ticket ${ticket.id}: ${e?.message}`);
        }
      }
    }

    // ── Part C: Repair existing work items where assigned_to IS NULL ──────────
    // These are work items that exist but were created before the fix,
    // or where resolveAssignee previously returned null.
    // Fully idempotent: checks existing 'assigned' logs before writing a new one.
    const { data: unassignedItems } = await supabaseAdmin
      .from('dept_work_items')
      .select('id, ticket_id, department, team_name, priority, status, sla_deadline, sla_breached')
      .is('assigned_to', null)
      .neq('status', 'completed');

    const unassignedCount = (unassignedItems ?? []).length;
    console.log(`[dept/backfill] unassigned work items to repair: ${unassignedCount}`);

    for (const item of (unassignedItems ?? [])) {
      try {
        const priority = item.priority ?? 'medium';
        const assignee = await resolveAssignee(item.team_name ?? null, item.department ?? null, priority);

        if (!assignee) {
          console.warn(`[dept/backfill] Part C: no assignee found for work item ${item.id} (${item.department} / ${item.team_name})`);
          continue;
        }

        // ── Idempotency check: skip if an 'assigned' log already exists ──────
        const { count: existingLogCount } = await supabaseAdmin
          .from('dept_work_logs')
          .select('id', { count: 'exact', head: true })
          .eq('work_item_id', item.id)
          .eq('action', 'assigned');

        if ((existingLogCount ?? 0) > 0) {
          // Item was already repaired — update assigned_to if still null but skip log
          const updatePayload: Record<string, any> = {
            assigned_to: assignee.employee_name,
            assigned_at: new Date().toISOString(),
          };
          // Reset SLA if breached (safety net)
          if (item.sla_breached || (item.sla_deadline && new Date(item.sla_deadline) < new Date())) {
            const slaHours = SLA_HOURS[priority] ?? 4;
            updatePayload.sla_deadline = new Date(Date.now() + slaHours * 3_600_000).toISOString();
            updatePayload.sla_breached = false;
          }
          const updateQuery = supabaseAdmin.from('dept_work_items').update(updatePayload).eq('id', item.id);
          // Only update if assigned_to is still null (safety guard — column-safe retry handled by repairUnassignedItem)
          const { error: silentErr } = await updateQuery.is('assigned_to', null);
          if (silentErr) {
            const isColMissing = silentErr.message?.includes('assigned_employee_id') || silentErr.code === '42703';
            if (!isColMissing) errors.push(`re-assign ${item.id}: ${silentErr.message}`);
          }
          continue;
        }

        // ── Reset SLA if it's already breached (ticket was old/backfilled) ────
        const slaHours = SLA_HOURS[priority] ?? 4;
        const needsSlaReset = item.sla_breached || (item.sla_deadline && new Date(item.sla_deadline) < new Date());
        const newSlaDeadline = needsSlaReset
          ? new Date(Date.now() + slaHours * 3_600_000).toISOString()
          : item.sla_deadline;

        const repairPayload: Record<string, any> = {
          assigned_to:          assignee.employee_name,
          assigned_employee_id: assignee.employee_id,
          assigned_at:          new Date().toISOString(),
        };
        if (needsSlaReset) {
          repairPayload.sla_deadline = newSlaDeadline;
          repairPayload.sla_breached = false;
        }

        const { error: upErr } = await supabaseAdmin
          .from('dept_work_items')
          .update(repairPayload)
          .eq('id', item.id)
          .is('assigned_to', null);  // safety guard — only update truly unassigned

        if (upErr) {
          // Column-safe retry
          const isColMissing = upErr.message?.includes('assigned_employee_id') || upErr.code === '42703';
          if (isColMissing) {
            const { assigned_employee_id: _d, ...nofkPayload } = repairPayload;
            const { error: retryErr } = await supabaseAdmin
              .from('dept_work_items').update(nofkPayload).eq('id', item.id).is('assigned_to', null);
            if (retryErr) {
              errors.push(`repair item ${item.id}: ${retryErr.message}`);
              continue;
            }
          } else {
            errors.push(`repair item ${item.id}: ${upErr.message}`);
            continue;
          }
        }

        await supabaseAdmin.from('dept_work_logs').insert({
          work_item_id: item.id,
          actor:        'system',
          action:       'assigned',
          note:
            `Automatically assigned to ${assignee.employee_name} (${assignee.employee_email}) ` +
            `by system (backfill repair). Department: ${item.department ?? 'Unknown'}, ` +
            `Team: ${item.team_name ?? 'Unknown'}, Priority: ${priority}. ` +
            `Designation: ${assignee.designation}.` +
            (needsSlaReset ? ' SLA reset from point of assignment.' : ''),
        });

        // ── Create acceptance approval for the newly assigned officer ─────────
        // Only when the work item has a ticket_id and is not yet in in_progress+
        if (item.ticket_id && ['assigned', 'escalated'].includes(item.status ?? '')) {
          try {
            // Fetch the ticket's email_id and employee info
            const { data: ticketRow } = await supabaseAdmin
              .from('dept_work_items')
              .select('ticket_id, email_id, employee_name, employee_email, intent, department, team_name')
              .eq('id', item.id)
              .maybeSingle();

            await createAcceptanceApproval({
              ticketId:      item.ticket_id,
              emailId:       ticketRow?.email_id ?? null,
              workItemId:    item.id,
              assigneeName:  assignee.employee_name,
              assigneeEmail: assignee.employee_email ?? null,
              employeeName:  ticketRow?.employee_name ?? null,
              employeeEmail: ticketRow?.employee_email ?? null,
              department:    item.department ?? null,
              teamName:      item.team_name ?? null,
              intent:        ticketRow?.intent ?? null,
              priority,
            });
          } catch (accErr: any) {
            console.warn(`[dept/backfill] Part C: createAcceptanceApproval non-fatal:`, accErr?.message);
          }
        }

        repaired++;
        console.log(`[dept/backfill] Part C: repaired work item ${item.id} → assigned to ${assignee.employee_name}${needsSlaReset ? ' + SLA reset' : ''}`);
      } catch (e: any) {
        errors.push(`repair item ${item.id}: ${e?.message}`);
      }
    }

    // ── Debug: log current queue state ────────────────────────────────────────
    const { data: queueSnapshot } = await supabaseAdmin
      .from('dept_work_items')
      .select('id, status, assigned_to')
      .order('created_at', { ascending: false })
      .limit(100);

    const statusCounts: Record<string, number> = {};
    let stillUnassigned = 0;
    for (const qitem of (queueSnapshot ?? [])) {
      const s = (qitem as any).status;
      statusCounts[s] = (statusCounts[s] ?? 0) + 1;
      if (!(qitem as any).assigned_to) stillUnassigned++;
    }
    console.log(`[DEPARTMENT_QUEUE] returnedWorkItems=${queueSnapshot?.length ?? 0}`, JSON.stringify(statusCounts));

    return NextResponse.json({
      approvalTickets:  approvals?.length ?? 0,
      escalatedTickets: escalatedCount,
      created,
      repaired,
      unassignedRemaining: stillUnassigned,
      errors,
      queueStatusCounts: statusCounts,
    });
  } catch (err: any) {
    console.error('[dept/backfill] unhandled error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
