/**
 * delete-email.mjs
 * Deletes a specific email by sender and ALL related data from Supabase.
 * Usage: node scripts/delete-email.mjs
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL  = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://hayazylykiujdvgnbafk.supabase.co';
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const TARGET_SENDER = 'aynaval1213@gmail.com';

if (!SERVICE_KEY) {
  console.error('❌  SUPABASE_SERVICE_ROLE_KEY env var is required');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

async function run() {
  console.log(`\n🗑  Deleting all data for sender: ${TARGET_SENDER}\n`);

  // ── 1. Find the email ──────────────────────────────────────────────────────
  const { data: emails, error: emailErr } = await supabase
    .from('emails')
    .select('id')
    .eq('sender', TARGET_SENDER);

  if (emailErr) { console.error('Error finding emails:', emailErr.message); process.exit(1); }
  if (!emails || emails.length === 0) { console.log('⚠  No emails found for this sender.'); process.exit(0); }

  const emailIds = emails.map(e => e.id);
  console.log(`📧 Found ${emailIds.length} email(s):`, emailIds);

  // ── 2. Find tickets for these emails ─────────────────────────────────────
  const { data: tickets } = await supabase
    .from('tickets')
    .select('id')
    .in('email_id', emailIds);

  const ticketIds = (tickets || []).map(t => t.id);
  console.log(`🎫 Found ${ticketIds.length} ticket(s):`, ticketIds);

  if (ticketIds.length > 0) {
    // ── 3. Find responses for these tickets ─────────────────────────────────
    const { data: responses } = await supabase
      .from('responses')
      .select('id')
      .in('ticket_id', ticketIds);

    const responseIds = (responses || []).map(r => r.id);
    console.log(`💬 Found ${responseIds.length} response(s):`, responseIds);

    if (responseIds.length > 0) {
      // Delete response_versions
      const { error: rvErr } = await supabase
        .from('response_versions')
        .delete()
        .in('response_id', responseIds);
      console.log(rvErr ? `  ❌ response_versions: ${rvErr.message}` : '  ✓ response_versions deleted');

      // Delete approvals (legacy approvals table)
      const { error: appErr } = await supabase
        .from('approvals')
        .delete()
        .in('response_id', responseIds);
      console.log(appErr ? `  ❌ approvals: ${appErr.message}` : '  ✓ approvals deleted');

      // Delete responses
      const { error: rErr } = await supabase
        .from('responses')
        .delete()
        .in('id', responseIds);
      console.log(rErr ? `  ❌ responses: ${rErr.message}` : '  ✓ responses deleted');
    }

    // ── 4. Delete approval_requests (workflow engine) ──────────────────────
    const { error: arErr } = await supabase
      .from('approval_requests')
      .delete()
      .in('ticket_id', ticketIds);
    console.log(arErr ? `  ❌ approval_requests: ${arErr.message}` : '  ✓ approval_requests deleted');

    // ── 5. Delete actions ──────────────────────────────────────────────────
    const { error: actErr } = await supabase
      .from('actions')
      .delete()
      .in('ticket_id', ticketIds);
    console.log(actErr ? `  ❌ actions: ${actErr.message}` : '  ✓ actions deleted');

    // ── 6. Delete drafts ───────────────────────────────────────────────────
    const { error: draftErr } = await supabase
      .from('drafts')
      .delete()
      .in('ticket_id', ticketIds);
    console.log(draftErr ? `  ❌ drafts: ${draftErr.message}` : '  ✓ drafts deleted');

    // ── 7. Delete decision_logs ────────────────────────────────────────────
    const { error: dlErr } = await supabase
      .from('decision_logs')
      .delete()
      .in('ticket_id', ticketIds);
    console.log(dlErr ? `  ❌ decision_logs: ${dlErr.message}` : '  ✓ decision_logs deleted');

    // ── 8. Delete sent_emails ──────────────────────────────────────────────
    const { error: seErr } = await supabase
      .from('sent_emails')
      .delete()
      .in('ticket_id', ticketIds);
    console.log(seErr ? `  ❌ sent_emails: ${seErr.message}` : '  ✓ sent_emails deleted');

    // ── 9. Delete knowledge_base entries (if any) ──────────────────────────
    const { error: kbErr } = await supabase
      .from('knowledge_base')
      .delete()
      .in('ticket_id', ticketIds);
    console.log(kbErr ? `  ❌ knowledge_base: ${kbErr.message}` : '  ✓ knowledge_base deleted');

    // ── 10. Delete tickets ─────────────────────────────────────────────────
    const { error: tErr } = await supabase
      .from('tickets')
      .delete()
      .in('id', ticketIds);
    console.log(tErr ? `  ❌ tickets: ${tErr.message}` : '  ✓ tickets deleted');
  }

  // ── 11. Delete emails ──────────────────────────────────────────────────────
  const { error: eErr } = await supabase
    .from('emails')
    .delete()
    .in('id', emailIds);
  console.log(eErr ? `  ❌ emails: ${eErr.message}` : '  ✓ emails deleted');

  console.log('\n✅ Cleanup complete. The inbox is clean — ready for a fresh submission.\n');
}

run().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
