'use client';

import { useState, useEffect, useCallback } from 'react';
import { Sidebar } from '@/components/sidebar';
import { supabase } from '@/lib/supabase';
import {
  ArrowLeft, CheckCircle2, XCircle, Clock, AlertTriangle,
  User, Building2, Mail, Zap, Shield, MessageSquare,
  ChevronRight, RefreshCw, Calendar, GitBranch, FileText,
  Search, Wrench, BookOpen, Brain, Target, AlertCircle,
  TrendingUp, Hash, ChevronDown, ChevronUp, Lock,
  ShieldAlert, Siren, BadgeCheck, Users,
} from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import type { DecisionLog } from '@/lib/types';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ApprovalDetail {
  id: string;
  ticket_id: string;
  email_id: string | null;
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
  approval_level: number | null;
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  comments: string | null;
  token_expires_at: string;
  approved_at: string | null;
  approved_by: string | null;
  rejected_at: string | null;
  rejected_by: string | null;
  created_at: string;
  approval_type?: string | null;
}

interface AuditEntry {
  id: string;
  event: string;
  actor: string;
  comments: string | null;
  previous_status: string | null;
  new_status: string | null;
  created_at: string;
}

interface SimilarCase {
  id: string;
  emailSubject: string;
  finalResponse: string;
  intent: string;
  department: string;
  similarity: number;
}

// ─── Config maps ─────────────────────────────────────────────────────────────

const statusConfig: Record<string, { label: string; color: string; bg: string; icon: React.ElementType }> = {
  pending:  { label: 'Pending',  color: '#f59e0b', bg: 'rgba(245,158,11,0.12)',  icon: Clock },
  approved: { label: 'Approved', color: '#10b981', bg: 'rgba(16,185,129,0.12)', icon: CheckCircle2 },
  rejected: { label: 'Rejected', color: '#ef4444', bg: 'rgba(239,68,68,0.12)',  icon: XCircle },
  expired:  { label: 'Expired',  color: '#6b7280', bg: 'rgba(107,114,128,0.12)', icon: AlertTriangle },
};

const sentimentConfig: Record<string, { label: string; color: string; bg: string }> = {
  positive: { label: 'Positive', color: '#10b981', bg: 'rgba(16,185,129,0.12)' },
  neutral:  { label: 'Neutral',  color: '#64748b', bg: 'rgba(100,116,139,0.12)' },
  negative: { label: 'Negative', color: '#ef4444', bg: 'rgba(239,68,68,0.12)' },
};

const decisionConfig: Record<string, { label: string; color: string; bg: string; border: string; icon: React.ElementType }> = {
  ESCALATE:                { label: '🚨 ESCALATE',               color: '#ef4444', bg: 'rgba(239,68,68,0.08)',   border: 'rgba(239,68,68,0.25)',   icon: Siren },
  HUMAN_APPROVAL_REQUIRED: { label: '👤 APPROVAL REQUIRED',      color: '#f59e0b', bg: 'rgba(245,158,11,0.08)', border: 'rgba(245,158,11,0.25)',   icon: ShieldAlert },
  AUTO_RESPONSE:           { label: '⚡ AUTO RESPONSE',           color: '#10b981', bg: 'rgba(16,185,129,0.08)', border: 'rgba(16,185,129,0.25)',   icon: Zap },
};

const riskColors: Record<string, string> = {
  Critical: '#ef4444', High: '#f97316', Medium: '#eab308', Low: '#22c55e',
};

const eventLabels: Record<string, { label: string; color: string }> = {
  created:       { label: 'Request Created',    color: '#818cf8' },
  email_sent:    { label: 'Notification Sent',  color: '#0ea5e9' },
  approved:      { label: 'Request Approved ✓', color: '#10b981' },
  rejected:      { label: 'Request Rejected',   color: '#ef4444' },
  expired:       { label: 'Request Expired',    color: '#6b7280' },
  viewed:        { label: 'Link Viewed',        color: '#f59e0b' },
  reminder_sent: { label: 'Reminder Sent',      color: '#f97316' },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const h = Math.floor(diff / 3600000);
  const m = Math.floor(diff / 60000);
  if (h >= 24) return `${Math.floor(h / 24)}d ago`;
  if (h > 0) return `${h}h ago`;
  if (m > 0) return `${m}m ago`;
  return 'just now';
}

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function capitalize(s: string | null | undefined): string {
  if (!s) return '—';
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function InfoRow({ label, value, mono, badge, badgeColor }: {
  label: string;
  value: string | null | number;
  mono?: boolean;
  badge?: boolean;
  badgeColor?: string;
}) {
  return (
    <div className="flex items-start gap-3 py-2 border-b border-[#E5E7EB] last:border-0">
      <span className="text-xs text-[#6B7280] w-36 shrink-0 mt-0.5">{label}</span>
      {badge && badgeColor ? (
        <span
          className="text-xs font-semibold px-2 py-0.5 rounded-full"
          style={{ color: badgeColor, background: `${badgeColor}22` }}
        >
          {value ?? '—'}
        </span>
      ) : (
        <span className={cn('text-sm text-[#374151] flex-1', mono && 'font-mono text-xs text-[#6B7280] break-all')}>
          {value ?? '—'}
        </span>
      )}
    </div>
  );
}

function SectionCard({ title, icon: Icon, iconColor, children, collapsible = false }: {
  title: string;
  icon: React.ElementType;
  iconColor: string;
  children: React.ReactNode;
  collapsible?: boolean;
}) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="bg-white border border-[#E5E7EB] rounded-2xl overflow-hidden shadow-sm">
      <div
        className={cn('flex items-center gap-2 p-5 pb-4', collapsible && 'cursor-pointer hover:bg-gray-50')}
        onClick={collapsible ? () => setCollapsed(!collapsed) : undefined}
      >
        <div className="h-7 w-7 rounded-lg flex items-center justify-center" style={{ background: `${iconColor}22` }}>
          <Icon className="h-3.5 w-3.5" style={{ color: iconColor }} />
        </div>
        <h2 className="text-sm font-semibold text-[#111827] flex-1">{title}</h2>
        {collapsible && (
          collapsed
            ? <ChevronDown className="h-4 w-4 text-[#6B7280]" />
            : <ChevronUp className="h-4 w-4 text-[#6B7280]" />
        )}
      </div>
      {!collapsed && <div className="px-5 pb-5">{children}</div>}
    </div>
  );
}

// ─── AI Decision Banner ────────────────────────────────────────────────────────
// Prominently shows the AI's decision (ESCALATE / HUMAN_APPROVAL_REQUIRED)
// with risk level and confidence. Scoped 100% to the ticket's decision_log.

function DecisionBanner({
  decision,
  risk,
  confidence,
}: {
  decision: string;
  risk: string | null;
  confidence: number | null;
}) {
  const dc = decisionConfig[decision] ?? decisionConfig.HUMAN_APPROVAL_REQUIRED;
  const BannerIcon = dc.icon;
  const riskColor = riskColors[risk ?? ''] ?? '#94a3b8';

  return (
    <div
      className="rounded-2xl p-4 border flex items-start gap-4"
      style={{ background: dc.bg, borderColor: dc.border }}
    >
      <div className="h-10 w-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: `${dc.color}22` }}>
        <BannerIcon className="h-5 w-5" style={{ color: dc.color }} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold" style={{ color: dc.color }}>{dc.label}</p>
        <p className="text-xs text-[#6B7280] mt-0.5">AI decision — manager approval required before department routing</p>
      </div>
      <div className="flex items-center gap-3 shrink-0 flex-wrap">
        {risk && (
          <div className="text-center">
            <p className="text-[10px] text-[#9CA3AF] uppercase tracking-wide">Risk</p>
            <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ color: riskColor, background: `${riskColor}22` }}>
              {risk}
            </span>
          </div>
        )}
        {confidence != null && (
          <div className="text-center">
            <p className="text-[10px] text-[#9CA3AF] uppercase tracking-wide">AI Confidence</p>
            <span className="text-xs font-bold text-[#111827]">{confidence}%</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Decision Result Card ─────────────────────────────────────────────────────
// Shown permanently once status is approved or rejected. Replaces action buttons.

function DecisionCard({ approval }: { approval: ApprovalDetail }) {
  const isApproved = approval.status === 'approved';

  const color = isApproved ? '#10b981' : '#ef4444';
  const bgColor = isApproved ? 'rgba(16,185,129,0.08)' : 'rgba(239,68,68,0.08)';
  const borderColor = isApproved ? 'rgba(16,185,129,0.2)' : 'rgba(239,68,68,0.2)';
  const Icon = isApproved ? CheckCircle2 : XCircle;
  const label = isApproved ? 'Approved' : 'Rejected';
  const decisionBy = isApproved ? approval.approved_by : approval.rejected_by;
  const decisionAt = isApproved ? approval.approved_at : approval.rejected_at;

  return (
    <div
      className="rounded-2xl p-5 border"
      style={{ background: bgColor, borderColor }}
    >
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <div className="h-10 w-10 rounded-xl flex items-center justify-center" style={{ background: `${color}22` }}>
          <Icon className="h-5 w-5" style={{ color }} />
        </div>
        <div>
          <p className="text-base font-bold" style={{ color }}>
            {isApproved ? '✓ Request Approved' : '✗ Request Rejected'}
          </p>
          <p className="text-xs text-gray-500 mt-0.5">This decision is final and cannot be changed</p>
        </div>
        {/* Immutable lock badge */}
        <div className="ml-auto flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-gray-100 border border-[#E5E7EB]">
          <Lock className="h-3 w-3 text-[#6B7280]" />
          <span className="text-xs text-[#6B7280] font-medium">Immutable</span>
        </div>
      </div>

      {/* Decision details */}
      <div className="space-y-2.5">
        <div className="flex items-center gap-3">
          <span className="text-xs text-[#6B7280] w-28 shrink-0">{label} By</span>
          <span className="text-sm text-[#374151] font-medium">
            {decisionBy ?? approval.manager_name ?? '—'}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-[#6B7280] w-28 shrink-0">{label} At</span>
          <span className="text-sm text-[#374151]">{formatDateTime(decisionAt)}</span>
        </div>
        {approval.comments && (
          <div className="mt-3 p-3 rounded-xl bg-gray-50 border border-[#E5E7EB]">
            <p className="text-xs text-[#6B7280] mb-1 font-semibold uppercase tracking-wide">
              {isApproved ? 'Approval Notes' : 'Rejection Reason'}
            </p>
            <p className="text-sm text-[#374151] leading-relaxed">{approval.comments}</p>
          </div>
        )}
        {isApproved && (
          <p className="text-xs text-emerald-400/70 mt-2 flex items-center gap-1.5">
            <CheckCircle2 className="h-3 w-3" />
            Automatically assigned to {approval.department ?? 'department'} queue
          </p>
        )}
        {!isApproved && (
          <p className="text-xs text-red-400/70 mt-2 flex items-center gap-1.5">
            <Mail className="h-3 w-3" />
            Rejection email sent to {approval.employee_email ?? 'employee'} · Ticket closed
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function ApprovalDetailPage({ params }: { params: { id: string } }) {
  const { id } = params;

  const [approval, setApproval] = useState<ApprovalDetail | null>(null);
  const [decisionLog, setDecisionLog] = useState<DecisionLog | null>(null);
  const [auditLog, setAuditLog] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);

  // Action state
  const [actionLoading, setActionLoading] = useState(false);
  const [actionFired, setActionFired] = useState(false);

  const [comment, setComment] = useState('');
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  // Extended data (all scoped to this ticket)
  const [emailBody, setEmailBody] = useState<string | null>(null);
  const [emailSentiment, setEmailSentiment] = useState<string | null>(null);
  const [employeeDesignation, setEmployeeDesignation] = useState<string | null>(null);
  const [similarCases, setSimilarCases] = useState<SimilarCase[]>([]);
  const [recommendedActions, setRecommendedActions] = useState<string[]>([]);
  const [generatedResponse, setGeneratedResponse] = useState<string | null>(null);

  // ── Fetch ─────────────────────────────────────────────────────────────────

  const fetchDetail = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/approvals/${id}`, {
        cache: 'no-store',
        headers: { 'Pragma': 'no-cache', 'Cache-Control': 'no-cache' },
      });
      if (!res.ok) throw new Error('Not found');
      const data = await res.json();

      const ap: ApprovalDetail = data.approval;
      setApproval(ap);
      setAuditLog(data.auditLog ?? []);

      // decisionLog — scoped to this ticket, contains the REAL AI decision
      setDecisionLog(data.decisionLog ?? null);

      setActionFired(false);
      if (ap.status !== 'pending') {
        setErrorBanner(null);
      }

      // Fetch extended data in parallel — all scoped to ap.ticket_id
      await Promise.all([
        fetchEmailData(ap),
        fetchEmployeeDesignation(ap),
        fetchSimilarCases(ap),
        fetchTicketData(ap, data.decisionLog ?? null),
      ]);
    } catch (err) {
      console.error('Detail fetch error:', err);
      setActionFired(false);
    } finally {
      setLoading(false);
    }
  }, [id]);

  // Fetch original email body + sentiment — scoped to ap.email_id
  const fetchEmailData = async (ap: ApprovalDetail) => {
    if (!ap.email_id) return;
    try {
      const { data } = await supabase
        .from('emails')
        .select('body, sentiment')
        .eq('id', ap.email_id)
        .maybeSingle();
      if (data?.body) setEmailBody(data.body);
      if (data?.sentiment) setEmailSentiment(data.sentiment);
    } catch { /* non-fatal */ }
  };

  // Fetch designation from employees table
  const fetchEmployeeDesignation = async (ap: ApprovalDetail) => {
    if (!ap.employee_email) return;
    try {
      const { data } = await supabase
        .from('employees')
        .select('designation')
        .ilike('employee_email', ap.employee_email)
        .maybeSingle();
      if (data?.designation) setEmployeeDesignation(data.designation);
    } catch { /* non-fatal */ }
  };

  // Fetch similar resolved cases
  const fetchSimilarCases = async (ap: ApprovalDetail) => {
    if (!ap.intent) return;
    try {
      const res = await fetch('/api/approvals/similar-cases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ intent: ap.intent, limit: 3 }),
      });
      if (res.ok) {
        const data = await res.json();
        setSimilarCases(data.cases ?? []);
      }
    } catch { /* non-fatal */ }
  };

  // Fetch recommended actions + generated response — STRICTLY scoped to this ticket_id.
  // If the actions/responses tables have stale rows from an old classification,
  // we compare the action's department against the current decision_log department.
  // If they don't match, we skip the stale rows and fall back to decisionLog.ai_summary.
  const fetchTicketData = async (ap: ApprovalDetail, dl: DecisionLog | null) => {
    if (!ap.ticket_id) return;
    try {
      const [actionsRes, responseRes] = await Promise.all([
        supabase
          .from('actions')
          .select('recommended_action, created_at')
          .eq('ticket_id', ap.ticket_id)
          .order('created_at', { ascending: false }),
        supabase
          .from('responses')
          .select('response, created_at')
          .eq('ticket_id', ap.ticket_id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

      // ── Recommended Actions ───────────────────────────────────────────────────
      // Only use DB actions if they are fresh (created after the decision_log)
      // OR if no decision_log exists (legacy path).
      const decisionLogCreatedAt = dl?.created_at ?? null;

      if (actionsRes.data && actionsRes.data.length > 0) {
        // Check if the newest action is after the current decision_log
        const newestAction = actionsRes.data[0];
        const actionIsStale = decisionLogCreatedAt
          ? new Date(newestAction.created_at) < new Date(decisionLogCreatedAt)
          : false;

        if (!actionIsStale) {
          // Fresh actions — use them
          setRecommendedActions(
            actionsRes.data.map((a: any) => a.recommended_action).filter(Boolean)
          );
        } else {
          // Stale actions — fall back to ai_summary from decision_log
          if (dl?.ai_summary) {
            // Parse bullet-point summary into individual actions
            const lines = dl.ai_summary
              .split(/\n|•|\d+\.\s/)
              .map((l: string) => l.trim())
              .filter((l: string) => l.length > 10);
            setRecommendedActions(lines);
          }
        }
      } else if (dl?.ai_summary) {
        // No actions in DB — use ai_summary as fallback
        const lines = dl.ai_summary
          .split(/\n|•|\d+\.\s/)
          .map((l: string) => l.trim())
          .filter((l: string) => l.length > 10);
        setRecommendedActions(lines);
      }

      // ── Generated Response ────────────────────────────────────────────────────
      // Only use DB response if it was created after the current decision_log
      // (i.e., it was generated for THIS classification, not an old one).
      if (responseRes.data?.response) {
        const responseIsStale = decisionLogCreatedAt
          ? new Date(responseRes.data.created_at) < new Date(decisionLogCreatedAt)
          : false;

        if (!responseIsStale) {
          setGeneratedResponse(responseRes.data.response);
        }
        // If stale, show nothing — avoids showing IT response for an HR ticket
      }
    } catch { /* non-fatal */ }
  };

  useEffect(() => { fetchDetail(); }, [fetchDetail]);

  // ── Realtime ─────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!id) return;
    const channel = supabase
      .channel(`approval_detail_${id}_v3`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'approval_requests',
        filter: `id=eq.${id}`,
      }, () => { fetchDetail(); })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [id, fetchDetail]);

  // ── Actions ───────────────────────────────────────────────────────────────────

  const handleAction = async (action: 'approved' | 'rejected', comments?: string) => {
    setActionFired(true);
    setActionLoading(true);
    setErrorBanner(null);

    try {
      const res = await fetch(`/api/approvals/${id}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, comments: comments ?? comment }),
      });

      const data = await res.json();

      if (res.status === 409 || data.code === 'APPROVAL_ALREADY_PROCESSED') {
        if (data.approval) setApproval(data.approval);
        setActionFired(false);
        setShowRejectModal(false);
        fetchDetail();
        return;
      }

      if (!res.ok || !data.success) {
        setActionFired(false);
        setErrorBanner(data.error ?? 'Action failed. Please try again.');
        return;
      }

      if (data.approval) {
        setApproval((prev) => ({
          ...(prev ?? {}),
          ...data.approval,
          status: data.approval.status,
        } as ApprovalDetail));
      }
      setActionFired(false);
      setShowRejectModal(false);
      fetchDetail(); // background refresh for audit log
    } catch {
      setActionFired(false);
      setErrorBanner('Network error. Please try again.');
    } finally {
      setActionLoading(false);
    }
  };

  // ── Loading / Error states ────────────────────────────────────────────────────

  if (loading && !approval) {
    return (
      <div className="flex min-h-screen bg-[#F8FAFC]">
        <Sidebar />
        <div className="flex-1 min-h-screen bg-[#F8FAFC]">
          <div className="flex items-center justify-center h-full min-h-screen">
            <div className="flex gap-2 items-center text-[#6B7280]">
              <RefreshCw className="h-4 w-4 animate-spin" />
              <span>Loading approval details...</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!approval) {
    return (
      <div className="flex min-h-screen bg-[#F8FAFC]">
        <Sidebar />
        <div className="flex-1 min-h-screen flex items-center justify-center bg-[#F8FAFC]">
          <div className="text-center">
            <AlertTriangle className="h-12 w-12 text-[#9CA3AF] mx-auto mb-3" />
            <p className="text-[#6B7280]">Approval not found</p>
            <Link href="/approvals" className="text-violet-500 text-sm mt-2 hover:underline">← Back to queue</Link>
          </div>
        </div>
      </div>
    );
  }

  // ── Derived values — always prefer decisionLog (ticket-scoped) ───────────────

  // AI Confidence: decisionLog is authoritative; fall back to approval_requests.ai_confidence
  const aiConfidence: number | null = decisionLog?.confidence ?? approval.ai_confidence ?? null;

  // Risk Level: decisionLog is authoritative
  const riskLevel: string | null = decisionLog?.risk_level ?? approval.risk_level ?? null;
  const riskColor = riskColors[riskLevel ?? ''] ?? '#94a3b8';

  // Decision type (ESCALATE | HUMAN_APPROVAL_REQUIRED | AUTO_RESPONSE)
  const aiDecision: string | null = decisionLog?.decision ?? null;

  // Approval Reason: prefer detailed escalation_reason, then ai_summary, then approval.ai_reason
  const approvalReason: string | null =
    decisionLog?.escalation_reason ||
    decisionLog?.ai_summary ||
    approval.ai_reason ||
    null;

  // Sentiment — from email table
  const sc = statusConfig[approval.status] ?? statusConfig.pending;
  const StatusIcon = sc.icon;
  const sentConf = sentimentConfig[emailSentiment?.toLowerCase() ?? ''] ?? null;

  const hoursElapsed = (Date.now() - new Date(approval.created_at).getTime()) / 3600000;
  const isOverdue = approval.status === 'pending' && hoursElapsed > 24;

  const isPending = approval.status === 'pending';
  const showActionButtons = isPending && !actionFired;

  // Is this an acceptance approval (assigned officer accepting case) vs manager approval?
  const isAcceptance = approval.approval_type === 'acceptance';

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="flex min-h-screen bg-[#F8FAFC]">
      <Sidebar />
      <div className="flex-1 min-h-screen overflow-auto bg-[#F8FAFC]">

        <div className="relative z-10 max-w-6xl mx-auto px-4 sm:px-6 py-8 space-y-6">

          {/* Back nav */}
          <Link href="/approvals" className="inline-flex items-center gap-2 text-[#6B7280] hover:text-[#374151] text-sm transition-colors">
            <ArrowLeft className="h-4 w-4" />
            Back to Approval Queue
          </Link>

          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
            <div>
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-2xl font-bold text-[#111827]">
                  {approval.intent ?? 'Approval Request'}
                </h1>
                {isOverdue && (
                  <span className="text-xs font-semibold text-red-400 flex items-center gap-1 px-2 py-1 rounded-full bg-red-500/10 border border-red-500/20">
                    <AlertCircle className="h-3 w-3 animate-pulse" />
                    SLA Exceeded
                  </span>
                )}
                {isAcceptance && (
                  <span className="text-xs font-semibold text-blue-600 px-2 py-1 rounded-full bg-blue-100 border border-blue-200">
                    Case Acceptance
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3 mt-2 flex-wrap">
                <div
                  className="flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-semibold"
                  style={{ background: sc.bg, color: sc.color }}
                >
                  <StatusIcon className="h-3.5 w-3.5" />
                  {sc.label}
                </div>
                <span className="text-[#6B7280] text-sm">{timeAgo(approval.created_at)}</span>
                {sentConf && (
                  <span
                    className="text-xs font-semibold px-2 py-0.5 rounded-full"
                    style={{ color: sentConf.color, background: sentConf.bg }}
                  >
                    {sentConf.label} Sentiment
                  </span>
                )}
                {/* Department / Team breadcrumb */}
                {approval.department && (
                  <span className="text-xs text-[#9CA3AF] flex items-center gap-1">
                    <Building2 className="h-3 w-3" />
                    {approval.department}
                    {approval.team_name && ` › ${approval.team_name}`}
                  </span>
                )}
              </div>
            </div>

            {/* ACTION BUTTONS */}
            {showActionButtons && (
              <div className="flex gap-3 shrink-0">
                <button
                  id="btn-approve"
                  onClick={() => handleAction('approved')}
                  disabled={actionLoading}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-white text-sm font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-emerald-500/20"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  {actionLoading ? 'Processing…' : 'Approve'}
                </button>
                <button
                  id="btn-reject"
                  onClick={() => setShowRejectModal(true)}
                  disabled={actionLoading}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-white hover:bg-gray-50 border border-[#E5E7EB] text-[#374151] text-sm font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
                >
                  <XCircle className="h-4 w-4" />
                  Reject
                </button>
              </div>
            )}

            {/* Processing indicator */}
            {actionFired && isPending && (
              <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gray-100 border border-[#E5E7EB] text-[#6B7280] text-sm shrink-0">
                <RefreshCw className="h-4 w-4 animate-spin" />
                Processing decision…
              </div>
            )}
          </div>

          {/* Error banner */}
          {errorBanner && (
            <div className="flex items-center gap-3 p-4 rounded-xl border bg-amber-500/10 border-amber-500/20 text-amber-600 text-sm">
              <AlertCircle className="h-5 w-5 shrink-0" />
              {errorBanner}
            </div>
          )}

          {/* AI Decision Banner — shown when we have a decision_log */}
          {aiDecision && (
            <DecisionBanner
              decision={aiDecision}
              risk={riskLevel}
              confidence={aiConfidence}
            />
          )}

          {/* Decision Result Card — shown after approval/rejection */}
          {(approval.status === 'approved' || approval.status === 'rejected') && (
            <DecisionCard approval={approval} />
          )}

          {/* ── 3-column grid ── */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

            {/* ── LEFT column (2/3) ── */}
            <div className="lg:col-span-2 space-y-5">

              {/* 1. Employee Information */}
              <SectionCard title="Employee Information" icon={User} iconColor="#6366f1">
                <InfoRow label="Full Name"   value={approval.employee_name} />
                <InfoRow label="Email"       value={approval.employee_email} />
                <InfoRow label="Designation" value={employeeDesignation} />
                <InfoRow label="Department"  value={approval.department} />
                <InfoRow label="Team"        value={approval.team_name} />
              </SectionCard>

              {/* 2. AI Analysis — all values from decisionLog (ticket-scoped) */}
              <SectionCard title="AI Analysis" icon={Brain} iconColor="#d97706">
                <InfoRow
                  label="Classification"
                  value={approval.intent}
                />
                <InfoRow
                  label="Priority"
                  value={capitalize(approval.priority)}
                />
                {/* Risk Level — from decisionLog, never stale */}
                <div className="flex items-start gap-3 py-2 border-b border-[#F3F4F6]">
                  <span className="text-xs text-[#6B7280] w-36 shrink-0 mt-0.5">Risk Level</span>
                  <span className="text-sm font-semibold" style={{ color: riskColor }}>
                    {riskLevel ?? '—'}
                  </span>
                </div>
                {/* Decision type */}
                {aiDecision && (
                  <div className="flex items-start gap-3 py-2 border-b border-[#F3F4F6]">
                    <span className="text-xs text-[#6B7280] w-36 shrink-0 mt-0.5">AI Decision</span>
                    <span
                      className="text-xs font-bold px-2 py-0.5 rounded-full"
                      style={{
                        color: decisionConfig[aiDecision]?.color ?? '#94a3b8',
                        background: decisionConfig[aiDecision]?.bg ?? 'transparent',
                      }}
                    >
                      {aiDecision.replace(/_/g, ' ')}
                    </span>
                  </div>
                )}
                {/* AI Confidence — from decisionLog */}
                <InfoRow
                  label="AI Confidence"
                  value={aiConfidence != null ? `${aiConfidence}%` : null}
                />
                {/* Sentiment */}
                {sentConf && (
                  <div className="flex items-start gap-3 py-2 border-b border-[#F3F4F6]">
                    <span className="text-xs text-[#6B7280] w-36 shrink-0 mt-0.5">Sentiment</span>
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-full"
                      style={{ color: sentConf.color, background: sentConf.bg }}>
                      {sentConf.label}
                    </span>
                  </div>
                )}
                {/* Recommended Dept from decision_log */}
                {decisionLog?.recommended_department && (
                  <InfoRow label="Routed To" value={`${decisionLog.recommended_department}${decisionLog.recommended_subteam ? ` › ${decisionLog.recommended_subteam}` : ''}`} />
                )}
                {/* Confidence bar */}
                {aiConfidence != null && (
                  <div className="mt-3 space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-[#6B7280]">Confidence Score</span>
                      <span className="font-semibold text-[#111827]">{aiConfidence}%</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-[#E5E7EB] overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-700"
                        style={{
                          width: `${aiConfidence}%`,
                          background: aiConfidence >= 90 ? '#10b981'
                            : aiConfidence >= 70 ? '#f59e0b' : '#ef4444',
                        }}
                      />
                    </div>
                  </div>
                )}
                {/* Approval Reason — from decisionLog (never "No reason provided" if data exists) */}
                {approvalReason && (
                  <div className="mt-4 p-4 rounded-xl bg-amber-50 border border-amber-100">
                    <p className="text-xs text-amber-600 mb-1 font-semibold uppercase tracking-wide">Approval Reason</p>
                    <p className="text-sm text-[#374151] leading-relaxed">{approvalReason}</p>
                  </div>
                )}
              </SectionCard>

              {/* 3. Approval Chain */}
              <SectionCard title="Approval Chain" icon={GitBranch} iconColor="#6366f1">
                <div className="flex flex-col gap-0">

                  {/* ── STEP 1: EMPLOYEE ── */}
                  <div className="flex items-start gap-3">
                    <div className="flex flex-col items-center shrink-0">
                      <div className="h-10 w-10 rounded-full bg-indigo-100 border-2 border-indigo-200 flex items-center justify-center text-sm font-bold text-indigo-600">
                        {(approval.employee_name ?? '?').split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()}
                      </div>
                    </div>
                    <div className="pt-0.5">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-indigo-500 mb-0.5">
                        Step 1 — Employee
                      </p>
                      <p className="text-sm font-semibold text-[#111827]">{approval.employee_name ?? 'Unknown'}</p>
                      <p className="text-xs text-[#6B7280]">{approval.employee_email ?? ''}</p>
                      {employeeDesignation && <p className="text-xs text-[#9CA3AF]">{employeeDesignation}</p>}
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700 bg-emerald-100 border border-emerald-200 rounded-full px-2 py-0.5 mt-1">
                        <CheckCircle2 className="h-2.5 w-2.5" /> Submitted
                      </span>
                    </div>
                  </div>

                  {/* Connector */}
                  <div className="flex items-center gap-3 pl-4 py-2">
                    <div className="flex flex-col items-center">
                      <div className="w-0.5 h-3 bg-[#E5E7EB]" />
                      <ChevronRight className="h-3.5 w-3.5 text-[#9CA3AF] rotate-90" />
                      <div className="w-0.5 h-3 bg-[#E5E7EB]" />
                    </div>
                    <span className="text-xs text-[#9CA3AF]">
                      {isAcceptance ? 'Case Acceptance' : `Approval Level ${approval.approval_level ?? 1}`}
                    </span>
                  </div>

                  {/* ── STEP 2: APPROVER ── */}
                  <div className="flex items-start gap-3">
                    <div className="flex flex-col items-center shrink-0">
                      <div className={cn(
                        'h-10 w-10 rounded-full border-2 flex items-center justify-center text-sm font-bold',
                        approval.status === 'approved'
                          ? 'bg-emerald-50 border-emerald-200 text-emerald-600'
                          : approval.status === 'rejected'
                          ? 'bg-red-50 border-red-200 text-red-600'
                          : 'bg-amber-50 border-amber-200 text-amber-600'
                      )}>
                        {approval.manager_name
                          ? approval.manager_name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()
                          : '?'}
                      </div>
                    </div>
                    <div className="pt-0.5 min-w-0">
                      <p className={cn(
                        'text-[10px] font-bold uppercase tracking-widest mb-0.5',
                        approval.status === 'approved' ? 'text-emerald-600'
                          : approval.status === 'rejected' ? 'text-red-600'
                          : 'text-amber-500'
                      )}>
                        Step 2 — {isAcceptance ? 'Assigned Officer' : 'Approver'}
                      </p>
                      <p className="text-sm font-semibold text-[#111827]">{approval.manager_name ?? 'Unassigned'}</p>
                      <p className="text-xs text-[#6B7280]">{approval.manager_email ?? ''}</p>
                      <div className={cn(
                        'text-xs mt-1 font-medium',
                        approval.status === 'approved' ? 'text-emerald-600'
                          : approval.status === 'rejected' ? 'text-red-600'
                          : 'text-amber-600'
                      )}>
                        {approval.status === 'approved' ? '✓ Approved'
                          : approval.status === 'rejected' ? '✗ Rejected'
                          : '⏳ Awaiting Decision'}
                      </div>
                    </div>
                  </div>
                </div>
              </SectionCard>

              {/* 4. Original Email */}
              {emailBody && (
                <SectionCard title="Original Email" icon={FileText} iconColor="#0284c7" collapsible>
                  <div className="bg-gray-50 rounded-xl p-4 border border-[#E5E7EB] max-h-72 overflow-y-auto">
                    <pre className="text-xs text-[#374151] whitespace-pre-wrap font-sans leading-relaxed">
                      {emailBody.slice(0, 1500)}{emailBody.length > 1500 ? '…' : ''}
                    </pre>
                  </div>
                </SectionCard>
              )}

              {/* 5. Recommended Actions — stale-safe */}
              {recommendedActions.length > 0 && (
                <SectionCard title="Recommended Actions" icon={Wrench} iconColor="#f97316" collapsible>
                  <div className="space-y-2">
                    {recommendedActions.map((action, i) => (
                      <div key={i} className="flex items-start gap-2.5 p-3 rounded-lg bg-orange-50 border border-orange-100">
                        <div className="h-5 w-5 rounded-full bg-orange-200 flex items-center justify-center text-orange-600 text-[10px] font-bold shrink-0 mt-0.5">
                          {i + 1}
                        </div>
                        <p className="text-sm text-[#374151]">{action}</p>
                      </div>
                    ))}
                  </div>
                </SectionCard>
              )}

              {/* 6. Generated AI Response — stale-safe */}
              {generatedResponse && (
                <SectionCard title="Generated Response" icon={Zap} iconColor="#10b981" collapsible>
                  <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-4 max-h-64 overflow-y-auto">
                    <pre className="text-xs text-[#374151] whitespace-pre-wrap font-sans leading-relaxed">
                      {generatedResponse.slice(0, 1200)}{generatedResponse.length > 1200 ? '…' : ''}
                    </pre>
                  </div>
                  <p className="text-xs text-[#9CA3AF] mt-2">AI-generated response — pending manager approval to send</p>
                </SectionCard>
              )}

              {/* 7. Similar Cases */}
              {similarCases.length > 0 && (
                <SectionCard title="Similar Resolved Cases" icon={Search} iconColor="#0284c7" collapsible>
                  <div className="space-y-3">
                    {similarCases.map((c) => (
                      <div key={c.id} className="p-3 rounded-xl bg-gray-50 border border-[#E5E7EB]">
                        <div className="flex items-center justify-between mb-1.5">
                          <p className="text-sm font-medium text-[#111827] truncate flex-1 mr-3">{c.emailSubject}</p>
                          <span className="text-xs font-bold text-violet-600 bg-violet-100 px-2 py-0.5 rounded-full shrink-0">
                            {(c.similarity * 100).toFixed(0)}% match
                          </span>
                        </div>
                        <div className="flex items-center gap-2 mb-1.5">
                          <span className="text-xs text-[#9CA3AF]">{c.intent}</span>
                          {c.department && (
                            <>
                              <span className="text-[#D1D5DB]">·</span>
                              <span className="text-xs text-[#9CA3AF]">{c.department}</span>
                            </>
                          )}
                        </div>
                        <p className="text-xs text-[#6B7280] line-clamp-2">{c.finalResponse}</p>
                      </div>
                    ))}
                  </div>
                </SectionCard>
              )}

              {/* 8. Comment box — ONLY visible when pending */}
              {isPending && !actionFired && (
                <SectionCard title="Comments (Optional)" icon={MessageSquare} iconColor="#64748b">
                  <textarea
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    placeholder="Add context or comments for the employee or team..."
                    rows={3}
                    className="w-full bg-white border border-[#E5E7EB] rounded-xl px-4 py-3 text-sm text-[#111827] placeholder-[#9CA3AF] focus:outline-none focus:border-violet-500/50 resize-none"
                  />
                </SectionCard>
              )}

            </div>

            {/* ── RIGHT column (1/3) ── */}
            <div className="space-y-5">

              {/* Approval Info */}
              <SectionCard title="Approval Info" icon={Shield} iconColor="#6366f1">
                <InfoRow
                  label={isAcceptance ? 'Assigned Officer' : 'Approver'}
                  value={approval.manager_name}
                />
                <InfoRow
                  label={isAcceptance ? 'Officer Email' : 'Approver Email'}
                  value={approval.manager_email}
                />
                <InfoRow label="Created"   value={formatDateTime(approval.created_at)} />
                <InfoRow label="Expires"   value={formatDateTime(approval.token_expires_at)} />
                <InfoRow label="Ticket ID" value={approval.ticket_id} mono />
              </SectionCard>

              {/* Ticket Timeline */}
              <SectionCard title="Ticket Timeline" icon={TrendingUp} iconColor="#0284c7">
                <div className="space-y-0">
                  {[
                    {
                      label: 'Email Submitted',
                      done: true,
                      time: null,
                    },
                    {
                      label: 'AI Analysis Complete',
                      done: !!decisionLog,
                      time: decisionLog?.created_at ?? null,
                    },
                    {
                      label: 'Manager Notified',
                      done: auditLog.some(e => e.event === 'email_sent'),
                      time: auditLog.find(e => e.event === 'email_sent')?.created_at ?? null,
                    },
                    {
                      label: 'Manager Decision',
                      done: approval.status === 'approved' || approval.status === 'rejected',
                      current: isPending,
                      time: approval.approved_at ?? approval.rejected_at,
                    },
                    {
                      label: 'Department Assigned',
                      done: approval.status === 'approved',
                      current: false,
                      time: null,
                    },
                    {
                      label: 'Department Processing',
                      done: false,
                      current: false,
                      time: null,
                    },
                    {
                      label: approval.status === 'rejected' ? 'Ticket Closed' : 'Resolved',
                      done: approval.status === 'rejected',
                      current: false,
                      time: approval.rejected_at,
                    },
                  ].map((step: any, i, arr) => (
                    <div key={i} className="flex gap-3">
                      <div className="flex flex-col items-center" style={{ minWidth: '24px' }}>
                        <div className={cn(
                          'h-6 w-6 rounded-full border-2 flex items-center justify-center text-xs font-bold shrink-0',
                          step.done
                            ? 'bg-emerald-500 border-emerald-500 text-white'
                            : step.current
                            ? 'bg-amber-50 border-amber-400 text-amber-600'
                            : 'bg-gray-50 border-gray-300 text-gray-400'
                        )}>
                          {step.done ? '✓' : i + 1}
                        </div>
                        {i < arr.length - 1 && (
                          <div
                            className={cn('w-0.5 my-1', step.done ? 'bg-emerald-300' : 'bg-gray-200')}
                            style={{ minHeight: '20px', flexGrow: 1 }}
                          />
                        )}
                      </div>
                      <div className="pb-4 min-w-0">
                        <p className={cn(
                          'text-sm font-medium leading-snug',
                          step.done ? 'text-emerald-700'
                            : step.current ? 'text-amber-600'
                            : 'text-gray-400'
                        )}>
                          {step.label}
                        </p>
                        {step.current && (
                          <p className="text-xs text-amber-500 mt-0.5">Awaiting decision</p>
                        )}
                        {step.time && (
                          <p className="text-xs text-gray-400 mt-0.5">{timeAgo(step.time)}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </SectionCard>

              {/* Audit Log */}
              {auditLog.length > 0 && (
                <SectionCard title="Audit Log" icon={Hash} iconColor="#94a3b8">
                  <div className="space-y-3">
                    {auditLog.map((entry) => {
                      const ev = eventLabels[entry.event] ?? { label: entry.event, color: '#94a3b8' };
                      return (
                        <div key={entry.id} className="flex items-start gap-3">
                          <div className="h-2 w-2 rounded-full mt-2 shrink-0" style={{ background: ev.color }} />
                          <div>
                            <p className="text-xs font-semibold" style={{ color: ev.color }}>{ev.label}</p>
                            <p className="text-xs text-[#6B7280]">{entry.actor} · {timeAgo(entry.created_at)}</p>
                            {entry.previous_status && entry.new_status && (
                              <p className="text-xs text-[#9CA3AF] mt-0.5 font-mono">
                                {entry.previous_status} → {entry.new_status}
                              </p>
                            )}
                            {entry.comments && <p className="text-xs text-[#6B7280] mt-0.5">{entry.comments}</p>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </SectionCard>
              )}

            </div>
          </div>
        </div>

        {/* ── Reject Modal ── */}
        {showRejectModal && isPending && !actionFired && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm px-4">
            <div className="bg-white border border-[#E5E7EB] rounded-2xl p-6 w-full max-w-md shadow-xl">
              <h3 className="text-lg font-bold text-[#111827] mb-2">Reject Request</h3>
              <p className="text-sm text-[#6B7280] mb-4">
                Please provide a reason for rejection. The employee will receive a professional rejection email.
              </p>
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Reason for rejection..."
                rows={4}
                autoFocus
                className="w-full bg-white border border-[#E5E7EB] rounded-xl px-4 py-3 text-sm text-[#111827] placeholder-[#9CA3AF] focus:outline-none focus:border-red-400/50 resize-none mb-4"
              />
              <div className="flex gap-3 justify-end">
                <button
                  onClick={() => setShowRejectModal(false)}
                  disabled={actionLoading}
                  className="px-4 py-2 rounded-lg text-sm text-[#6B7280] hover:text-[#374151] transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleAction('rejected', comment)}
                  disabled={actionLoading}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-red-500 hover:bg-red-400 text-white text-sm font-semibold transition-colors disabled:opacity-50"
                >
                  <XCircle className="h-4 w-4" />
                  {actionLoading ? 'Rejecting…' : 'Confirm Reject'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
