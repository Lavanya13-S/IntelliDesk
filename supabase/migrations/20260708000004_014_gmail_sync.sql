-- Migration: 014 - Gmail Sync Support
-- Adds Gmail-specific columns to the emails table and sync config to ai_settings.
-- Run this in Supabase SQL Editor before using /api/gmail/sync.

-- ── emails table: Gmail ingestion columns ────────────────────────────────────

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='emails' AND column_name='gmail_message_id') THEN
    ALTER TABLE emails ADD COLUMN gmail_message_id text;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='emails' AND column_name='gmail_thread_id') THEN
    ALTER TABLE emails ADD COLUMN gmail_thread_id text;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='emails' AND column_name='recipient') THEN
    ALTER TABLE emails ADD COLUMN recipient text;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='emails' AND column_name='cc') THEN
    ALTER TABLE emails ADD COLUMN cc text;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='emails' AND column_name='html_body') THEN
    ALTER TABLE emails ADD COLUMN html_body text;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='emails' AND column_name='gmail_labels') THEN
    ALTER TABLE emails ADD COLUMN gmail_labels text[];
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='emails' AND column_name='attachment_count') THEN
    ALTER TABLE emails ADD COLUMN attachment_count int NOT NULL DEFAULT 0;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='emails' AND column_name='attachment_names') THEN
    ALTER TABLE emails ADD COLUMN attachment_names text[];
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='emails' AND column_name='source') THEN
    -- 'gmail' = imported via Gmail API, 'manual' = entered via UI compose
    ALTER TABLE emails ADD COLUMN source text NOT NULL DEFAULT 'manual';
  END IF;
END $$;

-- Unique constraint to prevent duplicate Gmail message imports
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'emails_gmail_message_id_unique'
  ) THEN
    ALTER TABLE emails
      ADD CONSTRAINT emails_gmail_message_id_unique
      UNIQUE (gmail_message_id);
  END IF;
END $$;

-- Index for dedup lookups
CREATE INDEX IF NOT EXISTS idx_emails_gmail_message_id ON emails(gmail_message_id);
CREATE INDEX IF NOT EXISTS idx_emails_source ON emails(source);

-- ── ai_settings: Gmail sync configuration ────────────────────────────────────

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ai_settings' AND column_name='gmail_auto_sync') THEN
    ALTER TABLE ai_settings ADD COLUMN gmail_auto_sync boolean NOT NULL DEFAULT false;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ai_settings' AND column_name='gmail_sync_interval_seconds') THEN
    ALTER TABLE ai_settings ADD COLUMN gmail_sync_interval_seconds int NOT NULL DEFAULT 30;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ai_settings' AND column_name='gmail_last_sync') THEN
    ALTER TABLE ai_settings ADD COLUMN gmail_last_sync timestamptz;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ai_settings' AND column_name='gmail_emails_imported') THEN
    ALTER TABLE ai_settings ADD COLUMN gmail_emails_imported int NOT NULL DEFAULT 0;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ai_settings' AND column_name='gmail_mark_read') THEN
    -- When true: mark synced emails as read in Gmail. When false: leave unread.
    ALTER TABLE ai_settings ADD COLUMN gmail_mark_read boolean NOT NULL DEFAULT true;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='ai_settings' AND column_name='gmail_last_error') THEN
    ALTER TABLE ai_settings ADD COLUMN gmail_last_error text;
  END IF;
END $$;
