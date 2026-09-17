/**
 * POST /api/dept/repair-workflow-stage
 *
 * Runs the Migration 040 repair logic directly in-process.
 *
 * Repairs existing tickets where:
 *   - dept_work_items.status is still 'assigned' despite the acceptance
 *     approval being APPROVED (caused by the old broken .not() filter).
 *   - tickets.workflow_stage is NULL (not written before the sync fix).
 *   - Stale "Case Acceptance Required" notifications still show as unread.
 *
 * This is safe to call multiple times — all steps are idempotent.
 * No Supabase CLI required.
 */
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

export async function POST() {
  try {
    const results: Record<string, any> = {};

    // ── Step 0: Advance dept_work_items from 'assigned' → 'in_progress' ───────
    // For work items that have an approved acceptance approval but status is still
    // 'assigned' (caused by the old broken .not("status","in","(\"...\")") filter).
    const { data: acceptedApprovals } = await admin
      .from('approval_requests')
      .select('id, ticket_id, approved_at')
      .eq('approval_type', 'acceptance')
      .eq('status', 'approved');

    let workItemsFixed = 0;
    for (const ar of acceptedApprovals ?? []) {
      if (!ar.ticket_id) continue;
      const { error } = await admin
        .from('dept_work_items')
        .update({
          status:      'in_progress',
          accepted_at: ar.approved_at ?? new Date().toISOString(),
          started_at:  ar.approved_at ?? new Date().toISOString(),
          updated_at:  new Date().toISOString(),
        })
        .eq('ticket_id', ar.ticket_id)
        .eq('status', 'assigned')        // Only advance if still assigned
        .is('accepted_at', null);        // Skip if already accepted
      if (!error) workItemsFixed++;
    }
    results.workItemsFixed = workItemsFixed;

    // ── Step 0b: Fix escalation-path work items ────────────────────────────────
    // Escalated tickets accepted via dept page 'accept' action:
    // The work log has an 'accepted' or 'started' entry but the DB status is still
    // 'escalated' because the backfill reset it. Advance these items.
    const { data: escalatedItems } = await admin
      .from('dept_work_items')
      .select('id, ticket_id, status, accepted_at')
      .in('status', ['escalated', 'assigned'])
      .is('accepted_at', null);

    let escalatedFixed = 0;
    for (const wi of escalatedItems ?? []) {
      // Check if an 'accepted' or 'started' log entry exists (proof of acceptance)
      const { data: acceptLog } = await admin
        .from('dept_work_logs')
        .select('id, created_at')
        .eq('work_item_id', wi.id)
        .in('action', ['accepted', 'started'])
        .neq('actor', 'system')
        .limit(1)
        .maybeSingle();

      if (!acceptLog) continue; // No acceptance evidence — skip

      const { error } = await admin
        .from('dept_work_items')
        .update({
          status:      'in_progress',
          accepted_at: acceptLog.created_at,
          started_at:  acceptLog.created_at,
          updated_at:  new Date().toISOString(),
        })
        .eq('id', wi.id);
      if (!error) {
        escalatedFixed++;
        // Also sync ticket workflow_stage
        if (wi.ticket_id) {
          await admin
            .from('tickets')
            .update({ workflow_stage: 'Dept Processing', status: 'in_progress' })
            .eq('id', wi.ticket_id)
            .not('status', 'in', '(resolved,completed,customer_resolution)');
        }
      }
    }
    results.escalatedFixed = escalatedFixed;

    // ── Step 1: Set tickets.workflow_stage = 'Dept Processing' ───────────────
    // For tickets where the work item is in_progress but workflow_stage is null or Assigned.
    const { data: inProgressItems } = await admin
      .from('dept_work_items')
      .select('ticket_id, accepted_at, status')
      .in('status', ['in_progress', 'waiting', 'quality_check', 'accepted'])
      .not('accepted_at', 'is', null);

    let ticketsDeptProcessing = 0;
    for (const wi of inProgressItems ?? []) {
      if (!wi.ticket_id) continue;
      // Fetch current ticket state first, then only update if not already advanced
      const { data: t } = await admin
        .from('tickets')
        .select('id, workflow_stage, status')
        .eq('id', wi.ticket_id)
        .maybeSingle();
      if (!t) continue;
      // Skip if already at Dept Processing or beyond
      const alreadyAdvanced = ['Dept Processing', 'Customer Resolution', 'Resolved'].includes(t.workflow_stage ?? '');
      const isTerminal = ['resolved', 'completed', 'customer_resolution'].includes(t.status ?? '');
      if (alreadyAdvanced || isTerminal) continue;

      const { error } = await admin
        .from('tickets')
        .update({ workflow_stage: 'Dept Processing', status: 'in_progress' })
        .eq('id', wi.ticket_id);
      if (!error) ticketsDeptProcessing++;
    }
    results.ticketsDeptProcessing = ticketsDeptProcessing;


    // ── Step 2: Set tickets.workflow_stage = 'Customer Resolution' ────────────
    const { data: custResItems } = await admin
      .from('dept_work_items')
      .select('ticket_id')
      .eq('status', 'customer_resolution');

    let ticketsCustRes = 0;
    for (const wi of custResItems ?? []) {
      if (!wi.ticket_id) continue;
      const { error } = await admin
        .from('tickets')
        .update({ workflow_stage: 'Customer Resolution', status: 'customer_resolution' })
        .eq('id', wi.ticket_id)
        .not('status', 'in', '(resolved,completed)');
      if (!error) ticketsCustRes++;
    }
    results.ticketsCustRes = ticketsCustRes;

    // ── Step 3: Set tickets.workflow_stage = 'Resolved' ──────────────────────
    const { data: completedItems } = await admin
      .from('dept_work_items')
      .select('ticket_id')
      .eq('status', 'completed')
      .not('completed_at', 'is', null);

    let ticketsResolved = 0;
    for (const wi of completedItems ?? []) {
      if (!wi.ticket_id) continue;
      const { error } = await admin
        .from('tickets')
        .update({ workflow_stage: 'Resolved', status: 'resolved' })
        .eq('id', wi.ticket_id)
        .is('workflow_stage', null);
      if (!error) ticketsResolved++;
    }
    results.ticketsResolved = ticketsResolved;

    // ── Step 4: Dismiss stale "Case Acceptance Required" notifications ─────────
    const { data: advancedTickets } = await admin
      .from('tickets')
      .select('id')
      .in('workflow_stage', ['Dept Processing', 'Customer Resolution', 'Resolved']);

    let notificationsDismissed = 0;
    for (const t of advancedTickets ?? []) {
      const { data: updated } = await admin
        .from('notifications')
        .update({ read: true })
        .eq('ticket_id', t.id)
        .eq('type', 'approval_required')
        .ilike('title', '%Acceptance Required%')
        .eq('read', false)
        .select('id');
      if (updated) notificationsDismissed += updated.length;
    }
    results.notificationsDismissed = notificationsDismissed;

    console.log('[repair-workflow-stage] Completed:', results);
    return NextResponse.json({ success: true, ...results });
  } catch (err: any) {
    console.error('[repair-workflow-stage] error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
