/*
# HelpMind AI - Initial Schema

1. New Tables
- `emails` - Stores incoming employee emails
  - `id` (uuid, primary key)
  - `sender` (text, not null)
  - `subject` (text, not null)
  - `body` (text, not null)
  - `received_at` (timestamptz, default now)
  - `status` (text, default 'pending')
  - `priority` (text, default 'medium')
  - `sentiment` (text, default 'neutral')
  - `intent` (text)
  - `department` (text)
  - `subteam` (text)

- `tickets` - Stores processed tickets from emails
  - `id` (uuid, primary key)
  - `email_id` (uuid, references emails)
  - `intent` (text)
  - `department` (text)
  - `subteam` (text)
  - `priority` (text, default 'medium')
  - `sentiment` (text, default 'neutral')
  - `status` (text, default 'open')
  - `created_at` (timestamptz, default now)

- `responses` - Stores AI-generated and approved responses
  - `id` (uuid, primary key)
  - `ticket_id` (uuid, references tickets)
  - `response` (text)
  - `approved` (boolean, default false)
  - `sent_at` (timestamptz)

- `documents` - Stores uploaded knowledge base documents
  - `id` (uuid, primary key)
  - `title` (text, not null)
  - `file_url` (text)
  - `document_type` (text)
  - `content` (text)
  - `created_at` (timestamptz, default now)

- `similar_cases` - Links tickets to similar resolved tickets
  - `id` (uuid, primary key)
  - `ticket_id` (uuid, references tickets)
  - `similar_ticket_id` (uuid, references tickets)
  - `similarity_score` (numeric)

- `actions` - Stores recommended actions for tickets
  - `id` (uuid, primary key)
  - `ticket_id` (uuid, references tickets)
  - `recommended_action` (text)
  - `created_at` (timestamptz, default now)

2. Security
- Enable RLS on all tables.
- Allow anon + authenticated full access for demo/single-tenant.
*/

CREATE TABLE IF NOT EXISTS emails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sender text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  received_at timestamptz DEFAULT now(),
  status text NOT NULL DEFAULT 'pending',
  priority text NOT NULL DEFAULT 'medium',
  sentiment text NOT NULL DEFAULT 'neutral',
  intent text,
  department text,
  subteam text
);

CREATE TABLE IF NOT EXISTS tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email_id uuid REFERENCES emails(id) ON DELETE CASCADE,
  intent text,
  department text,
  subteam text,
  priority text NOT NULL DEFAULT 'medium',
  sentiment text NOT NULL DEFAULT 'neutral',
  status text NOT NULL DEFAULT 'open',
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid REFERENCES tickets(id) ON DELETE CASCADE,
  response text,
  approved boolean NOT NULL DEFAULT false,
  sent_at timestamptz
);

CREATE TABLE IF NOT EXISTS documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  file_url text,
  document_type text,
  content text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS similar_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid REFERENCES tickets(id) ON DELETE CASCADE,
  similar_ticket_id uuid REFERENCES tickets(id) ON DELETE CASCADE,
  similarity_score numeric
);

CREATE TABLE IF NOT EXISTS actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid REFERENCES tickets(id) ON DELETE CASCADE,
  recommended_action text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE emails ENABLE ROW LEVEL SECURITY;
ALTER TABLE tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE similar_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE actions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_emails" ON emails;
CREATE POLICY "anon_select_emails" ON emails FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_emails" ON emails;
CREATE POLICY "anon_insert_emails" ON emails FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_emails" ON emails;
CREATE POLICY "anon_update_emails" ON emails FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_emails" ON emails;
CREATE POLICY "anon_delete_emails" ON emails FOR DELETE TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_select_tickets" ON tickets;
CREATE POLICY "anon_select_tickets" ON tickets FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_tickets" ON tickets;
CREATE POLICY "anon_insert_tickets" ON tickets FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_tickets" ON tickets;
CREATE POLICY "anon_update_tickets" ON tickets FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_tickets" ON tickets;
CREATE POLICY "anon_delete_tickets" ON tickets FOR DELETE TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_select_responses" ON responses;
CREATE POLICY "anon_select_responses" ON responses FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_responses" ON responses;
CREATE POLICY "anon_insert_responses" ON responses FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_responses" ON responses;
CREATE POLICY "anon_update_responses" ON responses FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_responses" ON responses;
CREATE POLICY "anon_delete_responses" ON responses FOR DELETE TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_select_documents" ON documents;
CREATE POLICY "anon_select_documents" ON documents FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_documents" ON documents;
CREATE POLICY "anon_insert_documents" ON documents FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_documents" ON documents;
CREATE POLICY "anon_update_documents" ON documents FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_documents" ON documents;
CREATE POLICY "anon_delete_documents" ON documents FOR DELETE TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_select_similar_cases" ON similar_cases;
CREATE POLICY "anon_select_similar_cases" ON similar_cases FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_similar_cases" ON similar_cases;
CREATE POLICY "anon_insert_similar_cases" ON similar_cases FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_similar_cases" ON similar_cases;
CREATE POLICY "anon_update_similar_cases" ON similar_cases FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_similar_cases" ON similar_cases;
CREATE POLICY "anon_delete_similar_cases" ON similar_cases FOR DELETE TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_select_actions" ON actions;
CREATE POLICY "anon_select_actions" ON actions FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_actions" ON actions;
CREATE POLICY "anon_insert_actions" ON actions FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_actions" ON actions;
CREATE POLICY "anon_update_actions" ON actions FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_actions" ON actions;
CREATE POLICY "anon_delete_actions" ON actions FOR DELETE TO anon, authenticated USING (true);
