import { supabase } from './supabase';
import type { DecisionResult, DecisionType, RiskLevel, DecisionStats, EmployeeProfile } from './types';
import { lookupEmployeeByEmail, buildOrgContextPrompt } from './org-directory';

// Base URL for API routes — works in both browser and server contexts
const API_BASE = typeof window !== 'undefined' ? '' : (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000');

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

// ─── Public Interfaces ────────────────────────────────────────────────────────

export interface AgentResult {
  intent: string;
  intentConfidence: number;
  priority: string;
  priorityConfidence: number;
  priorityReasoning: string;
  sentiment: string;
  sentimentConfidence: number;
  sentimentScore: number;
  department: string;
  departmentConfidence: number;
  departmentReasoning: string;
  subteam: string;
  subteamConfidence: number;
  subteamReasoning: string;
}

export interface KnowledgeMatch {
  type: 'policy' | 'faq' | 'template';
  title: string;
  content: string;
  department: string | null;
  category: string | null;
  relevance: number;
}

export interface RagResult {
  id: string;
  title: string;
  content: string;
  document_type: string;
  similarity: number;
  metadata?: Record<string, unknown>;
}

export type ResponseTone = 'professional' | 'friendly' | 'empathetic' | 'formal' | 'concise';

// ─── Gemini API Utilities ─────────────────────────────────────────────────────

// Module-level cache for the Gemini key (undefined = not yet fetched, null = confirmed missing)
let _cachedGeminiKey: string | null | undefined = undefined;


/**
 * Reads the Gemini API key stored by the user via the Settings page.
 * Caches the result to avoid repeated DB queries per page load.
 */
async function getGeminiApiKey(): Promise<string | null> {
  if (_cachedGeminiKey !== undefined) return _cachedGeminiKey;
  try {
    const { data } = await supabase
      .from('ai_settings')
      .select('gemini_api_key')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    _cachedGeminiKey = (data?.gemini_api_key ?? null) as string | null;
    return _cachedGeminiKey;
  } catch {
    _cachedGeminiKey = null;
    return null;
  }
}

/**
 * Call this after saving new AI settings so the next agent call fetches fresh key.
 */
export function invalidateGeminiKeyCache(): void {
  _cachedGeminiKey = undefined;
}

/**
 * Calls Gemini 1.5 Flash for text generation.
 * Returns null on any failure — callers must handle gracefully.
 */
async function callGeminiFlash(
  prompt: string,
  apiKey: string,
  temperature = 0.7
): Promise<string | null> {
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature,
            maxOutputTokens: 1024,
            candidateCount: 1,
          },
        }),
      }
    );
    if (!res.ok) {
      const errText = await res.text();
      console.error('Gemini Flash error:', res.status, errText);
      return null;
    }
    const data = await res.json();
    return data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null;
  } catch (err) {
    console.error('Gemini Flash call failed:', err);
    return null;
  }
}

/**
 * Generates a 768-dimensional text embedding via the local Next.js API route.
 */
export async function generateEmbeddingViaEdge(text: string): Promise<number[] | null> {
  try {
    const res = await fetch(`${API_BASE}/api/generate-embedding`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: text.slice(0, 2000) }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.embedding || null;
  } catch (err) {
    console.error('Embedding generation failed:', err);
    return null;
  }
}

// ─── Classification Agents ────────────────────────────────────────────────────

/**
 * Calls the local classify-all API route.
 * Uses Gemini when GEMINI_API_KEY is set, falls back to rule-based matching.
 */
export async function classifyAll(subject: string, body: string): Promise<AgentResult | null> {
  try {
    const res = await fetch(`${API_BASE}/api/classify-all`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subject, body }),
    });
    if (!res.ok) return null;
    return (await res.json()) as AgentResult;
  } catch {
    return null;
  }
}

/**
 * Resolves an employee's full org profile from their email address.
 * Used by all agents to replace hardcoded routing with data-driven context.
 * Returns null if the sender is not found in the Organization Directory.
 */
export async function enrichEmailWithOrgContext(
  senderEmail: string
): Promise<EmployeeProfile | null> {
  return lookupEmployeeByEmail(senderEmail);
}

/**
 * Main orchestrator: classifies email, creates ticket, generates actions, fires notifications.
 * Also resolves sender org context from the Organization Directory.
 */
export async function runAllAgents(
  emailId: string,
  subject: string,
  body: string,
  senderEmail?: string
): Promise<AgentResult | null> {
  // ── Step 0: Resolve sender org context from Organization Directory ──────────
  let orgProfile: EmployeeProfile | null = null;
  if (senderEmail) {
    orgProfile = await lookupEmployeeByEmail(senderEmail);
    if (orgProfile) {
      console.log(
        `[OrgDirectory] Resolved sender: ${orgProfile.employee_name} | ` +
        `Dept: ${orgProfile.department?.name ?? 'Unknown'} | ` +
        `Team: ${orgProfile.team?.name ?? 'Unknown'} | ` +
        `Manager: ${orgProfile.manager?.name ?? 'Not assigned'}`
      );
    }
  }

  const result = await classifyAll(subject, body);
  if (!result) {
    console.error('Classification failed for email:', emailId);
    return null;
  }

  // ── Override department/team from org directory when available ───────────────
  // NOTE: Org directory overrides are suppressed for sensitive-issue guard results
  // to prevent wrong department overriding the safety classification.
  const isSensitiveGuard = (result as any).classified_by === 'sensitive_guard';
  if (!isSensitiveGuard) {
    if (orgProfile?.department?.name) {
      result.department = orgProfile.department.name;
      result.departmentReasoning = `Resolved from Organization Directory — employee is in ${orgProfile.department.name} (${orgProfile.department.code})`;
    }
    if (orgProfile?.team?.name) {
      result.subteam = orgProfile.team.name;
      result.subteamReasoning = `Resolved from Organization Directory — employee belongs to team ${orgProfile.team.name}`;
    }
  }

  // ── Step 1: Run Decision Agent — get authoritative routing BEFORE writing to DB ─
  // The Decision Agent has inviolable DECISION_RULES (harassment → ESCALATE/Critical/HR)
  // that take precedence over classifyAll. We apply its overrides to result BEFORE
  // writing the email and ticket records so the DB is correct from the start.
  let decisionResult: DecisionResult | null = null;
  try {
    decisionResult = await runDecisionAgent(
      result.intent,
      result.priority,
      result.sentiment,
      result.department,
      result.subteam,
      subject,
      body
    );

    if (decisionResult) {
      // Apply decision-agent department/subteam overrides to result
      if (decisionResult.department) {
        result.department = decisionResult.department;
        result.departmentReasoning = `Decision Agent override: ${decisionResult.reason}`;
      }
      if (decisionResult.subteam) {
        result.subteam = decisionResult.subteam;
        result.subteamReasoning = `Decision Agent override — ${decisionResult.subteam}`;
      }
      // Upgrade priority when decision agent flags Critical or High risk
      if (decisionResult.risk === 'Critical') {
        result.priority = 'critical';
        result.priorityReasoning = `Decision Agent override: ${decisionResult.reason}`;
      } else if (decisionResult.risk === 'High' && result.priority === 'medium') {
        result.priority = 'high';
        result.priorityReasoning = `Decision Agent override: High risk`;
      }
    }
  } catch (decisionErr) {
    console.error('[runAllAgents] Decision agent failed (non-fatal):', decisionErr);
    // Continue — do not block ticket creation if decision agent errors
  }

  // ── Step 2: Write the CORRECTED classification to the email record ───────────
  const { error: updateError } = await supabase
    .from('emails')
    .update({
      status: 'processing',
      intent: result.intent,
      priority: result.priority,
      sentiment: result.sentiment,
      department: result.department,
      subteam: result.subteam,
    })
    .eq('id', emailId);

  if (updateError) {
    console.error('Error updating email:', updateError);
  }

  // ── Step 3: Create ticket with CORRECTED values ──────────────────────────────
  let ticketStatus = 'open';
  if (decisionResult?.decision === 'ESCALATE') ticketStatus = 'escalated';
  else if (decisionResult?.decision === 'AUTO_RESPONSE') ticketStatus = 'processing';

  const { data: ticketData, error: ticketError } = await supabase
    .from('tickets')
    .insert({
      email_id: emailId,
      intent: result.intent,
      department: result.department,
      subteam: result.subteam,
      priority: result.priority,
      sentiment: result.sentiment,
      status: ticketStatus,
    })
    .select()
    .single();

  if (ticketError) {
    console.error('Error creating ticket:', ticketError);
  }

  // ── Structured classification logging ────────────────────────────────────────
  const ticketLogId = ticketData?.id ?? emailId;
  console.log(
    `[AI_CLASSIFICATION] ticketId=${ticketLogId} emailId=${emailId} ` +
    `intent="${result.intent}" department="${result.department}" subteam="${result.subteam}" ` +
    `priority="${result.priority}" sentiment="${result.sentiment}" ` +
    `decision="${decisionResult?.decision ?? 'PENDING'}" ` +
    `risk="${decisionResult?.risk ?? 'Unknown'}" confidence=${decisionResult?.confidence ?? 0}`
  );
  if (decisionResult?.department) {
    console.log(
      `[ROUTING] ticketId=${ticketLogId} department="${result.department}" subteam="${result.subteam}" ` +
      `decision="${decisionResult.decision}" assignedTeam="${decisionResult.department}/${decisionResult.subteam ?? ''}"`
    );
  }

  // ── Step 4: Store decision log immediately (so inbox loads persisted data) ───
  if (ticketData && decisionResult) {
    try {
      await storeDecisionLog(ticketData.id, decisionResult);
      console.log(`[runAllAgents] Decision log stored for ticket ${ticketData.id} — ${decisionResult.decision}`);
    } catch (logErr) {
      console.error('[runAllAgents] Decision log storage failed (non-fatal):', logErr);
    }
  }

  // Generate recommended actions
  if (ticketData) {
    await generateActionsForIntent(
      ticketData.id,
      result.intent,
      result.department,
      result.subteam
    );
  }

  // ── Step 5: Fire correct notifications based on ACTUAL decision ──────────────
  const notifPromises: Promise<void>[] = [];

  // New email notification (always)
  notifPromises.push(
    Promise.resolve(
      supabase.from('notifications').insert({
        type: 'new_email',
        title: 'New Support Request',
        message: `"${subject}" classified as ${result.intent} — ${result.department} (${result.priority} priority)`,
        ticket_id: ticketData?.id ?? null,
        email_id: emailId,
        read: false,
      }).then(() => undefined)
    )
  );

  if (decisionResult?.decision === 'ESCALATE') {
    // ESCALATE: critical notification
    notifPromises.push(
      Promise.resolve(
        supabase.from('notifications').insert({
          type: 'critical',
          title: `🚨 ESCALATE — ${decisionResult.risk || 'Critical'} Risk`,
          message: `"${subject}" escalated to ${decisionResult.department || result.department} — ${decisionResult.subteam || result.subteam}. Reason: ${decisionResult.reason || 'Requires immediate specialist attention.'}`,
          ticket_id: ticketData?.id ?? null,
          email_id: emailId,
          read: false,
        }).then(() => undefined)
      )
    );

    // ESCALATE: create approval request so workflow UI is driven correctly
    if (ticketData) {
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
      let resolvedSenderEmail = senderEmail || '';
      if (!resolvedSenderEmail && emailId) {
        try {
          const { data: emailRow } = await supabase
            .from('emails')
            .select('sender')
            .eq('id', emailId)
            .maybeSingle();
          resolvedSenderEmail = (emailRow as any)?.sender ?? '';
        } catch { /* non-fatal */ }
      }
      if (resolvedSenderEmail) {
        fetch(`${appUrl}/api/approvals/create`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ticketId: ticketData.id,
            emailId,
            senderEmail: resolvedSenderEmail,
            subject,
            body,
            decisionCtx: {
              intent: result.intent,
              priority: result.priority,
              risk: decisionResult.risk,
              reason: decisionResult.reason,
              confidence: decisionResult.confidence,
              department: decisionResult.department || result.department,
              subteam: decisionResult.subteam || result.subteam,
            },
          }),
        }).catch((err) => console.warn('[runAllAgents] ESCALATE approval create failed (non-fatal):', err));
      }
    }

  } else if (decisionResult?.decision === 'HUMAN_APPROVAL_REQUIRED') {
    // HUMAN_APPROVAL_REQUIRED: approval notification
    notifPromises.push(
      Promise.resolve(
        supabase.from('notifications').insert({
          type: 'approval_required',
          title: '⏳ Approval Required',
          message: `"${subject}" requires manager approval before sending. Confidence: ${decisionResult.confidence || '—'}%.`,
          ticket_id: ticketData?.id ?? null,
          email_id: emailId,
          read: false,
        }).then(() => undefined)
      )
    );

    // Create approval request
    if (ticketData) {
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
      let resolvedSenderEmail = senderEmail || '';
      if (!resolvedSenderEmail && emailId) {
        try {
          const { data: emailRow } = await supabase
            .from('emails')
            .select('sender')
            .eq('id', emailId)
            .maybeSingle();
          resolvedSenderEmail = (emailRow as any)?.sender ?? '';
        } catch { /* non-fatal */ }
      }
      if (resolvedSenderEmail) {
        fetch(`${appUrl}/api/approvals/create`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ticketId: ticketData.id,
            emailId,
            senderEmail: resolvedSenderEmail,
            subject,
            body,
            decisionCtx: {
              intent: result.intent,
              priority: result.priority,
              risk: decisionResult.risk || 'Medium',
              reason: decisionResult.reason || 'Requires manager approval.',
              confidence: decisionResult.confidence || 50,
              department: decisionResult.department || result.department,
              subteam: decisionResult.subteam || result.subteam,
            },
          }),
        }).catch((err) => console.warn('[runAllAgents] Approval create failed (non-fatal):', err));
      }
    }

  } else if (result.priority === 'critical') {
    // Critical priority for AUTO_RESPONSE cases
    notifPromises.push(
      Promise.resolve(
        supabase.from('notifications').insert({
          type: 'critical',
          title: '🚨 Critical Priority Alert',
          message: `CRITICAL: "${subject}" requires immediate attention — ${result.department} / ${result.subteam}`,
          ticket_id: ticketData?.id ?? null,
          email_id: emailId,
          read: false,
        }).then(() => undefined)
      )
    );
  }

  Promise.allSettled(notifPromises).catch((err) =>
    console.error('Notification fire failed:', err)
  );

  return result;
}

// ─── Action Recommendation Agent ──────────────────────────────────────────────

async function generateActionsForIntent(
  ticketId: string,
  intent: string,
  department: string,
  subteam: string
): Promise<void> {
  const actions = getActionsForIntent(intent, department, subteam);
  for (const action of actions) {
    await supabase.from('actions').insert({
      ticket_id: ticketId,
      recommended_action: action,
    });
  }
}

export function getActionsForIntent(
  intent: string,
  department: string,
  subteam: string
): string[] {
  const n = intent.toLowerCase();

  if (n.includes('password') || n.includes('reset'))
    return [
      'Verify employee identity through registered email or employee ID',
      `Send password reset instructions via secure channel — assign to ${subteam}`,
      'Escalate to IAM team if reset fails after 3 attempts',
    ];

  if (n.includes('leave') || n.includes('vacation') || n.includes('time off'))
    return [
      'Check employee leave balance in HR system',
      'Forward leave request to line manager for approval',
      'Update leave management system once approval is confirmed',
    ];

  if (n.includes('sap') || n.includes('erp'))
    return [
      'Validate manager approval for SAP / ERP access request',
      `Forward provisioning request to ${subteam}`,
      'Create formal access request ticket and track completion',
    ];

  if (n.includes('laptop') || n.includes('computer') || n.includes('hardware'))
    return [
      'Collect device serial number and model from employee',
      `Assign to ${subteam} for remote diagnostics or physical inspection`,
      'Schedule replacement if device is under warranty and unrepairable',
    ];

  if (n.includes('insurance') || n.includes('medical claim') || n.includes('health'))
    return [
      'Review current benefits policy and confirm employee coverage details',
      `Forward claim to ${subteam} for processing`,
      'Provide claim submission instructions and required documents checklist',
    ];

  if (n.includes('payroll') || n.includes('salary') || n.includes('pay'))
    return [
      'Verify payroll cycle and payment records for the affected period',
      'Open finance investigation ticket for discrepancy review',
      `Escalate to ${subteam} if issue spans multiple payroll cycles`,
    ];

  if (n.includes('vpn') || n.includes('remote access'))
    return [
      'Confirm employee remote work eligibility and manager approval',
      `Provision VPN credentials through ${subteam}`,
      'Send VPN setup guide and security policy acknowledgment form',
    ];

  if (n.includes('wifi') || n.includes('network') || n.includes('internet'))
    return [
      'Check network status dashboard and known outages for reported location',
      `Assign ${subteam} to run diagnostics on connectivity issue`,
      'Provide temporary workaround (mobile hotspot) if outage is extended',
    ];

  if (n.includes('email') || n.includes('outlook') || n.includes('mail'))
    return [
      'Check mailbox quota and recent authentication activity',
      `Reset email client configuration via ${subteam}`,
      'Escalate to messaging team if server-side issue is detected',
    ];

  if (n.includes('software') || n.includes('install') || n.includes('license'))
    return [
      'Verify software license availability in asset management system',
      `Approve installation through ${subteam}`,
      'Deploy via centralized endpoint management within 24 hours',
    ];

  if (n.includes('training') || n.includes('course') || n.includes('certification'))
    return [
      'Check training budget availability and employee eligibility level',
      'Forward request to Learning & Development team for scheduling',
      'Update LMS enrollment upon confirmation',
    ];

  if (n.includes('resignation') || n.includes('quit') || n.includes('notice'))
    return [
      'Acknowledge resignation formally and confirm notice period dates',
      'Initiate exit checklist including asset return and knowledge handover',
      'Schedule exit interview with HR Business Partner',
    ];

  if (n.includes('promotion') || n.includes('career'))
    return [
      'Review employee performance history and eligibility against promotion criteria',
      'Forward assessment to department head and HR Business Partner',
      'Schedule structured career development discussion with line manager',
    ];

  if (n.includes('transfer') || n.includes('relocation'))
    return [
      'Verify transfer policy eligibility and available positions',
      'Obtain written approvals from current and receiving managers',
      'Coordinate with HR for relocation support package if applicable',
    ];

  if (n.includes('reimbursement') || n.includes('expense') || n.includes('travel'))
    return [
      'Verify all submitted expenses comply with travel and expense policy',
      'Obtain required approval sign-offs per approval hierarchy',
      'Process reimbursement through finance within 7 business days of approval',
    ];

  if (n.includes('id card') || n.includes('badge') || n.includes('access card'))
    return [
      'Verify employee identity and current department assignment',
      'Immediately deactivate lost or stolen card in access control system',
      'Issue replacement card through facilities team — typical turnaround 1–2 days',
    ];

  if (n.includes('meeting room') || n.includes('conference'))
    return [
      'Check room availability for requested date, time and duration',
      'Book room and send calendar invites to all attendees',
      'Arrange AV and catering support if required for the session',
    ];

  if (n.includes('mfa') || n.includes('two factor') || n.includes('authenticator'))
    return [
      'Verify all registered MFA methods on the employee account',
      'Guide employee through MFA reset and re-enrollment process',
      'Issue temporary access bypass with manager approval for business-critical access',
    ];

  // Default fallback
  return [
    `Categorize request under ${department} — ${subteam} and acknowledge employee`,
    `Assign to ${subteam} for initial assessment and triage`,
    'Set follow-up reminder within 24 hours and update employee on progress',
  ];
}

// ─── Knowledge Agent (RAG — Structured KB) ───────────────────────────────────

export async function findKnowledgeMatches(
  intent: string,
  department: string,
  subject: string,
  body: string
): Promise<KnowledgeMatch[]> {
  const matches: KnowledgeMatch[] = [];
  const text = (subject + ' ' + body).toLowerCase();

  try {
    const [{ data: policies }, { data: faqs }, { data: templates }] = await Promise.all([
      supabase.from('kb_policies').select('*'),
      supabase.from('kb_faqs').select('*'),
      supabase.from('response_templates').select('*').eq('active', true),
    ]);

    if (policies) {
      for (const policy of policies) {
        let score = 0;
        if (policy.department && policy.department === department) score += 3;
        if (policy.category && text.includes(policy.category.toLowerCase())) score += 2;
        if (policy.keywords) {
          for (const kw of policy.keywords) {
            if (text.includes(kw.toLowerCase())) score += 1;
          }
        }
        if (policy.title.toLowerCase().includes(intent.toLowerCase())) score += 2;
        if (score > 0) {
          matches.push({
            type: 'policy',
            title: policy.title,
            content: policy.content || '',
            department: policy.department,
            category: policy.category,
            relevance: score,
          });
        }
      }
    }

    if (faqs) {
      for (const faq of faqs) {
        let score = 0;
        if (faq.department && faq.department === department) score += 3;
        if (faq.category && text.includes(faq.category.toLowerCase())) score += 2;
        if (faq.keywords) {
          for (const kw of faq.keywords) {
            if (text.includes(kw.toLowerCase())) score += 1;
          }
        }
        if (faq.question.toLowerCase().includes(intent.toLowerCase())) score += 2;
        if (score > 0) {
          matches.push({
            type: 'faq',
            title: faq.question,
            content: faq.answer,
            department: faq.department,
            category: faq.category,
            relevance: score,
          });
        }
      }
    }

    if (templates) {
      for (const tmpl of templates) {
        let score = 0;
        if (tmpl.intent && tmpl.intent === intent) score += 5;
        if (tmpl.department && tmpl.department === department) score += 3;
        if (tmpl.subteam && text.includes(tmpl.subteam.toLowerCase())) score += 1;
        if (score > 0) {
          matches.push({
            type: 'template',
            title: tmpl.name,
            content: tmpl.template || '',
            department: tmpl.department,
            category: tmpl.subteam,
            relevance: score,
          });
        }
      }
    }

    matches.sort((a, b) => b.relevance - a.relevance);
    return matches.slice(0, 5);
  } catch (err) {
    console.error('Error finding knowledge matches:', err);
    return [];
  }
}

/**
 * Calls the local semantic-search API route which uses pgvector cosine similarity.
 * Falls back to Jaccard text matching if embeddings are not yet available.
 */
export async function semanticSearchRAG(query: string, limit = 5): Promise<RagResult[]> {
  try {
    const res = await fetch(`${API_BASE}/api/semantic-search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, threshold: 0.25, limit }),
    });
    if (!res.ok) return [];
    const data = await res.json();
    const chunks = data.results || [];
    return chunks.map((c: any) => ({
      id: c.id,
      title: c.title || '',
      content: c.chunk_text || c.content || '',
      document_type: c.document_type || 'document',
      similarity: c.similarity || 0,
    }));
  } catch (err) {
    console.error('RAG semantic search error:', err);
    return [];
  }
}

// ─── Response Generator (Gemini-powered with structured fallback) ─────────────

const toneInstructions: Record<ResponseTone, string> = {
  professional: 'professional and courteous',
  friendly: 'warm, approachable and friendly',
  empathetic: 'empathetic and understanding — acknowledge the difficulty and reassure the employee',
  formal: 'formal and structured, suitable for official company communications',
  concise: 'brief and to the point, using bullet points where appropriate',
};

/**
 * Generates an AI response for an employee email.
 *
 * Flow:
 * 1. Read Gemini API key from ai_settings table
 * 2. Fetch RAG context (document chunks) and similar resolved cases in parallel
 * 3. Build a full Gemini Flash prompt with all context
 * 4. If Gemini fails or key is missing, return a structured rule-based fallback
 *
 * The response NEVER exposes internal details (RAG, embeddings, chunk IDs, etc.)
 */
export async function generateAIResponse(
  intent: string,
  department: string,
  subteam: string,
  subject: string,
  body: string,
  tone: ResponseTone = 'professional',
  priority = 'medium',
  sentiment = 'neutral'
): Promise<{ response: string } | null> {
  try {
    // Step 1: Get Gemini API key
    const geminiKey = await getGeminiApiKey();

    // Step 2: Fetch context in parallel (RAG + similar cases)
    const ragQuery = `${intent} ${subject} ${body}`.slice(0, 500);
    const [ragResults, similarCases] = await Promise.all([
      semanticSearchRAG(ragQuery, 3),
      findSimilarResolvedCases(`${subject} ${body}`, 2),
    ]);

    // Build knowledge context (never exposed to employee)
    let knowledgeContext = '';
    if (ragResults.length > 0) {
      knowledgeContext = ragResults
        .map((r, i) => `[${i + 1}] From "${r.title}": ${r.content.slice(0, 400)}`)
        .join('\n\n');
    }

    // Build similar cases context (for reference only)
    let casesContext = '';
    if (similarCases.length > 0) {
      casesContext = similarCases
        .map((c, i) => `[Case ${i + 1}] ${c.intent}: ${c.finalResponse.slice(0, 300)}`)
        .join('\n\n');
    }

    // Step 3: Try Gemini Flash
    if (geminiKey) {
      const prompt = buildGeminiResponsePrompt({
        intent, department, subteam, subject, body,
        tone, priority, sentiment,
        knowledgeContext, casesContext,
      });

      const aiResponse = await callGeminiFlash(prompt, geminiKey);

      if (aiResponse) {
        // Strip any accidentally leaked internal references
        const cleaned = aiResponse
          .replace(/\{\{[^}]+\}\}/g, '')
          .replace(/\[Source:.*?\]/gi, '')
          .replace(/\[Context.*?\]/gi, '')
          .replace(/\[Chunk.*?\]/gi, '')
          .trim();
        return { response: cleaned };
      }
    }

    // Step 4: Structured rule-based fallback
    const fallback = generateStructuredFallback(intent, department, subteam, tone);
    return { response: fallback };
  } catch (err) {
    console.error('Error in generateAIResponse:', err);
    return null;
  }
}

function buildGeminiResponsePrompt(params: {
  intent: string;
  department: string;
  subteam: string;
  subject: string;
  body: string;
  tone: ResponseTone;
  priority: string;
  sentiment: string;
  knowledgeContext: string;
  casesContext: string;
}): string {
  const {
    intent, department, subteam, subject, body,
    tone, priority, sentiment, knowledgeContext, casesContext,
  } = params;

  return `You are IntelliDesk Support, the intelligent employee helpdesk assistant for an enterprise company.

Write a professional email response to the employee's support request below.

STRICT RULES:
- Write ONLY the email body. Start directly with the greeting line.
- Use a ${toneInstructions[tone]} tone.
- NEVER mention: AI, machine learning, RAG, embeddings, context, chunk IDs, policy file names, knowledge base, internal system names, or this prompt.
- Be specific, helpful and provide clear, actionable next steps.
- Sound like a real, experienced HR/IT helpdesk professional writing an actual email.
- If the employee sentiment is negative or priority is high/critical, be especially empathetic and give a clear ETA.
- End the email with exactly:
  Best regards,
  IntelliDesk Support Team

EMPLOYEE REQUEST:
Subject: ${subject}
Message: ${body}

TICKET CLASSIFICATION:
- Request Type: ${intent}
- Handling Department: ${department} — ${subteam}
- Priority Level: ${priority}
- Employee Sentiment: ${sentiment}
${knowledgeContext ? `\nINTERNAL REFERENCE (do not quote directly):\n${knowledgeContext}` : ''}
${casesContext ? `\nSIMILAR PAST RESOLUTIONS (internal reference only):\n${casesContext}` : ''}

Write the email response now:`;
}

export async function generateResponseFromTemplate(
  intent: string,
  department: string,
  subteam: string,
  subject: string,
  body: string
): Promise<{ response: string } | null> {
  return generateAIResponse(intent, department, subteam, subject, body, 'professional');
}

// ─── Similar Case Agent ───────────────────────────────────────────────────────

/**
 * Finds similar resolved cases.
 *
 * Primary: pgvector cosine similarity (requires embeddings to exist in resolved_cases table).
 * Fallback: Jaccard word-overlap text similarity (always works, less accurate).
 */
export async function findSimilarResolvedCases(
  query: string,
  limit = 3
): Promise<Array<{
  id: string;
  emailSubject: string;
  finalResponse: string;
  intent: string;
  department: string;
  similarity: number;
}>> {
  try {
    // Primary path: vector search via pgvector
    const embedding = await generateEmbeddingViaEdge(query.slice(0, 2000));

    if (embedding && embedding.length > 0) {
      const { data: vectorData, error: vectorError } = await supabase.rpc(
        'match_resolved_cases',
        {
          query_embedding: embedding,
          match_threshold: 0.3,
          match_count: limit,
        }
      );

      if (!vectorError && vectorData && vectorData.length > 0) {
        return vectorData.map((row: any) => ({
          id: String(row.id),
          emailSubject: String(row.email_subject || ''),
          finalResponse: String(row.final_response || ''),
          intent: String(row.intent || ''),
          department: String(row.department || ''),
          similarity: Number(row.similarity || 0),
        }));
      }
    }

    // Fallback: Jaccard text similarity (used before embeddings are available)
    const { data, error } = await supabase
      .from('resolved_cases')
      .select('id, email_subject, final_response, intent, department')
      .order('created_at', { ascending: false })
      .limit(100);

    if (error || !data) return [];

    const qWords = new Set(
      query.toLowerCase().split(/\W+/).filter((w) => w.length > 2)
    );

    const scored = data.map((row: any) => {
      const text = `${row.email_subject} ${row.final_response} ${row.intent}`.toLowerCase();
      const tWords = new Set(text.split(/\W+/).filter((w: string) => w.length > 2));
      let intersection = 0;
      for (const w of Array.from(qWords)) {
        if (tWords.has(w)) intersection++;
      }
      const union = qWords.size + tWords.size - intersection;
      const similarity = union > 0 ? intersection / union : 0;
      return {
        id: String(row.id),
        emailSubject: String(row.email_subject || ''),
        finalResponse: String(row.final_response || ''),
        intent: String(row.intent || ''),
        department: String(row.department || ''),
        similarity,
      };
    });

    return scored
      .filter((r) => r.similarity > 0.05)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);
  } catch (err) {
    console.error('Error finding similar cases:', err);
    return [];
  }
}

// ─── Self-Learning: Store Resolved Case + Generate Embedding ─────────────────

/**
 * Stores a resolved case in the knowledge base.
 *
 * 1. Inserts the case record immediately (fast — UI unblocked)
 * 2. Generates the Gemini embedding in the background (non-blocking)
 * 3. Updates the record with the embedding for future pgvector similarity search
 */
export async function storeResolvedCase(
  ticketId: string,
  emailSubject: string,
  emailBody: string,
  finalResponse: string,
  intent: string,
  department: string,
  subteam: string,
  actionTaken: string,
  attachmentSummary?: string
): Promise<void> {
  try {
    // Step 1: Insert the resolved case (fast, no embedding needed yet)
    const { data, error } = await supabase
      .from('resolved_cases')
      .insert({
        ticket_id: ticketId,
        email_subject: emailSubject,
        email_body: emailBody,
        final_response: finalResponse,
        intent,
        department,
        subteam,
        action_taken: actionTaken,
        attachment_summary: attachmentSummary ?? null,
      })
      .select('id')
      .single();

    if (error) {
      console.error('Error inserting resolved case:', error);
      return;
    }

    if (!data?.id) return;

    // Step 2: Generate and store embedding in background (non-blocking)
    const caseId = data.id;
    const textToEmbed = `${emailSubject} ${emailBody} ${intent} ${department} ${attachmentSummary ?? ''}`.slice(0, 2000);

    generateEmbeddingViaEdge(textToEmbed)
      .then(async (embedding) => {
        if (embedding && embedding.length > 0) {
          const { error: updateError } = await supabase
            .from('resolved_cases')
            .update({ embedding })
            .eq('id', caseId);

          if (updateError) {
            console.error('Error storing embedding on resolved case:', updateError);
          } else {
            console.log('✅ Embedding stored for resolved case:', caseId);
          }
        }
      })
      .catch((err) => {
        console.error('Background embedding generation failed:', err);
      });
  } catch (err) {
    console.error('Error in storeResolvedCase:', err);
  }
}

// ─── Structured Fallback Response Generator ───────────────────────────────────

/**
 * Rule-based response generator. Used when Gemini API is unavailable.
 * Produces professional, role-appropriate HR/IT emails without AI.
 */
function generateStructuredFallback(
  intent: string,
  department: string,
  subteam: string,
  tone: ResponseTone
): string {
  const n = intent.toLowerCase();

  const greetings: Record<ResponseTone, string> = {
    professional: 'Dear Employee,',
    friendly: 'Hi there,',
    empathetic: 'Dear Employee,',
    formal: 'To Whom It May Concern,',
    concise: 'Hello,',
  };

  const closings: Record<ResponseTone, string> = {
    professional: 'Best regards,\nIntelliDesk Support Team',
    friendly: 'Cheers,\nYour IntelliDesk Team',
    empathetic: 'With care,\nIntelliDesk Support Team',
    formal: 'Yours sincerely,\nIntelliDesk Support Team',
    concise: 'Regards,\nIntelliDesk',
  };

  let content = '';

  if (n.includes('password') || n.includes('reset')) {
    content = `We have received your account password reset request.\n\nTo ensure your account security, we will verify your identity and send you secure reset instructions within the next hour. Please check your inbox and spam folder.\n\nIf you do not receive the link within the hour, please contact us again and our ${subteam} team will assist you directly.`;
  } else if (n.includes('leave') || n.includes('vacation') || n.includes('time off')) {
    content = `Your leave request has been received and will be forwarded to your line manager for approval.\n\nPlease ensure your leave balance is sufficient for the requested dates. Medical leave exceeding three consecutive days requires a medical certificate from a registered practitioner.\n\nYou will be notified by email once your manager has approved or declined the request.`;
  } else if (n.includes('vpn') || n.includes('remote access')) {
    content = `Your VPN / remote access request has been logged with our ${subteam}.\n\nWe are setting up your credentials and will share the configuration guide via a secure email shortly. Please review the remote work security policy before connecting to ensure compliance.\n\nReach out if you encounter any issues during setup.`;
  } else if (n.includes('laptop') || n.includes('computer') || n.includes('hardware')) {
    content = `We have received your device issue report. Our ${subteam} team will contact you to run diagnostics and determine next steps.\n\nPlease have your device serial number and model ready. If the device is under warranty and cannot be repaired, we will arrange a replacement. A temporary device may be available upon request.`;
  } else if (n.includes('sap') || n.includes('erp')) {
    content = `Your SAP / ERP access request has been received and is awaiting manager approval validation.\n\nOnce approved, our ${subteam} will provision your access credentials and share login instructions. Please allow up to two business days for completion. For urgent access, please ask your manager to expedite the approval.`;
  } else if (n.includes('insurance') || n.includes('medical')) {
    content = `Thank you for your insurance query. We have reviewed your current benefits coverage and our ${subteam} will provide detailed claim submission instructions.\n\nPlease ensure you have all required documents ready — including bills, receipts, and discharge summaries — before submitting your claim.`;
  } else if (n.includes('payroll') || n.includes('salary') || n.includes('pay')) {
    content = `We have noted your payroll concern. Our finance team is reviewing the payroll records for the affected period.\n\nIf a discrepancy is confirmed, a correction will be processed in the next payroll cycle. You will receive an update within 48 business hours. We apologise for any inconvenience caused.`;
  } else if (n.includes('wifi') || n.includes('network') || n.includes('internet')) {
    content = `We are aware of the connectivity issue you reported. Our ${subteam} is investigating and working to restore full service as quickly as possible.\n\nIn the meantime, you may use a mobile hotspot for critical tasks. We will notify you by email once the issue has been fully resolved.`;
  } else if (n.includes('software') || n.includes('install') || n.includes('license')) {
    content = `Your software installation request has been approved. Our ${subteam} will deploy the application to your device via the centralized endpoint management system.\n\nThe software should be available within 24 hours. If the requirement is urgent, please let us know and we will escalate accordingly.`;
  } else if (n.includes('training') || n.includes('course') || n.includes('certification')) {
    content = `Your training request has been received and forwarded to the Learning and Development team.\n\nThey will review your eligibility, available budget, and course schedule and will revert to you with options shortly. We appreciate your commitment to professional growth.`;
  } else if (n.includes('resignation') || n.includes('quit') || n.includes('notice')) {
    content = `We have received your resignation notice. Our HR team will reach out to you within one business day to discuss the exit process, notice period, and knowledge handover requirements.\n\nWe wish you all the very best in your next chapter.`;
  } else {
    content = `Thank you for reaching out to IntelliDesk Support.\n\nWe have received your ${intent.toLowerCase()} request and it has been assigned to our ${subteam} team in the ${department} department. A team member will review your request and respond within 24 hours.\n\nIf this is urgent, please reply to this email with "URGENT" in the subject line.`;
  }

  return `${greetings[tone]}\n\n${content}\n\n${closings[tone]}`;
}

// ─── Decision & Escalation Agent ─────────────────────────────────────────────


// ── Escalation Matrix (business rules — inviolable, override Gemini) ──────────

interface EscalationRule {
  test: (intent: string, priority: string, body: string) => boolean;
  decision: 'ESCALATE' | 'HUMAN_APPROVAL_REQUIRED';
  risk: RiskLevel;
  department: string;
  subteam: string;
  confidence: number;
  reason: string;
}

const DECISION_RULES: EscalationRule[] = [
  // ── CRITICAL — ESCALATE immediately ──────────────────────────────────────
  {
    test: (i, _p, b) => /harass|sexual|discriminat|assault|hostile|abuse|misconduct|bully|threaten|violence/i.test(i + ' ' + b),
    decision: 'ESCALATE', risk: 'Critical', confidence: 99,
    department: 'HR', subteam: 'Employee Relations',
    reason: 'Workplace harassment or misconduct complaint detected. Requires immediate confidential HR investigation.',
  },
  {
    test: (i, _p, b) => /fraud|bribery|corrupt|embezzl|money launder/i.test(i + ' ' + b),
    decision: 'ESCALATE', risk: 'Critical', confidence: 99,
    department: 'Compliance', subteam: 'Fraud & Investigations',
    reason: 'Fraud or bribery allegation detected. Requires Compliance team investigation.',
  },
  {
    test: (i, _p, b) => /data breach|data leak|data loss|security incident|ransomware|malware|phishing attack|hacked|unauthori[sz]ed access|cyber/i.test(i + ' ' + b),
    decision: 'ESCALATE', risk: 'Critical', confidence: 99,
    department: 'IT', subteam: 'Cyber Security',
    reason: 'Potential security incident or data breach. Requires immediate Security Operations response.',
  },
  {
    test: (i, _p, b) => /legal notice|lawsuit|litigation|court order|police|government notice|regulatory action|gdpr complaint|data subject request/i.test(i + ' ' + b),
    decision: 'ESCALATE', risk: 'Critical', confidence: 98,
    department: 'Legal', subteam: 'Compliance',
    reason: 'Legal or regulatory matter detected. Must be handled exclusively by qualified legal personnel.',
  },
  {
    test: (i, _p, b) => /medical emergency|heart attack|accident|injury|unconscious|ambulance|fire|evacuation/i.test(i + ' ' + b),
    decision: 'ESCALATE', risk: 'Critical', confidence: 99,
    department: 'Facilities', subteam: 'Emergency Response',
    reason: 'Medical or physical emergency situation. Requires immediate emergency response.',
  },
  {
    test: (i, _p, b) => /termination appeal|wrongful terminat|unfair dismissal|constructive dismissal/i.test(i + ' ' + b),
    decision: 'ESCALATE', risk: 'Critical', confidence: 97,
    department: 'HR', subteam: 'Employee Relations',
    reason: 'Termination appeal or wrongful dismissal complaint. Requires HR Business Partner and Legal review.',
  },
  // ── HIGH — ESCALATE ───────────────────────────────────────────────────────
  {
    test: (i, _p, b) => /payroll discrepan|salary missing|wrong salary|underpaid|overpaid|missing payment|pay dispute|salary not received/i.test(i + ' ' + b) || /payroll.*(issue|problem|error|wrong|dispute)/i.test(i + ' ' + b),
    decision: 'ESCALATE', risk: 'High', confidence: 96,
    department: 'Finance', subteam: 'Payroll Team',
    reason: 'Payroll discrepancy or salary dispute. Requires Finance Payroll Team investigation.',
  },
  {
    test: (i, _p, b) => /compliance violation|audit finding|whistleblow|misconduct report/i.test(i + ' ' + b),
    decision: 'ESCALATE', risk: 'High', confidence: 95,
    department: 'Compliance', subteam: 'Regulatory Affairs',
    reason: 'Compliance violation or whistleblower report. Requires Compliance team review.',
  },
  // ── MEDIUM — HUMAN_APPROVAL_REQUIRED ─────────────────────────────────────
  {
    test: (i, _p, b) => /resign|quit|notice period|exit process|last day|leaving the company/i.test(i + ' ' + b),
    decision: 'HUMAN_APPROVAL_REQUIRED', risk: 'Medium', confidence: 93,
    department: 'HR', subteam: 'Employee Relations',
    reason: 'Resignation requires formal HR process: exit interview, offboarding, knowledge transfer.',
  },
  {
    test: (i, _p, b) => /promot|career progression|appraisal|performance review|band change|salary increase request/i.test(i + ' ' + b),
    decision: 'HUMAN_APPROVAL_REQUIRED', risk: 'Medium', confidence: 91,
    department: 'HR', subteam: 'HR Business Partner',
    reason: 'Career progression or promotion request requires HR Business Partner involvement.',
  },
  {
    test: (i, _p, b) => /transfer|relocation|department change|internal move|secondment/i.test(i + ' ' + b),
    decision: 'HUMAN_APPROVAL_REQUIRED', risk: 'Medium', confidence: 90,
    department: 'HR', subteam: 'Talent Management',
    reason: 'Internal transfer or relocation requires multi-manager approval and HR coordination.',
  },
  {
    // Test BOTH intent and body — so this fires even if the upstream classifier
    // misidentified the intent (e.g., produced 'Software Installation' for a leave email).
    test: (i, _p, b) => /leave request|time off request|annual leave|vacation request|maternity|paternity|sabbatical|emergency leave|sick leave|casual leave|leave balance|absence request|days? off|request.*leave|leave.*request/i.test(i + ' ' + b),
    decision: 'HUMAN_APPROVAL_REQUIRED', risk: 'Medium', confidence: 94,
    department: 'HR', subteam: 'Leave Management',
    reason: 'Leave requests require manager approval and leave balance verification.',
  },
  {
    test: (i, _p, b) => /sap access|erp access|database access|admin access|root access|system access/i.test(i + ' ' + b),
    decision: 'HUMAN_APPROVAL_REQUIRED', risk: 'Medium', confidence: 92,
    department: 'IT', subteam: 'SAP Basis',
    reason: 'Privileged system access requests require manager approval and access review.',
  },
  {
    test: (i, _p, b) => /laptop replacement|new laptop|device replacement|asset request/i.test(i + ' ' + b),
    decision: 'HUMAN_APPROVAL_REQUIRED', risk: 'Medium', confidence: 90,
    department: 'Admin', subteam: 'Procurement',
    reason: 'Asset procurement requests require budget approval and procurement review.',
  },
  {
    test: (i, _p, b) => /travel reimbursem|expense claim|reimburs/i.test(i + ' ' + b),
    decision: 'HUMAN_APPROVAL_REQUIRED', risk: 'Medium', confidence: 89,
    department: 'Finance', subteam: 'Accounts Payable',
    reason: 'Expense reimbursement requires manager approval and policy verification.',
  },
  {
    test: (i, _p, b) => /training request|certification request|course enroll|learning request/i.test(i + ' ' + b),
    decision: 'HUMAN_APPROVAL_REQUIRED', risk: 'Medium', confidence: 88,
    department: 'HR', subteam: 'L&D',
    reason: 'Training requests require budget approval and L&D scheduling.',
  },
];

/** Patterns that AI can handle fully automatically */
const AUTO_RESPONSE_PATTERNS =
  /password reset|forgot password|vpn (setup|issue|problem|not working|help)|wifi|network issue|internet problem|software install|outlook|email client|mfa|two.?factor|authenticator|id card|badge|meeting room|printer|holiday list|office location|expense policy|travel policy|insurance faq|employee handbook|leave balance|general inquiry/i;

// ─── Gemini Decision Prompt ───────────────────────────────────────────────────

function buildDecisionPrompt(params: {
  intent: string; priority: string; sentiment: string;
  subject: string; body: string;
  knowledgeContext: string; pastDecisions: string;
  orgContext?: string;
}): string {
  const { intent, priority, sentiment, subject, body, knowledgeContext, pastDecisions, orgContext } = params;
  return `You are the Decision & Escalation Agent for IntelliDesk, an enterprise AI helpdesk.

Your ONLY job is to evaluate the employee request and return a single JSON decision object.

DECISION TYPES:
- AUTO_RESPONSE: AI can safely and fully handle this. Routine support. Low risk.
- HUMAN_APPROVAL_REQUIRED: AI drafts a response but a manager must approve before sending.
- ESCALATE: AI must NOT respond. A human specialist must handle this immediately.

RISK LEVELS: Low | Medium | High | Critical

AUTO_RESPONSE examples: Password reset, VPN help, WiFi issue, software install, printer, meeting room, leave balance check, holiday list, travel/expense policy question, insurance FAQ, employee handbook, general HR question.

HUMAN_APPROVAL_REQUIRED examples: Leave request, SAP access, asset request, travel reimbursement, laptop replacement, database access, promotion request, transfer request, training request.

ESCALATE examples: Payroll dispute, salary missing, sexual harassment, discrimination, legal notice, security breach, data leak, fraud, bribery complaint, employee misconduct, termination appeal, compliance violation, medical emergency, violence, threat, police request, government notice.

FAILSAFE: If confidence < 70, ALWAYS return HUMAN_APPROVAL_REQUIRED. Never allow uncertain auto-responses.

EMPLOYEE REQUEST:
Subject: ${subject}
Message: ${body.slice(0, 600)}
Intent: ${intent}
Priority: ${priority}
Sentiment: ${sentiment}

${orgContext ? `${orgContext}\n` : ''}
${knowledgeContext ? `RELEVANT POLICY CONTEXT:\n${knowledgeContext}\n` : ''}
${pastDecisions ? `PAST SIMILAR DECISIONS (for self-learning):\n${pastDecisions}\n` : ''}

IMPORTANT: Use the EMPLOYEE CONTEXT above to determine the correct department, team, and approver. Prefer the Organization Directory data over text-based inference.

Return ONLY valid JSON. No markdown, no explanation, just JSON:
{
  "decision": "AUTO_RESPONSE" | "HUMAN_APPROVAL_REQUIRED" | "ESCALATE",
  "confidence": 0-100,
  "risk": "Low" | "Medium" | "High" | "Critical",
  "requires_human": true | false,
  "reason": "One sentence explaining why.",
  "department": "Target department (required for ESCALATE and HUMAN_APPROVAL_REQUIRED)",
  "subteam": "Target subteam (required for ESCALATE and HUMAN_APPROVAL_REQUIRED)",
  "recommended_person": "Name of the direct manager or approver from the Organization Directory if known"
}`;
}

// ─── Past Decisions Context (Self-Learning) ───────────────────────────────────

async function fetchPastDecisions(intent: string, limit = 3): Promise<string> {
  try {
    const { data } = await supabase
      .from('decision_logs')
      .select('decision, confidence, risk_level, escalation_reason, recommended_department')
      .ilike('escalation_reason', `%${intent.slice(0, 20)}%`)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (!data || data.length === 0) return '';
    return data
      .map((d: any, i: number) =>
        `[Past ${i + 1}] Decision: ${d.decision}, Confidence: ${d.confidence}%, Risk: ${d.risk_level}, Dept: ${d.recommended_department || 'N/A'}`
      )
      .join('\n');
  } catch {
    return '';
  }
}

// ─── AI Handover Summary ──────────────────────────────────────────────────────

async function buildHandoverSummary(
  intent: string, subject: string, body: string,
  department: string, subteam: string, apiKey: string | null
): Promise<string> {
  if (apiKey) {
    const prompt = `You are a professional enterprise helpdesk AI. Write a concise handover summary for a ${subteam} specialist in ${department}.

Use exactly 3 bullet points starting with "• ".
Cover: (1) what the employee needs, (2) key context / urgency signals, (3) recommended first action.
Never mention AI, RAG, or internal systems.

Ticket: "${subject}"
Body: ${body.slice(0, 400)}
Intent: ${intent}

Handover summary:`;
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.3, maxOutputTokens: 256 },
          }),
        }
      );
      if (res.ok) {
        const d = await res.json();
        const txt = d?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
        if (txt) return txt;
      }
    } catch { /* fall through */ }
  }
  return [
    `• Employee has raised a "${intent}" request that requires specialist review by ${subteam}.`,
    `• Subject: "${subject.slice(0, 80)}" — treat as ${department === 'HR' ? 'confidential' : 'high priority'}.`,
    `• Recommended first action: Acknowledge receipt within 2 hours and contact the employee directly.`,
  ].join('\n');
}

// ─── Business Rule Validation (inviolable overrides) ─────────────────────────

function applyBusinessRules(
  geminiResult: Partial<DecisionResult> | null,
  intent: string,
  priority: string,
  body: string
): { rule: EscalationRule | null; override: boolean } {
  for (const rule of DECISION_RULES) {
    if (rule.test(intent, priority, body)) {
      // Check if Gemini agreed — if not, override
      const geminiDecision = geminiResult?.decision;
      const needsOverride = !geminiDecision ||
        (rule.decision === 'ESCALATE' && geminiDecision !== 'ESCALATE') ||
        (rule.risk === 'Critical' && geminiResult?.risk !== 'Critical');
      return { rule, override: needsOverride };
    }
  }
  return { rule: null, override: false };
}

// ─── Main: runDecisionAgent ───────────────────────────────────────────────────

/**
 * Decision & Escalation Agent
 *
 * Executes after the Response Generator as a mandatory gate.
 * Combines Gemini AI reasoning with inviolable business rules.
 *
 * Decision hierarchy:
 *   1. Business rules (ESCALATE/Critical overrides — always enforced)
 *   2. Gemini reasoning (primary decision engine with RAG + self-learning context)
 *   3. Confidence failsafe (< 70 → HUMAN_APPROVAL_REQUIRED)
 *   4. Pattern-based fallback (when Gemini unavailable)
 *
 * @returns DecisionResult — never throws, never returns null
 */
export async function runDecisionAgent(
  intent: string,
  priority: string,
  sentiment: string,
  department: string,
  subteam: string,
  subject: string,
  body: string,
  knowledgeContext = '',
  orgContext = ''
): Promise<DecisionResult> {
  try {
    const apiKey = await getGeminiApiKey();
    let geminiResult: Partial<DecisionResult> | null = null;

    // ── Step 1: Try Gemini reasoning ────────────────────────────────────────
    if (apiKey) {
      try {
        const pastDecisions = await fetchPastDecisions(intent);
        const prompt = buildDecisionPrompt({
          intent, priority, sentiment, subject, body,
          knowledgeContext: knowledgeContext.slice(0, 800),
          pastDecisions,
          orgContext: orgContext || undefined,
        });

        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: { temperature: 0.1, maxOutputTokens: 512 },
            }),
          }
        );

        if (res.ok) {
          const data = await res.json();
          const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
          // Strip possible markdown code fences
          const jsonText = rawText.replace(/```json\n?/gi, '').replace(/```\n?/gi, '').trim();
          try {
            geminiResult = JSON.parse(jsonText) as Partial<DecisionResult>;
          } catch {
            console.warn('[DecisionAgent] Gemini JSON parse failed, using rules fallback');
          }
        }
      } catch (err) {
        console.warn('[DecisionAgent] Gemini call failed:', err);
      }
    }

    // ── Step 2: Apply inviolable business rules ──────────────────────────────
    const { rule, override } = applyBusinessRules(geminiResult, intent, priority, body);

    if (rule && (override || rule.decision === 'ESCALATE')) {
      const ai_summary = rule.decision === 'ESCALATE'
        ? await buildHandoverSummary(intent, subject, body, rule.department, rule.subteam, apiKey)
        : undefined;

      return {
        decision: rule.decision,
        confidence: rule.confidence,
        risk: rule.risk,
        requires_human: true,
        reason: rule.reason,
        department: rule.department,
        subteam: rule.subteam,
        ai_summary,
      };
    }

    // ── Step 3: Use Gemini result if valid ───────────────────────────────────
    if (geminiResult?.decision && geminiResult?.confidence !== undefined) {
      const confidence = geminiResult.confidence;

      // Failsafe: confidence < 70 → force HUMAN_APPROVAL_REQUIRED
      const finalDecision: DecisionType =
        confidence < 70 ? 'HUMAN_APPROVAL_REQUIRED' : (geminiResult.decision as DecisionType);
      const finalRisk: RiskLevel =
        (geminiResult.risk as RiskLevel) || 'Low';

      let ai_summary: string | undefined;
      if (finalDecision === 'ESCALATE' && geminiResult.department && geminiResult.subteam) {
        ai_summary = await buildHandoverSummary(
          intent, subject, body,
          geminiResult.department, geminiResult.subteam, apiKey
        );
      }

      return {
        decision: finalDecision,
        confidence,
        risk: finalRisk,
        requires_human: finalDecision !== 'AUTO_RESPONSE',
        reason: confidence < 70
          ? `Confidence too low (${confidence}%) — routed to human approval for safety.`
          : (geminiResult.reason || 'AI decision based on request analysis.'),
        department: geminiResult.department,
        subteam: geminiResult.subteam,
        ai_summary,
      };
    }

    // ── Step 4: Pattern-based fallback (Gemini unavailable) ─────────────────
    const text = `${intent} ${subject} ${body}`;

    // Check human-approval patterns first
    if (rule && rule.decision === 'HUMAN_APPROVAL_REQUIRED') {
      return {
        decision: 'HUMAN_APPROVAL_REQUIRED',
        confidence: rule.confidence,
        risk: rule.risk,
        requires_human: true,
        reason: rule.reason,
        department: rule.department,
        subteam: rule.subteam,
      };
    }

    if (AUTO_RESPONSE_PATTERNS.test(text)) {
      return {
        decision: 'AUTO_RESPONSE',
        confidence: 85,
        risk: 'Low',
        requires_human: false,
        reason: `Routine ${intent} request — AI can handle automatically.`,
        department,
        subteam,
      };
    }

    // Conservative default — always prefer human review when uncertain
    return {
      decision: 'HUMAN_APPROVAL_REQUIRED',
      confidence: 60,
      risk: 'Medium',
      requires_human: true,
      reason: 'Request type is ambiguous — routed for human review as a precaution.',
      department,
      subteam,
    };

  } catch (err) {
    console.error('[DecisionAgent] Unhandled error:', err);
    return {
      decision: 'HUMAN_APPROVAL_REQUIRED',
      confidence: 50,
      risk: 'Medium',
      requires_human: true,
      reason: 'Decision agent encountered an error — defaulted to human review for safety.',
    };
  }
}

// ─── Store Decision Log ───────────────────────────────────────────────────────

/**
 * Persists a DecisionResult to the decision_logs table.
 * Called after the ticket is created so ticket_id is available.
 */
export async function storeDecisionLog(
  ticketId: string,
  result: DecisionResult
): Promise<void> {
  try {
    await supabase.from('decision_logs').insert({
      ticket_id: ticketId,
      decision: result.decision,
      confidence: result.confidence,
      risk_level: result.risk,
      escalation_reason: result.reason,
      recommended_department: result.department ?? null,
      recommended_subteam: result.subteam ?? null,
      recommended_person: result.recommended_person ?? null,
      requires_human: result.requires_human,
      ai_summary: result.ai_summary ?? null,
    });
  } catch (err) {
    console.error('[DecisionAgent] storeDecisionLog failed:', err);
  }
}

// ─── Resolution Analysis Agent ────────────────────────────────────────────────

/**
 * Structured output from the Resolution Analysis Agent.
 * Used exclusively by the engineer-facing Resolution Analysis panel.
 * NEVER contains email copy or customer-facing content.
 */
export interface ResolutionAnalysis {
  /** 1–2 sentence plain English summary of what the employee is requesting */
  issueSummary: string;
  /** Plain English description of the ticket's current stage/status */
  currentStatus: string;
  /** Items the engineer must manually verify before closing — empty if requires_human is false */
  humanVerificationItems: string[];
  /** Plain English explanation of the risk level and what it means for resolution */
  riskExplanation: string;
  /** Single sentence describing the recommended next action for the engineer */
  nextAction: string;
}

/**
 * Generates a structured Resolution Analysis for the engineer.
 *
 * Design principles:
 *   - NEVER generates email copy — analysis only
 *   - Engineers-only output — never shown to employees
 *   - Focuses on: what to do, what to verify, what risk exists
 *   - Falls back to rule-based generation when Gemini unavailable
 */
export async function generateResolutionAnalysis(
  intent: string,
  department: string,
  subject: string,
  body: string,
  decision: DecisionResult,
  similarCases: Array<{ intent: string; emailSubject: string; finalResponse: string; similarity: number }>
): Promise<ResolutionAnalysis> {
  const n = intent.toLowerCase();
  const riskLabel = decision.risk || 'Medium';
  const decisionType = decision.decision;

  // ── Rule-based fallback values ─────────────────────────────────────────────
  const fallbackSummary = buildRuleBasedSummary(n, subject);
  const fallbackStatus = buildRuleBasedStatus(decisionType, department, decision);
  const fallbackVerifications = buildRuleBasedVerifications(n, decisionType);
  const fallbackRisk = buildRuleBasedRisk(riskLabel, n);
  const fallbackNextAction = buildRuleBasedNextAction(decisionType, department, decision.subteam);

  try {
    const apiKey = await getGeminiApiKey();
    if (!apiKey) {
      return {
        issueSummary: fallbackSummary,
        currentStatus: fallbackStatus,
        humanVerificationItems: fallbackVerifications,
        riskExplanation: fallbackRisk,
        nextAction: fallbackNextAction,
      };
    }

    const similarContext = similarCases.length > 0
      ? `\nSIMILAR RESOLVED TICKETS (for context):\n${similarCases.map((c, i) => `[${i + 1}] ${c.intent} — ${c.emailSubject} (${(c.similarity * 100).toFixed(0)}% match)`).join('\n')}`
      : '';

    const prompt = `You are a senior IT/HR helpdesk analyst generating an internal resolution analysis for an engineer. This is NOT for the employee — it is strictly internal.

TICKET DETAILS:
Subject: ${subject}
Body: ${body.slice(0, 600)}
Intent: ${intent}
Department: ${department}
AI Decision: ${decisionType}
Risk Level: ${riskLabel}
Reason: ${decision.reason}${decision.department ? `\nEscalate To: ${decision.department} — ${decision.subteam || ''}` : ''}${similarContext}

Generate a JSON analysis object with EXACTLY these fields:
- "issueSummary": 1-2 sentence plain English summary of what the employee needs (no jargon, no emails)
- "currentStatus": 1 sentence describing the ticket's current stage and what is pending
- "humanVerificationItems": array of 2-4 specific things the engineer must manually check or verify before resolving (be specific to the intent type)
- "riskExplanation": 1-2 sentences explaining what the risk level means for THIS specific ticket and what could go wrong
- "nextAction": exactly 1 sentence — the single most important action the engineer should take RIGHT NOW

RULES:
- Do NOT write any email copy or customer-facing text
- Do NOT mention AI, RAG, or internal system names
- Be specific to the intent — not generic
- humanVerificationItems must be concrete action items (e.g. "Verify manager approval in SAP system" not "Check approval")
- Return ONLY valid JSON — no markdown, no explanation

Return JSON:`;

    const raw = await callGeminiFlash(prompt, apiKey, 0.2);
    if (raw) {
      const jsonText = raw.replace(/```json\n?/gi, '').replace(/```\n?/gi, '').trim();
      try {
        const parsed = JSON.parse(jsonText);
        return {
          issueSummary: parsed.issueSummary || fallbackSummary,
          currentStatus: parsed.currentStatus || fallbackStatus,
          humanVerificationItems: Array.isArray(parsed.humanVerificationItems) ? parsed.humanVerificationItems : fallbackVerifications,
          riskExplanation: parsed.riskExplanation || fallbackRisk,
          nextAction: parsed.nextAction || fallbackNextAction,
        };
      } catch {
        // JSON parse failed — use fallback
      }
    }
  } catch (err) {
    console.error('[ResolutionAnalysis] generation failed:', err);
  }

  return {
    issueSummary: fallbackSummary,
    currentStatus: fallbackStatus,
    humanVerificationItems: fallbackVerifications,
    riskExplanation: fallbackRisk,
    nextAction: fallbackNextAction,
  };
}

// ── Rule-based fallback helpers for generateResolutionAnalysis ─────────────────

function buildRuleBasedSummary(intent: string, subject: string): string {
  if (intent.includes('sap') || intent.includes('erp')) return `Employee is requesting access to the SAP/ERP system. The access must be provisioned with the correct role assignments. Ticket: "${subject}".`;
  if (intent.includes('vpn') || intent.includes('remote')) return `Employee is requesting VPN credentials to enable secure remote access. Credentials must be provisioned and setup instructions sent. Ticket: "${subject}".`;
  if (intent.includes('password') || intent.includes('reset')) return `Employee has been locked out or has forgotten their password. Account access must be restored securely. Ticket: "${subject}".`;
  if (intent.includes('outlook') || intent.includes('email') || intent.includes('mailbox')) return `Employee is requesting access to or experiencing issues with their corporate email account. Ticket: "${subject}".`;
  if (intent.includes('laptop') || intent.includes('hardware') || intent.includes('device')) return `Employee is requesting hardware allocation or reporting a device issue. Physical asset coordination required. Ticket: "${subject}".`;
  if (intent.includes('software') || intent.includes('license') || intent.includes('install')) return `Employee is requesting software installation or a license. IT must verify availability and deploy. Ticket: "${subject}".`;
  if (intent.includes('leave') || intent.includes('vacation')) return `Employee has submitted a leave request that requires manager approval and leave balance verification. Ticket: "${subject}".`;
  if (intent.includes('payroll') || intent.includes('salary')) return `Employee has reported a payroll discrepancy or salary issue requiring Finance investigation. Ticket: "${subject}".`;
  if (intent.includes('database') || intent.includes('db')) return `Employee is requesting database access. Privileged access provisioning requires DBA review. Ticket: "${subject}".`;
  if (intent.includes('network') || intent.includes('wifi')) return `Employee is reporting a network connectivity issue. Infrastructure team must investigate. Ticket: "${subject}".`;
  return `Employee has submitted a support request categorized as "${intent}". Review the full ticket and determine the correct resolution path. Ticket: "${subject}".`;
}

function buildRuleBasedStatus(
  decision: string,
  department: string,
  result: DecisionResult
): string {
  if (decision === 'ESCALATE') return `This ticket has been flagged for immediate escalation to ${result.department || department} — ${result.subteam || 'specialist team'}. Do not attempt to resolve independently.`;
  if (decision === 'HUMAN_APPROVAL_REQUIRED') return `This ticket requires manager approval before proceeding. An approval request has been or will be sent to the employee's line manager. Awaiting decision.`;
  return `This ticket is eligible for direct resolution. The AI has assessed it as routine and low risk. Proceed with resolution steps below.`;
}

function buildRuleBasedVerifications(intent: string, decision: string): string[] {
  const n = intent.toLowerCase();
  if (n.includes('sap') || n.includes('erp')) return [
    'Confirm manager approval is on record before provisioning access',
    'Verify the requested SAP roles are appropriate for the employee\'s job function',
    'Check that the employee does not already have conflicting SAP access',
    'Validate provisioning ticket in SAP Basis queue',
  ];
  if (n.includes('vpn')) return [
    'Confirm employee is eligible for remote work per HR records',
    'Verify manager has approved VPN access (especially for new joiners)',
    'Check that the employee\'s device meets security compliance requirements',
    'Ensure the MFA method is enrolled before issuing credentials',
  ];
  if (n.includes('password') || n.includes('reset')) return [
    'Verify employee identity via registered corporate email or employee ID',
    'Check if the account is locked due to multiple failed attempts or a security policy violation',
    'Confirm the system/application the employee is unable to access',
    'Ensure the temporary password policy (forced change on first login) is enforced',
  ];
  if (n.includes('leave')) return [
    'Check employee\'s current leave balance in the HR system',
    'Confirm the requested dates do not conflict with team or project commitments',
    'Verify the leave type matches the reason (e.g. medical leave requires certificate)',
    'Confirm manager has been notified and approval is pending',
  ];
  if (n.includes('payroll') || n.includes('salary')) return [
    'Pull the employee\'s payroll records for the affected pay period',
    'Identify the specific discrepancy (missing payment, wrong amount, deduction error)',
    'Confirm with Finance whether the correction will apply to the current or next cycle',
    'Obtain written confirmation of the resolution before closing the ticket',
  ];
  if (n.includes('laptop') || n.includes('hardware')) return [
    'Check the asset management system for available inventory',
    'Verify the asset allocation has budget approval if it\'s a new purchase',
    'Record the serial number and asset tag in ITSM before handover',
    'Confirm handover location and date with the employee',
  ];
  if (decision === 'ESCALATE') return [
    'Do NOT attempt to resolve this ticket — forward to the specialist team immediately',
    'Document all ticket details before escalating to preserve the audit trail',
    'Notify the employee that their ticket is being escalated to a specialist',
  ];
  return [
    'Review the full ticket body for any missing information',
    'Confirm the employee\'s department and reporting manager are correct in the system',
    'Check for any similar recent tickets from the same employee',
    'Verify the resolution steps are appropriate for this specific request',
  ];
}

function buildRuleBasedRisk(risk: string, intent: string): string {
  if (risk === 'Critical') return `This ticket carries CRITICAL risk. An incorrect or delayed resolution could result in compliance violations, data exposure, or serious employee harm. Escalate immediately and do not attempt independent resolution.`;
  if (risk === 'High') return `This ticket carries HIGH risk. The issue affects financial records, sensitive system access, or employee welfare. Resolution must be carefully verified and documented. Obtain written approval before closing.`;
  if (risk === 'Medium') {
    if (intent.includes('sap') || intent.includes('access')) return `Medium risk — access provisioning mistakes can create audit findings or security gaps. Ensure role assignments are reviewed and manager approval is documented.`;
    if (intent.includes('leave')) return `Medium risk — incorrect leave records affect payroll calculations and employee morale. Verify leave balance before approving.`;
    return `Medium risk — this request requires careful handling to avoid downstream process failures. Double-check all steps before closing the ticket.`;
  }
  return `Low risk — this is a routine support request. Standard resolution procedures apply. Document the resolution clearly for the knowledge base.`;
}

function buildRuleBasedNextAction(decision: string, department: string, subteam?: string): string {
  if (decision === 'ESCALATE') return `Escalate this ticket immediately to ${department}${subteam ? ` — ${subteam}` : ''} and notify the employee that a specialist is handling their request.`;
  if (decision === 'HUMAN_APPROVAL_REQUIRED') return `Send an approval request to the employee's line manager and await their decision before proceeding with any resolution.`;
  return `Complete the resolution steps listed below, fill in the Resolution Draft tab with the correct details, and send the confirmation to the employee.`;
}

// ─── Dashboard Stats ──────────────────────────────────────────────────────────

/**
 * Fetches aggregated decision counts for the Dashboard Decision Intelligence row.
 */
export async function getDecisionStats(): Promise<DecisionStats> {
  try {
    const { data, error } = await supabase
      .from('decision_logs')
      .select('decision, risk_level');

    if (error || !data) return { autoResolved: 0, approvalRequired: 0, escalated: 0, criticalIncidents: 0 };

    return {
      autoResolved:      data.filter((d: any) => d.decision === 'AUTO_RESPONSE').length,
      approvalRequired:  data.filter((d: any) => d.decision === 'HUMAN_APPROVAL_REQUIRED').length,
      escalated:         data.filter((d: any) => d.decision === 'ESCALATE').length,
      criticalIncidents: data.filter((d: any) => d.risk_level === 'Critical').length,
    };
  } catch {
    return { autoResolved: 0, approvalRequired: 0, escalated: 0, criticalIncidents: 0 };
  }
}
