-- Records table
-- Stores user-scoped records with JSONB data payload and optimistic concurrency version.
-- This migration is idempotent; the table may already exist from 00001_initial_schema.sql.

CREATE TABLE IF NOT EXISTS records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  data JSONB NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, id)
);

-- Index for fetching all records belonging to a user
CREATE INDEX IF NOT EXISTS idx_records_user_id ON records(user_id);

-- Index for delta-sync queries that filter by last-modified time
CREATE INDEX IF NOT EXISTS idx_records_updated_at ON records(updated_at);

-- Composite index for efficient per-user delta-sync queries (user_id + updated_at)
CREATE INDEX IF NOT EXISTS idx_records_user_id_updated_at ON records(user_id, updated_at);
