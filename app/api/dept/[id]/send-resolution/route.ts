/**
 * POST /api/dept/[id]/send-resolution
 *
 * TWO-PHASE RESOLUTION — Module 4 Final Step
 * ═══════════════════════════════════════════
 *
 * PHASE 1 — PRIMARY: Publish resolution to IntelliDesk (always runs first)
 *   - Insert into ticket_resolutions (employee-visible case resolution record)
 *   - Update tickets: resolution_published = true, notification_status = PENDING
 *   - Write work log: action = 'resolution_published'
 *   - This is the PRIMARY communication channel. It ALWAYS succeeds before Phase 2.
 *
 * PHASE 2 — SECONDARY: Real Gmail notification "check IntelliDesk"
 *   - Uses sendGmailMessage() — works WITHOUT a threadId
 *   - Simple notification email: "Your case has been updated. Check IntelliDesk."
 *   - Does NOT contain the full resolution. Just a prompt to log in.
 *   - On success:
 *       - Insert notification_deliveries with SENT + real provider_message_id
 *       - Update tickets: status=resolved, workflow_stage=Resolved, notification_status=SENT
 *       - Update dept_work_items: status=completed, completed_at
 *       - Write work log: action = 'notification_sent'
 *   - On Gmail failure:
 *       - Insert notification_deliveries with FAILED + error_message
 *       - Write work log: action = 'notification_failed'
 *       - Ticket stays in Customer Resolution (NOT marked Resolved)
 *       - Returns { success: false, phase: 'notification', primaryPublished: true }
 *
 * Body: { subject: string, body: string, resolved_by: string, title?: string }
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient }              from '@supabase/supabase-js';
import { getWorkItem }               from '@/lib/dept-service';
import { sendGmailMessage }          from '@/lib/gmail-client';
import { startLearningPipeline }     from '@/lib/learning-pipeline';

export const runtime = 'nodejs';

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

// ── Build the secondary "check IntelliDesk" notification email ────────────────
// This is intentionally minimal — no confidential data, no resolution details.
// Just: "Your case has been updated. Log in to IntelliDesk."

function buildNotificationHtml(params: {
  employeeName: string;
  caseTitle: string;
  ticketId: string;
  assignedTo: string;
}): string {
  const { employeeName, caseTitle, assignedTo } = params;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  const portalUrl = `${appUrl}/portal/case/${params.ticketId}`;
  const name = employeeName || 'there';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>Update on Your IntelliDesk Case</title>
</head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;min-height:100vh;">
    <tr>
      <td align="center" style="padding:40px 16px;">
        <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">

          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#059669,#10b981);border-radius:16px 16px 0 0;padding:24px 32px;">
              <div style="display:inline-block;background:rgba(255,255,255,0.15);border-radius:8px;padding:6px 12px;margin-bottom:10px;">
                <span style="color:#fff;font-size:12px;font-weight:700;letter-spacing:1px;">✓ CASE UPDATED — INTELLIDESK</span>
              </div>
              <h1 style="color:#fff;margin:0;font-size:20px;font-weight:700;">Update on Your Case</h1>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="background:#ffffff;padding:32px;border-left:1px solid #e5e7eb;border-right:1px solid #e5e7eb;">
              <p style="color:#1e293b;font-size:15px;line-height:1.7;margin:0 0 16px;">Dear ${name},</p>
              <p style="color:#1e293b;font-size:15px;line-height:1.7;margin:0 0 16px;">
                There has been an update to your case: <strong>"${caseTitle}"</strong>.
              </p>
              <p style="color:#1e293b;font-size:15px;line-height:1.7;margin:0 0 24px;">
                Your case has been reviewed and a resolution has been recorded by our support team.
                Please log in to <strong>IntelliDesk</strong> to view the latest status and full resolution details.
              </p>

              <!-- CTA Button -->
              <div style="text-align:center;margin:28px 0;">
                <a href="${portalUrl}"
                   style="display:inline-block;background:#059669;color:#fff;font-size:14px;font-weight:700;text-decoration:none;padding:14px 32px;border-radius:10px;">
                  View Case in IntelliDesk →
                </a>
              </div>

              <p style="color:#64748b;font-size:13px;line-height:1.6;margin:0;">
                If the button above does not work, copy and paste this link into your browser:<br>
                <span style="color:#059669;">${portalUrl}</span>
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#f1f5f9;border-radius:0 0 16px 16px;padding:16px 32px;border:1px solid #e5e7eb;border-top:0;">
              <p style="color:#94a3b8;font-size:12px;margin:0;text-align:center;">
                Best regards, ${assignedTo || 'IntelliDesk Support Team'}<br>
                Sent via IntelliDesk ITSM · Do not reply to this email.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ── Main handler ──────────────────────────────────────────────────────────────

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = getServiceClient();
  const now = new Date().toISOString();

  try {
    const body = await req.json();
    const { subject, body: resolutionBody, resolved_by, title } = body as {
      subject:      string;
      body:         string;
      resolved_by:  string;
      title?:       string;
    };

    // ── Validate ──────────────────────────────────────────────────────────────
    if (!resolutionBody?.trim()) {
      return NextResponse.json(
        { success: false, error: 'Resolution body is required.' },
        { status: 400 }
      );
    }

    // ── Load work item ────────────────────────────────────────────────────────
    const detail = await getWorkItem(params.id);
    if (!detail) {
      return NextResponse.json(
        { success: false, error: 'Work item not found.' },
        { status: 404 }
      );
    }

    const { item, email, ticket } = detail;

    const recipientEmail = item.employee_email ?? email?.sender ?? '';
    if (!recipientEmail) {
      return NextResponse.json(
        { success: false, error: 'No recipient email address found for this work item.' },
        { status: 400 }
      );
    }

    const resolvedBy  = resolved_by?.trim() || 'System';
    const caseTitle   = title?.trim() || email?.subject || item.intent || 'Your Support Request';
    const emailSubject = subject?.trim() || `Re: ${caseTitle}`;

    // ════════════════════════════════════════════════════════════════════════
    // PHASE 1 — PRIMARY: Save resolution to IntelliDesk DB
    // This must ALWAYS succeed before Phase 2 is attempted.
    // ════════════════════════════════════════════════════════════════════════

    console.log(`[send-resolution] Phase 1 — publishing resolution for workItemId=${params.id} ticketId=${item.ticket_id}`);

    // Insert into ticket_resolutions (employee-visible record)
    const { data: resolution, error: resErr } = await supabase
      .from('ticket_resolutions')
      .insert({
        ticket_id:       item.ticket_id ?? null,
        work_item_id:    params.id,
        title:           caseTitle,
        resolution_text: resolutionBody,
        published_by:    resolvedBy,
        published_at:    now,
        visible_to_email: recipientEmail,
      })
      .select('id')
      .single();

    if (resErr) {
      // If ticket_resolutions table doesn't exist yet (migration not run), 
      // return a clear actionable error
      console.error('[send-resolution] Phase 1 — ticket_resolutions insert failed:', resErr.message);
      return NextResponse.json({
        success: false,
        phase: 'primary',
        error: `Failed to save resolution to IntelliDesk: ${resErr.message}. ` +
               'Please run Migration 041 in Supabase Dashboard first.',
        migrationRequired: true,
      }, { status: 500 });
    }

    console.log(`[send-resolution] Phase 1 — resolution record created: ${resolution?.id}`);

    // Update tickets — mark primary resolution published, but NOT yet resolved
    if (item.ticket_id) {
      await supabase
        .from('tickets')
        .update({
          resolution_published:    true,
          resolution_published_at: now,
          notification_status:     'PENDING',
          workflow_stage:          'Customer Resolution',
          resolved_by:             resolvedBy,
        })
        .eq('id', item.ticket_id);
    }

    // Work log — Phase 1 complete
    await supabase
      .from('dept_work_logs')
      .insert({
        work_item_id: params.id,
        actor:        resolvedBy,
        action:       'resolution_published',
        note:         `Resolution published in IntelliDesk for ${recipientEmail}. ` +
                      `Employee can now view it at /portal/case/${item.ticket_id}.`,
      });

    // ════════════════════════════════════════════════════════════════════════
    // PHASE 2 — SECONDARY: Real Gmail notification
    // Simple "check IntelliDesk" email — NOT the full resolution.
    // Uses sendGmailMessage() which does NOT require a thread ID.
    // ════════════════════════════════════════════════════════════════════════

    console.log(`[send-resolution] Phase 2 — sending Gmail notification to ${recipientEmail}`);

    let providerMessageId: string | null = null;
    let notificationSent = false;
    let notificationError: string | null = null;

    const notificationSubject = `Update on Your IntelliDesk Case`;
    const notificationHtml = buildNotificationHtml({
      employeeName: item.employee_name ?? '',
      caseTitle,
      ticketId:    item.ticket_id ?? '',
      assignedTo:  resolvedBy,
    });

    try {
      providerMessageId = await sendGmailMessage({
        to:       recipientEmail,
        subject:  notificationSubject,
        htmlBody: notificationHtml,
      });

      notificationSent = true;
      console.log(`[send-resolution] Phase 2 — Gmail notification sent. Provider messageId=${providerMessageId}`);

    } catch (gmailErr: any) {
      notificationError = gmailErr.message ?? 'Gmail send failed';
      console.error(`[send-resolution] Phase 2 — Gmail notification FAILED: ${notificationError}`);
    }

    // ── Insert notification_deliveries record ─────────────────────────────────
    const { data: deliveryRecord } = await supabase
      .from('notification_deliveries')
      .insert({
        ticket_id:           item.ticket_id ?? null,
        work_item_id:        params.id,
        recipient_email:     recipientEmail,
        channel:             'EMAIL',
        notification_type:   'CASE_UPDATED_CHECK_INTELLIDESK',
        subject:             notificationSubject,
        delivery_status:     notificationSent ? 'SENT' : 'FAILED',
        delivery_mode:       'REAL',
        provider_message_id: providerMessageId,
        provider_thread_id:  null,
        sent_at:             notificationSent ? now : null,
        failed_at:           notificationSent ? null : now,
        error_message:       notificationError,
        retry_count:         0,
      })
      .select('id')
      .single();

    if (notificationSent) {
      // ── BOTH PHASES SUCCEEDED: Mark ticket RESOLVED ───────────────────────
      if (item.ticket_id) {
        await supabase
          .from('tickets')
          .update({
            status:              'resolved',
            workflow_stage:      'Resolved',
            resolved_at:         now,
            resolved_by:         resolvedBy,
            resolution_sent:     true,
            gmail_sent:          true,
            gmail_message_id:    providerMessageId,
            notification_status: 'SENT',
          })
          .eq('id', item.ticket_id);
      }

      // Update email status
      if (item.email_id) {
        await supabase
          .from('emails')
          .update({ status: 'resolved' })
          .eq('id', item.email_id);
      }

      // Complete the work item
      await supabase
        .from('dept_work_items')
        .update({
          status:       'completed',
          completed_at: now,
          updated_at:   now,
        })
        .eq('id', params.id);

      // Work log — Phase 2 success
      await supabase
        .from('dept_work_logs')
        .insert({
          work_item_id: params.id,
          actor:        'system',
          action:       'notification_sent',
          note:         `Email notification sent to ${recipientEmail} via Gmail. ` +
                        `Provider message ID: ${providerMessageId}. ` +
                        `Employee prompted to check IntelliDesk for case update.`,
        });

      // Work log — final completed
      await supabase
        .from('dept_work_logs')
        .insert({
          work_item_id: params.id,
          actor:        resolvedBy,
          action:       'completed',
          note:         `Ticket fully resolved. IntelliDesk resolution published and Gmail notification confirmed delivered to ${recipientEmail}.`,
        });

      // Insert sent_emails audit record
      await supabase
        .from('sent_emails')
        .insert({
          ticket_id:        item.ticket_id ?? null,
          to_email:         recipientEmail,
          subject:          notificationSubject,
          body:             `[Notification only] Employee notified to check IntelliDesk. Full resolution ID: ${resolution?.id}`,
          sent_at:          now,
          status:           'sent',
          delivery_status:  'REAL',
          email_sent_at:    now,
          gmail_message_id: providerMessageId,
          gmail_thread_id:  null,
          resolved_by:      resolvedBy,
        });

      // Fire-and-forget: KB article + learning pipeline
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
      fetch(`${appUrl}/api/knowledge/create-article`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticket_id:             item.ticket_id,
          intent:                item.intent ?? null,
          department:            item.department ?? null,
          email_subject:         emailSubject,
          resolution_email_body: resolutionBody,
        }),
      }).catch((e) => console.warn('[send-resolution] KB article creation (non-fatal):', e.message));

      if (item.ticket_id) {
        startLearningPipeline(item.ticket_id).catch((e) =>
          console.warn('[send-resolution] Learning pipeline (non-fatal):', e.message)
        );
      }

      return NextResponse.json({
        success:             true,
        primaryPublished:    true,
        notificationSent:    true,
        deliveryMode:        'REAL',
        providerMessageId,
        resolvedAt:          now,
        resolvedBy,
        resolutionId:        resolution?.id,
        notificationDeliveryId: deliveryRecord?.id,
        message:             'Resolution published to IntelliDesk and Gmail notification delivered successfully. Ticket resolved.',
      });

    } else {
      // ── PHASE 2 FAILED: Keep ticket in Customer Resolution ────────────────
      // The primary resolution IS published in IntelliDesk.
      // The ticket is NOT marked Resolved until the notification succeeds.

      if (item.ticket_id) {
        await supabase
          .from('tickets')
          .update({ notification_status: 'FAILED' })
          .eq('id', item.ticket_id);
      }

      // Work log — Phase 2 failure
      await supabase
        .from('dept_work_logs')
        .insert({
          work_item_id: params.id,
          actor:        'system',
          action:       'notification_failed',
          note:         `Gmail notification to ${recipientEmail} FAILED: ${notificationError}. ` +
                        `The primary IntelliDesk resolution is published (ID: ${resolution?.id}). ` +
                        `Retry the notification to complete the workflow.`,
        });

      return NextResponse.json({
        success:            false,
        phase:              'notification',
        primaryPublished:   true,
        notificationSent:   false,
        notificationError,
        resolutionId:       resolution?.id,
        notificationDeliveryId: deliveryRecord?.id,
        error: `IntelliDesk resolution published successfully. However, the Gmail notification to ${recipientEmail} failed: ${notificationError}. ` +
               `The ticket remains in Customer Resolution. Use Retry Notification to complete the workflow.`,
      }, { status: 502 });
    }

  } catch (err: any) {
    console.error('[send-resolution] Unexpected error:', err);
    return NextResponse.json(
      { success: false, error: err.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
