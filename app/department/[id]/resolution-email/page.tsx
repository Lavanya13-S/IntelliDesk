'use client';

import { useEffect, useState, useCallback } from 'react';
import { Sidebar } from '@/components/sidebar';
import {
  ArrowLeft, FileText, Send, Loader2, AlertTriangle,
  CheckCircle2, Mail, Edit3, RefreshCw, X, Eye,
} from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/utils';

// ── Placeholder highlighter ───────────────────────────────────────────────────

function hasPlaceholders(text: string): boolean {
  return /\[[^\]]+\]/.test(text);
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function ResolutionEmailPage({ params }: { params: { id: string } }) {
  const [loading,     setLoading]     = useState(true);
  const [generating,  setGenerating]  = useState(false);
  const [sending,     setSending]     = useState(false);
  const [sent,        setSent]        = useState(false);
  const [error,       setError]       = useState<string | null>(null);
  const [sendError,   setSendError]   = useState<string | null>(null);

  const [draft,       setDraft]       = useState('');
  const [toEmail,     setToEmail]     = useState('');
  const [subject,     setSubject]     = useState('');
  const [employeeName, setEmployeeName] = useState('');
  const [intent,      setIntent]      = useState('');
  const [editMode,    setEditMode]    = useState(true);

  // ── Fetch draft from API ────────────────────────────────────────────────────
  const generateDraft = useCallback(async () => {
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch(`/api/dept/${params.id}/resolution-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Failed to generate draft');
        return;
      }
      setDraft(data.draft ?? '');
      setToEmail(data.to ?? '');
      setSubject(data.subject ?? 'Your Request — Resolved');
      setEmployeeName(data.employeeName ?? '');
      setIntent(data.intent ?? '');
    } catch (e: any) {
      setError(e.message ?? 'Unexpected error');
    } finally {
      setGenerating(false);
      setLoading(false);
    }
  }, [params.id]);

  useEffect(() => { generateDraft(); }, [generateDraft]);

  // ── Send email ──────────────────────────────────────────────────────────────
  async function handleSend() {
    if (!toEmail || !draft.trim()) return;

    // Warn if placeholders remain
    if (hasPlaceholders(draft) || hasPlaceholders(subject)) {
      setSendError('Please fill in all [placeholder] fields before sending.');
      return;
    }

    setSending(true);
    setSendError(null);
    try {
      const res = await fetch('/api/send-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: toEmail, subject, body: draft }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSendError(data.error ?? 'Failed to send email');
        return;
      }
      setSent(true);
    } catch (e: any) {
      setSendError(e.message ?? 'Failed to send email');
    } finally {
      setSending(false);
    }
  }

  // ── Render states ──────────────────────────────────────────────────────────

  if (loading || generating) {
    return (
      <div className="flex h-screen bg-background">
        <Sidebar />
        <div className="flex-1 flex flex-col items-center justify-center gap-3">
          <Loader2 className="h-6 w-6 animate-spin text-violet-500" />
          <p className="text-sm text-muted-foreground">Generating resolution email draft…</p>
          <p className="text-xs text-muted-foreground/60">AI is analysing the ticket and work log</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-screen bg-background">
        <Sidebar />
        <div className="flex-1 flex flex-col items-center justify-center gap-4">
          <div className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded-xl p-6 max-w-md text-center space-y-3">
            <AlertTriangle className="h-8 w-8 text-red-500 mx-auto" />
            <p className="text-sm font-semibold text-red-700 dark:text-red-300">{error}</p>
            {error.includes('completed') && (
              <p className="text-xs text-red-600/70 dark:text-red-400/70">
                Resolution email is only available once the ticket reaches <strong>Completed</strong> status.
              </p>
            )}
            <Link
              href={`/department/${params.id}`}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-red-700 dark:text-red-300 hover:underline"
            >
              <ArrowLeft className="h-3.5 w-3.5" /> Back to work item
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (sent) {
    return (
      <div className="flex h-screen bg-background">
        <Sidebar />
        <div className="flex-1 flex flex-col items-center justify-center gap-4">
          <div className="bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800 rounded-xl p-8 max-w-md text-center space-y-3">
            <CheckCircle2 className="h-10 w-10 text-emerald-500 mx-auto" />
            <p className="text-sm font-bold text-emerald-700 dark:text-emerald-300">Resolution email sent!</p>
            <p className="text-xs text-emerald-600/70 dark:text-emerald-400/70">
              Sent to <strong>{toEmail}</strong>
            </p>
            <Link
              href={`/department/${params.id}`}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300 hover:underline"
            >
              <ArrowLeft className="h-3.5 w-3.5" /> Back to work item
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const stillHasPlaceholders = hasPlaceholders(draft) || hasPlaceholders(subject);

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      <Sidebar />

      <div className="flex-1 flex flex-col overflow-hidden">

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="border-b border-border bg-card px-6 py-3.5 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <Link href={`/department/${params.id}`} className="text-muted-foreground hover:text-foreground transition-colors">
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <div>
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                <p className="text-sm font-bold text-foreground">Resolution Email Draft</p>
              </div>
              <p className="text-xs text-muted-foreground">
                {intent} — {employeeName || toEmail}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Regenerate */}
            <button
              onClick={() => { setLoading(true); generateDraft(); }}
              disabled={generating}
              className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground border border-border hover:bg-muted rounded-lg px-3 py-1.5 transition-colors disabled:opacity-50"
            >
              <RefreshCw className={cn('h-3.5 w-3.5', generating && 'animate-spin')} />
              Regenerate
            </button>

            {/* Toggle edit/preview */}
            <button
              onClick={() => setEditMode(v => !v)}
              className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground border border-border hover:bg-muted rounded-lg px-3 py-1.5 transition-colors"
            >
              {editMode ? <Eye className="h-3.5 w-3.5" /> : <Edit3 className="h-3.5 w-3.5" />}
              {editMode ? 'Preview' : 'Edit'}
            </button>

            {/* Send button */}
            <button
              onClick={handleSend}
              disabled={sending || !toEmail || !draft.trim() || stillHasPlaceholders}
              className="flex items-center gap-1.5 text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg px-4 py-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              title={stillHasPlaceholders ? 'Fill in all placeholder fields before sending' : undefined}
            >
              {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              Send Email
            </button>
          </div>
        </div>

        {/* ── Body ───────────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="max-w-3xl mx-auto space-y-4">

            {/* Placeholder warning */}
            {stillHasPlaceholders && (
              <div className="flex items-start gap-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-xl px-4 py-3">
                <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-bold text-amber-700 dark:text-amber-300">
                    Placeholder fields detected — fill these before sending
                  </p>
                  <p className="text-xs text-amber-600/80 dark:text-amber-400/80 mt-0.5">
                    All <span className="font-mono bg-amber-100 dark:bg-amber-900/40 rounded px-1">[highlighted fields]</span> must be completed by the engineer. Never guess or invent these values.
                  </p>
                </div>
              </div>
            )}

            {/* Send error */}
            {sendError && (
              <div className="flex items-center gap-2 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded-xl px-4 py-3">
                <AlertTriangle className="h-4 w-4 text-red-500 shrink-0" />
                <p className="text-xs text-red-700 dark:text-red-300">{sendError}</p>
                <button onClick={() => setSendError(null)} className="ml-auto text-red-400 hover:text-red-600">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )}

            {/* Email metadata */}
            <div className="rounded-xl border border-border bg-card overflow-hidden">
              <div className="px-4 py-3 bg-muted/30 border-b border-border flex items-center gap-2">
                <Mail className="h-4 w-4 text-muted-foreground" />
                <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Email Details</span>
              </div>
              <div className="p-4 space-y-3">
                {/* To */}
                <div className="flex items-center gap-3">
                  <span className="text-xs font-semibold text-muted-foreground w-16 shrink-0">To:</span>
                  <input
                    value={toEmail}
                    onChange={e => setToEmail(e.target.value)}
                    placeholder="recipient@company.com"
                    className="flex-1 text-xs border border-border rounded-lg px-2.5 py-1.5 bg-background focus:outline-none focus:ring-1 focus:ring-primary font-mono"
                  />
                </div>
                {/* Subject */}
                <div className="flex items-center gap-3">
                  <span className="text-xs font-semibold text-muted-foreground w-16 shrink-0">Subject:</span>
                  <input
                    value={subject}
                    onChange={e => setSubject(e.target.value)}
                    placeholder="Email subject"
                    className="flex-1 text-xs border border-border rounded-lg px-2.5 py-1.5 bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
              </div>
            </div>

            {/* Email body */}
            <div className="rounded-xl border border-border bg-card overflow-hidden">
              <div className="px-4 py-3 bg-muted/30 border-b border-border flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Edit3 className="h-4 w-4 text-muted-foreground" />
                  <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                    {editMode ? 'Email Body — Edit Mode' : 'Preview'}
                  </span>
                </div>
                <span className="text-[10px] text-muted-foreground/60">
                  Review carefully before sending
                </span>
              </div>

              {editMode ? (
                /* Edit mode — raw textarea with placeholder highlighting overlay */
                <div className="relative">
                  <textarea
                    value={draft}
                    onChange={e => setDraft(e.target.value)}
                    rows={24}
                    spellCheck
                    className="w-full p-5 text-xs font-mono leading-relaxed bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary resize-none border-0"
                    placeholder="Email body will appear here…"
                  />
                </div>
              ) : (
                /* Preview mode — render with placeholder highlighting */
                <div className="p-5 text-xs font-mono leading-relaxed whitespace-pre-wrap text-foreground">
                  <PlaceholderRenderer text={draft} />
                </div>
              )}
            </div>

            {/* Footer guidance */}
            <div className="rounded-xl border border-border bg-muted/20 p-4 space-y-2">
              <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Engineer Checklist</p>
              <ul className="space-y-1 text-xs text-muted-foreground">
                {[
                  'Fill in every [placeholder] with the actual value from the relevant system.',
                  'Do NOT guess or invent credentials, IDs, URLs, or passwords.',
                  'Verify the employee email address is correct before sending.',
                  'Re-read the full email in Preview mode before clicking Send.',
                  'If provisioning system access, confirm it is live before sending.',
                ].map((item, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="text-emerald-500 font-bold shrink-0">{i + 1}.</span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}

// ── Placeholder renderer — highlights [fields] in amber ──────────────────────

function PlaceholderRenderer({ text }: { text: string }) {
  const parts = text.split(/(\[[^\]]+\])/g);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith('[') && p.endsWith(']')
          ? (
            <span
              key={i}
              className="inline bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-200 rounded px-1 font-semibold border border-amber-300 dark:border-amber-700"
            >
              {p}
            </span>
          )
          : <span key={i}>{p}</span>
      )}
    </>
  );
}
