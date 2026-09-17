import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

async function createNotification(params: {
  type: string;
  title: string;
  message: string;
  ticket_id?: string | null;
  email_id?: string | null;
}) {
  await supabase.from('notifications').insert({
    type:      params.type,
    title:     params.title,
    message:   params.message,
    ticket_id: params.ticket_id ?? null,
    email_id:  params.email_id  ?? null,
    read:      false,
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // ── DEBUG: log full incoming payload ──────────────────────────────────────
    console.log('[send-email] SEND EMAIL REQUEST', JSON.stringify(body, null, 2));

    const {
      ticket_id,
      response_text,
      to_email,
      subject,
    } = body as {
      ticket_id:     string | null | undefined;
      response_text: string | null | undefined;
      to_email:      string | null | undefined;
      subject:       string | null | undefined;
    };

    // ── Validation ─────────────────────────────────────────────────────────────

    if (!ticket_id?.trim()) {
      console.log('[send-email] Missing ticket_id — received:', ticket_id);
      return NextResponse.json(
        {
          success:          false,
          failed_validation: 'ticket_id',
          received:          body,
          error:             'Missing ticket_id — the ticket record must be loaded before sending.',
        },
        { status: 400 }
      );
    }

    if (!response_text?.trim()) {
      console.log('[send-email] Missing response_text — received length:', response_text?.length ?? 0);
      return NextResponse.json(
        {
          success:          false,
          failed_validation: 'response_text',
          received:          body,
          error:             'Missing response_text — the email body is empty.',
        },
        { status: 400 }
      );
    }

    // ── 1. Fetch ticket record ─────────────────────────────────────────────────

    const { data: ticket, error: ticketError } = await supabase
      .from('tickets')
      .select('id, email_id, intent, department, status')
      .eq('id', ticket_id)
      .single();

    if (ticketError || !ticket) {
      console.log('[send-email] Ticket not found — ticket_id:', ticket_id, '| error:', ticketError?.message);
      return NextResponse.json(
        {
          success:          false,
          failed_validation: 'ticket_id_lookup',
          received:          body,
          error:             ticketError?.message || `Ticket ${ticket_id} not found.`,
        },
        { status: 404 }
      );
    }

    // ── 2. Resolve recipient email ─────────────────────────────────────────────
    // Priority: caller-supplied to_email → email record sender → fallback

    let recipientEmail = to_email?.trim() || '';
    let emailSubject   = subject?.trim()  || 'Your Support Request';

    if (!recipientEmail && ticket.email_id) {
      const { data: emailRecord } = await supabase
        .from('emails')
        .select('sender, subject')
        .eq('id', ticket.email_id)
        .single();
      if (emailRecord?.sender)  recipientEmail = emailRecord.sender;
      if (emailRecord?.subject) emailSubject   = subject?.trim() || `Re: ${emailRecord.subject}`;
    }

    if (!recipientEmail) {
      console.log('[send-email] Missing recipientEmail — to_email:', to_email, '| ticket.email_id:', ticket.email_id);
      return NextResponse.json(
        {
          success:          false,
          failed_validation: 'recipientEmail',
          received:          body,
          error:             'No recipient email address found for this ticket.',
        },
        { status: 400 }
      );
    }

    console.log('[send-email] Validation passed — ticket_id:', ticket_id, '| recipient:', recipientEmail, '| subject:', emailSubject, '| body length:', response_text.length);

    // ── 3. Record the sent email ───────────────────────────────────────────────

    const sentAt    = new Date().toISOString();
    const messageId = `sim_${Date.now()}_${Math.random().toString(36).slice(2)}`;

    const { error: insertError } = await supabase
      .from('sent_emails')
      .insert({
        ticket_id,
        to_email:  recipientEmail,
        subject:   emailSubject,
        body:      response_text,
        sent_at:   sentAt,
        status:    'sent',
      });

    if (insertError) {
      console.error('[send-email] sent_emails insert error:', insertError);
      return NextResponse.json(
        { error: `Failed to record sent email: ${insertError.message}` },
        { status: 500 }
      );
    }

    // ── 4. Mark ticket as resolved ─────────────────────────────────────────────

    await supabase
      .from('tickets')
      .update({ status: 'resolved', resolved_at: sentAt })
      .eq('id', ticket_id);

    // ── 5. Mark email as resolved ──────────────────────────────────────────────

    if (ticket.email_id) {
      await supabase
        .from('emails')
        .update({ status: 'resolved' })
        .eq('id', ticket.email_id);
    }

    // ── 6. Write a work log entry ─────────────────────────────────────────────
    // Look up the dept_work_item linked to this ticket_id (may not exist for
    // tickets that bypassed the department workflow, so errors are non-fatal).

    try {
      const { data: workItem } = await supabase
        .from('dept_work_items')
        .select('id, employee_name')
        .eq('ticket_id', ticket_id)
        .maybeSingle();

      if (workItem?.id) {
        const employeeLabel = workItem.employee_name || recipientEmail;
        await supabase
          .from('dept_work_logs')
          .insert({
            work_item_id: workItem.id,
            actor:        'engineer',
            action:       'completed',
            note:         `Resolution email sent to ${employeeLabel} (${recipientEmail}). Ticket resolved.`,
          });

        // Also mark the dept_work_item as completed
        await supabase
          .from('dept_work_items')
          .update({ status: 'completed', updated_at: sentAt })
          .eq('id', workItem.id);
      }
    } catch (logErr: any) {
      // Non-fatal — work log failure should not block the success response
      console.warn('[send-email] work log write failed (non-fatal):', logErr.message);
    }

    // ── 7. Fire notification ───────────────────────────────────────────────────

    await createNotification({
      type:      'email_sent',
      title:     'Resolution Email Sent',
      message:   `Reply sent to ${recipientEmail} for "${emailSubject}". Ticket resolved.`,
      ticket_id,
      email_id:  ticket.email_id ?? null,
    });

    // ── 8. Fire-and-forget KB article creation ─────────────────────────────────
    // Non-blocking — the response returns immediately; KB creation runs async.
    // Sanitization of the email body happens inside /api/knowledge/create-article.
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    fetch(`${appUrl}/api/knowledge/create-article`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ticket_id,
        intent:                ticket.intent     || null,
        department:            ticket.department || null,
        email_subject:         emailSubject,
        resolution_email_body: response_text,
      }),
    }).catch((kbErr) => {
      console.warn('[send-email] KB article creation failed (non-fatal):', kbErr.message);
    });

    // ── 9. Return success ──────────────────────────────────────────────────────

    return NextResponse.json({
      success:    true,
      provider:   'simulated',
      message_id: messageId,
      recipient:  recipientEmail,
      sent_at:    sentAt,
      message:    'Resolution email recorded. Ticket marked as resolved.',
    });

  } catch (err: any) {
    console.error('[send-email] Unexpected error:', err);
    return NextResponse.json(
      { error: err.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
