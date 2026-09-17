/**
 * POST /api/approvals/similar-cases
 *
 * Finds similar resolved cases for an approval request.
 * Used by the approval detail page to show context to the manager.
 *
 * Body: { ticketId?: string, intent?: string, limit?: number }
 * Returns: { cases: SimilarCase[] }
 */
import { NextRequest, NextResponse } from 'next/server';
import { findSimilarResolvedCases } from '@/lib/agents';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const { intent, limit = 3 } = await req.json();

    if (!intent) {
      return NextResponse.json({ cases: [] });
    }

    const cases = await findSimilarResolvedCases(intent, limit);
    return NextResponse.json({ cases });
  } catch (err: any) {
    console.error('[similar-cases]', err);
    return NextResponse.json({ cases: [] });
  }
}
