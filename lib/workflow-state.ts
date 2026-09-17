/**
 * lib/workflow-state.ts
 *
 * Single source of truth for approval workflow state.
 *
 * Every page that needs to display the live workflow status
 * (Inbox, Dashboard, Approvals, Analytics, Department Queue)
 * should derive its UI from this service — never from the AI
 * decision object or hardcoded stage arrays.
 *
 * SERVER-SAFE: all fetches go through /api/approvals/by-ticket
 * which uses the Supabase service-role key, bypassing RLS.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export type WorkflowApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired';

/**
 * Mirrors the approval_requests table row returned by
 * GET /api/approvals/by-ticket.
 */
export interface WorkflowStateRecord {
  id: string;
  ticket_id: string | null;
  email_id:  string | null;
  status:    WorkflowApprovalStatus;

  manager_name:  string | null;
  manager_email: string | null;
  manager_id:    string | null;

  employee_name:  string | null;
  employee_email: string | null;

  department: string | null;
  team_name:  string | null;
  intent:     string | null;
  priority:   string | null;

  risk_level:     string | null;
  ai_reason:      string | null;
  ai_confidence:  number | null;

  approved_at: string | null;
  approved_by: string | null;
  rejected_at: string | null;
  rejected_by: string | null;
  comments:    string | null;

  created_at: string;
  updated_at: string | null;
}

export interface WorkflowStage {
  key:      string;
  label:    string;
  done:     boolean;
  active:   boolean;
  rejected?: boolean;
}

// ── Stage builder ─────────────────────────────────────────────────────────────

/**
 * Derives the full workflow timeline from a live WorkflowStateRecord.
 * Always call this — never hardcode stage arrays in components.
 *
 * Stage rules:
 *   pending  → Approval Requested is ● (active / waiting for manager)
 *   approved → Approval Requested ✓, Manager Decision ✓, Dept Assignment ✓,
 *              Department Processing ● (in progress)
 *   rejected → Approval Requested ✓, Manager Decision ✕ (red)
 *              Remaining stages hidden
 *   resolved/completed → all stages ✓ (fully done, nothing active)
 *
 * @param state           The approval_requests record.
 * @param ticketStatus    Optional ticket.status — if 'resolved' or 'completed',
 *                        all post-approval stages are marked done.
 */
export function getWorkflowStages(
  state: WorkflowStateRecord,
  ticketStatus?: string | null,
): WorkflowStage[] {
  const isApproved = state.status === 'approved';
  const isRejected = state.status === 'rejected';
  const isPending  = state.status === 'pending';

  // Once the ticket is fully resolved every stage is complete — nothing is active.
  const isResolved = ticketStatus === 'resolved' || ticketStatus === 'completed';

  // Department was assigned if the approval record has dept data
  const hasDeptAssignment = isApproved && !!(state.department || state.team_name);

  const stages: WorkflowStage[] = [
    {
      key:    'ai_analysis',
      label:  'AI Analysis',
      done:   true,
      active: false,
    },
    {
      key:    'approval_requested',
      label:  'Approval Requested',
      done:   isApproved || isRejected,
      active: !isResolved && isPending,
    },
    {
      key:      'manager_decision',
      label:    'Manager Decision',
      done:     isApproved || isRejected,
      active:   false,
      rejected: isRejected,
    },
    // Stages below are hidden on rejection
    ...(!isRejected ? [
      {
        key:    'dept_assignment',
        label:  'Department Assignment',
        done:   isResolved || hasDeptAssignment,
        active: !isResolved && isApproved && !hasDeptAssignment,
      },
      {
        key:    'dept_processing',
        label:  'Department Processing',
        done:   isResolved,               // ✓ only after full resolution
        active: !isResolved && hasDeptAssignment,
      },
      {
        key:    'resolution',
        label:  'Resolution',
        done:   isResolved,               // ✓ only after full resolution
        active: false,
      },
    ] : []),
  ];

  return stages;
}

// ── Canonical 5-Stage Workflow Deriver ───────────────────────────────────────
//
// This is the SINGLE SOURCE OF TRUTH for the 5-stage pipeline:
//   1 → Assigned
//   2 → Accepted
//   3 → Dept Processing
//   4 → Customer Resolution
//   5 → Resolved
//
// Reads from tickets.workflow_stage (persisted on every transition) first.
// Falls back to dept_work_items.status if workflow_stage is not yet set.
// All 8 components that display workflow progress should use this function.

export interface CanonicalStage {
  id:      number;
  label:   string;
  done:    boolean;
  active:  boolean;
}

/**
 * Maps tickets.workflow_stage string → numeric stage index (1-5).
 * Returns 0 if unknown/null.
 */
export function workflowStageToIndex(workflowStage: string | null): number {
  if (!workflowStage) return 0;
  const s = workflowStage.trim().toLowerCase();
  if (s === 'assigned')            return 1;
  if (s === 'accepted')            return 2;
  if (s === 'dept processing')     return 3;
  if (s === 'customer resolution') return 4;
  if (s === 'resolved')            return 5;
  return 0;
}

/**
 * Maps dept_work_items.status → numeric stage index (1-5).
 * Used as fallback when tickets.workflow_stage is not yet populated.
 */
export function workItemStatusToStageIndex(
  workItemStatus: string | null,
  hasAssignee: boolean = false,
): number {
  if (!workItemStatus) return hasAssignee ? 1 : 0;
  switch (workItemStatus) {
    case 'assigned':            return hasAssignee ? 1 : 0;
    case 'accepted':            return 2;
    case 'in_progress':         return 3;
    case 'waiting':             return 3;
    case 'quality_check':       return 3;
    case 'customer_resolution': return 4;
    case 'completed':           return 5;
    default:                    return hasAssignee ? 1 : 0;
  }
}

/**
 * getCanonicalWorkflowStages
 *
 * Derives the correct visual state for all 5 stages from persisted DB fields.
 *
 * Priority order for stage determination:
 *   1. tickets.workflow_stage  (set by every transition — most reliable)
 *   2. dept_work_items.status  (fallback — handles pre-migration records)
 *   3. approval_requests.status (last resort — pre-dept-routing)
 *
 * @param ticketWorkflowStage  tickets.workflow_stage value
 * @param ticketStatus         tickets.status value
 * @param workItemStatus       dept_work_items.status (optional)
 * @param hasAssignee          true when dept_work_items.assigned_to is set
 * @param acceptedAt           dept_work_items.accepted_at (optional)
 * @param approvalStatus       approval_requests.status (optional, last resort)
 */
export function getCanonicalWorkflowStages(params: {
  ticketWorkflowStage: string | null;
  ticketStatus:        string | null;
  workItemStatus?:     string | null;
  hasAssignee?:        boolean;
  acceptedAt?:         string | null;
  approvalStatus?:     string | null;
}): CanonicalStage[] {
  const {
    ticketWorkflowStage,
    ticketStatus,
    workItemStatus,
    hasAssignee = false,
    acceptedAt,
    approvalStatus,
  } = params;

  // ── Determine the active stage index ──────────────────────────────────────
  // Priority 1: tickets.workflow_stage
  let stageIdx = workflowStageToIndex(ticketWorkflowStage);

  // Priority 2: fallback to dept_work_items.status
  if (stageIdx === 0 && workItemStatus !== undefined) {
    stageIdx = workItemStatusToStageIndex(workItemStatus ?? null, hasAssignee);
  }

  // Priority 3: fallback to approval_requests.status + hasAssignee
  if (stageIdx === 0) {
    if (ticketStatus === 'resolved' || ticketStatus === 'completed') {
      stageIdx = 5;
    } else if (approvalStatus === 'approved') {
      // Approved but no further data — we know at minimum stage 3 (dept processing started)
      stageIdx = 3;
    } else if (hasAssignee) {
      stageIdx = 1;
    }
  }

  // Special case: ticket explicitly resolved/completed → all done
  if (ticketStatus === 'resolved' || ticketStatus === 'completed') {
    stageIdx = 5;
  }

  // ── Also check acceptedAt for stage 2 boundary ─────────────────────────
  // If acceptedAt is set but stageIdx is still 1, bump to at least 2 (accepted done, stage 3 active)
  if (acceptedAt && stageIdx <= 1) {
    stageIdx = 3; // accepted implies dept processing is active
  }

  // ── Build the 5 canonical stages ─────────────────────────────────────────
  const STAGE_LABELS = ['Assigned', 'Accepted', 'Dept Processing', 'Customer Resolution', 'Resolved'];

  return STAGE_LABELS.map((label, i) => {
    const stageNum = i + 1; // 1-indexed
    const done   = stageIdx > stageNum || stageIdx === 5 && stageNum === 5;
    const active = stageIdx === stageNum && !done;
    return { id: stageNum, label, done, active };
  });
}


// ── ESCALATE Path Stage Builder ───────────────────────────────────────────────


/**
 * Derives the workflow stages for the ESCALATE decision path.
 * Used when ticket.status === 'escalated' and there is no approval_requests record.
 *
 * The escalation workflow:
 *   AI Analysis ✓
 *   Escalated ✓ (done once ticket.status = 'escalated')
 *   Assigned to Department ● (active — waiting for officer to claim)
 *   Investigation (pending until work item status = 'in_progress')
 *   Resolution Draft (pending until investigation_complete = true)
 *   Customer Email Sent (pending until work item = 'customer_resolution')
 *   Resolved (done when work item = 'completed')
 *   Knowledge Base Learning (done when work item = 'completed')
 */
export interface EscalationWorkflowStage {
  key:    string;
  label:  string;
  done:   boolean;
  active: boolean;
}

export function getEscalationWorkflowStages(params: {
  ticketStatus:         string | null;
  workItemStatus?:      string | null;
  investigationComplete?: boolean;
}): EscalationWorkflowStage[] {
  const { ticketStatus, workItemStatus, investigationComplete } = params;

  const isEscalated       = ticketStatus === 'escalated';
  const isAssigned        = workItemStatus === 'assigned';
  const isAccepted        = workItemStatus === 'accepted';
  const isInProgress      = workItemStatus === 'in_progress' || workItemStatus === 'waiting';
  const isCustomerRes     = workItemStatus === 'customer_resolution';
  const isResolved        = workItemStatus === 'completed';
  const invComplete       = investigationComplete === true;

  // Map work item status to stage progression index
  // 0=pre-escalation, 1=escalated/assigned, 2=accepted, 3=in_progress,
  // 4=investigation_complete, 5=resolution_draft, 6=customer_resolution, 7=resolved/completed
  const stageIndex: number = isResolved ? 7
    : isCustomerRes             ? 6
    : invComplete               ? 5
    : isInProgress              ? 3
    : isAccepted                ? 2
    : isAssigned || isEscalated ? 1
    : 0;

  const stages: EscalationWorkflowStage[] = [
    {
      key:    'ai_analysis',
      label:  'AI Analysis',
      done:   true,
      active: false,
    },
    {
      key:    'escalated',
      label:  'Escalated',
      done:   isEscalated || stageIndex >= 1,
      active: false,
    },
    {
      key:    'assigned_to_dept',
      label:  'Assigned to Department',
      done:   stageIndex >= 2,
      active: stageIndex === 1,
    },
    {
      key:    'investigation',
      label:  'Investigation',
      done:   stageIndex >= 5,
      active: stageIndex === 2 || stageIndex === 3,
    },
    {
      key:    'resolution_draft',
      label:  'Resolution Draft',
      done:   stageIndex >= 6,
      active: stageIndex === 5,
    },
    {
      key:    'customer_email',
      label:  'Customer Email Sent',
      done:   stageIndex >= 7,
      active: stageIndex === 6,
    },
    {
      key:    'resolved',
      label:  'Resolved',
      done:   stageIndex >= 7,
      active: false,
    },
    {
      key:    'kb_learning',
      label:  'Knowledge Base Learning',
      done:   stageIndex >= 7,
      active: false,
    },
  ];

  return stages;
}

// ── Data fetcher ──────────────────────────────────────────────────────────────

/**
 * Fetch the current workflow state for a ticket or email.
 *
 * Pass at least one of ticketId / emailId.
 * Uses emailId as the primary key when both are provided because
 * it is always known from the selected email and avoids ticket-ID
 * mismatches when multiple ticket rows exist for the same email.
 *
 * Returns null if no approval_request record exists yet.
 */
export async function getCurrentWorkflowState(
  ticketId: string | null,
  emailId:  string | null
): Promise<WorkflowStateRecord | null> {
  if (!ticketId && !emailId) return null;

  const params = new URLSearchParams();
  if (emailId)  params.set('emailId',  emailId);   // preferred key
  if (ticketId) params.set('ticketId', ticketId);  // fallback

  try {
    const res = await fetch(`/api/approvals/by-ticket?${params}`, {
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const data = await res.json();
    return (data.approval as WorkflowStateRecord) ?? null;
  } catch {
    return null;
  }
}
