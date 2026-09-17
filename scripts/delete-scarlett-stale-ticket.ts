/**
 * scripts/delete-scarlett-stale-ticket.ts
 *
 * One-shot targeted deletion of the stale "Request for Emergency Leave"
 * email from scarlettquinn456@gmail.com and all its cascaded records.
 *
 * This email was imported via Gmail but carries an incorrect OLD classification
 * (Software Installation / IT / End User Support / Critical / Auto Resolve).
 * It must be fully removed so new classification tests start from a clean state.
 *
 * Usage:
 *   $env:NEXT_PUBLIC_SUPABASE_URL="..."; $env:SUPABASE_SERVICE_ROLE_KEY="...";
 *   npx tsx scripts/delete-scarlett-stale-ticket.ts
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL     = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('❌  Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function hr() { console.log('─'.repeat(60)); }

async function run() {
  console.log('\n🎯  Targeted Stale Ticket Deletion\n');
  hr();

  // ── 1. Find the specific email ─────────────────────────────────────────────
  const { data: emails, error: fetchErr } = await sb
    .from('emails')
    .select('id, sender, subject, intent, department, priority, status, gmail_message_id, received_at')
    .ilike('sender', '%scarlettquinn456%');

  if (fetchErr) {
    console.error('❌  Fetch error:', fetchErr.message);
    process.exit(1);
  }

  console.log(`🔍  Emails from scarlettquinn456: ${emails?.length ?? 0}`);
  if (!emails || emails.length === 0) {
    console.log('✅  No matching emails found — nothing to delete.\n');
    return;
  }

  for (const e of emails) {
    console.log(`\n    ID:       ${e.id}`);
    console.log(`    Subject:  ${e.subject}`);
    console.log(`    Sender:   ${e.sender}`);
    console.log(`    Intent:   ${e.intent ?? '—'}`);
    console.log(`    Dept:     ${e.department ?? '—'}`);
    console.log(`    Priority: ${e.priority ?? '—'}`);
    console.log(`    Status:   ${e.status}`);
    console.log(`    GmailID:  ${e.gmail_message_id ?? 'NULL'}`);
    console.log(`    Received: ${e.received_at}`);
  }
  hr();

  const emailIds = emails.map((e: any) => e.id);

  // ── 2. Get ticket IDs for resolved_cases cleanup (no CASCADE on that table) ──
  const { data: ticketRows } = await sb
    .from('tickets')
    .select('id')
    .in('email_id', emailIds);

  const ticketIds = (ticketRows ?? []).map((t: any) => t.id);
  console.log(`📦  Tickets found: ${ticketIds.length}`);

  // ── 3. Explicitly delete resolved_cases (may not have CASCADE) ─────────────
  if (ticketIds.length > 0) {
    const { error: rcErr } = await sb
      .from('resolved_cases')
      .delete()
      .in('ticket_id', ticketIds);
    if (rcErr) console.warn(`⚠️   resolved_cases: ${rcErr.message}`);
    else console.log('    ✓ resolved_cases cleaned');

    // decision_logs (just in case no cascade)
    const { error: dlErr } = await sb
      .from('decision_logs')
      .delete()
      .in('ticket_id', ticketIds);
    if (dlErr) console.warn(`⚠️   decision_logs: ${dlErr.message}`);
    else console.log('    ✓ decision_logs cleaned');
  }

  // ── 4. Delete emails → cascade handles everything else ─────────────────────
  console.log('\n🔄  Deleting email(s) (cascades to tickets → responses → approvals,');
  console.log('    response_versions, actions, similar_cases, dept_work_items, dept_work_logs)…');

  const { error: delErr } = await sb
    .from('emails')
    .delete()
    .in('id', emailIds);

  if (delErr) {
    console.error('❌  Delete failed:', delErr.message);
    process.exit(1);
  }

  console.log(`\n✅  Deleted ${emails.length} email(s) and all cascaded child records.`);
  hr();

  // ── 5. Verify gone ─────────────────────────────────────────────────────────
  const { data: verify } = await sb
    .from('emails')
    .select('id')
    .ilike('sender', '%scarlettquinn456%');

  if (!verify || verify.length === 0) {
    console.log('✅  Verified: scarlettquinn456 email no longer exists in database.');
  } else {
    console.warn(`⚠️   ${verify.length} record(s) still found — check for duplicates.`);
  }

  const { count: emailCount } = await sb.from('emails').select('*', { count: 'exact', head: true });
  const { count: ticketCount } = await sb.from('tickets').select('*', { count: 'exact', head: true });
  console.log(`\n📊  Remaining: ${emailCount} email(s), ${ticketCount} ticket(s)\n`);
}

run().catch((err) => {
  console.error('❌  Unexpected error:', err);
  process.exit(1);
});
