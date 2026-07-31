-- Collection namespace support (Phase 5).
-- Adds a collection field to records and sync_operations so the SDK
-- can namespace records without requiring separate tables.

ALTER TABLE records
  ADD COLUMN IF NOT EXISTS collection VARCHAR(255) NOT NULL DEFAULT 'default';

ALTER TABLE sync_operations
  ADD COLUMN IF NOT EXISTS collection VARCHAR(255) NOT NULL DEFAULT 'default';

-- Index for efficient filtered delta pulls by collection
CREATE INDEX IF NOT EXISTS idx_records_user_collection_cursor
  ON records (user_id, collection, cursor);
