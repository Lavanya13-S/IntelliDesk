/**
 * POST /api/dept/[id]/resolution-email
 *
 * Generates an editable resolution email draft for a COMPLETED work item.
 * The draft always contains [placeholder] fields for sensitive data.
 * Nothing is ever sent automatically — the engineer must review and send.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getWorkItem } from '@/lib/dept-service';

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const detail = await getWorkItem(params.id);
    if (!detail) {
      return NextResponse.json({ error: 'Work item not found' }, { status: 404 });
    }

    const { item, logs, email, ticket } = detail;

    if (item.status !== 'completed') {
      return NextResponse.json(
        { error: 'Resolution email is only available for completed tickets.' },
        { status: 409 }
      );
    }

    const ticketBody =
      email?.body ??
      ticket?.intent ??
      item.intent ??
      'Support request';

    const intent = item.intent ?? ticket?.intent ?? 'support request';
    const department = item.department ?? '';
    const employeeName = item.employee_name ?? 'Employee';
    const employeeEmail = item.employee_email ?? '';
    const assignedTo = item.assigned_to ?? '';
    const completedAt = item.completed_at
      ? new Date(item.completed_at).toLocaleString()
      : new Date().toLocaleString();

    // Summarise only public-facing log actions for the draft
    const relevantLogs = logs.filter(l =>
      ['started', 'completed', 'verified', 'commented', 'resumed'].includes(l.action)
    );
    const logSummary = relevantLogs
      .map(l => `  • ${l.action}${l.note ? `: ${l.note}` : ''}`)
      .join('\n');

    // Forward to the AI assist route using the resolution_email type
    const aiRes = await fetch(
      `${process.env.NEXT_PUBLIC_APP_URL}/api/dept/ai-assist`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'resolution_email',
          ticketBody,
          department,
          intent,
          employeeName,
          workItemContext: {
            status: item.status,
            assignedTo,
            completedAt: item.completed_at,
            employeeEmail,
            logs: relevantLogs.map(l => ({
              action: l.action,
              actor: l.actor,
              note: l.note,
              createdAt: l.created_at,
            })),
          },
        }),
      }
    );

    const aiData = await aiRes.json();

    return NextResponse.json({
      draft: aiData.result ?? '',
      to: employeeEmail,
      subject: `Your ${intent} Request — Resolved`,
      employeeName,
      intent,
    });
  } catch (err: any) {
    console.error('[dept/resolution-email]', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
