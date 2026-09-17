/**
 * scripts/seed-demo-users.ts
 *
 * Creates or updates Supabase Auth users for all demo accounts.
 * Run once (or any time) after setting SUPABASE_SERVICE_ROLE_KEY in .env.local:
 *
 *   npx ts-node --project tsconfig.json scripts/seed-demo-users.ts
 *
 * Strategy (no duplicates):
 *   1. List all existing Auth users.
 *   2. If a demo email already exists → UPDATE password + metadata (no new user).
 *   3. If it doesn't exist → CREATE new user.
 *   4. Upsert the user_roles row for every demo account.
 *
 * Requires: NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL     = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('❌  Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ─── Final canonical demo accounts ────────────────────────────────────────────

const DEMO_USERS = [
  { email: 'aynaval1213@gmail.com',         password: 'Employee@123', name: 'Sarah Johnson',  role: 'employee',         department: 'Finance' },
  { email: 'lavanyas4074@gmail.com',         password: 'Manager@123',  name: 'Arjun Menon',    role: 'manager',           department: 'IT' },
  { email: 'support@helpmind.local',         password: 'Engineer@123', name: 'Rahul Sharma',   role: 'department_staff',  department: 'SAP Basis' },
  { email: 'intellidesk.support@gmail.com',  password: 'demo123@1',    name: 'IntelliDesk Admin', role: 'admin',             department: 'IT Admin' },
  { email: 'demo@helpmind.local',            password: 'Demo@123',     name: 'Demo User',      role: 'department_staff',  department: 'IT Support' },
] as const;

// ─── Old email aliases to delete from Auth (stale duplicates) ─────────────────
const STALE_EMAILS = [
  'admin@helpmind.local',
  'admin@helpmind.ai',
  'arjun.menon@helpmind.local',
];

async function seed() {
  console.log('🌱  Seeding demo users (update-safe)…\n');

  // ── 1. Fetch all existing Auth users ──────────────────────────────────────
  const { data: { users: existingUsers }, error: listErr } = await supabase.auth.admin.listUsers({ perPage: 1000 });
  if (listErr) {
    console.error('❌  Could not list Auth users:', listErr.message);
    process.exit(1);
  }

  const existingByEmail = new Map(existingUsers.map(u => [u.email?.toLowerCase(), u.id]));
  console.log(`   Found ${existingUsers.length} existing Auth user(s).\n`);

  // ── 2. Delete stale duplicate Auth users ──────────────────────────────────
  for (const staleEmail of STALE_EMAILS) {
    const uid = existingByEmail.get(staleEmail.toLowerCase());
    if (uid) {
      const { error } = await supabase.auth.admin.deleteUser(uid);
      if (error) {
        console.warn(`⚠️   Could not delete stale Auth user ${staleEmail}: ${error.message}`);
      } else {
        console.log(`🗑️   Deleted stale Auth user: ${staleEmail}`);
        existingByEmail.delete(staleEmail.toLowerCase());
      }
    }
  }

  console.log('');

  // ── 3. Create or update each canonical demo user ───────────────────────────
  for (const user of DEMO_USERS) {
    const uid = existingByEmail.get(user.email.toLowerCase());

    if (uid) {
      // User exists — UPDATE password + metadata, do NOT create a new user
      const { error } = await supabase.auth.admin.updateUserById(uid, {
        password:      user.password,
        email_confirm: true,
        user_metadata: { full_name: user.name },
      });
      if (error) {
        console.error(`❌  Failed to update Auth user ${user.email}: ${error.message}`);
      } else {
        console.log(`✅  Updated Auth user: ${user.email}`);
      }
    } else {
      // User does not exist — create it
      const { error } = await supabase.auth.admin.createUser({
        email:         user.email,
        password:      user.password,
        email_confirm: true,
        user_metadata: { full_name: user.name },
      });
      if (error) {
        console.error(`❌  Failed to create Auth user ${user.email}: ${error.message}`);
        continue;
      }
      console.log(`✅  Created Auth user: ${user.email}`);
    }

    // ── 4. Upsert user_roles row ──────────────────────────────────────────
    const { error: roleErr } = await supabase.from('user_roles').upsert(
      {
        email:        user.email,
        role:         user.role,
        display_name: user.name,
        department:   user.department,
        active:       true,
      },
      { onConflict: 'email' }
    );

    if (roleErr) {
      console.warn(`⚠️   user_roles upsert for ${user.email}: ${roleErr.message}`);
    } else {
      console.log(`   └─ Role: ${user.role} | Dept: ${user.department}`);
    }
  }

  // ── 5. Also clean up stale user_roles rows ──────────────────────────────
  console.log('\n🧹  Removing stale user_roles rows…');
  for (const staleEmail of STALE_EMAILS) {
    const { error } = await supabase.from('user_roles').delete().eq('email', staleEmail);
    if (error) {
      console.warn(`⚠️   Could not delete user_roles row for ${staleEmail}: ${error.message}`);
    } else {
      console.log(`   Deleted user_roles: ${staleEmail} (if existed)`);
    }
  }

  // ── 6. Final verification ─────────────────────────────────────────────────
  const { data: finalRoles } = await supabase
    .from('user_roles')
    .select('email, role, display_name')
    .order('role');

  console.log('\n📋  Final user_roles table:');
  console.table(finalRoles);
  console.log(`\n✅  Done. ${finalRoles?.length ?? 0} demo user(s) in user_roles.`);
}

seed().catch(console.error);
