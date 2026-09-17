'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { generateAIResponse, type ResponseTone, storeResolvedCase, findSimilarResolvedCases, runDecisionAgent } from '@/lib/agents';
import { getCurrentWorkflowState, getWorkflowStages, getCanonicalWorkflowStages, type WorkflowStateRecord } from '@/lib/workflow-state';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/hooks/use-toast';
import { ResolutionAnalysisPanel } from '@/components/resolution-analysis-panel';
import { ResolutionDraftPanel } from '@/components/resolution-draft-panel';
import {
  Mail, Tag, Building2, Users, AlertTriangle, Smile, BrainCircuit,
  Send, CheckCircle2, Sparkles, Loader2, ArrowRight,
  ThumbsUp, ThumbsDown, Clock, X, ShieldCheck,
  Inbox, History, Reply, FileEdit, Zap,
} from 'lucide-react';
import type { Email, Ticket, ResponseData, ActionData, Draft, Approval, ResponseVersion, DecisionResult, DecisionLog } from '@/lib/types';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';

interface EmailDetailProps {
  email: Email | null;
  onEmailUpdated: () => void;
  onReclassify: (email: Email) => void;
  isProcessing: boolean;
}

const priorityColors: Record<string, string> = {
  low: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
  medium: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
  high: 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300',
  critical: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
};

const sentimentColors: Record<string, string> = {
  positive: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
  neutral: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  negative: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
};

const toneLabels: Record<ResponseTone, string> = {
  professional: 'Professional',
  friendly: 'Friendly',
  empathetic: 'Empathetic',
  formal: 'Formal',
  concise: 'Concise',
};

export function EmailDetail({ email, onEmailUpdated, onReclassify, isProcessing }: EmailDetailProps) {
  const { toast } = useToast();
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [response, setResponse] = useState<ResponseData | null>(null);
  const [actions, setActions] = useState<ActionData[]>([]);
  const [generatedResponse, setGeneratedResponse] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [editedResponse, setEditedResponse] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [selectedTone, setSelectedTone] = useState<ResponseTone>('professional');
  const [similarCases, setSimilarCases] = useState<Array<{
    id: string; emailSubject: string; finalResponse: string; intent: string; department: string; similarity: number;
  }>>([])

  const [approval, setApproval] = useState<Approval | null>(null);
  const [showApprovalDialog, setShowApprovalDialog] = useState(false);
  const [approvalNotes, setApprovalNotes] = useState('');
  const [isSubmittingApproval, setIsSubmittingApproval] = useState(false);

  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [showDraftsPanel, setShowDraftsPanel] = useState(false);
  const [isSavingDraft, setIsSavingDraft] = useState(false);

  const [versions, setVersions] = useState<ResponseVersion[]>([]);
  const [showVersionsPanel, setShowVersionsPanel] = useState(false);

  const [sentEmails, setSentEmails] = useState<Array<{
    id: string; to_email: string; subject: string; body: string; sent_at: string;
  }>>([])

  // Decision & Escalation Agent state
  const [decision, setDecision] = useState<DecisionResult | null>(null);
  const [decisionLog, setDecisionLog] = useState<DecisionLog | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isActioning, setIsActioning] = useState(false);
  const [isAutoGenerating, setIsAutoGenerating] = useState(false);
  // Controls the collapsed "Initial AI Assessment" reference card
  const [showAiAssessment, setShowAiAssessment] = useState(false);
  // ── Escalation work item ID — set after ESCALATE action, persisted via DB ──
  const [escalationWorkItemId, setEscalationWorkItemId] = useState<string | null>(null);
  // ── Escalation work item status — for live workflow stages ────────────────
  const [escalationWorkItem, setEscalationWorkItem] = useState<any | null>(null);
  // ── Two-tab module switcher ────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<'analysis' | 'draft'>('analysis');

  // Module 2C: approval result state — set after creating an approval request
  const [approvalResult, setApprovalResult] = useState<{
    id: string;
    managerName: string | null;
    managerEmail: string | null;
    status: string;
  } | null>(null);

  // Persisted approval_request record — the SINGLE source of truth for workflow
  // state in the UI. Typed via WorkflowStateRecord from lib/workflow-state.ts.
  // Populated by an eager effect (email.id key) and refreshed via Supabase Realtime.
  const [ticketApproval, setTicketApproval] = useState<WorkflowStateRecord | null>(null);

  // ── Canonical stage context — sourced from tickets + dept_work_items ─────
  // These fields arrive from the enriched by-ticket API and are used by
  // getCanonicalWorkflowStages() so the WorkflowStepper always matches DB truth.
  const [workItemStatus,      setWorkItemStatus]      = useState<string | null>(null);
  const [workItemHasAssignee, setWorkItemHasAssignee] = useState<boolean>(false);
  const [workItemAcceptedAt,  setWorkItemAcceptedAt]  = useState<string | null>(null);
  const [ticketWorkflowStage, setTicketWorkflowStage] = useState<string | null>(null);

  // ── EARLY WORKFLOW STATE FETCH ──────────────────────────────────────────────
  // Loads all canonical workflow state by email.id as soon as an email is selected.
  // We call the enriched /api/approvals/by-ticket directly (not getCurrentWorkflowState)
  // so that workItemStatus, hasAssignee, acceptedAt, ticketWorkflowStage are ALL
  // populated on the first render — not only when a realtime event fires later.
  useEffect(() => {
    if (!email?.id) {
      setTicketApproval(null);
      setApprovalResult(null);
      setWorkItemStatus(null);
      setWorkItemHasAssignee(false);
      setWorkItemAcceptedAt(null);
      setTicketWorkflowStage(null);
      return;
    }
    const loadWorkflowState = async () => {
      try {
        const qs = new URLSearchParams();
        qs.set('emailId', email.id);
        if (ticket?.id) qs.set('ticketId', ticket.id);

        const res = await fetch(`/api/approvals/by-ticket?${qs}`, { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();

        // Approval record
        const ar = data.approval ?? null;
        setTicketApproval(ar);
        if (ar) {
          setApprovalResult({
            id:           ar.id,
            managerName:  ar.manager_name,
            managerEmail: ar.manager_email,
            status:       ar.status,
          });
        }

        // Canonical stage fields — needed immediately so WorkflowStepper renders correct stage
        setWorkItemStatus(data.workItemStatus          ?? null);
        setWorkItemHasAssignee(data.hasAssignee        ?? false);
        setWorkItemAcceptedAt(data.acceptedAt           ?? null);
        setTicketWorkflowStage(data.ticketWorkflowStage ?? null);
      } catch { /* non-fatal */ }
    };

    loadWorkflowState();
  }, [email?.id, ticket?.id]);

  // Primary effect: fetch full ticket data when email changes
  useEffect(() => {
    if (email) {
      fetchTicketData();
    }
  }, [email?.id]);

  // Load escalation work item from DB when ticket is in 'escalated' status.
  // This ensures the High Priority Escalation card persists across page reloads.
  useEffect(() => {
    if (!ticket?.id || ticket.status !== 'escalated') {
      if (ticket && ticket.status !== 'escalated') {
        setEscalationWorkItemId(null);
        setEscalationWorkItem(null);
      }
      return;
    }

    async function loadEscalationWorkItem() {
      try {
        // Use exact ticketId filter — not text search, which would never match a UUID
        const res = await fetch(`/api/dept/queue?ticketId=${ticket!.id}`);
        if (!res.ok) return;
        const data = await res.json();
        const items: any[] = data.items ?? [];
        if (items.length > 0) {
          setEscalationWorkItemId(items[0].id);
          setEscalationWorkItem(items[0]);
        }
      } catch { /* non-fatal */ }
    }

    loadEscalationWorkItem();
  }, [ticket?.id, ticket?.status]);

  // Realtime subscription: refresh approval + canonical stage state whenever:
  //   - approval_requests changes (approval/rejection by manager)
  //   - tickets changes (workflow_stage set by processAcceptanceApproval)
  //   - dept_work_items changes (acceptance or status transition)
  // This single effect replaces the old approval-only subscription and ensures
  // the WorkflowStepper always reflects the latest DB state without a page refresh.
  useEffect(() => {
    if (!ticket?.id) return;

    const refreshFromApi = async () => {
      try {
        const params = new URLSearchParams({ ticketId: ticket.id });
        if (email?.id) params.set('emailId', email.id);
        const res = await fetch(`/api/approvals/by-ticket?${params}`, { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();

        // Update approval state
        const ar = data.approval ?? null;
        setTicketApproval(ar);
        setApprovalResult(ar ? {
          id: ar.id,
          managerName: ar.manager_name,
          managerEmail: ar.manager_email,
          status: ar.status,
        } : null);

        // ── Update canonical stage context from enriched response ─────────
        // These come from the dept_work_items + tickets joins in the by-ticket route.
        setWorkItemStatus(data.workItemStatus      ?? null);
        setWorkItemHasAssignee(data.hasAssignee    ?? false);
        setWorkItemAcceptedAt(data.acceptedAt      ?? null);
        setTicketWorkflowStage(data.ticketWorkflowStage ?? null);
      } catch { /* non-fatal */ }
    };

    const channel = supabase
      .channel(`email_detail_wf_${ticket.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'approval_requests',
          filter: `ticket_id=eq.${ticket.id}`,
        },
        () => refreshFromApi()
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'tickets',
          filter: `id=eq.${ticket.id}`,
        },
        () => refreshFromApi()  // fires when workflow_stage is written
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'dept_work_items',
          filter: `ticket_id=eq.${ticket.id}`,
        },
        () => refreshFromApi()  // fires when accepted_at / status changes
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [ticket?.id, email?.id]);

  // Auto-generation effect: fires when decision resolves to AUTO_RESPONSE
  // and no response has been generated yet for this ticket
  useEffect(() => {
    if (
      decision?.decision === 'AUTO_RESPONSE' &&
      !response &&                    // no response exists yet
      !generatedResponse &&           // not already generated in this session
      !isGenerating &&                // not currently generating
      !isAutoGenerating &&            // guard against double-fire
      ticket &&                       // ticket must exist
      email                           // email must be loaded
    ) {
      setIsAutoGenerating(true);
      generateResponse().finally(() => setIsAutoGenerating(false));
    }
  }, [decision?.decision, ticket?.id, response?.id]);

  async function saveResponse(
    ticketId: string,
    payload: Partial<Pick<ResponseData, 'response' | 'approved' | 'draft_mode' | 'tone' | 'generated_by' | 'sent_at'>>
  ): Promise<ResponseData | null> {
    const { data: existingRows, error: existingError } = await supabase
      .from('responses')
      .select('id')
      .eq('ticket_id', ticketId)
      .order('id', { ascending: false })
      .limit(1);

    if (existingError) throw existingError;

    const existing = existingRows?.[0];
    if (existing?.id) {
      const { data, error } = await supabase
        .from('responses')
        .update(payload)
        .eq('id', existing.id)
        .select()
        .single();
      if (error) throw error;
      return data;
    }

    const { data, error } = await supabase
      .from('responses')
      .insert({
        ticket_id: ticketId,
        ...payload,
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  async function saveApproval(
    responseId: string,
    payload: Partial<Pick<Approval, 'status' | 'requested_by' | 'approved_by' | 'notes' | 'resolved_at'>>
  ): Promise<void> {
    const { data: existingRows, error: existingError } = await supabase
      .from('approvals')
      .select('id')
      .eq('response_id', responseId)
      .order('requested_at', { ascending: false })
      .limit(1);

    if (existingError) throw existingError;

    const existing = existingRows?.[0];
    if (existing?.id) {
      const { error } = await supabase
        .from('approvals')
        .update(payload)
        .eq('id', existing.id);
      if (error) throw error;
      return;
    }

    const { error } = await supabase.from('approvals').insert({
      response_id: responseId,
      ...payload,
    });
    if (error) throw error;
  }

  async function fetchTicketData() {
    if (!email) return;

    try {
      // First try to find existing ticket
      const { data: ticketRows, error: ticketError } = await supabase
        .from('tickets')
        .select('*')
        .eq('email_id', email.id)
        .order('created_at', { ascending: false })
        .limit(1);

      if (ticketError) throw ticketError;

      const tickets = ticketRows?.[0] || null;

      if (tickets) {
        setTicket(tickets);

        const { data: responseRows } = await supabase
          .from('responses')
          .select('*')
          .eq('ticket_id', tickets.id)
          .order('id', { ascending: false })
          .limit(1);
        const responses = responseRows?.[0] || null;
        setResponse(responses);

        const { data: actionsData } = await supabase
          .from('actions')
          .select('*')
          .eq('ticket_id', tickets.id);
        setActions(actionsData || []);

        const { data: draftsData } = await supabase
          .from('drafts')
          .select('*')
          .eq('ticket_id', tickets.id)
          .order('version', { ascending: false });
        setDrafts(draftsData || []);

        if (responses?.id) {
          const { data: approvalRows } = await supabase
            .from('approvals')
            .select('*')
            .eq('response_id', responses.id)
            .order('requested_at', { ascending: false })
            .limit(1);
          setApproval(approvalRows?.[0] || null);

          const { data: versionsData } = await supabase
            .from('response_versions')
            .select('*')
            .eq('response_id', responses.id)
            .order('version_number', { ascending: false });
          setVersions(versionsData || []);
        } else {
          setApproval(null);
          setVersions([]);
        }

        // Fetch sent emails for this ticket
        const { data: sentData } = await supabase
          .from('sent_emails')
          .select('*')
          .eq('ticket_id', tickets.id)
          .order('sent_at', { ascending: true });
        setSentEmails(sentData || []);

        // ── Load approval_request via server-side API ─────────────────────
        // Using a server-side API route instead of a direct Supabase client
        // query — this bypasses any RLS edge cases, caching, and ticket-ID
        // mismatches (when multiple tickets exist for the same email).
        try {
          const arParams = new URLSearchParams();
          arParams.set('ticketId', tickets.id);
          if (email?.id) arParams.set('emailId', email.id);

          const arRes = await fetch(`/api/approvals/by-ticket?${arParams}`, {
            cache: 'no-store',
          });

          if (arRes.ok) {
            const arData = await arRes.json();
            const existingAr = arData.approval ?? null;
            console.log('[EmailDetail] ticketApproval →', existingAr
              ? `found: ${existingAr.id} (${existingAr.status})`
              : 'none');
            setTicketApproval(existingAr);
            setApprovalResult(existingAr ? {
              id: existingAr.id,
              managerName: existingAr.manager_name,
              managerEmail: existingAr.manager_email,
              status: existingAr.status,
            } : null);
          } else {
            console.warn('[EmailDetail] by-ticket API returned', arRes.status);
            setTicketApproval(null);
            setApprovalResult(null);
          }
        } catch (arErr) {
          console.error('[EmailDetail] approval load error:', arErr);
          setTicketApproval(null);
          setApprovalResult(null);
        }
        // ─────────────────────────────────────────────────────────────────

        const similar = await findSimilarResolvedCases(`${email.subject} ${email.body}`, 3);
        setSimilarCases(similar);

        // Load decision: first try persisted decision_log for this ticket,
        // then fall back to running the agent live.
        if (tickets.id) {
          setIsAnalyzing(true);
          try {
            const { data: logData } = await supabase
              .from('decision_logs')
              .select('*')
              .eq('ticket_id', tickets.id)
              .order('created_at', { ascending: false })
              .limit(1)
              .maybeSingle();

            if (logData) {
              setDecisionLog(logData as DecisionLog);
              // Reconstruct DecisionResult from the stored log
              setDecision({
                decision: logData.decision,
                confidence: logData.confidence,
                risk: logData.risk_level,
                requires_human: logData.requires_human,
                reason: logData.escalation_reason || '',
                department: logData.recommended_department || undefined,
                subteam: logData.recommended_subteam || undefined,
                recommended_person: logData.recommended_person || undefined,
                ai_summary: logData.ai_summary || undefined,
              });
            } else {
              // No stored log yet — run agent live
              const liveDecision = await runDecisionAgent(
                tickets.intent || email.intent || 'General Inquiry',
                tickets.priority || email.priority || 'medium',
                email.sentiment || 'neutral',
                tickets.department || email.department || 'IT',
                tickets.subteam || email.subteam || 'General',
                email.subject,
                email.body
              );
              setDecision(liveDecision);
            }
          } catch {
            setDecision(null);
          } finally {
            setIsAnalyzing(false);
          }
        }
      } else {
        // No ticket yet
        setTicket(null);
        setResponse(null);
        setActions([]);
        setDrafts([]);
        setApproval(null);
        setVersions([]);
        setSentEmails([]);
        setSimilarCases([]);
        setDecision(null);
        setDecisionLog(null);
        setTicketApproval(null);
        setApprovalResult(null);
      }
    } catch (err) {
      console.error('Error fetching ticket data:', err);
    }
  }

  // Create ticket if missing, then generate response
  async function ensureTicket(): Promise<Ticket | null> {
    if (ticket) return ticket;
    if (!email) return null;

    try {
      // Use email classification data to create ticket
      const { data: newTicket, error } = await supabase
        .from('tickets')
        .insert({
          email_id: email.id,
          intent: email.intent || 'General Inquiry',
          department: email.department || 'IT',
          subteam: email.subteam || 'General',
          priority: email.priority || 'medium',
          sentiment: email.sentiment || 'neutral',
          status: 'open',
        })
        .select()
        .single();

      if (error) throw error;
      setTicket(newTicket);
      return newTicket;
    } catch (err) {
      console.error('Error creating ticket:', err);
      return null;
    }
  }

  async function generateResponse() {
    if (!email) return;
    setIsGenerating(true);

    try {
      // Ensure we have a ticket
      const activeTicket = await ensureTicket();
      if (!activeTicket) {
        toast({ title: 'Error', description: 'Could not create ticket for this email.', variant: 'destructive' });
        setIsGenerating(false);
        return;
      }

      // Generate actions if missing
      if (actions.length === 0) {
        await generateActionsForIntent(activeTicket.id, activeTicket.intent || 'General Inquiry', activeTicket.department || 'IT', activeTicket.subteam || 'General');
      }

      const result = await generateAIResponse(
        activeTicket.intent || 'General Inquiry',
        activeTicket.department || 'IT',
        activeTicket.subteam || 'General',
        email.subject,
        email.body,
        selectedTone,
        activeTicket.priority || 'medium',
        activeTicket.sentiment || 'neutral'
      );

      if (result) {
        setGeneratedResponse(result.response);
        setEditedResponse(result.response);
        setIsEditing(false);

        // Upsert response
        const respData = await saveResponse(activeTicket.id, {
          response: result.response,
          approved: false,
          draft_mode: false,
          tone: selectedTone,
          generated_by: 'ai',
        });

        if (respData) {
          // Create version
          const { data: existingVersions } = await supabase
            .from('response_versions')
            .select('version_number')
            .eq('response_id', respData.id)
            .order('version_number', { ascending: false })
            .limit(1);

          const nextVersion = existingVersions && existingVersions.length > 0 ? existingVersions[0].version_number + 1 : 1;

          await supabase.from('response_versions').insert({
            response_id: respData.id,
            content: result.response,
            version_number: nextVersion,
            change_summary: `AI-generated with ${toneLabels[selectedTone]} tone`,
          });

          // Create approval request
          await saveApproval(respData.id, {
            status: 'pending',
            requested_by: 'ai_system',
            approved_by: null,
            notes: null,
            resolved_at: null,
          });
        }
      }

      await fetchTicketData();
    } catch (err) {
      console.error('Error generating response:', err);
      toast({ title: 'Generation failed', description: 'Could not generate response.', variant: 'destructive' });
    } finally {
      setIsGenerating(false);
    }
  }

  async function regenerateWithTone(tone: ResponseTone) {
    setSelectedTone(tone);
    if (!email) return;
    setIsGenerating(true);

    try {
      const activeTicket = ticket || await ensureTicket();
      if (!activeTicket) {
        setIsGenerating(false);
        return;
      }

      const result = await generateAIResponse(
        activeTicket.intent || 'General Inquiry',
        activeTicket.department || 'IT',
        activeTicket.subteam || 'General',
        email.subject,
        email.body,
        tone,
        activeTicket.priority || 'medium',
        activeTicket.sentiment || 'neutral'
      );

      if (result) {
        setGeneratedResponse(result.response);
        setEditedResponse(result.response);
        setIsEditing(false);

        const respData = await saveResponse(activeTicket.id, {
          response: result.response,
          approved: false,
          tone: tone,
          generated_by: 'ai',
        });

        if (respData) {
          const { data: existingVersions } = await supabase
            .from('response_versions')
            .select('version_number')
            .eq('response_id', respData.id)
            .order('version_number', { ascending: false })
            .limit(1);

          const nextVersion = existingVersions && existingVersions.length > 0 ? existingVersions[0].version_number + 1 : 1;

          await supabase.from('response_versions').insert({
            response_id: respData.id,
            content: result.response,
            version_number: nextVersion,
            change_summary: `Regenerated with ${toneLabels[tone]} tone`,
          });

          await saveApproval(respData.id, {
            status: 'pending',
            requested_by: 'ai_system',
            approved_by: null,
            notes: null,
            resolved_at: null,
          });
        }
      }

      await fetchTicketData();
    } catch (err) {
      console.error('Error regenerating response:', err);
    } finally {
      setIsGenerating(false);
    }
  }

  // Generate actions based on intent
  async function generateActionsForIntent(ticketId: string, intent: string, department: string, subteam: string) {
    const actions = getActionsForIntent(intent, department, subteam);
    for (const action of actions) {
      await supabase.from('actions').insert({
        ticket_id: ticketId,
        recommended_action: action,
      });
    }
  }

  function getActionsForIntent(intent: string, department: string, subteam: string): string[] {
    const normalizedIntent = intent.toLowerCase();
    if (normalizedIntent.includes('password') || normalizedIntent.includes('reset')) {
      return ['Verify employee identity through registered email or employee ID', `Send password reset instructions via secure channel to ${subteam}`, 'Escalate to IAM team if reset fails after 3 attempts'];
    }
    if (normalizedIntent.includes('leave') || normalizedIntent.includes('vacation')) {
      return ['Check employee leave balance in HR system', 'Forward leave request to manager for approval', 'Update leave management system after approval'];
    }
    if (normalizedIntent.includes('vpn') || normalizedIntent.includes('remote access')) {
      return ['Verify employee remote work eligibility', `Generate VPN credentials through ${subteam}`, 'Send setup guide and security policy acknowledgment'];
    }
    if (normalizedIntent.includes('laptop') || normalizedIntent.includes('computer') || normalizedIntent.includes('hardware')) {
      return ['Run remote diagnostics on the reported device', `Assign to ${subteam} for physical inspection`, 'Schedule replacement if device is under warranty and unrepairable'];
    }
    if (normalizedIntent.includes('wifi') || normalizedIntent.includes('network') || normalizedIntent.includes('internet')) {
      return ['Check network status for reported location', `Assign ${subteam} to diagnose connectivity issue`, 'Provide temporary workaround if outage is extended'];
    }
    if (normalizedIntent.includes('payroll') || normalizedIntent.includes('salary')) {
      return ['Verify payroll cycle and payment status', 'Create finance ticket for discrepancy investigation', `Escalate to ${subteam} if issue spans multiple cycles`];
    }
    if (normalizedIntent.includes('insurance') || normalizedIntent.includes('medical')) {
      return ['Check current benefits policy and coverage details', `Forward to ${subteam} for claim processing`, 'Provide claim submission instructions and required documents list'];
    }
    if (normalizedIntent.includes('sap') || normalizedIntent.includes('erp')) {
      return ['Validate manager approval for SAP access request', `Forward to ${subteam} for provisioning`, 'Create access request ticket in system'];
    }
    if (normalizedIntent.includes('training') || normalizedIntent.includes('course')) {
      return ['Check training budget and eligibility for employee level', 'Forward to L&D team for course scheduling', 'Update learning management system upon completion'];
    }
    if (normalizedIntent.includes('resignation') || normalizedIntent.includes('quit')) {
      return ['Acknowledge resignation and confirm notice period', 'Initiate exit checklist and handover process', 'Schedule exit interview with HR business partner'];
    }
    return [`Review request details and categorize under ${department}`, `Assign to ${subteam} for initial assessment`, 'Set follow-up reminder within 24 hours'];
  }

  async function saveEditedResponse() {
    if (!ticket) return;
    try {
      const respData = await saveResponse(ticket.id, {
        response: editedResponse,
        approved: false,
      });

      if (respData) {
        const { data: existingVersions } = await supabase
          .from('response_versions')
          .select('version_number')
          .eq('response_id', respData.id)
          .order('version_number', { ascending: false })
          .limit(1);

        const nextVersion = existingVersions && existingVersions.length > 0 ? existingVersions[0].version_number + 1 : 1;

        await supabase.from('response_versions').insert({
          response_id: respData.id,
          content: editedResponse,
          version_number: nextVersion,
          change_summary: 'Manual edit by agent',
        });

        await saveApproval(respData.id, {
          status: 'pending',
          requested_by: 'agent',
          approved_by: null,
          notes: null,
          resolved_at: null,
        });
      }

      setIsEditing(false);
      setGeneratedResponse(editedResponse);
      toast({ title: 'Saved', description: 'Your edits have been saved and sent for approval.' });
      await fetchTicketData();
    } catch (err) {
      console.error('Error saving edited response:', err);
      toast({ title: 'Save failed', description: 'Could not save your edits.', variant: 'destructive' });
    }
  }

  async function saveDraft() {
    if (!ticket) return;
    setIsSavingDraft(true);

    try {
      const nextVersion = drafts.length > 0 ? Math.max(...drafts.map(d => d.version)) + 1 : 1;
      await supabase.from('drafts').insert({
        ticket_id: ticket.id,
        content: editedResponse || generatedResponse || response?.response || '',
        version: nextVersion,
        created_by: 'agent',
      });

      toast({ title: 'Draft saved', description: `Draft version ${nextVersion} saved.` });
      await fetchTicketData();
    } catch (err) {
      console.error('Error saving draft:', err);
    } finally {
      setIsSavingDraft(false);
    }
  }

  async function loadDraft(draft: Draft) {
    setEditedResponse(draft.content);
    setGeneratedResponse(draft.content);
    setIsEditing(true);
    setShowDraftsPanel(false);
  }

  async function loadVersion(version: ResponseVersion) {
    setEditedResponse(version.content);
    setGeneratedResponse(version.content);
    setIsEditing(true);
    setShowVersionsPanel(false);
  }

  async function requestApproval() {
    if (!response) return;
    try {
      await saveApproval(response.id, {
        status: 'pending',
        requested_by: 'agent',
        approved_by: null,
        notes: null,
        resolved_at: null,
      });
      await supabase
        .from('responses')
        .update({ approved: false })
        .eq('id', response.id);

      toast({ title: 'Approval requested', description: 'Response is now pending manager approval.' });
      await fetchTicketData();
    } catch (err) {
      console.error('Error requesting approval:', err);
      toast({ title: 'Request failed', description: 'Could not request approval.', variant: 'destructive' });
    }
  }

  async function submitApproval(status: 'approved' | 'rejected') {
    if (!response) return;
    setIsSubmittingApproval(true);

    try {
      await saveApproval(response.id, {
        status,
        approved_by: status === 'approved' ? 'manager' : null,
        notes: approvalNotes || null,
        resolved_at: new Date().toISOString(),
      });

      if (status === 'approved') {
        await supabase
          .from('responses')
          .update({ approved: true })
          .eq('id', response.id);
      }

      setShowApprovalDialog(false);
      setApprovalNotes('');
      toast({
        title: status === 'approved' ? 'Approved' : 'Rejected',
        description: `Response has been ${status}.`,
      });
      await fetchTicketData();
    } catch (err) {
      console.error('Error submitting approval:', err);
      toast({ title: 'Approval failed', description: 'Could not process approval.', variant: 'destructive' });
    } finally {
      setIsSubmittingApproval(false);
    }
  }

  async function executeDecisionAction() {
    if (!ticket || !decision) return;
    setIsActioning(true);
    try {
      if (decision.decision === 'ESCALATE') {
        // ── Call /api/dept/escalate which atomically:
        //    1. Updates ticket to 'escalated'
        //    2. Creates dept_work_items row
        //    3. Inserts critical notification with dept_work_item_id
        const res = await fetch('/api/dept/escalate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ticketId:      ticket.id,
            emailId:       email?.id ?? null,
            department:    decision.department || ticket.department,
            subteam:       decision.subteam    || ticket.subteam,
            risk:          decision.risk,
            reason:        decision.reason,
            subject:       email?.subject ?? '',
            employeeName:  email?.sender?.split('@')[0] ?? null,
            employeeEmail: email?.sender ?? null,
            intent:        ticket.intent ?? email?.intent ?? null,
            priority:      ticket.priority ?? email?.priority ?? 'high',
          }),
        });

        if (res.ok) {
          const data = await res.json();

          // Guard: workItemId MUST be present — if null, the DB insert failed
          if (!data.workItemId) {
            throw new Error('Work item was not created. Check server logs.');
          }

          setEscalationWorkItemId(data.workItemId);

          // Fetch the created work item for the escalation card
          const wiRes = await fetch(`/api/dept/${data.workItemId}`);
          if (wiRes.ok) {
            const wiData = await wiRes.json();
            setEscalationWorkItem(wiData.item ?? null);
          }

          // Refresh ticket state from DB — ensures ticket.status = 'escalated' drives UI
          await fetchTicketData();

          toast({
            title: '🚨 Ticket Escalated',
            description: `Work item created in ${decision.department}${decision.subteam ? ` — ${decision.subteam}` : ''} queue with ${decision.risk} priority.`,
          });
        } else {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || 'Failed to escalate ticket — no database record was created');
        }

      } else if (decision.decision === 'HUMAN_APPROVAL_REQUIRED') {
        // Module 2C: Create full approval request via API (org lookup + DB + Gmail notification)
        const res = await fetch('/api/approvals/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ticketId: ticket.id,
            emailId: email?.id ?? null,
            senderEmail: email?.sender ?? '',
            subject: email?.subject ?? '',
            body: (email?.body ?? '').slice(0, 1000),
            decisionCtx: {
              intent: decision.department ? `${ticket?.intent || email?.intent || 'Employee Request'}` : (ticket?.intent || email?.intent || 'Employee Request'),
              priority: ticket?.priority || email?.priority || 'medium',
              risk: decision.risk || 'Medium',
              reason: decision.reason || 'Requires manager approval.',
              confidence: decision.confidence || 50,
              department: decision.department,
              subteam: decision.subteam,
            },
          }),
        });

        if (res.ok) {
          const data = await res.json();
          // Fetch the created approval to get manager details
          let managerName: string | null = null;
          let managerEmail: string | null = null;
          if (data.approvalId) {
            try {
              const arRes = await fetch(`/api/approvals/${data.approvalId}`);
              if (arRes.ok) {
                const arData = await arRes.json();
                managerName = arData.approval?.manager_name ?? null;
                managerEmail = arData.approval?.manager_email ?? null;
              }
            } catch { /* non-fatal */ }
          }

          setApprovalResult({
            id: data.approvalId ?? '',
            managerName,
            managerEmail,
            status: 'pending',
          });

          toast({
            title: '✓ Approval Request Created',
            description: `Manager ${managerName ?? ''} notified. Request is pending.`,
          });
        } else {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || 'Failed to create approval request');
        }
      }

      await fetchTicketData();
      onEmailUpdated();
    } catch (err: any) {
      console.error('Decision action error:', err);
      toast({ title: 'Action failed', description: err.message || 'Could not execute decision action.', variant: 'destructive' });
    } finally {
      setIsActioning(false);
    }
  }

  async function sendResponse() {
    if (!ticket || !response) return;
    setIsSending(true);

    try {
      const sendRes = await fetch('/api/send-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticket_id: ticket.id,
          response_text: response.response,
          to_email: email?.sender || 'employee@company.com',
          subject: `Re: ${email?.subject || 'Your Support Request'}`,
        }),
      });

      if (!sendRes.ok) {
        const errData = await sendRes.json();
        throw new Error(errData.error || 'Failed to send email');
      }

      await supabase
        .from('responses')
        .update({ sent_at: new Date().toISOString() })
        .eq('id', response.id);

      const actionTaken = actions.map(a => a.recommended_action).join('; ');
      await storeResolvedCase(
        ticket.id,
        email?.subject || '',
        email?.body || '',
        response.response || '',
        ticket.intent || '',
        ticket.department || '',
        ticket.subteam || '',
        actionTaken
      );

      toast({
        title: 'Response sent',
        description: 'The email has been resolved and added to the knowledge base.',
      });

      await fetchTicketData();
      onEmailUpdated();
    } catch (err: any) {
      console.error('Error sending response:', err);
      toast({ title: 'Send failed', description: err.message || 'Could not send response.', variant: 'destructive' });
    } finally {
      setIsSending(false);
    }
  }

  const currentResponseText = isEditing ? editedResponse : (response?.response || generatedResponse);
  const canSend = response?.approved === true;
  const isPendingApproval = approval?.status === 'pending';
  const isRejected = approval?.status === 'rejected';
  const isResolved = email?.status === 'resolved';
  const hasResponse = !!(response?.response || generatedResponse);

  if (!email) {
    return (
      <div className="flex-1 flex items-center justify-center bg-muted/30">
        <div className="text-center text-muted-foreground">
          <Mail className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p>Select an email to view details</p>
        </div>
      </div>
    );
  }

  return (
    <ScrollArea className="flex-1 bg-muted/30">
      <div className="p-3 md:p-6 max-w-4xl mx-auto space-y-4 md:space-y-6">
        {/* Original Email */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-2">
              <div className="flex-1 min-w-0">
                <CardTitle className="text-base md:text-lg leading-tight">{email.subject}</CardTitle>
                <p className="text-xs md:text-sm text-muted-foreground mt-1 truncate">{email.sender}</p>
                <p className="text-[10px] md:text-xs text-muted-foreground mt-0.5">
                  Received {format(new Date(email.received_at), 'PPp')}
                </p>
              </div>
              <div className="flex items-center gap-1.5 flex-wrap">
                <Badge className={cn(priorityColors[email.priority], 'text-xs')}>
                  {email.priority}
                </Badge>
                <Badge variant="outline" className="text-xs">{email.status}</Badge>
                {isResolved && (
                  <Badge className="bg-green-100 text-green-700 gap-1 text-xs">
                    <CheckCircle2 className="h-3 w-3" />
                    Resolved
                  </Badge>
                )}
                {email.status === 'pending' && (
                  <Button size="sm" variant="outline" className="gap-1 h-7 text-xs" onClick={() => onReclassify(email)}>
                    {isProcessing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                    Classify
                  </Button>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2 mb-3">
              {email.intent && (
                <Badge variant="secondary" className="gap-1 text-xs">
                  <Tag className="h-3 w-3" />
                  {email.intent}
                </Badge>
              )}
              {email.department && (
                <Badge variant="outline" className="gap-1 text-xs">
                  <Building2 className="h-3 w-3" />
                  {email.department}
                </Badge>
              )}
              {email.subteam && (
                <Badge variant="outline" className="gap-1 text-xs bg-muted">
                  <Users className="h-3 w-3" />
                  {email.subteam}
                </Badge>
              )}
              {email.sentiment && (
                <Badge className={cn(sentimentColors[email.sentiment], 'gap-1 text-xs')}>
                  <Smile className="h-3 w-3" />
                  {email.sentiment}
                </Badge>
              )}
            </div>
            <Separator className="my-3" />
            <div className="text-sm leading-relaxed whitespace-pre-wrap break-words">{email.body}</div>
          </CardContent>
        </Card>

        {/* ── RESOLVED BANNER — shown when ticket.status = 'resolved' ──────── */}
        {isResolved && (
          <Card className="border-2 border-emerald-400 dark:border-emerald-600 bg-emerald-50 dark:bg-emerald-950/20">
            <CardContent className="pt-5 pb-5">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-full bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center shrink-0">
                  <CheckCircle2 className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
                </div>
                <div className="flex-1">
                  <p className="text-base font-bold text-emerald-800 dark:text-emerald-200">
                    Ticket Successfully Resolved
                  </p>
                  <p className="text-xs text-emerald-700/70 dark:text-emerald-300/70 mt-0.5">
                    A resolution email was sent to the employee. This ticket is now closed.
                  </p>
                  {ticket && (
                    <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
                      {ticket.resolved_by && (
                        <div>
                          <span className="text-muted-foreground">Resolved By</span>
                          <p className="font-semibold text-foreground">{ticket.resolved_by}</p>
                        </div>
                      )}
                      {ticket.resolved_at && (
                        <div>
                          <span className="text-muted-foreground">Resolved At</span>
                          <p className="font-semibold text-foreground">
                            {new Date(ticket.resolved_at).toLocaleString()}
                          </p>
                        </div>
                      )}
                      {ticket.department && (
                        <div>
                          <span className="text-muted-foreground">Department</span>
                          <p className="font-semibold text-foreground">{ticket.department}</p>
                        </div>
                      )}
                      {ticket.workflow_stage && (
                        <div>
                          <span className="text-muted-foreground">Stage</span>
                          <p className="font-semibold text-emerald-700 dark:text-emerald-300">{ticket.workflow_stage}</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* AI Classification Summary */}
        {ticket && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <BrainCircuit className="h-4 w-4 text-primary" />
                AI Classification
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                <div className="p-2 rounded bg-muted/50">
                  <p className="text-muted-foreground">Priority</p>
                  <p className={cn('font-medium', ticket.priority === 'critical' && 'text-red-600', ticket.priority === 'high' && 'text-amber-600')}>
                    {ticket.priority}
                  </p>
                </div>
                <div className="p-2 rounded bg-muted/50">
                  <p className="text-muted-foreground">Department</p>
                  <p className="font-medium">{ticket.department || '—'}</p>
                </div>
                <div className="p-2 rounded bg-muted/50">
                  <p className="text-muted-foreground">Subteam</p>
                  <p className="font-medium">{ticket.subteam || '—'}</p>
                </div>
                <div className="p-2 rounded bg-muted/50">
                  <p className="text-muted-foreground">Sentiment</p>
                  <p className="font-medium">{ticket.sentiment}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ═══════════════════════════════════════════════════════════════
            WORKFLOW STATUS CARD
            Shown ONLY when an approval_request record exists.
            ticketApproval is the single source of truth — never derive
            workflow state from the AI decision object here.
        ═══════════════════════════════════════════════════════════════ */}
        {ticketApproval && (
          <Card className={cn(
            'border-2 transition-all duration-300',
            ticketApproval.status === 'approved'
              ? 'border-emerald-400 dark:border-emerald-600'
              : ticketApproval.status === 'rejected'
              ? 'border-red-400 dark:border-red-600'
              : 'border-amber-400 dark:border-amber-600'
          )}>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                {ticketApproval.status === 'approved'
                  ? <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                  : ticketApproval.status === 'rejected'
                  ? <X className="h-4 w-4 text-red-500" />
                  : <Clock className="h-4 w-4 text-amber-500 animate-pulse" />}
                Workflow Status
                <Badge className={cn(
                  'ml-auto text-[10px] font-bold tracking-wide px-2 py-0.5',
                  ticketApproval.status === 'approved'
                    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-200'
                    : ticketApproval.status === 'rejected'
                    ? 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-200'
                    : 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-200'
                )}>
                  {ticketApproval.status === 'approved' ? '🟢 APPROVED'
                    : ticketApproval.status === 'rejected' ? '🔴 REJECTED'
                    : '🟡 PENDING APPROVAL'}
                </Badge>
              </CardTitle>
            </CardHeader>

            <CardContent className="space-y-4">
              {/* ── Workflow Timeline — canonical 5-stage, derived from tickets.workflow_stage ── */}
              {/* Always reads from getCanonicalWorkflowStages() — never hardcoded stage index.  */}
              <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-2">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">
                  Workflow Progress
                </p>
                {getCanonicalWorkflowStages({
                  ticketWorkflowStage: ticketWorkflowStage ?? ticket?.workflow_stage ?? null,
                  ticketStatus:        ticket?.status ?? null,
                  workItemStatus:      workItemStatus,
                  hasAssignee:         workItemHasAssignee,
                  acceptedAt:          workItemAcceptedAt,
                  approvalStatus:      ticketApproval.status,
                }).map((stage) => (
                  <div key={stage.id} className="flex items-center gap-2.5">
                    <div className={cn(
                      'w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 text-[9px] font-bold transition-all',
                      stage.done
                        ? 'border-emerald-500 bg-emerald-500 text-white'
                        : stage.active
                        ? 'border-amber-500 bg-amber-100 dark:bg-amber-900 text-amber-700 dark:text-amber-300 animate-pulse'
                        : 'border-muted-foreground/30 bg-transparent text-transparent'
                    )}>
                      {stage.done ? '✓' : stage.active ? '●' : ''}
                    </div>
                    <span className={cn(
                      'text-xs transition-all',
                      stage.done   ? 'text-emerald-600 dark:text-emerald-400 font-medium'
                      : stage.active ? 'text-amber-700 dark:text-amber-300 font-semibold'
                      : 'text-muted-foreground/60'
                    )}>
                      {stage.label}
                    </span>
                  </div>
                ))}
              </div>

              {/* ── CASE 3: APPROVED ─────────────────────────────────────── */}
              {ticketApproval.status === 'approved' && (() => {
                const isTicketResolved = ticket?.status === 'resolved' || ticket?.status === 'completed';
                return (
                  <div className={cn(
                    'rounded-xl border p-3 space-y-2',
                    isTicketResolved
                      ? 'border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-950/30'
                      : 'border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30'
                  )}>
                    <div className="flex items-center gap-2 text-xs font-bold text-emerald-700 dark:text-emerald-400">
                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                      {isTicketResolved ? 'Ticket Resolved ✓' : 'Approved ✓'}
                    </div>
                    <div className="space-y-1.5 text-xs">
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground w-36 shrink-0">Approved By</span>
                        <span className="font-semibold text-foreground truncate">
                          {ticketApproval.approved_by ?? ticketApproval.manager_name ?? '—'}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground w-36 shrink-0">Approved At</span>
                        <span className="text-foreground">
                          {ticketApproval.approved_at
                            ? new Date(ticketApproval.approved_at).toLocaleString()
                            : '—'}
                        </span>
                      </div>
                      {ticketApproval.department && (
                        <div className="flex items-center gap-2">
                          <span className="text-muted-foreground w-36 shrink-0">Assigned Department</span>
                          <span className="font-semibold text-foreground">{ticketApproval.department}</span>
                        </div>
                      )}
                      {ticketApproval.team_name && (
                        <div className="flex items-center gap-2">
                          <span className="text-muted-foreground w-36 shrink-0">Assigned Team</span>
                          <span className="font-semibold text-foreground">{ticketApproval.team_name}</span>
                        </div>
                      )}
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground w-36 shrink-0">Current Stage</span>
                        {isTicketResolved ? (
                          <span className="inline-flex items-center gap-1 font-semibold text-emerald-600 dark:text-emerald-400">
                            <CheckCircle2 className="h-3 w-3" /> Resolved
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 font-semibold text-amber-600 dark:text-amber-400">
                            <Clock className="h-3 w-3" /> Department Processing
                          </span>
                        )}
                      </div>
                    </div>
                    {!isTicketResolved && (
                      <a
                        href={`/approvals/${ticketApproval.id}`}
                        className="flex items-center gap-1.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400 hover:underline"
                      >
                        <ArrowRight className="h-3 w-3" />
                        View Department Queue
                      </a>
                    )}
                  </div>
                );
              })()}

              {/* ── CASE 2: PENDING ──────────────────────────────────────── */}
              {ticketApproval.status === 'pending' && (
                <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 p-3 space-y-2">
                  <div className="flex items-center gap-2 text-xs font-bold text-amber-700 dark:text-amber-300">
                    <Clock className="h-3.5 w-3.5 shrink-0" />
                    Approval Request Sent · Awaiting Manager
                  </div>
                  <div className="space-y-1.5 text-xs">
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground w-36 shrink-0">Manager</span>
                      <span className="font-semibold text-foreground truncate">
                        {ticketApproval.manager_name ?? 'Assigned from org directory'}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground w-36 shrink-0">Manager Email</span>
                      <span className="text-primary truncate">{ticketApproval.manager_email ?? '—'}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground w-36 shrink-0">Requested At</span>
                      <span className="text-foreground">
                        {new Date(ticketApproval.created_at).toLocaleString()}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground w-36 shrink-0">Status</span>
                      <span className="inline-flex items-center gap-1 font-semibold text-amber-600 dark:text-amber-400">
                        <Clock className="h-3 w-3" /> Pending
                      </span>
                    </div>
                  </div>
                  <a
                    href={`/approvals/${ticketApproval.id}`}
                    className="flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline"
                  >
                    <ArrowRight className="h-3 w-3" />
                    View Approval Status
                  </a>
                </div>
              )}

              {/* ── CASE 4: REJECTED ─────────────────────────────────────── */}
              {ticketApproval.status === 'rejected' && (
                <div className="rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 p-3 space-y-2">
                  <div className="flex items-center gap-2 text-xs font-bold text-red-700 dark:text-red-400">
                    <X className="h-3.5 w-3.5 shrink-0" />
                    Rejected
                  </div>
                  <div className="space-y-1.5 text-xs">
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground w-36 shrink-0">Rejected By</span>
                      <span className="font-semibold text-foreground truncate">
                        {ticketApproval.rejected_by ?? ticketApproval.manager_name ?? '—'}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground w-36 shrink-0">Rejected At</span>
                      <span className="text-foreground">
                        {ticketApproval.rejected_at
                          ? new Date(ticketApproval.rejected_at).toLocaleString()
                          : ticketApproval.approved_at
                          ? new Date(ticketApproval.approved_at).toLocaleString()
                          : '—'}
                      </span>
                    </div>
                    {ticketApproval.comments && (
                      <div className="flex items-start gap-2">
                        <span className="text-muted-foreground w-36 shrink-0">Reason</span>
                        <span className="text-red-700 dark:text-red-300">{ticketApproval.comments}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              <p className="text-[10px] text-muted-foreground">
                🔄 Live workflow state · Updated:{' '}
                {new Date((ticketApproval as any).updated_at ?? ticketApproval.created_at).toLocaleString()}
              </p>
            </CardContent>
          </Card>
        )}

        {/* ═══════════════════════════════════════════════════════════════
            TWO-TAB AI MODULE
            Tab 1: Resolution Analysis (engineer guidance)
            Tab 2: Resolution Draft    (customer communication)
            NOTE: When ticket is resolved, Tab 2 is COMPLETELY unmounted.
        ═══════════════════════════════════════════════════════════════ */}
        {(ticket || decision || isAnalyzing) && (() => {
          const isTicketResolved = ticket?.status === 'resolved' || ticket?.status === 'completed';
          return (
            <Card className="overflow-hidden">
              {/* ── Tab Switcher ─────────────────────────────────────────── */}
              <div className="flex border-b border-border bg-muted/30">
                <button
                  id="tab-resolution-analysis"
                  onClick={() => setActiveTab('analysis')}
                  className={cn(
                    'flex items-center gap-2 px-4 py-3 text-xs font-semibold transition-all border-b-2 -mb-px flex-1 justify-center',
                    activeTab === 'analysis'
                      ? 'border-primary text-primary bg-background'
                      : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50'
                  )}
                >
                  <BrainCircuit className="h-3.5 w-3.5" />
                  {isTicketResolved ? 'Resolution Summary' : 'Resolution Analysis'}
                  {!isTicketResolved && (
                    <span className="text-[9px] font-bold uppercase tracking-wide opacity-60 hidden sm:inline">Engineer Only</span>
                  )}
                </button>
                {/* Resolution Draft tab — NEVER shown after ticket is resolved */}
                {!isTicketResolved && (
                  <button
                    id="tab-resolution-draft"
                    onClick={() => setActiveTab('draft')}
                    className={cn(
                      'flex items-center gap-2 px-4 py-3 text-xs font-semibold transition-all border-b-2 -mb-px flex-1 justify-center relative',
                      activeTab === 'draft'
                        ? 'border-primary text-primary bg-background'
                        : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50'
                    )}
                  >
                    <FileEdit className="h-3.5 w-3.5" />
                    Resolution Draft
                    {!ticketApproval?.status || ticketApproval?.status !== 'approved' ? (
                      <span className="inline-flex items-center gap-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-600 dark:text-amber-400 hidden sm:inline-flex">
                        🔒 Locked
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-0.5 text-[9px] font-bold uppercase tracking-wide text-emerald-600 dark:text-emerald-400 hidden sm:inline-flex">
                        ✓ Ready
                      </span>
                    )}
                  </button>
                )}
              </div>

              {/* ── Tab Content ──────────────────────────────────────────── */}
              <CardContent className="p-4">
                {/* Analysis tab — always rendered; handles resolved state internally */}
                {(activeTab === 'analysis' || isTicketResolved) && (
                  <ResolutionAnalysisPanel
                    email={email}
                    ticket={ticket}
                    decision={decision}
                    decisionLog={decisionLog}
                    actions={actions}
                    similarCases={similarCases}
                    ticketApproval={ticketApproval}
                    isAnalyzing={isAnalyzing}
                    isActioning={isActioning}
                    onExecuteDecision={executeDecisionAction}
                    escalationWorkItemId={escalationWorkItemId}
                    escalationWorkItem={escalationWorkItem}
                  />
                )}

                {/* Draft tab — ONLY rendered when ticket is NOT resolved */}
                {activeTab === 'draft' && !isTicketResolved && (
                  <ResolutionDraftPanel
                    email={email}
                    ticket={ticket}
                    ticketApproval={ticketApproval}
                    onSent={() => { fetchTicketData(); onEmailUpdated(); }}
                  />
                )}
              </CardContent>
            </Card>
          );
        })()}


        {/* ═══════════════════════════════════════════════════════════════
            INITIAL AI ASSESSMENT (collapsible reference)
            Shown only AFTER a workflow record exists, so agents can
            always see the original AI recommendation for context.
            This is historical — the Workflow Status card above
            is the live source of truth.
        ═══════════════════════════════════════════════════════════════ */}

        {ticketApproval && decision && (

          <Card className="border border-border/60">
            <CardHeader
              className="pb-2 cursor-pointer select-none"
              onClick={() => setShowAiAssessment((prev) => !prev)}
            >
              <CardTitle className="text-sm flex items-center gap-2 text-muted-foreground">
                <BrainCircuit className="h-4 w-4" />
                Initial AI Assessment
                <span className="text-[10px] ml-auto opacity-60">
                  {showAiAssessment ? '▲ Hide' : '▼ Show'}
                </span>
              </CardTitle>
            </CardHeader>
            {showAiAssessment && (
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="p-2.5 rounded-lg bg-muted/40 space-y-1">
                    <p className="text-muted-foreground font-medium">AI Decision</p>
                    <p className={cn(
                      'font-bold',
                      decision.decision === 'ESCALATE' ? 'text-red-600 dark:text-red-400'
                        : decision.decision === 'HUMAN_APPROVAL_REQUIRED' ? 'text-amber-600 dark:text-amber-400'
                        : 'text-emerald-600 dark:text-emerald-400'
                    )}>
                      {decision.decision === 'AUTO_RESPONSE' ? 'AUTO RESPONSE'
                        : decision.decision === 'HUMAN_APPROVAL_REQUIRED' ? 'APPROVAL REQUIRED'
                        : 'ESCALATE'}
                    </p>
                  </div>
                  <div className="p-2.5 rounded-lg bg-muted/40 space-y-1">
                    <p className="text-muted-foreground font-medium">Confidence</p>
                    <p className="font-bold">{decision.confidence}%</p>
                  </div>
                </div>
                {decision.reason && (
                  <p className="text-xs text-muted-foreground bg-muted/30 rounded-lg p-2.5 leading-relaxed">
                    {decision.reason}
                  </p>
                )}
                {decision.department && (
                  <p className="text-xs text-muted-foreground">
                    <span className="font-medium">AI Suggested Route:</span>{' '}
                    {decision.department}{decision.subteam ? ` — ${decision.subteam}` : ''}
                  </p>
                )}
                <p className="text-[10px] text-muted-foreground/50 italic">
                  This is the initial AI recommendation. The Workflow Status card above supersedes it.
                </p>
              </CardContent>
            )}
          </Card>
        )}

        {/* Email Thread / History for Resolved */}
        {isResolved && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <History className="h-4 w-4 text-primary" />
                Email Thread History
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Original request */}
              <div className="flex gap-3">
                <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center shrink-0">
                  <Inbox className="h-4 w-4 text-blue-600" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-medium">{email.sender}</span>
                    <span className="text-[10px] text-muted-foreground">{format(new Date(email.received_at), 'PPp')}</span>
                  </div>
                  <div className="p-3 rounded-lg bg-muted/50 text-sm whitespace-pre-wrap break-words">
                    {email.body}
                  </div>
                </div>
              </div>

              {/* AI Classification */}
              {ticket && (
                <div className="flex gap-3">
                  <div className="w-8 h-8 rounded-full bg-purple-100 flex items-center justify-center shrink-0">
                    <BrainCircuit className="h-4 w-4 text-purple-600" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-medium">AI Classification</span>
                      <span className="text-[10px] text-muted-foreground">{format(new Date(ticket.created_at), 'PPp')}</span>
                    </div>
                    <div className="p-3 rounded-lg bg-purple-50 text-sm">
                      <p><strong>Intent:</strong> {ticket.intent}</p>
                      <p><strong>Department:</strong> {ticket.department} / {ticket.subteam}</p>
                      <p><strong>Priority:</strong> {ticket.priority}</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Response generation */}
              {response && (
                <div className="flex gap-3">
                  <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center shrink-0">
                    <Reply className="h-4 w-4 text-green-600" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-medium">IntelliDesk Support Team</span>
                      <span className="text-[10px] text-muted-foreground">
                        {response.sent_at ? format(new Date(response.sent_at), 'PPp') : 'Draft'}
                      </span>
                    </div>
                    <div className="p-3 rounded-lg bg-green-50 text-sm whitespace-pre-wrap break-words">
                      {response.response}
                    </div>
                  </div>
                </div>
              )}

              {/* Sent emails from send-email function */}
              {sentEmails.map((sent) => (
                <div key={sent.id} className="flex gap-3">
                  <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center shrink-0">
                    <Send className="h-4 w-4 text-green-600" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-medium">Sent to {sent.to_email}</span>
                      <span className="text-[10px] text-muted-foreground">{format(new Date(sent.sent_at), 'PPp')}</span>
                    </div>
                    <div className="p-3 rounded-lg border border-green-200 bg-green-50/50 text-sm">
                      <p className="font-medium text-xs mb-1">{sent.subject}</p>
                      <p className="whitespace-pre-wrap break-words">{sent.body}</p>
                    </div>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>

      {/* Approval Dialog */}
      <Dialog open={showApprovalDialog} onOpenChange={setShowApprovalDialog}>
        <DialogContent className="max-w-sm mx-4">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <ShieldCheck className="h-4 w-4" />
              Approve Response
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 pt-2">
            <p className="text-xs text-muted-foreground">Review the response and approve or reject.</p>
            <div className="p-2 rounded bg-muted/50 text-xs max-h-32 overflow-auto whitespace-pre-wrap break-words">
              {currentResponseText}
            </div>
            <div className="space-y-2">
              <label className="text-xs text-muted-foreground">Notes (optional)</label>
              <textarea
                value={approvalNotes}
                onChange={(e) => setApprovalNotes(e.target.value)}
                className="w-full text-xs p-2 rounded border resize-none"
                rows={2}
                placeholder="Add feedback or notes..."
              />
            </div>
            <div className="flex gap-2">
              <Button size="sm" className="flex-1 gap-1 text-xs" onClick={() => submitApproval('approved')} disabled={isSubmittingApproval}>
                {isSubmittingApproval ? <Loader2 className="h-3 w-3 animate-spin" /> : <ThumbsUp className="h-3 w-3" />}
                Approve
              </Button>
              <Button size="sm" variant="outline" className="flex-1 gap-1 text-xs" onClick={() => submitApproval('rejected')} disabled={isSubmittingApproval}>
                <ThumbsDown className="h-3 w-3" />
                Reject
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </ScrollArea>
  );
}
