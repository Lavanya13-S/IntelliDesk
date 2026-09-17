import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const CRITICAL_KEYWORDS = [
  "urgent", "asap", "immediately", "critical", "down", "outage", "broken",
  "cannot work", "blocked", "emergency", "security breach", "data loss",
  "fired", "termination", "legal notice", "lawsuit", "compliance violation",
  "salary not credited", "payroll issue", "hacked", "phishing", "ransomware"
];

const HIGH_KEYWORDS = [
  "high priority", "important", "deadline", "expiring", "license expired",
  "access denied", "locked out", "vpn not working", "cannot login",
  "system crash", "production issue", "client complaint", "escalation",
  "manager approval", "ceo", "director", "vp"
];

const LOW_KEYWORDS = [
  "whenever", "no rush", "suggestion", "feedback", "nice to have",
  "improvement", "future", "optional", "low priority", "not urgent"
];

function classifyPriority(subject: string, body: string): { priority: string; confidence: number; reasoning: string } {
  const text = (subject + " " + body).toLowerCase();

  let criticalScore = 0;
  let highScore = 0;
  let lowScore = 0;

  for (const kw of CRITICAL_KEYWORDS) {
    if (text.includes(kw.toLowerCase())) criticalScore += 2;
  }
  for (const kw of HIGH_KEYWORDS) {
    if (text.includes(kw.toLowerCase())) highScore += 1;
  }
  for (const kw of LOW_KEYWORDS) {
    if (text.includes(kw.toLowerCase())) lowScore += 1;
  }

  // Negative sentiment boost
  const negativeWords = ["not working", "broken", "error", "failed", "issue", "problem", "complaint", "frustrated", "angry", "disappointed"];
  let negativeScore = 0;
  for (const w of negativeWords) {
    if (text.includes(w)) negativeScore++;
  }

  if (criticalScore > 0 || negativeScore >= 3) {
    return {
      priority: "critical",
      confidence: Math.min(60 + criticalScore * 10 + negativeScore * 5, 99),
      reasoning: `Critical keywords found: ${criticalScore > 0 ? "yes" : "no"}. Negative sentiment score: ${negativeScore}.`,
    };
  }

  if (highScore > 0 || negativeScore >= 2) {
    return {
      priority: "high",
      confidence: Math.min(60 + highScore * 10 + negativeScore * 5, 99),
      reasoning: `High priority keywords found: ${highScore > 0 ? "yes" : "no"}. Negative sentiment score: ${negativeScore}.`,
    };
  }

  if (lowScore > 0) {
    return {
      priority: "low",
      confidence: Math.min(60 + lowScore * 10, 99),
      reasoning: "Low priority keywords detected.",
    };
  }

  return {
    priority: "medium",
    confidence: 70,
    reasoning: "No strong priority indicators. Defaulting to medium.",
  };
}

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

    const result = classifyPriority(subject, body);

    return new Response(
      JSON.stringify({
        priority: result.priority,
        confidence: result.confidence,
        reasoning: result.reasoning,
        agent: "PriorityAgent",
        timestamp: new Date().toISOString(),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
