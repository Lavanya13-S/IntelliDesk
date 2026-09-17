export interface Email {
  id: string;
  sender: string;
  subject: string;
  body: string;
  received_at: string;
  status: string;
  priority: string;
  sentiment: string;
  intent: string | null;
  department: string | null;
  subteam: string | null;
}

export interface Ticket {
  id: string;
  email_id: string;
  intent: string | null;
  department: string | null;
  subteam: string | null;
  priority: string;
  sentiment: string;
  status: string;
  created_at: string;
  // Module 4 resolution fields
  workflow_stage: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  resolution_sent: boolean | null;
  gmail_sent: boolean | null;
}

export interface ResponseData {
  id: string;
  ticket_id: string;
  response: string | null;
  approved: boolean;
  sent_at: string | null;
  draft_mode: boolean;
  generated_by: string | null;
  tone: string | null;
}

export interface ActionData {
  id: string;
  ticket_id: string;
  recommended_action: string;
  created_at: string;
}

export interface Draft {
  id: string;
  ticket_id: string;
  content: string;
  version: number;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface Approval {
  id: string;
  response_id: string;
  status: 'pending' | 'approved' | 'rejected';
  requested_by: string;
  approved_by: string | null;
  notes: string | null;
  requested_at: string;
  resolved_at: string | null;
}

export interface ResponseVersion {
  id: string;
  response_id: string;
  content: string;
  version_number: number;
  change_summary: string | null;
  created_at: string;
}

export interface KbPolicy {
  id: string;
  title: string;
  department: string | null;
  category: string | null;
  content: string | null;
  keywords: string[] | null;
  created_at: string;
}

export interface KbFaq {
  id: string;
  question: string;
  answer: string;
  department: string | null;
  category: string | null;
  keywords: string[] | null;
  created_at: string;
}

export interface ResponseTemplate {
  id: string;
  name: string;
  intent: string | null;
  department: string | null;
  subteam: string | null;
  template: string | null;
  active: boolean;
  created_at: string;
}

export interface Document {
  id: string;
  title: string;
  file_url: string | null;
  document_type: string | null;
  content: string | null;
  created_at: string;
}

export interface AiSettings {
  id: string;
  gemini_api_key: string | null;
  auto_generate: boolean;
  auto_approve: boolean;
  created_at: string;
  updated_at: string;
}

export interface ResolvedCase {
  id: string;
  ticket_id: string;
  email_subject: string | null;
  email_body: string | null;
  final_response: string | null;
  intent: string | null;
  department: string | null;
  subteam: string | null;
  action_taken: string | null;
  created_at: string;
}

export interface DashboardStats {
  totalEmails: number;
  pending: number;
  resolved: number;
  critical: number;
}

export interface DepartmentCount {
  department: string;
  count: number;
}

export interface PriorityCount {
  priority: string;
  count: number;
}

// ─── Decision & Escalation Agent Types ───────────────────────────────────────

/** The three possible outcomes of the Decision & Escalation Agent */
export type DecisionType = 'AUTO_RESPONSE' | 'HUMAN_APPROVAL_REQUIRED' | 'ESCALATE';

/** Four-tier risk scale used by the Decision Agent */
export type RiskLevel = 'Low' | 'Medium' | 'High' | 'Critical';

/**
 * The structured JSON result returned by runDecisionAgent().
 * Matches the Gemini prompt output schema exactly.
 */
export interface DecisionResult {
  decision: DecisionType;
  confidence: number;          // 0–100
  risk: RiskLevel;
  requires_human: boolean;
  reason: string;
  department?: string;
  subteam?: string;
  recommended_person?: string;
  /** Gemini-generated 3-bullet handover summary (ESCALATE only) */
  ai_summary?: string;
}

/**
 * Mirrors the decision_logs Supabase table.
 * Used for reading persisted decisions from the DB.
 */
export interface DecisionLog {
  id: string;
  ticket_id: string;
  decision: DecisionType;
  confidence: number;
  risk_level: RiskLevel;
  escalation_reason: string | null;
  recommended_department: string | null;
  recommended_subteam: string | null;
  recommended_person: string | null;
  requires_human: boolean;
  ai_summary: string | null;
  created_at: string;
}

/** Aggregated decision counts for the Dashboard Decision Intelligence row */
export interface DecisionStats {
  autoResolved: number;
  approvalRequired: number;
  escalated: number;
  criticalIncidents: number;
}

// ─── Organization Directory Types ─────────────────────────────────────────────

export interface Department {
  id: string;
  department_name: string;
  department_code: string;
  description: string | null;
  head_employee_id: string | null;
  sla_hours: number;
  created_at: string;
}

export interface Team {
  id: string;
  department_id: string;
  team_name: string;
  team_code: string;
  manager_id: string | null;
  created_at: string;
}

export interface Employee {
  id: string;
  employee_id: string;
  employee_name: string;
  employee_email: string;
  designation: string;
  department_id: string | null;
  team_id: string | null;
  manager_id: string | null;
  employment_status: 'active' | 'inactive' | 'on_leave';
  location: string | null;
  phone: string | null;
  created_at: string;
}

export interface OrgManager {
  id: string;
  employee_id: string;
  approval_level: number;
  can_approve_finance: boolean;
  can_approve_it: boolean;
  can_approve_hr: boolean;
  max_approval_amount: number;
  created_at: string;
}

export interface ApprovalHierarchy {
  id: string;
  department_id: string;
  team_id: string | null;
  level: number;
  approver_employee_id: string;
  created_at: string;
}

/** Enriched approval chain entry used in routing and UI */
export interface ApprovalChainEntry {
  level: number;
  approver_id: string;
  approver_name: string;
  approver_email: string;
  approver_designation: string;
  approval_level: number;       // manager capability level 1-5
  can_approve_finance: boolean;
  can_approve_it: boolean;
  can_approve_hr: boolean;
}

/**
 * Fully enriched employee profile returned by lookupEmployeeByEmail.
 * Used by AI agents for data-driven routing and the Org Directory UI.
 */
export interface EmployeeProfile {
  // Core identity
  id: string;
  employee_id: string;
  employee_name: string;
  employee_email: string;
  designation: string;
  employment_status: 'active' | 'inactive' | 'on_leave';
  location: string | null;
  phone: string | null;

  // Department
  department: {
    id: string;
    name: string;
    code: string;
    sla_hours: number;
  } | null;

  // Team
  team: {
    id: string;
    name: string;
    code: string;
  } | null;

  // Direct manager
  manager: {
    id: string;
    name: string;
    email: string;
    designation: string;
    approval_level: number;
  } | null;

  // Department head
  department_head: {
    id: string;
    name: string;
    email: string;
    designation: string;
  } | null;

  // Full approval chain
  approval_chain: ApprovalChainEntry[];
}

// ─── Department Processing Workspace Types ────────────────────────────────────

export type DeptWorkStatus = 'escalated' | 'assigned' | 'accepted' | 'in_progress' | 'waiting' | 'quality_check' | 'customer_resolution' | 'completed';

export type DeptLogAction =
  | 'created' | 'assigned' | 'accepted' | 'started' | 'paused' | 'waiting'
  | 'resumed' | 'submitted_for_review' | 'dept_processing_complete' | 'verified' | 'returned'
  | 'completed' | 'escalated' | 'commented' | 'reassigned' | 'sla_breached';

export interface DeptWorkItem {
  id: string;
  approval_id: string | null;
  ticket_id: string | null;
  email_id: string | null;
  department: string | null;
  team_name: string | null;
  employee_name: string | null;
  employee_email: string | null;
  intent: string | null;
  priority: 'critical' | 'high' | 'medium' | 'low';
  status: DeptWorkStatus;
  assigned_to: string | null;
  /** FK to employees.id — the org-directory UUID of the auto-assigned person */
  assigned_employee_id: string | null;
  assigned_at: string | null;
  accepted_at: string | null;          // set when engineer claims the ticket
  started_at: string | null;
  completed_at: string | null;
  sla_deadline: string | null;
  sla_breached: boolean;
  // Escalation fields (added in migration 029)
  escalated_from_ticket_id: string | null;
  investigation_complete: boolean;
  investigation_completed_at: string | null;
  investigation_completed_by: string | null;
  // Internal resolution fields (added in migration 034)
  // Confidential Step 5 data — NEVER sent to customer
  internal_resolution_fields: Record<string, string> | null;
  // Safe summary used to brief Gemini — no sensitive values
  resolution_safe_summary: string | null;
  created_at: string;
  updated_at: string;
}


export interface DeptWorkLog {
  id: string;
  work_item_id: string;
  actor: string;
  action: DeptLogAction;
  note: string | null;
  created_at: string;
}

export interface DeptSlaConfig {
  priority: string;
  sla_hours: number;
}

export interface DeptStats {
  assignedToday: number;
  open: number;
  inProgress: number;
  qualityCheck: number;
  completedToday: number;
  slaBreached: number;
  avgResolutionHours: number;
}
