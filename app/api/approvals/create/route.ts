/**
 * POST /api/approvals/create
 *
 * Internal endpoint called by langgraph-pipeline.ts when Decision Agent
 * returns HUMAN_APPROVAL_REQUIRED. Creates an approval_requests record,
 * fires the manager email, and logs the audit event.
 *
 * Body: {
 *   ticketId, emailId, senderEmail, subject, body,
 *   decisionCtx: { intent, priority, risk, reason, confidence, department, subteam }
 * }
 */
import { NextRequest, NextResponse } from 'next/server';
import { createApprovalRequest } from '@/lib/approval-service';

export async function POST(req: NextRequest) {
  try {
    const {
      ticketId,
      emailId,
      senderEmail,
      subject,
      body,
      decisionCtx,
    } = await req.json();

    if (!ticketId || !senderEmail) {
      return NextResponse.json(
        { error: 'ticketId and senderEmail are required' },
        { status: 400 }
      );
    }

    const approval = await createApprovalRequest({
      ticketId,
      emailId: emailId ?? null,
      senderEmail,
      subject: subject ?? '',
      body: body ?? '',
      decisionCtx: {
        intent: decisionCtx?.intent ?? 'Employee Request',
        priority: decisionCtx?.priority ?? 'medium',
        risk: decisionCtx?.risk ?? 'Medium',
        reason: decisionCtx?.reason ?? 'Requires manager approval.',
        confidence: decisionCtx?.confidence ?? 50,
        department: decisionCtx?.department,
        subteam: decisionCtx?.subteam,
      },
    });

    if (!approval) {
      return NextResponse.json(
        { error: 'Failed to create approval request' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, approvalId: approval.id });
  } catch (err: any) {
    console.error('[approvals/create]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
