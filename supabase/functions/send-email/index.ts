import "jsr:@supabase/functions-js/edge-runtime.d.ts";
// @ts-ignore - Deno URL import, not resolvable by Node TS tooling
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Deno global declaration for Node-based TypeScript tooling
declare const Deno: {
  serve(handler: (req: Request) => Response | Promise<Response>): void;
  env: { get(key: string): string | undefined };
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

// ─── EmailService Interface ───────────────────────────────────────────────────
//
// Architecture:
//   EmailService (interface)
//     ├── SimulatedEmailService  ← current implementation (writes to sent_emails table)
//     └── GmailEmailService      ← plug in later without changing the AI workflow
//
// To add Gmail:
//   1. Implement GmailEmailService below
//   2. Set EMAIL_PROVIDER=gmail in Supabase Edge Function secrets
//   3. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GMAIL_REFRESH_TOKEN secrets
//   4. No changes needed to any agent, classify-all, or process-document

interface EmailOptions {
  to: string;
  subject: string;
  body: string;
  ticketId: string;
}

interface EmailSendResult {
  success: boolean;
  messageId?: string;
  provider: string;
  error?: string;
}

interface EmailService {
  send(options: EmailOptions): Promise<EmailSendResult>;
}

// ─── SimulatedEmailService ────────────────────────────────────────────────────

class SimulatedEmailService implements EmailService {
  constructor(private supabase: ReturnType<typeof createClient>) {}

  async send(options: EmailOptions): Promise<EmailSendResult> {
    const sentAt = new Date().toISOString();
    const messageId = `sim_${crypto.randomUUID()}`;

    const { error: insertError } = await this.supabase
      .from("sent_emails")
      .insert({
        ticket_id: options.ticketId,
        to_email: options.to,
        subject: options.subject,
        body: options.body,
        sent_at: sentAt,
        status: "sent",
      });

    if (insertError) {
      throw new Error(`Failed to record sent email: ${insertError.message}`);
    }

    return { success: true, messageId, provider: "simulated" };
  }
}

// ─── GmailEmailService (placeholder — implement when Gmail OAuth is configured) ─
//
// class GmailEmailService implements EmailService {
//   async send(options: EmailOptions): Promise<EmailSendResult> {
//     const clientId = Deno.env.get("GOOGLE_CLIENT_ID");
//     const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET");
//     const refreshToken = Deno.env.get("GMAIL_REFRESH_TOKEN");
//     const fromEmail = Deno.env.get("GMAIL_FROM_ADDRESS");
//
//     // Step 1: Exchange refresh token for access token
//     // Step 2: Call Gmail API users.messages.send
//     // Step 3: Return message ID from Gmail API response
//   }
// }

// ─── Factory ──────────────────────────────────────────────────────────────────

function createEmailService(supabase: ReturnType<typeof createClient>): EmailService {
  const provider = Deno.env.get("EMAIL_PROVIDER") || "simulated";

  switch (provider) {
    case "gmail":
      // When Gmail is ready: return new GmailEmailService();
      console.warn("EMAIL_PROVIDER=gmail but GmailEmailService is not yet implemented. Using simulated.");
      return new SimulatedEmailService(supabase);
    default:
      return new SimulatedEmailService(supabase);
  }
}

// ─── Handler ──────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const { ticket_id, response_text, to_email, subject } = await req.json();

    if (!ticket_id || !response_text) {
      return new Response(
        JSON.stringify({ error: "Missing ticket_id or response_text" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

    if (!supabaseUrl || !serviceRoleKey) {
      return new Response(
        JSON.stringify({ error: "SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // ── Step 1: Resolve ticket to get email_id and sender ─────────────────────
    const { data: ticket, error: ticketLookupError } = await supabase
      .from("tickets")
      .select("email_id")
      .eq("id", ticket_id)
      .single();

    if (ticketLookupError || !ticket) {
      return new Response(
        JSON.stringify({ error: ticketLookupError?.message || "Ticket not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Resolve recipient email from the original email record
    let recipientEmail = to_email || "employee@company.com";
    if (ticket.email_id) {
      const { data: emailRecord } = await supabase
        .from("emails")
        .select("sender")
        .eq("id", ticket.email_id)
        .single();
      if (emailRecord?.sender) {
        recipientEmail = emailRecord.sender;
      }
    }

    // ── Step 2: Send via EmailService ─────────────────────────────────────────
    const emailService = createEmailService(supabase);

    const sendResult = await emailService.send({
      to: recipientEmail,
      subject: subject || "Re: Your Support Request",
      body: response_text,
      ticketId: ticket_id,
    });

    // ── Step 3: Update ticket status to resolved ──────────────────────────────
    const { error: ticketUpdateError } = await supabase
      .from("tickets")
      .update({
        status: "resolved",
        resolved_at: new Date().toISOString(),
      })
      .eq("id", ticket_id);

    if (ticketUpdateError) {
      console.error("Failed to update ticket status:", ticketUpdateError.message);
    }

    // ── Step 4: Update email status to resolved ───────────────────────────────
    if (ticket.email_id) {
      const { error: emailUpdateError } = await supabase
        .from("emails")
        .update({ status: "resolved" })
        .eq("id", ticket.email_id);

      if (emailUpdateError) {
        console.error("Failed to update email status:", emailUpdateError.message);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        provider: sendResult.provider,
        message_id: sendResult.messageId,
        recipient: recipientEmail,
        message: `Email delivered via ${sendResult.provider} service. Ticket resolved.`,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("send-email error:", err);
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
