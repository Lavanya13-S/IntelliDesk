/** GET /api/dept/stats — KPI summary */
import { NextRequest, NextResponse } from 'next/server';
import { getDeptStats } from '@/lib/dept-service';

export async function GET(req: NextRequest) {
  try {
    const dept = req.nextUrl.searchParams.get('department') ?? undefined;
    const stats = await getDeptStats(dept);
    return NextResponse.json({ stats });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
