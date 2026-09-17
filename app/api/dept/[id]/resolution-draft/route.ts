/**
 * POST /api/dept/[id]/resolution-draft
 *
 * Returns the detected/selected resolution template and its fields
 * for the engineer to fill before sending the resolution email.
 *
 * This route NEVER generates sensitive values.
 * All fields are returned as empty strings — the engineer fills them.
 *
 * Body (optional): { overrideTemplateId?: string }
 *
 * Response:
 *   {
 *     templateId, templateLabel,
 *     allTemplates: [{id, label}],
 *     subject, intro, sections, closing,
 *     employeeName, employeeEmail, intent, department
 *   }
 */
import { NextRequest, NextResponse } from 'next/server';
import { getWorkItem } from '@/lib/dept-service';
import {
  detectTemplate,
  getTemplateById,
  getAllTemplateOptions,
} from '@/lib/resolution-templates';

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await req.json().catch(() => ({}));
    const { overrideTemplateId } = body as { overrideTemplateId?: string };

    const detail = await getWorkItem(params.id);
    if (!detail) {
      return NextResponse.json({ error: 'Work item not found' }, { status: 404 });
    }

    const { item, email, ticket } = detail;

    const intent        = item.intent ?? ticket?.intent ?? email?.intent ?? '';
    const ticketBody    = email?.body ?? ticket?.intent ?? intent ?? '';
    const department    = item.department ?? '';
    const subteam       = item.team_name ?? (ticket as any)?.subteam ?? '';
    const employeeName  = item.employee_name ?? '';
    const employeeEmail = item.employee_email ?? '';

    // Detect or override template — pass subteam for precise matching
    const template = overrideTemplateId
      ? getTemplateById(overrideTemplateId)
      : detectTemplate(intent, ticketBody, department, subteam);

    // Build subject with employee name substituted
    const subject = template.subject.replace('{{name}}', employeeName || 'Employee');

    return NextResponse.json({
      templateId:    template.id,
      templateLabel: template.label,
      allTemplates:  getAllTemplateOptions(),
      subject,
      intro:         template.intro,
      sections:      template.sections,
      closing:       template.closing,
      employeeName,
      employeeEmail,
      intent,
      department,
    });
  } catch (err: any) {
    console.error('[dept/resolution-draft]', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
