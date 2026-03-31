-- Sync operations table
-- Tracks every incoming sync operation with idempotency support and status tracking.
-- The unique constraint on (user_id, idempotency_key) ensures duplicate submissions
-- are safely detected and ignored without re-applying mutations.

CREATE TABLE IF NOT EXISTS sync_operations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  operation_type VARCHAR(20) NOT NULL CHECK (operation_type IN ('create', 'update', 'delete')),
  record_id UUID NOT NULL,
  payload JSONB NOT NULL,
  idempotency_key VARCHAR(255) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'applied', 'rejected')),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, idempotency_key)
);

-- Index for querying all operations belonging to a user
CREATE INDEX IF NOT EXISTS idx_sync_ops_user_id ON sync_operations(user_id);

-- Index for filtering operations by processing status
CREATE INDEX IF NOT EXISTS idx_sync_ops_status ON sync_operations(status);

-- Composite index to accelerate idempotency key lookups per user
CREATE UNIQUE INDEX IF NOT EXISTS idx_sync_ops_user_idempotency ON sync_operations(user_id, idempotency_key);
