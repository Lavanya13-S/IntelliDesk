/**
 * GET /api/approvals/by-ticket?ticketId=...&emailId=...
 *
 * Server-side lookup: finds the most relevant approval_request for a given
 * ticket or email and returns it alongside dept_work_item context so the
 * inbox page can derive the canonical 5-stage workflow state.
 *
 * Lookup priority:
 *   1. ticket_id match, approval_type='manager_approval'  (preferred — drives 5-stage UI)
 *   2. ticket_id match, any type                          (fallback for older records)
 *   3. email_id match                                     (fallback for email-linked tickets)
 *
 * Response also includes:
 *   workItemStatus  — dept_work_items.status for the ticket
 *   hasAssignee     — true when dept_work_items.assigned_to is set
 *   acceptedAt      — dept_work_items.accepted_at
 *
 * These extra fields are used by getCanonicalWorkflowStages() in the UI so
 * the workflow stepper never needs to guess the stage from the approval record alone.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Use the service-role key so this is guaranteed to bypass RLS.
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    ''
);

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const ticketId = searchParams.get('ticketId');
    const emailId  = searchParams.get('emailId');

    if (!ticketId && !emailId) {
      return NextResponse.json(
        { error: 'ticketId or emailId is required' },
        { status: 400 }
      );
    }

    let approval: any = null;

    // ── Stage 1: Prefer manager_approval for the ticket (canonical workflow driver)
    if (ticketId) {
      const { data, error } = await supabaseAdmin
        .from('approval_requests')
        .select('*')
        .eq('ticket_id', ticketId)
        .eq('approval_type', 'manager_approval')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        console.error('[by-ticket] manager_approval lookup error:', error.message);
      } else if (data) {
        approval = data;
      }
    }

    // ── Stage 2: Fallback — any approval_type for the ticket
    if (!approval && ticketId) {
      const { data, error } = await supabaseAdmin
        .from('approval_requests')
        .select('*')
        .eq('ticket_id', ticketId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        console.error('[by-ticket] ticket_id lookup error:', error.message);
      } else if (data) {
        approval = data;
      }
    }

    // ── Stage 3: Fallback by email_id
    if (!approval && emailId) {
      const { data, error } = await supabaseAdmin
        .from('approval_requests')
        .select('*')
        .eq('email_id', emailId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        console.error('[by-ticket] email_id lookup error:', error.message);
      } else if (data) {
        approval = data;
      }
    }

    // ── Enrich with dept_work_items context for canonical stage derivation ──
    // The inbox WorkflowStepper needs workItemStatus, hasAssignee, acceptedAt
    // to call getCanonicalWorkflowStages() correctly.
    let workItemStatus: string | null  = null;
    let hasAssignee:   boolean         = false;
    let acceptedAt:    string | null   = null;
    let ticketWorkflowStage: string | null = null;

    const lookupTicketId = ticketId ?? approval?.ticket_id ?? null;

    if (lookupTicketId) {
      // Fetch dept_work_items
      const { data: wi } = await supabaseAdmin
        .from('dept_work_items')
        .select('status, assigned_to, accepted_at')
        .eq('ticket_id', lookupTicketId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (wi) {
        workItemStatus = wi.status   ?? null;
        hasAssignee   = !!wi.assigned_to;
        acceptedAt    = wi.accepted_at ?? null;
      }

      // Fetch tickets.workflow_stage — the primary canonical source
      const { data: t } = await supabaseAdmin
        .from('tickets')
        .select('workflow_stage, status')
        .eq('id', lookupTicketId)
        .maybeSingle();

      if (t) {
        ticketWorkflowStage = t.workflow_stage ?? null;
      }
    }

    return NextResponse.json(
      {
        approval,                // null if not found — frontend handles this
        workItemStatus,          // dept_work_items.status
        hasAssignee,             // true when assigned_to is set
        acceptedAt,              // dept_work_items.accepted_at
        ticketWorkflowStage,     // tickets.workflow_stage (canonical)
      },
      {
        status: 200,
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate',
        },
      }
    );
  } catch (err: any) {
    console.error('[by-ticket] unexpected error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
