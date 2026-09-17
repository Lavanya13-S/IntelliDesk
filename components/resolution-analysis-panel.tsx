'use client';

/**
 * components/resolution-analysis-panel.tsx
 *
 * Resolution Analysis Panel — Engineer-only.
 *
 * Shows structured AI analysis of the ticket to help the engineer resolve it.
 * NEVER generates or displays email copy — that is the Resolution Draft panel's job.
 *
 * Sections:
 *   1. Issue Summary
 *   2. Current Status
 *   3. Recommended Resolution Steps
 *   4. Knowledge Base / Similar Cases
 *   5. Human Verification Required  (only when requires_human)
 *   6. Risk Assessment
 *   7. Next Action
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { generateResolutionAnalysis, type ResolutionAnalysis } from '@/lib/agents';
import { getWorkflowStages, getEscalationWorkflowStages, type WorkflowStateRecord } from '@/lib/workflow-state';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import {
  BrainCircuit, CheckCircle2, AlertTriangle, Loader2,
  Search, ShieldAlert, Zap, Clock, ArrowRight, ListChecks,
  BookOpen, UserCheck, TrendingUp, PhoneForwarded, Tag,
  Building2, Users, Smile, ShieldCheck, X, ExternalLink,
  ClipboardList, Timer, User, Star,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Email, Ticket, ActionData, DecisionResult, DecisionLog } from '@/lib/types';

// ─── Types ────────────────────────────────────────────────────────────────────

interface SimilarCase {
  id: string;
  emailSubject: string;
  finalResponse: string;
  intent: string;
  department: string;
  similarity: number;
}

interface ResolutionAnalysisPanelProps {
  email: Email;
  ticket: Ticket | null;
  decision: DecisionResult | null;
  decisionLog: DecisionLog | null;
  actions: ActionData[];
  similarCases: SimilarCase[];
  ticketApproval: WorkflowStateRecord | null;
  isAnalyzing: boolean;
  isActioning: boolean;
  onExecuteDecision: () => void;
  /** Work item ID created during ESCALATE — for navigation from the escalation card */
  escalationWorkItemId?: string | null;
  /** Live work item data — for showing real-time status in escalation card */
  escalationWorkItem?: any | null;
}

// ─── Priority / Risk color maps ───────────────────────────────────────────────

const RISK_STYLES: Record<string, { badge: string; bg: string; icon: React.ComponentType<{ className?: string }> }> = {
  Critical: { badge: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300 border-red-300', bg: 'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800', icon: ShieldAlert },
  High:     { badge: 'bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300 border-orange-300', bg: 'bg-orange-50 dark:bg-orange-950/30 border-orange-200 dark:border-orange-800', icon: AlertTriangle },
  Medium:   { badge: 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300 border-amber-300', bg: 'bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800', icon: TrendingUp },
  Low:      { badge: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300 border-emerald-300', bg: 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800', icon: CheckCircle2 },
};

const DECISION_STYLES: Record<string, { label: string; badge: string; border: string }> = {
  AUTO_RESPONSE:           { label: 'Auto Resolve', badge: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-200', border: 'border-emerald-400 dark:border-emerald-600' },
  HUMAN_APPROVAL_REQUIRED: { label: 'Approval Required', badge: 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-200', border: 'border-amber-400 dark:border-amber-600' },
  ESCALATE:                { label: 'Escalate', badge: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-200', border: 'border-red-400 dark:border-red-600' },
};

const PRIORITY_STYLES: Record<string, string> = {
  low:      'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300',
  medium:   'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
  high:     'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300',
  critical: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
};

const SENTIMENT_STYLES: Record<string, string> = {
  positive: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
  neutral:  'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  negative: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
};

// ─── Resolved Summary Panel ───────────────────────────────────────────────────
// Shown when ticket.status === 'resolved' | 'completed' — replaces the stale
// AI recommendation with an accurate post-resolution summary.

const COMPLETED_STAGES = [
  'AI Analysis & Classification',
  'Approval Requested',
  'Manager Decision',
  'Department Assignment',
  'Department Processing',
  'Resolution',
];

function ResolvedSummaryPanel({
  ticket,
  email,
  ticketApproval,
}: {
  ticket: Ticket | null;
  email: Email;
  ticketApproval: WorkflowStateRecord | null;
}) {
  const intent      = ticket?.intent      || email.intent      || 'Request';
  const department  = ticket?.department  || email.department  || 'IT';
  const employeeName = email.sender
    ? email.sender.split('@')[0].replace(/[._-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
    : 'the employee';

  return (
    <div className="space-y-4">

      {/* ── Completion banner ───────────────────────────────────────────────── */}
      <div className="rounded-xl border-2 border-emerald-400 dark:border-emerald-600 bg-emerald-50 dark:bg-emerald-950/30 p-4 flex items-start gap-3">
        <div className="w-10 h-10 rounded-full bg-emerald-500 flex items-center justify-center shrink-0">
          <CheckCircle2 className="h-5 w-5 text-white" />
        </div>
        <div>
          <p className="text-sm font-bold text-emerald-800 dark:text-emerald-200">Ticket Successfully Resolved</p>
          <p className="text-xs text-emerald-700 dark:text-emerald-300 mt-0.5 leading-relaxed">
            Resolution email delivered. All workflow stages completed.
          </p>
        </div>
      </div>

      {/* ── Issue Summary ───────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-border bg-card p-4">
        <SectionHeader icon={Tag} label="Issue Summary" />
        <div className="flex flex-wrap gap-2 mb-3">
          {intent && (
            <Badge variant="secondary" className="gap-1 text-xs">
              <Tag className="h-3 w-3" />{intent}
            </Badge>
          )}
          {department && (
            <Badge variant="outline" className="gap-1 text-xs">
              <Building2 className="h-3 w-3" />{department}
            </Badge>
          )}
          <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300 text-xs">
            Resolved
          </Badge>
        </div>
        <p className="text-sm text-foreground leading-relaxed">
          {intent} request from {employeeName} has been successfully completed by the{' '}
          {department} team.
        </p>
      </div>

      {/* ── Current Status: Completed ───────────────────────────────────────── */}
      <div className="rounded-xl border border-border bg-card p-4">
        <SectionHeader icon={CheckCircle2} label="Current Status" />
        <div className="flex items-center gap-2 mb-3">
          <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-200 text-xs font-semibold gap-1">
            <CheckCircle2 className="h-3 w-3" />
            Completed
          </Badge>
        </div>

        {/* All 6 stages ticked */}
        <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-2">
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1">Workflow Progress</p>
          {COMPLETED_STAGES.map((label) => (
            <div key={label} className="flex items-center gap-2.5">
              <div className="w-4 h-4 rounded-full border-2 border-emerald-500 bg-emerald-500 text-white flex items-center justify-center shrink-0 text-[9px] font-bold">
                ✓
              </div>
              <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">{label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Resolution Summary ──────────────────────────────────────────────── */}
      <div className="rounded-xl border border-border bg-card p-4">
        <SectionHeader icon={ListChecks} label="Resolution Summary" />
        <ul className="space-y-2">
          {[
            `${intent} provisioned and configured.`,
            'Required roles and permissions assigned.',
            `${employeeName} notified via resolution email.`,
            'Resolution email delivered to employee inbox.',
            'Ticket closed and archived.',
          ].map((step, i) => (
            <li key={i} className="flex items-start gap-2.5">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0 mt-0.5" />
              <span className="text-sm text-foreground leading-relaxed">{step}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* ── Risk ────────────────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/20 p-4">
        <div className="flex items-center gap-2 mb-2">
          <div className="p-1.5 rounded-md bg-emerald-100 dark:bg-emerald-900/40">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
          </div>
          <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Risk Assessment</p>
          <Badge className="ml-auto bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300 border-emerald-300 text-xs font-bold">
            None
          </Badge>
        </div>
        <p className="text-sm text-foreground leading-relaxed">
          No active risk. Ticket has been fully resolved and the employee has been notified.
        </p>
      </div>

      {/* ── Next Action ─────────────────────────────────────────────────────── */}
      <div className="rounded-xl border-2 border-primary/30 bg-primary/5 p-4">
        <SectionHeader icon={ArrowRight} label="Next Action" />
        <p className="text-sm font-semibold text-foreground leading-relaxed">
          No further action required. Ticket successfully closed.
        </p>
        <p className="text-xs text-muted-foreground mt-1.5">
          This ticket has been archived. The resolution has been logged for future Knowledge Base reference.
        </p>
      </div>

    </div>
  );
}

// ─── Section Header ───────────────────────────────────────────────────────────

function SectionHeader({ icon: Icon, label, accent }: { icon: React.ComponentType<{ className?: string }>; label: string; accent?: string }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <div className={cn('p-1.5 rounded-md', accent || 'bg-primary/10')}>
        <Icon className={cn('h-3.5 w-3.5', accent ? 'text-white' : 'text-primary')} />
      </div>
      <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">{label}</p>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function ResolutionAnalysisPanel({
  email,
  ticket,
  decision,
  decisionLog,
  actions,
  similarCases,
  ticketApproval,
  isAnalyzing,
  isActioning,
  onExecuteDecision,
  escalationWorkItemId,
  escalationWorkItem,
}: ResolutionAnalysisPanelProps) {
  const [analysis, setAnalysis] = useState<ResolutionAnalysis | null>(null);
  const [isLoadingAnalysis, setIsLoadingAnalysis] = useState(false);

  // Generate the structured analysis when decision resolves
  useEffect(() => {
    if (!decision || !ticket || !email) return;
    setIsLoadingAnalysis(true);
    generateResolutionAnalysis(
      ticket.intent || email.intent || 'General Inquiry',
      ticket.department || email.department || 'IT',
      email.subject,
      email.body,
      decision,
      similarCases
    )
      .then(setAnalysis)
      .catch(() => setAnalysis(null))
      .finally(() => setIsLoadingAnalysis(false));
  }, [decision?.decision, ticket?.id]);

  const risk = decision?.risk || 'Medium';
  const riskStyle = RISK_STYLES[risk] || RISK_STYLES.Medium;
  const RiskIcon = riskStyle.icon;

  const decisionKey = decision?.decision || 'AUTO_RESPONSE';
  const decisionStyle = DECISION_STYLES[decisionKey] || DECISION_STYLES.AUTO_RESPONSE;

  // ── RESOLVED / COMPLETED — always show the post-resolution summary ─────────
  // Never show stale "Approval Required" or old AI recommendations after the
  // ticket is closed. This check takes priority over everything else.
  const isResolved = ticket?.status === 'resolved' || ticket?.status === 'completed';
  if (isResolved) {
    return <ResolvedSummaryPanel ticket={ticket} email={email} ticketApproval={ticketApproval} />;
  }

  // ── Loading / empty state ──────────────────────────────────────────────────
  if (!ticket && !decision && !isAnalyzing) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground gap-3">
        <BrainCircuit className="h-10 w-10 opacity-20" />
        <p className="text-sm">Classify this ticket to generate the Resolution Analysis.</p>
      </div>
    );
  }

  if (isAnalyzing || isLoadingAnalysis) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm">Running Resolution Analysis…</p>
        <p className="text-xs opacity-60">Analyzing intent, risks, and knowledge base</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">

      {/* ══════════════════════════════════════════════════════════════════════
          SECTION 1 — ISSUE SUMMARY
      ══════════════════════════════════════════════════════════════════════ */}
      <div className="rounded-xl border border-border bg-card p-4">
        <SectionHeader icon={Tag} label="Issue Summary" />
        {/* Badge grid */}
        <div className="flex flex-wrap gap-2 mb-3">
          {(ticket?.intent || email.intent) && (
            <Badge variant="secondary" className="gap-1 text-xs">
              <Tag className="h-3 w-3" />
              {ticket?.intent || email.intent}
            </Badge>
          )}
          {(ticket?.department || email.department) && (
            <Badge variant="outline" className="gap-1 text-xs">
              <Building2 className="h-3 w-3" />
              {ticket?.department || email.department}
            </Badge>
          )}
          {(ticket?.subteam || email.subteam) && (
            <Badge variant="outline" className="gap-1 text-xs bg-muted">
              <Users className="h-3 w-3" />
              {ticket?.subteam || email.subteam}
            </Badge>
          )}
          {ticket?.priority && (
            <Badge className={cn(PRIORITY_STYLES[ticket.priority] || PRIORITY_STYLES.medium, 'text-xs')}>
              {ticket.priority}
            </Badge>
          )}
          {(ticket?.sentiment || email.sentiment) && (
            <Badge className={cn(SENTIMENT_STYLES[(ticket?.sentiment || email.sentiment) as string] || SENTIMENT_STYLES.neutral, 'gap-1 text-xs')}>
              <Smile className="h-3 w-3" />
              {ticket?.sentiment || email.sentiment}
            </Badge>
          )}
        </div>
        {/* AI-generated summary */}
        {analysis?.issueSummary ? (
          <p className="text-sm text-foreground leading-relaxed">{analysis.issueSummary}</p>
        ) : (
          <p className="text-sm text-muted-foreground leading-relaxed">
            {ticket?.intent || email.intent
              ? `${ticket?.intent || email.intent} request from ${email.sender} — assigned to ${ticket?.department || email.department || 'IT'}.`
              : 'Classify this ticket to generate a detailed issue summary.'}
          </p>
        )}
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          SECTION 2 — CURRENT STATUS
      ══════════════════════════════════════════════════════════════════════ */}
      <div className="rounded-xl border border-border bg-card p-4">
        <SectionHeader icon={Clock} label="Current Status" />

        {/* Decision badge row */}
        {decision && (
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <Badge className={cn(decisionStyle.badge, 'text-xs font-semibold gap-1')}>
              {decisionKey === 'ESCALATE' ? <ShieldAlert className="h-3 w-3" />
                : decisionKey === 'HUMAN_APPROVAL_REQUIRED' ? <UserCheck className="h-3 w-3" />
                : <Zap className="h-3 w-3" />}
              {decisionStyle.label}
            </Badge>

            {/* Confidence bar */}
            <div className="flex items-center gap-1.5 flex-1 min-w-32">
              <span className="text-[10px] text-muted-foreground shrink-0">AI Confidence</span>
              <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                <div
                  className={cn(
                    'h-full rounded-full transition-all duration-700',
                    decision.confidence >= 90 ? 'bg-emerald-500'
                      : decision.confidence >= 70 ? 'bg-amber-500'
                      : 'bg-red-500'
                  )}
                  style={{ width: `${decision.confidence}%` }}
                />
              </div>
              <span className={cn(
                'text-[10px] font-bold tabular-nums shrink-0',
                decision.confidence >= 90 ? 'text-emerald-600 dark:text-emerald-400'
                  : decision.confidence >= 70 ? 'text-amber-600 dark:text-amber-400'
                  : 'text-red-600 dark:text-red-400'
              )}>
                {decision.confidence}%
              </span>
            </div>
          </div>
        )}

        {/* Workflow timeline (only when approval record exists) */}
        {ticketApproval && (
          <div className="rounded-lg border border-border bg-muted/20 p-3 mb-3 space-y-2">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1">Workflow Progress</p>
            {getWorkflowStages(ticketApproval).map((stage) => (
              <div key={stage.key} className="flex items-center gap-2.5">
                <div className={cn(
                  'w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 text-[9px] font-bold transition-all',
                  stage.rejected
                    ? 'border-red-500 bg-red-500 text-white'
                    : stage.done
                    ? 'border-emerald-500 bg-emerald-500 text-white'
                    : stage.active
                    ? 'border-amber-500 bg-amber-100 dark:bg-amber-900 text-amber-700 dark:text-amber-300 animate-pulse'
                    : 'border-muted-foreground/30 bg-transparent text-transparent'
                )}>
                  {stage.rejected ? '✕' : stage.done ? '✓' : stage.active ? '●' : ''}
                </div>
                <span className={cn(
                  'text-xs',
                  stage.rejected ? 'text-red-600 dark:text-red-400 font-semibold'
                    : stage.done ? 'text-emerald-600 dark:text-emerald-400 font-medium'
                    : stage.active ? 'text-amber-700 dark:text-amber-300 font-semibold'
                    : 'text-muted-foreground/60'
                )}>
                  {stage.label}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Status description from analysis */}
        <p className="text-sm text-foreground leading-relaxed">
          {analysis?.currentStatus || decision?.reason || 'Ticket has been classified and is awaiting resolution.'}
        </p>

        {/* AI Handover Summary for ESCALATE */}
        {decision?.decision === 'ESCALATE' && decision.ai_summary && (
          <div className="mt-3 bg-muted/50 rounded-lg p-3 space-y-1.5">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">AI Handover Summary</p>
            {decision.ai_summary.split('\n').filter(Boolean).map((line, i) => (
              <p key={i} className="text-xs text-foreground leading-relaxed">{line}</p>
            ))}
          </div>
        )}

            {ticket?.status === 'escalated' && (
              <EscalationStatusCard
                department={ticket.department ?? decision?.department ?? '—'}
                team={ticket.subteam ?? decision?.subteam ?? '—'}
                priority={ticket.priority ?? 'high'}
                workItemId={escalationWorkItemId ?? null}
                workItemStatus={escalationWorkItem?.status ?? null}
                assignedTo={escalationWorkItem?.assigned_to ?? null}
                investigationComplete={escalationWorkItem?.investigation_complete ?? false}
                slaDeadline={escalationWorkItem?.sla_deadline ?? null}
              />
            )}

            {!ticketApproval && decision && ticket?.status !== 'escalated' && (
              <div className="mt-3 space-y-2">
                {decision.decision === 'ESCALATE' && (
                  <Button
                    id="btn-escalate-now"
                    size="sm"
                    variant="destructive"
                    className="w-full gap-1.5 text-xs font-semibold"
                    onClick={onExecuteDecision}
                    disabled={isActioning}
                  >
                    {isActioning ? <Loader2 className="h-3 w-3 animate-spin" /> : <ShieldAlert className="h-3 w-3" />}
                    Escalate to {decision.department}{decision.subteam ? ` — ${decision.subteam}` : ''}
                  </Button>
                )}
                {decision.decision === 'HUMAN_APPROVAL_REQUIRED' && (
                  <Button
                    id="btn-notify-manager"
                    size="sm"
                    variant="outline"
                    className="w-full gap-1.5 text-xs border-amber-300 dark:border-amber-600 text-amber-700 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/40"
                    onClick={onExecuteDecision}
                    disabled={isActioning}
                  >
                    {isActioning ? <Loader2 className="h-3 w-3 animate-spin" /> : <UserCheck className="h-3 w-3" />}
                    {isActioning ? 'Creating Approval Request…' : 'Notify Manager for Approval'}
                  </Button>
                )}
              </div>
            )}

        <p className="text-[10px] text-muted-foreground mt-2">
          {decisionLog ? '📦 Decision loaded from audit log' : '🔴 Live decision generated'}
        </p>
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          SECTION 3 — RECOMMENDED RESOLUTION STEPS
      ══════════════════════════════════════════════════════════════════════ */}
      {actions.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-4">
          <SectionHeader icon={ListChecks} label="Recommended Resolution Steps" />
          <ol className="space-y-2">
            {actions.map((action, idx) => (
              <li key={action.id} className="flex items-start gap-3">
                <span className="shrink-0 w-5 h-5 rounded-full bg-primary/10 text-primary text-[10px] font-bold flex items-center justify-center mt-0.5">
                  {idx + 1}
                </span>
                <span className="text-sm leading-relaxed break-words">{action.recommended_action}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          SECTION 4 — KNOWLEDGE BASE / SIMILAR CASES
      ══════════════════════════════════════════════════════════════════════ */}
      {similarCases.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-4">
          <SectionHeader icon={BookOpen} label="Knowledge Base — Similar Resolved Cases" />
          <div className="space-y-2">
            {similarCases.map((c) => (
              <div key={c.id} className="rounded-lg bg-muted/40 p-3 text-xs border border-border/40">
                <div className="flex items-start justify-between gap-2 mb-1">
                  <p className="font-medium text-foreground leading-tight flex-1 break-words">{c.emailSubject}</p>
                  <span className="shrink-0 text-[10px] font-bold text-primary bg-primary/10 rounded px-1.5 py-0.5 ml-2">
                    {(c.similarity * 100).toFixed(0)}% match
                  </span>
                </div>
                <div className="flex gap-1 mb-1.5">
                  <Badge variant="outline" className="text-[10px] py-0">{c.intent}</Badge>
                  {c.department && <Badge variant="outline" className="text-[10px] py-0">{c.department}</Badge>}
                </div>
                <p className="text-muted-foreground line-clamp-2 leading-relaxed">{c.finalResponse}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          SECTION 5 — HUMAN VERIFICATION REQUIRED
          Only shown when decision.requires_human = true
      ══════════════════════════════════════════════════════════════════════ */}
      {decision?.requires_human && analysis?.humanVerificationItems && analysis.humanVerificationItems.length > 0 && (
        <div className="rounded-xl border-2 border-amber-300 dark:border-amber-600 bg-amber-50 dark:bg-amber-950/20 p-4">
          <SectionHeader icon={ShieldCheck} label="Human Verification Required" accent="bg-amber-500" />
          <p className="text-xs text-amber-800 dark:text-amber-200 mb-3">
            The following items must be verified by you before resolving this ticket:
          </p>
          <ul className="space-y-2">
            {analysis.humanVerificationItems.map((item, i) => (
              <li key={i} className="flex items-start gap-2.5 text-sm text-amber-900 dark:text-amber-100">
                <div className="shrink-0 w-4 h-4 rounded border-2 border-amber-500 bg-white dark:bg-amber-900/50 mt-0.5" />
                <span className="leading-relaxed">{item}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          SECTION 6 — RISK ASSESSMENT
      ══════════════════════════════════════════════════════════════════════ */}
      {decision && (
        <div className={cn('rounded-xl border p-4', riskStyle.bg)}>
          <div className="flex items-center gap-2 mb-2">
            <div className="p-1.5 rounded-md bg-white/60 dark:bg-black/20">
              <RiskIcon className="h-3.5 w-3.5" />
            </div>
            <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Risk Assessment</p>
            <Badge className={cn(riskStyle.badge, 'ml-auto text-xs font-bold border')}>
              {risk} Risk
            </Badge>
          </div>
          <p className="text-sm leading-relaxed text-foreground">
            {analysis?.riskExplanation || `This ticket is rated ${risk} risk. Handle accordingly and document all resolution steps.`}
          </p>
          {decision.department && decision.decision !== 'AUTO_RESPONSE' && (
            <div className="flex items-center gap-1.5 mt-2 text-xs text-muted-foreground">
              <PhoneForwarded className="h-3.5 w-3.5" />
              <span>Suggested route:</span>
              <span className="font-semibold text-foreground">{decision.department}{decision.subteam ? ` — ${decision.subteam}` : ''}</span>
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          SECTION 7 — NEXT ACTION
      ══════════════════════════════════════════════════════════════════════ */}
      {(analysis?.nextAction || decision) && (
        <div className="rounded-xl border-2 border-primary/30 bg-primary/5 p-4">
          <SectionHeader icon={ArrowRight} label="Next Action" />
          <p className="text-sm font-semibold text-foreground leading-relaxed">
            {analysis?.nextAction || (
              decision?.decision === 'ESCALATE'
                ? `Escalate immediately to ${decision.department || 'the specialist team'}.`
                : decision?.decision === 'HUMAN_APPROVAL_REQUIRED'
                ? 'Send manager approval request before proceeding.'
                : 'Proceed to the Resolution Draft tab to prepare the employee response.'
            )}
          </p>
          {decision?.decision === 'AUTO_RESPONSE' && (
            <p className="text-xs text-muted-foreground mt-1.5">
              → Switch to the <span className="font-semibold text-primary">Resolution Draft</span> tab to compose the customer response.
            </p>
          )}
        </div>
      )}

    </div>
  );
}

// ─── EscalationStatusCard ─────────────────────────────────────────────────────
// Full-width High Priority Escalation card shown when ticket.status === 'escalated'.
// Replaces the old tiny "Escalated to Finance — Payroll Team" text badge.

// Status labels — exactly the states required by the user spec.
// Must NEVER contradict the assignedTo state.
const WORK_ITEM_STATUS_LABELS: Record<string, { label: string; color: string }> = {
  escalated:           { label: 'Waiting Assignment',  color: 'text-amber-600 dark:text-amber-400'   },
  assigned:            { label: 'Waiting Assignment',  color: 'text-amber-600 dark:text-amber-400'   },
  accepted:            { label: 'Assigned',             color: 'text-blue-600 dark:text-blue-400'     },
  in_progress:         { label: 'In Investigation',    color: 'text-violet-600 dark:text-violet-400' },
  waiting:             { label: 'Waiting Employee',    color: 'text-orange-600 dark:text-orange-400' },
  quality_check:       { label: 'Waiting Approval',    color: 'text-sky-600 dark:text-sky-400'       },
  customer_resolution: { label: 'Waiting Approval',    color: 'text-sky-600 dark:text-sky-400'       },
  completed:           { label: 'Resolved',             color: 'text-emerald-600 dark:text-emerald-400' },
};


const ESCALATION_PRIORITY_STYLES: Record<string, string> = {
  critical: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300 border-red-300 dark:border-red-700',
  high:     'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300 border-orange-300 dark:border-orange-700',
  medium:   'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 border-amber-300 dark:border-amber-700',
  low:      'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 border-emerald-300 dark:border-emerald-700',
};

const SLA_HOURS: Record<string, number> = { critical: 2, high: 4, medium: 8, low: 24 };

function EscalationStatusCard({
  department,
  team,
  priority,
  workItemId,
  workItemStatus,
  assignedTo,
  investigationComplete,
  slaDeadline,
}: {
  department: string;
  team: string;
  priority: string;
  workItemId: string | null;
  workItemStatus: string | null;
  /** assigned_to from dept_work_items — null means not yet claimed */
  assignedTo: string | null;
  investigationComplete: boolean;
  slaDeadline: string | null;
}) {
  const router = useRouter();
  const statusInfo = WORK_ITEM_STATUS_LABELS[workItemStatus ?? 'assigned'] ?? WORK_ITEM_STATUS_LABELS.assigned;
  const priorityStyle = ESCALATION_PRIORITY_STYLES[priority] ?? ESCALATION_PRIORITY_STYLES.high;
  const slaHours = SLA_HOURS[priority] ?? 4;

  // Format SLA deadline
  const slaText = slaDeadline
    ? new Date(slaDeadline).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : `Within ${slaHours}h of assignment`;

  return (
    <div className="mt-3 rounded-xl border-2 border-red-400 dark:border-red-600 bg-red-50 dark:bg-red-950/20 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2.5 px-4 py-2.5 bg-red-100 dark:bg-red-900/30 border-b border-red-300 dark:border-red-700">
        <div className="w-6 h-6 rounded-md bg-red-500 flex items-center justify-center shrink-0">
          <ShieldAlert className="h-3.5 w-3.5 text-white" />
        </div>
        <p className="text-sm font-bold text-red-800 dark:text-red-200 flex-1">
          🚨 High Priority Escalation Active
        </p>
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${priorityStyle}`}>
          {priority.toUpperCase()}
        </span>
      </div>

      {/* Body */}
      <div className="p-4 space-y-3">

        {/* 2-col grid: dept/team, officer/SLA */}
        <div className="grid grid-cols-2 gap-3 text-xs">
          <div className="space-y-0.5">
            <div className="flex items-center gap-1.5 text-muted-foreground mb-1">
              <Building2 className="h-3 w-3" />
              <span className="font-bold uppercase tracking-wider text-[10px]">Department</span>
            </div>
            <p className="font-semibold text-foreground">{department}</p>
          </div>
          <div className="space-y-0.5">
            <div className="flex items-center gap-1.5 text-muted-foreground mb-1">
              <Users className="h-3 w-3" />
              <span className="font-bold uppercase tracking-wider text-[10px]">Team</span>
            </div>
            <p className="font-semibold text-foreground">{team}</p>
          </div>
          <div className="space-y-0.5">
            <div className="flex items-center gap-1.5 text-muted-foreground mb-1">
              <User className="h-3 w-3" />
              <span className="font-bold uppercase tracking-wider text-[10px]">Assigned Officer</span>
            </div>
            {/* Show real name if assigned; 'Unassigned' if null — never show generic 'Assigned' */}
            <p className={cn(
              'font-semibold text-[11px]',
              assignedTo ? 'text-foreground' : 'text-foreground/50 italic'
            )}>
              {assignedTo ?? 'Unassigned'}
            </p>
          </div>
          <div className="space-y-0.5">
            <div className="flex items-center gap-1.5 text-muted-foreground mb-1">
              <Timer className="h-3 w-3" />
              <span className="font-bold uppercase tracking-wider text-[10px]">SLA Deadline</span>
            </div>
            <p className="font-semibold text-foreground text-[11px]">{slaText}</p>
          </div>
          <div className="space-y-0.5 col-span-2">
            <div className="flex items-center gap-1.5 text-muted-foreground mb-1">
              <ClipboardList className="h-3 w-3" />
              <span className="font-bold uppercase tracking-wider text-[10px]">Investigation Status</span>
            </div>
            <p className={`font-semibold text-[11px] ${statusInfo.color}`}>
              {investigationComplete ? '✓ Investigation Complete' : statusInfo.label}
            </p>
          </div>
        </div>

        {/* Open Queue button */}
        {workItemId && (
          <button
            id="btn-open-dept-queue"
            onClick={() => router.push(`/department/${workItemId}`)}
            className="w-full flex items-center justify-center gap-2 text-xs font-bold bg-red-600 hover:bg-red-700 text-white rounded-lg px-4 py-2.5 transition-colors"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Open Department Queue →
          </button>
        )}
        {!workItemId && (
          <p className="text-[10px] text-muted-foreground italic text-center">
            Work item ID not yet available — reload to refresh
          </p>
        )}
      </div>
    </div>
  );
}
