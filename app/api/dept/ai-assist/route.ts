/**
 * POST /api/dept/ai-assist
 *
 * Redesigned as an engineer assistant — NOT an email composer.
 *
 * Types:
 *   suggest_steps  — Structured analysis: Issue Summary, Current Status,
 *                    Resolution Steps, Verification, Risks, Next Action.
 *                    Uses real ticket/approval/workflow context.
 *                    Sensitive fields → [placeholder] format only.
 *   checklist      — Troubleshooting checklist (engineer-facing)
 *   similar_cases  — Vector/text search against resolved_cases
 *   summarize      — 3-4 sentence internal ticket summary
 *
 * Body:
 *   { type, ticketBody, department, intent, employeeName,
 *     workItemContext? }
 *
 * workItemContext (for suggest_steps):
 *   { status, priority, assignedTo, acceptedAt, startedAt,
 *     approvalStatus, approvedBy, approvedAt, riskLevel, aiReason,
 *     logs: [{action, actor, note, createdAt}] }
 */
import { NextRequest, NextResponse } from 'next/server';
import { findSimilarResolvedCases } from '@/lib/agents';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

// ── Gemini key lookup ─────────────────────────────────────────────────────────

async function getGeminiKey(): Promise<string | null> {
  try {
    const { data } = await supabaseAdmin
      .from('ai_settings')
      .select('gemini_api_key')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    return data?.gemini_api_key ?? null;
  } catch { return null; }
}

async function callGemini(prompt: string, apiKey: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.3, maxOutputTokens: 1800, candidateCount: 1 },
        }),
      }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null;
  } catch { return null; }
}

// ── Suggest Resolution Steps — engineer assistant prompt ──────────────────────

function buildEngineerAssistantPrompt(params: {
  intent: string;
  department: string;
  employeeName: string;
  ticketBody: string;
  workflowStatus: string;
  workflowPriority: string;
  assignedTo: string;
  acceptedAt: string;
  startedAt: string;
  approvalStatus: string;
  approvedBy: string;
  approvedAt: string;
  riskLevel: string;
  aiReason: string;
  logSummary: string;
  ragContext: string;
}): string {
  const {
    intent, department, employeeName, ticketBody,
    workflowStatus, workflowPriority, assignedTo,
    acceptedAt, startedAt,
    approvalStatus, approvedBy, approvedAt, riskLevel, aiReason,
    logSummary, ragContext,
  } = params;

  return `You are an internal IT/HR engineer assistant helping a helpdesk engineer resolve a support ticket.

CRITICAL RULES — READ BEFORE ANYTHING ELSE:
1. You are assisting the ENGINEER, not communicating with the employee. Do NOT write an email or message to the employee.
2. NEVER invent, fabricate, or guess: credentials, SAP IDs, usernames, passwords, VPN URLs, API keys, software licenses, system names, ticket IDs, approval reference numbers, or any value not explicitly provided below.
3. For ANY step that requires sensitive system data not provided here, output ONLY a labelled placeholder, e.g.:
     SAP User ID: [Engineer enters manually]
     Temporary Password: [Engineer enters manually]
     VPN URL: [Engineer enters manually]
     License Key: [Engineer enters manually]
4. Base your analysis ONLY on the data provided. If information is absent, say "Not available" or "Confirm with employee."
5. Do NOT contradict the approval status or workflow stage shown below.
6. Output must follow the EXACT 6-section structure below, with the exact headers.

════════════════════════════════════════
TICKET DATA (authoritative — do not contradict)
════════════════════════════════════════
Employee: ${employeeName}
Department: ${department}
Intent / Request Type: ${intent}
Original Request:
${ticketBody}

APPROVAL HISTORY:
  Status: ${approvalStatus}
  Approved by: ${approvedBy}
  Approved at: ${approvedAt}
  Risk level: ${riskLevel}
  AI rationale: ${aiReason}

CURRENT WORKFLOW STATE:
  Status: ${workflowStatus}
  Priority: ${workflowPriority}
  Assigned to: ${assignedTo}
  Accepted at: ${acceptedAt}
  Work started at: ${startedAt}

WORK LOG (chronological):
${logSummary || '  (no entries yet)'}

KNOWLEDGE BASE CONTEXT (internal reference only):
${ragContext || '  (none available)'}

════════════════════════════════════════
REQUIRED OUTPUT FORMAT (use exactly these headers):
════════════════════════════════════════

## Issue Summary
(2-3 sentences. What is being requested and why it matters. Based only on ticket data above.)

## Current Status
(One sentence describing the live workflow stage and who owns it.)

## Recommended Resolution Steps
(Numbered list. Each step must be concrete and actionable for the engineer.
 For any step needing system credentials, IDs, or URLs not provided, add a placeholder line:
   [Field name]: [Engineer enters manually]
 Do NOT make up any system values.)

## Required Human Verification
(List items the engineer must physically verify or confirm before proceeding — e.g., identity check, manager confirmation, system access validation.)

## Risks
(Bullet list of risks IF any apply — SLA breach, data sensitivity, escalation triggers. If none, write "No significant risks identified.")

## Next Action
(Single most important next step for the engineer right now, given the current workflow stage.)`;
}

// ── RAG context fetch (reuse same Supabase-based approach) ────────────────────

async function fetchRagContext(query: string): Promise<string> {
  try {
    const { data } = await supabaseAdmin
      .from('document_chunks')
      .select('content, documents(title)')
      .textSearch('content', query.slice(0, 200), { type: 'websearch' })
      .limit(3);
    if (!data || data.length === 0) return '';
    return data
      .map((r: any, i: number) => `[${i + 1}] ${r.documents?.title ?? 'KB'}: ${String(r.content).slice(0, 350)}`)
      .join('\n\n');
  } catch { return ''; }
}

// ── Resolution Email Draft prompt ─────────────────────────────────────────────

function buildResolutionEmailPrompt(params: {
  employeeName: string;
  employeeEmail: string;
  department: string;
  intent: string;
  assignedTo: string;
  completedAt: string;
  ticketBody: string;
  logSummary: string;
}): string {
  const { employeeName, employeeEmail, department, intent, assignedTo, completedAt, ticketBody, logSummary } = params;

  return `You are helping an engineer compose a formal closure email to send to an employee after their support request has been resolved.

RULES:
1. Write ONLY the email body (greeting to sign-off). Do not add headers or metadata.
2. For any system-specific values (IDs, passwords, URLs, access codes, license keys) write a PLACEHOLDER in this exact format:
   [Field label — Engineer enters before sending]
   Example:
   Your SAP User ID is: [SAP User ID — Engineer enters before sending]
   Login URL: [System URL — Engineer enters before sending]
3. Do NOT invent any technical values. Use placeholders faithfully.
4. Tone: professional, warm, concise.
5. End with:
   Best regards,
   ${assignedTo || '[Your Name — Engineer enters before sending]'}
   HelpDesk Support Team

TICKET DATA:
  Employee name: ${employeeName}
  Employee email: ${employeeEmail}
  Department: ${department}
  Request type: ${intent}
  Resolved at: ${completedAt}

Original request:
${ticketBody}

Work performed (engineer notes — summarise for employee without exposing internal detail):
${logSummary}

Write the email body now:`;
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { type, ticketBody, department, intent, employeeName, workItemContext } = body;

    if (!type || !ticketBody) {
      return NextResponse.json({ error: 'type and ticketBody are required' }, { status: 400 });
    }

    // ── suggest_steps — grounded engineer assistant ───────────────────────────
    if (type === 'suggest_steps') {
      const ctx = workItemContext ?? {};
      const ragContext = await fetchRagContext(`${intent} ${ticketBody}`);
      const geminiKey = await getGeminiKey();

      const logSummary = (ctx.logs ?? [])
        .map((l: any) => `  • [${l.createdAt ? new Date(l.createdAt).toLocaleString() : 'unknown time'}] ${l.action} by ${l.actor}${l.note ? ` — ${l.note}` : ''}`)
        .join('\n');

      const prompt = buildEngineerAssistantPrompt({
        intent:          intent ?? 'Support request',
        department:      department ?? 'Unknown',
        employeeName:    employeeName ?? 'Employee',
        ticketBody:      ticketBody ?? '',
        workflowStatus:  ctx.status ?? 'unknown',
        workflowPriority: ctx.priority ?? 'medium',
        assignedTo:      ctx.assignedTo ?? 'Unassigned',
        acceptedAt:      ctx.acceptedAt ? new Date(ctx.acceptedAt).toLocaleString() : 'Not yet accepted',
        startedAt:       ctx.startedAt ? new Date(ctx.startedAt).toLocaleString() : 'Not yet started',
        approvalStatus:  ctx.approvalStatus ?? 'approved',
        approvedBy:      ctx.approvedBy ?? 'Manager (see approval record)',
        approvedAt:      ctx.approvedAt ? new Date(ctx.approvedAt).toLocaleString() : 'See approval record',
        riskLevel:       ctx.riskLevel ?? 'Unknown',
        aiReason:        ctx.aiReason ?? 'Not available',
        logSummary,
        ragContext,
      });

      let result = '';
      if (geminiKey) {
        result = (await callGemini(prompt, geminiKey)) ?? '';
      }

      if (!result) {
        // Structured fallback — never fabricates values
        result = `## Issue Summary
${employeeName ?? 'The employee'} has submitted a "${intent ?? 'support'}" request to the ${department ?? ''} department. The request has been approved and is currently in the "${ctx.status ?? 'assigned'}" stage.

## Current Status
This ticket is currently **${ctx.status ?? 'assigned'}** and assigned to ${ctx.assignedTo ?? 'an engineer'}. No AI key is configured — connect a Gemini API key in Settings for full analysis.

## Recommended Resolution Steps
1. Review the original employee request carefully.
2. [System-specific step]: [Engineer enters manually]
3. Verify employee identity if system access is involved.
4. [Credentials or access details]: [Engineer enters manually]
5. Perform the required action and document each step in the work log.
6. Submit for quality review when complete.

## Required Human Verification
- Confirm employee identity against HR records.
- Verify manager approval is on record (see Approval History).
- Confirm any access being granted is within policy scope.

## Risks
- Ensure SLA deadline is not breached.
- Sensitive data access must be logged per policy.

## Next Action
Accept this ticket (if not already done), review the approval record, and begin gathering the required system access details to proceed.`;
      }

      return NextResponse.json({ result, type: 'suggest_steps' });
    }

    // ── checklist ─────────────────────────────────────────────────────────────
    if (type === 'checklist') {
      const geminiKey = await getGeminiKey();
      const prompt = `You are an engineer assistant. Generate a troubleshooting checklist for the engineer resolving this ticket.

Department: ${department ?? 'IT/HR'}
Request type: ${intent ?? 'support request'}
Employee request: ${ticketBody}

Output a numbered checklist of 6-10 concrete, actionable verification steps for the engineer.
Format each as:
[ ] Step description

Do NOT invent credentials, IDs, or system URLs. Use [Engineer enters manually] for any specific values.`;

      let result = '';
      if (geminiKey) result = (await callGemini(prompt, geminiKey)) ?? '';
      if (!result) result = `[ ] Read original employee request in full\n[ ] Check approval status and approver\n[ ] Verify employee identity\n[ ] Identify required system(s) for this request\n[ ] Check department SLA deadline\n[ ] Document each action in the work log\n[ ] Confirm with employee before finalising access or changes\n[ ] Submit for quality review`;

      return NextResponse.json({ result, type: 'checklist' });
    }

    // ── similar_cases ─────────────────────────────────────────────────────────
    if (type === 'similar_cases') {
      const cases = await findSimilarResolvedCases(ticketBody, department ?? '');
      return NextResponse.json({ result: cases, type: 'similar_cases' });
    }

    // ── summarize ─────────────────────────────────────────────────────────────
    if (type === 'summarize') {
      const geminiKey = await getGeminiKey();
      const prompt = `Summarise this internal support ticket for the engineer in 3-4 sentences. Include what is requested, why it matters, and any risk context. Do not write to the employee — this is an internal note.

Department: ${department ?? 'unknown'}
Employee: ${employeeName ?? 'employee'}
Request type: ${intent ?? 'support request'}
Request: ${ticketBody}`;

      let result = '';
      if (geminiKey) result = (await callGemini(prompt, geminiKey)) ?? '';
      if (!result) result = `Ticket from ${employeeName ?? 'employee'} in ${department ?? 'department'} regarding: ${intent ?? ticketBody.slice(0, 120)}.`;

      return NextResponse.json({ result, type: 'summarize' });
    }

    // ── resolution_email (used by the resolution email API route too) ─────────
    if (type === 'resolution_email') {
      const ctx = workItemContext ?? {};
      const geminiKey = await getGeminiKey();

      const logSummary = (ctx.logs ?? [])
        .filter((l: any) => ['started', 'completed', 'verified', 'commented'].includes(l.action))
        .map((l: any) => `  • ${l.action}: ${l.note ?? l.action}`)
        .join('\n');

      const prompt = buildResolutionEmailPrompt({
        employeeName:  employeeName ?? 'Employee',
        employeeEmail: ctx.employeeEmail ?? '',
        department:    department ?? '',
        intent:        intent ?? 'support request',
        assignedTo:    ctx.assignedTo ?? '',
        completedAt:   ctx.completedAt ? new Date(ctx.completedAt).toLocaleString() : new Date().toLocaleString(),
        ticketBody,
        logSummary,
      });

      let result = '';
      if (geminiKey) result = (await callGemini(prompt, geminiKey)) ?? '';
      if (!result) {
        result = `Dear ${employeeName ?? 'Employee'},

We are pleased to inform you that your request regarding "${intent ?? 'your support request'}" has been successfully resolved.

Resolution details:
[Resolution summary — Engineer enters before sending]

[If any credentials/access were provisioned:]
Account details:
  User ID: [User ID — Engineer enters before sending]
  System URL: [URL — Engineer enters before sending]
  Temporary password: [Password — Engineer enters before sending]

Please log in and verify access at your earliest convenience. If you experience any issues, reply to this email or raise a new support ticket.

Best regards,
${ctx.assignedTo || '[Your Name — Engineer enters before sending]'}
HelpDesk Support Team`;
      }

      return NextResponse.json({ result, type: 'resolution_email' });
    }

    return NextResponse.json({ error: `Unknown type: ${type}` }, { status: 400 });
  } catch (err: any) {
    console.error('[dept/ai-assist]', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
