-- Tombstones table for deterministic delete propagation.
-- Every deleted record inserts a row here with an auto-incrementing cursor.
-- The delta pull endpoint queries tombstones alongside records so that
-- clients can discover deletions using the same monotonic cursor (Phase 2).
--
-- Replaces the previous approach of scanning sync_operations for
-- operation_type='delete', which grew unboundedly.

-- The cursor is drawn from the SAME sequence as records (records_cursor_seq)
-- so that records and tombstones live in a single shared monotonic cursor
-- space. A single "lastCursor" can then correctly order and page across both
-- creates/updates and deletes (Phase 2 fixed in 00012 for existing DBs).
CREATE TABLE IF NOT EXISTS tombstones (
    cursor BIGINT PRIMARY KEY DEFAULT nextval('records_cursor_seq'),
    record_id UUID NOT NULL,
    user_id UUID NOT NULL,
    deleted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tombstones_user_cursor
    ON tombstones (user_id, cursor);
