-- Users table
-- Ensures the users table exists with all required columns and constraints.
-- The table may already exist from 00001_initial_schema.sql; this migration
-- is idempotent and adds the email index for login query performance.

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Index on email to speed up login queries
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email);
