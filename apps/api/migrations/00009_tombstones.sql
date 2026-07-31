-- Tombstones table for deterministic delete propagation.
-- Every deleted record inserts a row here with an auto-incrementing cursor.
-- The delta pull endpoint queries tombstones alongside records so that
-- clients can discover deletions using the same monotonic cursor (Phase 2).
--
-- Replaces the previous approach of scanning sync_operations for
-- operation_type='delete', which grew unboundedly.

CREATE TABLE IF NOT EXISTS tombstones (
    cursor BIGSERIAL PRIMARY KEY,
    record_id UUID NOT NULL,
    user_id UUID NOT NULL,
    deleted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tombstones_user_cursor
    ON tombstones (user_id, cursor);
