import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SyncService } from './sync.service';
import { OperationDto } from './dto/sync.dto';

// Mock PoolClient returned by db.getClient()
const mockClientQuery = vi.fn();
const mockClientRelease = vi.fn();
const mockClient = {
  query: mockClientQuery,
  release: mockClientRelease,
};

// Mock DatabaseService
const mockQuery = vi.fn();
const db = {
  query: mockQuery,
  getClient: vi.fn().mockResolvedValue(mockClient),
} as any;

describe('SyncService', () => {
  let service: SyncService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new SyncService(db);
    // Reset client mock
    mockClientQuery.mockReset();
    mockClientRelease.mockReset();
    db.getClient.mockResolvedValue(mockClient);
  });

  describe('checkIdempotency', () => {
    it('returns null when no matching applied operation exists', async () => {
      mockQuery.mockResolvedValue({ rows: [] });

      const result = await service.checkIdempotency('user-1', 'key-abc');

      expect(result).toBeNull();
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('sync_operations'),
        ['user-1', 'key-abc'],
      );
    });

    it('returns cached OperationResult when applied operation exists', async () => {
      const row = {
        id: 'op-uuid-1',
        record_id: 'rec-uuid-1',
        payload: { title: 'Cached Task' },
        status: 'applied',
      };
      mockQuery.mockResolvedValue({ rows: [row] });

      const result = await service.checkIdempotency('user-1', 'key-abc');

      expect(result).toEqual({
        operationId: 'op-uuid-1',
        recordId: 'rec-uuid-1',
        data: { title: 'Cached Task' },
      });
    });

    it('queries with status=applied filter', async () => {
      mockQuery.mockResolvedValue({ rows: [] });

      await service.checkIdempotency('user-2', 'key-xyz');

      const [sql, params] = mockQuery.mock.calls[0];
      expect(sql).toContain("status = 'applied'");
      expect(params).toEqual(['user-2', 'key-xyz']);
    });
  });

  describe('processOperations - idempotency', () => {
    it('returns cached result for already-applied operation without re-processing', async () => {
      const cachedRow = {
        id: 'op-1',
        record_id: 'rec-1',
        payload: { title: 'Already Applied' },
        status: 'applied',
      };
      mockQuery.mockResolvedValue({ rows: [cachedRow] });

      const ops = [
        {
          id: 'op-1',
          type: 'create' as const,
          recordId: 'rec-1',
          payload: { title: 'New Data' },
          version: 1,
          idempotencyKey: 'key-duplicate',
        },
      ];

      const result = await service.processOperations('user-1', ops);

      expect(result.applied).toHaveLength(1);
      // Should return cached data, not the new payload
      expect(result.applied[0].operationId).toBe('op-1');
      expect(result.applied[0].recordId).toBe('rec-1');
      expect(result.applied[0].data).toEqual({ title: 'Already Applied' });
      expect(result.rejected).toHaveLength(0);
    });

    it('proceeds with normal processing when idempotency key is new', async () => {
      mockQuery.mockResolvedValue({ rows: [] });
      // applyOperation (create) client queries
      mockClientQuery
        .mockResolvedValueOnce(undefined) // BEGIN
        .mockResolvedValueOnce({ rows: [{ id: 'rec-new', version: 1 }] }) // INSERT records
        .mockResolvedValueOnce({ rows: [] }) // INSERT versions
        .mockResolvedValueOnce({ rows: [] }) // INSERT events
        .mockResolvedValueOnce({ rows: [] }) // INSERT sync_operations
        .mockResolvedValueOnce(undefined); // COMMIT

      const ops = [
        {
          id: 'op-new',
          type: 'create' as const,
          recordId: 'rec-new',
          payload: { title: 'New Task' },
          version: 1,
          idempotencyKey: 'key-new',
        },
      ];

      const result = await service.processOperations('user-1', ops);

      expect(result.applied).toHaveLength(1);
      expect(result.applied[0].operationId).toBe('op-new');
      expect(result.applied[0].data).toEqual({ title: 'New Task' });
    });

    it('handles mixed batch: some duplicate, some new', async () => {
      // First call (op-dup): returns cached row
      // Second call (op-new): returns empty (no cached result)
      mockQuery
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'op-dup',
              record_id: 'rec-dup',
              payload: { cached: true },
              status: 'applied',
            },
          ],
        })
        .mockResolvedValueOnce({ rows: [] });

      // applyOperation (create) client queries for op-new
      mockClientQuery
        .mockResolvedValueOnce(undefined) // BEGIN
        .mockResolvedValueOnce({ rows: [{ id: 'rec-new', version: 1 }] }) // INSERT records
        .mockResolvedValueOnce({ rows: [] }) // INSERT versions
        .mockResolvedValueOnce({ rows: [] }) // INSERT events
        .mockResolvedValueOnce({ rows: [] }) // INSERT sync_operations
        .mockResolvedValueOnce(undefined); // COMMIT

      const ops = [
        {
          id: 'op-dup',
          type: 'update' as const,
          recordId: 'rec-dup',
          payload: { cached: false },
          version: 2,
          idempotencyKey: 'key-dup',
        },
        {
          id: 'op-new',
          type: 'create' as const,
          recordId: 'rec-new',
          payload: { fresh: true },
          version: 1,
          idempotencyKey: 'key-new',
        },
      ];

      const result = await service.processOperations('user-1', ops);

      expect(result.applied).toHaveLength(2);
      // Duplicate returns cached data
      expect(result.applied[0].data).toEqual({ cached: true });
      // New operation returns its own payload
      expect(result.applied[1].data).toEqual({ fresh: true });
    });

    it('checks idempotency before any mutation (query is first DB call per operation)', async () => {
      mockQuery.mockResolvedValue({ rows: [] });
      // applyOperation uses client queries — set up successful create responses
      mockClientQuery
        .mockResolvedValueOnce(undefined) // BEGIN
        .mockResolvedValueOnce({ rows: [{ id: 'rec-1', version: 1 }] }) // INSERT records
        .mockResolvedValueOnce({ rows: [] }) // INSERT versions
        .mockResolvedValueOnce({ rows: [] }) // INSERT events
        .mockResolvedValueOnce({ rows: [] }) // INSERT sync_operations
        .mockResolvedValueOnce(undefined); // COMMIT

      const ops = [
        {
          id: 'op-1',
          type: 'create' as const,
          recordId: 'rec-1',
          payload: { x: 1 },
          version: 1,
          idempotencyKey: 'key-1',
        },
      ];

      await service.processOperations('user-1', ops);

      // The idempotency check (via db.query) must be the first DB call
      expect(mockQuery).toHaveBeenCalledTimes(1);
      const [sql] = mockQuery.mock.calls[0];
      expect(sql).toContain('sync_operations');
      expect(sql).toContain("status = 'applied'");
    });
  });

  describe('checkVersionConflict', () => {
    const makeOp = (overrides: Partial<OperationDto> = {}): OperationDto => ({
      id: 'op-1',
      type: 'update',
      recordId: 'rec-1',
      payload: { title: 'Updated' },
      version: 2,
      idempotencyKey: 'key-1',
      ...overrides,
    });

    it('returns null when no version row exists for the record', async () => {
      mockQuery.mockResolvedValue({ rows: [] });

      const result = await service.checkVersionConflict('user-1', makeOp());

      expect(result).toBeNull();
    });

    it('returns null when operation version matches server version', async () => {
      mockQuery.mockResolvedValue({ rows: [{ version: 2 }] });

      const result = await service.checkVersionConflict('user-1', makeOp({ version: 2 }));

      expect(result).toBeNull();
    });

    it('returns ConflictResponse when versions mismatch', async () => {
      const serverData = { title: 'Server Title', completed: true };
      // First call: versions table → server version 3
      // Second call: records table → server data
      // Third call: insert rejected sync_operation
      mockQuery
        .mockResolvedValueOnce({ rows: [{ version: 3 }] })
        .mockResolvedValueOnce({ rows: [{ data: serverData, version: 3 }] })
        .mockResolvedValueOnce({ rows: [] });

      const op = makeOp({ version: 2 });
      const result = await service.checkVersionConflict('user-1', op);

      expect(result).toEqual({
        operationId: 'op-1',
        recordId: 'rec-1',
        reason: 'version_conflict',
        clientVersion: 2,
        serverVersion: 3,
        serverData,
      });
    });

    it('includes empty serverData when record row is missing', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ version: 5 }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      const result = await service.checkVersionConflict('user-1', makeOp({ version: 1 }));

      expect(result).not.toBeNull();
      expect(result!.serverData).toEqual({});
    });

    it('inserts rejected sync_operation row on conflict', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ version: 3 }] })
        .mockResolvedValueOnce({ rows: [{ data: {}, version: 3 }] })
        .mockResolvedValueOnce({ rows: [] });

      await service.checkVersionConflict('user-1', makeOp({ version: 2 }));

      const insertCall = mockQuery.mock.calls[2];
      expect(insertCall[0]).toContain('sync_operations');
      expect(insertCall[0]).toContain("'rejected'");
      expect(insertCall[1]).toContain('user-1');
    });

    it('queries versions table with record_id and user_id', async () => {
      mockQuery.mockResolvedValue({ rows: [] });

      await service.checkVersionConflict('user-42', makeOp({ recordId: 'rec-99' }));

      const [sql, params] = mockQuery.mock.calls[0];
      expect(sql).toContain('versions');
      expect(params).toContain('rec-99');
      expect(params).toContain('user-42');
    });
  });

  describe('processOperations - version conflict detection', () => {
    it('rejects update operation with version mismatch', async () => {
      const serverData = { title: 'Server' };
      // idempotency check → no cached result
      mockQuery
        .mockResolvedValueOnce({ rows: [] })
        // versions table → server version 3
        .mockResolvedValueOnce({ rows: [{ version: 3 }] })
        // records table → server data
        .mockResolvedValueOnce({ rows: [{ data: serverData, version: 3 }] })
        // insert rejected op
        .mockResolvedValueOnce({ rows: [] });

      const ops = [
        {
          id: 'op-1',
          type: 'update' as const,
          recordId: 'rec-1',
          payload: { title: 'Client' },
          version: 2,
          idempotencyKey: 'key-1',
        },
      ];

      const result = await service.processOperations('user-1', ops);

      expect(result.applied).toHaveLength(0);
      expect(result.rejected).toHaveLength(1);
      expect(result.rejected[0]).toMatchObject({
        operationId: 'op-1',
        recordId: 'rec-1',
        reason: 'version_conflict',
        clientVersion: 2,
        serverVersion: 3,
        serverData,
      });
    });

    it('rejects delete operation with version mismatch', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ version: 5 }] })
        .mockResolvedValueOnce({ rows: [{ data: { x: 1 }, version: 5 }] })
        .mockResolvedValueOnce({ rows: [] });

      const ops = [
        {
          id: 'op-del',
          type: 'delete' as const,
          recordId: 'rec-del',
          payload: {},
          version: 4,
          idempotencyKey: 'key-del',
        },
      ];

      const result = await service.processOperations('user-1', ops);

      expect(result.rejected).toHaveLength(1);
      expect(result.rejected[0].reason).toBe('version_conflict');
    });

    it('skips version check for create operations', async () => {
      // Only one db.query call expected: idempotency check
      // applyOperation uses getClient() separately
      mockQuery.mockResolvedValue({ rows: [] });
      mockClientQuery
        .mockResolvedValueOnce(undefined) // BEGIN
        .mockResolvedValueOnce({ rows: [{ id: 'rec-new', version: 1 }] }) // INSERT records
        .mockResolvedValueOnce({ rows: [] }) // INSERT versions
        .mockResolvedValueOnce({ rows: [] }) // INSERT events
        .mockResolvedValueOnce({ rows: [] }) // INSERT sync_operations
        .mockResolvedValueOnce(undefined); // COMMIT

      const ops = [
        {
          id: 'op-create',
          type: 'create' as const,
          recordId: 'rec-new',
          payload: { title: 'New' },
          version: 1,
          idempotencyKey: 'key-create',
        },
      ];

      const result = await service.processOperations('user-1', ops);

      expect(result.applied).toHaveLength(1);
      expect(result.rejected).toHaveLength(0);
      // Only the idempotency check query should have been made via db.query
      expect(mockQuery).toHaveBeenCalledTimes(1);
    });

    it('applies update operation when versions match', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [] })          // idempotency check
        .mockResolvedValueOnce({ rows: [{ version: 3 }] }); // versions match

      // applyOperation (update) client queries
      mockClientQuery
        .mockResolvedValueOnce(undefined) // BEGIN
        .mockResolvedValueOnce({ rows: [{ version: 4 }] }) // UPDATE records
        .mockResolvedValueOnce({ rows: [] }) // UPDATE versions
        .mockResolvedValueOnce({ rows: [] }) // INSERT events
        .mockResolvedValueOnce({ rows: [] }) // INSERT sync_operations
        .mockResolvedValueOnce(undefined); // COMMIT

      const ops = [
        {
          id: 'op-ok',
          type: 'update' as const,
          recordId: 'rec-ok',
          payload: { title: 'OK' },
          version: 3,
          idempotencyKey: 'key-ok',
        },
      ];

      const result = await service.processOperations('user-1', ops);

      expect(result.applied).toHaveLength(1);
      expect(result.rejected).toHaveLength(0);
    });

    it('idempotency check takes precedence over version conflict', async () => {
      // If idempotency key is already applied, skip version check entirely
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'op-cached', record_id: 'rec-1', payload: { cached: true }, status: 'applied' }],
      });

      const ops = [
        {
          id: 'op-cached',
          type: 'update' as const,
          recordId: 'rec-1',
          payload: { title: 'New' },
          version: 99, // would conflict
          idempotencyKey: 'key-cached',
        },
      ];

      const result = await service.processOperations('user-1', ops);

      expect(result.applied).toHaveLength(1);
      expect(result.rejected).toHaveLength(0);
      // Only the idempotency check should have been called
      expect(mockQuery).toHaveBeenCalledTimes(1);
    });
  });

  describe('applyOperation', () => {
    const makeOp = (overrides: Partial<OperationDto> = {}): OperationDto => ({
      id: 'op-1',
      type: 'create',
      recordId: 'rec-1',
      payload: { title: 'Test' },
      version: 1,
      idempotencyKey: 'key-1',
      ...overrides,
    });

    it('wraps create in a transaction: BEGIN, INSERT record, INSERT version, INSERT event, INSERT sync_op, COMMIT', async () => {
      mockClientQuery
        .mockResolvedValueOnce(undefined) // BEGIN
        .mockResolvedValueOnce({ rows: [{ id: 'rec-1', version: 1 }] }) // INSERT records
        .mockResolvedValueOnce({ rows: [] }) // INSERT versions
        .mockResolvedValueOnce({ rows: [] }) // INSERT events
        .mockResolvedValueOnce({ rows: [] }) // INSERT sync_operations
        .mockResolvedValueOnce(undefined); // COMMIT

      const result = await service.applyOperation('user-1', makeOp());

      expect(mockClientQuery).toHaveBeenCalledTimes(6);
      expect(mockClientQuery.mock.calls[0][0]).toBe('BEGIN');
      expect(mockClientQuery.mock.calls[5][0]).toBe('COMMIT');
      expect(result.operationId).toBe('op-1');
      expect(result.recordId).toBe('rec-1');
      expect(result.newVersion).toBe(1);
      expect(result.data).toEqual({ title: 'Test' });
      expect(mockClientRelease).toHaveBeenCalledTimes(1);
    });

    it('wraps update in a transaction: BEGIN, UPDATE record, UPDATE version, INSERT event, INSERT sync_op, COMMIT', async () => {
      mockClientQuery
        .mockResolvedValueOnce(undefined) // BEGIN
        .mockResolvedValueOnce({ rows: [{ version: 4 }] }) // UPDATE records
        .mockResolvedValueOnce({ rows: [] }) // UPDATE versions
        .mockResolvedValueOnce({ rows: [] }) // INSERT events
        .mockResolvedValueOnce({ rows: [] }) // INSERT sync_operations
        .mockResolvedValueOnce(undefined); // COMMIT

      const result = await service.applyOperation(
        'user-1',
        makeOp({ type: 'update', version: 3 }),
      );

      expect(mockClientQuery).toHaveBeenCalledTimes(6);
      expect(mockClientQuery.mock.calls[0][0]).toBe('BEGIN');
      expect(mockClientQuery.mock.calls[5][0]).toBe('COMMIT');
      expect(result.newVersion).toBe(4);
      expect(result.data).toEqual({ title: 'Test' });
    });

    it('wraps delete in a transaction: BEGIN, DELETE record, INSERT sync_op, COMMIT (no event insert)', async () => {
      mockClientQuery
        .mockResolvedValueOnce(undefined) // BEGIN
        .mockResolvedValueOnce({ rows: [{ version: 2 }] }) // DELETE records
        .mockResolvedValueOnce({ rows: [] }) // INSERT sync_operations
        .mockResolvedValueOnce(undefined); // COMMIT

      const result = await service.applyOperation(
        'user-1',
        makeOp({ type: 'delete' }),
      );

      expect(mockClientQuery).toHaveBeenCalledTimes(4);
      expect(mockClientQuery.mock.calls[0][0]).toBe('BEGIN');
      expect(mockClientQuery.mock.calls[3][0]).toBe('COMMIT');
      expect(result.newVersion).toBe(2);
      expect(result.data).toBeUndefined();
    });

    it('rolls back and releases client on error', async () => {
      mockClientQuery
        .mockResolvedValueOnce(undefined) // BEGIN
        .mockRejectedValueOnce(new Error('DB error')); // INSERT records fails

      await expect(
        service.applyOperation('user-1', makeOp()),
      ).rejects.toThrow('DB error');

      const calls = mockClientQuery.mock.calls.map((c) => c[0]);
      expect(calls).toContain('BEGIN');
      expect(calls).toContain('ROLLBACK');
      expect(calls).not.toContain('COMMIT');
      expect(mockClientRelease).toHaveBeenCalledTimes(1);
    });

    it('inserts sync_operations with status=applied', async () => {
      mockClientQuery
        .mockResolvedValueOnce(undefined) // BEGIN
        .mockResolvedValueOnce({ rows: [{ id: 'rec-1', version: 1 }] }) // INSERT records
        .mockResolvedValueOnce({ rows: [] }) // INSERT versions
        .mockResolvedValueOnce({ rows: [] }) // INSERT events
        .mockResolvedValueOnce({ rows: [] }) // INSERT sync_operations
        .mockResolvedValueOnce(undefined); // COMMIT

      await service.applyOperation('user-1', makeOp({ idempotencyKey: 'idem-key' }));

      const syncOpCall = mockClientQuery.mock.calls[4];
      expect(syncOpCall[0]).toContain('sync_operations');
      expect(syncOpCall[0]).toContain("'applied'");
      expect(syncOpCall[1]).toContain('idem-key');
    });

    it('increments version in versions table for create', async () => {
      mockClientQuery
        .mockResolvedValueOnce(undefined) // BEGIN
        .mockResolvedValueOnce({ rows: [{ id: 'rec-1', version: 1 }] }) // INSERT records
        .mockResolvedValueOnce({ rows: [] }) // INSERT versions
        .mockResolvedValueOnce({ rows: [] }) // INSERT events
        .mockResolvedValueOnce({ rows: [] }) // INSERT sync_operations
        .mockResolvedValueOnce(undefined); // COMMIT

      await service.applyOperation('user-1', makeOp());

      const versionsCall = mockClientQuery.mock.calls[2];
      expect(versionsCall[0]).toContain('versions');
      expect(versionsCall[1]).toContain(1); // version value
    });
  });
});
