import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database';

interface EventRow {
  id: string;
  type: string;
  payload: Record<string, any>;
  created_at: string;
}

interface RecordOwnerRow {
  id: string;
  collection: string;
  version: number;
  updated_at: string;
}

interface ClientCursorRow {
  client_id: string;
  user_id: string;
  last_cursor: string;
  last_seen_at: string;
}

@Injectable()
export class AuditService {
  constructor(private readonly db: DatabaseService) {}

  /**
   * Returns the full immutable event log for a specific record. The record is
   * scoped to the authenticated user so one user cannot inspect another's
   * activity. Throws 404 if the record does not belong to the user (or the
   * record no longer exists).
   */
  async getRecordAudit(userId: string, recordId: string) {
    const owner = await this.db.query<RecordOwnerRow>(
      `SELECT id, collection, version, updated_at
       FROM records
       WHERE id = $1 AND user_id = $2
       LIMIT 1`,
      [recordId, userId]
    );

    if (owner.rows.length === 0) {
      throw new NotFoundException(`Record ${recordId} not found for this user`);
    }

    const events = await this.db.query<EventRow>(
      `SELECT id, type, payload, created_at
       FROM events
       WHERE record_id = $1
       ORDER BY created_at ASC, id ASC`,
      [recordId]
    );

    return {
      recordId,
      current: {
        version: owner.rows[0].version,
        collection: owner.rows[0].collection,
        updatedAt: owner.rows[0].updated_at,
      },
      events: events.rows.map(e => ({
        id: e.id,
        type: e.type,
        payload: e.payload,
        createdAt: e.created_at,
      })),
      deleted: false,
    };
  }

  /**
   * Returns the sync state for a specific client device, scoped to the user.
   * The last_cursor indicates how far the client has pulled; comparing it to
   * the user's max record cursor reveals how far behind the client is.
   */
  async getClientAudit(userId: string, clientId: string) {
    const client = await this.db.query<ClientCursorRow>(
      `SELECT client_id, user_id, last_cursor, last_seen_at
       FROM client_cursors
       WHERE client_id = $1 AND user_id = $2
       LIMIT 1`,
      [clientId, userId]
    );

    if (client.rows.length === 0) {
      throw new NotFoundException(`Client ${clientId} not found for this user`);
    }

    const maxCursor = await this.db.query<{ max: string | null }>(
      `SELECT MAX(c) AS max
       FROM (
         SELECT MAX(cursor) AS c FROM records WHERE user_id = $1
         UNION ALL
         SELECT MAX(cursor) AS c FROM tombstones WHERE user_id = $1
       ) t`,
      [userId]
    );

    const lastCursor = Number(client.rows[0].last_cursor);
    const serverMaxCursor = Number(maxCursor.rows[0]?.max ?? 0);

    return {
      clientId,
      lastCursor,
      lastSeenAt: client.rows[0].last_seen_at,
      serverMaxCursor,
      lag: Math.max(0, serverMaxCursor - lastCursor),
    };
  }
}
