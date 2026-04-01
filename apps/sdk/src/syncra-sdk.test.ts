/**
 * Unit tests for SyncraSDK delta pull (task 7.3 — client delta application)
 * Validates Requirements 7.2.1, 7.2.2, 7.2.3
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NetworkStateManager } from './network-state-manager';

// ---------------------------------------------------------------------------
// Mock IndexedDB modules so tests run in Node (no real browser storage)
// ---------------------------------------------------------------------------
vi.mock('./db/records-store', () => ({
  getRecord: vi.fn(),
  upsertRecord: vi.fn(),
  deleteRecord: vi.fn(),
}));

vi.mock('./db/queue-store', () => ({
  getPendingOperations: vi.fn(),
  enqueueOperation: vi.fn(),
  markOperationApplied: vi.fn(),
  removeOperation: vi.fn(),
  updateOperationStatus: vi.fn(),
  updateOperation: vi.fn(),
}));

vi.mock('./db/metadata-store', () => ({
  getMetadata: vi.fn(),
  setMetadata: vi.fn(),
}));

import { upsertRecord, deleteRecord } from './db/records-store';
import { getPendingOperations, markOperationApplied } from './db/queue-store';
import { getMetadata, setMetadata } from './db/metadata-store';
import { SyncraSDK } from './syncra-sdk';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSdk() {
  // Stub navigator.onLine and window event listeners for Node environment
  Object.defineProperty(globalThis, 'navigator', {
    value: { onLine: true },
    writable: true,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'window', {
    value: { addEventListener: vi.fn(), removeEventListener: vi.fn() },
    writable: true,
    configurable: true,
  });

  return new SyncraSDK({ baseUrl: 'http://localhost:3000', apiKey: 'test-token', syncInterval: 0, networkStateManagerOptions: { checkInterval: 0 } });
}

function mockFetch(responses: Array<{ ok: boolean; json: () => Promise<unknown> }>) {
  let callIndex = 0;
  globalThis.fetch = vi.fn().mockImplementation(() => {
    const res = responses[callIndex++] ?? responses[responses.length - 1];
    return Promise.resolve(res);
  });
}

const EPOCH = new Date(0).toISOString();

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SyncraSDK — pullDelta (task 7.3)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('upserts each returned record into the local database (Req 7.2.2)', async () => {
    const sdk = makeSdk();

    const pendingOp = {
      id: 'op-1',
      type: 'create' as const,
      recordId: 'rec-1',
      payload: { title: 'hello' },
      version: 1,
      idempotencyKey: 'ik-1',
      status: 'pending' as const,
      retries: 0,
      maxRetries: 5,
      createdAt: new Date(),
    };

    vi.mocked(getPendingOperations).mockResolvedValue([pendingOp]);
    vi.mocked(markOperationApplied).mockResolvedValue(undefined);
    vi.mocked(getMetadata).mockResolvedValue(undefined); // first sync

    const serverRecord = { id: 'rec-server-1', data: { x: 1 }, version: 2, updated_at: '2024-01-01T00:00:00Z', created_at: '2024-01-01T00:00:00Z' };

    mockFetch([
      // POST /sync response
      { ok: true, json: async () => ({ applied: [{ operationId: 'op-1', recordId: 'rec-1', newVersion: 1 }], rejected: [] }) },
      // GET /sync/updates response
      { ok: true, json: async () => ({ records: [serverRecord], deletedRecordIds: [] }) },
    ]);

    vi.mocked(upsertRecord).mockResolvedValue(undefined);
    vi.mocked(deleteRecord).mockResolvedValue(undefined);
    vi.mocked(setMetadata).mockResolvedValue(undefined);

    await sdk.sync();

    // upsertRecord should have been called with the server record
    expect(upsertRecord).toHaveBeenCalledWith(serverRecord);
  });

  it('removes each deleted record id from the local database (Req 7.2.3)', async () => {
    const sdk = makeSdk();

    const pendingOp = {
      id: 'op-2',
      type: 'delete' as const,
      recordId: 'rec-del',
      payload: {},
      version: 1,
      idempotencyKey: 'ik-2',
      status: 'pending' as const,
      retries: 0,
      maxRetries: 5,
      createdAt: new Date(),
    };

    vi.mocked(getPendingOperations).mockResolvedValue([pendingOp]);
    vi.mocked(markOperationApplied).mockResolvedValue(undefined);
    vi.mocked(getMetadata).mockResolvedValue('2024-01-01T00:00:00.000Z');

    mockFetch([
      { ok: true, json: async () => ({ applied: [{ operationId: 'op-2', recordId: 'rec-del', newVersion: 1 }], rejected: [] }) },
      { ok: true, json: async () => ({ records: [], deletedRecordIds: ['rec-del'] }) },
    ]);

    vi.mocked(upsertRecord).mockResolvedValue(undefined);
    vi.mocked(deleteRecord).mockResolvedValue(undefined);
    vi.mocked(setMetadata).mockResolvedValue(undefined);

    await sdk.sync();

    expect(deleteRecord).toHaveBeenCalledWith('rec-del');
  });

  it('updates the last sync timestamp after a successful pull (Req 7.2)', async () => {
    const sdk = makeSdk();

    vi.mocked(getPendingOperations).mockResolvedValue([
      {
        id: 'op-3', type: 'create', recordId: 'rec-3', payload: {}, version: 1,
        idempotencyKey: 'ik-3', status: 'pending', retries: 0, maxRetries: 5, createdAt: new Date(),
      },
    ]);
    vi.mocked(markOperationApplied).mockResolvedValue(undefined);
    vi.mocked(getMetadata).mockResolvedValue(undefined);

    mockFetch([
      { ok: true, json: async () => ({ applied: [{ operationId: 'op-3', recordId: 'rec-3', newVersion: 1 }], rejected: [] }) },
      { ok: true, json: async () => ({ records: [], deletedRecordIds: [] }) },
    ]);

    vi.mocked(upsertRecord).mockResolvedValue(undefined);
    vi.mocked(deleteRecord).mockResolvedValue(undefined);
    vi.mocked(setMetadata).mockResolvedValue(undefined);

    await sdk.sync();

    expect(setMetadata).toHaveBeenCalledWith('lastSyncTime', expect.any(String));
  });

  it('uses epoch as since when no lastSyncTime is stored (first sync)', async () => {
    const sdk = makeSdk();

    vi.mocked(getPendingOperations).mockResolvedValue([
      {
        id: 'op-4', type: 'create', recordId: 'rec-4', payload: {}, version: 1,
        idempotencyKey: 'ik-4', status: 'pending', retries: 0, maxRetries: 5, createdAt: new Date(),
      },
    ]);
    vi.mocked(markOperationApplied).mockResolvedValue(undefined);
    vi.mocked(getMetadata).mockResolvedValue(undefined); // no stored timestamp

    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ applied: [{ operationId: 'op-4', recordId: 'rec-4', newVersion: 1 }], rejected: [] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ records: [], deletedRecordIds: [] }) });

    globalThis.fetch = fetchMock;
    vi.mocked(upsertRecord).mockResolvedValue(undefined);
    vi.mocked(deleteRecord).mockResolvedValue(undefined);
    vi.mocked(setMetadata).mockResolvedValue(undefined);

    await sdk.sync();

    // Second fetch call should be the GET /sync/updates with since=epoch
    const secondCall = fetchMock.mock.calls[1];
    expect(secondCall[0]).toContain(encodeURIComponent(EPOCH));
  });

  it('uses stored lastSyncTime as the since parameter', async () => {
    const sdk = makeSdk();
    const storedTime = '2024-06-01T12:00:00.000Z';

    vi.mocked(getPendingOperations).mockResolvedValue([
      {
        id: 'op-5', type: 'create', recordId: 'rec-5', payload: {}, version: 1,
        idempotencyKey: 'ik-5', status: 'pending', retries: 0, maxRetries: 5, createdAt: new Date(),
      },
    ]);
    vi.mocked(markOperationApplied).mockResolvedValue(undefined);
    vi.mocked(getMetadata).mockResolvedValue(storedTime);

    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ applied: [{ operationId: 'op-5', recordId: 'rec-5', newVersion: 1 }], rejected: [] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ records: [], deletedRecordIds: [] }) });

    globalThis.fetch = fetchMock;
    vi.mocked(upsertRecord).mockResolvedValue(undefined);
    vi.mocked(deleteRecord).mockResolvedValue(undefined);
    vi.mocked(setMetadata).mockResolvedValue(undefined);

    await sdk.sync();

    const secondCall = fetchMock.mock.calls[1];
    expect(secondCall[0]).toContain(encodeURIComponent(storedTime));
  });
});

// ---------------------------------------------------------------------------
// Task 8.3 — Last-Write-Wins Default Conflict Resolution (Requirements 8.2)
// ---------------------------------------------------------------------------

describe('SyncraSDK — last-write-wins conflict resolution (task 8.3)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('overwrites local record with serverData when no conflict handler is registered (Req 8.2.1)', async () => {
    const sdk = makeSdk();

    const pendingOp = {
      id: 'op-conflict-1',
      type: 'update' as const,
      recordId: 'rec-conflict-1',
      payload: { title: 'client version' },
      version: 1,
      idempotencyKey: 'ik-conflict-1',
      status: 'pending' as const,
      retries: 0,
      maxRetries: 5,
      createdAt: new Date(),
    };

    vi.mocked(getPendingOperations).mockResolvedValue([pendingOp]);
    vi.mocked(getMetadata).mockResolvedValue(undefined);

    const existingRecord = {
      id: 'rec-conflict-1',
      data: { title: 'client version' },
      version: 1,
      updated_at: '2024-01-01T00:00:00Z',
      created_at: '2024-01-01T00:00:00Z',
    };

    const { getRecord } = await import('./db/records-store');
    vi.mocked(getRecord).mockResolvedValue(existingRecord);
    vi.mocked(upsertRecord).mockResolvedValue(undefined);

    const { removeOperation } = await import('./db/queue-store');
    vi.mocked(removeOperation).mockResolvedValue(undefined);
    vi.mocked(setMetadata).mockResolvedValue(undefined);

    const serverData = { title: 'server version', extra: 'field' };

    mockFetch([
      {
        ok: true,
        json: async () => ({
          applied: [],
          rejected: [
            {
              operationId: 'op-conflict-1',
              recordId: 'rec-conflict-1',
              reason: 'version_conflict',
              clientVersion: 1,
              serverVersion: 3,
              serverData,
            },
          ],
        }),
      },
      { ok: true, json: async () => ({ records: [], deletedRecordIds: [] }) },
    ]);

    await sdk.sync();

    // Should upsert the record with serverData and serverVersion
    expect(upsertRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'rec-conflict-1',
        data: serverData,
        version: 3,
      }),
    );
  });

  it('removes the conflicting operation from the queue (Req 8.2.2)', async () => {
    const sdk = makeSdk();

    const pendingOp = {
      id: 'op-conflict-2',
      type: 'update' as const,
      recordId: 'rec-conflict-2',
      payload: { value: 42 },
      version: 2,
      idempotencyKey: 'ik-conflict-2',
      status: 'pending' as const,
      retries: 0,
      maxRetries: 5,
      createdAt: new Date(),
    };

    vi.mocked(getPendingOperations).mockResolvedValue([pendingOp]);
    vi.mocked(getMetadata).mockResolvedValue(undefined);

    const existingRecord = {
      id: 'rec-conflict-2',
      data: { value: 42 },
      version: 2,
      updated_at: '2024-01-01T00:00:00Z',
      created_at: '2024-01-01T00:00:00Z',
    };

    const { getRecord } = await import('./db/records-store');
    vi.mocked(getRecord).mockResolvedValue(existingRecord);
    vi.mocked(upsertRecord).mockResolvedValue(undefined);

    const { removeOperation } = await import('./db/queue-store');
    vi.mocked(removeOperation).mockResolvedValue(undefined);
    vi.mocked(setMetadata).mockResolvedValue(undefined);

    mockFetch([
      {
        ok: true,
        json: async () => ({
          applied: [],
          rejected: [
            {
              operationId: 'op-conflict-2',
              recordId: 'rec-conflict-2',
              reason: 'version_conflict',
              clientVersion: 2,
              serverVersion: 5,
              serverData: { value: 99 },
            },
          ],
        }),
      },
      { ok: true, json: async () => ({ records: [], deletedRecordIds: [] }) },
    ]);

    await sdk.sync();

    expect(removeOperation).toHaveBeenCalledWith('op-conflict-2');
  });

  it('emits a conflict event with the conflict details (Req 8.1.2)', async () => {
    const sdk = makeSdk();

    const pendingOp = {
      id: 'op-conflict-3',
      type: 'update' as const,
      recordId: 'rec-conflict-3',
      payload: { name: 'old' },
      version: 1,
      idempotencyKey: 'ik-conflict-3',
      status: 'pending' as const,
      retries: 0,
      maxRetries: 5,
      createdAt: new Date(),
    };

    vi.mocked(getPendingOperations).mockResolvedValue([pendingOp]);
    vi.mocked(getMetadata).mockResolvedValue(undefined);

    const existingRecord = {
      id: 'rec-conflict-3',
      data: { name: 'old' },
      version: 1,
      updated_at: '2024-01-01T00:00:00Z',
      created_at: '2024-01-01T00:00:00Z',
    };

    const { getRecord } = await import('./db/records-store');
    vi.mocked(getRecord).mockResolvedValue(existingRecord);
    vi.mocked(upsertRecord).mockResolvedValue(undefined);

    const { removeOperation } = await import('./db/queue-store');
    vi.mocked(removeOperation).mockResolvedValue(undefined);
    vi.mocked(setMetadata).mockResolvedValue(undefined);

    const serverData = { name: 'server-name' };
    const conflictEvents: unknown[] = [];
    sdk.on('conflict', (c) => conflictEvents.push(c));

    mockFetch([
      {
        ok: true,
        json: async () => ({
          applied: [],
          rejected: [
            {
              operationId: 'op-conflict-3',
              recordId: 'rec-conflict-3',
              reason: 'version_conflict',
              clientVersion: 1,
              serverVersion: 4,
              serverData,
            },
          ],
        }),
      },
      { ok: true, json: async () => ({ records: [], deletedRecordIds: [] }) },
    ]);

    await sdk.sync();

    expect(conflictEvents).toHaveLength(1);
    expect(conflictEvents[0]).toEqual({
      recordId: 'rec-conflict-3',
      clientVersion: 1,
      serverVersion: 4,
      serverData,
    });
  });

  it('does NOT apply last-write-wins when a custom conflict handler is registered', async () => {
    const sdk = makeSdk();

    const pendingOp = {
      id: 'op-conflict-4',
      type: 'update' as const,
      recordId: 'rec-conflict-4',
      payload: { score: 10 },
      version: 1,
      idempotencyKey: 'ik-conflict-4',
      status: 'pending' as const,
      retries: 0,
      maxRetries: 5,
      createdAt: new Date(),
    };

    vi.mocked(getPendingOperations).mockResolvedValue([pendingOp]);
    vi.mocked(getMetadata).mockResolvedValue(undefined);

    const existingRecord = {
      id: 'rec-conflict-4',
      data: { score: 10 },
      version: 1,
      updated_at: '2024-01-01T00:00:00Z',
      created_at: '2024-01-01T00:00:00Z',
    };

    const { getRecord } = await import('./db/records-store');
    vi.mocked(getRecord).mockResolvedValue(existingRecord);
    vi.mocked(upsertRecord).mockResolvedValue(undefined);

    const { removeOperation, enqueueOperation } = await import('./db/queue-store');
    vi.mocked(removeOperation).mockResolvedValue(undefined);
    vi.mocked(enqueueOperation).mockResolvedValue(undefined);
    vi.mocked(setMetadata).mockResolvedValue(undefined);

    const resolvedData = { score: 99, merged: true };
    sdk.onConflict(() => ({ data: resolvedData, version: 7 }));

    mockFetch([
      {
        ok: true,
        json: async () => ({
          applied: [],
          rejected: [
            {
              operationId: 'op-conflict-4',
              recordId: 'rec-conflict-4',
              reason: 'version_conflict',
              clientVersion: 1,
              serverVersion: 7,
              serverData: { score: 50 },
            },
          ],
        }),
      },
      { ok: true, json: async () => ({ records: [], deletedRecordIds: [] }) },
    ]);

    await sdk.sync();

    // removeOperation should NOT be called (custom handler path, not LWW)
    expect(removeOperation).not.toHaveBeenCalled();
    // upsertRecord should be called with the resolved data, not serverData
    expect(upsertRecord).toHaveBeenCalledWith(
      expect.objectContaining({ data: resolvedData, version: 7 }),
    );
  });
});

// ---------------------------------------------------------------------------
// Task 8.5 — Custom Conflict Handler Registration (Requirements 8.3)
// ---------------------------------------------------------------------------

describe('SyncraSDK — custom conflict handler registration (task 8.5)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('invokes the registered handler with the conflict object (Req 8.3.2)', async () => {
    const sdk = makeSdk();

    const pendingOp = {
      id: 'op-custom-1',
      type: 'update' as const,
      recordId: 'rec-custom-1',
      payload: { count: 5 },
      version: 2,
      idempotencyKey: 'ik-custom-1',
      status: 'pending' as const,
      retries: 0,
      maxRetries: 5,
      createdAt: new Date(),
    };

    vi.mocked(getPendingOperations).mockResolvedValue([pendingOp]);
    vi.mocked(getMetadata).mockResolvedValue(undefined);

    const existingRecord = {
      id: 'rec-custom-1',
      data: { count: 5 },
      version: 2,
      updated_at: '2024-01-01T00:00:00Z',
      created_at: '2024-01-01T00:00:00Z',
    };

    const { getRecord } = await import('./db/records-store');
    vi.mocked(getRecord).mockResolvedValue(existingRecord);
    vi.mocked(upsertRecord).mockResolvedValue(undefined);

    const { enqueueOperation } = await import('./db/queue-store');
    vi.mocked(enqueueOperation).mockResolvedValue(undefined);
    vi.mocked(setMetadata).mockResolvedValue(undefined);

    const serverData = { count: 10 };
    const capturedConflicts: unknown[] = [];

    sdk.onConflict((conflict) => {
      capturedConflicts.push(conflict);
      return { data: { count: 15 }, version: 4 };
    });

    mockFetch([
      {
        ok: true,
        json: async () => ({
          applied: [],
          rejected: [
            {
              operationId: 'op-custom-1',
              recordId: 'rec-custom-1',
              reason: 'version_conflict',
              clientVersion: 2,
              serverVersion: 4,
              serverData,
            },
          ],
        }),
      },
      { ok: true, json: async () => ({ records: [], deletedRecordIds: [] }) },
    ]);

    await sdk.sync();

    expect(capturedConflicts).toHaveLength(1);
    expect(capturedConflicts[0]).toEqual({
      recordId: 'rec-custom-1',
      clientVersion: 2,
      serverVersion: 4,
      serverData,
    });
  });

  it('re-enqueues an update operation with resolved data and server version (Req 8.3.3)', async () => {
    const sdk = makeSdk();

    const pendingOp = {
      id: 'op-custom-2',
      type: 'update' as const,
      recordId: 'rec-custom-2',
      payload: { value: 'old' },
      version: 1,
      idempotencyKey: 'ik-custom-2',
      status: 'pending' as const,
      retries: 0,
      maxRetries: 5,
      createdAt: new Date(),
    };

    vi.mocked(getPendingOperations).mockResolvedValue([pendingOp]);
    vi.mocked(getMetadata).mockResolvedValue(undefined);

    const existingRecord = {
      id: 'rec-custom-2',
      data: { value: 'old' },
      version: 1,
      updated_at: '2024-01-01T00:00:00Z',
      created_at: '2024-01-01T00:00:00Z',
    };

    const { getRecord } = await import('./db/records-store');
    vi.mocked(getRecord).mockResolvedValue(existingRecord);
    vi.mocked(upsertRecord).mockResolvedValue(undefined);

    const { enqueueOperation } = await import('./db/queue-store');
    vi.mocked(enqueueOperation).mockResolvedValue(undefined);
    vi.mocked(setMetadata).mockResolvedValue(undefined);

    const resolvedData = { value: 'merged' };
    const serverVersion = 6;

    sdk.onConflict(() => ({ data: resolvedData, version: serverVersion }));

    mockFetch([
      {
        ok: true,
        json: async () => ({
          applied: [],
          rejected: [
            {
              operationId: 'op-custom-2',
              recordId: 'rec-custom-2',
              reason: 'version_conflict',
              clientVersion: 1,
              serverVersion,
              serverData: { value: 'server' },
            },
          ],
        }),
      },
      { ok: true, json: async () => ({ records: [], deletedRecordIds: [] }) },
    ]);

    await sdk.sync();

    // enqueueOperation should be called with an update operation using resolved data and server version
    expect(enqueueOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'update',
        recordId: 'rec-custom-2',
        payload: resolvedData,
        version: serverVersion,
        status: 'pending',
      }),
    );
  });

  it('stores the last registered handler, replacing any previous one', async () => {
    const sdk = makeSdk();

    const handler1 = vi.fn().mockReturnValue({ data: { from: 'handler1' }, version: 1 });
    const handler2 = vi.fn().mockReturnValue({ data: { from: 'handler2' }, version: 2 });

    sdk.onConflict(handler1);
    sdk.onConflict(handler2);

    const pendingOp = {
      id: 'op-custom-3',
      type: 'update' as const,
      recordId: 'rec-custom-3',
      payload: { x: 1 },
      version: 1,
      idempotencyKey: 'ik-custom-3',
      status: 'pending' as const,
      retries: 0,
      maxRetries: 5,
      createdAt: new Date(),
    };

    vi.mocked(getPendingOperations).mockResolvedValue([pendingOp]);
    vi.mocked(getMetadata).mockResolvedValue(undefined);

    const existingRecord = {
      id: 'rec-custom-3',
      data: { x: 1 },
      version: 1,
      updated_at: '2024-01-01T00:00:00Z',
      created_at: '2024-01-01T00:00:00Z',
    };

    const { getRecord } = await import('./db/records-store');
    vi.mocked(getRecord).mockResolvedValue(existingRecord);
    vi.mocked(upsertRecord).mockResolvedValue(undefined);

    const { enqueueOperation } = await import('./db/queue-store');
    vi.mocked(enqueueOperation).mockResolvedValue(undefined);
    vi.mocked(setMetadata).mockResolvedValue(undefined);

    mockFetch([
      {
        ok: true,
        json: async () => ({
          applied: [],
          rejected: [
            {
              operationId: 'op-custom-3',
              recordId: 'rec-custom-3',
              reason: 'version_conflict',
              clientVersion: 1,
              serverVersion: 2,
              serverData: { x: 99 },
            },
          ],
        }),
      },
      { ok: true, json: async () => ({ records: [], deletedRecordIds: [] }) },
    ]);

    await sdk.sync();

    expect(handler1).not.toHaveBeenCalled();
    expect(handler2).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// Task 9.3 — Client-Side Retry Logic (Requirements 9.1)
// ---------------------------------------------------------------------------

describe('SyncraSDK — client-side retry logic (task 9.3)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  type PendingOp = {
    id: string;
    type: 'create' | 'update' | 'delete';
    recordId: string;
    payload: Record<string, unknown>;
    version: number;
    idempotencyKey: string;
    status: 'pending' | 'applied' | 'failed';
    retries: number;
    maxRetries: number;
    createdAt: Date;
    nextRetryAt?: Date;
  };

  function makePendingOp(overrides: Partial<PendingOp> = {}): PendingOp {
    return {
      id: 'op-retry-1',
      type: 'create' as const,
      recordId: 'rec-retry-1',
      payload: { title: 'test' },
      version: 1,
      idempotencyKey: 'ik-retry-1',
      status: 'pending' as const,
      retries: 0,
      maxRetries: 5,
      createdAt: new Date(),
      ...overrides,
    };
  }

  it('increments retries counter and sets nextRetryAt on network error (Req 9.1.1)', async () => {
    const sdk = makeSdk();
    const op = makePendingOp();

    vi.mocked(getPendingOperations).mockResolvedValue([op]);

    const { updateOperation } = await import('./db/queue-store');
    vi.mocked(updateOperation).mockResolvedValue(undefined);

    // Simulate network error
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

    await expect(sdk.sync()).rejects.toThrow('Network error');

    expect(updateOperation).toHaveBeenCalledWith(
      'op-retry-1',
      expect.objectContaining({
        retries: 1,
        nextRetryAt: expect.any(Date),
      }),
    );
  });

  it('increments retries counter and sets nextRetryAt on 5xx response (Req 9.1.1)', async () => {
    const sdk = makeSdk();
    const op = makePendingOp();

    vi.mocked(getPendingOperations).mockResolvedValue([op]);

    const { updateOperation } = await import('./db/queue-store');
    vi.mocked(updateOperation).mockResolvedValue(undefined);

    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 503 });

    const result = await sdk.sync();

    expect(result).toEqual({ applied: 0, rejected: 0 });
    expect(updateOperation).toHaveBeenCalledWith(
      'op-retry-1',
      expect.objectContaining({
        retries: 1,
        nextRetryAt: expect.any(Date),
      }),
    );
  });

  it('nextRetryAt is in the future after a failure (Req 9.1.3)', async () => {
    const sdk = makeSdk();
    const op = makePendingOp({ retries: 2 });

    vi.mocked(getPendingOperations).mockResolvedValue([op]);

    const { updateOperation } = await import('./db/queue-store');
    let capturedPatch: Record<string, unknown> = {};
    vi.mocked(updateOperation).mockImplementation(async (_id, patch) => {
      capturedPatch = patch as Record<string, unknown>;
    });

    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

    await expect(sdk.sync()).rejects.toThrow();

    const nextRetryAt = capturedPatch.nextRetryAt as Date;
    expect(nextRetryAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('marks operation as failed when retries reaches maxRetries (Req 9.1.2)', async () => {
    const sdk = makeSdk();
    // retries=4, maxRetries=5 → after increment retries=5 >= maxRetries=5 → failed
    const op = makePendingOp({ retries: 4, maxRetries: 5 });

    vi.mocked(getPendingOperations).mockResolvedValue([op]);

    const { updateOperation } = await import('./db/queue-store');
    vi.mocked(updateOperation).mockResolvedValue(undefined);

    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

    await expect(sdk.sync()).rejects.toThrow();

    expect(updateOperation).toHaveBeenCalledWith(
      'op-retry-1',
      expect.objectContaining({ status: 'failed', retries: 5 }),
    );
  });

  it('emits sync-failed event when operation reaches max retries (Req 9.1.2)', async () => {
    const sdk = makeSdk();
    const op = makePendingOp({ retries: 4, maxRetries: 5 });

    vi.mocked(getPendingOperations).mockResolvedValue([op]);

    const { updateOperation } = await import('./db/queue-store');
    vi.mocked(updateOperation).mockResolvedValue(undefined);

    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

    const failedEvents: unknown[] = [];
    sdk.on('sync-failed', (e) => failedEvents.push(e));

    await expect(sdk.sync()).rejects.toThrow();

    // sync-failed should be emitted (at least once — once for max retries, once for the thrown error)
    expect(failedEvents.length).toBeGreaterThanOrEqual(1);
  });

  it('does not apply retry logic for 4xx responses (non-retriable)', async () => {
    const sdk = makeSdk();
    const op = makePendingOp();

    vi.mocked(getPendingOperations).mockResolvedValue([op]);

    const { updateOperation } = await import('./db/queue-store');
    vi.mocked(updateOperation).mockResolvedValue(undefined);

    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 400 });

    await expect(sdk.sync()).rejects.toThrow('Sync request failed with status 400');

    // updateOperation should NOT be called for 4xx (not retriable)
    expect(updateOperation).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Task 9.4 — Max Retries Enforcement (Requirements 9.2)
// ---------------------------------------------------------------------------

describe('SyncraSDK — max retries enforcement (task 9.4)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function makePendingOp(overrides: Partial<{
    id: string;
    type: 'create' | 'update' | 'delete';
    recordId: string;
    payload: Record<string, unknown>;
    version: number;
    idempotencyKey: string;
    status: 'pending' | 'applied' | 'failed';
    retries: number;
    maxRetries: number;
    createdAt: Date;
    nextRetryAt?: Date;
  }> = {}) {
    return {
      id: 'op-maxretry-1',
      type: 'create' as const,
      recordId: 'rec-maxretry-1',
      payload: { title: 'test' },
      version: 1,
      idempotencyKey: 'ik-maxretry-1',
      status: 'pending' as const,
      retries: 0,
      maxRetries: 5,
      createdAt: new Date(),
      ...overrides,
    };
  }

  it('marks operation as failed when retries reaches maxRetries (Req 9.2)', async () => {
    const sdk = makeSdk();
    // retries=4, maxRetries=5 → after increment retries=5 >= maxRetries=5 → failed
    const op = makePendingOp({ retries: 4, maxRetries: 5 });

    vi.mocked(getPendingOperations).mockResolvedValue([op]);

    const { updateOperation } = await import('./db/queue-store');
    vi.mocked(updateOperation).mockResolvedValue(undefined);

    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

    await expect(sdk.sync()).rejects.toThrow();

    expect(updateOperation).toHaveBeenCalledWith(
      'op-maxretry-1',
      expect.objectContaining({ status: 'failed', retries: 5 }),
    );
  });

  it('emits sync-failed event when max retries is reached (Req 9.2)', async () => {
    const sdk = makeSdk();
    const op = makePendingOp({ retries: 4, maxRetries: 5 });

    vi.mocked(getPendingOperations).mockResolvedValue([op]);

    const { updateOperation } = await import('./db/queue-store');
    vi.mocked(updateOperation).mockResolvedValue(undefined);

    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

    const failedEvents: unknown[] = [];
    sdk.on('sync-failed', (e) => failedEvents.push(e));

    await expect(sdk.sync()).rejects.toThrow();

    // At least one sync-failed event should be emitted for max retries
    expect(failedEvents.length).toBeGreaterThanOrEqual(1);
  });

  it('does not include failed operations in subsequent sync batches (Req 9.2)', async () => {
    // getPendingOperations queries by status='pending', so failed ops are excluded
    // This test verifies that after marking as failed, the op won't appear in next sync
    const sdk = makeSdk();

    // First call: return the op that will exhaust retries
    const op = makePendingOp({ retries: 4, maxRetries: 5 });
    vi.mocked(getPendingOperations)
      .mockResolvedValueOnce([op])   // first sync — op is still pending
      .mockResolvedValueOnce([]);    // second sync — op is now failed, not returned

    const { updateOperation } = await import('./db/queue-store');
    vi.mocked(updateOperation).mockResolvedValue(undefined);

    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

    // First sync — exhausts retries, marks as failed
    await expect(sdk.sync()).rejects.toThrow();

    // Second sync — no pending ops (failed op excluded)
    const result = await sdk.sync();
    expect(result).toEqual({ applied: 0, rejected: 0 });

    // fetch should only have been called once (first sync), not on second sync
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('uses default maxRetries of 5 when maxRetries is not set on operation (Req 9.2)', async () => {
    const sdk = makeSdk();
    // maxRetries not set — should default to MAX_RETRIES (5)
    const op = {
      id: 'op-default-max',
      type: 'create' as const,
      recordId: 'rec-default-max',
      payload: {},
      version: 1,
      idempotencyKey: 'ik-default-max',
      status: 'pending' as const,
      retries: 4,
      maxRetries: undefined as unknown as number,
      createdAt: new Date(),
    };

    vi.mocked(getPendingOperations).mockResolvedValue([op]);

    const { updateOperation } = await import('./db/queue-store');
    vi.mocked(updateOperation).mockResolvedValue(undefined);

    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

    await expect(sdk.sync()).rejects.toThrow();

    // Should still mark as failed using default MAX_RETRIES=5
    expect(updateOperation).toHaveBeenCalledWith(
      'op-default-max',
      expect.objectContaining({ status: 'failed', retries: 5 }),
    );
  });

  it('does not mark operation as failed when retries is below maxRetries (Req 9.2)', async () => {
    const sdk = makeSdk();
    // retries=2, maxRetries=5 → after increment retries=3 < 5 → should NOT be failed
    const op = makePendingOp({ retries: 2, maxRetries: 5 });

    vi.mocked(getPendingOperations).mockResolvedValue([op]);

    const { updateOperation } = await import('./db/queue-store');
    vi.mocked(updateOperation).mockResolvedValue(undefined);

    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

    await expect(sdk.sync()).rejects.toThrow();

    // Should update with incremented retries and nextRetryAt, but NOT status: 'failed'
    expect(updateOperation).toHaveBeenCalledWith(
      'op-maxretry-1',
      expect.objectContaining({ retries: 3, nextRetryAt: expect.any(Date) }),
    );
    expect(updateOperation).not.toHaveBeenCalledWith(
      'op-maxretry-1',
      expect.objectContaining({ status: 'failed' }),
    );
  });
});

// ---------------------------------------------------------------------------
// Task 9.9 — Job Status Polling (Requirements 9.3)
// ---------------------------------------------------------------------------

describe('SyncraSDK — job status polling (task 9.9)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function makePendingOp(overrides: Partial<{
    id: string;
    type: 'create' | 'update' | 'delete';
    recordId: string;
    payload: Record<string, unknown>;
    version: number;
    idempotencyKey: string;
    status: 'pending' | 'applied' | 'failed';
    retries: number;
    maxRetries: number;
    createdAt: Date;
  }> = {}) {
    return {
      id: 'op-poll-1',
      type: 'create' as const,
      recordId: 'rec-poll-1',
      payload: { title: 'test' },
      version: 1,
      idempotencyKey: 'ik-poll-1',
      status: 'pending' as const,
      retries: 0,
      maxRetries: 5,
      createdAt: new Date(),
      ...overrides,
    };
  }

  it('polls job status endpoint when POST /sync returns 202 (Req 9.3.1)', async () => {
    const sdk = makeSdk();
    const op = makePendingOp();

    vi.mocked(getPendingOperations).mockResolvedValue([op]);
    vi.mocked(markOperationApplied).mockResolvedValue(undefined);
    vi.mocked(getMetadata).mockResolvedValue(undefined);
    vi.mocked(upsertRecord).mockResolvedValue(undefined);
    vi.mocked(setMetadata).mockResolvedValue(undefined);

    const fetchMock = vi.fn()
      // POST /sync → 202
      .mockResolvedValueOnce({
        ok: true,
        status: 202,
        json: async () => ({ jobId: 'job-abc', status: 'queued' }),
      })
      // GET /sync/job/job-abc → completed
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          jobId: 'job-abc',
          status: 'completed',
          result: { applied: [{ operationId: 'op-poll-1', recordId: 'rec-poll-1', newVersion: 1 }], rejected: [] },
        }),
      })
      // GET /sync/updates
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ records: [], deletedRecordIds: [] }),
      });

    globalThis.fetch = fetchMock;

    // Advance timers to skip the polling delay
    const syncPromise = sdk.sync();
    await vi.runAllTimersAsync();
    const result = await syncPromise;

    expect(result.applied).toBe(1);
    expect(result.rejected).toBe(0);

    // Verify the polling call was made to the correct endpoint
    const pollCall = fetchMock.mock.calls[1];
    expect(pollCall[0]).toContain('/sync/job/job-abc');
  });

  it('marks operations as applied when job status is completed (Req 9.3.2)', async () => {
    const sdk = makeSdk();
    const op = makePendingOp();

    vi.mocked(getPendingOperations).mockResolvedValue([op]);
    vi.mocked(markOperationApplied).mockResolvedValue(undefined);
    vi.mocked(getMetadata).mockResolvedValue(undefined);
    vi.mocked(upsertRecord).mockResolvedValue(undefined);
    vi.mocked(setMetadata).mockResolvedValue(undefined);

    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 202,
        json: async () => ({ jobId: 'job-complete', status: 'queued' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          jobId: 'job-complete',
          status: 'completed',
          result: {
            applied: [{ operationId: 'op-poll-1', recordId: 'rec-poll-1', newVersion: 2 }],
            rejected: [],
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ records: [], deletedRecordIds: [] }),
      });

    const syncPromise = sdk.sync();
    await vi.runAllTimersAsync();
    await syncPromise;

    expect(markOperationApplied).toHaveBeenCalledWith('op-poll-1');
  });

  it('emits sync-failed when job status is failed (Req 9.3.3)', async () => {
    const sdk = makeSdk();
    const op = makePendingOp();

    vi.mocked(getPendingOperations).mockResolvedValue([op]);
    vi.mocked(getMetadata).mockResolvedValue(undefined);

    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 202,
        json: async () => ({ jobId: 'job-fail', status: 'queued' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          jobId: 'job-fail',
          status: 'failed',
          failedReason: 'Worker crashed',
        }),
      });

    const failedEvents: unknown[] = [];
    sdk.on('sync-failed', (e) => failedEvents.push(e));

    let thrownError: Error | null = null;
    const syncPromise = sdk.sync().catch((e) => { thrownError = e; });
    await vi.runAllTimersAsync();
    await syncPromise;

    expect(thrownError).not.toBeNull();
    expect(thrownError!.message).toBe('Worker crashed');
    expect(failedEvents.length).toBeGreaterThanOrEqual(1);
  });

  it('continues polling while job is queued or active (Req 9.3.1)', async () => {
    const sdk = makeSdk();
    const op = makePendingOp();

    vi.mocked(getPendingOperations).mockResolvedValue([op]);
    vi.mocked(markOperationApplied).mockResolvedValue(undefined);
    vi.mocked(getMetadata).mockResolvedValue(undefined);
    vi.mocked(upsertRecord).mockResolvedValue(undefined);
    vi.mocked(setMetadata).mockResolvedValue(undefined);

    const fetchMock = vi.fn()
      // POST /sync → 202
      .mockResolvedValueOnce({
        ok: true,
        status: 202,
        json: async () => ({ jobId: 'job-slow', status: 'queued' }),
      })
      // First poll → still queued
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ jobId: 'job-slow', status: 'queued' }),
      })
      // Second poll → active
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ jobId: 'job-slow', status: 'active' }),
      })
      // Third poll → completed
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          jobId: 'job-slow',
          status: 'completed',
          result: { applied: [{ operationId: 'op-poll-1', recordId: 'rec-poll-1', newVersion: 1 }], rejected: [] },
        }),
      })
      // GET /sync/updates
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ records: [], deletedRecordIds: [] }),
      });

    globalThis.fetch = fetchMock;

    const syncPromise = sdk.sync();
    await vi.runAllTimersAsync();
    const result = await syncPromise;

    expect(result.applied).toBe(1);
    // Should have polled 3 times (queued, active, completed) + 1 POST + 1 updates = 5 total
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it('uses auth token when polling job status endpoint', async () => {
    const sdk = makeSdk(); // makeSdk sets token: 'test-token'
    const op = makePendingOp();

    vi.mocked(getPendingOperations).mockResolvedValue([op]);
    vi.mocked(markOperationApplied).mockResolvedValue(undefined);
    vi.mocked(getMetadata).mockResolvedValue(undefined);
    vi.mocked(upsertRecord).mockResolvedValue(undefined);
    vi.mocked(setMetadata).mockResolvedValue(undefined);

    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 202,
        json: async () => ({ jobId: 'job-auth', status: 'queued' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          jobId: 'job-auth',
          status: 'completed',
          result: { applied: [{ operationId: 'op-poll-1', recordId: 'rec-poll-1', newVersion: 1 }], rejected: [] },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ records: [], deletedRecordIds: [] }),
      });

    globalThis.fetch = fetchMock;

    const syncPromise = sdk.sync();
    await vi.runAllTimersAsync();
    await syncPromise;

    // The poll call (index 1) should include the Authorization header
    const pollCall = fetchMock.mock.calls[1];
    expect(pollCall[1]?.headers?.['Authorization']).toBe('Bearer test-token');
  });
});

// ---------------------------------------------------------------------------
// Task 10.5 — Periodic Background Sync (Requirements 10.2)
// ---------------------------------------------------------------------------

describe('SyncraSDK — periodic background sync (task 10.5)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function makeOnlineSdk(syncInterval?: number) {
    Object.defineProperty(globalThis, 'navigator', {
      value: { onLine: true },
      writable: true,
      configurable: true,
    });
    Object.defineProperty(globalThis, 'window', {
      value: { addEventListener: vi.fn(), removeEventListener: vi.fn() },
      writable: true,
      configurable: true,
    });

    return new SyncraSDK({
      baseUrl: 'http://localhost:3000',
      apiKey: 'test-token',
      syncInterval,
      networkStateManagerOptions: { checkInterval: 0 },
    });
  }

  it('calls sync() at the configured interval while online (Req 10.2)', async () => {
    vi.mocked(getPendingOperations).mockResolvedValue([]);

    const sdk = makeOnlineSdk(1000);

    // Advance time by 3 intervals
    await vi.advanceTimersByTimeAsync(3000);

    // sync() returns early when no pending ops, but should have been called 3 times
    expect(getPendingOperations).toHaveBeenCalledTimes(3);

    sdk.destroy();
  });

  it('uses 30 seconds as the default interval (Req 10.2)', async () => {
    vi.mocked(getPendingOperations).mockResolvedValue([]);

    const sdk = makeOnlineSdk(); // no syncInterval → default 30000

    await vi.advanceTimersByTimeAsync(30000);
    expect(getPendingOperations).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(30000);
    expect(getPendingOperations).toHaveBeenCalledTimes(2);

    sdk.destroy();
  });

  it('does not start periodic sync when syncInterval is 0 (Req 10.2)', async () => {
    vi.mocked(getPendingOperations).mockResolvedValue([]);

    const sdk = makeOnlineSdk(0);

    await vi.advanceTimersByTimeAsync(60000);

    // No periodic calls — getPendingOperations should not have been called
    expect(getPendingOperations).not.toHaveBeenCalled();

    sdk.destroy();
  });

  it('stops periodic sync when going offline', async () => {
    vi.mocked(getPendingOperations).mockResolvedValue([]);

    const sdk = makeOnlineSdk(1000);

    // Simulate going offline via the network state manager subscription
    // Access the private networkStateManager via type cast
    const nsm = (sdk as any).networkStateManager as NetworkStateManager;
    // Trigger offline by calling the internal setOnline via subscribe
    nsm.subscribe((_online) => { /* no-op */ });

    // Advance 1 interval while online
    await vi.advanceTimersByTimeAsync(1000);
    expect(getPendingOperations).toHaveBeenCalledTimes(1);

    // Simulate offline event
    (sdk as any).isOnline = false;
    (sdk as any).stopPeriodicSync();

    // Advance more time — no more calls expected
    await vi.advanceTimersByTimeAsync(3000);
    expect(getPendingOperations).toHaveBeenCalledTimes(1);

    sdk.destroy();
  });

  it('destroy() clears the periodic sync interval', async () => {
    vi.mocked(getPendingOperations).mockResolvedValue([]);

    const sdk = makeOnlineSdk(1000);

    await vi.advanceTimersByTimeAsync(1000);
    expect(getPendingOperations).toHaveBeenCalledTimes(1);

    sdk.destroy();

    await vi.advanceTimersByTimeAsync(5000);
    // No additional calls after destroy
    expect(getPendingOperations).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Event Emitter — Requirement 11.2
// ---------------------------------------------------------------------------

describe('SyncraSDK event emitter (Req 11.2)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(upsertRecord).mockResolvedValue(undefined);
    vi.mocked(deleteRecord).mockResolvedValue(undefined);
    vi.mocked(markOperationApplied).mockResolvedValue(undefined);
    vi.mocked(getMetadata).mockResolvedValue(new Date(0).toISOString());
    vi.mocked(setMetadata).mockResolvedValue(undefined);
  });

  it('emits sync-start before sending operations (Req 11.2.1)', async () => {
    const op = {
      id: 'op-1', type: 'create' as const, recordId: 'rec-1',
      payload: {}, version: 1, idempotencyKey: 'key-1',
      status: 'pending' as const, retries: 0, maxRetries: 5, createdAt: new Date(),
    };
    vi.mocked(getPendingOperations).mockResolvedValue([op]);

    const sdk = makeSdk();
    const events: string[] = [];
    sdk.on('sync-start', () => events.push('sync-start'));

    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true, status: 200,
        json: async () => ({ applied: [{ operationId: 'op-1', recordId: 'rec-1', newVersion: 2, data: {} }], rejected: [] }),
      })
      .mockResolvedValueOnce({
        ok: true, status: 200,
        json: async () => ({ records: [], deletedRecordIds: [] }),
      });

    await sdk.sync();

    expect(events).toContain('sync-start');
  });

  it('emits sync-complete with applied/rejected counts (Req 11.2.2)', async () => {
    const op = {
      id: 'op-2', type: 'create' as const, recordId: 'rec-2',
      payload: {}, version: 1, idempotencyKey: 'key-2',
      status: 'pending' as const, retries: 0, maxRetries: 5, createdAt: new Date(),
    };
    vi.mocked(getPendingOperations).mockResolvedValue([op]);

    const sdk = makeSdk();
    const completeEvents: { applied: number; rejected: number }[] = [];
    sdk.on('sync-complete', (data) => completeEvents.push(data));

    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true, status: 200,
        json: async () => ({ applied: [{ operationId: 'op-2', recordId: 'rec-2', newVersion: 1, data: {} }], rejected: [] }),
      })
      .mockResolvedValueOnce({
        ok: true, status: 200,
        json: async () => ({ records: [], deletedRecordIds: [] }),
      });

    await sdk.sync();

    expect(completeEvents).toHaveLength(1);
    expect(completeEvents[0]).toEqual({ applied: 1, rejected: 0 });
  });

  it('emits sync-failed with error details on network failure (Req 11.2.3)', async () => {
    const op = {
      id: 'op-3', type: 'create' as const, recordId: 'rec-3',
      payload: {}, version: 1, idempotencyKey: 'key-3',
      status: 'pending' as const, retries: 0, maxRetries: 5, createdAt: new Date(),
    };
    vi.mocked(getPendingOperations).mockResolvedValue([op]);
    const { updateOperation } = await import('./db/queue-store');
    vi.mocked(updateOperation).mockResolvedValue(undefined);

    const sdk = makeSdk();
    const failedEvents: { error: Error }[] = [];
    sdk.on('sync-failed', (e) => failedEvents.push(e));

    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

    await expect(sdk.sync()).rejects.toThrow('Network error');

    expect(failedEvents.length).toBeGreaterThanOrEqual(1);
    expect(failedEvents[0].error).toBeInstanceOf(Error);
  });

  it('emits online/offline events on connectivity changes (Req 11.2)', () => {
    const sdk = makeSdk();
    const events: string[] = [];
    sdk.on('online', () => events.push('online'));
    sdk.on('offline', () => events.push('offline'));

    vi.mocked(getPendingOperations).mockResolvedValue([]);

    // Trigger via the internal network state manager subscription
    const nsm = (sdk as any).networkStateManager;
    // Directly invoke the subscriber that SyncraSDK registered
    nsm['listeners'].forEach((listener: (online: boolean) => void) => listener(false));
    nsm['listeners'].forEach((listener: (online: boolean) => void) => listener(true));

    expect(events).toContain('offline');
    expect(events).toContain('online');

    sdk.destroy();
  });

  it('off() removes a listener so it no longer receives events (Req 11.2)', async () => {
    const op = {
      id: 'op-4', type: 'create' as const, recordId: 'rec-4',
      payload: {}, version: 1, idempotencyKey: 'key-4',
      status: 'pending' as const, retries: 0, maxRetries: 5, createdAt: new Date(),
    };
    vi.mocked(getPendingOperations).mockResolvedValue([op]);

    const sdk = makeSdk();
    let callCount = 0;
    const listener = () => { callCount++; };
    sdk.on('sync-start', listener);
    sdk.off('sync-start', listener);

    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true, status: 200,
        json: async () => ({ applied: [{ operationId: 'op-4', recordId: 'rec-4', newVersion: 1, data: {} }], rejected: [] }),
      })
      .mockResolvedValueOnce({
        ok: true, status: 200,
        json: async () => ({ records: [], deletedRecordIds: [] }),
      });

    await sdk.sync();

    expect(callCount).toBe(0);
  });
});
