/**
 * POST /api/dept/[id]/action
 *
 * Enterprise 6-stage workflow actions:
 *   accept            — assigned          → accepted           (Assign to Me)
 *   start             — accepted          → in_progress        (Start Work)
 *   request_info      — in_progress       → waiting            (Request More Info)
 *   resume            — waiting           → in_progress        (Resume Work)
 *   complete_dept_processing — active     → customer_resolution (Complete Dept Processing)
 *   submit_for_review — in_progress       → quality_check      (QV path)
 *   verify_approve    — quality_check     → completed
 *   verify_return     — quality_check     → in_progress        (Return for Rework)
 *   escalate          — adds escalation log
 *   comment           — adds work log comment
 *   reassign          — assigns to another engineer
 *
 * Body: { action, actor, note?, reassignTo?, fieldValues?, templateId? }
 *
 * For complete_dept_processing:
 *   fieldValues  — map of field id → value from the internal resolution form
 *   templateId   — which template was loaded (used to determine required fields)
 *   Both are validated server-side. If required fields are missing → 400.
 *   On success, fieldValues are persisted to dept_work_items.internal_resolution_fields
 *   and a customer-safe summary to dept_work_items.resolution_safe_summary.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { executeAction } from '@/lib/dept-service';
import { getTemplateById } from '@/lib/resolution-templates';

const VALID_ACTIONS = [
  'accept', 'start', 'request_info', 'resume',
  'complete_dept_processing',
  'submit_for_review', 'verify_approve', 'verify_return',
  'escalate', 'comment', 'reassign',
];

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

/**
 * Build a customer-safe resolution summary from field values.
 * NEVER includes salary amounts, corrected amounts, or any sensitive figures.
 * Only includes high-level descriptions safe to pass to Gemini.
 */
function buildSafeSummary(fieldValues: Record<string, string>, intent: string): string {
  const parts: string[] = [];

  // Use only the non-financial, non-sensitive fields for the safe summary
  const safeFieldIds = [
    'issue_type',       'resolution_summary', 'processing_notes',
    'access_level',     'system_name',        'resolution_action',
    'action_taken',     'completion_notes',   'summary',
    'notes',
  ];

  for (const [key, value] of Object.entries(fieldValues)) {
    if (!value?.trim()) continue;
    const isAmountField = /amount|salary|cost|price|figure|₹|\$|compensation/i.test(key);
    const isCredentialField = /password|username|token|secret|key|id|credential/i.test(key);
    if (isAmountField || isCredentialField) continue;
    if (safeFieldIds.some(safe => key.toLowerCase().includes(safe))) {
      parts.push(value.trim());
    }
  }

  // Fallback: just say issue was reviewed and resolved
  if (parts.length === 0) {
    const intentLower = (intent ?? '').toLowerCase();
    if (intentLower.includes('payroll') || intentLower.includes('salary')) {
      return 'Payroll issue reviewed. Corrections have been processed and will reflect in the next payroll cycle.';
    }
    return 'Issue reviewed and resolved by the support team.';
  }

  return parts.join('. ');
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await req.json();
    const { action, actor, note, reassignTo, fieldValues, templateId } = body;

    if (!action || !actor) {
      return NextResponse.json({ error: 'action and actor are required' }, { status: 400 });
    }

    if (!VALID_ACTIONS.includes(action)) {
      return NextResponse.json(
        { error: `Invalid action "${action}". Valid: ${VALID_ACTIONS.join(', ')}` },
        { status: 400 }
      );
    }

    // ── Backend validation: complete_dept_processing required fields ──────────
    if (action === 'complete_dept_processing') {
      console.log(`[DEPT_COMPLETE] request received workItemId=${params.id} actor=${actor} templateId=${templateId}`);

      if (templateId) {
        const template = getTemplateById(templateId);
        const values: Record<string, string> = fieldValues ?? {};

        const missingFields: string[] = [];
        for (const section of template.sections) {
          for (const field of section.fields) {
            if (field.required && !values[field.id]?.trim()) {
              missingFields.push(field.label);
            }
          }
        }

        if (missingFields.length > 0) {
          console.warn(
            `[DEPT_COMPLETE] REJECTED — missing required fields: ${missingFields.join(', ')} ` +
            `workItemId=${params.id} templateId=${templateId}`
          );
          return NextResponse.json(
            {
              error: `Please complete all required fields before completing Department Processing: ${missingFields.join(', ')}`,
              missingFields,
            },
            { status: 400 }
          );
        }

        console.log(`[DEPT_COMPLETE] field validation passed — templateId=${templateId} fields=${Object.keys(values).length}`);
      }

      // ── Persist internal resolution fields BEFORE advancing the workflow ───
      // internal_resolution_fields = full confidential form data (never sent to customer)
      // resolution_safe_summary    = high-level safe text used to brief Gemini only
      if (fieldValues && Object.keys(fieldValues).length > 0) {
        try {
          const supabase = getServiceClient();
          // Fetch intent for safe summary building
          const { data: workItemRow } = await supabase
            .from('dept_work_items')
            .select('intent')
            .eq('id', params.id)
            .maybeSingle();

          const intent = workItemRow?.intent ?? '';
          const safeSummary = buildSafeSummary(fieldValues, intent);

          await supabase
            .from('dept_work_items')
            .update({
              internal_resolution_fields: fieldValues,
              resolution_safe_summary: safeSummary,
            })
            .eq('id', params.id);

          console.log(`[DEPT_COMPLETE] persisted internal_resolution_fields for workItemId=${params.id}`);
        } catch (saveErr: any) {
          // Non-fatal — log but don't block the workflow transition
          console.error('[DEPT_COMPLETE] failed to save resolution fields (non-fatal):', saveErr.message);
        }
      }
    }

    const result = await executeAction(params.id, { action, actor, note, reassignTo });

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 409 });
    }

    // ── Sync tickets.workflow_stage after milestone transitions ──────────────
    // This keeps the ticket's persisted stage in sync with the dept_work_items
    // state so ALL UI components (inbox, dept page, notifications) derive the
    // correct stage without a separate polling step.
    if (result.item?.ticket_id) {
      const supabase = getServiceClient();
      try {
        if (action === 'complete_dept_processing') {
          // Stage 3 → 4: Dept Processing complete → Customer Resolution
          await supabase
            .from('tickets')
            .update({ workflow_stage: 'Customer Resolution' })
            .eq('id', result.item.ticket_id)
            .not('status', 'in', '(resolved,completed)');
        } else if (action === 'accept' || action === 'start') {
          // Stage 1/2 → 3: Accepted/Started → Dept Processing active
          // Only set if not already further advanced
          await supabase
            .from('tickets')
            .update({ workflow_stage: 'Dept Processing', status: 'in_progress' })
            .eq('id', result.item.ticket_id)
            .not('status', 'in', '(resolved,completed,customer_resolution)');
        }
      } catch (syncErr: any) {
        // Non-fatal — ticket sync failure should not break the dept action response
        console.warn('[dept/action] ticket workflow_stage sync failed (non-fatal):', syncErr?.message);
      }
    }

    console.log(`[DEPT_COMPLETE] success workItemId=${params.id} newStatus=${result.item?.status}`);
    return NextResponse.json({ item: result.item });
  } catch (err: any) {
    console.error('[dept/action] unhandled error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

