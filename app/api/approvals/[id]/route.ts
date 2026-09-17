/**
 * GET  /api/approvals/[id]         — single approval detail WITH decision context
 * POST /api/approvals/[id]/action  — handled separately
 */
import { NextRequest, NextResponse } from 'next/server';
import { getApprovalWithContext, getAuditLog } from '@/lib/approval-service';

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const ctx = await getApprovalWithContext(params.id);
    if (!ctx) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const auditLog = await getAuditLog(params.id);
    return NextResponse.json(
      { approval: ctx.approval, auditLog, decisionLog: ctx.decisionLog },
      {
        headers: {
          // Never cache — always return live DB state
          'Cache-Control': 'no-store, no-cache, must-revalidate',
          'Pragma': 'no-cache',
        },
      }
    );
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
