/*
# Knowledge Base Schema Enhancement

1. New Tables
- `kb_policies` - Structured policy documents with department/category tags
  - `id` (uuid, primary key)
  - `title` (text, not null)
  - `department` (text) - Which department owns this policy
  - `category` (text) - e.g. "Leave", "IT", "Security", "Benefits"
  - `content` (text) - Full policy text
  - `keywords` (text[]) - Searchable keywords for matching
  - `created_at` (timestamptz)

- `kb_faqs` - Frequently asked questions with answers
  - `id` (uuid, primary key)
  - `question` (text, not null)
  - `answer` (text, not null)
  - `department` (text)
  - `category` (text)
  - `keywords` (text[])
  - `created_at` (timestamptz)

- `response_templates` - Pre-written response templates by intent/department
  - `id` (uuid, primary key)
  - `name` (text, not null)
  - `intent` (text) - Which email intent this template matches
  - `department` (text)
  - `subteam` (text)
  - `template` (text) - Response template with {{placeholders}}
  - `active` (boolean)
  - `created_at` (timestamptz)

2. Security
- Enable RLS on all new tables.
- Allow anon + authenticated full access for single-tenant demo.
*/

CREATE TABLE IF NOT EXISTS kb_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  department text,
  category text,
  content text,
  keywords text[],
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS kb_faqs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question text NOT NULL,
  answer text NOT NULL,
  department text,
  category text,
  keywords text[],
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS response_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  intent text,
  department text,
  subteam text,
  template text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE kb_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE kb_faqs ENABLE ROW LEVEL SECURITY;
ALTER TABLE response_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_kb_policies" ON kb_policies;
CREATE POLICY "anon_select_kb_policies" ON kb_policies FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_kb_policies" ON kb_policies;
CREATE POLICY "anon_insert_kb_policies" ON kb_policies FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_kb_policies" ON kb_policies;
CREATE POLICY "anon_update_kb_policies" ON kb_policies FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_kb_policies" ON kb_policies;
CREATE POLICY "anon_delete_kb_policies" ON kb_policies FOR DELETE TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_select_kb_faqs" ON kb_faqs;
CREATE POLICY "anon_select_kb_faqs" ON kb_faqs FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_kb_faqs" ON kb_faqs;
CREATE POLICY "anon_insert_kb_faqs" ON kb_faqs FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_kb_faqs" ON kb_faqs;
CREATE POLICY "anon_update_kb_faqs" ON kb_faqs FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_kb_faqs" ON kb_faqs;
CREATE POLICY "anon_delete_kb_faqs" ON kb_faqs FOR DELETE TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_select_response_templates" ON response_templates;
CREATE POLICY "anon_select_response_templates" ON response_templates FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_response_templates" ON response_templates;
CREATE POLICY "anon_insert_response_templates" ON response_templates FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_response_templates" ON response_templates;
CREATE POLICY "anon_update_response_templates" ON response_templates FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_response_templates" ON response_templates;
CREATE POLICY "anon_delete_response_templates" ON response_templates FOR DELETE TO anon, authenticated USING (true);
