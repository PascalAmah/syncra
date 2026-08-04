/**
 * Unit tests for the AuditService (Phase 7 — Observability backend).
 */
import { describe, it, expect, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { AuditService } from './audit.service';

function makeDb(overrides: { rows: unknown[][] }) {
  const query = vi.fn();
  for (const rows of overrides.rows) {
    query.mockResolvedValueOnce({ rows });
  }
  return { query };
}

describe('AuditService.getRecordAudit', () => {
  it('returns the event log for a record owned by the user, scoped by user', async () => {
    const db = makeDb({
      rows: [
        // owner query
        [{ id: 'rec-1', collection: 'default', version: 3, updated_at: '2026-01-01T00:00:00Z' }],
        // events query
        [
          {
            id: 'evt-1',
            type: 'create',
            payload: { title: 'a' },
            created_at: '2026-01-01T00:00:01Z',
          },
          {
            id: 'evt-2',
            type: 'update',
            payload: { title: 'b' },
            created_at: '2026-01-01T00:00:02Z',
          },
        ],
      ],
    });

    const audit = new AuditService(db as any);
    const result = await audit.getRecordAudit('user-1', 'rec-1');

    expect(result.recordId).toBe('rec-1');
    expect(result.current.version).toBe(3);
    expect(result.current.collection).toBe('default');
    expect(result.deleted).toBe(false);
    expect(result.events).toHaveLength(2);
    expect(result.events[0].type).toBe('create');
    expect(result.events[1].type).toBe('update');

    // Owner query scoped to user + record; events scoped to record.
    expect(db.query.mock.calls[0][1]).toEqual(['rec-1', 'user-1']);
    expect(db.query.mock.calls[1][1]).toEqual(['rec-1']);
  });

  it('throws NotFoundException when the record does not belong to the user', async () => {
    const db = makeDb({ rows: [[]] });
    const audit = new AuditService(db as any);

    await expect(audit.getRecordAudit('user-1', 'rec-other')).rejects.toBeInstanceOf(
      NotFoundException
    );
  });
});

describe('AuditService.getClientAudit', () => {
  it('reports a client sync state with lag relative to the server cursor', async () => {
    const db = makeDb({
      rows: [
        // client cursor query
        [
          {
            client_id: 'client-1',
            user_id: 'user-1',
            last_cursor: '42',
            last_seen_at: '2026-01-01T00:00:00Z',
          },
        ],
        // max cursor query
        [{ max: '50' }],
      ],
    });

    const audit = new AuditService(db as any);
    const result = await audit.getClientAudit('user-1', 'client-1');

    expect(result.clientId).toBe('client-1');
    expect(result.lastCursor).toBe(42);
    expect(result.serverMaxCursor).toBe(50);
    expect(result.lag).toBe(8);

    // Both queries scoped to the user.
    expect(db.query.mock.calls[0][1]).toEqual(['client-1', 'user-1']);
    expect(db.query.mock.calls[1][1]).toEqual(['user-1']);
  });

  it('throws NotFoundException when the client is unknown to the user', async () => {
    const db = makeDb({ rows: [[]] });
    const audit = new AuditService(db as any);

    await expect(audit.getClientAudit('user-1', 'client-unknown')).rejects.toBeInstanceOf(
      NotFoundException
    );
  });
});
