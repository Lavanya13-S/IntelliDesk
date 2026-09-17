/**
 * GET    /api/dept/[id]  — single work item with all context
 * DELETE /api/dept/[id]  — permanently remove a work item and all its logs
 */
import { NextRequest, NextResponse } from 'next/server';
import { getWorkItem } from '@/lib/dept-service';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const detail = await getWorkItem(params.id);
    if (!detail) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(detail);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    // Delete child logs first (FK constraint)
    await supabaseAdmin
      .from('dept_work_logs')
      .delete()
      .eq('work_item_id', params.id);

    const { error } = await supabaseAdmin
      .from('dept_work_items')
      .delete()
      .eq('id', params.id);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
