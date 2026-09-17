/**
 * GET /portal/case/[ticketId]
 *
 * Employee-facing case portal — shows the case resolution published in IntelliDesk.
 * This is the PRIMARY communication channel. No confidential internal data is shown.
 *
 * Accessible via the link in the Gmail notification email.
 * For MVP: accessible by any visitor with the ticketId (no login required).
 */

import { createClient } from '@supabase/supabase-js';
import { notFound }     from 'next/navigation';
import type { Metadata } from 'next';

interface Params { ticketId: string }

// ── Supabase server client (anon key — public data only) ──────────────────────
function getClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

interface CaseData {
  resolution: {
    id:              string;
    title:           string;
    resolution_text: string;
    published_by:    string;
    published_at:    string;
  };
  ticket: {
    id:              string;
    workflow_stage:  string | null;
    status:          string;
    department:      string | null;
    created_at:      string;
  };
}

async function getCaseData(ticketId: string): Promise<CaseData | null> {
  const supabase = getClient();

  const [{ data: resolution }, { data: ticket }] = await Promise.all([
    supabase
      .from('ticket_resolutions')
      .select('id, title, resolution_text, published_by, published_at')
      .eq('ticket_id', ticketId)
      .order('published_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('tickets')
      .select('id, workflow_stage, status, department, created_at')
      .eq('id', ticketId)
      .maybeSingle(),
  ]);

  if (!resolution || !ticket) return null;
  return { resolution, ticket };
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  return {
    title: 'Your Case Update — IntelliDesk',
    description: 'View the latest update on your IntelliDesk support case.',
  };
}

// ── Stage badge colour ────────────────────────────────────────────────────────
function stageBadge(stage: string | null, status: string) {
  const s = (stage || status || '').toLowerCase();
  if (s.includes('resolved') || s === 'completed') {
    return { label: '✓ Resolved', bg: '#d1fae5', color: '#065f46', border: '#6ee7b7' };
  }
  if (s.includes('customer') || s.includes('resolution')) {
    return { label: '⏳ Resolution Ready', bg: '#eff6ff', color: '#1e40af', border: '#93c5fd' };
  }
  return { label: 'In Progress', bg: '#fef3c7', color: '#92400e', border: '#fcd34d' };
}

export default async function EmployeeCasePortal({ params }: { params: Params }) {
  const { ticketId } = params;
  const data = await getCaseData(ticketId);

  if (!data) return notFound();

  const { resolution, ticket } = data;
  const badge = stageBadge(ticket.workflow_stage, ticket.status);
  const publishedAt = new Date(resolution.published_at).toLocaleString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
  const createdAt = new Date(ticket.created_at).toLocaleString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric',
  });

  return (
    <html lang="en">
      <head>
        <meta charSet="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Your Case Update — IntelliDesk</title>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
        <style dangerouslySetInnerHTML={{ __html: `
          *, *::before, *::after { box-sizing: border-box; }
          body { margin: 0; padding: 0; font-family: 'Inter', sans-serif; background: #f0fdf4; color: #111827; }
          .container { max-width: 680px; margin: 0 auto; padding: 40px 16px 80px; }
          .header { text-align: center; margin-bottom: 40px; }
          .logo { display: inline-flex; align-items: center; gap: 8px; font-size: 18px; font-weight: 700; color: #059669; margin-bottom: 8px; }
          .logo-icon { width: 32px; height: 32px; background: #059669; border-radius: 8px; display: flex; align-items: center; justify-content: center; color: white; font-size: 16px; font-weight: 800; }
          .card { background: #fff; border-radius: 20px; box-shadow: 0 4px 24px rgba(0,0,0,.07), 0 1px 4px rgba(0,0,0,.04); overflow: hidden; }
          .card-header { background: linear-gradient(135deg, #059669, #10b981); padding: 28px 32px; }
          .card-header h1 { color: #fff; margin: 0 0 8px; font-size: 22px; font-weight: 700; line-height: 1.3; }
          .card-header p { color: rgba(255,255,255,.8); margin: 0; font-size: 13px; }
          .badge { display: inline-flex; align-items: center; gap: 6px; border-radius: 999px; padding: 4px 12px; font-size: 12px; font-weight: 700; border: 1.5px solid; margin-bottom: 16px; }
          .card-body { padding: 32px; }
          .meta-row { display: flex; gap: 8px; margin-bottom: 24px; flex-wrap: wrap; }
          .meta-item { display: flex; flex-direction: column; gap: 2px; flex: 1 1 140px; background: #f9fafb; border-radius: 10px; padding: 12px 14px; border: 1px solid #e5e7eb; }
          .meta-label { font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: .05em; color: #9ca3af; }
          .meta-value { font-size: 13px; font-weight: 600; color: #111827; }
          .resolution-box { background: #f0fdf4; border: 1.5px solid #bbf7d0; border-radius: 14px; padding: 24px; margin-bottom: 24px; }
          .resolution-box h2 { font-size: 13px; font-weight: 700; color: #065f46; text-transform: uppercase; letter-spacing: .06em; margin: 0 0 16px; }
          .resolution-text { font-size: 14px; line-height: 1.8; color: #1f2937; white-space: pre-wrap; }
          .footer-note { text-align: center; color: #9ca3af; font-size: 12px; line-height: 1.6; margin-top: 32px; }
          @media (max-width: 600px) {
            .card-header { padding: 20px; }
            .card-body { padding: 20px; }
            .card-header h1 { font-size: 18px; }
          }
        ` }} />
      </head>
      <body>
        <div className="container">

          {/* Header */}
          <div className="header">
            <div className="logo">
              <div className="logo-icon">I</div>
              IntelliDesk
            </div>
            <p style={{ color: '#6b7280', fontSize: '14px', margin: '4px 0 0' }}>
              Intelligent IT &amp; HR Service Management
            </p>
          </div>

          {/* Main card */}
          <div className="card">
            <div className="card-header">
              <div
                className="badge"
                style={{ background: badge.bg, color: badge.color, borderColor: badge.border }}
              >
                {badge.label}
              </div>
              <h1>{resolution.title}</h1>
              <p>Your case has been updated. The full resolution is below.</p>
            </div>

            <div className="card-body">

              {/* Meta info */}
              <div className="meta-row">
                <div className="meta-item">
                  <span className="meta-label">Case ID</span>
                  <span className="meta-value" style={{ fontFamily: 'monospace', fontSize: '11px' }}>
                    {ticketId.slice(0, 8).toUpperCase()}
                  </span>
                </div>
                {ticket.department && (
                  <div className="meta-item">
                    <span className="meta-label">Department</span>
                    <span className="meta-value">{ticket.department}</span>
                  </div>
                )}
                <div className="meta-item">
                  <span className="meta-label">Case Opened</span>
                  <span className="meta-value">{createdAt}</span>
                </div>
                <div className="meta-item">
                  <span className="meta-label">Resolved By</span>
                  <span className="meta-value">{resolution.published_by}</span>
                </div>
                <div className="meta-item">
                  <span className="meta-label">Resolution Published</span>
                  <span className="meta-value">{publishedAt}</span>
                </div>
              </div>

              {/* Resolution */}
              <div className="resolution-box">
                <h2>📋 Resolution Details</h2>
                <div className="resolution-text">{resolution.resolution_text}</div>
              </div>

              {/* Status indicator */}
              <div style={{
                background: '#f9fafb',
                borderRadius: '12px',
                padding: '16px 20px',
                border: '1px solid #e5e7eb',
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
              }}>
                <div style={{
                  width: '36px', height: '36px', borderRadius: '50%',
                  background: '#d1fae5', display: 'flex', alignItems: 'center',
                  justifyContent: 'center', fontSize: '18px', flexShrink: 0,
                }}>✓</div>
                <div>
                  <p style={{ margin: '0 0 2px', fontWeight: 600, fontSize: '13px' }}>
                    Resolution Available
                  </p>
                  <p style={{ margin: 0, color: '#6b7280', fontSize: '12px' }}>
                    Your case has been handled by the {ticket.department || 'Support'} team.
                    If you have further questions, please submit a new support request.
                  </p>
                </div>
              </div>

            </div>
          </div>

          {/* Footer */}
          <p className="footer-note">
            This page is provided by IntelliDesk ITSM.<br />
            Case reference: {ticketId} · Do not share this link.
          </p>
        </div>
      </body>
    </html>
  );
}
