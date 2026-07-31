import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DatabaseService } from '../database';
import { OperationResult, ConflictResponse } from '@syncra/core';
import { OperationDto, SyncUpdatesResponseDto } from './dto/sync.dto';

export interface ProcessSyncResult {
  applied: OperationResult[];
  rejected: ConflictResponse[];
}

interface SyncOperationRow {
  id: string;
  record_id: string;
  payload: Record<string, any>;
  status: string;
}

/**
 * Thrown inside applyOperation's transaction when a version mismatch is
 * detected under SELECT ... FOR UPDATE (Phase 2 TOCTOU fix).
 */
export class VersionConflictError extends Error {
  constructor(public readonly conflict: ConflictResponse) {
    super('version_conflict');
    this.name = 'VersionConflictError';
  }
}

@Injectable()
export class SyncService {
  constructor(private readonly db: DatabaseService) {}

  async processOperations(
    userId: string,
    operations: OperationDto[],
  ): Promise<ProcessSyncResult> {
    const applied: OperationResult[] = [];
    const rejected: ConflictResponse[] = [];

    for (const op of operations) {
      const cached = await this.checkIdempotency(userId, op.idempotencyKey);
      if (cached) {
        applied.push(cached);
        continue;
      }

      try {
        const result = await this.applyOperation(userId, op);
        applied.push(result);
      } catch (err) {
        if (err instanceof VersionConflictError) {
          rejected.push(err.conflict);
        } else {
          throw err;
        }
      }
    }

    return { applied, rejected };
  }

  /**
   * Atomically applies an operation inside a single pg transaction.
   *
   * For update and delete operations, the version check is performed
   * inside the same transaction using SELECT ... FOR UPDATE on the
   * versions table, eliminating the TOCTOU race between check and
   * mutation (Phase 2).
   *
   * On delete, a tombstone row is inserted so that the delta pull
   * endpoint can propagate deletions using the monotonic cursor
   * (Phase 2).
   */
  async applyOperation(
    userId: string,
    op: OperationDto,
  ): Promise<OperationResult> {
    const client: PoolClient = await this.db.getClient();
    try {
      await client.query('BEGIN');

      let newVersion: number;

      // ---- Version check for update / delete (inside transaction) ----
      if (op.type === 'update' || op.type === 'delete') {
        const versionRow = await client.query<{ version: number }>(
          `SELECT v.version
           FROM versions v
           INNER JOIN records r ON r.id = v.record_id
           WHERE v.record_id = $1 AND r.user_id = $2
           FOR UPDATE OF v`,
          [op.recordId, userId],
        );

        if (versionRow.rows.length > 0) {
          const serverVersion = versionRow.rows[0].version;
          if (op.version !== serverVersion) {
            // Fetch server data for conflict response
            const recordRow = await client.query<{ data: Record<string, any>; version: number }>(
              `SELECT data, version FROM records WHERE id = $1 AND user_id = $2 LIMIT 1`,
              [op.recordId, userId],
            );
            const serverData = recordRow.rows.length > 0 ? recordRow.rows[0].data : {};

            // Record rejection in sync_operations
            await client.query(
              `INSERT INTO sync_operations
                 (user_id, operation_type, record_id, payload, idempotency_key, status, collection)
               VALUES ($1, $2, $3, $4, $5, 'rejected', $6)
               ON CONFLICT (user_id, idempotency_key) DO NOTHING`,
              [userId, op.type, op.recordId, op.payload, op.idempotencyKey, op.collection ?? 'default'],
            );

            // Rollback the transaction — version conflict, no mutation applied
            await client.query('ROLLBACK');
            throw new VersionConflictError({
              operationId: op.id,
              recordId: op.recordId,
              reason: 'version_conflict',
              clientVersion: op.version,
              serverVersion,
              serverData,
            });
          }
        }
        // If no version row exists, the record doesn't exist on the server
        // (or was already deleted). Proceed — applyOperation handles the
        // missing-record case (insert-as-create for updates, no-op for deletes).
      }

      // ---- Mutation ----
      if (op.type === 'create') {
        const insertRecord = await client.query<{ id: string; version: number; cursor: number }>(
          `INSERT INTO records (id, user_id, data, version, updated_at, created_at, collection)
           VALUES ($1, $2, $3, 1, NOW(), NOW(), $4)
           ON CONFLICT (id) DO UPDATE
             SET data = EXCLUDED.data,
                 version = records.version + 1,
                 updated_at = NOW(),
                 cursor = nextval('records_cursor_seq'),
                 collection = EXCLUDED.collection
           RETURNING id, version, cursor`,
          [op.recordId, userId, op.payload, op.collection ?? 'default'],
        );
        newVersion = insertRecord.rows[0].version;

        await client.query(
          `INSERT INTO versions (record_id, version)
           VALUES ($1, $2)
           ON CONFLICT (record_id) DO UPDATE SET version = EXCLUDED.version`,
          [op.recordId, newVersion],
        );
      } else if (op.type === 'update') {
        const updateRecord = await client.query<{ version: number; cursor: number }>(
          `UPDATE records
           SET data = $1,
               version = version + 1,
               updated_at = NOW(),
               cursor = nextval('records_cursor_seq')
           WHERE id = $2 AND user_id = $3
           RETURNING version, cursor`,
          [op.payload, op.recordId, userId],
        );

        if (updateRecord.rows.length === 0) {
          const insertRecord = await client.query<{ version: number; cursor: number }>(
            `INSERT INTO records (id, user_id, data, version, updated_at, created_at, collection)
             VALUES ($1, $2, $3, 1, NOW(), NOW(), $4)
             RETURNING version, cursor`,
            [op.recordId, userId, op.payload, op.collection ?? 'default'],
          );
          newVersion = insertRecord.rows[0].version;
          await client.query(
            `INSERT INTO versions (record_id, version)
             VALUES ($1, $2)
             ON CONFLICT (record_id) DO UPDATE SET version = EXCLUDED.version`,
            [op.recordId, newVersion],
          );
        } else {
          newVersion = updateRecord.rows[0].version;
          await client.query(
            `UPDATE versions SET version = $1 WHERE record_id = $2`,
            [newVersion, op.recordId],
          );
        }
      } else {
        // delete — insert a tombstone for cursor-based propagation
        const deleteRecord = await client.query<{ version: number }>(
          `DELETE FROM records
           WHERE id = $1 AND user_id = $2
           RETURNING version`,
          [op.recordId, userId],
        );

        newVersion = deleteRecord.rows.length > 0 ? deleteRecord.rows[0].version : 0;

        // Insert tombstone so other clients discover this deletion via cursor
        await client.query(
          `INSERT INTO tombstones (record_id, user_id) VALUES ($1, $2)`,
          [op.recordId, userId],
        );
      }

      // Insert event log entry (only for non-delete)
      if (op.type !== 'delete') {
        await client.query(
          `INSERT INTO events (record_id, type, payload, created_at)
           VALUES ($1, $2, $3, NOW())`,
          [op.recordId, op.type, op.payload],
        );
      }

      // Insert sync_operations row with status='applied'
      await client.query(
        `INSERT INTO sync_operations
           (user_id, operation_type, record_id, payload, idempotency_key, status, collection)
         VALUES ($1, $2, $3, $4, $5, 'applied', $6)
         ON CONFLICT (user_id, idempotency_key)
           DO UPDATE SET status = 'applied'`,
        [userId, op.type, op.recordId, op.payload, op.idempotencyKey, op.collection ?? 'default'],
      );

      await client.query('COMMIT');

      return {
        operationId: op.id,
        recordId: op.recordId,
        newVersion,
        data: op.type !== 'delete' ? op.payload : undefined,
      };
    } catch (err) {
      // VersionConflictError already rolled back — just release and rethrow
      if (err instanceof VersionConflictError) {
        client.release();
        throw err;
      }
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      // Only release if not already released by VersionConflictError path
      try { client.release(); } catch { /* already released */ }
    }
  }

  /**
   * Returns records and tombstones for the given user with cursor > $cursor,
   * ordered by cursor ascending. Both records and tombstones share the same
   * monotonic cursor space so the client can track a single cursor across
   * creates, updates, and deletes (Phase 2).
   */
  async getSyncUpdates(
    userId: string,
    cursor: number,
    limit: number,
    clientId?: string,
    collection?: string,
  ): Promise<SyncUpdatesResponseDto> {
    const collectionFilter = collection ? 'AND collection = $4' : '';
    const queryParams = collection
      ? [userId, cursor, limit, collection]
      : [userId, cursor, limit];

    const result = await this.db.query<{
      id: string;
      data: Record<string, any>;
      version: number;
      updated_at: string;
      created_at: string;
      cursor: number;
      collection: string;
    }>(
      `SELECT id, data, version, updated_at, created_at, cursor, collection
       FROM records
       WHERE user_id = $1
         AND cursor > $2
         ${collectionFilter}
       ORDER BY cursor ASC
       LIMIT $3`,
      queryParams,
    );

    // Query tombstones using cursor — each delete inserts a tombstone row
    // with an auto-incrementing cursor.
    const tombstoneResult = await this.db.query<{ record_id: string; cursor: number }>(
      `SELECT record_id, cursor
       FROM tombstones
       WHERE user_id = $1
         AND cursor > $2
       ORDER BY cursor ASC
       LIMIT $3`,
      [userId, cursor, limit],
    );

    // Track client cursor state for future sync optimization
    if (clientId) {
      const recordCursors = result.rows.map((r) => r.cursor);
      const tombstoneCursors = tombstoneResult.rows.map((r) => r.cursor);
      const allCursors = [...recordCursors, ...tombstoneCursors];
      const lastCursor = allCursors.length > 0 ? Math.max(...allCursors) : cursor;

      await this.db.query(
        `INSERT INTO client_cursors (client_id, user_id, last_cursor, last_seen_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (client_id, user_id)
           DO UPDATE SET last_cursor = $3, last_seen_at = NOW()`,
        [clientId, userId, lastCursor],
      );
    }

    return {
      records: result.rows,
      deletedRecordIds: tombstoneResult.rows.map((r) => r.record_id),
      tombstones: tombstoneResult.rows.map((r) => ({ recordId: r.record_id, cursor: r.cursor })),
    };
  }

  /**
   * Checks if an operation with the given idempotency key has already been
   * applied for this user.
   */
  async checkIdempotency(
    userId: string,
    idempotencyKey: string,
  ): Promise<OperationResult | null> {
    const result = await this.db.query<SyncOperationRow>(
      `SELECT id, record_id, payload, status
       FROM sync_operations
       WHERE user_id = $1
         AND idempotency_key = $2
         AND status = 'applied'
       LIMIT 1`,
      [userId, idempotencyKey],
    );

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    return {
      operationId: row.id,
      recordId: row.record_id,
      data: row.payload,
    };
  }
}
