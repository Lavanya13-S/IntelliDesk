'use client';

import { useEffect, useState, useCallback } from 'react';

import { useRouter } from 'next/navigation';
import { Sidebar } from '@/components/sidebar';
import { supabase } from '@/lib/supabase';
import {
  ArrowLeft, CheckCircle2, Clock, AlertTriangle, Loader2,
  User, Building2, Mail, Zap, ShieldAlert, MessageSquare,
  Play, Pause, UserCheck, ArrowRight, ChevronRight,
  Wrench, BookOpen, Brain, RefreshCw, Send, X,
  Timer, ClipboardList, GitBranch, Info, Users,
  ShieldCheck, RotateCcw, ClipboardCheck, BadgeCheck,
  HelpCircle, FileText, Copy, Eye, Edit3, ChevronDown,
  MailCheck, Wand2, Lock, ShieldOff, StickyNote,
} from 'lucide-react';

import type { DraftField, DraftSection, ResolutionTemplate } from '@/lib/resolution-templates';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import type { DeptWorkItem, DeptWorkLog } from '@/lib/types';

// ── Status config — all 8 stages ───────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { label: string; color: string; text: string }> = {
  escalated:           { label: 'Escalated',            color: 'bg-red-500',     text: 'text-red-600 dark:text-red-400'      },
  assigned:            { label: 'Assigned',              color: 'bg-blue-500',    text: 'text-blue-600 dark:text-blue-400'    },
  accepted:            { label: 'Accepted',              color: 'bg-indigo-500',  text: 'text-indigo-600 dark:text-indigo-400'},
  in_progress:         { label: 'In Investigation',      color: 'bg-violet-500',  text: 'text-violet-600 dark:text-violet-400'},
  waiting:             { label: 'Waiting Employee',      color: 'bg-amber-500',   text: 'text-amber-600 dark:text-amber-400'  },
  quality_check:       { label: 'Waiting Approval',      color: 'bg-sky-500',     text: 'text-sky-600 dark:text-sky-400'      },
  customer_resolution: { label: 'Customer Resolution',   color: 'bg-amber-500',   text: 'text-amber-600 dark:text-amber-400'  },
  completed:           { label: 'Resolved',              color: 'bg-emerald-500', text: 'text-emerald-600 dark:text-emerald-400'},
};


const STATUS_BADGE_STYLES: Record<string, string> = {
  escalated:           'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
  assigned:            'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
  accepted:            'bg-indigo-100 text-indigo-700 dark:bg-indigo-900 dark:text-indigo-300',
  in_progress:         'bg-violet-100 text-violet-700 dark:bg-violet-900 dark:text-violet-300',
  waiting:             'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300',
  quality_check:       'bg-sky-100 text-sky-700 dark:bg-sky-900 dark:text-sky-300',
  customer_resolution: 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300',
  completed:           'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300',
};

const PRIORITY_COLORS: Record<string, string> = {
  critical: 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800',
  high:     'text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-950/30 border-orange-200 dark:border-orange-800',
  medium:   'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800',
  low:      'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800',
};

// ── SLA countdown ─────────────────────────────────────────────────────────────

function SlaTimer({ deadline, breached, status }: { deadline: string | null; breached: boolean; status: string }) {
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    if (!deadline || status === 'completed') return;
    const tick = () => setRemaining(new Date(deadline).getTime() - Date.now());
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [deadline, status]);

  if (status === 'completed') return (
    <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
      <CheckCircle2 className="h-3.5 w-3.5" /> Completed on time
    </div>
  );

  if (!deadline) return <span className="text-xs text-muted-foreground">No SLA configured</span>;
  if (breached || (remaining !== null && remaining <= 0)) {
    return (
      <div className="inline-flex items-center gap-1.5 text-xs font-bold text-red-600 dark:text-red-400 animate-pulse">
        <ShieldAlert className="h-3.5 w-3.5" /> SLA BREACHED
      </div>
    );
  }
  if (remaining === null) return null;

  const hours   = Math.floor(remaining / 3_600_000);
  const minutes = Math.floor((remaining % 3_600_000) / 60_000);
  const seconds = Math.floor((remaining % 60_000) / 1_000);
  const label   = `${String(hours).padStart(2,'0')}:${String(minutes).padStart(2,'0')}:${String(seconds).padStart(2,'0')}`;
  const totalMs = new Date(deadline).getTime() - new Date(Date.now() - remaining).getTime();
  const pct = Math.max(0, remaining / (totalMs || 1));
  const color = pct > 0.5 ? 'text-emerald-600 dark:text-emerald-400'
              : pct > 0.1 ? 'text-amber-600 dark:text-amber-400'
              :              'text-red-600 dark:text-red-400 animate-pulse';

  return (
    <div className="flex items-center gap-2">
      <Timer className="h-3.5 w-3.5 text-muted-foreground" />
      <span className={cn('font-mono font-bold text-sm tabular-nums', color)}>{label}</span>
      <span className="text-xs text-muted-foreground">remaining</span>
    </div>
  );
}

// ── Workflow Stepper — 5 canonical stages ────────────────────────────────────────
//
// Canonical path: assigned → accepted → in_progress → customer_resolution → completed
//   Stage 1 — Assigned:            green as soon as assigned_to is populated in DB
//   Stage 2 — Accepted:            green once accepted_at is set (accept action fired)
//   Stage 3 — Dept Processing:     in_progress / waiting / quality_check
//   Stage 4 — Customer Resolution: customer_resolution status
//   Stage 5 — Resolved:            completed status
//
// waiting is a sub-state of in_progress; quality_check maps to customer_resolution.

const WORKFLOW_STAGES = [
  { id: 'assigned',            label: 'Assigned'           },
  { id: 'accepted',            label: 'Accepted'           },
  { id: 'in_progress',         label: 'Dept\nProcessing'   },
  { id: 'customer_resolution', label: 'Customer\nResolution'},
  { id: 'completed',           label: 'Resolved'           },
] as const;

type WorkflowStageId = typeof WORKFLOW_STAGES[number]['id'];

/**
 * WorkflowStepper
 *
 * Derives the correct visual state for each of the 5 stages from the DB values.
 *
 * @param status       - item.status from DB
 * @param hasAssignee  - true when item.assigned_to is not null
 * @param acceptedAt   - item.accepted_at from DB (non-null once accepted)
 */
function WorkflowStepper({
  status,
  hasAssignee = false,
  acceptedAt = null,
  notificationStatus = null,
}: {
  status: string;
  hasAssignee?: boolean;
  acceptedAt?: string | null;
  notificationStatus?: string | null;
}) {
  // Normalise sub-states to canonical stage IDs
  const normalisedStatus =
    status === 'waiting'       ? 'in_progress'
    : status === 'quality_check' ? 'customer_resolution'
    : status;

  const stageIds = WORKFLOW_STAGES.map(s => s.id);

  // Compute effective index for colouring:
  //   - If status = 'assigned' AND assigned_to is populated → show 'accepted' as active
  //     so that Stage 1 (Assigned) renders as done/green and Stage 2 as current.
  const effectiveIndex: number = (() => {
    if (normalisedStatus === 'assigned' && hasAssignee) {
      // Stage 1 done, Stage 2 active (awaiting acceptance)
      return stageIds.indexOf('accepted');
    }
    const idx = stageIds.indexOf(normalisedStatus as WorkflowStageId);
    return idx >= 0 ? idx : 0;
  })();

  // A stage is "done" when the current pointer is strictly past it,
  // OR for Stage 2 when accepted_at is set and we're already in in_progress+.
  const isAcceptedDone =
    !!acceptedAt && ['in_progress', 'customer_resolution', 'completed'].includes(normalisedStatus);

  // Stage 5 (completed/Resolved) is only done when notification is SENT
  // Stage 4 (customer_resolution) shows as amber/pending if notification FAILED
  const notifFailed = notificationStatus === 'FAILED' || notificationStatus === 'PENDING';

  return (
    <div className="flex items-start gap-0 overflow-x-auto pb-1">
      {WORKFLOW_STAGES.map((s, i) => {
        // Stage-specific done logic
        let done: boolean;
        if (s.id === 'accepted') {
          done = isAcceptedDone || effectiveIndex > i;
        } else if (s.id === 'completed' && notifFailed) {
          // Step 5 stays grey until notification succeeds
          done = false;
        } else {
          done = effectiveIndex > i;
        }
        const active = effectiveIndex === i && !done;
        // Step 4 pulses amber when notification failed
        const isPending = (s.id === 'customer_resolution' && active) ||
                          (s.id === 'customer_resolution' && notifFailed && normalisedStatus === 'completed');
        return (
          <div key={s.id} className="flex items-center">
            <div className={cn(
              'flex flex-col items-center gap-1.5',
              i < WORKFLOW_STAGES.length - 1 && 'min-w-[72px]'
            )}>
              <div className={cn(
                'w-7 h-7 rounded-full border-2 flex items-center justify-center text-[10px] font-bold transition-all shrink-0',
                done       ? 'border-emerald-500 bg-emerald-500 text-white'
                : isPending ? 'border-amber-500 bg-amber-500 text-white scale-110 shadow-md shadow-amber-200'
                : active    ? 'border-primary bg-primary text-primary-foreground scale-110 shadow-md shadow-primary/20'
                :             'border-muted-foreground/30 bg-background text-muted-foreground/50'
              )}>
                {done ? '✓' : i + 1}
              </div>
              <span className={cn(
                'text-[9px] font-semibold text-center leading-tight whitespace-pre-line',
                done       ? 'text-emerald-600 dark:text-emerald-400'
                : isPending ? 'text-amber-600 dark:text-amber-400 font-bold'
                : active    ? 'text-primary font-bold'
                :             'text-muted-foreground/50'
              )}>
                {s.label}
              </span>
            </div>
            {i < WORKFLOW_STAGES.length - 1 && (
              <div className={cn(
                'h-0.5 flex-1 mx-1 mb-5 transition-all',
                i < effectiveIndex ? 'bg-emerald-500' : 'bg-muted'
              )} style={{ minWidth: 16 }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Log Action Icon ───────────────────────────────────────────────────────────

function LogIcon({ action }: { action: string }) {
  const map: Record<string, { icon: React.ElementType; color: string }> = {
    created:               { icon: Zap,           color: 'text-violet-500' },
    assigned:              { icon: UserCheck,      color: 'text-blue-500'   },
    accepted:              { icon: BadgeCheck,     color: 'text-indigo-500' },
    started:               { icon: Play,           color: 'text-emerald-500'},
    paused:                { icon: Pause,          color: 'text-amber-500'  },
    waiting:               { icon: Clock,          color: 'text-amber-500'  },
    resumed:               { icon: Play,           color: 'text-emerald-500'},
    submitted_for_review:  { icon: ClipboardCheck, color: 'text-sky-500'    },
    verified:              { icon: ShieldCheck,    color: 'text-emerald-600'},
    returned:              { icon: RotateCcw,      color: 'text-orange-500' },
    completed:             { icon: CheckCircle2,   color: 'text-emerald-600'},
    escalated:             { icon: ShieldAlert,    color: 'text-red-500'    },
    commented:             { icon: MessageSquare,  color: 'text-sky-500'    },
    reassigned:            { icon: Users,          color: 'text-violet-500' },
    sla_breached:          { icon: ShieldAlert,    color: 'text-red-600'    },
    // Two-phase resolution (Migration 041)
    resolution_published:  { icon: BookOpen,       color: 'text-emerald-600'},
    notification_sent:     { icon: MailCheck,      color: 'text-emerald-600'},
    notification_failed:   { icon: AlertTriangle,  color: 'text-red-500'    },
    notification_retried:  { icon: RotateCcw,      color: 'text-violet-500' },
  };
  const { icon: Icon, color } = map[action] ?? { icon: Info, color: 'text-muted-foreground' };
  return <Icon className={cn('h-3.5 w-3.5 shrink-0', color)} />;
}

// ── Request More Info Modal ───────────────────────────────────────────────────

function RequestInfoModal({
  employeeName,
  employeeEmail,
  intent,
  onClose,
  onSend,
  sending,
}: {
  employeeName: string;
  employeeEmail: string;
  intent: string;
  onClose: () => void;
  onSend: (emailBody: string) => void;
  sending: boolean;
}) {
  const defaultBody = `Dear ${employeeName},\n\nThank you for your request regarding: "${intent}".\n\nTo process your request effectively, we need some additional information:\n\n1. Please provide more details about your specific requirement.\n2. Include any relevant documents or reference numbers.\n3. Let us know your preferred timeline.\n\nPlease reply to this email at your earliest convenience so we can continue processing your request.\n\nBest regards,\nHelpDesk Support Team`;

  const [body, setBody] = useState(defaultBody);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-amber-100 dark:bg-amber-900/40 rounded-lg">
              <Mail className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            </div>
            <div>
              <p className="text-sm font-bold text-foreground">Request More Information</p>
              <p className="text-[11px] text-muted-foreground">Email will be sent to {employeeEmail}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-5 space-y-3">
          <div className="bg-muted/40 rounded-lg px-3 py-2 flex items-center gap-2 text-xs">
            <Mail className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-muted-foreground">To:</span>
            <span className="font-semibold text-foreground">{employeeEmail}</span>
          </div>
          <div className="bg-muted/40 rounded-lg px-3 py-2 flex items-center gap-2 text-xs">
            <MessageSquare className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-muted-foreground">Subject:</span>
            <span className="font-semibold text-foreground">Additional Information Required — {intent}</span>
          </div>
          <textarea
            value={body}
            onChange={e => setBody(e.target.value)}
            rows={9}
            className="w-full text-xs border border-border rounded-lg px-3 py-2.5 bg-background focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none font-mono leading-relaxed"
          />
          <p className="text-[10px] text-muted-foreground bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2">
            ⚡ When the employee replies via Gmail, the status will automatically return to <strong>In Progress</strong>.
          </p>
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border bg-muted/20">
          <button onClick={onClose} disabled={sending}
            className="text-xs text-muted-foreground hover:text-foreground border border-border rounded-lg px-4 py-2 hover:bg-muted transition-colors disabled:opacity-50">
            Cancel
          </button>
          <button
            onClick={() => onSend(body)}
            disabled={sending || !body.trim()}
            className="flex items-center gap-1.5 text-xs font-semibold bg-amber-500 hover:bg-amber-600 text-white rounded-lg px-4 py-2 transition-colors disabled:opacity-50"
          >
            {sending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
            Send & Set Waiting
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Confirm Send Modal ────────────────────────────────────────────────────────

function ConfirmSendModal({
  sending,
  onCancel,
  onConfirm,
}: {
  sending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white border border-[#E5E7EB] rounded-2xl shadow-2xl w-full max-w-sm mx-4 overflow-hidden">
        {/* Icon header */}
        <div className="flex flex-col items-center gap-3 px-6 pt-8 pb-4">
          <div className="w-14 h-14 rounded-full bg-emerald-50 border-2 border-emerald-200 flex items-center justify-center">
            <Send className="h-6 w-6 text-emerald-600" />
          </div>
          <div className="text-center">
            <p className="text-base font-bold text-[#111827]">Send Resolution?</p>
            <p className="text-xs text-[#6B7280] mt-1.5 leading-relaxed">
              This will send the resolution to the employee and permanently close the ticket.
            </p>
          </div>
        </div>

        {/* Warning note */}
        <div className="mx-6 mb-5 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 flex items-start gap-2">
          <AlertTriangle className="h-3.5 w-3.5 text-amber-600 shrink-0 mt-0.5" />
          <p className="text-[11px] text-amber-700 leading-relaxed">
            This action cannot be undone. The employee will receive the resolution email immediately.
          </p>
        </div>

        {/* Actions */}
        <div className="flex gap-2 px-6 pb-6">
          <button
            onClick={onCancel}
            disabled={sending}
            className="flex-1 text-xs font-semibold text-[#6B7280] border border-[#E5E7EB] rounded-xl py-2.5 hover:bg-gray-50 transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={sending}
            className="flex-1 flex items-center justify-center gap-1.5 text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl py-2.5 transition-colors disabled:opacity-50"
          >
            {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MailCheck className="h-3.5 w-3.5" />}
            Send &amp; Close Ticket
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Resolution Success Card ────────────────────────────────────────────────────

function ResolutionSuccessCard({
  resolvedAt,
  resolvedBy,
  startedAt,
  deliveryMode,
  notificationStatus,
  notificationError,
  onViewQueue,
  onRetryNotification,
  retrying,
  internalFields,
}: {
  resolvedAt:              string;
  resolvedBy:              string;
  startedAt?:              string | null;
  deliveryMode:            'gmail' | 'simulated' | 'REAL';
  notificationStatus?:     string | null;
  notificationError?:      string | null;
  onViewQueue:             () => void;
  onRetryNotification?:    () => void;
  retrying?:               boolean;
  internalFields?:         Record<string, string> | null;
}) {
  const resolutionMs = startedAt
    ? new Date(resolvedAt).getTime() - new Date(startedAt).getTime()
    : null;
  const formatDuration = (ms: number) => {
    const h = Math.floor(ms / 3_600_000);
    const m = Math.floor((ms % 3_600_000) / 60_000);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  };

  // Pretty-print field keys: "pay_period" → "Pay Period"
  function prettyKey(k: string): string {
    return k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }

  const hasInternalFields = internalFields && Object.keys(internalFields).length > 0;

  const notifSent   = notificationStatus === 'SENT'    || deliveryMode === 'REAL' || deliveryMode === 'gmail';
  const notifFailed = notificationStatus === 'FAILED';
  const isFullyResolved = notifSent && !notifFailed;

  return (
    <div className="p-5 space-y-4">
      {/* Hero */}
      <div className="flex flex-col items-center gap-3 py-4">
        <div className={cn(
          'w-16 h-16 rounded-full border-2 flex items-center justify-center',
          isFullyResolved
            ? 'bg-emerald-50 border-emerald-200'
            : 'bg-amber-50 border-amber-200'
        )}>
          {isFullyResolved
            ? <CheckCircle2 className="h-8 w-8 text-emerald-600" />
            : <AlertTriangle className="h-8 w-8 text-amber-600" />
          }
        </div>
        <div className="text-center">
          {isFullyResolved ? (
            <>
              <p className="text-sm font-bold text-[#111827]">✓ Ticket Fully Resolved</p>
              <p className="text-xs text-[#6B7280] mt-1">IntelliDesk resolution published + Gmail notification delivered.</p>
            </>
          ) : (
            <>
              <p className="text-sm font-bold text-amber-700">⚠ Resolution Published — Notification Pending</p>
              <p className="text-xs text-[#6B7280] mt-1">The employee can view the resolution in IntelliDesk.</p>
              <p className="text-xs text-amber-600 font-medium">Gmail notification failed. Retry required to fully resolve.</p>
            </>
          )}
        </div>
      </div>

      {/* ── Two-phase status rows ── */}
      <div className="rounded-xl border border-[#E5E7EB] overflow-hidden">
        <div className="px-4 py-2 bg-gray-50">
          <p className="text-[9px] font-bold uppercase tracking-widest text-gray-500">Resolution Status</p>
        </div>

        {/* Primary: IntelliDesk resolution */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-[#E5E7EB]">
          <div className="w-7 h-7 rounded-full bg-emerald-100 flex items-center justify-center shrink-0">
            <BookOpen className="h-3.5 w-3.5 text-emerald-600" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-[#111827]">IntelliDesk Resolution</p>
            <p className="text-[11px] text-emerald-600">✓ Published — Employee can view case in IntelliDesk</p>
          </div>
        </div>

        {/* Secondary: Gmail notification */}
        <div className="flex items-center gap-3 px-4 py-3">
          <div className={cn(
            'w-7 h-7 rounded-full flex items-center justify-center shrink-0',
            notifSent ? 'bg-emerald-100' : 'bg-red-100'
          )}>
            {notifSent
              ? <MailCheck className="h-3.5 w-3.5 text-emerald-600" />
              : <AlertTriangle className="h-3.5 w-3.5 text-red-500" />
            }
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-[#111827]">Email Notification</p>
            {notifSent ? (
              <p className="text-[11px] text-emerald-600">✓ Sent via Gmail (real delivery)</p>
            ) : (
              <>
                <p className="text-[11px] text-red-500 font-semibold">✗ Failed — {notificationError || 'Gmail delivery error'}</p>
                <p className="text-[10px] text-[#6B7280]">Employee notified via IntelliDesk only. Retry to send Gmail notification.</p>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Retry button — shown when notification failed */}
      {notifFailed && onRetryNotification && (
        <button
          onClick={onRetryNotification}
          disabled={retrying}
          className="w-full flex items-center justify-center gap-2 text-xs font-bold border-2 border-amber-400 text-amber-700 hover:bg-amber-50 rounded-xl py-2.5 transition-colors disabled:opacity-50"
        >
          {retrying
            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
            : <RotateCcw className="h-3.5 w-3.5" />
          }
          {retrying ? 'Retrying Gmail Notification…' : 'Retry Gmail Notification'}
        </button>
      )}

      {/* ── 🔒 Internal Resolution Details — CONFIDENTIAL ─────────────── */}
      {hasInternalFields ? (
        <div className="rounded-xl border-2 border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/20 overflow-hidden">
          {/* Header */}
          <div className="bg-amber-100 dark:bg-amber-900/40 px-4 py-2.5 flex items-center gap-2">
            <Lock className="h-3.5 w-3.5 text-amber-700 dark:text-amber-300 shrink-0" />
            <p className="text-[10px] font-bold uppercase tracking-widest text-amber-800 dark:text-amber-200">
              🔒 Internal Resolution Details — Confidential
            </p>
          </div>
          {/* Fields */}
          <div className="divide-y divide-amber-200 dark:divide-amber-800">
            {Object.entries(internalFields!).map(([key, value]) => (
              value?.trim() ? (
                <div key={key} className="flex items-start gap-3 px-4 py-2.5 text-xs">
                  <span className="text-amber-700 dark:text-amber-400 font-medium w-40 shrink-0">{prettyKey(key)}</span>
                  <span className="text-amber-900 dark:text-amber-100 font-semibold flex-1 break-words">{value}</span>
                </div>
              ) : null
            ))}
          </div>
          <div className="px-4 py-2 bg-amber-100/50 dark:bg-amber-900/20">
            <p className="text-[9px] text-amber-700/70 dark:text-amber-400/70">
              This information was entered during Step 3 — Department Processing. It is stored internally and was NOT sent to the employee.
            </p>
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/10 px-4 py-3 flex items-center gap-2">
          <Lock className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
          <p className="text-xs text-amber-700 dark:text-amber-300">
            <span className="font-semibold">Internal resolution data not available.</span>{' '}
            Step 5 fields were not captured for this ticket.
          </p>
        </div>
      )}

      {/* ── Resolution metadata ──────────────────────────────────────────── */}
      <div className="rounded-xl border border-[#E5E7EB] bg-white divide-y divide-[#E5E7EB] overflow-hidden">
        <div className="px-4 py-2 bg-gray-50">
          <p className="text-[9px] font-bold uppercase tracking-widest text-gray-500">Resolution Record</p>
        </div>
        {[
          ['Published At',  new Date(resolvedAt).toLocaleString()],
          ['Published By',  resolvedBy],
          ...(resolutionMs !== null ? [['Time to Resolution', formatDuration(resolutionMs)]] : []),
        ].map(([label, value]) => (
          <div key={label} className="flex items-center justify-between px-4 py-2.5 text-xs">
            <span className="text-[#6B7280] font-medium">{label}</span>
            <span className="font-semibold text-[#111827] text-right max-w-[55%] break-words">{value}</span>
          </div>
        ))}
      </div>

      {/* CTA */}
      {isFullyResolved && (
        <button
          onClick={onViewQueue}
          className="w-full flex items-center justify-center gap-2 text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl py-2.5 transition-colors"
        >
          <CheckCircle2 className="h-3.5 w-3.5" />
          View Completed Queue
        </button>
      )}
    </div>
  );
}


// ── Lifecycle Banner — shown after full resolution ────────────────────────────

function LifecycleBanner() {
  const steps = [
    '✓ Assigned',
    '✓ Accepted',
    '✓ Dept Processing',
    '✓ Customer Resolution',
    '✓ Resolved',
  ];
  return (
    <div className="mx-5 mb-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
      <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-700 mb-3">Workflow Complete — All 5 Stages</p>
      <div className="flex flex-wrap gap-2">
        {steps.map((step) => (
          <span
            key={step}
            className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-100 border border-emerald-200 rounded-full px-2.5 py-0.5"
          >
            {step}
          </span>
        ))}
      </div>
    </div>
  );
}

// ── Toast notification ────────────────────────────────────────────────────────

function Toast({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 5000);
    return () => clearTimeout(t);
  }, [onDismiss]);
  return (
    <div className="fixed bottom-6 right-6 z-50 flex items-center gap-3 bg-[#111827] text-white rounded-2xl px-5 py-3.5 shadow-2xl animate-in slide-in-from-bottom-4 duration-300">
      <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
      <p className="text-xs font-semibold">{message}</p>
      <button onClick={onDismiss} className="text-white/50 hover:text-white ml-1">
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 3 — DEPARTMENT PROCESSING PANEL
// Internal technical/HR work. Internal form. NO Gmail sent here.
// Assigned officer completes work → clicks "Complete Department Processing"
// → transitions in_progress → customer_resolution (Stage 4)
// ═══════════════════════════════════════════════════════════════════════════════

interface DeptProcessingPanelProps {
  // Internal form
  loading: boolean;
  loaded: boolean;
  templateId: string;
  allTemplates: { id: string; label: string }[];
  intro: string;
  sections: DraftSection[];
  closing: string;
  employeeName: string;
  fieldValues: Record<string, string>;
  onFieldChange: (id: string, val: string) => void;
  onTemplateChange: (id: string) => void;
  onRegenerate: () => void;
  // Complete action
  completing: boolean;
  onComplete: () => void;
  /** Error from the complete API call — shown below the button */
  completeError: string | null;
  onDismissError: () => void;
  /** Field IDs that failed validation — highlighted in red */
  missingFieldIds: string[];
}

function DeptProcessingPanel({
  loading, loaded, templateId, allTemplates, intro, sections, closing,
  employeeName, fieldValues, onFieldChange, onTemplateChange, onRegenerate,
  completing, onComplete, completeError, onDismissError, missingFieldIds,
}: DeptProcessingPanelProps) {
  return (
    <div className="p-4 space-y-4">

      {/* ── Stage header ──────────────────────────────────────────────────── */}
      <div className="flex items-start gap-3 rounded-xl bg-violet-50 dark:bg-violet-950/20 border border-violet-200 dark:border-violet-800 px-4 py-3">
        <div className="w-8 h-8 rounded-full bg-violet-100 dark:bg-violet-900/40 flex items-center justify-center shrink-0">
          <Wrench className="h-4 w-4 text-violet-600 dark:text-violet-400" />
        </div>
        <div>
          <p className="text-sm font-bold text-violet-800 dark:text-violet-200">Step 3 — Department Processing</p>
          <p className="text-[11px] text-violet-700/70 dark:text-violet-300/70 mt-0.5">
            Complete the internal department work. Fill the form below.
            Internal details are <strong>NEVER</strong> sent to the employee.
          </p>
        </div>
      </div>

      {/* ── Internal Reference Form ────────────────────────────────────────── */}
      <div className="rounded-xl border-2 border-dashed border-amber-300 dark:border-amber-700 overflow-hidden">
        {/* Header */}
        <div className="bg-amber-50 dark:bg-amber-950/30 px-4 py-3 flex items-start gap-2.5">
          <Lock className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-xs font-bold text-amber-800 dark:text-amber-200">
              🔒 Internal Reference — NOT Sent to Employee
            </p>
            <p className="text-[10px] text-amber-700/70 dark:text-amber-300/70 mt-0.5">
              Fill these fields for your provisioning work. They NEVER appear in the customer email.
            </p>
          </div>
        </div>

        {/* Body */}
        <div className="p-3 space-y-3 bg-amber-50/30 dark:bg-amber-950/10">
          {!loaded ? (
            <div className="flex flex-col items-center gap-2 py-6 text-center">
              <FileText className="h-7 w-7 opacity-30 text-muted-foreground" />
              <p className="text-xs text-muted-foreground">Load your internal provisioning form.</p>
              <button
                onClick={onRegenerate}
                className="flex items-center gap-1.5 text-xs font-semibold text-amber-700 border border-amber-300 rounded-lg px-3 py-1.5 hover:bg-amber-100 transition-all"
              >
                <RefreshCw className="h-3 w-3" /> Load Internal Form
              </button>
            </div>
          ) : loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              {/* Template selector */}
              <div className="flex items-center gap-2">
                <select
                  value={templateId}
                  onChange={(e) => onTemplateChange(e.target.value)}
                  className="flex-1 h-8 px-2 text-xs rounded-lg border border-amber-300 dark:border-amber-700 bg-white dark:bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-amber-400"
                >
                  {allTemplates.map((t) => (
                    <option key={t.id} value={t.id}>{t.label}</option>
                  ))}
                </select>
                <button onClick={onRegenerate}
                  className="flex items-center gap-1 text-[10px] font-medium border border-amber-300 rounded-lg px-2 py-1.5 hover:bg-amber-100 text-amber-700 transition-all">
                  <RefreshCw className="h-3 w-3" /> Reload
                </button>
              </div>

              {/* Intro */}
              <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-white dark:bg-card p-2.5">
                <p className="text-[9px] font-bold uppercase tracking-widest text-amber-600 mb-1">Opening</p>
                <p className="text-xs text-muted-foreground">Dear {employeeName || 'Employee'},</p>
                <p className="text-xs text-foreground mt-0.5 leading-relaxed">{intro}</p>
              </div>

              {/* Sections with fields */}
              {sections.map((section, sIdx) => (
                <div key={sIdx} className="rounded-lg border border-amber-200 dark:border-amber-800 bg-white dark:bg-card p-3 space-y-2.5">
                  {section.heading && (
                    <p className="text-[9px] font-bold uppercase tracking-widest text-amber-600">
                      {section.heading}
                    </p>
                  )}
                  {section.fields.map((field) => (
                    <div key={field.id} className="space-y-0.5">
                      <div className="flex items-center gap-1.5">
                        <label className="text-xs font-medium text-foreground">
                          {field.label}
                          {field.required && <span className="text-red-500 ml-0.5">*</span>}
                        </label>
                        {field.type === 'password' && (
                          <span className="text-[9px] border border-red-300 text-red-600 rounded px-1 font-bold">
                            🔒 internal only
                          </span>
                        )}
                      </div>
                      {field.type === 'textarea' ? (
                        <textarea
                          value={fieldValues[field.id] || ''}
                          onChange={(e) => onFieldChange(field.id, e.target.value)}
                          placeholder={field.placeholder}
                          rows={2}
                          className={`w-full px-2.5 py-1.5 text-xs rounded-lg border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 resize-none ${
                            missingFieldIds.includes(field.id)
                              ? 'border-red-400 dark:border-red-600 focus:ring-red-400'
                              : 'border-input focus:ring-amber-400'
                          }`}
                        />
                      ) : (
                        <input
                          type="text"
                          value={fieldValues[field.id] || ''}
                          onChange={(e) => onFieldChange(field.id, e.target.value)}
                          placeholder={field.placeholder}
                          className={`w-full h-8 px-2.5 text-xs rounded-lg border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 ${
                            missingFieldIds.includes(field.id)
                              ? 'border-red-400 dark:border-red-600 focus:ring-red-400'
                              : 'border-input focus:ring-amber-400'
                          }`}
                        />
                      )}
                      {missingFieldIds.includes(field.id) && (
                        <p className="text-[10px] text-red-600 dark:text-red-400 font-medium">
                          This field is required.
                        </p>
                      )}
                      {field.hint && !missingFieldIds.includes(field.id) && (
                        <p className="text-[10px] text-muted-foreground">{field.hint}</p>
                      )}
                    </div>
                  ))}
                </div>
              ))}

              {/* Closing */}
              <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-white dark:bg-card px-3 py-2">
                <p className="text-xs text-foreground">Best regards,</p>
                <p className="text-xs font-semibold text-foreground">{closing}</p>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Complete Department Processing button — always visible ──────────── */}
      {/* Shown regardless of whether the internal form is loaded. The engineer */}
      {/* may have completed work outside this form and just needs to advance.   */}
      <div className="rounded-xl border border-violet-200 dark:border-violet-800 bg-violet-50 dark:bg-violet-950/20 p-4 space-y-3">
        <div className="flex items-start gap-2">
          <CheckCircle2 className="h-4 w-4 text-violet-600 dark:text-violet-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-xs font-bold text-violet-800 dark:text-violet-200">
              Provisioning work complete?
            </p>
            <p className="text-[10px] text-violet-700/70 dark:text-violet-300/70 mt-0.5">
              When you have completed the internal technical work, click the button below.
              The ticket will advance to <strong>Customer Resolution</strong> — where Gemini will
              generate the customer notification email.
            </p>
          </div>
        </div>
        <button
          id="btn-complete-dept-processing"
          onClick={onComplete}
          disabled={completing}
          className="flex items-center gap-2 text-xs font-bold bg-violet-600 hover:bg-violet-700 text-white rounded-xl px-5 py-2.5 transition-all disabled:opacity-50 shadow-sm shadow-violet-200"
        >
          {completing
            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
            : <ArrowRight className="h-3.5 w-3.5" />}
          {completing ? 'Completing…' : 'Complete Department Processing →'}
        </button>
        <p className="text-[10px] text-violet-600/60 dark:text-violet-400/60">
          No email is sent at this stage. Gmail is only called in the next step (Customer Resolution).
        </p>
        {/* Error display — shown if the Complete API call fails */}
        {completeError && (
          <div className="flex items-start gap-2 rounded-lg border border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-950/20 px-3 py-2">
            <AlertTriangle className="h-3.5 w-3.5 text-red-600 dark:text-red-400 mt-0.5 shrink-0" />
            <p className="text-xs text-red-700 dark:text-red-300 flex-1 leading-relaxed">{completeError}</p>
            <button onClick={onDismissError} className="text-red-400 hover:text-red-600 ml-1">
              <X className="h-3 w-3" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 6 — CUSTOMER RESOLUTION PANEL
// AI generates customer-safe email. Engineer reviews. Gmail sends. Ticket closes.
// ═══════════════════════════════════════════════════════════════════════════════

interface CustomerResolutionPanelProps {
  // Ticket resolved state — from DB only
  isResolved: boolean;
  resolvedAt?: string | null;
  resolvedBy?: string;
  startedAt?: string | null;
  deliveryMode?: 'gmail' | 'simulated' | 'REAL';
  notificationStatus?: string | null;      // PENDING | SENT | FAILED
  notificationError?: string | null;
  employeeEmail: string;
  // Internal resolution data (Step 5 form data — confidential, never sent to customer)
  internalFields?: Record<string, string> | null;
  // Email generation
  engineerNotes: string;
  onEngineerNotesChange: (v: string) => void;
  customerEmailBody: string;
  onCustomerEmailBodyChange: (v: string) => void;
  customerEmailSubject: string;
  onCustomerEmailSubjectChange: (v: string) => void;
  customerEmailGenerating: boolean;
  customerEmailError: string | null;
  onGenerateCustomerEmail: () => void;
  // Send
  sending: boolean;
  sendError: string | null;
  onRequestConfirm: () => void;
  onDismissError: () => void;
  onRetry: () => void;
  onRetryNotification?: () => void;
  retrying?: boolean;
  onViewQueue: () => void;
}

function GmailFailureBanner({
  error,
  onRetry,
  onEdit,
}: { error: string; onRetry: () => void; onEdit: () => void }) {
  return (
    <div className="rounded-xl border-2 border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-950/30 p-4 space-y-3">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-full bg-red-100 dark:bg-red-900/40 border border-red-300 dark:border-red-700 flex items-center justify-center shrink-0">
          <AlertTriangle className="h-4 w-4 text-red-600 dark:text-red-400" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-red-800 dark:text-red-200">
            Resolution email could not be delivered
          </p>
          <p className="text-xs text-red-700/80 dark:text-red-300/80 mt-0.5 leading-relaxed">
            The ticket has <strong>NOT</strong> been closed. Status remains <strong>Customer Resolution</strong>.
          </p>
          <p className="text-[10px] text-red-600/70 dark:text-red-400/70 mt-1.5 font-mono bg-red-100 dark:bg-red-950/40 rounded px-2 py-1 leading-relaxed break-words">
            {error}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={onRetry}
          className="flex items-center gap-1.5 text-xs font-bold bg-red-600 hover:bg-red-700 text-white rounded-lg px-4 py-2 transition-colors"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Retry Sending
        </button>
        <button
          onClick={onEdit}
          className="flex items-center gap-1.5 text-xs font-semibold border border-red-300 dark:border-red-700 text-red-700 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-950/40 rounded-lg px-4 py-2 transition-colors"
        >
          <Edit3 className="h-3.5 w-3.5" />
          Edit Email
        </button>
      </div>
    </div>
  );
}

function CustomerResolutionPanel({
  isResolved, resolvedAt, resolvedBy, startedAt, deliveryMode,
  notificationStatus, notificationError,
  employeeEmail,
  internalFields,
  engineerNotes, onEngineerNotesChange,
  customerEmailBody, onCustomerEmailBodyChange,
  customerEmailSubject, onCustomerEmailSubjectChange,
  customerEmailGenerating, customerEmailError, onGenerateCustomerEmail,
  sending, sendError, onRequestConfirm, onDismissError, onRetry,
  onRetryNotification, retrying, onViewQueue,
}: CustomerResolutionPanelProps) {

  // Permanent success card — driven by DB only.
  // Show when primary resolution is published (isResolved=true OR notification_status is set)
  const showSuccessCard = (isResolved && resolvedAt && resolvedBy) ||
    (notificationStatus === 'FAILED' && resolvedAt && resolvedBy);

  if (showSuccessCard && resolvedAt && resolvedBy) {
    return (
      <ResolutionSuccessCard
        resolvedAt={resolvedAt}
        resolvedBy={resolvedBy}
        startedAt={startedAt}
        deliveryMode={deliveryMode ?? 'REAL'}
        notificationStatus={notificationStatus}
        notificationError={notificationError}
        onViewQueue={onViewQueue}
        onRetryNotification={onRetryNotification}
        retrying={retrying}
        internalFields={internalFields}
      />
    );
  }

  // Derive 3-step progress: 1=notes, 2=generated, 3=ready to send
  const step: 1 | 2 | 3 = !customerEmailBody ? (engineerNotes.trim() ? 2 : 1) : 3;

  return (
    <div className="p-4 space-y-5">

      {/* ── Stage header ──────────────────────────────────────────────────── */}
      <div className="flex items-start gap-3 rounded-xl bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 px-4 py-3">
        <div className="w-8 h-8 rounded-full bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center shrink-0">
          <MailCheck className="h-4 w-4 text-amber-600 dark:text-amber-400" />
        </div>
        <div>
          <p className="text-sm font-bold text-amber-800 dark:text-amber-200">Step 6 — Customer Resolution</p>
          <p className="text-[11px] text-amber-700/70 dark:text-amber-300/70 mt-0.5">
            Generate and send the final customer notification.
            The ticket closes <strong>only after Gmail confirms delivery</strong>.
          </p>
        </div>
      </div>

      {/* ── Progress steps bar ────────────────────────────────────────────── */}
      <div className="flex items-start gap-0">
        {([
          { n: 1, label: 'Write Notes',    sub: 'Describe what was done' },
          { n: 2, label: 'Generate Email', sub: 'AI writes safe email'   },
          { n: 3, label: 'Review & Send',  sub: 'Gmail sends → closed'   },
        ] as const).map((s, i, arr) => {
          const done   = step > s.n;
          const active = step === s.n;
          return (
            <div key={s.n} className="flex items-center flex-1">
              <div className="flex flex-col items-center gap-1 flex-1">
                <div className={cn(
                  'w-7 h-7 rounded-full border-2 flex items-center justify-center text-[10px] font-bold transition-all',
                  done   ? 'border-emerald-500 bg-emerald-500 text-white'
                  : active ? 'border-amber-500 bg-amber-500 text-white scale-110 shadow-md shadow-amber-200'
                  : 'border-muted-foreground/30 bg-background text-muted-foreground/50'
                )}>
                  {done ? '✓' : s.n}
                </div>
                <span className={cn(
                  'text-[9px] font-semibold text-center leading-tight',
                  done   ? 'text-emerald-600 dark:text-emerald-400'
                  : active ? 'text-amber-600 dark:text-amber-400 font-bold'
                  : 'text-muted-foreground/50'
                )}>{s.label}</span>
                <span className={cn(
                  'text-[8px] text-center leading-tight hidden sm:block',
                  done || active ? 'text-muted-foreground/70' : 'text-muted-foreground/30'
                )}>{s.sub}</span>
              </div>
              {i < arr.length - 1 && (
                <div className={cn(
                  'h-0.5 w-6 mb-6 mx-1 flex-shrink-0 transition-all',
                  step > s.n ? 'bg-emerald-500' : 'bg-muted'
                )} />
              )}
            </div>
          );
        })}
      </div>

      {/* ── Gmail Failure Banner ──────────────────────────────────────────── */}
      {sendError && (
        <GmailFailureBanner
          error={sendError}
          onRetry={onRetry}
          onEdit={onDismissError}
        />
      )}

      {/* ── Customer Email Section ────────────────────────────────────────── */}
      <div className="rounded-xl border-2 border-emerald-300 dark:border-emerald-700 overflow-hidden">
        <div className="bg-emerald-50 dark:bg-emerald-950/30 px-4 py-3 flex items-start gap-2.5">
          <MailCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-xs font-bold text-emerald-800 dark:text-emerald-200">
              📧 Customer Resolution Email
            </p>
            <p className="text-[10px] text-emerald-700/70 dark:text-emerald-300/70 mt-0.5">
              This email goes to the employee's Gmail inbox. It must NEVER contain credentials, IDs, passwords, or URLs.
            </p>
          </div>
        </div>

        <div className="p-4 space-y-4">

          {/* Security warning */}
          <div className="flex items-start gap-2 rounded-lg bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 px-3 py-2.5">
            <ShieldOff className="h-3.5 w-3.5 text-red-500 mt-0.5 shrink-0" />
            <p className="text-[10px] text-red-700 dark:text-red-300 leading-relaxed">
              <strong>NEVER</strong> include passwords, SAP IDs, usernames, URLs, tokens, roles,
              or any system credentials in this email. Use IntelliDesk for secure credential delivery.
            </p>
          </div>

          {/* Engineer notes */}
          <div className="space-y-1.5">
            <label className="flex items-center gap-1.5 text-xs font-bold text-foreground">
              <StickyNote className="h-3.5 w-3.5 text-muted-foreground" />
              What was resolved? (Internal summary for AI)
            </label>
            <textarea
              value={engineerNotes}
              onChange={(e) => onEngineerNotesChange(e.target.value)}
              placeholder="e.g. SAP user account created, assigned FI_VIEWER role. VPN configured and tested. Laptop imaged and ready for collection."
              rows={3}
              className="w-full px-3 py-2 text-xs rounded-lg border border-input bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-emerald-400/50 resize-none"
            />
            <p className="text-[10px] text-muted-foreground">
              Describe what you did. Gemini generates a credential-free customer email from this.
            </p>
          </div>

          {/* Generate + Regenerate buttons */}
          <div className="flex items-center gap-2 flex-wrap">
            <button
              id="btn-generate-customer-email"
              onClick={onGenerateCustomerEmail}
              disabled={customerEmailGenerating}
              className="flex items-center gap-1.5 text-xs font-semibold border border-emerald-400 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300 rounded-lg px-4 py-2 hover:bg-emerald-100 dark:hover:bg-emerald-950/60 transition-all disabled:opacity-50"
            >
              {customerEmailGenerating
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <Wand2 className="h-3.5 w-3.5" />}
              {customerEmailGenerating ? 'Generating…' : customerEmailBody ? 'Regenerate Email' : 'Generate Customer Email'}
            </button>
            {customerEmailBody && !customerEmailGenerating && (
              <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-semibold">
                ✓ Email generated — review and edit below
              </span>
            )}
          </div>

          {/* Generation error */}
          {customerEmailError && (
            <p className="text-xs text-red-600 bg-red-50 dark:bg-red-950/20 border border-red-200 rounded-lg px-3 py-2">
              {customerEmailError}
            </p>
          )}

          {/* Generated email — editable preview */}
          {customerEmailBody ? (
            <div className="space-y-3">
              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Subject</label>
                <input
                  type="text"
                  value={customerEmailSubject}
                  onChange={(e) => onCustomerEmailSubjectChange(e.target.value)}
                  className="w-full h-9 px-3 text-xs rounded-lg border border-emerald-300 dark:border-emerald-700 bg-white dark:bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-emerald-400/50"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  Email Body (editable)
                </label>
                <textarea
                  value={customerEmailBody}
                  onChange={(e) => onCustomerEmailBodyChange(e.target.value)}
                  rows={10}
                  className="w-full px-3 py-2.5 text-xs rounded-lg border border-emerald-300 dark:border-emerald-700 bg-white dark:bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-emerald-400/50 resize-y font-mono leading-relaxed"
                />
              </div>

              {/* Send footer */}
              <div className="flex items-center justify-between gap-2 pt-1 border-t border-border/40">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Send className="h-3 w-3" />
                  <span>Sending to: <span className="font-semibold text-foreground">{employeeEmail || '—'}</span></span>
                </div>
                <button
                  id="btn-send-resolution"
                  onClick={onRequestConfirm}
                  disabled={sending || !customerEmailBody.trim()}
                  className="flex items-center gap-1.5 text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg px-5 py-2.5 transition-all disabled:opacity-50"
                >
                  {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                  {sending ? 'Sending…' : 'Send Resolution'}
                </button>
              </div>
            </div>
          ) : (
            <div className="rounded-lg border-2 border-dashed border-emerald-200 dark:border-emerald-800 py-8 flex flex-col items-center gap-2 text-center">
              <Wand2 className="h-7 w-7 text-emerald-300" />
              <p className="text-xs text-muted-foreground">
                Add your engineer notes above, then click<br /><strong>Generate Customer Email</strong>
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function WorkItemDetailPage({ params }: { params: { id: string } }) {
  const router = useRouter();

  const [item,      setItem]      = useState<DeptWorkItem | null>(null);
  const [logs,      setLogs]      = useState<DeptWorkLog[]>([]); 
  const [email,     setEmail]     = useState<Record<string, any> | null>(null);
  const [ticket,    setTicket]    = useState<Record<string, any> | null>(null);
  const [approval,  setApproval]  = useState<Record<string, any> | null>(null);
  // acceptanceApproval: the PENDING acceptance record for the assigned officer
  const [acceptanceApproval, setAcceptanceApproval] = useState<Record<string, any> | null>(null);
  const [loading,   setLoading]   = useState(true);
  const [actioning, setActioning] = useState(false);
  const [noteText,  setNoteText]  = useState('');
  // actor = the name to record in work logs (initialised from item.assigned_to, not hardcoded)
  // This is NOT the assignee — use item.assigned_to for the real DB assignment.
  const [actor, setActor] = useState('');
  const [reassignTo, setReassignTo] = useState('');
  const [showReassign, setShowReassign] = useState(false);
  const [showInfoModal, setShowInfoModal] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiResult,  setAiResult]  = useState<string | null>(null);
  const [aiType,    setAiType]    = useState<string | null>(null);
  const [similarCases, setSimilarCases] = useState<any[]>([]);
  const [actionError, setActionError] = useState<string | null>(null);
  /** IDs of required fields that were empty when user attempted completion */
  const [missingFieldIds, setMissingFieldIds] = useState<string[]>([]);

  // ── AI Panel tab state ────────────────────────────────────────────────
  // Tabs: 'analysis' | 'dept_processing' | 'customer_resolution'
  const [aiTab, setAiTab] = useState<'analysis' | 'dept_processing' | 'customer_resolution'>('analysis');

  // ── Dept Processing completion state ──────────────────────────────────
  const [completing, setCompleting] = useState(false);

  // ── Resolution Draft state ────────────────────────────────────────
  const [draftLoading,    setDraftLoading]    = useState(false);
  const [draftTemplateId, setDraftTemplateId] = useState<string>('');
  const [draftTemplateLabel, setDraftTemplateLabel] = useState<string>('');
  const [draftAllTemplates,  setDraftAllTemplates]  = useState<{id:string;label:string}[]>([]);
  const [draftSubject,    setDraftSubject]    = useState('');
  const [draftIntro,      setDraftIntro]      = useState('');
  const [draftSections,   setDraftSections]   = useState<DraftSection[]>([]);
  const [draftClosing,    setDraftClosing]    = useState('');
  const [draftEmployeeName, setDraftEmployeeName] = useState('');
  const [draftEmployeeEmail, setDraftEmployeeEmail] = useState('');
  const [draftFields,     setDraftFields]     = useState<Record<string,string>>({});
  const [draftPreviewMode, setDraftPreviewMode] = useState(false);
  const [draftSending,    setDraftSending]    = useState(false);
  const [draftSendError,  setDraftSendError]  = useState<string|null>(null);
  const [draftLoaded,     setDraftLoaded]     = useState(false);

  // ── Module 4: Toast + Confirmation modal ───────────────────────────────────
  // Resolution state is driven purely by item.status === 'completed' from DB.
  // No client-side refs or fake flags — only fetchData() truth.
  const [toast,            setToast]           = useState<string | null>(null);
  const [showConfirmModal, setShowConfirmModal] = useState(false);

  // ── Customer-safe AI email (what gets sent to employee) ─────────────────
  const [engineerNotes,          setEngineerNotes]          = useState('');
  const [customerEmailBody,      setCustomerEmailBody]      = useState('');
  const [customerEmailSubject,   setCustomerEmailSubject]   = useState('');
  const [customerEmailGenerating,setCustomerEmailGenerating]= useState(false);
  const [customerEmailError,     setCustomerEmailError]     = useState<string | null>(null);

  // ── Two-phase resolution state ────────────────────────────────────────────
  // Tracks Phase 2 (Gmail notification) result independently of the DB ticket status
  const [notificationStatus,  setNotificationStatus]  = useState<string | null>(null);
  const [notificationError,   setNotificationError]   = useState<string | null>(null);
  const [retrying,            setRetrying]            = useState(false);

  // ── Data fetch ─────────────────────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(`/api/dept/${params.id}`);
      if (!res.ok) return;
      const d = await res.json();
      setItem(d.item);
      setLogs(d.logs ?? []);
      setEmail(d.email);
      setTicket(d.ticket);
      setApproval(d.approval);
      setAcceptanceApproval(d.acceptanceApproval ?? null);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [params.id]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Initialise actor from the actual DB assignment once data loads
  useEffect(() => {
    if (item && !actor) {
      setActor(item.assigned_to ?? '');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.assigned_to]);

  // Pre-populate engineerNotes with the customer-safe resolution summary
  // (computed from Step 5 fields, sensitive values stripped) — only if not already set.
  // This is the text passed to Gemini for generating the customer email.
  // It NEVER contains salary amounts, corrected figures, or any confidential data.
  useEffect(() => {
    if (item?.resolution_safe_summary && !engineerNotes) {
      setEngineerNotes(item.resolution_safe_summary);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.resolution_safe_summary]);

  // ── Realtime subscription ──────────────────────────────────────────────────
  useEffect(() => {
    const channel = supabase
      .channel(`dept_item_${params.id}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'dept_work_items',
        filter: `id=eq.${params.id}`,
      }, () => fetchData())
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'dept_work_logs',
        filter: `work_item_id=eq.${params.id}`,
      }, () => fetchData())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [params.id, fetchData]);

  // ── Generic action handler ─────────────────────────────────────────────────
  async function doAction(action: string, extraNote?: string, extraReassign?: string) {
    if (!item) return;
    setActioning(true);
    setActionError(null);
    try {
      // ── ACCEPT path: if there is a pending acceptance approval,
      //    call the approval action endpoint to mark it approved.
      //    processAcceptanceApproval() will set accepted_at and advance
      //    dept_work_items to in_progress — so the dept action endpoint
      //    becomes a no-op for status (it will set accepted_at again safely).
      if (action === 'accept' && acceptanceApproval?.id && acceptanceApproval?.status === 'pending') {
        const accRes = await fetch(`/api/approvals/${acceptanceApproval.id}/action`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'approved',
            comments: `${actor || item.assigned_to || 'Officer'} accepted via Department page.`,
          }),
        });
        const accData = await accRes.json();
        if (!accRes.ok) {
          // Non-fatal — still proceed with the dept action to set status
          console.warn('[doAction accept] acceptance approval update failed:', accData.error);
        } else {
          // Acceptance approval marked as approved — update local state
          setAcceptanceApproval(accData.approval ?? { ...acceptanceApproval, status: 'approved' });
          // Also update item from server state (accepted_at will be set by processAcceptanceApproval)
          // Note: setActioning(false) is handled in the finally block below
          await fetchData();
          return; // processAcceptanceApproval already moved status to in_progress
        }
      }

      // ── Standard dept action endpoint ─────────────────────────────────────
      const res = await fetch(`/api/dept/${item.id}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          actor,
          note:       extraNote   ?? (noteText.trim() || undefined),
          reassignTo: extraReassign ?? (reassignTo || undefined),
        }),
      });
      const d = await res.json();
      if (!res.ok) {
        setActionError(d.error ?? 'Action failed');
        return;
      }
      setItem(d.item);
      setNoteText('');
      setReassignTo('');
      setShowReassign(false);
      setShowInfoModal(false);
      await fetchData();
    } catch (e: any) {
      setActionError(e.message ?? 'Unexpected error');
    } finally { setActioning(false); }
  }

  // ── Request More Info — send email + set waiting ───────────────────────────
  async function handleSendInfoRequest(emailBody: string) {
    if (!item) return;
    setActioning(true);
    try {
      // Send the email
      const infoPayload = {
        ticket_id:     item.ticket_id ?? null,   // from DeptWorkItem
        to_email:      item.employee_email,
        subject:       `Additional Information Required — ${item.intent ?? 'Your Request'}`,
        response_text: emailBody,
      };
      console.log('[dept] Sending info request payload', infoPayload);
      await fetch('/api/send-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(infoPayload),
      });
    } catch { /* non-fatal — still transition status */ }

    // Transition to waiting regardless of email send result
    await doAction('request_info', `Email sent to ${item.employee_email} requesting additional information.`);
    setShowInfoModal(false);
  }

  // ── AI Assist ──────────────────────────────────────────────────────────────
  async function callAI(type: string) {
    setAiLoading(true);
    setAiType(type);
    setAiResult(null);
    setSimilarCases([]);
    try {
      // Build grounded context for suggest_steps — never invent values
      const workItemContext = type === 'suggest_steps' ? {
        status:         item?.status,
        priority:       item?.priority,
        assignedTo:     item?.assigned_to,
        acceptedAt:     item?.accepted_at,
        startedAt:      item?.started_at,
        completedAt:    item?.completed_at,
        employeeEmail:  item?.employee_email,
        approvalStatus: approval?.status,
        approvedBy:     approval?.approved_by ?? approval?.manager_name,
        approvedAt:     approval?.approved_at,
        riskLevel:      approval?.risk_level,
        aiReason:       approval?.ai_reason,
        logs: logs.map(l => ({
          action:    l.action,
          actor:     l.actor,
          note:      l.note,
          createdAt: l.created_at,
        })),
      } : undefined;

      const res = await fetch('/api/dept/ai-assist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type,
          ticketBody:      email?.body ?? ticket?.intent ?? item?.intent ?? 'Support request',
          department:      item?.department,
          intent:          item?.intent ?? ticket?.intent,
          employeeName:    item?.employee_name,
          workItemContext,
        }),
      });
      const d = await res.json();
      if (type === 'similar_cases') setSimilarCases(d.result ?? []);
      else setAiResult(d.result ?? '');
    } catch (e) { console.error(e); setAiResult('AI assist unavailable.'); }
    finally { setAiLoading(false); }
  }

  // ── Resolution Draft — fetch template ─────────────────────────────────────────
  async function fetchDraft(overrideTemplateId?: string) {
    if (!item) return;
    setDraftLoading(true);
    setDraftSendError(null);
    try {
      const res = await fetch(`/api/dept/${item.id}/resolution-draft`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ overrideTemplateId }),
      });
      const d = await res.json();
      if (!res.ok) { console.error(d.error); return; }
      setDraftTemplateId(d.templateId ?? '');
      setDraftTemplateLabel(d.templateLabel ?? '');
      setDraftAllTemplates(d.allTemplates ?? []);
      setDraftSubject(d.subject ?? '');
      setDraftIntro(d.intro ?? '');
      setDraftSections(d.sections ?? []);
      setDraftClosing(d.closing ?? '');
      setDraftEmployeeName(d.employeeName ?? '');
      setDraftEmployeeEmail(d.employeeEmail ?? '');
      setDraftFields({});
      setDraftLoaded(true);
    } catch (e) { console.error(e); }
    finally { setDraftLoading(false); }
  }

  // ── Generate customer-safe AI email ──────────────────────────────────────
  async function fetchCustomerEmail() {
    if (!item) return;
    setCustomerEmailGenerating(true);
    setCustomerEmailError(null);
    try {
      const res = await fetch(`/api/dept/${item.id}/generate-customer-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ engineerNotes, actor }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Failed to generate email');
      setCustomerEmailBody(d.body ?? '');
      setCustomerEmailSubject(d.subject ?? draftSubject);
    } catch (e: any) {
      setCustomerEmailError(e.message);
    } finally {
      setCustomerEmailGenerating(false);
    }
  }

  // ── Confirm before send — validate customer email body ──────────────────
  function handleRequestConfirm() {
    const recipientEmail = item?.employee_email ?? draftEmployeeEmail;
    if (!recipientEmail || draftSending) return;
    if (!customerEmailBody.trim()) {
      setDraftSendError('Please generate the customer email first, then click Send Resolution.');
      return;
    }
    setShowConfirmModal(true);
  }

  // ── Confirmed publish — Two-phase resolution ──────────────────────────────
  // Phase 1: Save resolution to IntelliDesk DB (always)
  // Phase 2: Send real Gmail notification (auto after Phase 1)
  // Ticket becomes RESOLVED only when BOTH succeed.
  async function handleDraftSend() {
    const recipientEmail = item?.employee_email ?? draftEmployeeEmail;
    if (!recipientEmail || draftSending) return;
    setShowConfirmModal(false);
    setDraftSending(true);
    setDraftSendError(null);
    setNotificationStatus(null);
    setNotificationError(null);
    try {
      const caseTitle = item?.intent || email?.subject || 'Your Support Request';
      const subject   = customerEmailSubject || draftSubject || `Re: ${caseTitle}`;
      const body      = customerEmailBody;

      const res = await fetch(`/api/dept/${params.id}/send-resolution`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject, body, resolved_by: actor, title: caseTitle }),
      });
      const d = await res.json();

      if (d.migrationRequired) {
        // Migration 041 not yet applied
        setDraftSendError(
          '⚠ Database migration required. Please run Migration 041 in Supabase Dashboard → SQL Editor, then retry.'
        );
        return;
      }

      if (!res.ok && !d.primaryPublished) {
        // Phase 1 failed (DB save failed)
        setDraftSendError(
          d.error ?? `Failed to save resolution (HTTP ${res.status}). Please retry.`
        );
        return;
      }

      // Phase 1 succeeded — show intermediate state
      if (d.primaryPublished && !d.notificationSent) {
        // Phase 2 failed — resolution IS published, notification FAILED
        setNotificationStatus('FAILED');
        setNotificationError(d.notificationError ?? 'Gmail notification failed');
        setDraftSendError(null);
        setToast('⚠ Resolution published in IntelliDesk. Gmail notification failed — retry required.');
        await fetchData();
        return;
      }

      // Both phases succeeded
      setNotificationStatus('SENT');
      setNotificationError(null);
      setToast('✓ Resolution published in IntelliDesk and Gmail notification delivered. Ticket resolved.');
      await fetchData();

      // Navigate to completed queue after 4 s
      setTimeout(() => { router.push('/department?tab=completed'); }, 4000);

    } catch (e: any) {
      setDraftSendError(e.message ?? 'Unexpected error — please try again.');
    } finally {
      setDraftSending(false);
    }
  }

  // ── Retry secondary Gmail notification (Phase 2 only) ─────────────────────
  async function handleRetryNotification() {
    if (!item || retrying) return;
    setRetrying(true);
    setNotificationError(null);
    try {
      const res = await fetch(`/api/dept/${params.id}/retry-notification`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resolved_by: actor || item.assigned_to || 'System' }),
      });
      const d = await res.json();

      if (d.notificationSent) {
        setNotificationStatus('SENT');
        setNotificationError(null);
        setToast(`✓ Gmail notification delivered on retry #${d.retryCount}. Ticket fully resolved.`);
        await fetchData();
        setTimeout(() => { router.push('/department?tab=completed'); }, 4000);
      } else {
        setNotificationStatus('FAILED');
        setNotificationError(d.gmailError ?? 'Retry failed');
        setToast(`✗ Retry #${d.retryCount} failed: ${d.gmailError}. Check Gmail OAuth in Settings → Email.`);
      }
    } catch (e: any) {
      setNotificationError(e.message ?? 'Retry failed');
    } finally {
      setRetrying(false);
    }
  }

  // ── Complete Department Processing ──────────────────────────────────────
  // Transitions escalated/accepted/in_progress/waiting → customer_resolution.
  // NO email is sent here. Gmail is only called from handleDraftSend.
  async function handleCompleteDeptProcessing() {
    if (!item) return;
    // Allow completion from any active status — escalated tickets may skip accept/start
    const ACTIVE_STATUSES = ['escalated', 'assigned', 'accepted', 'in_progress', 'waiting'];
    if (!ACTIVE_STATUSES.includes(item.status)) {
      console.warn('[DEPT_PROCESSING] Cannot complete from status:', item.status);
      return;
    }

    // ── FRONTEND VALIDATION: check required fields BEFORE calling the API ────────
    // Uses the same DraftSection[] that are displayed in the form.
    // If any required field is empty, abort and show error — no DB change.
    if (draftLoaded && draftSections.length > 0) {
      const missing: string[] = [];       // labels for error message
      const missingIds: string[] = [];    // ids for field highlighting
      for (const section of draftSections) {
        for (const field of section.fields) {
          if (field.required && !draftFields[field.id]?.trim()) {
            missing.push(field.label);
            missingIds.push(field.id);
          }
        }
      }
      if (missing.length > 0) {
        console.warn('[DEPT_PROCESSING] validation failed — missing required fields:', missing);
        setMissingFieldIds(missingIds);
        setActionError(
          `Please complete all required fields before completing Department Processing: ${missing.join(', ')}.`
        );
        return;  // ← API is NOT called. Database unchanged.
      }
    }

    setMissingFieldIds([]);
    setActionError(null);
    console.log('[DEPT_PROCESSING] complete clicked — ticketId=', item.ticket_id, 'workItemId=', item.id, 'status=', item.status);
    setCompleting(true);
    try {
      console.log('[DEPT_PROCESSING] validation=passed — calling completion API for workItemId=', item.id);
      const res = await fetch(`/api/dept/${item.id}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action:      'complete_dept_processing',
          actor,
          note:        `${actor} completed department processing for ${item.department ?? 'department'} ticket. Advancing to Customer Resolution.`,
          // Send field values + template so the backend can independently validate
          templateId:  draftTemplateId || undefined,
          fieldValues: draftFields,
        }),
      });
      const d = await res.json();
      console.log('[DEPT_PROCESSING] API response=', res.status, d);
      if (!res.ok) {
        const errMsg = d.error ?? 'Unable to complete Department Processing. Please try again.';
        // If backend returns missing field ids, highlight them
        if (d.missingFields) setMissingFieldIds(d.missingFields);
        console.error('[DEPT_PROCESSING] API error:', errMsg);
        setActionError(errMsg);
        return;
      }
      if (d.item) setItem(d.item);
      await fetchData();
      setAiTab('customer_resolution');
      setToast('✓ Department Processing Completed. The internal resolution has been recorded. Generate the customer notification from Customer Resolution.');
    } catch (e: any) {
      const errMsg = e.message ?? 'Unexpected error — please try again.';
      console.error('[DEPT_PROCESSING] exception:', errMsg);
      setActionError(errMsg);
    } finally {
      setCompleting(false);
    }
  }


  // ── Loading / not found states ─────────────────────────────────────────────
  if (loading) return (
    <div className="flex h-screen bg-background">
      <Sidebar />
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    </div>
  );

  if (!item) return (
    <div className="flex h-screen bg-background">
      <Sidebar />
      <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-3">
        <X className="h-10 w-10 opacity-30" />
        <p className="font-medium">Work item not found</p>
        <Link href="/department" className="text-sm text-primary hover:underline">← Back to Queue</Link>
      </div>
    </div>
  );

  const statusCfg        = STATUS_CONFIG[item.status] ?? STATUS_CONFIG.assigned;
  const isCompleted      = item.status === 'completed';
  const isQV             = item.status === 'quality_check';
  const isCustomerRes    = item.status === 'customer_resolution';
  // isDeptProcessing: true for all active working states, including escalated/accepted
  const isDeptProcessing = ['escalated', 'assigned', 'accepted', 'in_progress', 'waiting'].includes(item.status);

  // Auto-advance tab when status changes (e.g. after completeDeptProcessing)
  const effectiveTab = isCompleted || isCustomerRes
    ? 'customer_resolution'
    : isDeptProcessing
    ? aiTab === 'customer_resolution' ? 'dept_processing' : aiTab
    : aiTab;

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      <Sidebar />

      {/* Toast */}
      {toast && <Toast message={toast} onDismiss={() => setToast(null)} />}

      {/* Module 4: Confirm Send Resolution Modal */}
      {showConfirmModal && (
        <ConfirmSendModal
          sending={draftSending}
          onCancel={() => setShowConfirmModal(false)}
          onConfirm={handleDraftSend}
        />
      )}

      {/* Request More Info Modal */}
      {showInfoModal && (
        <RequestInfoModal
          employeeName={item.employee_name ?? 'Employee'}
          employeeEmail={item.employee_email ?? ''}
          intent={item.intent ?? 'Your Request'}
          onClose={() => setShowInfoModal(false)}
          onSend={handleSendInfoRequest}
          sending={actioning}
        />
      )}

      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="border-b border-border bg-card px-6 py-3.5 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <Link href="/department" className="text-muted-foreground hover:text-foreground transition-colors">
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-mono text-xs text-muted-foreground">#{item.id.slice(0,8).toUpperCase()}</span>
                <span className={cn('text-xs font-bold px-2 py-0.5 rounded-full border', PRIORITY_COLORS[item.priority])}>
                  {item.priority.toUpperCase()}
                </span>
                <span className={cn(
                  'text-xs font-semibold px-2.5 py-0.5 rounded-full',
                  STATUS_BADGE_STYLES[item.status] ?? 'bg-muted text-muted-foreground'
                )}>
                  {statusCfg.label}
                </span>
              </div>
              <p className="text-sm font-semibold text-foreground mt-0.5">
                {item.employee_name ?? 'Unknown Employee'} — {item.department ?? 'Department'}
              </p>
            </div>
          </div>
          <SlaTimer deadline={item.sla_deadline} breached={item.sla_breached} status={item.status} />
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-0 h-full divide-x divide-border">

            {/* ── LEFT: Context ────────────────────────────────────────── */}
            <div className="overflow-y-auto p-5 space-y-4">

              {/* Employee Info */}
              <section className="rounded-xl border border-border bg-card p-4 space-y-2">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-muted-foreground mb-2">
                  <User className="h-3.5 w-3.5" /> Employee Information
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                  {[
                    ['Name',       item.employee_name ?? '—'],
                    ['Email',      item.employee_email ?? '—'],
                    ['Department', item.department ?? '—'],
                    ['Team',       item.team_name ?? '—'],
                    ['Intent',     item.intent ?? '—'],
                    ['Priority',   item.priority.toUpperCase()],
                  ].map(([k, v]) => (
                    <div key={k}>
                      <p className="text-muted-foreground">{k}</p>
                      <p className="font-semibold text-foreground truncate">{v}</p>
                    </div>
                  ))}
                </div>
              </section>

              {/* Timestamps */}
              <section className="rounded-xl border border-border bg-card p-4 space-y-2">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-muted-foreground mb-2">
                  <Clock className="h-3.5 w-3.5" /> Timeline
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                  {[
                    ['Created',    item.created_at ? new Date(item.created_at).toLocaleString() : '—'],
                    ['Accepted',   item.accepted_at  ? new Date(item.accepted_at).toLocaleString()  : '—'],
                    ['Started',    item.started_at   ? new Date(item.started_at).toLocaleString()   : '—'],
                    ['Completed',  item.completed_at ? new Date(item.completed_at).toLocaleString() : '—'],
                    ['Assigned To',item.assigned_to ?? '—'],
                  ].map(([k, v]) => (
                    <div key={k}>
                      <p className="text-muted-foreground">{k}</p>
                      <p className="font-semibold text-foreground truncate">{v}</p>
                    </div>
                  ))}
                </div>
              </section>

              {/* Original Email */}
              {email && (
                <section className="rounded-xl border border-border bg-card p-4 space-y-2">
                  <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-muted-foreground mb-2">
                    <Mail className="h-3.5 w-3.5" /> Original Email
                  </div>
                  <p className="text-xs font-semibold text-foreground">{email.subject}</p>
                  <p className="text-xs text-muted-foreground">From: {email.sender}</p>
                  <div className="text-xs text-foreground leading-relaxed bg-muted/30 rounded-lg p-3 max-h-40 overflow-y-auto whitespace-pre-wrap">
                    {email.body}
                  </div>
                </section>
              )}

              {/* Approval History */}
              {approval && (
                <section className="rounded-xl border border-border bg-card p-4 space-y-2">
                  <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-muted-foreground mb-2">
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> Approval History
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                    {[
                      ['Status',      (approval.status ?? '—').toUpperCase()],
                      ['Manager',     approval.manager_name ?? '—'],
                      ['Approved By', approval.approved_by ?? approval.manager_name ?? '—'],
                      ['Approved At', approval.approved_at ? new Date(approval.approved_at).toLocaleString() : '—'],
                      ['AI Reason',   approval.ai_reason ?? '—'],
                      ['Risk Level',  approval.risk_level ?? '—'],
                    ].map(([k, v]) => (
                      <div key={k} className="col-span-1">
                        <p className="text-muted-foreground">{k}</p>
                        <p className="font-semibold text-foreground truncate">{v}</p>
                      </div>
                    ))}
                  </div>
                  <Link href={`/approvals/${approval.id}`} className="flex items-center gap-1 text-xs text-primary hover:underline mt-1">
                    <ArrowRight className="h-3 w-3" /> View full approval
                  </Link>
                </section>
              )}

              {/* Similar Cases (from AI) */}
              {similarCases.length > 0 && (
                <section className="rounded-xl border border-border bg-card p-4 space-y-2">
                  <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-2">Similar Cases</p>
                  {similarCases.slice(0, 3).map((c: any, i: number) => (
                    <div key={i} className="text-xs bg-muted/30 rounded-lg p-2.5">
                      <p className="font-semibold truncate">{c.emailSubject ?? c.intent}</p>
                      <p className="text-muted-foreground line-clamp-2 mt-0.5">{c.finalResponse}</p>
                      <p className="text-[10px] text-primary mt-1">{Math.round((c.similarity ?? 0) * 100)}% match</p>
                    </div>
                  ))}
                </section>
              )}
            </div>

            {/* ── RIGHT: Processing ─────────────────────────────────────── */}
            <div className="overflow-y-auto p-5 space-y-4">

              {/* Workflow Stage Stepper — full lifecycle banner after resolution */}
              <section className="rounded-xl border border-border bg-card p-4 space-y-3">
                {item.status === 'completed' ? (
                  <LifecycleBanner />
                ) : (
                  <>
                    <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Workflow Stage</p>
                    <WorkflowStepper
                      status={item.status}
                      hasAssignee={!!item.assigned_to}
                      acceptedAt={item.accepted_at}
                      notificationStatus={notificationStatus ?? ticket?.notification_status}
                    />
                  </>
                )}
              </section>

              {/* ── ESCALATION INVESTIGATION CARD ─────────────────────────── */}
              {/* Show when this work item was created via escalation */}
              {item.escalated_from_ticket_id && !isCompleted && (
                <section className={cn(
                  'rounded-xl border-2 p-4 space-y-3',
                  item.investigation_complete
                    ? 'border-emerald-400 dark:border-emerald-600 bg-emerald-50 dark:bg-emerald-950/20'
                    : 'border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-950/20'
                )}>
                  <div className="flex items-start gap-2.5">
                    <div className={cn(
                      'p-1.5 rounded-lg shrink-0',
                      item.investigation_complete
                        ? 'bg-emerald-100 dark:bg-emerald-900/40'
                        : 'bg-red-100 dark:bg-red-900/40'
                    )}>
                      <ClipboardList className={cn(
                        'h-4 w-4',
                        item.investigation_complete
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-red-600 dark:text-red-400'
                      )} />
                    </div>
                    <div className="flex-1">
                      <p className={cn(
                        'text-sm font-bold',
                        item.investigation_complete
                          ? 'text-emerald-800 dark:text-emerald-200'
                          : 'text-red-800 dark:text-red-200'
                      )}>
                        {item.investigation_complete ? '✓ Investigation Complete' : '🚨 Payroll Investigation Required'}
                      </p>
                      <p className={cn(
                        'text-[11px] mt-0.5',
                        item.investigation_complete
                          ? 'text-emerald-700/70 dark:text-emerald-300/70'
                          : 'text-red-700/70 dark:text-red-300/70'
                      )}>
                        {item.investigation_complete
                          ? 'Investigation complete. You may now generate and send the resolution email.'
                          : 'This ticket was escalated. Complete the payroll investigation before sending the resolution email.'}
                      </p>
                    </div>
                  </div>
                  <Link
                    href={`/department/${params.id}/investigation`}
                    className={cn(
                      'w-full flex items-center justify-center gap-2 text-xs font-bold rounded-lg px-4 py-2.5 transition-colors',
                      item.investigation_complete
                        ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                        : 'bg-red-600 hover:bg-red-700 text-white'
                    )}
                  >
                    <ClipboardList className="h-3.5 w-3.5" />
                    {item.investigation_complete ? 'View Investigation' : 'Open Investigation →'}
                  </Link>
                </section>
              )}


              {/* ── QUALITY VERIFICATION PANEL ─────────────────────────── */}
              {isQV && (
                <section className="rounded-xl border-2 border-sky-300 dark:border-sky-700 bg-sky-50 dark:bg-sky-950/20 p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <div className="p-1.5 bg-sky-100 dark:bg-sky-900/50 rounded-lg">
                      <ShieldCheck className="h-4 w-4 text-sky-600 dark:text-sky-400" />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-sky-700 dark:text-sky-300">Quality Verification</p>
                      <p className="text-[11px] text-sky-600/70 dark:text-sky-400/70">Review the work done and approve or return for rework</p>
                    </div>
                  </div>

                  {/* Actor for QV */}
                  <div className="flex items-center gap-2">
                    <label className="text-xs text-muted-foreground whitespace-nowrap">Reviewer:</label>
                    <input
                      value={actor}
                      onChange={e => setActor(e.target.value)}
                      className="flex-1 text-xs border border-border rounded-lg px-2 py-1.5 bg-background focus:outline-none focus:ring-1 focus:ring-sky-400"
                      placeholder="Reviewer name"
                    />
                  </div>

                  <textarea
                    value={noteText}
                    onChange={e => setNoteText(e.target.value)}
                    rows={2}
                    placeholder="Verification notes (optional)…"
                    className="w-full text-xs border border-border rounded-lg px-2.5 py-2 bg-background focus:outline-none focus:ring-1 focus:ring-sky-400 resize-none"
                  />

                  <div className="flex gap-2">
                    <button
                      onClick={() => doAction('verify_approve', noteText || `Quality verified. ${actor} approved this ticket.`)}
                      disabled={actioning}
                      className="flex-1 flex items-center justify-center gap-1.5 text-xs font-bold bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg px-3 py-2.5 transition-colors disabled:opacity-50"
                    >
                      {actioning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                      Approve & Complete
                    </button>
                    <button
                      onClick={() => doAction('verify_return', noteText || `${actor} returned ticket for rework.`)}
                      disabled={actioning || !noteText.trim()}
                      className="flex-1 flex items-center justify-center gap-1.5 text-xs font-bold border-2 border-orange-300 dark:border-orange-700 text-orange-700 dark:text-orange-300 hover:bg-orange-50 dark:hover:bg-orange-950/40 rounded-lg px-3 py-2.5 transition-colors disabled:opacity-40"
                    >
                      {actioning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
                      Return for Rework
                    </button>
                  </div>
                  {!noteText.trim() && (
                    <p className="text-[10px] text-muted-foreground">
                      ℹ️ Add a note above to enable "Return for Rework"
                    </p>
                  )}
                </section>
              )}

              {/* ── ACTIONS (not shown when completed or in quality_check) ── */}
              {!isCompleted && !isQV && (
                <section className="rounded-xl border border-border bg-card p-4 space-y-3">
                  <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Actions</p>

                  {/* ── Assignment info: show who is assigned, NOT logged-in user ── */}
                  {item.assigned_to ? (
                    // Ticket IS assigned — show the actual assignee from DB
                    <div className="flex items-center gap-2 bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800 rounded-lg px-3 py-2">
                      <UserCheck className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">Assigned To</p>
                        <p className="text-xs font-bold text-emerald-800 dark:text-emerald-200 truncate">{item.assigned_to}</p>
                      </div>
                    </div>
                  ) : (
                    // Ticket is genuinely UNASSIGNED — show actor input for self-assignment
                    <div className="flex items-center gap-2">
                      <label className="text-xs text-muted-foreground whitespace-nowrap">Your name:</label>
                      <input
                        value={actor}
                        onChange={e => setActor(e.target.value)}
                        className="flex-1 text-xs border border-border rounded-lg px-2 py-1.5 bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                        placeholder="Engineer name"
                      />
                    </div>
                  )}

                  <div className="flex flex-wrap gap-2 items-start">

                    {/* ASSIGNED + UNASSIGNED: Show "Assign to Me" — self-service only */}
                    {item.status === 'assigned' && !item.assigned_to && (
                      <ActionBtn
                        icon={UserCheck}
                        label="Assign to Me & Begin"
                        color="blue"
                        loading={actioning}
                        onClick={() => doAction('accept')}
                      />
                    )}

                    {/* ASSIGNED + auto-assigned: show acceptance required banner + Accept button */}
                    {item.status === 'assigned' && item.assigned_to && (
                      <>
                        <div className="w-full rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/20 px-3 py-2 flex items-start gap-2 text-xs">
                          <BadgeCheck className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400 mt-0.5 shrink-0" />
                          <div>
                            <p className="font-semibold text-blue-800 dark:text-blue-200">Acceptance Required</p>
                            <p className="text-blue-700/70 dark:text-blue-300/70 mt-0.5">
                              {item.assigned_to} must accept this case to begin Department Processing.
                            </p>
                          </div>
                        </div>
                        <ActionBtn
                          icon={BadgeCheck}
                          label="Accept & Begin Processing"
                          color="blue"
                          loading={actioning}
                          onClick={() => doAction('accept')}
                        />
                      </>
                    )}

                    {/* ACCEPTED status (legacy path if accept goes to accepted instead of in_progress) */}
                    {item.status === 'accepted' && (
                      <ActionBtn
                        icon={Play}
                        label="Begin Processing"
                        color="violet"
                        loading={actioning}
                        onClick={() => doAction('start')}
                      />
                    )}

                    {/* IN_PROGRESS: Show "Request More Info", "Complete" (→ QV), "Escalate" */}
                    {item.status === 'in_progress' && (
                      <>
                        <ActionBtn
                          icon={HelpCircle}
                          label="Request More Info"
                          color="amber"
                          loading={actioning}
                          onClick={() => setShowInfoModal(true)}
                        />
                        <ActionBtn
                          icon={ShieldAlert}
                          label="Escalate"
                          color="red"
                          loading={actioning}
                          onClick={() => doAction('escalate', noteText || 'Escalated to senior engineer')}
                        />
                        <ActionBtn
                          icon={ClipboardCheck}
                          label="Complete → QV"
                          color="sky"
                          loading={actioning}
                          onClick={() => doAction('submit_for_review', noteText || `${actor || item.assigned_to || 'Engineer'} submitted work for quality verification.`)}
                        />
                      </>
                    )}

                    {/* WAITING: Show "Resume Work" */}
                    {item.status === 'waiting' && (
                      <ActionBtn
                        icon={Play}
                        label="Resume Work"
                        color="violet"
                        loading={actioning}
                        onClick={() => doAction('resume', `${actor || item.assigned_to || 'Engineer'} resumed work.`)}
                      />
                    )}

                    {/* ALWAYS: Reassign */}
                    <ActionBtn
                      icon={Users}
                      label="Reassign"
                      color="gray"
                      loading={actioning}
                      onClick={() => setShowReassign(v => !v)}
                    />
                  </div>

                  {/* Reassign form */}
                  {showReassign && (
                    <div className="flex items-center gap-2 mt-1">
                      <input
                        value={reassignTo}
                        onChange={e => setReassignTo(e.target.value)}
                        placeholder="Reassign to (name / email)…"
                        className="flex-1 text-xs border border-border rounded-lg px-2 py-1.5 bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                      />
                      <button
                        onClick={() => doAction('reassign', `Reassigned to ${reassignTo}`, reassignTo)}
                        disabled={!reassignTo || actioning}
                        className="text-xs font-semibold bg-primary text-primary-foreground rounded-lg px-3 py-1.5 disabled:opacity-50"
                      >Reassign</button>
                    </div>
                  )}

                  {/* Work log note textarea + author name (only when already assigned, for log attribution) */}
                  {item.assigned_to && (
                    <div className="flex items-center gap-2">
                      <label className="text-xs text-muted-foreground whitespace-nowrap">Log as:</label>
                      <input
                        value={actor}
                        onChange={e => setActor(e.target.value)}
                        className="flex-1 text-xs border border-border rounded-lg px-2 py-1.5 bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                        placeholder="Your name (for work log)"
                      />
                    </div>
                  )}

                  <textarea
                    value={noteText}
                    onChange={e => setNoteText(e.target.value)}
                    rows={2}
                    placeholder="Optional note / work log entry…"
                    className="w-full text-xs border border-border rounded-lg px-2.5 py-2 bg-background focus:outline-none focus:ring-1 focus:ring-primary resize-none"
                  />
                  <button
                    onClick={() => doAction('comment')}
                    disabled={!noteText.trim() || actioning}
                    className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground border border-border rounded-lg px-3 py-1.5 hover:bg-muted transition-colors disabled:opacity-40"
                  >
                    <Send className="h-3 w-3" /> Add Work Log Entry
                  </button>

                  {/* Error message */}
                  {actionError && (
                    <div className="flex items-center gap-2 text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded-lg px-3 py-2">
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                      {actionError}
                    </div>
                  )}
                </section>
              )}

              {/* Completed state info */}
              {isCompleted && (
                <section className="rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/20 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                      <p className="text-sm font-bold text-emerald-700 dark:text-emerald-300">Ticket Completed</p>
                    </div>
                    {/* Customer Resolution tab button */}
                    <button
                      onClick={() => setAiTab('customer_resolution')}
                      className="flex items-center gap-1.5 text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg px-3 py-1.5 transition-colors"
                    >
                      <MailCheck className="h-3.5 w-3.5" />
                      View Resolution
                    </button>
                  </div>
                  {item.completed_at && (
                    <p className="text-xs text-emerald-600/70 dark:text-emerald-400/70">
                      Completed on {new Date(item.completed_at).toLocaleString()}
                    </p>
                  )}
                  <p className="text-xs text-emerald-700/80 dark:text-emerald-300/80 bg-emerald-100 dark:bg-emerald-900/30 rounded-lg px-3 py-2">
                    ✉️ Use <strong>Draft Resolution Email</strong> to generate an editable email with placeholders for any sensitive fields. The engineer reviews and sends it manually.
                  </p>
                  {/* Still allow comments on completed tickets */}
                  <textarea
                    value={noteText}
                    onChange={e => setNoteText(e.target.value)}
                    rows={2}
                    placeholder="Add a closing note…"
                    className="w-full text-xs border border-border rounded-lg px-2.5 py-2 bg-background focus:outline-none focus:ring-1 focus:ring-primary resize-none mt-2"
                  />
                  <button
                    onClick={() => doAction('comment')}
                    disabled={!noteText.trim() || actioning}
                    className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground border border-border rounded-lg px-3 py-1.5 hover:bg-muted transition-colors disabled:opacity-40"
                  >
                    <Send className="h-3 w-3" /> Add Note
                  </button>
                </section>
              )}

              {/* Work Log Timeline */}
              <section className="rounded-xl border border-border bg-card p-4 space-y-3">
                <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                  Work Log
                  <span className="ml-2 text-[10px] font-normal text-muted-foreground/60 normal-case">{logs.length} entries</span>
                </p>
                {logs.length === 0 ? (
                  <p className="text-xs text-muted-foreground italic">No log entries yet.</p>
                ) : (
                  <div className="space-y-0 max-h-80 overflow-y-auto pr-1">
                    {[...logs].reverse().map((log, i) => (
                      <div key={log.id} className="flex items-start gap-2.5 text-xs py-2 border-b border-border/40 last:border-b-0">
                        <div className="mt-0.5 shrink-0">
                          <LogIcon action={log.action} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-semibold text-foreground capitalize">{log.action.replace(/_/g, ' ')}</span>
                            <span className="text-muted-foreground">by {log.actor}</span>
                            <span className="text-[10px] text-muted-foreground/60 ml-auto shrink-0">
                              {new Date(log.created_at).toLocaleString([], { month: 'short', day: 'numeric', hour:'2-digit', minute:'2-digit' })}
                            </span>
                          </div>
                          {log.note && (
                            <p className="text-muted-foreground mt-0.5 leading-relaxed">{log.note}</p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* ═══ AI ITSM PANEL ═══════════════════════════════════════ */}
              <section className="rounded-xl border border-border bg-card overflow-hidden">

                {/* Tab bar — 3 tabs */}
                <div className="flex border-b border-border bg-muted/20 overflow-x-auto">
                  {/* Tab 1: Resolution Analysis */}
                  <button
                    onClick={() => setAiTab('analysis')}
                    className={cn(
                      'flex items-center gap-1.5 px-3 py-2.5 text-xs font-bold transition-all border-b-2 whitespace-nowrap',
                      effectiveTab === 'analysis'
                        ? 'border-violet-500 text-violet-700 dark:text-violet-300 bg-card'
                        : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/40'
                    )}
                  >
                    <Brain className="h-3.5 w-3.5" />
                    AI Analysis
                  </button>
                  {/* Tab 2: Dept Processing (Step 3) */}
                  <button
                    onClick={() => { setAiTab('dept_processing'); if (!draftLoaded) fetchDraft(); }}
                    className={cn(
                      'flex items-center gap-1.5 px-3 py-2.5 text-xs font-bold transition-all border-b-2 whitespace-nowrap',
                      effectiveTab === 'dept_processing'
                        ? 'border-violet-500 text-violet-700 dark:text-violet-300 bg-card'
                        : isCompleted || isCustomerRes
                        ? 'border-transparent text-emerald-600 dark:text-emerald-400 hover:bg-muted/40'
                        : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/40'
                    )}
                  >
                    {isCompleted || isCustomerRes
                      ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                      : <Wrench className="h-3.5 w-3.5" />}
                    Dept Processing
                  </button>
                  {/* Tab 3: Customer Resolution (Step 4) */}
                  <button
                    onClick={() => setAiTab('customer_resolution')}
                    className={cn(
                      'flex items-center gap-1.5 px-3 py-2.5 text-xs font-bold transition-all border-b-2 whitespace-nowrap',
                      effectiveTab === 'customer_resolution'
                        ? isCompleted
                          ? 'border-emerald-500 text-emerald-700 dark:text-emerald-300 bg-card'
                          : 'border-amber-500 text-amber-700 dark:text-amber-300 bg-card'
                        : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/40'
                    )}
                  >
                    {isCompleted
                      ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                      : isCustomerRes
                      ? <MailCheck className="h-3.5 w-3.5 text-amber-500" />
                      : <MailCheck className="h-3.5 w-3.5" />}
                    {isCompleted ? '✓ Resolved' : 'Customer Resolution'}
                  </button>
                </div>

                {/* ── TAB 1: Resolution Analysis ─────────────────────────── */}
                {effectiveTab === 'analysis' && (
                  <div className="p-4 space-y-3">
                    <p className="text-[10px] text-muted-foreground/70 font-medium">
                      Engineer-only guidance. Never sends emails or generates credentials.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {[
                        { type: 'suggest_steps',  label: 'Resolution Analysis',       icon: Wrench       },
                        { type: 'checklist',      label: 'Troubleshooting Checklist',  icon: ClipboardList },
                        { type: 'similar_cases',  label: 'Find Similar Cases',         icon: GitBranch    },
                        { type: 'summarize',      label: 'Summarize Ticket',           icon: BookOpen     },
                      ].map(({ type, label, icon: Icon }) => (
                        <button key={type}
                          onClick={() => callAI(type)}
                          disabled={aiLoading}
                          className={cn(
                            'flex items-center gap-1.5 text-xs font-medium border rounded-lg px-3 py-1.5 transition-all hover:shadow-sm',
                            aiType === type && (aiLoading || aiResult)
                              ? 'border-violet-400 bg-violet-50 dark:bg-violet-950/30 text-violet-700 dark:text-violet-300'
                              : 'border-border hover:bg-muted text-muted-foreground hover:text-foreground'
                          )}
                        >
                          {aiType === type && aiLoading
                            ? <Loader2 className="h-3 w-3 animate-spin" />
                            : <Icon className="h-3 w-3" />}
                          {label}
                        </button>
                      ))}
                      {aiResult && (
                        <button onClick={() => { setAiResult(null); setAiType(null); }}
                          className="flex items-center gap-1 text-xs text-muted-foreground/60 hover:text-foreground ml-auto">
                          <X className="h-3 w-3" /> Clear
                        </button>
                      )}
                    </div>
                    {aiResult && aiType === 'suggest_steps' && <StructuredAIResult raw={aiResult} />}
                    {aiResult && aiType !== 'suggest_steps' && (
                      <div className="bg-muted/40 rounded-lg p-3 text-xs text-foreground leading-relaxed whitespace-pre-wrap max-h-72 overflow-y-auto border border-border/60">
                        <p className="font-semibold text-muted-foreground capitalize mb-1.5">{aiType?.replace(/_/g, ' ')}</p>
                        {aiResult}
                      </div>
                    )}
                  </div>
                )}

                {/* ── TAB 2: Dept Processing (Step 3) ─────────────────────────────── */}
                {effectiveTab === 'dept_processing' && (
                  <DeptProcessingPanel
                    loading={draftLoading}
                    loaded={draftLoaded}
                    templateId={draftTemplateId}
                    allTemplates={draftAllTemplates}
                    intro={draftIntro}
                    sections={draftSections}
                    closing={draftClosing}
                    employeeName={draftEmployeeName || item.employee_name || ''}
                    fieldValues={draftFields}
                    onFieldChange={(id, val) => {
                      setDraftFields(prev => ({ ...prev, [id]: val }));
                      // Clear validation highlight as soon as user types a value
                      if (val.trim() && missingFieldIds.includes(id)) {
                        setMissingFieldIds(prev => prev.filter(f => f !== id));
                      }
                    }}
                    onTemplateChange={(id) => { setDraftLoaded(false); fetchDraft(id); }}
                    onRegenerate={() => { setDraftLoaded(false); fetchDraft(draftTemplateId || undefined); }}
                    completing={completing}
                    onComplete={handleCompleteDeptProcessing}
                    completeError={actionError}
                    onDismissError={() => { setActionError(null); setMissingFieldIds([]); }}
                    missingFieldIds={missingFieldIds}
                  />
                )}

                {/* ── TAB 3: Customer Resolution (Step 4) ─────────────────────────── */}
                {effectiveTab === 'customer_resolution' && (
                  <>
                    {/* Escalation gate: show blocker if investigation not complete */}
                    {item.escalated_from_ticket_id && !item.investigation_complete && (
                      <div className="p-4 space-y-4">
                        <div className="rounded-xl border-2 border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-950/20 p-4 flex items-start gap-3">
                          <div className="w-8 h-8 rounded-full bg-red-100 dark:bg-red-900/40 flex items-center justify-center shrink-0">
                            <ClipboardList className="h-4 w-4 text-red-600 dark:text-red-400" />
                          </div>
                          <div>
                            <p className="text-sm font-bold text-red-800 dark:text-red-200">
                              Investigation Required Before Resolution
                            </p>
                            <p className="text-xs text-red-700/70 dark:text-red-300/70 mt-1 leading-relaxed">
                              This ticket was escalated and requires a Payroll Investigation before the resolution email can be generated.
                              Complete the investigation to unlock this step.
                            </p>
                          </div>
                        </div>
                        <Link
                          href={`/department/${params.id}/investigation`}
                          className="w-full flex items-center justify-center gap-2 text-xs font-bold bg-red-600 hover:bg-red-700 text-white rounded-lg px-4 py-3 transition-colors"
                        >
                          <ClipboardList className="h-3.5 w-3.5" />
                          Open Payroll Investigation →
                        </Link>
                      </div>
                    )}
                    {/* Show normal resolution panel only when not escalated, or investigation is complete */}
                    {(!item.escalated_from_ticket_id || item.investigation_complete) && (
                      <CustomerResolutionPanel
                        isResolved={item.status === 'completed'}
                        resolvedAt={item.completed_at ?? null}
                        resolvedBy={item.assigned_to || actor}
                        startedAt={item.started_at}
                        deliveryMode={'REAL'}
                        notificationStatus={notificationStatus ?? ticket?.notification_status}
                        notificationError={notificationError}
                        employeeEmail={item.employee_email ?? draftEmployeeEmail}
                        internalFields={item.internal_resolution_fields}
                        engineerNotes={engineerNotes}
                        onEngineerNotesChange={setEngineerNotes}
                        customerEmailBody={customerEmailBody}
                        onCustomerEmailBodyChange={setCustomerEmailBody}
                        customerEmailSubject={customerEmailSubject}
                        onCustomerEmailSubjectChange={setCustomerEmailSubject}
                        customerEmailGenerating={customerEmailGenerating}
                        customerEmailError={customerEmailError}
                        onGenerateCustomerEmail={fetchCustomerEmail}
                        sending={draftSending}
                        sendError={draftSendError}
                        onRequestConfirm={handleRequestConfirm}
                        onDismissError={() => setDraftSendError(null)}
                        onRetry={handleDraftSend}
                        onRetryNotification={handleRetryNotification}
                        retrying={retrying}
                        onViewQueue={() => router.push('/department?tab=completed')}
                      />
                    )}
                  </>
                )}


              </section>

            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Helper components ─────────────────────────────────────────────────────────

function ActionBtn({ icon: Icon, label, color, onClick, loading }: {
  icon: React.ElementType;
  label: string;
  color: string;
  onClick: () => void;
  loading?: boolean;
}) {
  const colors: Record<string, string> = {
    blue:    'border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-950/40',
    violet:  'border-violet-300 dark:border-violet-700 text-violet-700 dark:text-violet-300 hover:bg-violet-50 dark:hover:bg-violet-950/40',
    emerald: 'border-emerald-300 dark:border-emerald-700 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-950/40',
    amber:   'border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950/40',
    red:     'border-red-300 dark:border-red-700 text-red-700 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-950/40',
    sky:     'border-sky-300 dark:border-sky-700 text-sky-700 dark:text-sky-300 hover:bg-sky-50 dark:hover:bg-sky-950/40',
    gray:    'border-border text-muted-foreground hover:bg-muted hover:text-foreground',
  };
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className={cn(
        'flex items-center gap-1.5 text-xs font-semibold border rounded-lg px-3 py-1.5 transition-all disabled:opacity-50',
        colors[color] ?? colors.gray
      )}
    >
      {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Icon className="h-3 w-3" />}
      {label}
    </button>
  );
}

// ── Structured AI Result — parses Gemini's 6-section markdown output ──────────

const SECTION_CONFIG: Record<string, { label: string; accent: string; headerBg: string; textColor: string }> = {
  'Issue Summary':             { label: '🔵 Issue Summary',             accent: 'border-blue-200 dark:border-blue-800',   headerBg: 'bg-blue-50 dark:bg-blue-950/30',   textColor: 'text-blue-800 dark:text-blue-200'   },
  'Current Status':            { label: '🟣 Current Status',            accent: 'border-indigo-200 dark:border-indigo-800', headerBg: 'bg-indigo-50 dark:bg-indigo-950/30', textColor: 'text-indigo-800 dark:text-indigo-200' },
  'Recommended Resolution Steps': { label: '✅ Resolution Steps',       accent: 'border-emerald-200 dark:border-emerald-800', headerBg: 'bg-emerald-50 dark:bg-emerald-950/30', textColor: 'text-emerald-800 dark:text-emerald-200' },
  'Required Human Verification':  { label: '🟡 Human Verification',    accent: 'border-amber-200 dark:border-amber-800',   headerBg: 'bg-amber-50 dark:bg-amber-950/30',   textColor: 'text-amber-800 dark:text-amber-200'   },
  'Risks':                     { label: '🔴 Risks',                     accent: 'border-red-200 dark:border-red-800',       headerBg: 'bg-red-50 dark:bg-red-950/30',       textColor: 'text-red-800 dark:text-red-200'       },
  'Next Action':               { label: '🟢 Next Action',               accent: 'border-green-200 dark:border-green-800',   headerBg: 'bg-green-50 dark:bg-green-950/30',   textColor: 'text-green-800 dark:text-green-200'   },
};

function parseSections(raw: string): Array<{ key: string; content: string }> {
  const sectionKeys = Object.keys(SECTION_CONFIG);
  const result: Array<{ key: string; content: string }> = [];

  // Split on markdown ## headers
  const parts = raw.split(/^##\s+/m);
  for (const part of parts) {
    const firstLine = part.split('\n')[0].trim();
    const matchedKey = sectionKeys.find(k => firstLine.toLowerCase().startsWith(k.toLowerCase()));
    if (matchedKey) {
      const content = part.slice(firstLine.length).trim();
      result.push({ key: matchedKey, content });
    }
  }
  return result;
}

function PlaceholderLine({ text }: { text: string }) {
  // Highlight [placeholder] patterns in amber
  const parts = text.split(/(\[[^\]]+\])/g);
  return (
    <span>
      {parts.map((p, i) =>
        p.startsWith('[') && p.endsWith(']')
          ? <span key={i} className="inline-block bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-200 rounded px-1 font-mono text-[10px] font-semibold border border-amber-300 dark:border-amber-700 mx-0.5">{p}</span>
          : <span key={i}>{p}</span>
      )}
    </span>
  );
}

function SectionContent({ content }: { content: string }) {
  const lines = content.split('\n').filter(l => l.trim());
  return (
    <div className="space-y-1">
      {lines.map((line, i) => {
        const trimmed = line.trim();
        const isNumbered = /^\d+\./.test(trimmed);
        const isBullet   = /^[-•*]/.test(trimmed);
        const text = trimmed.replace(/^\d+\.\s*/, '').replace(/^[-•*]\s*/, '');
        return (
          <div key={i} className={cn('text-xs text-foreground leading-relaxed flex gap-2', (isNumbered || isBullet) ? 'items-start' : '')}>
            {isNumbered && (
              <span className="shrink-0 font-bold text-[10px] text-muted-foreground mt-0.5">
                {trimmed.match(/^(\d+)\./)![1]}.
              </span>
            )}
            {isBullet && <span className="shrink-0 text-muted-foreground mt-1.5">•</span>}
            <PlaceholderLine text={text || trimmed} />
          </div>
        );
      })}
    </div>
  );
}

function StructuredAIResult({ raw }: { raw: string }) {
  const sections = parseSections(raw);

  // Fallback: if parsing failed (no ## headers), show plain text
  if (sections.length === 0) {
    return (
      <div className="bg-muted/40 rounded-lg p-3 text-xs text-foreground leading-relaxed whitespace-pre-wrap max-h-72 overflow-y-auto border border-border/60">
        {raw}
      </div>
    );
  }

  return (
    <div className="space-y-2 max-h-[520px] overflow-y-auto pr-1">
      {sections.map(({ key, content }) => {
        const cfg = SECTION_CONFIG[key];
        return (
          <div key={key} className={cn('rounded-lg border overflow-hidden', cfg.accent)}>
            <div className={cn('px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider', cfg.headerBg, cfg.textColor)}>
              {cfg.label}
            </div>
            <div className="px-3 py-2">
              <SectionContent content={content} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
