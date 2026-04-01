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

interface VersionRow {
  version: number;
}

interface RecordRow {
  data: Record<string, any>;
  version: number;
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

      if (op.type === 'update' || op.type === 'delete') {
        const conflict = await this.checkVersionConflict(userId, op);
        if (conflict) {
          rejected.push(conflict);
          continue;
        }
      }

      const result = await this.applyOperation(userId, op);
      applied.push(result);
    }

    return { applied, rejected };
  }

  /**
   * Atomically applies a single operation inside a pg transaction.
   * Steps:
   *   1. For create: INSERT record + INSERT version row
   *   2. For update: UPDATE record data + UPDATE version
   *   3. For delete: DELETE record (version cascades)
   *   4. INSERT event log entry
   *   5. INSERT sync_operations row with status='applied'
   * Rolls back the entire transaction on any error.
   *
   */
  async applyOperation(
    userId: string,
    op: OperationDto,
  ): Promise<OperationResult> {
    const client: PoolClient = await this.db.getClient();
    try {
      await client.query('BEGIN');

      let newVersion: number;

      if (op.type === 'create') {
        // Insert the record; use op.recordId as the id if provided
        const insertRecord = await client.query<{ id: string; version: number }>(
          `INSERT INTO records (id, user_id, data, version, updated_at, created_at)
           VALUES ($1, $2, $3, 1, NOW(), NOW())
           ON CONFLICT (id) DO UPDATE
             SET data = EXCLUDED.data,
                 version = records.version + 1,
                 updated_at = NOW()
           RETURNING id, version`,
          [op.recordId, userId, op.payload],
        );
        newVersion = insertRecord.rows[0].version;

        // Upsert version row
        await client.query(
          `INSERT INTO versions (record_id, version)
           VALUES ($1, $2)
           ON CONFLICT (record_id) DO UPDATE SET version = EXCLUDED.version`,
          [op.recordId, newVersion],
        );
      } else if (op.type === 'update') {
        // Update record data and bump version
        const updateRecord = await client.query<{ version: number }>(
          `UPDATE records
           SET data = $1,
               version = version + 1,
               updated_at = NOW()
           WHERE id = $2 AND user_id = $3
           RETURNING version`,
          [op.payload, op.recordId, userId],
        );

        if (updateRecord.rows.length === 0) {
          throw new Error(
            `Record ${op.recordId} not found for user ${userId}`,
          );
        }
        newVersion = updateRecord.rows[0].version;

        // Update version table
        await client.query(
          `UPDATE versions SET version = $1 WHERE record_id = $2`,
          [newVersion, op.recordId],
        );
      } else {
        // delete
        const deleteRecord = await client.query<{ version: number }>(
          `DELETE FROM records
           WHERE id = $1 AND user_id = $2
           RETURNING version`,
          [op.recordId, userId],
        );

        if (deleteRecord.rows.length === 0) {
          throw new Error(
            `Record ${op.recordId} not found for user ${userId}`,
          );
        }
        newVersion = deleteRecord.rows[0].version;
        // versions row cascades on DELETE from records
      }

      // Insert event log entry (only for non-delete, since record must exist for FK)
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
           (user_id, operation_type, record_id, payload, idempotency_key, status)
         VALUES ($1, $2, $3, $4, $5, 'applied')
         ON CONFLICT (user_id, idempotency_key)
           DO UPDATE SET status = 'applied'`,
        [userId, op.type, op.recordId, op.payload, op.idempotencyKey],
      );

      await client.query('COMMIT');

      return {
        operationId: op.id,
        recordId: op.recordId,
        newVersion,
        data: op.type !== 'delete' ? op.payload : undefined,
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Returns all records for the given user updated after the `since` timestamp.
   */
  async getSyncUpdates(
    userId: string,
    since: string,
  ): Promise<SyncUpdatesResponseDto> {
    const result = await this.db.query<{
      id: string;
      data: Record<string, any>;
      version: number;
      updated_at: string;
    }>(
      `SELECT id, data, version, updated_at
       FROM records
       WHERE user_id = $1
         AND updated_at > $2::timestamptz
       ORDER BY updated_at ASC`,
      [userId, since],
    );

    // Return record IDs that were deleted after the since timestamp
    const deletedResult = await this.db.query<{ record_id: string }>(
      `SELECT record_id
       FROM sync_operations
       WHERE user_id = $1
         AND operation_type = 'delete'
         AND status = 'applied'
         AND created_at > $2::timestamptz`,
      [userId, since],
    );

    return {
      records: result.rows,
      deletedRecordIds: deletedResult.rows.map((r: { record_id: string }) => r.record_id),
    };
  }

  /**
   * Checks if the operation's version matches the server's current version.
   * For update/delete operations only. Returns a ConflictResponse if there
   * is a version mismatch, or null if versions match (or record not found).
   *
   */
  async checkVersionConflict(
    userId: string,
    op: OperationDto,
  ): Promise<ConflictResponse | null> {
    // Query the versions table for the current server version
    const versionResult = await this.db.query<VersionRow>(
      `SELECT v.version
       FROM versions v
       JOIN records r ON r.id = v.record_id
       WHERE v.record_id = $1
         AND r.user_id = $2
       LIMIT 1`,
      [op.recordId, userId],
    );

    // If no version row exists, the record doesn't exist on the server.
    // Let the operation proceed (will be handled by atomic application in 6.6).
    if (versionResult.rows.length === 0) {
      return null;
    }

    const serverVersion = versionResult.rows[0].version;

    // Versions match — no conflict
    if (op.version === serverVersion) {
      return null;
    }

    // Version mismatch — fetch server record data for conflict response
    const recordResult = await this.db.query<RecordRow>(
      `SELECT data, version
       FROM records
       WHERE id = $1
         AND user_id = $2
       LIMIT 1`,
      [op.recordId, userId],
    );

    const serverData =
      recordResult.rows.length > 0 ? recordResult.rows[0].data : {};

    // Insert rejected operation into sync_operations table
    await this.db.query(
      `INSERT INTO sync_operations
         (user_id, operation_type, record_id, payload, idempotency_key, status)
       VALUES ($1, $2, $3, $4, $5, 'rejected')
       ON CONFLICT (user_id, idempotency_key) DO NOTHING`,
      [userId, op.type, op.recordId, op.payload, op.idempotencyKey],
    );

    return {
      operationId: op.id,
      recordId: op.recordId,
      reason: 'version_conflict',
      clientVersion: op.version,
      serverVersion,
      serverData,
    };
  }

  /**
   * Checks if an operation with the given idempotency key has already been applied
   * for this user. Returns the cached OperationResult if found, or null otherwise.
   *
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
