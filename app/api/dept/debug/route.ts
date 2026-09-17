/**
 * GET /api/dept/debug
 *
 * Server-side diagnostic endpoint.
 * Returns the EXACT database state for the payroll/escalation ticket chain.
 *
 * Called by: developers debugging Department Queue issues.
 * Remove or restrict after debugging is complete.
 *
 * Logs:
 *   [ESCALATION] ticketId= workItemId= department= team= status=
 *   [DEPARTMENT_QUEUE] returnedWorkItems=
 */

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

export async function GET() {
  try {
    // ── 1. Find the Sarah Johnson payroll ticket ─────────────────────────────
    const { data: emailRows } = await supabaseAdmin
      .from('emails')
      .select('id, sender, subject, created_at')
      .or('sender.ilike.%aynaval%,subject.ilike.%salary%,subject.ilike.%payroll%,subject.ilike.%credited incorrectly%')
      .order('created_at', { ascending: false })
      .limit(5);

    const emailIds = (emailRows ?? []).map((e: any) => e.id);

    // ── 2. Find tickets linked to those emails ────────────────────────────────
    const { data: tickets } = await supabaseAdmin
      .from('tickets')
      .select('id, email_id, status, department, subteam, priority, created_at')
      .in('email_id', emailIds.length > 0 ? emailIds : ['00000000-0000-0000-0000-000000000000'])
      .order('created_at', { ascending: false })
      .limit(5);

    const ticketIds = (tickets ?? []).map((t: any) => t.id);

    // ── 3. Find dept_work_items for those tickets ──────────────────────────────
    const { data: workItems } = await supabaseAdmin
      .from('dept_work_items')
      .select('id, ticket_id, approval_id, status, department, team_name, employee_name, employee_email, priority, assigned_to, created_at')
      .in('ticket_id', ticketIds.length > 0 ? ticketIds : ['00000000-0000-0000-0000-000000000000'])
      .order('created_at', { ascending: false });

    // ── 4. (Constraint check skipped — no pg_constraint RPC available) ────────

    // ── 5. Full dept_queue dump (what the queue API actually returns) ──────────
    const { data: queueItems, error: queueErr } = await supabaseAdmin
      .from('dept_work_items')
      .select('id, status, department, team_name, employee_name, priority, created_at')
      .order('created_at', { ascending: false })
      .limit(50);

    const escalatedItems = (queueItems ?? []).filter((i: any) => i.status === 'escalated');

    // ── 6. Notifications for those tickets ────────────────────────────────────
    const { data: notifications } = await supabaseAdmin
      .from('notifications')
      .select('id, type, title, ticket_id, dept_work_item_id, created_at, read')
      .in('ticket_id', ticketIds.length > 0 ? ticketIds : ['00000000-0000-0000-0000-000000000000'])
      .order('created_at', { ascending: false });

    // ── Server-side logs ──────────────────────────────────────────────────────
    for (const wi of (workItems ?? [])) {
      console.log(
        `[ESCALATION] ticketId=${wi.ticket_id} workItemId=${wi.id} ` +
        `department=${wi.department} team=${wi.team_name} status=${wi.status}`
      );
    }
    console.log(`[DEPARTMENT_QUEUE] returnedWorkItems=${queueItems?.length ?? 0} escalated=${escalatedItems.length}`);

    return NextResponse.json({
      // ── Raw DB results ──────────────────────────────────────────────────────
      payroll_emails: emailRows ?? [],
      payroll_tickets: tickets ?? [],
      payroll_work_items: workItems ?? [],
      escalated_in_queue: escalatedItems,
      queue_error: queueErr?.message ?? null,
      total_queue_count: queueItems?.length ?? 0,
      notifications: notifications ?? [],

      // ── Summary ──────────────────────────────────────────────────────────────
      diagnosis: {
        payroll_ticket_found: (tickets ?? []).length > 0,
        payroll_ticket_ids: ticketIds,
        work_item_exists: (workItems ?? []).length > 0,
        work_item_statuses: (workItems ?? []).map((w: any) => w.status),
        escalated_count_in_queue: escalatedItems.length,
        queue_shows_escalated: escalatedItems.length > 0,
      },
    });
  } catch (err: any) {
    console.error('[dept/debug] error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
