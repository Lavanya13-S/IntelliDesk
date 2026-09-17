-- Sent emails table for tracking email delivery
CREATE TABLE IF NOT EXISTS sent_emails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid REFERENCES tickets(id) ON DELETE CASCADE,
  to_email text NOT NULL DEFAULT 'employee@company.com',
  subject text NOT NULL DEFAULT 'Re: Your Support Request',
  body text NOT NULL,
  sent_at timestamptz DEFAULT now(),
  status text NOT NULL DEFAULT 'sent',
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sent_emails_ticket_id ON sent_emails(ticket_id);

-- Enable RLS
ALTER TABLE sent_emails ENABLE ROW LEVEL SECURITY;

-- RLS Policies
DROP POLICY IF EXISTS "anon_select_sent_emails" ON sent_emails;
CREATE POLICY "anon_select_sent_emails" ON sent_emails FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_sent_emails" ON sent_emails;
CREATE POLICY "anon_insert_sent_emails" ON sent_emails FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_sent_emails" ON sent_emails;
CREATE POLICY "anon_update_sent_emails" ON sent_emails FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_sent_emails" ON sent_emails;
CREATE POLICY "anon_delete_sent_emails" ON sent_emails FOR DELETE TO anon, authenticated USING (true);
