-- Per-client sync cursor tracking.
-- Records the last known cursor for each client so the observability
-- dashboard (Phase 7) can answer "where did client X leave off?"
-- and detect stalled / far-behind clients.

CREATE TABLE IF NOT EXISTS client_cursors (
    client_id UUID NOT NULL,
    user_id UUID NOT NULL,
    last_cursor BIGINT NOT NULL DEFAULT 0,
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (client_id, user_id)
);
