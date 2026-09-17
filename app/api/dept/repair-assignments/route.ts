/**
 * POST /api/dept/repair-assignments
 *
 * On-demand assignment repair endpoint.
 *
 * Finds all dept_work_items where assigned_to IS NULL (excluding completed),
 * resolves the correct assignee from org directory data, and updates each row.
 *
 * IDEMPOTENT: checks for existing 'assigned' work log before writing a new one.
 * SLA RESET: resets sla_deadline if the current one is already past.
 *
 * This is NOT a backfill — it does not create new work items.
 * It only repairs existing items that are missing an assignment.
 *
 * Can also accept a specific workItemId to repair a single item:
 *   POST /api/dept/repair-assignments
 *   Body: { "workItemId": "uuid" }  (optional)
 *
 * Returns: { repaired, skipped, errors, details[] }
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { resolveAssignee } from '@/lib/dept-service';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const SLA_HOURS: Record<string, number> = { critical: 2, high: 4, medium: 8, low: 24 };

export async function POST(req: NextRequest) {
  try {
    let specificId: string | null = null;
    try {
      const body = await req.json();
      specificId = body?.workItemId ?? null;
    } catch { /* body is optional */ }

    // ── Fetch unassigned work items ───────────────────────────────────────────
    let query = supabaseAdmin
      .from('dept_work_items')
      .select('id, department, team_name, priority, status, assigned_to, sla_deadline, sla_breached')
      .is('assigned_to', null)
      .neq('status', 'completed');

    if (specificId) {
      query = supabaseAdmin
        .from('dept_work_items')
        .select('id, department, team_name, priority, status, assigned_to, sla_deadline, sla_breached')
        .eq('id', specificId)
        .is('assigned_to', null);
    }

    const { data: items, error: fetchErr } = await query;
    if (fetchErr) {
      return NextResponse.json({ error: fetchErr.message }, { status: 500 });
    }

    let repaired = 0;
    let skipped = 0;
    const errors: string[] = [];
    const details: Array<{
      workItemId: string;
      department: string | null;
      team: string | null;
      assignedTo: string | null;
      status: 'repaired' | 'no_assignee' | 'skipped_duplicate' | 'error';
    }> = [];

    for (const item of (items ?? [])) {
      try {
        const priority = item.priority ?? 'medium';

        // Resolve the best available org-directory assignee
        const assignee = await resolveAssignee(item.team_name ?? null, item.department ?? null, priority);

        if (!assignee) {
          skipped++;
          details.push({
            workItemId: item.id,
            department: item.department,
            team:       item.team_name,
            assignedTo: null,
            status:     'no_assignee',
          });
          console.warn(
            `[repair-assignments] No eligible assignee for work item ${item.id} ` +
            `(dept="${item.department}" team="${item.team_name}")`
          );
          continue;
        }

        // ── Idempotency: skip log write if one already exists ─────────────────
        const { count: logCount } = await supabaseAdmin
          .from('dept_work_logs')
          .select('id', { count: 'exact', head: true })
          .eq('work_item_id', item.id)
          .eq('action', 'assigned');

        const alreadyLogged = (logCount ?? 0) > 0;

        // ── SLA reset if current deadline is already past ─────────────────────
        const slaHours = SLA_HOURS[priority] ?? 4;
        const needsSlaReset = item.sla_breached ||
          (item.sla_deadline && new Date(item.sla_deadline) < new Date());

        const upPayload: Record<string, any> = {
          assigned_to:          assignee.employee_name,
          assigned_employee_id: assignee.employee_id,
          assigned_at:          new Date().toISOString(),
        };
        if (needsSlaReset) {
          upPayload.sla_deadline = new Date(Date.now() + slaHours * 3_600_000).toISOString();
          upPayload.sla_breached = false;
        }

        // Update the work item — safe fallback if assigned_employee_id column not yet in DB
        let upErr: any = null;
        const { error: upErr1 } = await supabaseAdmin
          .from('dept_work_items')
          .update(upPayload)
          .eq('id', item.id)
          .is('assigned_to', null);

        if (upErr1) {
          const isColMissing =
            upErr1.message?.includes('assigned_employee_id') || upErr1.code === '42703';
          if (isColMissing) {
            const { assigned_employee_id: _d, ...payloadNofk } = upPayload;
            const { error: upErr2 } = await supabaseAdmin
              .from('dept_work_items').update(payloadNofk).eq('id', item.id).is('assigned_to', null);
            upErr = upErr2;
          } else {
            upErr = upErr1;
          }
        }

        if (upErr) {
          errors.push(`${item.id}: ${upErr.message}`);
          details.push({
            workItemId: item.id,
            department: item.department,
            team:       item.team_name,
            assignedTo: null,
            status:     'error',
          });
          continue;
        }

        // ── Write work log only once ──────────────────────────────────────────
        if (!alreadyLogged) {
          await supabaseAdmin.from('dept_work_logs').insert({
            work_item_id: item.id,
            actor:        'system',
            action:       'assigned',
            note:
              `Automatically assigned to ${assignee.employee_name} (${assignee.employee_email}) ` +
              `by system (repair-assignments). Department: ${item.department ?? 'Unknown'}, ` +
              `Team: ${item.team_name ?? 'Unknown'}, Priority: ${priority}. ` +
              `Designation: ${assignee.designation}.` +
              (needsSlaReset ? ' SLA reset from point of assignment.' : ''),
          });
        }

        repaired++;
        details.push({
          workItemId: item.id,
          department: item.department,
          team:       item.team_name,
          assignedTo: assignee.employee_name,
          status:     alreadyLogged ? 'skipped_duplicate' : 'repaired',
        });

        console.log(
          `[repair-assignments] Repaired work item ${item.id}: ` +
          `assigned to ${assignee.employee_name} (${item.department} / ${item.team_name})` +
          (alreadyLogged ? ' [log skipped — already exists]' : '') +
          (needsSlaReset ? ' [SLA reset]' : '')
        );
      } catch (e: any) {
        errors.push(`${item.id}: ${e?.message}`);
        details.push({
          workItemId: item.id,
          department: item.department ?? null,
          team:       item.team_name ?? null,
          assignedTo: null,
          status:     'error',
        });
      }
    }

    console.log(`[repair-assignments] Done. repaired=${repaired} skipped=${skipped} errors=${errors.length}`);

    return NextResponse.json({
      repaired,
      skipped,
      errors,
      details,
    });
  } catch (err: any) {
    console.error('[repair-assignments] unhandled error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
