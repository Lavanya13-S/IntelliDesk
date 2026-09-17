/**
 * POST /api/approvals/send-email
 *
 * Module 2C — Sends notification email to manager via Gmail API.
 * SERVER-SIDE ONLY — called internally by approval-service.ts.
 *
 * Per spec: Email contains NO approve/reject buttons.
 * Managers MUST approve inside IntelliDesk.
 * Only one CTA: "Open IntelliDesk →" pointing to /approvals/[id]
 *
 * Email shows:
 *   - Employee Name, Designation, Department
 *   - Issue (intent), Priority, Risk Level
 *   - AI Summary / Reason
 *   - Requested Time
 *   - "Open IntelliDesk" button → /approvals/[approvalId]
 */
import { NextRequest, NextResponse } from 'next/server';
import { sendGmailMessage } from '@/lib/gmail-client';
import { logAuditEvent } from '@/lib/approval-service';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const {
      approvalId,
      managerEmail,
      managerName,
      employeeName,
      employeeEmail,
      department,
      designation,
      subject: emailSubject,
      body: emailBody,
      intent,
      priority,
      risk,
      reason,
      confidence,
    } = await req.json();

    const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    // Managers approve INSIDE IntelliDesk — this is the only link
    const portalUrl = `${APP_URL}/approvals/${approvalId}`;

    const priorityColor: Record<string, string> = {
      critical: '#ef4444', high: '#f97316', medium: '#eab308', low: '#22c55e',
    };
    const riskColor: Record<string, string> = {
      Critical: '#ef4444', High: '#f97316', Medium: '#eab308', Low: '#22c55e',
    };
    const pColor = priorityColor[priority?.toLowerCase()] ?? '#6b7280';
    const rColor = riskColor[risk] ?? '#6b7280';

    const requestedTime = new Date().toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      dateStyle: 'medium',
      timeStyle: 'short',
    });

    const htmlBody = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Approval Required — IntelliDesk</title>
</head>
<body style="margin:0;padding:0;background:#0f172a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f172a;min-height:100vh;">
    <tr>
      <td align="center" style="padding:40px 16px;">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

          <!-- Logo Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#4f46e5,#7c3aed);border-radius:16px 16px 0 0;padding:28px 32px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td>
                    <div style="display:inline-block;background:rgba(255,255,255,0.15);border-radius:10px;padding:8px 14px;margin-bottom:12px;">
                      <span style="color:#fff;font-size:13px;font-weight:700;letter-spacing:1px;">⚡ INTELLIDESK</span>
                    </div>
                    <h1 style="color:#fff;margin:0;font-size:22px;font-weight:700;">Approval Required</h1>
                    <p style="color:rgba(255,255,255,0.75);margin:6px 0 0;font-size:14px;">An employee request requires your review in IntelliDesk</p>
                  </td>
                  <td align="right" style="vertical-align:top;">
                    <span style="display:inline-block;background:${pColor};color:#fff;border-radius:20px;padding:4px 14px;font-size:12px;font-weight:700;text-transform:uppercase;">${priority ?? 'MEDIUM'}</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="background:#1e293b;padding:32px;">

              <!-- Greeting -->
              <p style="color:#94a3b8;margin:0 0 24px;font-size:15px;">
                Hi <strong style="color:#e2e8f0;">${managerName ?? 'Manager'}</strong>,<br>
                The following employee request has been flagged by IntelliDesk as requiring your approval. Please review and take action inside the IntelliDesk portal.
              </p>

              <!-- Employee Card -->
              <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f172a;border:1px solid #334155;border-radius:12px;margin-bottom:20px;">
                <tr>
                  <td style="padding:20px;">
                    <p style="color:#64748b;font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;margin:0 0 12px;">EMPLOYEE DETAILS</p>
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="color:#94a3b8;font-size:13px;padding:4px 0;width:140px;">Name</td>
                        <td style="color:#e2e8f0;font-size:13px;font-weight:600;">${employeeName ?? '—'}</td>
                      </tr>
                      <tr>
                        <td style="color:#94a3b8;font-size:13px;padding:4px 0;">Email</td>
                        <td style="color:#818cf8;font-size:13px;">${employeeEmail ?? '—'}</td>
                      </tr>
                      <tr>
                        <td style="color:#94a3b8;font-size:13px;padding:4px 0;">Designation</td>
                        <td style="color:#e2e8f0;font-size:13px;">${designation ?? '—'}</td>
                      </tr>
                      <tr>
                        <td style="color:#94a3b8;font-size:13px;padding:4px 0;">Department</td>
                        <td style="color:#e2e8f0;font-size:13px;">${department ?? '—'}</td>
                      </tr>
                      <tr>
                        <td style="color:#94a3b8;font-size:13px;padding:4px 0;">Requested At</td>
                        <td style="color:#e2e8f0;font-size:13px;">${requestedTime}</td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <!-- Request Summary -->
              <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f172a;border:1px solid #334155;border-radius:12px;margin-bottom:20px;">
                <tr>
                  <td style="padding:20px;">
                    <p style="color:#64748b;font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;margin:0 0 12px;">REQUEST SUMMARY</p>
                    <p style="color:#e2e8f0;font-size:14px;font-weight:600;margin:0 0 8px;">${emailSubject ?? intent ?? 'Employee Request'}</p>
                    <p style="color:#94a3b8;font-size:13px;line-height:1.6;margin:0;">${(emailBody ?? '').slice(0, 400)}${(emailBody?.length ?? 0) > 400 ? '…' : ''}</p>
                  </td>
                </tr>
              </table>

              <!-- AI Analysis -->
              <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f172a;border:1px solid #334155;border-radius:12px;margin-bottom:28px;">
                <tr>
                  <td style="padding:20px;">
                    <p style="color:#64748b;font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;margin:0 0 12px;">🤖 AI ANALYSIS</p>
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="color:#94a3b8;font-size:13px;padding:4px 0;width:140px;">Classification</td>
                        <td style="color:#e2e8f0;font-size:13px;">${intent ?? '—'}</td>
                      </tr>
                      <tr>
                        <td style="color:#94a3b8;font-size:13px;padding:4px 0;">Risk Level</td>
                        <td><span style="display:inline-block;background:${rColor}22;color:${rColor};border-radius:4px;padding:2px 8px;font-size:12px;font-weight:600;">${risk ?? '—'}</span></td>
                      </tr>
                      <tr>
                        <td style="color:#94a3b8;font-size:13px;padding:4px 0;">AI Confidence</td>
                        <td style="color:#e2e8f0;font-size:13px;">${confidence ?? '—'}%</td>
                      </tr>
                      <tr>
                        <td style="color:#94a3b8;font-size:13px;padding:4px 0;vertical-align:top;">AI Summary</td>
                        <td style="color:#e2e8f0;font-size:13px;line-height:1.5;">${reason ?? '—'}</td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <!-- SINGLE CTA: Open IntelliDesk — NO approve/reject in email -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;">
                <tr>
                  <td align="center">
                    <a href="${portalUrl}"
                       style="display:inline-block;background:linear-gradient(135deg,#4f46e5,#7c3aed);color:#fff;text-decoration:none;border-radius:12px;padding:16px 40px;font-size:16px;font-weight:700;letter-spacing:0.3px;box-shadow:0 4px 24px rgba(79,70,229,0.4);">
                      Open IntelliDesk →
                    </a>
                  </td>
                </tr>
              </table>

              <!-- Note -->
              <p style="text-align:center;color:#475569;font-size:12px;margin:0;">
                Please review and approve or reject the request inside IntelliDesk.<br>
                Approval actions via email are not supported for security reasons.
              </p>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#0f172a;border-radius:0 0 16px 16px;padding:20px 32px;border-top:1px solid #1e293b;">
              <p style="color:#475569;font-size:12px;margin:0;text-align:center;">
                Sent by IntelliDesk · Do not reply to this email.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

    let gmailMessageId: string | null = null;
    try {
      gmailMessageId = await sendGmailMessage({
        to: managerEmail,
        subject: `[Approval Required] ${employeeName ?? 'Employee'} — ${intent ?? emailSubject ?? 'Request'} | ${priority?.toUpperCase() ?? 'MEDIUM'}`,
        htmlBody,
      });
      await logAuditEvent(
        approvalId,
        'email_sent',
        'system',
        `Approval notification sent to ${managerEmail} (portal link only)`,
        undefined,
        undefined,
        { gmailMessageId }
      );
    } catch (gmailErr: any) {
      console.warn('[send-email] Gmail send failed, continuing:', gmailErr.message);
      await logAuditEvent(approvalId, 'email_sent', 'system', `Gmail send failed: ${gmailErr.message}`);
    }

    return NextResponse.json({ success: true, gmailMessageId });
  } catch (err: any) {
    console.error('[send-email API]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
