'use client';

/**
 * components/resolution-draft-panel.tsx
 *
 * Resolution Draft Panel — Customer Communication.
 *
 * Generates an EDITABLE template-based email draft for the engineer to fill in
 * and send to the employee after completing the work.
 *
 * Key design rules:
 *   - NEVER auto-sends — engineer must click Send
 *   - NEVER invents credentials, passwords, IDs, or any sensitive values
 *   - All sensitive fields are placeholder inputs filled by the engineer
 *   - Auto-detects the correct template from ticket.intent via detectTemplate()
 *   - Locked until ticket reaches completed or quality_check stage (or approved)
 *   - Adding a new intent type = add a template to resolution-templates.ts only
 */

import { useState, useEffect } from 'react';
import {
  detectTemplate, renderPreview, getAllTemplateOptions, getTemplateById,
  type ResolutionTemplate, type DraftField,
} from '@/lib/resolution-templates';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/hooks/use-toast';
import {
  FileEdit, Eye, Send, Copy, CheckCircle2, Lock,
  AlertTriangle, Loader2, ChevronDown, Info, RotateCcw,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Email, Ticket, DeptWorkStatus } from '@/lib/types';
import type { WorkflowStateRecord } from '@/lib/workflow-state';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ResolutionDraftPanelProps {
  email: Email;
  ticket: Ticket | null;
  ticketApproval: WorkflowStateRecord | null;
  /** Called after a successful send so the parent can refresh state */
  onSent: () => void;
}

// Stages that allow the draft to be opened and sent
const DRAFT_ALLOWED_STATUSES: DeptWorkStatus[] = ['quality_check', 'completed'];

// ─── Locked Overlay ───────────────────────────────────────────────────────────

function DraftLockedOverlay({ reason }: { reason: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
      <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center">
        <Lock className="h-7 w-7 text-muted-foreground" />
      </div>
      <div>
        <p className="text-sm font-semibold text-foreground mb-1">Resolution Draft Locked</p>
        <p className="text-xs text-muted-foreground max-w-xs leading-relaxed">{reason}</p>
      </div>
      <div className="rounded-xl border border-amber-200 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/20 px-4 py-3 max-w-xs">
        <p className="text-xs text-amber-800 dark:text-amber-200 leading-relaxed">
          <span className="font-semibold">Why is this locked?</span><br />
          The Resolution Draft is only available after the engineer has completed the work and the ticket has reached the <span className="font-semibold">Quality Verification</span> or <span className="font-semibold">Completed</span> stage.
        </p>
      </div>
    </div>
  );
}

// ─── Field Renderer ───────────────────────────────────────────────────────────

function DraftFieldInput({
  field,
  value,
  onChange,
}: {
  field: DraftField;
  value: string;
  onChange: (val: string) => void;
}) {
  const isPassword = field.type === 'password';

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1">
        <label className="text-xs font-medium text-foreground">
          {field.label}
          {field.required && <span className="text-red-500 ml-0.5">*</span>}
        </label>
        {isPassword && (
          <Badge variant="outline" className="text-[9px] py-0 px-1 ml-1 border-amber-300 text-amber-700 dark:text-amber-400">
            sensitive
          </Badge>
        )}
      </div>
      {field.type === 'textarea' ? (
        <Textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder}
          rows={3}
          className="text-sm resize-y"
        />
      ) : (
        <input
          type={isPassword ? 'text' : field.type === 'url' ? 'url' : field.type === 'email' ? 'email' : field.type === 'date' ? 'date' : 'text'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder}
          className="w-full h-9 px-3 text-sm rounded-md border border-input bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 transition-colors"
        />
      )}
      {field.hint && (
        <p className="text-[10px] text-muted-foreground flex items-center gap-1">
          <Info className="h-3 w-3 shrink-0" />
          {field.hint}
        </p>
      )}
    </div>
  );
}

// ─── Preview Renderer ─────────────────────────────────────────────────────────

function DraftPreview({ text }: { text: string }) {
  return (
    <div className="rounded-xl border border-border bg-muted/30 p-4">
      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-3">Email Preview</p>
      <pre className="text-sm whitespace-pre-wrap break-words leading-relaxed font-sans text-foreground">
        {text}
      </pre>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────════════════

export function ResolutionDraftPanel({
  email,
  ticket,
  ticketApproval,
  onSent,
}: ResolutionDraftPanelProps) {
  const { toast } = useToast();

  // ── State ──────────────────────────────────────────────────────────────────
  const [template, setTemplate] = useState<ResolutionTemplate | null>(null);
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [mode, setMode] = useState<'edit' | 'preview'>('edit');
  const [isSending, setIsSending] = useState(false);
  const [isCopied, setIsCopied] = useState(false);

  // ── Determine lock state ───────────────────────────────────────────────────
  // Draft is available if: approval is approved OR (no approval needed and ticket status allows)
  const approvalApproved = ticketApproval?.status === 'approved';
  const isUnlocked = approvalApproved;

  // ── Auto-detect template on mount / intent change ──────────────────────────
  useEffect(() => {
    if (!ticket && !email) return;
    const intent = ticket?.intent || email.intent || '';
    const body = email.body || '';
    const dept = ticket?.department || email.department || '';
    const detected = detectTemplate(intent, body, dept);
    setTemplate(detected);
    setFieldValues({}); // reset fields on template change
  }, [ticket?.intent, email.intent, email.department]);

  // ── Derived values ─────────────────────────────────────────────────────────
  // Derive a display name from the sender email address (e.g. john.doe@co → John Doe)
  const employeeName = email.sender
    ? email.sender.split('@')[0].replace(/[._-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
    : 'Employee';

  // Engineer may override the recipient name via the Greeting section field
  const resolvedRecipientName = fieldValues['__recipient_name__']?.trim() || employeeName;

  // Always render preview with the overridden name so what you see = what is sent
  const previewText = template
    ? renderPreview(template, fieldValues, resolvedRecipientName)
    : '';

  // ── Handlers ──────────────────────────────────────────────────────────────
  function handleTemplateChange(id: string) {
    const t = getTemplateById(id);
    setTemplate(t);
    setFieldValues({});
    setMode('edit');
  }

  function handleFieldChange(fieldId: string, value: string) {
    setFieldValues((prev) => ({ ...prev, [fieldId]: value }));
  }

  function handleReset() {
    setFieldValues({});
    setMode('edit');
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(previewText);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
      toast({ title: 'Copied', description: 'Draft copied to clipboard.' });
    } catch {
      toast({ title: 'Copy failed', description: 'Could not copy to clipboard.', variant: 'destructive' });
    }
  }

  async function handleSend() {
    if (!template) return;

    // ── Guard: ticket_id is required ───────────────────────────────────────
    if (!ticket?.id) {
      toast({
        title: 'Cannot send — ticket not loaded',
        description: 'The ticket record is not available. Please wait for the page to finish loading, then try again.',
        variant: 'destructive',
      });
      return;
    }

    // ── Guard: recipient is required ───────────────────────────────────────
    const recipientEmail = email.sender?.trim();
    if (!recipientEmail) {
      toast({
        title: 'Cannot send — no recipient',
        description: 'No sender email address is associated with this ticket.',
        variant: 'destructive',
      });
      return;
    }

    // ── Guard: rendered body must not be empty ─────────────────────────────
    const bodyToSend = renderPreview(template, fieldValues, resolvedRecipientName);
    if (!bodyToSend.trim()) {
      toast({
        title: 'Cannot send — empty body',
        description: 'The email body is empty. Fill in the template fields first.',
        variant: 'destructive',
      });
      return;
    }

    // ── Validate required template fields ──────────────────────────────────
    const missingFields: string[] = [];
    for (const section of template.sections) {
      for (const field of section.fields) {
        if (field.required && !fieldValues[field.id]?.trim()) {
          missingFields.push(field.label);
        }
      }
    }
    if (missingFields.length > 0) {
      toast({
        title: 'Missing required fields',
        description: `Please fill in: ${missingFields.join(', ')}`,
        variant: 'destructive',
      });
      return;
    }

    setIsSending(true);
    try {
      const subject = template.subject.replace('{{name}}', resolvedRecipientName);
      const emailSubject = `Re: ${email.subject || subject}`;

      const res = await fetch('/api/send-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticket_id:     ticket.id,          // always a real UUID now
          response_text: bodyToSend,          // fully rendered body with all filled fields
          to_email:      recipientEmail,
          subject:       emailSubject,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `Server error ${res.status}`);
      }

      toast({
        title: '✅ Resolution email sent',
        description: `Email sent to ${recipientEmail}. Ticket marked as resolved.`,
      });
      onSent();
    } catch (err: any) {
      toast({
        title: 'Send failed',
        description: err.message || 'Could not send the resolution email. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsSending(false);
    }
  }

  // ── RESOLVED GUARD — hard stop: never render the draft form after resolution ──
  // This check runs BEFORE the lock check so no form, field, Send or Copy button
  // is ever mounted once the ticket is closed.
  const isTicketResolved = ticket?.status === 'resolved' || ticket?.status === 'completed';
  if (isTicketResolved) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-4 text-center">
        <div className="w-16 h-16 rounded-full bg-emerald-50 border-2 border-emerald-200 flex items-center justify-center">
          <CheckCircle2 className="h-7 w-7 text-emerald-600" />
        </div>
        <div>
          <p className="text-sm font-bold text-foreground mb-1">Ticket Successfully Resolved</p>
          <p className="text-xs text-muted-foreground max-w-xs leading-relaxed">
            The resolution email has been delivered to the employee. This ticket is now closed.
          </p>
        </div>
        <div className="rounded-xl border border-emerald-200 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-950/20 px-4 py-3 max-w-xs">
          <p className="text-xs text-emerald-800 dark:text-emerald-200 leading-relaxed">
            The draft editor, credential form, and send controls are only available during{' '}
            <span className="font-semibold">Department Processing</span>. They are permanently
            removed after the ticket is resolved.
          </p>
        </div>
      </div>
    );
  }

  // ── Lock check ─────────────────────────────────────────────────────────────
  if (!isUnlocked) {
    const lockReason = !ticketApproval
      ? 'This ticket has not yet been approved by the manager. Complete the approval workflow first.'
      : ticketApproval.status === 'pending'
      ? 'Manager approval is still pending. The Resolution Draft will unlock once the manager approves the request.'
      : ticketApproval.status === 'rejected'
      ? 'This ticket was rejected by the manager. The Resolution Draft cannot be used for rejected tickets.'
      : 'The Resolution Draft unlocks after the manager approves the request and the work is completed.';

    return <DraftLockedOverlay reason={lockReason} />;
  }

  if (!template) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">

      {/* ── Header bar ──────────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/20 p-3 flex items-start gap-2">
        <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
        <div className="text-xs text-emerald-800 dark:text-emerald-200 leading-relaxed">
          <span className="font-semibold">Ready to draft.</span> Fill in the fields below, preview the email, then click <span className="font-semibold">Send Email</span>. All sensitive fields must be entered by you — the system never invents credentials.
        </div>
      </div>

      {/* ── Template Selector ─────────────────────────────────────────────── */}
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex items-center gap-2 mb-3">
          <div className="p-1.5 rounded-md bg-primary/10">
            <FileEdit className="h-3.5 w-3.5 text-primary" />
          </div>
          <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground flex-1">Template</p>
          <Badge variant="secondary" className="text-[10px]">Auto-detected</Badge>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <Select value={template.id} onValueChange={handleTemplateChange}>
            <SelectTrigger className="h-9 text-sm flex-1 min-w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {getAllTemplateOptions().map((opt) => (
                <SelectItem key={opt.id} value={opt.id} className="text-sm">
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            size="sm"
            variant="ghost"
            className="h-9 gap-1.5 text-xs text-muted-foreground"
            onClick={handleReset}
          >
            <RotateCcw className="h-3 w-3" />
            Reset Fields
          </Button>
        </div>

        {/* Subject preview */}
        <div className="mt-3 px-3 py-2 rounded-lg bg-muted/40 border border-border/40">
          <p className="text-[10px] text-muted-foreground mb-0.5">Email Subject</p>
          <p className="text-sm font-medium text-foreground">
            {template.subject.replace('{{name}}', employeeName)}
          </p>
        </div>
      </div>

      {/* ── Edit / Preview toggle ──────────────────────────────────────────── */}
      <div className="flex items-center gap-1 p-1 bg-muted/50 rounded-lg border border-border/40 w-fit">
        <button
          onClick={() => setMode('edit')}
          className={cn(
            'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all',
            mode === 'edit'
              ? 'bg-background shadow-sm text-foreground'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          <FileEdit className="h-3.5 w-3.5" />
          Edit
        </button>
        <button
          onClick={() => setMode('preview')}
          className={cn(
            'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all',
            mode === 'preview'
              ? 'bg-background shadow-sm text-foreground'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          <Eye className="h-3.5 w-3.5" />
          Preview
        </button>
      </div>

      {/* ── Edit Mode: form fields ─────────────────────────────────────────── */}
      {mode === 'edit' && (
        <div className="space-y-4">
          {/* Greeting (static) */}
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-center gap-2 mb-3">
              <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Greeting</p>
            </div>
            <div className="grid grid-cols-1 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-foreground">Recipient Name</label>
                <input
                  type="text"
                  value={fieldValues['__recipient_name__'] || employeeName}
                  onChange={(e) => handleFieldChange('__recipient_name__', e.target.value)}
                  className="w-full h-9 px-3 text-sm rounded-md border border-input bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 transition-colors"
                  placeholder={employeeName}
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-2 leading-relaxed border-t border-border/40 pt-2">
              {template.intro}
            </p>
          </div>

          {/* Template sections */}
          {template.sections.map((section, sIdx) => (
            <div key={sIdx} className="rounded-xl border border-border bg-card p-4">
              {section.heading && (
                <div className="flex items-center gap-2 mb-3">
                  <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">{section.heading}</p>
                </div>
              )}
              {section.intro && (
                <p className="text-xs text-muted-foreground mb-3 leading-relaxed">{section.intro}</p>
              )}
              <div className="grid grid-cols-1 gap-3">
                {section.fields.map((field) => (
                  <DraftFieldInput
                    key={field.id}
                    field={field}
                    value={fieldValues[field.id] || ''}
                    onChange={(val) => handleFieldChange(field.id, val)}
                  />
                ))}
              </div>
            </div>
          ))}

          {/* Closing (static) */}
          <div className="rounded-xl border border-border bg-card p-4">
            <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground mb-2">Closing</p>
            <p className="text-sm text-foreground">Best regards,</p>
            <p className="text-sm font-semibold text-foreground">{template.closing}</p>
          </div>
        </div>
      )}

      {/* ── Preview Mode ───────────────────────────────────────────────────── */}
      {mode === 'preview' && (
        <DraftPreview
          text={renderPreview(
            template,
            fieldValues,
            resolvedRecipientName
          )}
        />
      )}

      {/* ── Action buttons ─────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5 text-xs"
          onClick={handleCopy}
        >
          {isCopied ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
          {isCopied ? 'Copied!' : 'Copy Draft'}
        </Button>

        <Button
          id="btn-send-resolution-email"
          size="sm"
          className="gap-1.5 text-xs font-semibold ml-auto"
          onClick={handleSend}
          disabled={isSending}
        >
          {isSending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
          {isSending ? 'Sending…' : 'Send Email'}
        </Button>
      </div>

      {/* ── Safety notice ─────────────────────────────────────────────────── */}
      <div className="rounded-lg border border-border/40 bg-muted/20 px-3 py-2 flex items-start gap-2">
        <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0 mt-0.5" />
        <p className="text-[10px] text-muted-foreground leading-relaxed">
          <span className="font-semibold text-foreground">Security reminder:</span> This system never generates passwords, usernames, license keys, or any credentials. All sensitive values must be entered manually by the engineer. Review the draft carefully before sending.
        </p>
      </div>

    </div>
  );
}
