/*
  Migration 010: Add metadata column to document_chunks

  The extract-attachment API inserts { source_type, filename } metadata
  for each chunk, but the column was never created in the initial schema
  (migration 004). This caused every chunk insert to silently fail,
  resulting in '0 chunks' shown for all uploaded documents.
*/

ALTER TABLE document_chunks
  ADD COLUMN IF NOT EXISTS metadata jsonb;
