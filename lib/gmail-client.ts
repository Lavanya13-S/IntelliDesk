/**
 * lib/gmail-client.ts
 *
 * Production Gmail API client for IntelliDesk AI.
 * SERVER-SIDE ONLY — never import this in client components.
 *
 * Responsibilities:
 *  - Load OAuth tokens from Supabase (service role)
 *  - Auto-refresh expired access tokens using the stored refresh token
 *  - Detect `invalid_grant` and mark the connection as expired in the DB
 *  - Call Gmail API: users.messages.list, users.messages.get, users.messages.modify
 *  - Parse RFC 2822 email parts: headers, plain text, HTML, attachments
 */

import { createClient } from '@supabase/supabase-js';

// ── Supabase service-role client (bypasses RLS) ───────────────────────────────

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (!url || !key) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  return createClient(url, key, { auth: { persistSession: false } });
}

// ── Typed error for expired/revoked refresh tokens ────────────────────────────

/**
 * Thrown when Google rejects a refresh token with `invalid_grant`.
 * Callers should NOT retry — the user must reconnect via OAuth.
 */
export class GmailTokenExpiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GmailTokenExpiredError';
  }
}

// ── Token management ──────────────────────────────────────────────────────────

export interface GmailTokens {
  access_token: string;
  refresh_token: string;
  token_expiry: string | null;
  account_email: string;
  token_status?: string;
}

/** Load stored OAuth tokens from Supabase. Throws if not found. */
export async function loadGmailTokens(): Promise<GmailTokens> {
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from('oauth_tokens')
    .select('access_token, refresh_token, token_expiry, account_email, token_status')
    .eq('provider', 'google')
    .maybeSingle();

  if (error) throw new Error(`[Gmail] Failed to load tokens from DB: ${error.message}`);
  if (!data) throw new Error('[Gmail] No Google OAuth tokens found. Connect Gmail in Settings → Email first.');

  // ── Guard: refuse to use a token already known to be expired ─────────────
  if ((data as any).token_status === 'expired') {
    throw new GmailTokenExpiredError(
      '[Gmail] Gmail authorization has expired. Please reconnect your Gmail account in Settings → Email.'
    );
  }

  return data as GmailTokens;
}

/**
 * Mark the oauth_tokens row as expired in the DB so the UI can show
 * the "reconnect" banner. Called only on `invalid_grant` responses.
 */
async function markTokenExpired(accountEmail: string): Promise<void> {
  const supabase = getServiceClient();
  const { error } = await supabase
    .from('oauth_tokens')
    .update({
      token_status: 'expired',
      updated_at: new Date().toISOString(),
    })
    .eq('provider', 'google')
    .eq('account_email', accountEmail);

  if (error) {
    console.error('[Gmail] Failed to mark token as expired in DB:', error.message);
  } else {
    console.warn(`[Gmail] Token for ${accountEmail} marked as EXPIRED in database.`);
  }
}

/** Refresh the access token using the stored refresh token. Updates DB. */
async function refreshAccessToken(tokens: GmailTokens): Promise<string> {
  const clientId = process.env.GOOGLE_CLIENT_ID!;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET!;
  if (!clientId || !clientSecret) throw new Error('[Gmail] Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET');

  console.log(`[Gmail] Refreshing access token for ${tokens.account_email}…`);

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: tokens.refresh_token,
      grant_type: 'refresh_token',
    }),
  });

  // ── Parse the response body (even on error) ──────────────────────────────
  let body: any;
  const rawBody = await res.text();
  try { body = JSON.parse(rawBody); } catch { body = {}; }

  if (!res.ok) {
    const errorCode: string = body?.error || 'unknown';

    // ── Detect invalid_grant: refresh token has been revoked/expired ─────
    if (errorCode === 'invalid_grant') {
      console.error(
        `[Gmail] Token refresh failed with invalid_grant for ${tokens.account_email}. ` +
        `HTTP ${res.status} — ${body?.error_description || rawBody}`
      );
      // Mark in DB — do NOT retry
      await markTokenExpired(tokens.account_email);
      throw new GmailTokenExpiredError(
        'Gmail authorization has expired. Please reconnect your Gmail account in Settings → Email.'
      );
    }

    // Other token errors — log full details for debugging
    console.error(
      `[Gmail] Token refresh failed (HTTP ${res.status}) for ${tokens.account_email}:`,
      { error: errorCode, description: body?.error_description, raw: rawBody }
    );
    throw new Error(`[Gmail] Token refresh failed (HTTP ${res.status}): ${rawBody}`);
  }

  const newAccessToken: string = body.access_token;
  const expiresIn: number = body.expires_in || 3600;
  const newExpiry = new Date(Date.now() + expiresIn * 1000).toISOString();

  // ── Persist the new access token (and rotate refresh token if returned) ──
  const supabase = getServiceClient();
  const updatePayload: Record<string, any> = {
    access_token: newAccessToken,
    token_expiry: newExpiry,
    token_status: 'active',           // re-mark as active on successful refresh
    updated_at: new Date().toISOString(),
  };

  // Google sometimes rotates the refresh token — always persist the newest one
  if (body.refresh_token) {
    console.log(`[Gmail] Received new refresh token for ${tokens.account_email} — updating DB.`);
    updatePayload.refresh_token = body.refresh_token;
  }

  await supabase
    .from('oauth_tokens')
    .update(updatePayload)
    .eq('provider', 'google')
    .eq('account_email', tokens.account_email);

  console.log(`[Gmail] Access token refreshed successfully for ${tokens.account_email}.`);
  return newAccessToken;
}

/**
 * Get a valid access token — refreshes automatically if expired or within 5 minutes of expiry.
 * Throws GmailTokenExpiredError if the refresh token has been revoked — do NOT catch and retry.
 */
export async function getValidAccessToken(): Promise<string> {
  const tokens = await loadGmailTokens();

  const isExpiredOrNearExpiry =
    !tokens.token_expiry ||
    new Date(tokens.token_expiry).getTime() < Date.now() + 5 * 60 * 1000;

  if (isExpiredOrNearExpiry) {
    return refreshAccessToken(tokens);
  }

  return tokens.access_token;
}

// ── Gmail API helpers ─────────────────────────────────────────────────────────

/** Make an authenticated request to the Gmail API. */
async function gmailFetch(url: string, accessToken: string, options: RequestInit = {}): Promise<Response> {
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });

  if (res.status === 401) {
    throw new Error('[Gmail] Access token rejected by Google (401). Token may be revoked — reconnect in Settings.');
  }

  return res;
}

// ── Message listing ───────────────────────────────────────────────────────────

export interface GmailMessageRef {
  id: string;
  threadId: string;
}

/**
 * List unread messages in the Gmail inbox.
 * Returns up to maxResults message refs.
 */
export async function listUnreadMessages(
  accessToken: string,
  maxResults: number = 50
): Promise<GmailMessageRef[]> {
  const params = new URLSearchParams({
    q: 'is:unread in:inbox',
    maxResults: String(maxResults),
  });

  const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages?${params}`;
  const res = await gmailFetch(url, accessToken);

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`[Gmail] messages.list failed (HTTP ${res.status}): ${body}`);
  }

  const data = await res.json();
  return (data.messages || []) as GmailMessageRef[];
}

// ── Message parsing ───────────────────────────────────────────────────────────

export interface ParsedAttachment {
  filename: string;
  mimeType: string;
  size: number;
  attachmentId: string;
}

export interface ParsedGmailMessage {
  messageId: string;
  threadId: string;
  subject: string;
  from: string;
  to: string;
  cc: string;
  date: string;
  plainBody: string;
  htmlBody: string;
  labels: string[];
  attachments: ParsedAttachment[];
  snippet: string;
}

/** Recursively extract parts from a Gmail message payload. */
function extractParts(
  payload: any,
  result: { plain: string; html: string; attachments: ParsedAttachment[] }
): void {
  if (!payload) return;

  const mimeType: string = payload.mimeType || '';

  if (mimeType === 'text/plain' && payload.body?.data) {
    result.plain += Buffer.from(payload.body.data, 'base64url').toString('utf-8');
  } else if (mimeType === 'text/html' && payload.body?.data) {
    result.html += Buffer.from(payload.body.data, 'base64url').toString('utf-8');
  } else if (payload.filename && payload.body?.attachmentId) {
    result.attachments.push({
      filename: payload.filename,
      mimeType,
      size: payload.body.size || 0,
      attachmentId: payload.body.attachmentId,
    });
  }

  if (payload.parts && Array.isArray(payload.parts)) {
    for (const part of payload.parts) {
      extractParts(part, result);
    }
  }
}

/** Decode a base64url-encoded header value. */
function decodeHeader(value: string): string {
  try {
    // Handle RFC 2047 encoded words like =?UTF-8?B?...?=
    return value.replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_, charset, encoding, encoded) => {
      if (encoding.toUpperCase() === 'B') {
        return Buffer.from(encoded, 'base64').toString('utf-8');
      }
      return encoded.replace(/_/g, ' ');
    });
  } catch {
    return value;
  }
}

/** Extract a named header from a Gmail message headers array. */
function getHeader(headers: Array<{ name: string; value: string }>, name: string): string {
  const h = headers.find((h) => h.name.toLowerCase() === name.toLowerCase());
  return h ? decodeHeader(h.value) : '';
}

/**
 * Fetch the full message and parse all fields.
 */
export async function getFullMessage(
  messageId: string,
  accessToken: string
): Promise<ParsedGmailMessage> {
  const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`;
  const res = await gmailFetch(url, accessToken);

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`[Gmail] messages.get failed for ${messageId} (HTTP ${res.status}): ${body}`);
  }

  const msg = await res.json();
  const headers: Array<{ name: string; value: string }> = msg.payload?.headers || [];

  const parts = { plain: '', html: '', attachments: [] as ParsedAttachment[] };
  extractParts(msg.payload, parts);

  // If there's only a body at root level (non-multipart messages)
  if (!parts.plain && !parts.html && msg.payload?.body?.data) {
    const decoded = Buffer.from(msg.payload.body.data, 'base64url').toString('utf-8');
    if (msg.payload.mimeType === 'text/html') {
      parts.html = decoded;
    } else {
      parts.plain = decoded;
    }
  }

  // Fallback: use snippet if body is empty
  const bodyText = parts.plain || msg.snippet || '';

  return {
    messageId: msg.id,
    threadId: msg.threadId,
    subject: getHeader(headers, 'Subject') || '(No Subject)',
    from: getHeader(headers, 'From'),
    to: getHeader(headers, 'To'),
    cc: getHeader(headers, 'Cc'),
    date: getHeader(headers, 'Date'),
    plainBody: bodyText,
    htmlBody: parts.html,
    labels: msg.labelIds || [],
    attachments: parts.attachments,
    snippet: msg.snippet || '',
  };
}

// ── Mark as read ──────────────────────────────────────────────────────────────

/**
 * Remove the UNREAD label from a Gmail message (marks it as read).
 */
export async function markAsRead(messageId: string, accessToken: string): Promise<void> {
  const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/modify`;
  const res = await gmailFetch(url, accessToken, {
    method: 'POST',
    body: JSON.stringify({ removeLabelIds: ['UNREAD'] }),
  });

  if (!res.ok) {
    const body = await res.text();
    console.error(`[Gmail] Failed to mark ${messageId} as read (HTTP ${res.status}): ${body}`);
    // Non-fatal — don't throw, just log
  }
}

// ── Extract sender email address ──────────────────────────────────────────────

/** Parse "John Doe <john@example.com>" → "john@example.com" */
export function extractEmail(fromHeader: string): string {
  const match = fromHeader.match(/<([^>]+)>/);
  if (match) return match[1].trim();
  const plain = fromHeader.trim();
  if (plain.includes('@')) return plain;
  return fromHeader;
}

/** Parse date string from Gmail header into ISO string. */
export function parseDate(dateHeader: string): string {
  try {
    const d = new Date(dateHeader);
    if (!isNaN(d.getTime())) return d.toISOString();
  } catch {}
  return new Date().toISOString();
}

// ─── Send Email (additive — does not modify any existing function) ────────────

/**
 * Sends an email via Gmail API using the stored OAuth tokens.
 * SERVER-SIDE ONLY — never call from client components.
 *
 * @param to        Recipient email address
 * @param subject   Email subject line
 * @param htmlBody  Full HTML body content
 * @param replyTo   Optional Reply-To header
 * @returns         Gmail message ID of the sent message
 */
export async function sendGmailMessage(params: {
  to: string;
  subject: string;
  htmlBody: string;
  replyTo?: string;
}): Promise<string> {
  const { to, subject, htmlBody, replyTo } = params;

  // Load and refresh tokens (same flow as read operations)
  const accessToken = await getValidAccessToken();

  // Build RFC 2822 message
  const fromTokens = await loadGmailTokens();
  const fromAddress = fromTokens.account_email;

  const headers = [
    `From: IntelliDesk <${fromAddress}>`,
    `To: ${to}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=UTF-8',
    ...(replyTo ? [`Reply-To: ${replyTo}`] : []),
  ].join('\r\n');

  const rawMessage = `${headers}\r\n\r\n${htmlBody}`;

  // Base64url encode (Gmail API requirement)
  const encoded = Buffer.from(rawMessage, 'utf-8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  const res = await fetch(
    'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ raw: encoded }),
    }
  );

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`[Gmail] Send failed (HTTP ${res.status}): ${errBody}`);
  }

  const data = await res.json();
  return data.id as string;
}

// ─── Reply inside an existing Gmail thread ────────────────────────────────────

/**
 * Sends a reply inside the ORIGINAL Gmail conversation thread.
 * The reply appears as a continuation of the same thread — not a new email.
 * SERVER-SIDE ONLY — never call from client components.
 *
 * @param threadId    Gmail threadId from the emails table (gmail_thread_id)
 * @param to          Recipient email address
 * @param subject     Subject line (Gmail prepends "Re:" automatically)
 * @param htmlBody    Full HTML body
 * @param inReplyTo   Optional: original message-id header for proper threading
 * @returns           { messageId, threadId } of the sent reply
 */
export async function sendGmailReply(params: {
  threadId:   string;
  to:         string;
  subject:    string;
  htmlBody:   string;
  inReplyTo?: string;
}): Promise<{ messageId: string; threadId: string }> {
  const { threadId, to, subject, htmlBody, inReplyTo } = params;

  const accessToken = await getValidAccessToken();
  const fromTokens  = await loadGmailTokens();
  const fromAddress = fromTokens.account_email;

  // Normalise subject — strip leading "Re: " to avoid "Re: Re: Re:"
  const cleanSubject = subject.replace(/^(Re:\s*)+/i, '');

  const headerLines = [
    `From: IntelliDesk <${fromAddress}>`,
    `To: ${to}`,
    `Subject: Re: ${cleanSubject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=UTF-8',
    ...(inReplyTo ? [`In-Reply-To: ${inReplyTo}`, `References: ${inReplyTo}`] : []),
  ];

  const rawMessage = `${headerLines.join('\r\n')}\r\n\r\n${htmlBody}`;

  const encoded = Buffer.from(rawMessage, 'utf-8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  const res = await fetch(
    'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      // Including threadId causes Gmail to group this message into the existing thread
      body: JSON.stringify({ raw: encoded, threadId }),
    }
  );

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`[Gmail] Thread reply failed (HTTP ${res.status}): ${errBody}`);
  }

  const data = await res.json();
  return { messageId: data.id as string, threadId: data.threadId as string };
}
