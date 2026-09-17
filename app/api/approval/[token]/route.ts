/**
 * GET /api/approval/[token]
 *
 * Token-based approval handler.
 * ?action=approve  → processes the approval and redirects to success page
 * ?action=reject   → redirects to the token landing page for comment entry
 * (no action)      → returns approval details as JSON (for the portal page)
 *
 * POST /api/approval/[token]
 * Body: { action: 'approved'|'rejected', comments?: string }
 */
import { NextRequest, NextResponse } from 'next/server';
import { processApprovalToken, getApprovalByToken } from '@/lib/approval-service';

export async function GET(
  req: NextRequest,
  { params }: { params: { token: string } }
) {
  try {
    const approval = await getApprovalByToken(params.token);
    if (!approval) {
      return NextResponse.json({ error: 'Invalid or expired token' }, { status: 404 });
    }
    return NextResponse.json({ approval });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { token: string } }
) {
  try {
    const { action, comments } = await req.json();
    if (action !== 'approved' && action !== 'rejected') {
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }

    const ipAddress = req.headers.get('x-forwarded-for') ?? 'unknown';
    const userAgent = req.headers.get('user-agent') ?? 'unknown';

    const result = await processApprovalToken({
      token: params.token,
      action,
      comments,
      ipAddress,
      userAgent,
    });

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({ success: true, approval: result.approval });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
