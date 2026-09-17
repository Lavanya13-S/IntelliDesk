/*
  Migration 023: Resolution Articles — Auto-KB after Ticket Resolution

  Creates:
    - resolution_articles : auto-generated KB articles after each resolved ticket

  These articles are created automatically when a resolution email is sent.
  They feed back into the semantic search used by the Resolution Analysis panel.

  Sensitive data is NEVER stored here — the application layer sanitizes all
  content before inserting (see lib/sanitize.ts).
*/

-- ─── resolution_articles ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS resolution_articles (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Ticket linkage
  ticket_id        uuid        REFERENCES tickets(id) ON DELETE SET NULL,

  -- Article content
  title            text        NOT NULL,
  category         text        NOT NULL DEFAULT 'General',
  department       text,
  intent           text,
  problem_summary  text,
  resolution_steps text[]      NOT NULL DEFAULT '{}',
  keywords         text[]      NOT NULL DEFAULT '{}',

  -- Sanitized copy of the resolution email body (no credentials)
  resolution_email text,

  -- Provenance
  created_by       text        NOT NULL DEFAULT 'system',
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),

  -- Vector embedding for semantic search (1536-dim for text-embedding-3-small)
  embedding        vector(1536)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_ra_ticket_id   ON resolution_articles (ticket_id);
CREATE INDEX IF NOT EXISTS idx_ra_intent      ON resolution_articles (intent);
CREATE INDEX IF NOT EXISTS idx_ra_department  ON resolution_articles (department);
CREATE INDEX IF NOT EXISTS idx_ra_category    ON resolution_articles (category);
CREATE INDEX IF NOT EXISTS idx_ra_created_at  ON resolution_articles (created_at DESC);

-- HNSW vector index for fast similarity search
CREATE INDEX IF NOT EXISTS idx_ra_embedding ON resolution_articles
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_resolution_articles_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ra_updated_at ON resolution_articles;
CREATE TRIGGER trg_ra_updated_at
  BEFORE UPDATE ON resolution_articles
  FOR EACH ROW EXECUTE FUNCTION update_resolution_articles_updated_at();

-- RLS (open for service role inserts, public reads)
ALTER TABLE resolution_articles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ra_select" ON resolution_articles;
CREATE POLICY "ra_select"
  ON resolution_articles FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "ra_insert" ON resolution_articles;
CREATE POLICY "ra_insert"
  ON resolution_articles FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "ra_update" ON resolution_articles;
CREATE POLICY "ra_update"
  ON resolution_articles FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

-- ─── Semantic search function for resolution articles ─────────────────────────

CREATE OR REPLACE FUNCTION match_resolution_articles(
  query_embedding  vector(1536),
  match_threshold  float    DEFAULT 0.70,
  match_count      int      DEFAULT 5
)
RETURNS TABLE (
  id               uuid,
  title            text,
  category         text,
  department       text,
  intent           text,
  problem_summary  text,
  resolution_steps text[],
  keywords         text[],
  created_at       timestamptz,
  similarity       float
)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT
    ra.id,
    ra.title,
    ra.category,
    ra.department,
    ra.intent,
    ra.problem_summary,
    ra.resolution_steps,
    ra.keywords,
    ra.created_at,
    1 - (ra.embedding <=> query_embedding) AS similarity
  FROM resolution_articles ra
  WHERE ra.embedding IS NOT NULL
    AND 1 - (ra.embedding <=> query_embedding) >= match_threshold
  ORDER BY ra.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- Add to realtime
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE resolution_articles;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END;
$$;

-- Verification
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'resolution_articles'
ORDER BY ordinal_position;
