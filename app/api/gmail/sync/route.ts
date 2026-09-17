/**
 * POST /api/gmail/sync
 *
 * Enterprise Gmail Ingestion Service — Module 1
 *
 * Full pipeline for every unread email:
 *   1. Load & refresh Google OAuth tokens (server-side only)
 *   2. Call Gmail API users.messages.list (is:unread in:inbox)
 *   3. For each message: call users.messages.get and parse all fields
 *   4. Deduplicate using gmail_message_id (never import the same email twice)
 *   5. Insert email row into emails table
 *   6. Create a ticket row linked to the email
 *   7. Call /api/run-pipeline to trigger the full LangGraph AI pipeline
 *   8. Optionally mark the Gmail message as read
 *   9. Update ai_settings with last_sync timestamp and import count
 *  10. Return a detailed sync report
 *
 * SERVER-SIDE ONLY. Tokens are never exposed to the frontend.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  getValidAccessToken,
  listUnreadMessages,
  getFullMessage,
  markAsRead,
  extractEmail,
  parseDate,
  type ParsedGmailMessage,
} from '@/lib/gmail-client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Allow up to 5 minutes for a full sync with many emails
export const maxDuration = 300;

// ── Module-level Supabase service-role client ─────────────────────────────────
// Using a factory function so env vars are read at call time (not module load).
// This matches the pattern used in all other routes in this project.

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  return createClient(url, key, { auth: { persistSession: false } });
}

// ── Sync report types ─────────────────────────────────────────────────────────

export interface SyncReport {
  success: boolean;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  unreadFound: number;
  imported: number;
  duplicatesSkipped: number;
  ticketsCreated: number;
  aiProcessed: number;
  errors: SyncError[];
  emails: SyncedEmailSummary[];
}

interface SyncError {
  messageId?: string;
  stage: string;
  error: string;
  httpStatus?: number;
}

interface SyncedEmailSummary {
  emailId: string;
  gmailMessageId: string;
  subject: string;
  from: string;
  ticketId: string | null;
  aiProcessed: boolean;
  markedRead: boolean;
}

// ── Helper: check for duplicate gmail_message_id ──────────────────────────────

async function isDuplicate(db: ReturnType<typeof getServiceClient>, gmailMessageId: string): Promise<boolean> {
  const { data } = await db
    .from('emails')
    .select('id')
    .eq('gmail_message_id', gmailMessageId)
    .maybeSingle();
  return !!data;
}

// ── Helper: insert email into emails table ────────────────────────────────────

async function insertEmail(db: ReturnType<typeof getServiceClient>, msg: ParsedGmailMessage): Promise<string> {
  const senderEmail = extractEmail(msg.from);
  const receivedAt = parseDate(msg.date);

  const { data, error } = await db
    .from('emails')
    .insert({
      sender: senderEmail,
      recipient: msg.to,
      cc: msg.cc || null,
      subject: msg.subject,
      body: msg.plainBody,
      html_body: msg.htmlBody || null,
      received_at: receivedAt,
      status: 'pending',
      priority: 'medium',
      sentiment: 'neutral',
      gmail_message_id: msg.messageId,
      gmail_thread_id: msg.threadId,
      gmail_labels: msg.labels,
      attachment_count: msg.attachments.length,
      attachment_names: msg.attachments.map((a) => a.filename),
      source: 'gmail',
    })
    .select('id')
    .single();

  if (error) {
    // Handle unique constraint violation gracefully (race-condition duplicate)
    if (error.code === '23505') {
      throw new Error(`DUPLICATE:${msg.messageId}`);
    }
    throw new Error(`[Gmail Sync] DB insert failed for ${msg.messageId}: ${error.message}`);
  }

  return (data as any).id as string;
}

// ── Helper: create ticket linked to email ─────────────────────────────────────

async function createTicket(db: ReturnType<typeof getServiceClient>, emailId: string): Promise<string> {
  const { data, error } = await db
    .from('tickets')
    .insert({
      email_id: emailId,
      intent: null,       // populated by AI pipeline
      department: null,   // populated by AI pipeline
      subteam: null,      // populated by AI pipeline
      priority: 'medium',
      sentiment: 'neutral',
      status: 'open',
    })
    .select('id')
    .single();

  if (error) throw new Error(`[Gmail Sync] Ticket creation failed for email ${emailId}: ${error.message}`);
  return (data as any).id as string;
}

// ── Helper: invoke existing AI pipeline ──────────────────────────────────────

async function runAIPipeline(emailId: string, subject: string, body: string): Promise<boolean> {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  try {
    const res = await fetch(`${appUrl}/api/run-pipeline`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emailId, subject, body }),
    });
    if (!res.ok) {
      const errBody = await res.text();
      console.error(`[Gmail Sync] run-pipeline HTTP ${res.status} for email ${emailId}: ${errBody}`);
      return false;
    }
    const result = await res.json();
    console.log(`[Gmail Sync] AI pipeline for email ${emailId}:`, result.pipeline, result.success);
    return result.success === true;
  } catch (err: any) {
    console.error(`[Gmail Sync] run-pipeline threw for email ${emailId}:`, err.message);
    return false;
  }
}

// ── Helper: persist sync metadata to ai_settings ─────────────────────────────

async function updateSyncMeta(
  db: ReturnType<typeof getServiceClient>,
  imported: number,
  lastError: string | null
): Promise<void> {
  try {
    const { data: existing } = await db
      .from('ai_settings')
      .select('id, gmail_emails_imported')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const row = existing as any;
    if (!row?.id) return;

    const totalImported = (row.gmail_emails_imported || 0) + imported;

    await db
      .from('ai_settings')
      .update({
        gmail_last_sync: new Date().toISOString(),
        gmail_emails_imported: totalImported,
        gmail_last_error: lastError,
        updated_at: new Date().toISOString(),
      })
      .eq('id', row.id);
  } catch (err: any) {
    console.warn('[Gmail Sync] Failed to update ai_settings sync meta:', err.message);
  }
}

// ── POST /api/gmail/sync ─────────────────────────────────────────────────────

export async function POST(_req: NextRequest) {
  const startedAt = new Date().toISOString();
  const startMs = Date.now();

  const report: SyncReport = {
    success: false,
    startedAt,
    completedAt: '',
    durationMs: 0,
    unreadFound: 0,
    imported: 0,
    duplicatesSkipped: 0,
    ticketsCreated: 0,
    aiProcessed: 0,
    errors: [],
    emails: [],
  };

  // ── 0. Validate required env vars ─────────────────────────────────────────
  const missingEnv: string[] = [];
  if (!process.env.GOOGLE_CLIENT_ID) missingEnv.push('GOOGLE_CLIENT_ID');
  if (!process.env.GOOGLE_CLIENT_SECRET) missingEnv.push('GOOGLE_CLIENT_SECRET');
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) missingEnv.push('SUPABASE_SERVICE_ROLE_KEY');
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) missingEnv.push('NEXT_PUBLIC_SUPABASE_URL');

  if (missingEnv.length > 0) {
    return NextResponse.json(
      {
        success: false,
        error: 'configuration_error',
        missingEnv,
        message: `Missing required environment variables: ${missingEnv.join(', ')}`,
      },
      { status: 500 }
    );
  }

  // Create the service-role client for this request
  const db = getServiceClient();

  // ── 1. Get valid access token (auto-refreshes if expired) ─────────────────
  let accessToken: string;
  try {
    accessToken = await getValidAccessToken();
  } catch (err: any) {
    console.error('[Gmail Sync] Token error:', err.message);
    await updateSyncMeta(db, 0, err.message);
    return NextResponse.json(
      { success: false, error: 'auth_error', message: err.message },
      { status: 401 }
    );
  }

  // ── 2. Check mark-as-read preference ──────────────────────────────────────
  let shouldMarkRead = true;
  try {
    const { data: settings } = await db
      .from('ai_settings')
      .select('gmail_mark_read')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    const s = settings as any;
    if (s && typeof s.gmail_mark_read === 'boolean') {
      shouldMarkRead = s.gmail_mark_read;
    }
  } catch { /* use default */ }

  // ── 3. List unread messages ────────────────────────────────────────────────
  let messageRefs: Array<{ id: string; threadId: string }>;
  try {
    messageRefs = await listUnreadMessages(accessToken, 50);
    report.unreadFound = messageRefs.length;
    console.log(`[Gmail Sync] Found ${messageRefs.length} unread messages`);
  } catch (err: any) {
    console.error('[Gmail Sync] messages.list failed:', err.message);
    report.errors.push({ stage: 'list_messages', error: err.message });
    await updateSyncMeta(db, 0, err.message);
    report.completedAt = new Date().toISOString();
    report.durationMs = Date.now() - startMs;
    return NextResponse.json({ ...report, success: false }, { status: 502 });
  }

  if (messageRefs.length === 0) {
    report.success = true;
    report.completedAt = new Date().toISOString();
    report.durationMs = Date.now() - startMs;
    await updateSyncMeta(db, 0, null);
    return NextResponse.json(report);
  }

  // ── 4. Process each message ────────────────────────────────────────────────
  for (const ref of messageRefs) {
    const msgId = ref.id;

    // 4a. Dedup check
    try {
      const dup = await isDuplicate(db, msgId);
      if (dup) {
        report.duplicatesSkipped++;
        console.log(`[Gmail Sync] Skipping duplicate: ${msgId}`);
        continue;
      }
    } catch (err: any) {
      report.errors.push({ messageId: msgId, stage: 'dedup_check', error: err.message });
      continue;
    }

    // 4b. Fetch full message from Gmail API
    let parsed: ParsedGmailMessage;
    try {
      parsed = await getFullMessage(msgId, accessToken);
      console.log(`[Gmail Sync] Fetched: "${parsed.subject}" from ${parsed.from}`);
    } catch (err: any) {
      console.error(`[Gmail Sync] Failed to fetch message ${msgId}:`, err.message);
      report.errors.push({ messageId: msgId, stage: 'fetch_message', error: err.message });
      continue;
    }

    // 4c. Insert into emails table
    let emailId: string;
    try {
      emailId = await insertEmail(db, parsed);
      report.imported++;
      console.log(`[Gmail Sync] Inserted email ${emailId} for message ${msgId}`);
    } catch (err: any) {
      if (err.message.startsWith('DUPLICATE:')) {
        report.duplicatesSkipped++;
        continue;
      }
      console.error(`[Gmail Sync] Email insert failed for ${msgId}:`, err.message);
      report.errors.push({ messageId: msgId, stage: 'insert_email', error: err.message });
      continue;
    }

    // 4d. Create ticket
    let ticketId: string | null = null;
    try {
      ticketId = await createTicket(db, emailId);
      report.ticketsCreated++;
      console.log(`[Gmail Sync] Created ticket ${ticketId}`);
    } catch (err: any) {
      console.error(`[Gmail Sync] Ticket creation failed for email ${emailId}:`, err.message);
      report.errors.push({ messageId: msgId, stage: 'create_ticket', error: err.message });
      // Non-fatal — email is imported, ticket failed; continue to next steps
    }

    // 4e. Run AI pipeline
    let aiProcessed = false;
    if (ticketId) {
      aiProcessed = await runAIPipeline(emailId, parsed.subject, parsed.plainBody);
      if (aiProcessed) report.aiProcessed++;
    }

    // 4f. Mark as read in Gmail
    let markedRead = false;
    if (shouldMarkRead) {
      try {
        await markAsRead(msgId, accessToken);
        markedRead = true;
      } catch (err: any) {
        report.errors.push({ messageId: msgId, stage: 'mark_read', error: err.message });
      }
    }

    report.emails.push({
      emailId,
      gmailMessageId: msgId,
      subject: parsed.subject,
      from: parsed.from,
      ticketId,
      aiProcessed,
      markedRead,
    });
  }

  // ── 5. Persist sync metadata ───────────────────────────────────────────────
  const lastError = report.errors.length > 0
    ? report.errors[report.errors.length - 1].error
    : null;
  await updateSyncMeta(db, report.imported, lastError);

  report.success = true;
  report.completedAt = new Date().toISOString();
  report.durationMs = Date.now() - startMs;

  console.log(
    `[Gmail Sync] Done. Found=${report.unreadFound} Imported=${report.imported} ` +
    `Duplicates=${report.duplicatesSkipped} Tickets=${report.ticketsCreated} ` +
    `AI=${report.aiProcessed} Errors=${report.errors.length} ${report.durationMs}ms`
  );

  return NextResponse.json(report);
}

// ── GET /api/gmail/sync — status / health check ───────────────────────────────

export async function GET() {
  try {
    const db = getServiceClient();
    const { data } = await db
      .from('ai_settings')
      .select('gmail_last_sync, gmail_emails_imported, gmail_last_error, gmail_auto_sync, gmail_mark_read')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const row = data as any;
    return NextResponse.json({
      ready: true,
      lastSync: row?.gmail_last_sync || null,
      totalImported: row?.gmail_emails_imported || 0,
      lastError: row?.gmail_last_error || null,
      autoSync: row?.gmail_auto_sync || false,
      markRead: row?.gmail_mark_read ?? true,
    });
  } catch (err: any) {
    return NextResponse.json({ ready: false, error: err.message }, { status: 500 });
  }
}
