/**
 * POST /api/approvals/rule-check
 *
 * Evaluates the approval rule engine for a given intent.
 * Used by the email-detail UI before creating an approval request
 * so the UI can show the correct routing information.
 *
 * Body: { intent: string, department?: string }
 * Returns: ApprovalRuleResult
 */
import { NextRequest, NextResponse } from 'next/server';
import { evaluateApprovalRule } from '@/lib/approval-rule-engine';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const { intent, department } = await req.json();

    if (!intent) {
      return NextResponse.json({ error: 'intent is required' }, { status: 400 });
    }

    const result = await evaluateApprovalRule(intent, department);
    return NextResponse.json({ result });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
