/**
 * GET  /api/dept/queue   — filtered queue list
 * POST /api/dept/queue   — auto-create work item from approved approval
 */
import { NextRequest, NextResponse } from 'next/server';
import { createWorkItem, getWorkQueue } from '@/lib/dept-service';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = req.nextUrl;
    const ticketId = searchParams.get('ticketId') ?? undefined;
    const items = await getWorkQueue({
      department:  searchParams.get('department')  ?? undefined,
      status:      searchParams.get('status')      ?? undefined,
      priority:    searchParams.get('priority')    ?? undefined,
      assignedTo:  searchParams.get('assignedTo')  ?? undefined,
      search:      searchParams.get('search')      ?? undefined,
      dateRange:   (searchParams.get('dateRange') ?? undefined) as any,
      ticketId,
    });
    return NextResponse.json({ items });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const item = await createWorkItem(body);
    if (!item) {
      return NextResponse.json({ message: 'Work item already exists or could not be created', item: null });
    }
    return NextResponse.json({ item }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
