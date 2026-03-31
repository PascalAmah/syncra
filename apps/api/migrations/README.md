# Database Migrations

This directory contains SQL migration files for the Syncra database schema.

## Migration System

The migration system uses a custom runner that:
- Tracks applied migrations in a `migrations` table
- Runs migrations in alphabetical order
- Wraps each migration in a transaction for atomicity
- Prevents duplicate execution via unique constraint

## Running Migrations

### Automatic (on API startup)
Migrations run automatically when the API starts via the `MigrationService`.

### Manual Execution
```bash
# From the root directory
cd apps/api
npm run migrate
```

### Environment Variables
Set these before running migrations:
- `DB_HOST` (default: localhost)
- `DB_PORT` (default: 5432)
- `DB_USER` (default: syncra)
- `DB_PASS` (default: syncra123)
- `DB_NAME` (default: syncra)

## Creating New Migrations

1. Create a new `.sql` file with a sequential number prefix:
   ```
   00002_add_new_feature.sql
   ```

2. Write idempotent SQL using `IF NOT EXISTS` clauses:
   ```sql
   CREATE TABLE IF NOT EXISTS my_table (
     id UUID PRIMARY KEY
   );
   ```

3. The migration will run automatically on next API startup or manual execution.

## Migration Files

- `00001_initial_schema.sql` - Creates all core tables (users, records, sync_operations, events, versions)

## Schema Overview

### Tables
- **users** - User accounts with email/password authentication
- **records** - User data records with version tracking
- **sync_operations** - Queue of sync operations with idempotency keys
- **events** - Audit log of all mutations
- **versions** - Denormalized version tracking for conflict detection
- **migrations** - Tracks which migrations have been applied
