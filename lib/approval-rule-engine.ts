/**
 * lib/approval-rule-engine.ts
 *
 * Module 2C — Configurable Approval Rule Engine
 *
 * Evaluates an intent string against the `approval_rules` DB table.
 * Returns a structured routing decision:
 *   - requiresApproval  : whether manager approval is needed
 *   - skipManager       : bypass reporting manager (e.g. harassment)
 *   - criticalEscalation: mark as critical, notify extra teams
 *   - targetDepartment  : primary department to route to
 *   - secondaryDepartment: secondary department (e.g. Legal)
 *   - requiredApprovalLevel: manager capability level required
 *   - ruleMatched       : the rule that matched (or null for default)
 *
 * Rules are stored in the `approval_rules` table and are fully configurable
 * in the Supabase dashboard. No hardcoded intent strings here.
 */

import { supabase } from './supabase';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ApprovalRule {
  id: string;
  rule_name: string;
  intent_pattern: string;
  requires_approval: boolean;
  skip_manager: boolean;
  critical_escalation: boolean;
  target_department: string | null;
  secondary_department: string | null;
  required_approval_level: number;
  description: string | null;
  priority: number;
  active: boolean;
}

export interface ApprovalRuleResult {
  /** Whether this intent requires manager approval */
  requiresApproval: boolean;

  /** If true, skip the reporting manager — route directly to target dept */
  skipManager: boolean;

  /** If true, treat as critical escalation (e.g. harassment, security incident) */
  criticalEscalation: boolean;

  /** Primary department to route to after approval */
  targetDepartment: string | null;

  /** Secondary/additional department (e.g. Legal for harassment) */
  secondaryDepartment: string | null;

  /** Minimum manager approval level required */
  requiredApprovalLevel: number;

  /** The DB rule that matched this intent, or null if using defaults */
  ruleMatched: ApprovalRule | null;

  /** Human-readable explanation of the routing decision */
  explanation: string;
}

// ─── Default result (no rule matched) ────────────────────────────────────────

const DEFAULT_RESULT: ApprovalRuleResult = {
  requiresApproval: true,
  skipManager: false,
  criticalEscalation: false,
  targetDepartment: null,
  secondaryDepartment: null,
  requiredApprovalLevel: 1,
  ruleMatched: null,
  explanation: 'No specific rule matched — defaulting to manager approval required.',
};

// ─── Rule cache (refreshed every 5 min) ──────────────────────────────────────

let rulesCache: ApprovalRule[] | null = null;
let cacheLoadedAt = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

async function getActiveRules(): Promise<ApprovalRule[]> {
  const now = Date.now();
  if (rulesCache && now - cacheLoadedAt < CACHE_TTL_MS) {
    return rulesCache;
  }

  try {
    const { data, error } = await supabase
      .from('approval_rules')
      .select('*')
      .eq('active', true)
      .order('priority', { ascending: true });

    if (error || !data) {
      console.warn('[RuleEngine] Failed to load rules from DB:', error?.message);
      return rulesCache ?? [];
    }

    rulesCache = data as ApprovalRule[];
    cacheLoadedAt = now;
    return rulesCache;
  } catch (err) {
    console.warn('[RuleEngine] Exception loading rules:', err);
    return rulesCache ?? [];
  }
}

// ─── Core evaluation function ─────────────────────────────────────────────────

/**
 * Evaluates the approval routing rules for a given intent string.
 *
 * Matching strategy:
 *  1. Normalise intent to lowercase
 *  2. Try each active rule in priority order (lower = higher priority)
 *  3. Use JS string includes() to match the pattern (mirrors SQL ILIKE %pattern%)
 *  4. Return first match, or DEFAULT_RESULT if none
 *
 * @param intent       The AI-classified intent string (e.g. "SAP Access Request")
 * @param department   Optional department context (not used for matching, but included in explanation)
 */
export async function evaluateApprovalRule(
  intent: string,
  department?: string
): Promise<ApprovalRuleResult> {
  try {
    const rules = await getActiveRules();
    if (rules.length === 0) {
      console.warn('[RuleEngine] No active rules loaded — using defaults');
      return DEFAULT_RESULT;
    }

    const normalizedIntent = intent.toLowerCase().trim();

    for (const rule of rules) {
      // Strip the SQL ILIKE wildcards (%) and check contains
      const pattern = rule.intent_pattern.toLowerCase().replace(/%/g, '').trim();

      if (normalizedIntent.includes(pattern)) {
        const deptContext = department ? ` (Dept: ${department})` : '';
        const approval = rule.requires_approval
          ? `Manager approval required → routes to ${rule.target_department ?? 'manager'}`
          : `No approval needed → routes directly to ${rule.target_department ?? 'assigned team'}`;

        const skipNote = rule.skip_manager ? ' | SKIP MANAGER' : '';
        const critNote = rule.critical_escalation ? ' | 🚨 CRITICAL ESCALATION' : '';

        return {
          requiresApproval: rule.requires_approval,
          skipManager: rule.skip_manager,
          criticalEscalation: rule.critical_escalation,
          targetDepartment: rule.target_department,
          secondaryDepartment: rule.secondary_department,
          requiredApprovalLevel: rule.required_approval_level,
          ruleMatched: rule,
          explanation: `Rule: "${rule.rule_name}"${deptContext} — ${approval}${skipNote}${critNote}`,
        };
      }
    }

    // No rule matched — use defaults
    console.log(`[RuleEngine] No rule matched for intent: "${intent}" — using default`);
    return {
      ...DEFAULT_RESULT,
      explanation: `No rule matched for "${intent}" — defaulting to manager approval required.`,
    };
  } catch (err) {
    console.error('[RuleEngine] evaluateApprovalRule error:', err);
    return DEFAULT_RESULT;
  }
}

// ─── Utility: get all rules (for admin UI) ───────────────────────────────────

export async function getAllApprovalRules(): Promise<ApprovalRule[]> {
  try {
    const { data, error } = await supabase
      .from('approval_rules')
      .select('*')
      .order('priority', { ascending: true });
    if (error || !data) return [];
    return data as ApprovalRule[];
  } catch {
    return [];
  }
}

/** Invalidate the in-memory cache (call after rule updates) */
export function invalidateRuleCache(): void {
  rulesCache = null;
  cacheLoadedAt = 0;
}
