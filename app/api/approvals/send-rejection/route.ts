/**
 * POST /api/approvals/send-rejection
 *
 * Generates a professional rejection email via Gemini and sends via Gmail.
 * Called internally after a manager rejects an approval request.
 */
import { NextRequest, NextResponse } from 'next/server';
import { sendGmailMessage } from '@/lib/gmail-client';
import { logAuditEvent } from '@/lib/approval-service';

export const runtime = 'nodejs';

const GEMINI_API = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

async function getGeminiKey(): Promise<string | null> {
  try {
    const { createClient } = await import('@supabase/supabase-js');
    const sb = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false } }
    );
    const { data } = await sb.from('ai_settings').select('gemini_api_key').maybeSingle();
    return data?.gemini_api_key ?? null;
  } catch {
    return null;
  }
}

async function generateRejectionText(params: {
  employeeName: string;
  intent: string;
  managerName: string;
  comments: string;
}): Promise<string> {
  const apiKey = await getGeminiKey();
  if (!apiKey) {
    return `Dear ${params.employeeName},\n\nThank you for your request regarding ${params.intent}. After careful review, your request has not been approved at this time.\n\n${params.comments ? `Reason: ${params.comments}\n\n` : ''}If you have questions, please reach out to your manager directly.\n\nBest regards,\nIntelliDesk Support Team`;
  }

  const prompt = `You are an HR assistant writing a professional, empathetic rejection email.

Employee: ${params.employeeName}
Request Type: ${params.intent}
Approving Manager: ${params.managerName}
Manager Comments: ${params.comments || 'No specific comments provided'}

Write a SHORT (3-4 sentences) professional rejection email body. 
- Be empathetic and respectful
- Briefly mention the reason if comments are available
- Suggest the employee can discuss further with their manager
- No subject line, no salutation, just the body paragraphs
- Return ONLY the email body text, no markdown`;

  try {
    const res = await fetch(`${GEMINI_API}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.4, maxOutputTokens: 256 },
      }),
    });
    if (!res.ok) throw new Error('Gemini error');
    const data = await res.json();
    return data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? '';
  } catch {
    return `Dear ${params.employeeName},\n\nThank you for submitting your request. After careful review, we regret to inform you that your request could not be approved at this time. ${params.comments ? `Your manager noted: "${params.comments}". ` : ''}Please feel free to reach out to your manager for further discussion.\n\nBest regards,\nIntelliDesk Support Team`;
  }
}

export async function POST(req: NextRequest) {
  try {
    const { approvalId, employeeEmail, employeeName, managerName, intent, comments } = await req.json();

    const bodyText = await generateRejectionText({
      employeeName: employeeName ?? 'Employee',
      intent: intent ?? 'your request',
      managerName: managerName ?? 'your manager',
      comments: comments ?? '',
    });

    const htmlBody = `
<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#0f172a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f172a;min-height:100vh;">
    <tr><td align="center" style="padding:40px 16px;">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
        <tr>
          <td style="background:linear-gradient(135deg,#dc2626,#991b1b);border-radius:16px 16px 0 0;padding:28px 32px;">
            <div style="display:inline-block;background:rgba(255,255,255,0.15);border-radius:10px;padding:8px 14px;margin-bottom:12px;">
              <span style="color:#fff;font-size:13px;font-weight:700;letter-spacing:1px;">IntelliDesk</span>
            </div>
            <h1 style="color:#fff;margin:0;font-size:22px;font-weight:700;">Request Update</h1>
            <p style="color:rgba(255,255,255,0.75);margin:6px 0 0;font-size:14px;">Regarding: ${intent ?? 'Your Request'}</p>
          </td>
        </tr>
        <tr>
          <td style="background:#1e293b;padding:32px;">
            <p style="color:#94a3b8;margin:0 0 24px;font-size:15px;">Dear <strong style="color:#e2e8f0;">${employeeName ?? 'Employee'}</strong>,</p>
            <div style="color:#cbd5e1;font-size:14px;line-height:1.7;white-space:pre-line;">${bodyText}</div>
            ${comments ? `
            <div style="background:#0f172a;border-left:3px solid #ef4444;border-radius:0 8px 8px 0;padding:16px;margin-top:20px;">
              <p style="color:#64748b;font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;margin:0 0 6px;">Manager Comments</p>
              <p style="color:#e2e8f0;font-size:13px;margin:0;">${comments}</p>
            </div>` : ''}
          </td>
        </tr>
        <tr>
          <td style="background:#0f172a;border-radius:0 0 16px 16px;padding:20px 32px;border-top:1px solid #1e293b;">
            <p style="color:#475569;font-size:12px;margin:0;text-align:center;">Sent by IntelliDesk · Do not reply to this email.</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

    let gmailMessageId: string | null = null;
    try {
      gmailMessageId = await sendGmailMessage({
        to: employeeEmail,
        subject: `Update on Your Request — ${intent ?? 'Employee Request'}`,
        htmlBody,
      });
      await logAuditEvent(approvalId, 'email_sent', 'system', `Rejection email sent to ${employeeEmail}`, undefined, undefined, { gmailMessageId, type: 'rejection' });
    } catch (gmailErr: any) {
      console.warn('[send-rejection] Gmail send failed:', gmailErr.message);
    }

    return NextResponse.json({ success: true, gmailMessageId });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
