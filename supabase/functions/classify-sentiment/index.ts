import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const POSITIVE_WORDS = [
  "thank", "thanks", "appreciate", "grateful", "great", "excellent", "amazing",
  "wonderful", "fantastic", "love", "happy", "pleased", "satisfied", "good job",
  "well done", "perfect", "awesome", "best", "smooth", "quick", "efficient",
  "helpful", "kind", "polite", "professional"
];

const NEGATIVE_WORDS = [
  "angry", "frustrated", "disappointed", "terrible", "awful", "horrible",
  "worst", "hate", "unacceptable", "ridiculous", "pathetic", "useless",
  "broken", "not working", "failed", "error", "issue", "problem", "complaint",
  "delay", "late", "slow", "unresponsive", "ignored", "neglected", "urgent",
  "asap", "immediately", "critical", "outrageous", "unfair", "discrimination"
];

const NEGATIVE_PHRASES = [
  "not happy", "very disappointed", "extremely frustrated", "fed up",
  "cannot tolerate", "unprofessional", "lack of", "poor service",
  "no response", "never again", "waste of time", "regret"
];

function classifySentiment(subject: string, body: string): { sentiment: string; confidence: number; score: number } {
  const text = (subject + " " + body).toLowerCase();

  let positiveScore = 0;
  let negativeScore = 0;

  for (const word of POSITIVE_WORDS) {
    const regex = new RegExp(`\\b${word.toLowerCase()}\\b`, "g");
    const matches = text.match(regex);
    if (matches) positiveScore += matches.length;
  }

  for (const word of NEGATIVE_WORDS) {
    const regex = new RegExp(`\\b${word.toLowerCase()}\\b`, "g");
    const matches = text.match(regex);
    if (matches) negativeScore += matches.length;
  }

  for (const phrase of NEGATIVE_PHRASES) {
    if (text.includes(phrase.toLowerCase())) negativeScore += 2;
  }

  // Exclamation marks can indicate strong emotion
  const exclamationCount = (text.match(/!/g) || []).length;
  if (exclamationCount > 2) negativeScore += 1;

  // ALL CAPS words indicate shouting/anger
  const capsWords = text.match(/\b[A-Z]{3,}\b/g);
  if (capsWords && capsWords.length > 2) negativeScore += 2;

  const score = positiveScore - negativeScore;
  const total = positiveScore + negativeScore;

  let sentiment: string;
  let confidence: number;

  if (score > 1) {
    sentiment = "positive";
    confidence = Math.min(50 + score * 15, 99);
  } else if (score < -1) {
    sentiment = "negative";
    confidence = Math.min(50 + Math.abs(score) * 15, 99);
  } else {
    sentiment = "neutral";
    confidence = total > 0 ? 60 : 80;
  }

  return { sentiment, confidence, score };
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

    const result = classifySentiment(subject, body);

    return new Response(
      JSON.stringify({
        sentiment: result.sentiment,
        confidence: result.confidence,
        score: result.score,
        agent: "SentimentAgent",
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
