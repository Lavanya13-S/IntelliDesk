/**
 * app/department/[id]/investigation/page.tsx
 *
 * Payroll Investigation page — where the assigned officer conducts the
 * structured investigation for an escalated payroll/HR ticket.
 *
 * Features:
 *   - Employee Details panel (read-only)
 *   - Issue Summary from original email
 *   - Payroll Verification Checklist (13 standard items)
 *   - Investigation Notes textarea
 *   - Corrective Action textarea
 *   - Internal Comments
 *   - Supporting Evidence (URL-based for now)
 *   - Save Progress (auto-saves to dept_investigations via API)
 *   - Mark Investigation Complete (unlocks resolution email)
 */

'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { Sidebar } from '@/components/sidebar';
import {
  ArrowLeft, CheckCircle2, Circle, Loader2, Save, ShieldAlert,
  User, Mail, Building2, Users, ClipboardList, FileText,
  MessageSquare, Link as LinkIcon, CheckSquare, Square,
  AlertTriangle, ExternalLink, Clock, Tag,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ── Checklist items for Payroll Investigation ─────────────────────────────────

interface ChecklistItem {
  id: string;
  label: string;
  category: 'payroll' | 'hr' | 'finance' | 'general';
  checked: boolean;
}

const DEFAULT_CHECKLIST: ChecklistItem[] = [
  { id: 'emp_record_verified',    label: 'Employee record verified in HRMS',                   category: 'hr',      checked: false },
  { id: 'pay_period_check',       label: 'Pay period dates confirmed and correct',              category: 'payroll', checked: false },
  { id: 'salary_structure',       label: 'Salary structure and components reviewed',            category: 'payroll', checked: false },
  { id: 'deductions_verified',    label: 'All deductions verified (tax, PF, ESIC, etc.)',      category: 'payroll', checked: false },
  { id: 'overtime_check',         label: 'Overtime/bonus calculations verified',               category: 'payroll', checked: false },
  { id: 'bank_details',           label: 'Bank account and IFSC code confirmed',               category: 'payroll', checked: false },
  { id: 'leave_adjusted',         label: 'Leave without pay / LOP adjustments verified',      category: 'hr',      checked: false },
  { id: 'tax_computation',        label: 'TDS computation reviewed',                           category: 'finance', checked: false },
  { id: 'prev_payslip_compared',  label: 'Previous payslip compared for discrepancies',       category: 'payroll', checked: false },
  { id: 'manager_informed',       label: 'Reporting manager notified of investigation',       category: 'hr',      checked: false },
  { id: 'finance_team_check',     label: 'Finance team confirmation obtained',                 category: 'finance', checked: false },
  { id: 'correction_processed',   label: 'Correction / arrears processed if applicable',      category: 'payroll', checked: false },
  { id: 'employee_acknowledgment', label: 'Employee informed of findings/outcome',            category: 'general', checked: false },
];

const CATEGORY_COLORS: Record<string, string> = {
  payroll: 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/30',
  hr:      'text-violet-600 dark:text-violet-400 bg-violet-50 dark:bg-violet-950/30',
  finance: 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30',
  general: 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/30',
};

// ── Investigation API helpers ─────────────────────────────────────────────────

async function loadInvestigation(workItemId: string) {
  const { data } = await supabase
    .from('dept_investigations')
    .select('*')
    .eq('work_item_id', workItemId)
    .maybeSingle();
  return data;
}

async function saveInvestigation(workItemId: string, payload: {
  checklist: ChecklistItem[];
  investigation_notes: string;
  corrective_action: string;
  internal_comments: string;
  evidence_urls: string[];
  status: 'in_progress' | 'complete';
  completed_by?: string;
}) {
  const existing = await loadInvestigation(workItemId);
  const row = {
    work_item_id:       workItemId,
    checklist:          JSON.stringify(payload.checklist),
    investigation_notes: payload.investigation_notes,
    corrective_action:  payload.corrective_action,
    internal_comments:  payload.internal_comments,
    evidence_urls:      payload.evidence_urls,
    status:             payload.status,
    completed_at:       payload.status === 'complete' ? new Date().toISOString() : null,
    completed_by:       payload.completed_by ?? null,
    updated_at:         new Date().toISOString(),
  };

  if (existing) {
    const { error } = await supabase
      .from('dept_investigations')
      .update(row)
      .eq('work_item_id', workItemId);
    return !error;
  } else {
    const { error } = await supabase
      .from('dept_investigations')
      .insert(row);
    return !error;
  }
}

async function markWorkItemInvestigationComplete(workItemId: string, officer: string) {
  const { error } = await supabase
    .from('dept_work_items')
    .update({
      investigation_complete:      true,
      investigation_completed_at:  new Date().toISOString(),
      investigation_completed_by:  officer,
      // Advance to in_progress so resolution can proceed
      status: 'in_progress',
    })
    .eq('id', workItemId);
  return !error;
}

// ── Toast component ───────────────────────────────────────────────────────────
function Toast({ message, type }: { message: string; type: 'success' | 'error' }) {
  return (
    <div className={cn(
      'fixed bottom-6 right-6 z-50 flex items-center gap-2.5 px-4 py-3 rounded-xl shadow-2xl text-sm font-semibold max-w-sm',
      type === 'success'
        ? 'bg-emerald-600 text-white'
        : 'bg-red-600 text-white'
    )}>
      {type === 'success' ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <AlertTriangle className="h-4 w-4 shrink-0" />}
      {message}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function InvestigationPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const workItemId = params.id;

  // Work item and context
  const [item, setItem] = useState<any | null>(null);
  const [email, setEmail] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);

  // Investigation state
  const [checklist, setChecklist]               = useState<ChecklistItem[]>(DEFAULT_CHECKLIST);
  const [investigationNotes, setInvestigationNotes] = useState('');
  const [correctiveAction, setCorrectiveAction] = useState('');
  const [internalComments, setInternalComments] = useState('');
  const [evidenceUrls, setEvidenceUrls]         = useState<string[]>([]);
  const [newEvidenceUrl, setNewEvidenceUrl]     = useState('');
  const [officer, setOfficer]                   = useState('Rahul Sharma');
  const [invComplete, setInvComplete]           = useState(false);

  // Save state
  const [saving, setSaving]     = useState(false);
  const [completing, setCompleting] = useState(false);
  const [toast, setToast]       = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  const showToast = useCallback((msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  }, []);

  // Load work item + investigation data
  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const res = await fetch(`/api/dept/${workItemId}`);
        if (!res.ok) return;
        const d = await res.json();
        setItem(d.item);
        setEmail(d.email);
        setInvComplete(d.item?.investigation_complete ?? false);

        // Load existing investigation data
        const inv = await loadInvestigation(workItemId);
        if (inv) {
          try {
            const parsedChecklist = typeof inv.checklist === 'string'
              ? JSON.parse(inv.checklist)
              : inv.checklist;
            setChecklist(parsedChecklist ?? DEFAULT_CHECKLIST);
          } catch { setChecklist(DEFAULT_CHECKLIST); }
          setInvestigationNotes(inv.investigation_notes ?? '');
          setCorrectiveAction(inv.corrective_action ?? '');
          setInternalComments(inv.internal_comments ?? '');
          setEvidenceUrls(inv.evidence_urls ?? []);
          if (inv.status === 'complete') setInvComplete(true);
        }
      } catch { /* non-fatal */ }
      finally { setLoading(false); }
    }
    load();
  }, [workItemId]);

  // Toggle checklist item
  function toggleItem(id: string) {
    setChecklist(prev => prev.map(item =>
      item.id === id ? { ...item, checked: !item.checked } : item
    ));
  }

  // Save progress
  async function handleSave() {
    setSaving(true);
    const ok = await saveInvestigation(workItemId, {
      checklist,
      investigation_notes: investigationNotes,
      corrective_action:   correctiveAction,
      internal_comments:   internalComments,
      evidence_urls:       evidenceUrls,
      status:              'in_progress',
    });
    setSaving(false);
    showToast(ok ? '✓ Progress saved' : 'Failed to save — try again', ok ? 'success' : 'error');
  }

  // Mark investigation complete
  async function handleComplete() {
    const checkedCount = checklist.filter(i => i.checked).length;
    if (checkedCount < 5) {
      showToast('Please complete at least 5 checklist items before marking as complete', 'error');
      return;
    }
    setCompleting(true);
    // Save investigation as complete
    const saveOk = await saveInvestigation(workItemId, {
      checklist,
      investigation_notes: investigationNotes,
      corrective_action:   correctiveAction,
      internal_comments:   internalComments,
      evidence_urls:       evidenceUrls,
      status:              'complete',
      completed_by:        officer,
    });
    // Mark work item investigation_complete = true
    const markOk = saveOk && await markWorkItemInvestigationComplete(workItemId, officer);
    setCompleting(false);
    if (markOk) {
      setInvComplete(true);
      showToast('✓ Investigation marked complete — resolution email is now enabled');
      setTimeout(() => router.push(`/department/${workItemId}`), 2500);
    } else {
      showToast('Failed to mark complete — check connection', 'error');
    }
  }

  // Add evidence URL
  function addEvidenceUrl() {
    const url = newEvidenceUrl.trim();
    if (!url) return;
    setEvidenceUrls(prev => [...prev, url]);
    setNewEvidenceUrl('');
  }

  if (loading) {
    return (
      <div className="flex h-screen bg-background">
        <Sidebar />
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  if (!item) {
    return (
      <div className="flex h-screen bg-background">
        <Sidebar />
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-muted-foreground">
          <AlertTriangle className="h-10 w-10 opacity-30" />
          <p className="font-medium">Work item not found</p>
          <Link href="/department" className="text-sm text-primary hover:underline">← Back to Queue</Link>
        </div>
      </div>
    );
  }

  const checkedCount = checklist.filter(c => c.checked).length;
  const progress = Math.round((checkedCount / checklist.length) * 100);

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      <Sidebar />

      {/* Toast */}
      {toast && <Toast message={toast.msg} type={toast.type} />}

      <div className="flex-1 flex flex-col overflow-hidden">

        {/* Header */}
        <div className="border-b border-border bg-card px-6 py-3.5 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <Link href={`/department/${workItemId}`} className="text-muted-foreground hover:text-foreground transition-colors">
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs text-muted-foreground">#{workItemId.slice(0, 8).toUpperCase()}</span>
                <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300 border border-red-300">
                  INVESTIGATION
                </span>
                {invComplete && (
                  <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 border border-emerald-300 flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3" /> COMPLETE
                  </span>
                )}
              </div>
              <p className="text-sm font-semibold text-foreground mt-0.5">
                {item.employee_name ?? 'Unknown Employee'} — Payroll Investigation
              </p>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2">
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-1.5 text-xs font-semibold border border-border hover:bg-muted rounded-lg px-3 py-2 transition-colors disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              Save Progress
            </button>
            {!invComplete && (
              <button
                onClick={handleComplete}
                disabled={completing || checkedCount < 5}
                className="flex items-center gap-1.5 text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg px-4 py-2 transition-colors disabled:opacity-50"
              >
                {completing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                Mark Investigation Complete
              </button>
            )}
            {invComplete && (
              <button
                onClick={() => router.push(`/department/${workItemId}`)}
                className="flex items-center gap-1.5 text-xs font-bold bg-primary text-primary-foreground rounded-lg px-4 py-2 transition-colors"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Back to Work Item
              </button>
            )}
          </div>
        </div>

        {/* Body — two-column layout */}
        <div className="flex-1 overflow-y-auto">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-0 divide-x divide-border min-h-full">

            {/* ── LEFT: Employee Details + Issue Summary + Checklist ─────── */}
            <div className="overflow-y-auto p-5 space-y-4">

              {/* Employee Details */}
              <section className="rounded-xl border border-border bg-card p-4 space-y-3">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">
                  <User className="h-3.5 w-3.5" /> Employee Details
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                  {[
                    ['Name',       item.employee_name   ?? '—'],
                    ['Email',      item.employee_email  ?? '—'],
                    ['Department', item.department      ?? '—'],
                    ['Team',       item.team_name       ?? '—'],
                    ['Priority',   (item.priority ?? 'high').toUpperCase()],
                    ['Status',     (item.status ?? '—').replace(/_/g, ' ')],
                  ].map(([k, v]) => (
                    <div key={k}>
                      <p className="text-muted-foreground">{k}</p>
                      <p className="font-semibold text-foreground truncate">{v}</p>
                    </div>
                  ))}
                </div>
              </section>

              {/* Issue Summary */}
              {email && (
                <section className="rounded-xl border border-border bg-card p-4 space-y-2">
                  <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">
                    <Mail className="h-3.5 w-3.5" /> Issue Summary
                  </div>
                  <p className="text-xs font-semibold text-foreground">{email.subject}</p>
                  <p className="text-xs text-muted-foreground">From: {email.sender}</p>
                  <div className="text-xs text-foreground leading-relaxed bg-muted/30 rounded-lg p-3 max-h-36 overflow-y-auto whitespace-pre-wrap">
                    {email.body}
                  </div>
                  {item.intent && (
                    <div className="flex items-center gap-1.5 text-xs">
                      <Tag className="h-3 w-3 text-muted-foreground" />
                      <span className="text-muted-foreground">Intent:</span>
                      <span className="font-semibold text-foreground">{item.intent}</span>
                    </div>
                  )}
                </section>
              )}

              {/* Investigation Checklist */}
              <section className="rounded-xl border border-border bg-card p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">
                    <ClipboardList className="h-3.5 w-3.5" /> Payroll Verification Checklist
                  </div>
                  <span className="text-xs font-bold text-muted-foreground">
                    {checkedCount}/{checklist.length} complete
                  </span>
                </div>

                {/* Progress bar */}
                <div className="w-full h-1.5 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full bg-emerald-500 transition-all duration-500"
                    style={{ width: `${progress}%` }}
                  />
                </div>

                <div className="space-y-2">
                  {['payroll', 'hr', 'finance', 'general'].map(cat => {
                    const catItems = checklist.filter(c => c.category === cat);
                    if (!catItems.length) return null;
                    return (
                      <div key={cat}>
                        <p className={cn(
                          'text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded mb-1.5 inline-block',
                          CATEGORY_COLORS[cat]
                        )}>
                          {cat}
                        </p>
                        <div className="space-y-1">
                          {catItems.map(cItem => (
                            <button
                              key={cItem.id}
                              onClick={() => toggleItem(cItem.id)}
                              disabled={invComplete}
                              className="w-full flex items-start gap-2.5 text-left p-2 rounded-lg hover:bg-muted/40 transition-colors disabled:cursor-not-allowed"
                            >
                              {cItem.checked
                                ? <CheckSquare className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" />
                                : <Square className="h-4 w-4 text-muted-foreground/50 shrink-0 mt-0.5" />
                              }
                              <span className={cn(
                                'text-xs leading-relaxed',
                                cItem.checked ? 'text-foreground line-through text-muted-foreground' : 'text-foreground'
                              )}>
                                {cItem.label}
                              </span>
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            </div>

            {/* ── RIGHT: Notes, Action, Comments, Evidence ───────────────── */}
            <div className="overflow-y-auto p-5 space-y-4">

              {/* Investigation Complete Banner */}
              {invComplete && (
                <section className="rounded-xl border-2 border-emerald-400 dark:border-emerald-600 bg-emerald-50 dark:bg-emerald-950/20 p-4 flex items-start gap-3">
                  <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-bold text-emerald-800 dark:text-emerald-200">Investigation Complete</p>
                    <p className="text-xs text-emerald-700/70 dark:text-emerald-300/70 mt-0.5">
                      "Generate Resolution Email" is now enabled in the work item. Return to the work item to send the resolution.
                    </p>
                  </div>
                </section>
              )}

              {/* Officer field */}
              <section className="rounded-xl border border-border bg-card p-4 space-y-2">
                <label className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">
                  <User className="h-3.5 w-3.5" /> Investigating Officer
                </label>
                <input
                  value={officer}
                  onChange={e => setOfficer(e.target.value)}
                  disabled={invComplete}
                  className="w-full text-xs border border-border rounded-lg px-3 py-2 bg-background focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-60"
                  placeholder="Your name"
                />
              </section>

              {/* Investigation Notes */}
              <section className="rounded-xl border border-border bg-card p-4 space-y-2">
                <label className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">
                  <FileText className="h-3.5 w-3.5" /> Investigation Notes
                </label>
                <textarea
                  value={investigationNotes}
                  onChange={e => setInvestigationNotes(e.target.value)}
                  disabled={invComplete}
                  rows={5}
                  placeholder="Document your findings, what you checked, any discrepancies found..."
                  className="w-full text-xs border border-border rounded-lg px-3 py-2.5 bg-background focus:outline-none focus:ring-1 focus:ring-primary resize-none disabled:opacity-60"
                />
              </section>

              {/* Corrective Action */}
              <section className="rounded-xl border border-border bg-card p-4 space-y-2">
                <label className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">
                  <ShieldAlert className="h-3.5 w-3.5" /> Corrective Action Taken
                </label>
                <textarea
                  value={correctiveAction}
                  onChange={e => setCorrectiveAction(e.target.value)}
                  disabled={invComplete}
                  rows={4}
                  placeholder="Describe what was corrected, which system was updated, approval obtained from whom..."
                  className="w-full text-xs border border-border rounded-lg px-3 py-2.5 bg-background focus:outline-none focus:ring-1 focus:ring-primary resize-none disabled:opacity-60"
                />
              </section>

              {/* Internal Comments */}
              <section className="rounded-xl border border-border bg-card p-4 space-y-2">
                <label className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">
                  <MessageSquare className="h-3.5 w-3.5" /> Internal Comments
                </label>
                <p className="text-[10px] text-muted-foreground">Visible to team only — not sent to employee.</p>
                <textarea
                  value={internalComments}
                  onChange={e => setInternalComments(e.target.value)}
                  disabled={invComplete}
                  rows={3}
                  placeholder="Internal notes, flags, team comments..."
                  className="w-full text-xs border border-border rounded-lg px-3 py-2.5 bg-background focus:outline-none focus:ring-1 focus:ring-primary resize-none disabled:opacity-60"
                />
              </section>

              {/* Supporting Evidence */}
              <section className="rounded-xl border border-border bg-card p-4 space-y-3">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">
                  <LinkIcon className="h-3.5 w-3.5" /> Supporting Evidence
                </div>
                {!invComplete && (
                  <div className="flex gap-2">
                    <input
                      value={newEvidenceUrl}
                      onChange={e => setNewEvidenceUrl(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && addEvidenceUrl()}
                      placeholder="Paste evidence URL or document link..."
                      className="flex-1 text-xs border border-border rounded-lg px-3 py-2 bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                    <button
                      onClick={addEvidenceUrl}
                      disabled={!newEvidenceUrl.trim()}
                      className="text-xs font-semibold bg-primary text-primary-foreground rounded-lg px-3 py-2 disabled:opacity-50"
                    >
                      Add
                    </button>
                  </div>
                )}
                {evidenceUrls.length > 0 ? (
                  <div className="space-y-1.5">
                    {evidenceUrls.map((url, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs bg-muted/40 rounded-lg px-3 py-2">
                        <ExternalLink className="h-3 w-3 text-primary shrink-0" />
                        <a href={url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline truncate flex-1">
                          {url}
                        </a>
                        {!invComplete && (
                          <button
                            onClick={() => setEvidenceUrls(prev => prev.filter((_, j) => j !== i))}
                            className="text-muted-foreground hover:text-red-500 transition-colors ml-1"
                          >
                            ×
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground italic">No evidence attached yet.</p>
                )}
              </section>

              {/* Bottom CTA */}
              {!invComplete && (
                <section className="rounded-xl border-2 border-dashed border-emerald-300 dark:border-emerald-700 p-4 flex flex-col items-center gap-3 text-center">
                  <div className="w-10 h-10 rounded-full bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center">
                    <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-foreground">Ready to mark complete?</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Complete at least 5 checklist items ({checkedCount}/5 done) and save your notes first.
                    </p>
                  </div>
                  <button
                    onClick={handleComplete}
                    disabled={completing || checkedCount < 5}
                    className="flex items-center gap-1.5 text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg px-5 py-2.5 transition-colors disabled:opacity-50"
                  >
                    {completing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                    {completing ? 'Marking complete…' : 'Mark Investigation Complete'}
                  </button>
                  <p className="text-[10px] text-muted-foreground">
                    This unlocks the "Generate Resolution Email" button in the work item.
                  </p>
                </section>
              )}
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}
