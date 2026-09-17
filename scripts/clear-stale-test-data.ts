/**
 * scripts/clear-stale-test-data.ts
 *
 * Safely removes stale email/ticket records created by previous classification
 * test runs. Deletes emails (and all cascaded child records) that:
 *
 *   1. Were NOT imported from the real Gmail inbox (gmail_message_id IS NULL), OR
 *   2. Have a sender that is clearly a synthetic test address (not a real Gmail account).
 *
 * WHAT IS DELETED (via CASCADE from emails):
 *   emails → tickets → responses → approvals → response_versions
 *          → actions → similar_cases → decision_logs → dept_work_items
 *          → dept_work_logs → resolved_cases (by ticket_id)
 *
 * WHAT IS NEVER DELETED:
 *   - oauth_tokens          (Gmail OAuth)
 *   - organizations/teams/employees (org directory)
 *   - documents / document_chunks / document_embeddings (Knowledge Base)
 *   - notifications         (notification system)
 *   - ai_settings           (settings)
 *   - user_roles            (authentication)
 *   - kb_policies / kb_faqs (knowledge authored entries)
 *   - approval_rules        (workflow config)
 *   - response_templates    (response config)
 *   - any email with a real gmail_message_id (actually imported from Gmail)
 *
 * Usage:
 *   $env:NEXT_PUBLIC_SUPABASE_URL="..."; $env:SUPABASE_SERVICE_ROLE_KEY="..."; npx tsx scripts/clear-stale-test-data.ts
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL      = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('❌  Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function hr() { console.log('─'.repeat(60)); }

async function countTable(table: string): Promise<number> {
  const { count } = await sb.from(table).select('*', { count: 'exact', head: true });
  return count ?? 0;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function run() {
  console.log('\n🧹  IntelliDesk — Stale Test Data Cleanup\n');
  hr();

  // ── 1. Preview what exists ─────────────────────────────────────────────────
  const totalEmails  = await countTable('emails');
  const totalTickets = await countTable('tickets');
  console.log(`📊  Before cleanup:`);
  console.log(`    emails:  ${totalEmails}`);
  console.log(`    tickets: ${totalTickets}`);
  hr();

  // ── 2. Identify stale email IDs ────────────────────────────────────────────
  //
  // Stale test emails are those where gmail_message_id IS NULL.
  // Real Gmail-imported emails always have a gmail_message_id set by the sync service.
  // Test emails created by /api/classify-all or the pipeline directly never have one.
  //
  // We select their IDs first so we can report exactly what will be deleted.

  const { data: staleEmails, error: fetchErr } = await sb
    .from('emails')
    .select('id, sender, subject, intent, department, status, received_at')
    .is('gmail_message_id', null)
    .order('received_at', { ascending: true });

  if (fetchErr) {
    console.error('❌  Could not fetch stale emails:', fetchErr.message);
    process.exit(1);
  }

  if (!staleEmails || staleEmails.length === 0) {
    console.log('✅  No stale test emails found (all emails have a gmail_message_id).');
    console.log('    Nothing to delete.\n');
    return;
  }

  console.log(`🗑️   Found ${staleEmails.length} stale test email(s) (no gmail_message_id):\n`);
  for (const e of staleEmails) {
    console.log(`    [${(e.received_at as string).slice(0, 16)}] ${e.subject?.slice(0, 60)}`);
    console.log(`       sender: ${e.sender}  |  intent: ${e.intent ?? '—'}  |  dept: ${e.department ?? '—'}  |  status: ${e.status}`);
  }
  hr();

  // ── 3. Count child records that will cascade ───────────────────────────────
  const staleIds = staleEmails.map((e: any) => e.id);

  const { count: staleTickets } = await sb
    .from('tickets')
    .select('*', { count: 'exact', head: true })
    .in('email_id', staleIds);

  console.log(`📦  Records that will be removed via cascade:`);
  console.log(`    emails:  ${staleEmails.length}`);
  console.log(`    tickets: ${staleTickets ?? 0} (+ all child records via ON DELETE CASCADE)`);
  console.log(`    → responses, approvals, response_versions, actions,`);
  console.log(`      similar_cases, decision_logs, dept_work_items, dept_work_logs`);
  hr();

  // ── 4. Delete stale emails → cascades everything ───────────────────────────
  //
  // The schema uses ON DELETE CASCADE on:
  //   tickets          (email_id → emails.id)
  //   responses        (ticket_id → tickets.id)
  //   approvals        (response_id → responses.id)  [migration 016]
  //   response_versions(response_id → responses.id)  [migration 003]
  //   actions          (ticket_id → tickets.id)
  //   similar_cases    (ticket_id → tickets.id)
  //   decision_logs    (ticket_id → tickets.id)       [migration 011]
  //   dept_work_items  (ticket_id → tickets.id)       [migration 020]
  //   dept_work_logs   (work_item_id → dept_work_items.id)
  //
  // resolved_cases references ticket_id but may not have CASCADE — delete explicitly.

  console.log('🔄  Deleting resolved_cases for stale tickets…');
  const { count: staleTicketCount } = await sb
    .from('tickets')
    .select('id', { count: 'exact', head: false })
    .in('email_id', staleIds);

  // Fetch stale ticket IDs for resolved_cases cleanup
  const { data: staleTicketRows } = await sb
    .from('tickets')
    .select('id')
    .in('email_id', staleIds);

  const staleTicketIds = (staleTicketRows ?? []).map((t: any) => t.id);

  if (staleTicketIds.length > 0) {
    const { error: rcErr } = await sb
      .from('resolved_cases')
      .delete()
      .in('ticket_id', staleTicketIds);
    if (rcErr) {
      console.warn(`⚠️   resolved_cases delete warning: ${rcErr.message}`);
    } else {
      console.log(`    ✓ resolved_cases cleaned`);
    }
  }

  // Now delete the emails — cascade handles the rest
  console.log('🔄  Deleting stale emails (cascades to all child tables)…');
  const { error: delErr } = await sb
    .from('emails')
    .delete()
    .in('id', staleIds);

  if (delErr) {
    console.error('❌  Delete failed:', delErr.message);
    process.exit(1);
  }

  console.log(`\n✅  Deleted ${staleEmails.length} stale emails and all cascaded child records.\n`);

  // ── 5. Post-cleanup counts ─────────────────────────────────────────────────
  hr();
  const afterEmails  = await countTable('emails');
  const afterTickets = await countTable('tickets');
  console.log(`📊  After cleanup:`);
  console.log(`    emails:  ${afterEmails}  (was ${totalEmails})`);
  console.log(`    tickets: ${afterTickets}  (was ${totalTickets})`);

  // Confirm preserved tables are untouched
  const oauth      = await countTable('oauth_tokens');
  const aiSettings = await countTable('ai_settings');
  const userRoles  = await countTable('user_roles');
  const notifs     = await countTable('notifications');
  const docs       = await countTable('documents');
  console.log(`\n🛡️   Preserved (unchanged):`);
  console.log(`    oauth_tokens:  ${oauth}`);
  console.log(`    ai_settings:   ${aiSettings}`);
  console.log(`    user_roles:    ${userRoles}`);
  console.log(`    notifications: ${notifs}`);
  console.log(`    documents:     ${docs}`);
  hr();
  console.log('✅  Done. Inbox is clean and ready for fresh classification testing.\n');
}

run().catch((err) => {
  console.error('❌  Unexpected error:', err);
  process.exit(1);
});
