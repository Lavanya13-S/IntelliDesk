/*
  Migration 011: Decision & Escalation Agent — decision_logs table

  Creates the decision_logs table that stores every Decision & Escalation Agent
  output for audit trail, self-learning, and dashboard reporting.

  Columns:
    - decision         : AUTO_RESPONSE | HUMAN_APPROVAL_REQUIRED | ESCALATE
    - confidence       : 0-100 integer score
    - risk_level       : Low | Medium | High | Critical
    - escalation_reason: Why human escalation was triggered (null for AUTO_RESPONSE)
    - recommended_department / recommended_subteam / recommended_person
    - requires_human   : boolean gate -- if true, no AI response may be auto-sent
    - ai_summary       : Gemini-generated handover summary bullets
    - raw_gemini_response: Full raw JSON from Gemini for audit trail
*/

CREATE TABLE IF NOT EXISTS decision_logs (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id              uuid REFERENCES tickets(id) ON DELETE CASCADE,
  decision               text NOT NULL CHECK (decision IN ('AUTO_RESPONSE','HUMAN_APPROVAL_REQUIRED','ESCALATE')),
  confidence             int  NOT NULL CHECK (confidence BETWEEN 0 AND 100),
  risk_level             text NOT NULL CHECK (risk_level IN ('Low','Medium','High','Critical')),
  escalation_reason      text,
  recommended_department text,
  recommended_subteam    text,
  recommended_person     text,
  requires_human         boolean NOT NULL DEFAULT false,
  ai_summary             text,
  raw_gemini_response    text,
  created_at             timestamptz DEFAULT now()
);

-- Index for dashboard stats queries (group by decision)
CREATE INDEX IF NOT EXISTS idx_decision_logs_decision    ON decision_logs (decision);
CREATE INDEX IF NOT EXISTS idx_decision_logs_ticket      ON decision_logs (ticket_id);
CREATE INDEX IF NOT EXISTS idx_decision_logs_risk        ON decision_logs (risk_level);
CREATE INDEX IF NOT EXISTS idx_decision_logs_created_at  ON decision_logs (created_at DESC);

-- RLS
ALTER TABLE decision_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_decision_logs" ON decision_logs;
CREATE POLICY "anon_select_decision_logs"
  ON decision_logs FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_decision_logs" ON decision_logs;
CREATE POLICY "anon_insert_decision_logs"
  ON decision_logs FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_decision_logs" ON decision_logs;
CREATE POLICY "anon_update_decision_logs"
  ON decision_logs FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_decision_logs" ON decision_logs;
CREATE POLICY "anon_delete_decision_logs"
  ON decision_logs FOR DELETE TO anon, authenticated USING (true);
