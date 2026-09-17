/**
 * POST /api/dept/[id]/retry-notification
 *
 * Retries ONLY Phase 2 (secondary Gmail notification) for a work item
 * where Phase 1 (IntelliDesk resolution publish) already succeeded.
 *
 * Requirements:
 *   - ticket_resolutions row must already exist for this work item (Phase 1 done)
 *   - notification_deliveries latest record must be FAILED
 *   - A real Gmail send is attempted — no simulated fallback
 *   - On success: advance ticket to RESOLVED, write 'notification_retried' log
 *   - On failure: increment retry_count, write 'notification_failed' log again
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient }              from '@supabase/supabase-js';
import { getWorkItem }               from '@/lib/dept-service';
import { sendGmailMessage }          from '@/lib/gmail-client';

export const runtime = 'nodejs';

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

function buildNotificationHtml(params: {
  employeeName: string;
  caseTitle:    string;
  ticketId:     string;
  assignedTo:   string;
}): string {
  const { employeeName, caseTitle, assignedTo } = params;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  const portalUrl = `${appUrl}/portal/case/${params.ticketId}`;
  const name = employeeName || 'there';

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Update on Your IntelliDesk Case</title></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;min-height:100vh;">
    <tr><td align="center" style="padding:40px 16px;">
      <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">
        <tr><td style="background:linear-gradient(135deg,#059669,#10b981);border-radius:16px 16px 0 0;padding:24px 32px;">
          <div style="display:inline-block;background:rgba(255,255,255,0.15);border-radius:8px;padding:6px 12px;margin-bottom:10px;">
            <span style="color:#fff;font-size:12px;font-weight:700;letter-spacing:1px;">✓ CASE UPDATED — INTELLIDESK</span>
          </div>
          <h1 style="color:#fff;margin:0;font-size:20px;font-weight:700;">Update on Your Case</h1>
        </td></tr>
        <tr><td style="background:#ffffff;padding:32px;border-left:1px solid #e5e7eb;border-right:1px solid #e5e7eb;">
          <p style="color:#1e293b;font-size:15px;line-height:1.7;margin:0 0 16px;">Dear ${name},</p>
          <p style="color:#1e293b;font-size:15px;line-height:1.7;margin:0 0 16px;">
            There has been an update to your case: <strong>"${caseTitle}"</strong>.
          </p>
          <p style="color:#1e293b;font-size:15px;line-height:1.7;margin:0 0 24px;">
            Please log in to <strong>IntelliDesk</strong> to view the latest status and full resolution details.
          </p>
          <div style="text-align:center;margin:28px 0;">
            <a href="${portalUrl}" style="display:inline-block;background:#059669;color:#fff;font-size:14px;font-weight:700;text-decoration:none;padding:14px 32px;border-radius:10px;">
              View Case in IntelliDesk →
            </a>
          </div>
          <p style="color:#64748b;font-size:13px;line-height:1.6;margin:0;">
            If the button above does not work, copy and paste this link:<br>
            <span style="color:#059669;">${portalUrl}</span>
          </p>
        </td></tr>
        <tr><td style="background:#f1f5f9;border-radius:0 0 16px 16px;padding:16px 32px;border:1px solid #e5e7eb;border-top:0;">
          <p style="color:#94a3b8;font-size:12px;margin:0;text-align:center;">
            Best regards, ${assignedTo || 'IntelliDesk Support Team'}<br>
            Sent via IntelliDesk ITSM · Do not reply to this email.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = getServiceClient();
  const now = new Date().toISOString();

  try {
    const body = await req.json().catch(() => ({}));
    const resolvedBy: string = (body as any)?.resolved_by?.trim() || 'System';

    // ── Load work item ────────────────────────────────────────────────────────
    const detail = await getWorkItem(params.id);
    if (!detail) {
      return NextResponse.json({ success: false, error: 'Work item not found.' }, { status: 404 });
    }

    const { item, email } = detail;
    const recipientEmail = item.employee_email ?? email?.sender ?? '';

    if (!recipientEmail) {
      return NextResponse.json(
        { success: false, error: 'No recipient email address found.' },
        { status: 400 }
      );
    }

    // ── Verify Phase 1 is complete ────────────────────────────────────────────
    const { data: resolution } = await supabase
      .from('ticket_resolutions')
      .select('id, title, published_by')
      .eq('work_item_id', params.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!resolution) {
      return NextResponse.json({
        success: false,
        error: 'Phase 1 (IntelliDesk resolution publish) has not been completed for this work item. Run Send Resolution first.',
      }, { status: 400 });
    }

    // ── Find latest FAILED notification_delivery record ───────────────────────
    const { data: failedDelivery } = await supabase
      .from('notification_deliveries')
      .select('id, retry_count')
      .eq('work_item_id', params.id)
      .eq('delivery_status', 'FAILED')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const retryCount = (failedDelivery?.retry_count ?? 0) + 1;
    const caseTitle  = resolution.title || item.intent || 'Your Support Request';

    console.log(`[retry-notification] Attempt #${retryCount} — sending to ${recipientEmail}`);

    // ── Attempt real Gmail send ───────────────────────────────────────────────
    let providerMessageId: string | null = null;
    let gmailError: string | null = null;

    const notificationSubject = `Update on Your IntelliDesk Case`;
    const notificationHtml = buildNotificationHtml({
      employeeName: item.employee_name ?? '',
      caseTitle,
      ticketId:    item.ticket_id ?? '',
      assignedTo:  resolution.published_by || resolvedBy,
    });

    try {
      providerMessageId = await sendGmailMessage({
        to:       recipientEmail,
        subject:  notificationSubject,
        htmlBody: notificationHtml,
      });
      console.log(`[retry-notification] Gmail send succeeded — messageId=${providerMessageId}`);
    } catch (e: any) {
      gmailError = e.message ?? 'Gmail send failed';
      console.error(`[retry-notification] Gmail send FAILED (attempt ${retryCount}): ${gmailError}`);
    }

    if (providerMessageId) {
      // ── SUCCESS: Update delivery record, advance to RESOLVED ─────────────
      if (failedDelivery) {
        await supabase
          .from('notification_deliveries')
          .update({
            delivery_status:     'SENT',
            provider_message_id: providerMessageId,
            sent_at:             now,
            failed_at:           null,
            error_message:       null,
            retry_count:         retryCount,
          })
          .eq('id', failedDelivery.id);
      } else {
        await supabase
          .from('notification_deliveries')
          .insert({
            ticket_id:           item.ticket_id ?? null,
            work_item_id:        params.id,
            recipient_email:     recipientEmail,
            channel:             'EMAIL',
            notification_type:   'CASE_UPDATED_CHECK_INTELLIDESK',
            subject:             notificationSubject,
            delivery_status:     'SENT',
            delivery_mode:       'REAL',
            provider_message_id: providerMessageId,
            sent_at:             now,
            retry_count:         retryCount,
          });
      }

      // Mark ticket RESOLVED
      if (item.ticket_id) {
        await supabase
          .from('tickets')
          .update({
            status:              'resolved',
            workflow_stage:      'Resolved',
            resolved_at:         now,
            resolved_by:         resolution.published_by || resolvedBy,
            resolution_sent:     true,
            gmail_sent:          true,
            gmail_message_id:    providerMessageId,
            notification_status: 'SENT',
          })
          .eq('id', item.ticket_id);
      }

      // Complete work item
      await supabase
        .from('dept_work_items')
        .update({ status: 'completed', completed_at: now, updated_at: now })
        .eq('id', params.id);

      // Work logs
      await supabase.from('dept_work_logs').insert([
        {
          work_item_id: params.id,
          actor:        'system',
          action:       'notification_retried',
          note:         `Gmail notification retry #${retryCount} succeeded. Provider messageId: ${providerMessageId}. Sent to ${recipientEmail}.`,
        },
        {
          work_item_id: params.id,
          actor:        resolution.published_by || resolvedBy,
          action:       'completed',
          note:         `Ticket fully resolved after notification retry. IntelliDesk resolution and Gmail notification both confirmed.`,
        },
      ]);

      return NextResponse.json({
        success:          true,
        notificationSent: true,
        providerMessageId,
        retryCount,
        resolvedAt:       now,
        message:          `Gmail notification delivered successfully on retry #${retryCount}. Ticket resolved.`,
      });

    } else {
      // ── FAILURE: Update delivery record, keep ticket in Customer Resolution ──
      if (failedDelivery) {
        await supabase
          .from('notification_deliveries')
          .update({
            failed_at:     now,
            error_message: gmailError,
            retry_count:   retryCount,
          })
          .eq('id', failedDelivery.id);
      }

      if (item.ticket_id) {
        await supabase
          .from('tickets')
          .update({ notification_status: 'FAILED' })
          .eq('id', item.ticket_id);
      }

      await supabase
        .from('dept_work_logs')
        .insert({
          work_item_id: params.id,
          actor:        'system',
          action:       'notification_failed',
          note:         `Gmail notification retry #${retryCount} FAILED: ${gmailError}. ` +
                        `IntelliDesk resolution remains published. Retry again when the Gmail connection is restored.`,
        });

      return NextResponse.json({
        success:           false,
        notificationSent:  false,
        gmailError,
        retryCount,
        error: `Gmail notification retry #${retryCount} failed: ${gmailError}. The IntelliDesk resolution is still available to the employee. Please check your Gmail OAuth connection in Settings → Email and try again.`,
      }, { status: 502 });
    }

  } catch (err: any) {
    console.error('[retry-notification] Unexpected error:', err);
    return NextResponse.json(
      { success: false, error: err.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
