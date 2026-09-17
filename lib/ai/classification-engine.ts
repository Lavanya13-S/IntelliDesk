/**
 * lib/ai/classification-engine.ts
 *
 * Deterministic rule-based classification engine.
 * Consumes the centralized INTENT_TAXONOMY from classification-taxonomy.ts.
 *
 * Algorithm:
 *   1. Normalize input text (lowercase, trim)
 *   2. Score each intent by counting semantic token matches using word boundaries
 *   3. Apply negative exclusion penalties
 *   4. Boost score for phrase-level matches
 *   5. Return best-scoring intent with confidence
 *
 * This engine is used when:
 *   - Gemini API is unavailable
 *   - As a conflict-resolution layer when Gemini confidence is low
 *   - By LangGraph nodes that need deterministic routing
 *
 * WORD BOUNDARY SAFETY:
 *   All token matching uses \b word-boundary regex to prevent false positives
 *   such as 'pto' matching inside 'laptop'.
 */

import {
  INTENT_TAXONOMY,
  IntentDefinition,
  Priority,
  RiskLevel,
  Decision,
  getTaxonomyByIntent,
} from './classification-taxonomy';

// Re-export INTENT_TAXONOMY so consumers can import everything from one place
export { INTENT_TAXONOMY };

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ClassificationResult {
  intent: string;
  intentId: string;
  department: string;
  subteam: string;
  priority: Priority;
  priorityReasoning: string;
  riskLevel: RiskLevel;
  sentiment: string;
  sentimentConfidence: number;
  sentimentScore: number;
  decision: Decision;
  confidence: number;
  reasoning: string;
  recommendedActions: string[];
  classified_by: 'rules' | 'gemini' | 'sensitive_guard' | 'taxonomy';
}

// ─── Word-Boundary Token Matching ─────────────────────────────────────────────

/**
 * Returns true if the token is found in text as a complete word/phrase.
 * Uses \b word boundaries to prevent substring false positives.
 * e.g., 'pto' will NOT match inside 'laptop'.
 */
function tokenMatchesText(token: string, normalizedText: string): boolean {
  // Escape special regex characters in the token
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Replace spaces with \s+ to handle variations
  const pattern = escaped.replace(/\s+/g, '\\s+');
  const regex = new RegExp(`(?:^|\\b|\\s)${pattern}(?:\\b|\\s|$)`, 'i');
  return regex.test(normalizedText);
}

/**
 * Count how many tokens from a list match the text (word-boundary safe).
 */
function countTokenMatches(tokens: string[], text: string): number {
  return tokens.filter((token) => tokenMatchesText(token, text)).length;
}

/**
 * Count negative exclusion matches (word-boundary safe).
 * Used to penalize an intent's score.
 */
function countNegativeMatches(exclusions: string[], text: string): number {
  return exclusions.filter((excl) => tokenMatchesText(excl, text)).length;
}

// ─── Text Normalization ───────────────────────────────────────────────────────

/**
 * Normalize text: lowercase, remove excess whitespace, decode common contractions.
 */
function normalizeText(subject: string, body: string): string {
  const combined = `${subject} ${body}`;
  return combined
    .toLowerCase()
    .replace(/won't/g, 'will not')
    .replace(/can't/g, 'cannot')
    .replace(/i'm/g, 'i am')
    .replace(/i've/g, 'i have')
    .replace(/i'd/g, 'i would')
    .replace(/it's/g, 'it is')
    .replace(/doesn't/g, 'does not')
    .replace(/didn't/g, 'did not')
    .replace(/isn't/g, 'is not')
    .replace(/wasn't/g, 'was not')
    .replace(/\s+/g, ' ')
    .trim();
}

// ─── Scoring ──────────────────────────────────────────────────────────────────

interface IntentScore {
  def: IntentDefinition;
  rawScore: number;
  normalizedScore: number;
  negativeHits: number;
  effectiveScore: number;
}

/**
 * Score all intents against the normalized text.
 * Returns array sorted by effectiveScore descending.
 * When two intents have similar scores, the more specific intent (fewer tokens) wins.
 */
function scoreAllIntents(normalizedText: string): IntentScore[] {
  const scores: IntentScore[] = [];

  for (const def of INTENT_TAXONOMY) {
    // Skip the general fallback in initial scoring
    if (def.id === 'corporate.general') continue;

    const rawScore = countTokenMatches(def.semanticTokens, normalizedText);
    const totalTokens = def.semanticTokens.length;
    const normalizedScore = totalTokens > 0 ? rawScore / totalTokens : 0;
    const negativeHits = countNegativeMatches(def.negativeExclusions, normalizedText);

    // Penalty: each negative exclusion match reduces score by 40%
    const penalty = negativeHits * 0.40;
    const effectiveScore = Math.max(0, normalizedScore - penalty);

    if (rawScore > 0) {
      scores.push({ def, rawScore, normalizedScore, negativeHits, effectiveScore });
    }
  }

  // Sort by effectiveScore descending, using rawScore as tiebreaker
  scores.sort((a, b) => {
    const scoreDiff = b.effectiveScore - a.effectiveScore;
    if (Math.abs(scoreDiff) > 0.001) return scoreDiff;
    // Tiebreaker: prefer the intent with more raw matches (stronger evidence)
    return b.rawScore - a.rawScore;
  });
  return scores;
}

// ─── Context-Aware Priority ───────────────────────────────────────────────────

const URGENCY_BOOST_TOKENS = ['urgent', 'immediately', 'asap', 'right now', 'critical', 'emergency'];
const CRITICAL_CONTEXT_TOKENS = ['production down', 'all users', 'company-wide', 'entire organization',
  'data breach', 'account hacked', 'malware', 'ransomware', 'stolen laptop', 'lost device'];

/**
 * Determine context-aware priority.
 * Starts from the taxonomy default and adjusts based on contextual signals.
 * IMPORTANT: 'emergency' alone does NOT mean critical unless the intent is a genuine emergency.
 */
export function resolvePriority(
  def: IntentDefinition,
  normalizedText: string
): { priority: Priority; reasoning: string } {
  let priority: Priority = def.defaultPriority;
  let reasoning = `Default priority for ${def.intent}`;

  // Critical context overrides
  const criticalHits = CRITICAL_CONTEXT_TOKENS.filter((t) => normalizedText.includes(t)).length;
  if (criticalHits > 0 && priority !== 'critical') {
    // Only escalate to critical for appropriate departments
    if (['IT', 'Finance'].includes(def.department) || def.defaultRisk === 'Critical') {
      priority = 'critical';
      reasoning = `Critical context detected (${CRITICAL_CONTEXT_TOKENS.find((t) => normalizedText.includes(t))})`;
    }
  }

  // Urgency boost — only for non-HR leave requests and non-low priority intents
  const urgencyHits = URGENCY_BOOST_TOKENS.filter((t) => normalizedText.includes(t)).length;
  const isLeaveIntent = def.id.startsWith('hr.leave');
  if (urgencyHits > 0 && !isLeaveIntent && priority === 'low') {
    priority = 'medium';
    reasoning = `Urgency signal detected — boosted from low to medium`;
  }

  // HR leave: 'emergency' = medium (NOT critical) — the leave is urgent, not an IT emergency
  if (isLeaveIntent) {
    if (priority === 'critical') {
      priority = 'medium';
      reasoning = `Leave request — 'emergency' signals urgency, not IT criticality. Priority: medium`;
    }
    // Ensure leave is never boosted above medium
    if (priority === 'high') {
      priority = 'medium';
      reasoning = `Leave request — priority capped at medium`;
    }
  }

  // Phishing with credentials entered = critical priority
  if (def.id === 'security.phishing' && /entered.*credentials|clicked.*link.*entered|gave.*credentials|submitted.*login|entered.*password.*phishing/i.test(normalizedText)) {
    priority = 'critical';
    reasoning = `Phishing with credential entry detected — critical priority`;
  }

  // Number of affected users signals
  if (/multiple users|all employees|entire floor|whole office/i.test(normalizedText)) {
    if (priority === 'medium') priority = 'high';
    if (priority === 'low') priority = 'medium';
    reasoning = `Multiple users affected — boosted priority`;
  }

  return { priority, reasoning };
}

/**
 * Determine risk level from intent definition and context.
 * IMPORTANT: Not all security-related issues are Critical risk.
 * Only genuine active breaches, malware, account compromise = Critical.
 * Policy violations, vulnerability reports, phishing reports = High.
 */
export function resolveRisk(def: IntentDefinition, normalizedText: string): RiskLevel {
  // Explicitly Critical-risk taxonomy intents — return immediately
  if (def.defaultRisk === 'Critical') return 'Critical';

  // Genuine account compromise / active breach patterns = Critical
  if (
    def.id === 'security.account' ||
    def.id === 'security.incident' ||
    def.id === 'security.malware' ||
    def.id === 'security.device_lost'
  ) {
    return 'Critical';
  }

  // Sensitive HR data issues = Critical
  if (def.id === 'hr.relations.harassment' || def.id === 'hr.relations.grievance') {
    return 'Critical';
  }

  // Phishing with credentials entered = escalate to Critical
  if (def.id === 'security.phishing' && /entered.*credentials|clicked.*link.*entered|gave.*credentials|submitted.*login|entered.*password.*phishing/i.test(normalizedText)) {
    return 'Critical';
  }

  // Tax query: document requests (Form 16, certificate) stay Low; discrepancies escalate to Medium
  if (def.id === 'finance.tax') {
    if (/higher than|less than|deduction changed|incorrect deduction|wrong deduction|tds.*higher|tds.*lower|deduction.*higher|deduction.*changed|why.*deducted|discrepancy/i.test(normalizedText)) {
      return 'Medium';
    }
    return 'Low';
  }

  // Use taxonomy default for everything else
  return def.defaultRisk;
}

/**
 * Determine decision from intent, priority, and risk.
 */
export function resolveDecision(
  def: IntentDefinition,
  priority: Priority,
  riskLevel: RiskLevel
): Decision {
  // Always escalate: harassment, workplace abuse, critical HR situations
  if (def.id === 'hr.relations.harassment' || def.id === 'hr.relations.grievance') return 'ESCALATE';

  // Always escalate: security incidents with Critical risk
  if (riskLevel === 'Critical' && def.department === 'IT') return 'ESCALATE';

  // Always escalate: critical HR situations
  if (riskLevel === 'Critical' && def.department === 'HR') return 'ESCALATE';

  // Payroll missing / salary dispute = escalate
  if (def.id === 'finance.payroll.missing' || def.id === 'finance.payroll.dispute') return 'ESCALATE';

  // Data breach, account compromise = escalate
  if (def.id.startsWith('security.') && priority === 'critical') return 'ESCALATE';

  // Use taxonomy default
  return def.defaultDecision;
}

// ─── Sentiment (lightweight) ──────────────────────────────────────────────────

function classifySentiment(normalizedText: string): {
  sentiment: string;
  sentimentConfidence: number;
  sentimentScore: number;
} {
  const negative = /frustrated|angry|terrible|awful|unacceptable|disappointed|complain|urgent|not working|broken|failed|issue|problem|cannot|can't|won't|error|missing|wrong|incorrect/i;
  const positive = /thank|appreciate|great|excellent|helpful|resolved|happy|good/i;

  if (negative.test(normalizedText)) {
    return { sentiment: 'negative', sentimentConfidence: 0.75, sentimentScore: -1 };
  }
  if (positive.test(normalizedText)) {
    return { sentiment: 'positive', sentimentConfidence: 0.70, sentimentScore: 1 };
  }
  return { sentiment: 'neutral', sentimentConfidence: 0.70, sentimentScore: 0 };
}

// ─── Recommended Actions ──────────────────────────────────────────────────────

function buildRecommendedActions(def: IntentDefinition): string[] {
  const actions: string[] = [];

  if (def.approvalRequired) {
    actions.push(`Route to ${def.subteam} for approval`);
    actions.push('Notify assigned approver');
  } else {
    actions.push(`Assign to ${def.subteam}`);
  }

  if (def.defaultDecision === 'ESCALATE') {
    actions.push(`Escalate to ${def.department} management`);
  }

  if (def.id.startsWith('hr.leave')) {
    actions.push('Check employee leave balance');
    actions.push('Send leave confirmation to employee');
  } else if (def.id === 'hr.relations.harassment') {
    actions.push('Initiate confidential HR investigation');
    actions.push('Notify HR Compliance officer');
  } else if (def.id.startsWith('it.access')) {
    actions.push('Verify requester identity and role');
    actions.push('Check access policy compliance');
  } else if (def.id.startsWith('security')) {
    actions.push('Initiate incident response procedure');
    actions.push('Preserve evidence and logs');
  }

  return actions.slice(0, 3);
}

// ─── Main Classification Entry Point ──────────────────────────────────────────

/**
 * Classify a helpdesk request using the centralized taxonomy.
 * This is the deterministic fallback used when Gemini is unavailable.
 *
 * Returns a full ClassificationResult with confidence score.
 * confidence >= 0.85 = high confidence direct routing
 * confidence 0.70-0.84 = route with human review possible
 * confidence < 0.70 = human review recommended
 */
export function classifyByTaxonomy(
  subject: string,
  body: string
): ClassificationResult {
  const normalizedText = normalizeText(subject, body);
  const scores = scoreAllIntents(normalizedText);

  let def: IntentDefinition;
  let confidence: number;
  let reasoning: string;

  if (scores.length === 0 || scores[0].effectiveScore === 0) {
    // No matches at all — use General Inquiry fallback
    def = INTENT_TAXONOMY.find((d) => d.id === 'corporate.general')!;
    confidence = 0.45;
    reasoning = 'No intent-specific signals found — defaulting to General Inquiry';
  } else {
    const top = scores[0];
    def = top.def;

    // Confidence from effective score — capped between 0.50 and 0.97
    // rawScore of 1 token = base 0.55, each additional token adds ~0.08
    confidence = Math.min(0.50 + top.rawScore * 0.10 + top.effectiveScore * 0.30, 0.97);

    // Penalize confidence when there is competition (close second score)
    if (scores.length > 1) {
      const second = scores[1];
      const gap = top.effectiveScore - second.effectiveScore;
      if (gap < 0.05) {
        // Very close — reduce confidence
        confidence = Math.max(confidence - 0.15, 0.55);
        reasoning = `Ambiguous between "${def.intent}" and "${second.def.intent}" — selected top scorer`;
      } else {
        reasoning = `Matched ${top.rawScore} semantic token(s) for "${def.intent}"`;
      }
    } else {
      reasoning = `Matched ${top.rawScore} semantic token(s) for "${def.intent}"`;
    }

    // Penalize for negative exclusion hits
    if (top.negativeHits > 0) {
      confidence = Math.max(confidence - (top.negativeHits * 0.10), 0.50);
      reasoning += ` (${top.negativeHits} exclusion signal(s) — confidence reduced)`;
    }
  }

  const { priority, reasoning: priorityReasoning } = resolvePriority(def, normalizedText);
  const riskLevel = resolveRisk(def, normalizedText);
  // Decision: use taxonomy default whenever we matched a real intent.
  // Only fall back to HUMAN_REVIEW when completely unmatched (General Inquiry) or very low confidence.
  const isGeneralFallback = def.id === 'corporate.general';
  const decision = (!isGeneralFallback && confidence >= 0.50)
    ? resolveDecision(def, priority, riskLevel)
    : (confidence >= 0.40 ? resolveDecision(def, priority, riskLevel) : 'HUMAN_REVIEW');
  const sentimentResult = classifySentiment(normalizedText);
  const recommendedActions = buildRecommendedActions(def);

  return {
    intent: def.intent,
    intentId: def.id,
    department: def.department,
    subteam: def.subteam,
    priority,
    priorityReasoning,
    riskLevel,
    decision,
    confidence,
    reasoning,
    recommendedActions,
    classified_by: 'taxonomy',
    ...sentimentResult,
  };
}

// ─── Conflict Resolution ──────────────────────────────────────────────────────

/**
 * Merge Gemini classification with taxonomy-based classification.
 * Uses taxonomy as ground truth for department/subteam when Gemini returns
 * a recognized intent name but with wrong routing.
 *
 * Returns the merged best result.
 */
export function mergeClassifications(
  geminiResult: any,
  taxonomyResult: ClassificationResult
): ClassificationResult {
  // If Gemini returned a recognized intent, use its routing from taxonomy
  const taxDef = getTaxonomyByIntent(geminiResult?.intent ?? '');

  if (taxDef && geminiResult?.confidence >= 0.80) {
    // Gemini recognized intent + high confidence — use Gemini intent with taxonomy routing
    const { priority, reasoning: priorityReasoning } = resolvePriority(
      taxDef,
      `${geminiResult.subject ?? ''} ${geminiResult.body ?? ''}`
    );
    const riskLevel = resolveRisk(taxDef, '');
    const decision = resolveDecision(taxDef, priority, riskLevel);

    return {
      intent: taxDef.intent,
      intentId: taxDef.id,
      department: taxDef.department,
      subteam: taxDef.subteam,
      priority: (geminiResult.priority as Priority) ?? priority,
      priorityReasoning: geminiResult.priorityReasoning ?? priorityReasoning,
      riskLevel: (geminiResult.riskLevel as RiskLevel) ?? riskLevel,
      sentiment: geminiResult.sentiment ?? 'neutral',
      sentimentConfidence: geminiResult.sentimentConfidence ?? 0.70,
      sentimentScore: geminiResult.sentimentScore ?? 0,
      decision: (geminiResult.decision as Decision) ?? decision,
      confidence: geminiResult.confidence ?? 0.85,
      reasoning: `Gemini: ${geminiResult.reasoning ?? ''}`,
      recommendedActions: geminiResult.recommendedActions ?? [],
      classified_by: 'gemini',
    };
  }

  // Gemini low confidence or unrecognized intent — prefer taxonomy result
  if (taxonomyResult.confidence > (geminiResult?.confidence ?? 0)) {
    return { ...taxonomyResult, classified_by: 'taxonomy' };
  }

  // Both low confidence — use taxonomy with HUMAN_REVIEW override
  return {
    ...taxonomyResult,
    decision: 'HUMAN_REVIEW',
    reasoning: `Low confidence from both classifiers — routed to human review`,
    classified_by: 'taxonomy',
  };
}
