-- Phase 10 — Production Hardening
--
-- 1) API key rotation support: each project may have multiple API keys, but at
--    most one *active* key at a time. Rotation issues a new active key and
--    immediately revokes the previous one, so a leaked key stops working as
--    soon as it is rotated. Existing keys are backfilled to active.
ALTER TABLE api_keys
  ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_api_keys_active ON api_keys(active);

-- 2) Refresh token storage for /auth/refresh. The raw token is never stored;
--    only a SHA-256 digest is persisted so a DB leak doesn't expose usable
--    refresh tokens. Rotation revokes the prior token within the transaction.
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash VARCHAR(64) NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  revoked_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_refresh_tokens_hash ON refresh_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id ON refresh_tokens(user_id);
