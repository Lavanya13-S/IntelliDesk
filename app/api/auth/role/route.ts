/**
 * GET  /api/auth/role          — get current user role (by email query param)
 * POST /api/auth/role          — upsert a user role
 * GET  /api/auth/role?all=true — get all role records (admin use)
 */
import { NextRequest, NextResponse } from 'next/server';
import { getUserRole, upsertUserRole, getAllRoles } from '@/lib/rbac';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = req.nextUrl;
    const all = searchParams.get('all') === 'true';

    if (all) {
      const roles = await getAllRoles();
      return NextResponse.json({ roles });
    }

    const email = searchParams.get('email');
    if (!email) {
      return NextResponse.json({ error: 'email query param required' }, { status: 400 });
    }

    const role = await getUserRole(email);
    // Default: if not in table, treat as admin (single-tenant demo)
    return NextResponse.json({
      role: role ?? {
        id: 'default',
        email,
        role: 'admin',
        department: null,
        display_name: null,
        active: true,
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { email, role, department, displayName } = await req.json();
    if (!email || !role) {
      return NextResponse.json({ error: 'email and role are required' }, { status: 400 });
    }

    const updated = await upsertUserRole({ email, role, department, displayName });
    if (!updated) {
      return NextResponse.json({ error: 'Failed to upsert role' }, { status: 500 });
    }

    return NextResponse.json({ success: true, role: updated });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
