/**
 * GET  /api/approvals               — queue list (with filters)
 * GET  /api/approvals?type=stats    — KPI stats
 *
 * Filters (all optional):
 *   status, department, priority, search  — existing
 *   managerEmail                          — RBAC: scope to a specific manager
 *   dateRange = 'today' | 'week' | 'month' — date window
 */
import { NextRequest, NextResponse } from 'next/server';
import { getApprovalQueue, getApprovalStats } from '@/lib/approval-service';
import { supabase } from '@/lib/supabase';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = req.nextUrl;
    const type = searchParams.get('type');

    if (type === 'stats') {
      // Optionally scope stats to a manager
      const managerEmail = searchParams.get('managerEmail') ?? undefined;
      const stats = await getApprovalStats(managerEmail);
      return NextResponse.json({ stats });
    }

    const filters = {
      status:       searchParams.get('status')       ?? undefined,
      department:   searchParams.get('department')   ?? undefined,
      priority:     searchParams.get('priority')     ?? undefined,
      search:       searchParams.get('search')       ?? undefined,
      managerEmail: searchParams.get('managerEmail') ?? undefined,
      dateRange:    (searchParams.get('dateRange') ?? undefined) as 'today' | 'week' | 'month' | undefined,
    };

    const queue = await getApprovalQueue(filters);
    return NextResponse.json({ approvals: queue });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
