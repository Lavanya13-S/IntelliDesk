import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Deno global declaration for Node-based TypeScript tooling
declare const Deno: {
  serve(handler: (req: Request) => Response | Promise<Response>): void;
  env: { get(key: string): string | undefined };
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

// ─── Gemini Classification ────────────────────────────────────────────────────

/**
 * Attempts to classify the email using Gemini 1.5 Flash.
 * Returns null if key is missing or API call fails — falls back to rule-based.
 */
async function geminiClassify(subject: string, body: string, apiKey: string): Promise<any | null> {
  const prompt = `You are an enterprise HR/IT helpdesk email classifier. Analyze the employee email below and return ONLY a valid JSON object with these exact fields. No explanation, no markdown, no extra text.

{
  "intent": "<specific request type from the list below>",
  "priority": "<low | medium | high | critical>",
  "sentiment": "<positive | neutral | negative>",
  "department": "<IT | HR | Finance | Legal & Compliance | Facilities>",
  "subteam": "<specific team name>"
}

INTENT OPTIONS (choose the closest match):
Password Reset, VPN / Remote Access, Network / WiFi Issue, Hardware / Laptop Issue, Software Installation, Email / Outlook Issue, Leave / Time Off Request, Payroll / Salary Issue, Insurance / Medical Claim, SAP / ERP Access, Training / Course Request, Resignation / Exit, Career / Promotion, Transfer / Relocation, Expense Reimbursement, ID Card / Badge, Meeting Room Booking, MFA / Two-Factor Auth, General Inquiry

PRIORITY GUIDE:
- critical: system outage, security breach, data loss, complete work blockage
- high: urgent deadline, manager/executive involved, escalation language
- medium: standard issue, normal timeline
- low: suggestion, no rush, nice to have

DEPARTMENT / SUBTEAM GUIDE:
- IT: Infrastructure, End User Support, Security, Network Operations
- HR: Talent Management, Compensation & Benefits, Employee Relations, L&D
- Finance: Accounts Payable, Financial Planning, Audit, Treasury
- Legal & Compliance: Contracts, Data Privacy, Regulatory Affairs
- Facilities: Office Management, Maintenance, Reception

Employee Email:
Subject: ${subject}
Body: ${body}

Return ONLY the JSON:`;

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 256 },
        }),
      }
    );

    if (!res.ok) return null;

    const data = await res.json();
    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";

    // Extract JSON from response (handle markdown code blocks if present)
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]);

    // Validate required fields are present
    if (!parsed.intent || !parsed.priority || !parsed.sentiment || !parsed.department || !parsed.subteam) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

// ─── Rule-based Classification (Fallback) ─────────────────────────────────────

function classifyIntent(subject: string, body: string): { intent: string; confidence: number } {
  const text = (subject + " " + body).toLowerCase();

  const intentRules: Array<{ keywords: string[]; intent: string }> = [
    { keywords: ["password", "reset", "forgot", "login", "locked out", "account access"], intent: "Password Reset" },
    { keywords: ["vpn", "remote access", "work from home", "wfh"], intent: "VPN / Remote Access" },
    { keywords: ["wifi", "internet", "network", "connection", "offline", "connectivity"], intent: "Network / WiFi Issue" },
    { keywords: ["laptop", "computer", "hardware", "device", "broken", "screen", "keyboard"], intent: "Hardware / Laptop Issue" },
    { keywords: ["software", "install", "license", "application", "app", "program"], intent: "Software Installation" },
    { keywords: ["email", "outlook", "mailbox", "mail", "inbox"], intent: "Email / Outlook Issue" },
    { keywords: ["leave", "vacation", "time off", "sick", "holiday", "pto"], intent: "Leave / Time Off Request" },
    { keywords: ["payroll", "salary", "pay", "wage", "compensation", "payment"], intent: "Payroll / Salary Issue" },
    { keywords: ["insurance", "medical", "health", "claim", "hospital", "doctor"], intent: "Insurance / Medical Claim" },
    { keywords: ["sap", "erp", "system access", "portal"], intent: "SAP / ERP Access" },
    { keywords: ["training", "course", "certification", "learn", "skill"], intent: "Training / Course Request" },
    { keywords: ["resignation", "quit", "notice", "leaving", "exit"], intent: "Resignation / Exit" },
    { keywords: ["promotion", "career", "growth", "advancement"], intent: "Career / Promotion" },
    { keywords: ["transfer", "relocation", "move", "shift"], intent: "Transfer / Relocation" },
    { keywords: ["reimbursement", "expense", "travel", "claim"], intent: "Expense Reimbursement" },
    { keywords: ["id card", "badge", "access card"], intent: "ID Card / Badge" },
    { keywords: ["meeting room", "conference", "booking"], intent: "Meeting Room Booking" },
    { keywords: ["mfa", "two factor", "authenticator", "2fa"], intent: "MFA / Two-Factor Auth" },
  ];

  let bestIntent = "General Inquiry";
  let bestScore = 0;

  for (const rule of intentRules) {
    let score = 0;
    for (const kw of rule.keywords) {
      if (text.includes(kw)) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      bestIntent = rule.intent;
    }
  }

  const confidence = Math.min(bestScore * 0.25 + 0.5, 0.95);
  return { intent: bestIntent, confidence: bestScore > 0 ? confidence : 0.5 };
}

function classifyPriority(subject: string, body: string): { priority: string; confidence: number; reasoning: string } {
  const text = (subject + " " + body).toLowerCase();

  const criticalWords = ["urgent", "critical", "down", "outage", "security breach", "data loss", "cannot work", "blocked", "emergency"];
  const highWords = ["asap", "important", "deadline", "high priority", "escalate", "manager", "ceo", "director"];
  const lowWords = ["whenever", "no rush", "low priority", "nice to have", "suggestion", "feedback"];

  let criticalScore = 0, highScore = 0, lowScore = 0;
  for (const w of criticalWords) if (text.includes(w)) criticalScore++;
  for (const w of highWords) if (text.includes(w)) highScore++;
  for (const w of lowWords) if (text.includes(w)) lowScore++;

  if (criticalScore > 0) return { priority: "critical", confidence: 0.9, reasoning: `Detected ${criticalScore} critical keyword(s): system down, security, or emergency language.` };
  if (highScore > 0) return { priority: "high", confidence: 0.8, reasoning: `Detected ${highScore} high-priority keyword(s): urgent timeline or escalation language.` };
  if (lowScore > 0) return { priority: "low", confidence: 0.7, reasoning: `Detected ${lowScore} low-priority keyword(s): no rush or suggestion language.` };
  return { priority: "medium", confidence: 0.6, reasoning: "No strong priority indicators found. Defaulting to medium." };
}

function classifySentiment(subject: string, body: string): { sentiment: string; confidence: number; score: number } {
  const text = (subject + " " + body).toLowerCase();

  const positiveWords = ["thank", "appreciate", "great", "excellent", "happy", "pleased", "good", "love", "best"];
  const negativeWords = ["frustrated", "angry", "disappointed", "terrible", "awful", "worst", "hate", "broken", "useless", "unacceptable", "slow", "not working", "failed"];

  let posScore = 0, negScore = 0;
  for (const w of positiveWords) if (text.includes(w)) posScore++;
  for (const w of negativeWords) if (text.includes(w)) negScore++;

  if (negScore > posScore) return { sentiment: "negative", confidence: 0.6 + negScore * 0.1, score: -0.3 - negScore * 0.1 };
  if (posScore > negScore) return { sentiment: "positive", confidence: 0.6 + posScore * 0.1, score: 0.3 + posScore * 0.1 };
  return { sentiment: "neutral", confidence: 0.7, score: 0 };
}

function classifyDepartment(intent: string, subject: string, body: string): { department: string; subteam: string; confidence: number; reasoning: string } {
  const text = (subject + " " + body + " " + intent).toLowerCase();

  const deptMap: Array<{ keywords: string[]; dept: string; subteams: string[] }> = [
    { keywords: ["password", "login", "account", "mfa", "vpn", "remote access", "email", "outlook", "software", "install", "laptop", "computer", "hardware", "wifi", "network", "internet"], dept: "IT", subteams: ["Infrastructure", "End User Support", "Security", "Network Operations"] },
    { keywords: ["leave", "vacation", "payroll", "salary", "insurance", "medical", "training", "resignation", "promotion", "transfer", "id card", "badge"], dept: "HR", subteams: ["Talent Management", "Compensation & Benefits", "Employee Relations", "L&D"] },
    { keywords: ["sap", "erp", "finance", "expense", "reimbursement", "invoice", "budget", "payment"], dept: "Finance", subteams: ["Accounts Payable", "Financial Planning", "Audit", "Treasury"] },
    { keywords: ["legal", "compliance", "policy", "contract", "gdpr", "regulation"], dept: "Legal & Compliance", subteams: ["Contracts", "Data Privacy", "Regulatory Affairs"] },
    { keywords: ["facility", "office", "meeting room", "cafeteria", "parking", "cleaning"], dept: "Facilities", subteams: ["Office Management", "Maintenance", "Reception"] },
  ];

  let bestDept = "IT";
  let bestScore = 0;

  for (const rule of deptMap) {
    let score = 0;
    for (const kw of rule.keywords) {
      if (text.includes(kw)) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      bestDept = rule.dept;
    }
  }

  const matchedRule = deptMap.find((r) => r.dept === bestDept);
  let subteam = matchedRule?.subteams[0] || "General";

  if (matchedRule) {
    if (text.includes("network") || text.includes("wifi") || text.includes("internet")) subteam = "Network Operations";
    else if (text.includes("password") || text.includes("login") || text.includes("mfa") || text.includes("account")) subteam = "Security";
    else if (text.includes("laptop") || text.includes("computer") || text.includes("hardware")) subteam = "End User Support";
    else if (text.includes("server") || text.includes("cloud") || text.includes("infrastructure")) subteam = "Infrastructure";
    else if (text.includes("leave") || text.includes("vacation")) subteam = "Employee Relations";
    else if (text.includes("pay") || text.includes("salary") || text.includes("insurance")) subteam = "Compensation & Benefits";
    else if (text.includes("training") || text.includes("course")) subteam = "L&D";
  }

  const confidence = Math.min(bestScore * 0.2 + 0.5, 0.95);
  return { department: bestDept, subteam, confidence, reasoning: `Matched ${bestScore} keywords for ${bestDept} department.` };
}

// ─── Handler ──────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const { subject, body } = await req.json();

    if (!subject || !body) {
      return new Response(
        JSON.stringify({ error: "Missing subject or body" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const geminiKey = Deno.env.get("GEMINI_API_KEY");

    // ── Primary: Gemini AI Classification ────────────────────────────────────
    if (geminiKey) {
      const aiResult = await geminiClassify(subject, body, geminiKey);

      if (aiResult) {
        const sentimentScore =
          aiResult.sentiment === "positive" ? 0.7 :
          aiResult.sentiment === "negative" ? -0.7 : 0;

        return new Response(
          JSON.stringify({
            intent: aiResult.intent,
            intentConfidence: 0.92,
            priority: aiResult.priority,
            priorityConfidence: 0.90,
            priorityReasoning: "Gemini AI classification",
            sentiment: aiResult.sentiment,
            sentimentConfidence: 0.90,
            sentimentScore,
            department: aiResult.department,
            departmentConfidence: 0.92,
            departmentReasoning: "Gemini AI classification",
            subteam: aiResult.subteam,
            subteamConfidence: 0.90,
            subteamReasoning: "Gemini AI classification",
            classified_by: "gemini",
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // ── Fallback: Rule-based Classification ───────────────────────────────────
    const intentResult = classifyIntent(subject, body);
    const priorityResult = classifyPriority(subject, body);
    const sentimentResult = classifySentiment(subject, body);
    const deptResult = classifyDepartment(intentResult.intent, subject, body);

    return new Response(
      JSON.stringify({
        intent: intentResult.intent,
        intentConfidence: intentResult.confidence,
        priority: priorityResult.priority,
        priorityConfidence: priorityResult.confidence,
        priorityReasoning: priorityResult.reasoning,
        sentiment: sentimentResult.sentiment,
        sentimentConfidence: sentimentResult.confidence,
        sentimentScore: sentimentResult.score,
        department: deptResult.department,
        departmentConfidence: deptResult.confidence,
        departmentReasoning: deptResult.reasoning,
        subteam: deptResult.subteam,
        subteamConfidence: deptResult.confidence,
        subteamReasoning: deptResult.reasoning,
        classified_by: "rules",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
