import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { buildGeminiTaxonomyContext, getIntentNames } from '../../../lib/ai/classification-taxonomy';
import { classifyByTaxonomy } from '../../../lib/ai/classification-engine';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// ─── SENSITIVE ISSUE SAFETY GUARD ─────────────────────────────────────────────
// This runs BEFORE Gemini and BEFORE all keyword rules.
// If the email matches a credible workplace harassment / abuse /
// discrimination / retaliation report, classification is forced to
// HR → Employee Relations / ESCALATE — overriding all AI output.
// This is deterministic and inviolable.

const SENSITIVE_ISSUE_PATTERN =
  /harass(ment|ing)?|sexual[\s\-]+harass|inappropriat[e\w]*[\s\S]{0,60}behav(iour|ior)|discriminat(ion|ory|ed?)?|retaliat(ion|e|ing)?|bully(ing)?|hostile[\s\-]+work[\s\-]+environment|abuse[\s\S]{0,40}(colleague|manager|supervisor|coworker)|misconduct|threatening[\s\S]{0,40}(workplace|colleague|conduct)|confidential[\s\S]{0,30}(hr|complaint)|workplace[\s\S]{0,30}complaint|unfair[\s\S]{0,30}treatment|unwanted[\s\S]{0,30}(contact|advance|attention)/i;

function checkSensitiveIssue(subject: string, body: string): boolean {
  return SENSITIVE_ISSUE_PATTERN.test(subject + ' ' + body);
}

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

// ─── Gemini Classification (taxonomy-guided) ──────────────────────────────────

async function geminiClassify(subject: string, body: string, apiKey: string): Promise<any | null> {
  const taxonomyContext = buildGeminiTaxonomyContext();
  const intentList = getIntentNames().slice(0, 60).join('\n  - ');

  const prompt = `You are an expert enterprise helpdesk AI classifier for IntelliDesk.
Classify the employee's support request using the centralized taxonomy below.

CRITICAL RULES — FOLLOW EVERY RULE:
1. Classify based on WHAT THE EMPLOYEE IS ACTUALLY ASKING FOR — not surface keywords.
2. INTENT FIRST: Determine intent before deciding department. Never go keyword → department.
3. "emergency" in a LEAVE context = HR / Leave Management, priority = medium. NOT critical IT.
4. "emergency" in an IT/server/system context = IT / Infrastructure, priority = critical.
5. "urgent salary" = Finance / Payroll. Not IT.
6. "urgent leave" = HR / Leave Management. Not IT.
7. Words like "request", "urgent", "issue", "problem", "help", "need" alone do NOT determine department.
8. 'PTO' as standalone = paid time off (HR). It does NOT match inside the word 'laptop'.
9. "General Inquiry" is ONLY used when nothing else fits and confidence is very low.
10. Return ONLY valid JSON. No markdown, no explanation outside JSON.

AVAILABLE INTENTS (pick exactly one):
  - ${intentList}

${taxonomyContext}

PRIORITY RULES:
- emergency leave → medium (urgent for employee, but standard HR process)
- emergency security breach / malware / account hacked → critical
- system outage affecting all users → critical
- salary not received → high
- laptop broken → high (employee cannot work)
- wifi slow → medium
- parking request → low

RISK (separate from priority):
- harassment, data breach, account compromise, lost device → Critical risk
- salary discrepancy, SAP authorization → High risk
- leave request, standard IT request → Low or Medium risk

DECISION:
- Leave requests → APPROVAL_REQUIRED
- Harassment / security breach / payroll missing → ESCALATE
- Standard IT support (password reset, wifi, laptop repair) → DEPARTMENT_PROCESSING
- SAP access, expense claim, software license → APPROVAL_REQUIRED
- Unknown or ambiguous → HUMAN_REVIEW

EMPLOYEE REQUEST:
Subject: ${subject}
Body: ${body}

Return ONLY this JSON:
{
  "intent": "<exact intent name from the list above>",
  "priority": "<low | medium | high | critical>",
  "sentiment": "<positive | neutral | negative>",
  "department": "<IT | HR | Finance | Facilities | Legal & Compliance>",
  "subteam": "<specific subteam from taxonomy>",
  "riskLevel": "<Low | Medium | High | Critical>",
  "decision": "<APPROVAL_REQUIRED | ESCALATE | DEPARTMENT_PROCESSING | AUTO_RESOLVE | HUMAN_REVIEW>",
  "confidence": <0.0 to 1.0>,
  "reasoning": "<one sentence explaining your classification>",
  "recommendedActions": ["<action 1>", "<action 2>"]
}`;

  try {
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
    if (!res.ok) {
      console.error('[classify-all] Gemini error:', res.status, await res.text());
      return null;
    }
    const data = await res.json();
    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const jsonText = rawText.replace(/```json\n?/gi, '').replace(/```\n?/gi, '').trim();
    const jsonMatch = jsonText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]);
    if (!parsed.intent || !parsed.priority || !parsed.sentiment || !parsed.department || !parsed.subteam) return null;
    return parsed;
  } catch (err) {
    console.error('[classify-all] geminiClassify error:', err);
    return null;
  }
}

// ─── POST Handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const { subject, body } = await req.json();
    if (!subject || !body) return NextResponse.json({ error: 'Missing subject or body' }, { status: 400 });

    // ── STEP 0: SENSITIVE ISSUE SAFETY GUARD (inviolable) ──────────────────
    if (checkSensitiveIssue(subject, body)) {
      console.log('[classify-all] Sensitive issue guard triggered — forcing HR / Employee Relations / ESCALATE');
      return NextResponse.json({
        intent: 'Workplace Harassment Complaint',
        intentConfidence: 0.99,
        priority: 'critical',
        priorityConfidence: 0.99,
        priorityReasoning: 'Sensitive issue safety guard — workplace harassment / misconduct complaint',
        sentiment: 'negative',
        sentimentConfidence: 0.95,
        sentimentScore: -0.8,
        department: 'HR',
        departmentConfidence: 0.99,
        departmentReasoning: 'Sensitive issue safety guard — HR Employee Relations required',
        subteam: 'Employee Relations',
        subteamConfidence: 0.99,
        subteamReasoning: 'Sensitive issue safety guard — Employee Relations required for misconduct',
        riskLevel: 'Critical',
        decision: 'ESCALATE',
        confidence: 0.99,
        reasoning: 'Workplace harassment or misconduct detected. Immediate confidential HR investigation required.',
        recommendedActions: [
          'Route immediately to HR Employee Relations for confidential handling',
          'Do NOT send automated response — human specialist required',
          'Notify HR Business Partner and Legal as per policy',
          'Document all communications confidentially',
        ],
        classified_by: 'sensitive_guard',
      });
    }

    const geminiKey = await getGeminiKey();

    // ── STEP 1: Gemini (taxonomy-guided prompt) ─────────────────────────────
    if (geminiKey) {
      const aiResult = await geminiClassify(subject, body, geminiKey);
      if (aiResult) {
        const sentimentScore = aiResult.sentiment === 'positive' ? 0.7 : aiResult.sentiment === 'negative' ? -0.7 : 0;
        const confidence = typeof aiResult.confidence === 'number' ? aiResult.confidence : 0.92;
        const riskLevel = aiResult.riskLevel ?? 'Medium';
        const decision = aiResult.decision ?? 'DEPARTMENT_PROCESSING';

        console.log(
          `[AI_CLASSIFICATION] classified_by=gemini intent="${aiResult.intent}" ` +
          `department="${aiResult.department}" subteam="${aiResult.subteam}" ` +
          `priority="${aiResult.priority}" riskLevel="${riskLevel}" ` +
          `decision="${decision}" confidence=${confidence.toFixed(2)}`
        );

        return NextResponse.json({
          intent: aiResult.intent,
          intentConfidence: confidence,
          priority: aiResult.priority,
          priorityConfidence: confidence,
          priorityReasoning: aiResult.reasoning || 'Gemini AI semantic classification',
          sentiment: aiResult.sentiment,
          sentimentConfidence: 0.90,
          sentimentScore,
          department: aiResult.department,
          departmentConfidence: confidence,
          departmentReasoning: aiResult.reasoning || 'Gemini AI semantic classification',
          subteam: aiResult.subteam,
          subteamConfidence: confidence,
          subteamReasoning: aiResult.reasoning || 'Gemini AI semantic classification',
          riskLevel,
          decision,
          confidence,
          reasoning: aiResult.reasoning || '',
          recommendedActions: aiResult.recommendedActions || [],
          classified_by: 'gemini',
        });
      }
    }

    // ── STEP 2: Taxonomy engine fallback ────────────────────────────────────
    // Word-boundary-safe semantic scoring from centralized INTENT_TAXONOMY.
    // No ad-hoc keyword lists — everything comes from classification-taxonomy.ts.
    const taxResult = classifyByTaxonomy(subject, body);

    console.log(
      `[AI_CLASSIFICATION] classified_by=taxonomy intent="${taxResult.intent}" ` +
      `department="${taxResult.department}" subteam="${taxResult.subteam}" ` +
      `priority="${taxResult.priority}" riskLevel="${taxResult.riskLevel}" ` +
      `decision="${taxResult.decision}" confidence=${taxResult.confidence.toFixed(2)}`
    );

    return NextResponse.json({
      intent: taxResult.intent,
      intentConfidence: taxResult.confidence,
      priority: taxResult.priority,
      priorityConfidence: taxResult.confidence,
      priorityReasoning: taxResult.priorityReasoning,
      sentiment: taxResult.sentiment,
      sentimentConfidence: taxResult.sentimentConfidence,
      sentimentScore: taxResult.sentimentScore,
      department: taxResult.department,
      departmentConfidence: taxResult.confidence,
      departmentReasoning: taxResult.reasoning,
      subteam: taxResult.subteam,
      subteamConfidence: taxResult.confidence,
      subteamReasoning: taxResult.reasoning,
      riskLevel: taxResult.riskLevel,
      decision: taxResult.decision,
      confidence: taxResult.confidence,
      reasoning: taxResult.reasoning,
      recommendedActions: taxResult.recommendedActions,
      classified_by: taxResult.classified_by,
    });
  } catch (err: any) {
    console.error('[classify-all] Unhandled error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
