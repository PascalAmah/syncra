-- Events table
-- Immutable audit log of all successfully applied sync operations.
-- Each row corresponds to a single applied operation and is inserted within
-- the same database transaction as the record mutation (see Requirements 2.4).

CREATE TABLE IF NOT EXISTS events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  record_id UUID NOT NULL REFERENCES records(id) ON DELETE CASCADE,
  type VARCHAR(50) NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Index for fetching all events belonging to a specific record
CREATE INDEX IF NOT EXISTS idx_events_record_id ON events(record_id);

-- Index for time-range queries and chronological ordering of events
CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at);
