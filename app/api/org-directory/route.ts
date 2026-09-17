/**
 * app/api/org-directory/route.ts
 *
 * REST API for the Enterprise Organization Directory.
 *
 * GET /api/org-directory?type=departments
 * GET /api/org-directory?type=teams
 * GET /api/org-directory?type=employees&search=xyz
 * GET /api/org-directory?type=employee&email=sarah.johnson@company.com
 * GET /api/org-directory?type=managers
 * GET /api/org-directory?type=stats
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  getAllDepartments,
  getAllTeams,
  getAllEmployees,
  getAllManagers,
  searchEmployees,
  lookupEmployeeByEmail,
} from '@/lib/org-directory';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = req.nextUrl;
    const type = searchParams.get('type') || 'employees';

    switch (type) {
      case 'departments': {
        const data = await getAllDepartments();
        return NextResponse.json({ departments: data });
      }

      case 'teams': {
        const data = await getAllTeams();
        return NextResponse.json({ teams: data });
      }

      case 'employees': {
        const search = searchParams.get('search') || '';
        const data = search
          ? await searchEmployees(search)
          : await getAllEmployees();
        return NextResponse.json({ employees: data });
      }

      case 'employee': {
        const email = searchParams.get('email');
        if (!email) {
          return NextResponse.json({ error: 'email parameter required' }, { status: 400 });
        }
        const profile = await lookupEmployeeByEmail(email);
        if (!profile) {
          return NextResponse.json({ error: 'Employee not found', email }, { status: 404 });
        }
        return NextResponse.json({ employee: profile });
      }

      case 'managers': {
        const data = await getAllManagers();
        return NextResponse.json({ managers: data });
      }

      case 'stats': {
        const [depts, emps, mgrs] = await Promise.all([
          getAllDepartments(),
          getAllEmployees(),
          getAllManagers(),
        ]);
        return NextResponse.json({
          stats: {
            total_departments: depts.length,
            total_employees: emps.length,
            total_managers: mgrs.length,
            active_employees: emps.filter((e: any) => e.employment_status === 'active').length,
          },
        });
      }

      default:
        return NextResponse.json({ error: `Unknown type: ${type}` }, { status: 400 });
    }
  } catch (err) {
    console.error('[org-directory API]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
