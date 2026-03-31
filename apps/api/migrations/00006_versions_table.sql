-- Versions table
-- Tracks the current version number for each record to support optimistic concurrency control.
-- Each row is keyed by record_id and updated within the same database transaction as the
-- record mutation (see Requirements 2.5).

CREATE TABLE IF NOT EXISTS versions (
  record_id UUID PRIMARY KEY REFERENCES records(id) ON DELETE CASCADE,
  version INTEGER NOT NULL
);
