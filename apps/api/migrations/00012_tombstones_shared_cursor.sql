-- Convert tombstones to share records_cursor_seq so that records and
-- tombstones occupy a single, comparable monotonic cursor space.
--
-- Previously tombstones used their own BIGSERIAL sequence (implicit
-- tombstones_cursor_seq). Because the delta pull stores ONE lastCursor =
-- max(record cursors, tombstone cursors), two independent sequences broke
-- delete propagation: a new tombstone with a low value could be permanently
-- skipped once records had advanced past it. This migration re-syncs the
-- tombstones.cursor column to the shared records_cursor_seq.
--
-- Existing tombstone rows are renumbered to fresh values from the shared
-- sequence (all greater than the current record cursors), which is safe: the
-- client treats a pull as idempotent, so re-delivering deletes is harmless.

ALTER TABLE tombstones ALTER COLUMN cursor DROP DEFAULT;

-- Renumber existing tombstones with fresh, unique values from the shared
-- sequence (continuing past all existing record cursors, so the merged order
-- stays consistent).
UPDATE tombstones SET cursor = nextval('records_cursor_seq');

ALTER TABLE tombstones
  ALTER COLUMN cursor SET DEFAULT nextval('records_cursor_seq');
