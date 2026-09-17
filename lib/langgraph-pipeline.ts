/**
 * LangGraph Agent Pipeline for IntelliDesk AI
 *
 * Replaces the sequential fetch-based pipeline with a proper
 * LangGraph StateGraph with typed state, per-node retries, and
 * Supabase-backed persistence.
 *
 * Graph topology:
 *   email → intent → priority → sentiment → department →
 *   subteam → knowledge → similar_cases → action → response →
 *   decision → email_db → approval → learning
 */

import { StateGraph, Annotation } from '@langchain/langgraph';
import { runDecisionAgent, storeDecisionLog } from './agents';
import { createClient } from '@supabase/supabase-js';
import { buildGeminiTaxonomyContext, getIntentNames, IntentDefinition } from './ai/classification-taxonomy';
import { classifyByTaxonomy, resolvePriority, INTENT_TAXONOMY } from './ai/classification-engine';

// ─── Supabase client (server-side) ────────────────────────────────────────────
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// ─── Pipeline State ───────────────────────────────────────────────────────────
export const PipelineState = Annotation.Root({
  // Input
  emailId: Annotation<string>({ reducer: (_, b) => b }),
  subject: Annotation<string>({ reducer: (_, b) => b }),
  body: Annotation<string>({ reducer: (_, b) => b }),
  attachmentSummary: Annotation<string | null>({ reducer: (_, b) => b, default: () => null }),

  // Classification results
  intent: Annotation<string>({ reducer: (_, b) => b, default: () => '' }),
  intentConfidence: Annotation<number>({ reducer: (_, b) => b, default: () => 0 }),
  priority: Annotation<string>({ reducer: (_, b) => b, default: () => 'medium' }),
  priorityReasoning: Annotation<string>({ reducer: (_, b) => b, default: () => '' }),
  sentiment: Annotation<string>({ reducer: (_, b) => b, default: () => 'neutral' }),
  sentimentScore: Annotation<number>({ reducer: (_, b) => b, default: () => 0 }),
  department: Annotation<string>({ reducer: (_, b) => b, default: () => 'IT' }),
  departmentReasoning: Annotation<string>({ reducer: (_, b) => b, default: () => '' }),
  subteam: Annotation<string>({ reducer: (_, b) => b, default: () => 'General' }),
  subteamReasoning: Annotation<string>({ reducer: (_, b) => b, default: () => '' }),

  // Sender context (for approval workflow)
  senderEmail: Annotation<string>({ reducer: (_, b) => b, default: () => '' }),

  // Derived
  ticketId: Annotation<string | null>({ reducer: (_, b) => b, default: () => null }),
  knowledgeContext: Annotation<string>({ reducer: (_, b) => b, default: () => '' }),
  similarCasesContext: Annotation<string>({ reducer: (_, b) => b, default: () => '' }),
  actions: Annotation<string[]>({ reducer: (_, b) => b, default: () => [] }),
  generatedResponse: Annotation<string>({ reducer: (_, b) => b, default: () => '' }),

  // Decision & Escalation Agent output
  decisionType: Annotation<string>({ reducer: (_, b) => b, default: () => '' }),     // AUTO_RESPONSE | HUMAN_APPROVAL_REQUIRED | ESCALATE
  decisionResult: Annotation<string>({ reducer: (_, b) => b, default: () => '' }),   // JSON-serialised DecisionResult

  // Status
  errors: Annotation<string[]>({ reducer: (a, b) => [...a, ...b], default: () => [] }),
  stage: Annotation<string>({ reducer: (_, b) => b, default: () => 'init' }),
  completed: Annotation<boolean>({ reducer: (_, b) => b, default: () => false }),
});

export type PipelineStateType = typeof PipelineState.State;

// ─── Retry Wrapper ────────────────────────────────────────────────────────────
async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  delayMs = 500
): Promise<T | null> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      console.warn(`[LangGraph] Retry ${attempt}/${maxRetries} — ${err.message}`);
      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, delayMs * attempt));
      }
    }
  }
  return null;
}

// ─── Gemini Helpers ───────────────────────────────────────────────────────────
async function getGeminiKey(): Promise<string | null> {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
  try {
    const { data } = await supabase
      .from('ai_settings')
      .select('gemini_api_key')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    return data?.gemini_api_key || null;
  } catch {
    return null;
  }
}

async function callGemini(prompt: string, apiKey: string, temperature = 0.1): Promise<string | null> {
  return withRetry(async () => {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature, maxOutputTokens: 1024 },
        }),
      }
    );
    if (!res.ok) throw new Error(`Gemini HTTP ${res.status}`);
    const data = await res.json();
    return data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? null;
  });
}

// ─── Node: Email Agent ────────────────────────────────────────────────────────
async function emailAgentNode(state: PipelineStateType): Promise<Partial<PipelineStateType>> {
  // Validates email data is present; future: fetch from Gmail
  if (!state.emailId || !state.subject) {
    return { errors: ['EmailAgent: Missing emailId or subject'], stage: 'email' };
  }
  return { stage: 'email' };
}

// ─── Node: Intent Agent (taxonomy-guided) ─────────────────────────────────────
async function intentAgentNode(state: PipelineStateType): Promise<Partial<PipelineStateType>> {
  const apiKey = await getGeminiKey();

  if (apiKey) {
    const intentList = getIntentNames().join(', ');
    const taxonomyCtx = buildGeminiTaxonomyContext();
    const prompt = `Classify the intent of this employee support email.
Return ONLY one intent name exactly as listed.

AVAILABLE INTENTS:
${intentList}

${taxonomyCtx}

CRITICAL RULES:
- ANY leave/time off/absence request = "Emergency Leave Request" or "Leave / Time Off Request" etc. — all go to HR.
- "emergency" in leave context = leave intent, NOT IT emergency.
- "laptop" relates to hardware, not PTO/leave.
- Return only the exact intent string, nothing else.

Subject: ${state.subject}
Body: ${state.body.slice(0, 600)}

Return ONLY the exact intent name:`;

    const result = await callGemini(prompt, apiKey);
    if (result) {
      const trimmed = result.trim();
      return { intent: trimmed, intentConfidence: 0.92, stage: 'intent' };
    }
  }

  // Taxonomy engine fallback — word-boundary-safe scoring
  const taxResult = classifyByTaxonomy(state.subject, state.body);
  return {
    intent: taxResult.intent,
    intentConfidence: taxResult.confidence,
    stage: 'intent',
  };
}

// ─── Node: Priority Agent (taxonomy-driven) ──────────────────────────────────
async function priorityAgentNode(state: PipelineStateType): Promise<Partial<PipelineStateType>> {
  // Find the taxonomy definition matching the current intent
  const taxDef = INTENT_TAXONOMY.find(
    (d: IntentDefinition) => d.intent.toLowerCase() === (state.intent || '').toLowerCase()
  );

  if (taxDef) {
    const normalizedText = (state.subject + ' ' + state.body).toLowerCase();
    const { priority, reasoning } = resolvePriority(taxDef, normalizedText);
    return { priority, priorityReasoning: reasoning, stage: 'priority' };
  }

  // Fallback if intent not in taxonomy (safety net)
  const text = (state.subject + ' ' + state.body).toLowerCase();
  const isLeaveOrHR = /\bleave\b|\btime off\b|\bvacation\b|\babsence\b|\bsalary\b|\bpayroll\b|\bresign\b/i.test(text);
  if (text.includes('emergency') && isLeaveOrHR) {
    return { priority: 'medium', priorityReasoning: 'Emergency leave — medium priority (standard HR process).', stage: 'priority' };
  }
  if (/outage|system down|production down|all users|data breach/i.test(text)) {
    return { priority: 'critical', priorityReasoning: 'System outage or security incident.', stage: 'priority' };
  }
  if (/urgent|asap|deadline/i.test(text)) {
    return { priority: 'high', priorityReasoning: 'Urgency signal detected.', stage: 'priority' };
  }
  return { priority: 'medium', priorityReasoning: 'Default medium priority.', stage: 'priority' };
}



// ─── Node: Sentiment Agent ────────────────────────────────────────────────────
async function sentimentAgentNode(state: PipelineStateType): Promise<Partial<PipelineStateType>> {
  const text = (state.subject + ' ' + state.body).toLowerCase();
  const pos = ['thank', 'appreciate', 'great', 'happy', 'pleased', 'excellent'].filter((w) => text.includes(w)).length;
  const neg = ['frustrated', 'angry', 'terrible', 'awful', 'worst', 'unacceptable', 'not working'].filter((w) => text.includes(w)).length;

  let sentiment = 'neutral', score = 0;
  if (neg > pos) { sentiment = 'negative'; score = -0.6; }
  else if (pos > neg) { sentiment = 'positive'; score = 0.6; }

  return { sentiment, sentimentScore: score, stage: 'sentiment' };
}

// ─── Node: Department Agent (taxonomy-driven) ────────────────────────────────
async function departmentAgentNode(state: PipelineStateType): Promise<Partial<PipelineStateType>> {
  // Find the taxonomy definition matching the current intent
  const taxDef = INTENT_TAXONOMY.find(
    (d: IntentDefinition) => d.intent.toLowerCase() === (state.intent || '').toLowerCase()
  );

  if (taxDef) {
    return {
      department: taxDef.department,
      departmentReasoning: `Intent "${taxDef.intent}" maps to ${taxDef.department} via taxonomy.`,
      stage: 'department',
    };
  }

  // Fallback: run full taxonomy engine on the raw text
  const taxResult = classifyByTaxonomy(state.subject, state.body);
  return {
    department: taxResult.department,
    departmentReasoning: taxResult.reasoning,
    stage: 'department',
  };
}



// ─── Node: Subteam Agent (taxonomy-driven) ─────────────────────────────────
async function subteamAgentNode(state: PipelineStateType): Promise<Partial<PipelineStateType>> {
  // First: look up subteam directly from taxonomy by intent
  const taxDef = INTENT_TAXONOMY.find(
    (d: IntentDefinition) => d.intent.toLowerCase() === (state.intent || '').toLowerCase()
  );
  if (taxDef) {
    return {
      subteam: taxDef.subteam,
      subteamReasoning: `Intent "${taxDef.intent}" maps to ${taxDef.subteam} via taxonomy.`,
      stage: 'subteam',
    };
  }

  // Fallback: derive subteam from department
  let subteam = 'General';
  if (state.department === 'IT') subteam = 'End User Support';
  else if (state.department === 'HR') subteam = 'HR Support';
  else if (state.department === 'Finance') subteam = 'Finance Support';
  else if (state.department === 'Facilities') subteam = 'Facilities Support';

  return {
    subteam,
    subteamReasoning: `Fallback subteam assignment for department "${state.department}".`,
    stage: 'subteam',
  };
}



// ─── Node: Knowledge Agent (RAG) ──────────────────────────────────────────────
async function knowledgeAgentNode(state: PipelineStateType): Promise<Partial<PipelineStateType>> {
  try {
    const query = `${state.intent} ${state.subject} ${state.body}`.slice(0, 500);

    // Fetch embedding via API
    const embRes = await withRetry(() =>
      fetch(`${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/generate-embedding`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: query }),
      }).then((r) => r.json())
    );

    let knowledgeContext = '';

    if (embRes?.embedding) {
      const { data: chunks } = await supabase.rpc('match_document_chunks', {
        query_embedding: embRes.embedding,
        match_threshold: 0.25,
        match_count: 3,
      });

      if (chunks && chunks.length > 0) {
        // Fetch document titles
        const docIds = Array.from(new Set<string>(chunks.map((c: any) => c.document_id)));
        const { data: docs } = await supabase
          .from('documents')
          .select('id, title')
          .in('id', docIds);
        const titleMap: Record<string, string> = {};
        (docs ?? []).forEach((d: any) => { titleMap[d.id] = d.title; });

        knowledgeContext = chunks
          .map((c: any, i: number) => `[${i + 1}] From "${titleMap[c.document_id] ?? 'Document'}": ${c.chunk_text.slice(0, 400)}`)
          .join('\n\n');
      }
    }

    return { knowledgeContext, stage: 'knowledge' };
  } catch (err) {
    console.error('[KnowledgeAgent] error:', err);
    return { knowledgeContext: '', stage: 'knowledge' };
  }
}

// ─── Node: Similar Case Agent ──────────────────────────────────────────────────
async function similarCasesAgentNode(state: PipelineStateType): Promise<Partial<PipelineStateType>> {
  try {
    const query = `${state.subject} ${state.body}`.slice(0, 500);
    const embRes = await withRetry(() =>
      fetch(`${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/generate-embedding`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: query }),
      }).then((r) => r.json())
    );

    let similarCasesContext = '';

    if (embRes?.embedding) {
      const { data: cases } = await supabase.rpc('match_resolved_cases', {
        query_embedding: embRes.embedding,
        match_threshold: 0.3,
        match_count: 2,
      });

      if (cases && cases.length > 0) {
        similarCasesContext = cases
          .map((c: any, i: number) =>
            `[Case ${i + 1}] ${c.intent}: ${(c.final_response ?? '').slice(0, 300)}`
          )
          .join('\n\n');
      }
    }

    return { similarCasesContext, stage: 'similar_cases' };
  } catch (err) {
    console.error('[SimilarCaseAgent] error:', err);
    return { similarCasesContext: '', stage: 'similar_cases' };
  }
}

// ─── Node: Action Agent ───────────────────────────────────────────────────────
async function actionAgentNode(state: PipelineStateType): Promise<Partial<PipelineStateType>> {
  const n = state.intent.toLowerCase();
  let actions: string[] = [];

  if (n.includes('password') || n.includes('reset'))
    actions = ['Verify employee identity', `Send reset instructions via secure channel to ${state.subteam}`, 'Escalate if reset fails 3 times'];
  else if (n.includes('leave') || n.includes('vacation'))
    actions = ['Check leave balance', 'Forward to manager for approval', 'Update leave management system'];
  else if (n.includes('vpn') || n.includes('remote'))
    actions = ['Verify remote eligibility', `Provision VPN via ${state.subteam}`, 'Send setup guide'];
  else if (n.includes('laptop') || n.includes('hardware'))
    actions = ['Run remote diagnostics', `Assign to ${state.subteam}`, 'Schedule replacement if unrepairable'];
  else if (n.includes('payroll') || n.includes('salary'))
    actions = ['Verify payroll records', `Escalate to ${state.subteam} if discrepancy`, 'Process correction in next cycle'];
  else if (n.includes('insurance') || n.includes('medical'))
    actions = ['Review benefits policy', `Forward to ${state.subteam}`, 'Provide claim checklist'];
  else
    actions = [`Categorize under ${state.department}`, `Assign to ${state.subteam}`, 'Follow up within 24 hours'];

  return { actions, stage: 'action' };
}

// ─── Node: Response Agent (Gemini) ────────────────────────────────────────────
async function responseAgentNode(state: PipelineStateType): Promise<Partial<PipelineStateType>> {
  const apiKey = await getGeminiKey();

  const toneMap: Record<string, string> = {
    professional: 'professional and courteous',
    friendly: 'warm and friendly',
    empathetic: 'empathetic and understanding',
    formal: 'formal and structured',
    concise: 'brief, using bullet points',
  };

  if (apiKey) {
    const prompt = `You are IntelliDesk Support, an enterprise employee helpdesk AI.
Write a professional email response. Start directly with the greeting. Never mention AI, RAG, embeddings, or internal systems.

EMPLOYEE REQUEST:
Subject: ${state.subject}
Message: ${state.body.slice(0, 600)}

CLASSIFICATION:
- Intent: ${state.intent}
- Department: ${state.department} — ${state.subteam}
- Priority: ${state.priority}
- Sentiment: ${state.sentiment}
${state.knowledgeContext ? `\nINTERNAL REFERENCE:\n${state.knowledgeContext}` : ''}
${state.similarCasesContext ? `\nSIMILAR PAST CASES:\n${state.similarCasesContext}` : ''}
${state.attachmentSummary ? `\nATTACHMENT CONTEXT:\n${state.attachmentSummary}` : ''}

End with exactly:
Best regards,
IntelliDesk Support Team

Write the email:`;

    const response = await callGemini(prompt, apiKey, 0.7);
    if (response) {
      const cleaned = response
        .replace(/\{\{[^}]+\}\}/g, '')
        .replace(/\[Source:.*?\]/gi, '')
        .replace(/\[Context.*?\]/gi, '')
        .trim();
      return { generatedResponse: cleaned, stage: 'response' };
    }
  }

  // Structured fallback
  const fallback = `Dear Employee,\n\nThank you for contacting IntelliDesk Support.\n\nWe have received your ${state.intent.toLowerCase()} request and it has been assigned to our ${state.subteam} team in the ${state.department} department. A team member will review your request and respond within 24 hours.\n\nRecommended next steps:\n${state.actions.map((a, i) => `${i + 1}. ${a}`).join('\n')}\n\nBest regards,\nIntelliDesk Support Team`;

  return { generatedResponse: fallback, stage: 'response' };
}

// ─── Node: Decision & Escalation Agent ─────────────────────────────────────
async function decisionAgentNode(state: PipelineStateType): Promise<Partial<PipelineStateType>> {
  try {
    const result = await runDecisionAgent(
      state.intent,
      state.priority,
      state.sentiment,
      state.department,
      state.subteam,
      state.subject,
      state.body,
      state.knowledgeContext
    );
    return {
      decisionType: result.decision,
      decisionResult: JSON.stringify(result),
      stage: 'decision',
    };
  } catch (err: any) {
    console.error('[DecisionAgent] node error:', err);
    // Failsafe — never auto-respond if decision agent errors
    return {
      decisionType: 'HUMAN_APPROVAL_REQUIRED',
      decisionResult: JSON.stringify({
        decision: 'HUMAN_APPROVAL_REQUIRED', confidence: 50, risk: 'Medium',
        requires_human: true, reason: 'Decision agent error — defaulted to human review.'
      }),
      stage: 'decision',
    };
  }
}

// ─── Node: Approval Check (persist to DB) ────────────────────────────────────
async function approvalNode(state: PipelineStateType): Promise<Partial<PipelineStateType>> {
  if (!state.ticketId) return { stage: 'approval' };

  try {
    // Persist generated response for human review
    const { data: resp } = await supabase
      .from('responses')
      .insert({
        ticket_id: state.ticketId,
        response: state.generatedResponse,
        approved: false,
        draft_mode: false,
        tone: 'professional',
        generated_by: 'langgraph',
      })
      .select('id')
      .single();

    if (resp?.id) {
      await supabase.from('approvals').insert({
        response_id: resp.id,
        status: 'pending',
        requested_by: 'langgraph_pipeline',
        approved_by: null,
        notes: null,
      });
    }
  } catch (err) {
    console.error('[ApprovalNode] error:', err);
  }

  return { stage: 'approval' };
}

// ─── Node: Email Node (ticket + actions DB writes) ────────────────────────────
async function emailDatabaseNode(state: PipelineStateType): Promise<Partial<PipelineStateType>> {
  try {
    // Resolve final values from Decision Agent output FIRST
    // then update email with the CORRECTED values (not the raw pre-decision state.*)
    let finalDept = state.department;
    let finalSubteam = state.subteam;
    let finalPriority = state.priority;
    let ticketStatus = 'open';

    let parsedDecision: any = null;
    if (state.decisionResult) {
      try {
        parsedDecision = JSON.parse(state.decisionResult);
        if (parsedDecision.department) finalDept = parsedDecision.department;
        if (parsedDecision.subteam) finalSubteam = parsedDecision.subteam;
        if (parsedDecision.risk === 'Critical') finalPriority = 'critical';
        else if (parsedDecision.risk === 'High' && finalPriority !== 'critical') finalPriority = 'high';

        if (state.decisionType === 'AUTO_RESPONSE') ticketStatus = 'processing';
        else if (state.decisionType === 'ESCALATE') ticketStatus = 'escalated';
        else ticketStatus = 'open'; // HUMAN_APPROVAL_REQUIRED
      } catch { /* ignore parse errors — keep defaults */ }
    }

    // Update email with CORRECTED classification (uses finalDept/finalSubteam/finalPriority,
    // NOT state.department/state.subteam/state.priority which are pre-decision values)
    await supabase
      .from('emails')
      .update({
        status: 'processing',
        intent: state.intent,
        priority: finalPriority,
        sentiment: state.sentiment,
        department: finalDept,
        subteam: finalSubteam,
      })
      .eq('id', state.emailId);

    // Create ticket
    const { data: ticket } = await supabase
      .from('tickets')
      .insert({
        email_id: state.emailId,
        intent: state.intent,
        department: finalDept,
        subteam: finalSubteam,
        priority: finalPriority,
        sentiment: state.sentiment,
        status: ticketStatus,
      })
      .select('id')
      .single();

    const ticketId = ticket?.id ?? null;

    // Structured classification log — confirms which ticketId this classification is stored against
    if (ticketId) {
      console.log(
        `[AI_CLASSIFICATION] ticketId=${ticketId} emailId=${state.emailId} ` +
        `intent="${state.intent}" department="${finalDept}" subteam="${finalSubteam}" ` +
        `priority="${finalPriority}" sentiment="${state.sentiment}" ` +
        `decision="${state.decisionType}" risk="${parsedDecision?.risk ?? 'Unknown'}" ` +
        `confidence=${parsedDecision?.confidence ?? 0} pipeline=langgraph`
      );
      if (parsedDecision?.department) {
        console.log(
          `[ROUTING] ticketId=${ticketId} department="${finalDept}" subteam="${finalSubteam}" ` +
          `decision="${state.decisionType}" assignedTeam="${parsedDecision.department}/${parsedDecision.subteam ?? ''}"`
        );
      }
    }

    // Store actions
    if (ticketId) {
      for (const action of state.actions) {
        await supabase.from('actions').insert({
          ticket_id: ticketId,
          recommended_action: action,
        });
      }

      // Persist decision log (self-learning + audit trail)
      if (parsedDecision) {
        await storeDecisionLog(ticketId, parsedDecision);
      }

      // Fire decision-specific notifications
      if (state.decisionType === 'ESCALATE' && parsedDecision) {
        try {
          await supabase.from('notifications').insert({
            type: 'critical',
            title: `🚨 ESCALATE — ${parsedDecision.risk || 'High'} Risk`,
            message: `"${state.subject}" escalated to ${parsedDecision.department || finalDept} — ${parsedDecision.subteam || finalSubteam}. Reason: ${parsedDecision.reason || 'Requires human specialist.'}`,
            ticket_id: ticketId,
            email_id: state.emailId,
            read: false,
          });
        } catch { /* notification failure is non-critical */ }

        // ── ESCALATE: Create approval request so workflow UI has the record it needs ──
        // Without this, the Workflow Status card in email-detail.tsx never renders
        // for escalated tickets (ticketApproval is null).
        if (state.decisionType === 'ESCALATE' && parsedDecision) {
          let senderEmailForEscalate = state.senderEmail;
          if (!senderEmailForEscalate && state.emailId) {
            try {
              const { data: emailRow } = await supabase
                .from('emails')
                .select('sender')
                .eq('id', state.emailId)
                .maybeSingle();
              senderEmailForEscalate = (emailRow as any)?.sender ?? '';
            } catch { /* non-fatal */ }
          }
          if (senderEmailForEscalate) {
            const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
            fetch(`${appUrl}/api/approvals/create`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                ticketId,
                emailId: state.emailId,
                senderEmail: senderEmailForEscalate,
                subject: state.subject,
                body: state.body,
                decisionCtx: {
                  intent: state.intent,
                  priority: finalPriority,
                  risk: parsedDecision.risk ?? 'Critical',
                  reason: parsedDecision.reason ?? 'Requires immediate specialist escalation.',
                  confidence: parsedDecision.confidence ?? 99,
                  department: finalDept,
                  subteam: finalSubteam,
                },
              }),
            }).catch((err) => console.warn('[LangGraph] ESCALATE approval create failed (non-fatal):', err));
          }
        }
      } else if (state.decisionType === 'HUMAN_APPROVAL_REQUIRED') {
        try {
          await supabase.from('notifications').insert({
            type: 'approval_required',
            title: '⏳ Manager Approval Required',
            message: `"${state.subject}" requires manager approval before sending. Confidence: ${parsedDecision?.confidence || '—'}%.`,
            ticket_id: ticketId,
            email_id: state.emailId,
            read: false,
          });
        } catch { /* notification failure is non-critical */ }

        // ── Trigger Enterprise Approval Workflow ────────────────────────────────
        // Resolve sender email: prefer state.senderEmail, fallback to emails table
        let senderEmail = state.senderEmail;
        if (!senderEmail && state.emailId) {
          try {
            const { data: emailRow } = await supabase
              .from('emails')
              .select('sender')
              .eq('id', state.emailId)
              .maybeSingle();
            senderEmail = (emailRow as any)?.sender ?? '';
          } catch { /* non-fatal */ }
        }

        if (ticketId && senderEmail) {
          const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
          try {
            await fetch(`${appUrl}/api/approvals/create`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                ticketId,
                emailId: state.emailId,
                senderEmail,
                subject: state.subject,
                body: state.body,
                decisionCtx: {
                  intent: state.intent,
                  priority: finalPriority,
                  risk: parsedDecision?.risk ?? 'Medium',
                  reason: parsedDecision?.reason ?? 'Requires human approval.',
                  confidence: parsedDecision?.confidence ?? 50,
                  department: finalDept,
                  subteam: finalSubteam,
                },
              }),
            });
            console.log(`[LangGraph] Approval request created for ticket ${ticketId}`);
          } catch (approvalErr: any) {
            console.warn('[LangGraph] Approval creation failed (non-fatal):', approvalErr.message);
          }
        }
      }
    }

    return { ticketId, stage: 'email_db' };
  } catch (err: any) {
    console.error('[EmailDatabaseNode] error:', err);
    return { errors: [`EmailDatabaseNode: ${err.message}`], stage: 'email_db' };
  }
}

// ─── Node: Learning Node ──────────────────────────────────────────────────────
async function learningNode(state: PipelineStateType): Promise<Partial<PipelineStateType>> {
  // Resolved cases are stored after send — this node logs the pipeline run
  console.log(`[LangGraph] Pipeline complete for email ${state.emailId} — Stage: ${state.stage}`);
  return { completed: true, stage: 'complete' };
}

// ─── Build and Compile the Graph ──────────────────────────────────────────────
export function buildPipeline() {
  const graph = new StateGraph(PipelineState)
    .addNode('email', emailAgentNode)
    .addNode('intent', intentAgentNode)
    .addNode('priority', priorityAgentNode)
    .addNode('sentiment', sentimentAgentNode)
    .addNode('department', departmentAgentNode)
    .addNode('subteam', subteamAgentNode)
    .addNode('knowledge', knowledgeAgentNode)
    .addNode('similar_cases', similarCasesAgentNode)
    .addNode('action', actionAgentNode)
    .addNode('response', responseAgentNode)
    .addNode('decision', decisionAgentNode)
    .addNode('email_db', emailDatabaseNode)
    .addNode('approval', approvalNode)
    .addNode('learning', learningNode)
    .addEdge('__start__', 'email')
    .addEdge('email', 'intent')
    .addEdge('intent', 'priority')
    .addEdge('priority', 'sentiment')
    .addEdge('sentiment', 'department')
    .addEdge('department', 'subteam')
    .addEdge('subteam', 'knowledge')
    .addEdge('knowledge', 'similar_cases')
    .addEdge('similar_cases', 'action')
    .addEdge('action', 'response')
    .addEdge('response', 'decision')
    .addEdge('decision', 'email_db')
    .addEdge('email_db', 'approval')
    .addEdge('approval', 'learning')
    .addEdge('learning', '__end__');

  return graph.compile();
}

// ─── Run Pipeline ─────────────────────────────────────────────────────────────
export async function runLangGraphPipeline(params: {
  emailId: string;
  subject: string;
  body: string;
  attachmentSummary?: string;
  senderEmail?: string;
}): Promise<PipelineStateType | null> {
  try {
    const pipeline = buildPipeline();
    const result = await pipeline.invoke({
      emailId: params.emailId,
      subject: params.subject,
      body: params.body,
      attachmentSummary: params.attachmentSummary ?? null,
      senderEmail: params.senderEmail ?? '',
    });
    return result as PipelineStateType;
  } catch (err: any) {
    console.error('[LangGraph] Pipeline failed:', err);
    return null;
  }
}
