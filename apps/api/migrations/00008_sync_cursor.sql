-- Monotonic sync cursor for deterministic delta pulls.
-- Replaces timestamp-based ordering (updated_at > $since) with a BIGINT
-- sequence that guarantees clients see every change in order.
--
-- Phase 1: cursor on records table only. Deletes are still tracked via
-- sync_operations (will be replaced by tombstones in Phase 2).

CREATE SEQUENCE IF NOT EXISTS records_cursor_seq;

ALTER TABLE records
  ADD COLUMN IF NOT EXISTS cursor BIGINT;

-- Backfill existing rows: assign a cursor value from the sequence in
-- updated_at order so older records get lower cursor values.
UPDATE records
   SET cursor = nextval('records_cursor_seq')
 WHERE cursor IS NULL;

-- Future inserts: default to the next sequence value.
ALTER TABLE records
  ALTER COLUMN cursor SET DEFAULT nextval('records_cursor_seq'),
  ALTER COLUMN cursor SET NOT NULL;

-- Index for efficient range scans: WHERE cursor > $1 ORDER BY cursor
CREATE INDEX IF NOT EXISTS idx_records_cursor ON records (user_id, cursor);
