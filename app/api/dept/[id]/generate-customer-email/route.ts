/**
 * POST /api/dept/[id]/generate-customer-email
 *
 * Module 4 — AI Customer-Safe Resolution Email Generator
 *
 * Generates a professional, customer-safe resolution email using Gemini.
 * STRICT RULES:
 *   - NEVER includes passwords, IDs, usernames, URLs, tokens, license keys,
 *     credentials, roles, or ANY sensitive system values
 *   - Different tone/content per intent (SAP, VPN, Laptop, Leave, Payroll, etc.)
 *   - Tells employee to check IntelliDesk for any access/system details
 *   - Warm, professional, concise
 *
 * Body: { engineerNotes: string, actor: string }
 * Response: { subject: string, body: string }
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient }              from '@supabase/supabase-js';
import { getWorkItem }               from '@/lib/dept-service';

export const runtime = 'nodejs';

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

async function getGeminiKey(): Promise<string | null> {
  try {
    const supabase = getServiceClient();
    const { data } = await supabase
      .from('ai_settings')
      .select('gemini_api_key')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    return data?.gemini_api_key ?? null;
  } catch { return null; }
}

async function callGemini(prompt: string, apiKey: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.4, maxOutputTokens: 800, candidateCount: 1 },
        }),
      }
    );
    if (!res.ok) {
      let errBody = '';
      try { errBody = await res.text(); } catch { /* ignore */ }
      console.error(`[generate-customer-email] Gemini error: ${res.status} ${res.statusText} — ${errBody.slice(0, 400)}`);
      return null;
    }
    const data = await res.json();
    return data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null;
  } catch { return null; }
}

// ── Intent-based safe fallback messages ───────────────────────────────────────

function buildSafeFallback(intent: string, employeeName: string, department: string, assignedTo: string): string {
  const name = employeeName || 'there';
  const dept = department || 'Support';
  const engineer = assignedTo || 'Support Team';

  const i = (intent ?? '').toLowerCase();

  let body: string;

  if (i.includes('sap') || i.includes('erp') || i.includes('fiori')) {
    body = `Hello ${name},\n\nYour SAP access request has been successfully processed.\n\nYour account has been provisioned in the system. You can now log in to IntelliDesk to securely view your assigned access details and system information.\n\nIf you experience any difficulty accessing your account, please reply to this email or contact the IT Help Desk.\n\nBest regards,\n${engineer}\n${dept} Team`;
  } else if (i.includes('vpn') || i.includes('remote access') || i.includes('remote work')) {
    body = `Hello ${name},\n\nYour VPN access has been configured and is ready to use.\n\nYou can now establish a secure connection using the VPN client. Please reconnect and verify your connection. If you need the connection details, please check your IntelliDesk portal.\n\nIf you face any issues connecting, please reply to this email and we will assist you promptly.\n\nBest regards,\n${engineer}\n${dept} Team`;
  } else if (i.includes('laptop') || i.includes('hardware') || i.includes('device') || i.includes('computer')) {
    body = `Hello ${name},\n\nYour hardware request has been processed.\n\nYour device has been prepared and is ready. Please visit the IT Helpdesk to collect your equipment. You will need to bring your employee ID for verification.\n\nIf you have any questions regarding the device setup, please reach out to us.\n\nBest regards,\n${engineer}\n${dept} Team`;
  } else if (i.includes('leave') || i.includes('vacation') || i.includes('time off') || i.includes('holiday')) {
    body = `Hello ${name},\n\nWe are pleased to inform you that your leave request has been approved.\n\nThe approved leave details have been recorded in the HR system. You can view the confirmed dates by checking your HR portal or IntelliDesk.\n\nIf you have any questions regarding your leave balance, please reach out to the HR team.\n\nBest regards,\n${engineer}\n${dept} Team`;
  } else if (i.includes('payroll') || i.includes('salary') || i.includes('pay') || i.includes('compensation')) {
    body = `Hello ${name},\n\nYour payroll query has been reviewed and resolved.\n\nThe necessary corrections have been processed. The updated information will be reflected in your next payroll cycle. If you need to verify the details, please check your payroll portal.\n\nIf you have further questions, please do not hesitate to contact us.\n\nBest regards,\n${engineer}\n${dept} Team`;
  } else if (i.includes('password') || i.includes('reset') || i.includes('locked') || i.includes('account')) {
    body = `Hello ${name},\n\nYour account access issue has been resolved.\n\nYour account has been updated in our system. Please attempt to log in now. You may need to use the "Forgot Password" option on the login page to set a new password if required.\n\nFor security reasons, we are unable to share credentials via email. Please use the self-service portal or IntelliDesk to retrieve your account details securely.\n\nBest regards,\n${engineer}\n${dept} Team`;
  } else if (i.includes('printer') || i.includes('print')) {
    body = `Hello ${name},\n\nThe printer issue you reported has been resolved.\n\nThe device has been repaired and is back in service. You should now be able to print normally. If you continue to experience any issues, please raise a new support request.\n\nBest regards,\n${engineer}\n${dept} Team`;
  } else if (i.includes('network') || i.includes('wifi') || i.includes('wi-fi') || i.includes('internet') || i.includes('connectivity')) {
    body = `Hello ${name},\n\nYour network access issue has been resolved.\n\nYou should now have connectivity. Please test your connection and verify everything is working as expected. If you still face connectivity issues, please reply to this email.\n\nBest regards,\n${engineer}\n${dept} Team`;
  } else if (i.includes('onboarding') || i.includes('new employee') || i.includes('new hire') || i.includes('joining')) {
    body = `Hello ${name},\n\nWelcome to the team! Your onboarding setup has been completed.\n\nAll required system access and tools have been provisioned for you. You can log in to IntelliDesk to view your account details and first-day information. Your manager has also been notified.\n\nWe look forward to having you on board. If you have any questions, please do not hesitate to reach out.\n\nBest regards,\n${engineer}\n${dept} Team`;
  } else if (i.includes('software') || i.includes('license') || i.includes('install') || i.includes('application')) {
    body = `Hello ${name},\n\nYour software request has been completed.\n\nThe requested application has been set up and is ready for use. You can now access it from your workstation. If you encounter any issues during first launch, please reply to this email.\n\nBest regards,\n${engineer}\n${dept} Team`;
  } else {
    body = `Hello ${name},\n\nYour support request has been reviewed and successfully resolved by our team.\n\nThe work has been completed as requested. If there are any follow-up steps required on your end, you will be notified separately through IntelliDesk.\n\nThank you for your patience. If you have any further questions, please feel free to reply to this email.\n\nBest regards,\n${engineer}\n${dept} Team`;
  }

  return body;
}

// ── Strict customer-safe Gemini prompt ────────────────────────────────────────

function buildCustomerEmailPrompt(params: {
  intent: string;
  department: string;
  employeeName: string;
  engineerNotes: string;
  assignedTo: string;
  workLogSummary: string;
}): string {
  const { intent, department, employeeName, engineerNotes, assignedTo, workLogSummary } = params;

  return `You are generating a professional customer-facing resolution email for an IT/HR support ticket that has been resolved.

═══════════════════════════════════════════════════════════
ABSOLUTE RULES — VIOLATION IS NOT ACCEPTABLE:
═══════════════════════════════════════════════════════════
1. NEVER include any of the following in the email:
   • Passwords, temporary passwords, or any credentials
   • User IDs, SAP IDs, employee IDs, database IDs
   • Usernames or login names
   • URLs, server addresses, VPN server addresses
   • License keys, activation codes, tokens
   • Assigned roles, permission names, VLAN IDs
   • Any system-internal reference numbers or codes
   • IP addresses, MAC addresses, port numbers

2. If the employee needs any credentials or access details, tell them:
   "You can securely view your access details in IntelliDesk"
   or "Please check your IntelliDesk portal for your account details"
   NEVER list the credentials inline.

3. Write ONLY the email body — from greeting to sign-off.
   Do NOT add headers, metadata, or subject lines.

4. Tone: warm, professional, concise. 2-4 short paragraphs maximum.

5. End with:
   Best regards,
   ${assignedTo || 'Support Team'}
   ${department || 'IT Support'} Team

═══════════════════════════════════════════════════════════
TICKET CONTEXT:
═══════════════════════════════════════════════════════════
Employee name: ${employeeName || 'Employee'}
Department: ${department || 'Support'}
Request type / Intent: ${intent || 'General support request'}

Engineer resolution summary (use this to understand what was done — do NOT copy verbatim):
${engineerNotes || 'Issue has been resolved by the support team.'}

Recent work actions (internal reference — summarise at a high level only):
${workLogSummary || 'Work completed.'}

═══════════════════════════════════════════════════════════
INTENT-SPECIFIC GUIDANCE:
═══════════════════════════════════════════════════════════
• SAP/ERP access → Say access has been provisioned. Direct them to IntelliDesk to view their system access details securely.
• VPN → Say VPN is ready. Ask them to reconnect and test. Do NOT mention server addresses.
• Password reset → Say account has been updated. Tell them to use the self-service portal or IntelliDesk. Never send a password.
• Hardware/Laptop → Say device is ready for collection. Give a location if mentioned in notes.
• Leave request → Confirm leave is approved. Direct them to their HR portal for dates.
• Payroll → Confirm correction processed. Say it reflects in next payroll cycle.
• Software/License → Say software is ready on their workstation.
• Printer → Say printer is fixed and back in service.
• Network/WiFi → Say connectivity is restored. Ask them to test.
• Onboarding → Welcome them. Say setup is complete. Direct to IntelliDesk.
• General → Confirm resolution. Be warm and brief.

Write the email body now (greeting to sign-off, no subject line):`;
}

// ── Main handler ──────────────────────────────────────────────────────────────

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await req.json();
    const { engineerNotes, actor } = body as { engineerNotes?: string; actor?: string };

    // Load work item context
    const detail = await getWorkItem(params.id);
    if (!detail) {
      return NextResponse.json({ error: 'Work item not found' }, { status: 404 });
    }

    const { item, email, ticket, logs } = detail;
    const intent        = item.intent       ?? ticket?.intent ?? email?.intent ?? 'Support request';
    const department    = item.department   ?? '';
    const employeeName  = item.employee_name ?? '';
    const assignedTo    = actor ?? item.assigned_to ?? 'Support Team';

    // Build work log summary (customer-safe — only action names, no internal notes)
    const workLogSummary = (logs ?? [])
      .filter((l: any) => ['started', 'completed', 'verified'].includes(l.action))
      .slice(-5)
      .map((l: any) => `• ${l.action} at ${l.created_at ? new Date(l.created_at).toLocaleString() : 'N/A'}`)
      .join('\n');

    // Build safe subject
    const safeSubject = buildSafeSubject(intent, employeeName);

    // Try Gemini
    const geminiKey = await getGeminiKey();
    let emailBody: string | null = null;

    if (geminiKey) {
      const prompt = buildCustomerEmailPrompt({
        intent,
        department,
        employeeName,
        engineerNotes: engineerNotes?.trim() || '',
        assignedTo,
        workLogSummary,
      });
      emailBody = await callGemini(prompt, geminiKey);
    }

    // Fall back to intent-based safe template
    if (!emailBody) {
      emailBody = buildSafeFallback(intent, employeeName, department, assignedTo);
    }

    return NextResponse.json({
      subject: safeSubject,
      body:    emailBody,
    });

  } catch (err: any) {
    console.error('[generate-customer-email]', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

function buildSafeSubject(intent: string, employeeName: string): string {
  const i = (intent ?? '').toLowerCase();
  const name = employeeName ? ` — ${employeeName}` : '';

  if (i.includes('sap') || i.includes('erp'))          return `Re: SAP Access Request${name}`;
  if (i.includes('vpn') || i.includes('remote'))       return `Re: VPN Access Request${name}`;
  if (i.includes('laptop') || i.includes('hardware'))  return `Re: Device Request${name}`;
  if (i.includes('leave') || i.includes('vacation'))   return `Re: Leave Request${name}`;
  if (i.includes('payroll') || i.includes('salary'))   return `Re: Payroll Query${name}`;
  if (i.includes('password') || i.includes('reset'))   return `Re: Account Access${name}`;
  if (i.includes('printer'))                           return `Re: Printer Issue${name}`;
  if (i.includes('network') || i.includes('wifi'))     return `Re: Network Access${name}`;
  if (i.includes('software') || i.includes('license')) return `Re: Software Request${name}`;
  if (i.includes('onboarding') || i.includes('joiner'))return `Re: Onboarding Setup${name}`;
  return `Re: Your Support Request${name}`;
}
