/**
 * Property-based tests for the Syncra SDK.
 * Properties 11-16, 21, 23-26, 28-30, 32-33
 */
import { describe, it, vi, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';

// ---------------------------------------------------------------------------
// Mock IndexedDB modules so tests run in Node (no real browser storage)
// ---------------------------------------------------------------------------
vi.mock('./db/records-store', () => ({
  getRecord: vi.fn(),
  upsertRecord: vi.fn(),
  deleteRecord: vi.fn(),
  getAllRecords: vi.fn(),
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

vi.mock('./db/database', () => ({
  getDb: vi.fn().mockResolvedValue({
    getAll: vi.fn().mockResolvedValue([]),
    put: vi.fn().mockResolvedValue(undefined),
    get: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
  }),
}));

import { upsertRecord, deleteRecord, getRecord } from './db/records-store';
import { getPendingOperations, enqueueOperation, markOperationApplied, removeOperation, updateOperation } from './db/queue-store';
import { getMetadata, setMetadata } from './db/metadata-store';
import { SyncraSDK } from './syncra-sdk';
import { calculateRetryDelay } from './retry';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setupBrowserEnv(onLine: boolean) {
  Object.defineProperty(globalThis, 'navigator', {
    value: { onLine },
    writable: true,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'window', {
    value: { addEventListener: vi.fn(), removeEventListener: vi.fn() },
    writable: true,
    configurable: true,
  });
}

function makeOfflineSdk() {
  setupBrowserEnv(false);
  return new SyncraSDK({
    baseUrl: 'http://localhost:3000',
    token: 'test-token',
    syncInterval: 0,
    networkStateManagerOptions: { checkInterval: 0 },
  });
}

function makeOnlineSdk() {
  setupBrowserEnv(true);
  return new SyncraSDK({
    baseUrl: 'http://localhost:3000',
    token: 'test-token',
    syncInterval: 0,
    networkStateManagerOptions: { checkInterval: 0 },
  });
}

// Arbitrary for record data payloads
const dataArb = fc.dictionary(
  fc.string({ minLength: 1, maxLength: 15 }),
  fc.oneof(fc.string({ maxLength: 50 }), fc.integer({ min: 0, max: 9999 }), fc.boolean()),
);

// ---------------------------------------------------------------------------
// Property 11: Offline Create Persists Locally
// Validates: Requirements 5.2
// ---------------------------------------------------------------------------

describe('Feature: syncra-offline-sync-engine, Property 11: Offline Create Persists Locally', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('should persist the record to local DB when createRecord() is called while offline', async () => {
    await fc.assert(
      fc.asyncProperty(dataArb, async (data) => {
        vi.mocked(upsertRecord).mockResolvedValue(undefined);
        vi.mocked(enqueueOperation).mockResolvedValue(undefined);

        const sdk = makeOfflineSdk();
        const record = await sdk.createRecord(data);

        // upsertRecord must have been called with the new record
        const calls = vi.mocked(upsertRecord).mock.calls;
        const persisted = calls.find((c) => c[0].id === record.id);
        return persisted !== undefined && persisted[0].version === 1;
      }),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 12: Offline Create Enqueues Operation
// Validates: Requirements 5.3
// ---------------------------------------------------------------------------

describe('Feature: syncra-offline-sync-engine, Property 12: Offline Create Enqueues Operation', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('should enqueue a create operation with status pending when createRecord() is called while offline', async () => {
    await fc.assert(
      fc.asyncProperty(dataArb, async (data) => {
        vi.mocked(upsertRecord).mockResolvedValue(undefined);
        vi.mocked(enqueueOperation).mockResolvedValue(undefined);

        const sdk = makeOfflineSdk();
        const record = await sdk.createRecord(data);

        const calls = vi.mocked(enqueueOperation).mock.calls;
        const queued = calls.find(
          (c) => c[0].type === 'create' && c[0].recordId === record.id && c[0].status === 'pending',
        );
        return queued !== undefined;
      }),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 13: Offline Update Increments Version
// Validates: Requirements 5.4
// ---------------------------------------------------------------------------

describe('Feature: syncra-offline-sync-engine, Property 13: Offline Update Increments Version', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('should increment the local record version by 1 when updateRecord() is called while offline', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        dataArb,
        fc.integer({ min: 1, max: 100 }),
        async (id, data, currentVersion) => {
          const existingRecord = {
            id,
            data: { old: 'data' },
            version: currentVersion,
            updated_at: '2024-01-01T00:00:00Z',
            created_at: '2024-01-01T00:00:00Z',
          };
          vi.mocked(getRecord).mockResolvedValue(existingRecord);
          vi.mocked(upsertRecord).mockResolvedValue(undefined);
          vi.mocked(enqueueOperation).mockResolvedValue(undefined);

          const sdk = makeOfflineSdk();
          const updated = await sdk.updateRecord(id, data);

          return updated.version === currentVersion + 1;
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 14: Offline Delete Marks Record
// Validates: Requirements 5.5
// ---------------------------------------------------------------------------

describe('Feature: syncra-offline-sync-engine, Property 14: Offline Delete Marks Record', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('should call deleteRecord on the local DB when deleteRecord() is called while offline', async () => {
    await fc.assert(
      fc.asyncProperty(fc.uuid(), async (id) => {
        const existingRecord = {
          id,
          data: {},
          version: 1,
          updated_at: '2024-01-01T00:00:00Z',
          created_at: '2024-01-01T00:00:00Z',
        };
        vi.mocked(getRecord).mockResolvedValue(existingRecord);
        vi.mocked(deleteRecord).mockResolvedValue(undefined);
        vi.mocked(enqueueOperation).mockResolvedValue(undefined);

        const sdk = makeOfflineSdk();
        await sdk.deleteRecord(id);

        const deleteCalls = vi.mocked(deleteRecord).mock.calls;
        return deleteCalls.some((c) => c[0] === id);
      }),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 15: Queue Persistence Across Restarts
// Validates: Requirements 5.6
// ---------------------------------------------------------------------------

describe('Feature: syncra-offline-sync-engine, Property 15: Queue Persistence Across Restarts', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('should load pending operations from IndexedDB on initialize()', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            id: fc.uuid(),
            type: fc.constantFrom('create' as const, 'update' as const, 'delete' as const),
            recordId: fc.uuid(),
            payload: dataArb,
            version: fc.integer({ min: 1, max: 100 }),
            idempotencyKey: fc.uuid(),
            status: fc.constant('pending' as const),
            retries: fc.constant(0),
            maxRetries: fc.constant(5),
            createdAt: fc.constant(new Date()),
          }),
          { minLength: 0, maxLength: 5 },
        ),
        async (pendingOps) => {
          vi.mocked(getPendingOperations).mockResolvedValue(pendingOps);
          const { getDb } = await import('./db/database');
          vi.mocked(getDb).mockResolvedValue({
            getAll: vi.fn().mockResolvedValue([]),
            put: vi.fn().mockResolvedValue(undefined),
            get: vi.fn().mockResolvedValue(undefined),
            delete: vi.fn().mockResolvedValue(undefined),
          } as any);

          const sdk = makeOfflineSdk();
          await sdk.initialize();

          const loaded = sdk.getPendingOperations();
          return loaded.length === pendingOps.length;
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 16: Sync Sends Pending Operations
// Validates: Requirements 6.1
// ---------------------------------------------------------------------------

describe('Feature: syncra-offline-sync-engine, Property 16: Sync Sends Pending Operations', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('should POST pending operations to /sync when sync() is called while online', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            id: fc.uuid(),
            type: fc.constantFrom('create' as const, 'update' as const, 'delete' as const),
            recordId: fc.uuid(),
            payload: dataArb,
            version: fc.integer({ min: 1, max: 100 }),
            idempotencyKey: fc.uuid(),
            status: fc.constant('pending' as const),
            retries: fc.constant(0),
            maxRetries: fc.constant(5),
            createdAt: fc.constant(new Date()),
          }),
          { minLength: 1, maxLength: 5 },
        ),
        async (pendingOps) => {
          vi.mocked(getPendingOperations).mockResolvedValue(pendingOps);
          vi.mocked(markOperationApplied).mockResolvedValue(undefined);
          vi.mocked(getMetadata).mockResolvedValue(undefined);
          vi.mocked(upsertRecord).mockResolvedValue(undefined);
          vi.mocked(setMetadata).mockResolvedValue(undefined);

          const fetchMock = vi.fn()
            .mockResolvedValueOnce({
              ok: true,
              status: 200,
              json: async () => ({
                applied: pendingOps.map((op) => ({ operationId: op.id, recordId: op.recordId, newVersion: 1 })),
                rejected: [],
              }),
            })
            .mockResolvedValueOnce({
              ok: true,
              status: 200,
              json: async () => ({ records: [], deletedRecordIds: [] }),
            });
          globalThis.fetch = fetchMock;

          const sdk = makeOnlineSdk();
          await sdk.sync();

          // Verify POST /sync was called with all pending operations
          const postCall = fetchMock.mock.calls[0];
          const body = JSON.parse(postCall[1].body);
          return (
            postCall[0].includes('/sync') &&
            body.operations.length === pendingOps.length
          );
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 21: Pulled Records Merged Locally
// Validates: Requirements 7.2
// ---------------------------------------------------------------------------

describe('Feature: syncra-offline-sync-engine, Property 21: Pulled Records Merged Locally', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('should upsert all records returned from GET /sync/updates into local DB', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            id: fc.uuid(),
            data: dataArb,
            version: fc.integer({ min: 1, max: 100 }),
            updated_at: fc.constant('2024-06-01T00:00:00Z'),
            created_at: fc.constant('2024-01-01T00:00:00Z'),
          }),
          { minLength: 1, maxLength: 5 },
        ),
        async (serverRecords) => {
          const pendingOp = {
            id: 'op-pull-test',
            type: 'create' as const,
            recordId: 'rec-pull-test',
            payload: {},
            version: 1,
            idempotencyKey: 'ik-pull-test',
            status: 'pending' as const,
            retries: 0,
            maxRetries: 5,
            createdAt: new Date(),
          };
          vi.mocked(getPendingOperations).mockResolvedValue([pendingOp]);
          vi.mocked(markOperationApplied).mockResolvedValue(undefined);
          vi.mocked(getMetadata).mockResolvedValue(undefined);
          vi.mocked(upsertRecord).mockResolvedValue(undefined);
          vi.mocked(setMetadata).mockResolvedValue(undefined);

          globalThis.fetch = vi.fn()
            .mockResolvedValueOnce({
              ok: true,
              status: 200,
              json: async () => ({
                applied: [{ operationId: 'op-pull-test', recordId: 'rec-pull-test', newVersion: 1 }],
                rejected: [],
              }),
            })
            .mockResolvedValueOnce({
              ok: true,
              status: 200,
              json: async () => ({ records: serverRecords, deletedRecordIds: [] }),
            });

          const sdk = makeOnlineSdk();
          await sdk.sync();

          const upsertCalls = vi.mocked(upsertRecord).mock.calls;
          // All server records should have been upserted
          return serverRecords.every((r) => upsertCalls.some((c) => c[0].id === r.id));
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 23: Last-Write-Wins Default Resolution
// Validates: Requirements 8.2
// ---------------------------------------------------------------------------

describe('Feature: syncra-offline-sync-engine, Property 23: Last-Write-Wins Default Resolution', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('should overwrite local record with serverData when no conflict handler is registered', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        dataArb,
        fc.integer({ min: 2, max: 100 }),
        async (recordId, serverData, serverVersion) => {
          const pendingOp = {
            id: 'op-lww',
            type: 'update' as const,
            recordId,
            payload: { old: 'data' },
            version: serverVersion - 1,
            idempotencyKey: 'ik-lww',
            status: 'pending' as const,
            retries: 0,
            maxRetries: 5,
            createdAt: new Date(),
          };
          vi.mocked(getPendingOperations).mockResolvedValue([pendingOp]);
          vi.mocked(getMetadata).mockResolvedValue(undefined);
          vi.mocked(getRecord).mockResolvedValue({
            id: recordId,
            data: { old: 'data' },
            version: serverVersion - 1,
            updated_at: '2024-01-01T00:00:00Z',
            created_at: '2024-01-01T00:00:00Z',
          });
          vi.mocked(upsertRecord).mockResolvedValue(undefined);
          vi.mocked(removeOperation).mockResolvedValue(undefined);
          vi.mocked(setMetadata).mockResolvedValue(undefined);

          globalThis.fetch = vi.fn()
            .mockResolvedValueOnce({
              ok: true,
              status: 200,
              json: async () => ({
                applied: [],
                rejected: [{
                  operationId: 'op-lww',
                  recordId,
                  reason: 'version_conflict',
                  clientVersion: serverVersion - 1,
                  serverVersion,
                  serverData,
                }],
              }),
            })
            .mockResolvedValueOnce({
              ok: true,
              status: 200,
              json: async () => ({ records: [], deletedRecordIds: [] }),
            });

          const sdk = makeOnlineSdk();
          await sdk.sync();

          const upsertCalls = vi.mocked(upsertRecord).mock.calls;
          return upsertCalls.some(
            (c) => c[0].id === recordId && c[0].version === serverVersion && JSON.stringify(c[0].data) === JSON.stringify(serverData),
          );
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 24: Custom Conflict Handler Invocation
// Validates: Requirements 8.3
// ---------------------------------------------------------------------------

describe('Feature: syncra-offline-sync-engine, Property 24: Custom Conflict Handler Invocation', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('should invoke the custom conflict handler with the conflict object when registered', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        dataArb,
        fc.integer({ min: 2, max: 100 }),
        async (recordId, serverData, serverVersion) => {
          const pendingOp = {
            id: 'op-custom',
            type: 'update' as const,
            recordId,
            payload: { old: 'data' },
            version: serverVersion - 1,
            idempotencyKey: 'ik-custom',
            status: 'pending' as const,
            retries: 0,
            maxRetries: 5,
            createdAt: new Date(),
          };
          vi.mocked(getPendingOperations).mockResolvedValue([pendingOp]);
          vi.mocked(getMetadata).mockResolvedValue(undefined);
          vi.mocked(getRecord).mockResolvedValue({
            id: recordId,
            data: { old: 'data' },
            version: serverVersion - 1,
            updated_at: '2024-01-01T00:00:00Z',
            created_at: '2024-01-01T00:00:00Z',
          });
          vi.mocked(upsertRecord).mockResolvedValue(undefined);
          vi.mocked(enqueueOperation).mockResolvedValue(undefined);
          vi.mocked(setMetadata).mockResolvedValue(undefined);

          globalThis.fetch = vi.fn()
            .mockResolvedValueOnce({
              ok: true,
              status: 200,
              json: async () => ({
                applied: [],
                rejected: [{
                  operationId: 'op-custom',
                  recordId,
                  reason: 'version_conflict',
                  clientVersion: serverVersion - 1,
                  serverVersion,
                  serverData,
                }],
              }),
            })
            .mockResolvedValueOnce({
              ok: true,
              status: 200,
              json: async () => ({ records: [], deletedRecordIds: [] }),
            });

          const sdk = makeOnlineSdk();
          let handlerCalled = false;
          sdk.onConflict((conflict) => {
            handlerCalled = conflict.recordId === recordId;
            return { data: { merged: true }, version: serverVersion };
          });
          await sdk.sync();

          return handlerCalled;
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 25: Exponential Backoff Retry Delays
// Validates: Requirements 9.1
// ---------------------------------------------------------------------------

describe('Feature: syncra-offline-sync-engine, Property 25: Exponential Backoff Retry Delays', () => {
  it('should compute delay = base * (2^n) for retry attempt n', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10 }),
        fc.integer({ min: 100, max: 5000 }),
        (retries, base) => {
          const delay = calculateRetryDelay(retries, base);
          return delay === base * Math.pow(2, retries);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 26: Max Retries Enforcement
// Validates: Requirements 9.2
// ---------------------------------------------------------------------------

describe('Feature: syncra-offline-sync-engine, Property 26: Max Retries Enforcement', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('should mark operation as failed and emit sync-failed when retries reaches maxRetries', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 10 }),
        async (maxRetries) => {
          const op = {
            id: 'op-maxretry',
            type: 'create' as const,
            recordId: 'rec-maxretry',
            payload: {},
            version: 1,
            idempotencyKey: 'ik-maxretry',
            status: 'pending' as const,
            retries: maxRetries - 1, // one more failure will hit max
            maxRetries,
            createdAt: new Date(),
          };
          vi.mocked(getPendingOperations).mockResolvedValue([op]);
          vi.mocked(updateOperation).mockResolvedValue(undefined);

          globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

          const sdk = makeOnlineSdk();
          const failedEvents: unknown[] = [];
          sdk.on('sync-failed', (e) => failedEvents.push(e));

          try { await sdk.sync(); } catch { /* expected */ }

          const updateCalls = vi.mocked(updateOperation).mock.calls;
          const markedFailed = updateCalls.some(
            (c) => c[0] === 'op-maxretry' && (c[1] as any).status === 'failed',
          );
          return markedFailed && failedEvents.length >= 1;
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 28: Online/Offline Detection
// Validates: Requirements 10.1
// ---------------------------------------------------------------------------

describe('Feature: syncra-offline-sync-engine, Property 28: Online/Offline Detection', () => {
  it('should reflect the correct isOnline state based on navigator.onLine', () => {
    fc.assert(
      fc.property(fc.boolean(), (onLine) => {
        setupBrowserEnv(onLine);
        const sdk = new SyncraSDK({
          syncInterval: 0,
          networkStateManagerOptions: { checkInterval: 0 },
        });
        const result = sdk.isOnlineState() === onLine;
        sdk.destroy();
        return result;
      }),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 29: Auto-Sync on Online
// Validates: Requirements 10.2
// ---------------------------------------------------------------------------

describe('Feature: syncra-offline-sync-engine, Property 29: Auto-Sync on Online', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('should call sync() automatically when transitioning from offline to online', () => {
    fc.assert(
      fc.property(fc.boolean(), (_unused) => {
        vi.mocked(getPendingOperations).mockResolvedValue([]);

        // Start offline
        setupBrowserEnv(false);
        const sdk = new SyncraSDK({
          syncInterval: 0,
          networkStateManagerOptions: { checkInterval: 0 },
        });

        // Simulate going online via the network state manager
        const nsm = (sdk as any).networkStateManager;
        let syncCalled = false;
        const origSync = sdk.sync.bind(sdk);
        sdk.sync = async () => { syncCalled = true; return origSync(); };

        // Trigger online transition
        nsm['listeners'].forEach((listener: (online: boolean) => void) => listener(true));

        sdk.destroy();
        return syncCalled;
      }),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 30: Periodic Sync Execution
// Validates: Requirements 10.3
// ---------------------------------------------------------------------------

describe('Feature: syncra-offline-sync-engine, Property 30: Periodic Sync Execution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should invoke sync() at least once within the configured interval while online', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 100, max: 5000 }),
        async (interval) => {
          vi.mocked(getPendingOperations).mockResolvedValue([]);

          setupBrowserEnv(true);
          const sdk = new SyncraSDK({
            syncInterval: interval,
            networkStateManagerOptions: { checkInterval: 0 },
          });

          await vi.advanceTimersByTimeAsync(interval);

          const callCount = vi.mocked(getPendingOperations).mock.calls.length;
          sdk.destroy();
          return callCount >= 1;
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 32: Sync-Start Event Emission
// Validates: Requirements 11.2
// ---------------------------------------------------------------------------

describe('Feature: syncra-offline-sync-engine, Property 32: Sync-Start Event Emission', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('should emit sync-start before any network operations when sync() is called', async () => {
    await fc.assert(
      fc.asyncProperty(dataArb, async (payload) => {
        const pendingOp = {
          id: 'op-start',
          type: 'create' as const,
          recordId: 'rec-start',
          payload,
          version: 1,
          idempotencyKey: 'ik-start',
          status: 'pending' as const,
          retries: 0,
          maxRetries: 5,
          createdAt: new Date(),
        };
        vi.mocked(getPendingOperations).mockResolvedValue([pendingOp]);
        vi.mocked(markOperationApplied).mockResolvedValue(undefined);
        vi.mocked(getMetadata).mockResolvedValue(undefined);
        vi.mocked(upsertRecord).mockResolvedValue(undefined);
        vi.mocked(setMetadata).mockResolvedValue(undefined);

        const events: string[] = [];
        let fetchCalledBeforeStart = false;

        globalThis.fetch = vi.fn().mockImplementation(async () => {
          if (!events.includes('sync-start')) {
            fetchCalledBeforeStart = true;
          }
          return {
            ok: true,
            status: 200,
            json: async () => ({
              applied: [{ operationId: 'op-start', recordId: 'rec-start', newVersion: 1 }],
              rejected: [],
            }),
          };
        });

        // Second fetch for delta pull
        let callCount = 0;
        globalThis.fetch = vi.fn().mockImplementation(async (..._args: any[]) => {
          callCount++;
          if (callCount === 1) {
            if (!events.includes('sync-start')) fetchCalledBeforeStart = true;
            return { ok: true, status: 200, json: async () => ({ applied: [{ operationId: 'op-start', recordId: 'rec-start', newVersion: 1 }], rejected: [] }) };
          }
          return { ok: true, status: 200, json: async () => ({ records: [], deletedRecordIds: [] }) };
        });

        const sdk = makeOnlineSdk();
        sdk.on('sync-start', () => events.push('sync-start'));
        await sdk.sync();

        return events.includes('sync-start') && !fetchCalledBeforeStart;
      }),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 33: Sync-Complete Event Emission
// Validates: Requirements 11.3
// ---------------------------------------------------------------------------

describe('Feature: syncra-offline-sync-engine, Property 33: Sync-Complete Event Emission', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('should emit sync-complete with applied/rejected counts after a successful sync()', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 5 }),
        fc.integer({ min: 0, max: 3 }),
        async (appliedCount, rejectedCount) => {
          const pendingOps = Array.from({ length: appliedCount + rejectedCount }, (_, i) => ({
            id: `op-${i}`,
            type: 'create' as const,
            recordId: `rec-${i}`,
            payload: {},
            version: 1,
            idempotencyKey: `ik-${i}`,
            status: 'pending' as const,
            retries: 0,
            maxRetries: 5,
            createdAt: new Date(),
          }));

          vi.mocked(getPendingOperations).mockResolvedValue(pendingOps);
          vi.mocked(markOperationApplied).mockResolvedValue(undefined);
          vi.mocked(getMetadata).mockResolvedValue(undefined);
          vi.mocked(upsertRecord).mockResolvedValue(undefined);
          vi.mocked(removeOperation).mockResolvedValue(undefined);
          vi.mocked(getRecord).mockResolvedValue({
            id: 'rec-0',
            data: {},
            version: 1,
            updated_at: '2024-01-01T00:00:00Z',
            created_at: '2024-01-01T00:00:00Z',
          });
          vi.mocked(setMetadata).mockResolvedValue(undefined);

          const applied = pendingOps.slice(0, appliedCount).map((op) => ({
            operationId: op.id,
            recordId: op.recordId,
            newVersion: 1,
          }));
          const rejected = pendingOps.slice(appliedCount).map((op) => ({
            operationId: op.id,
            recordId: op.recordId,
            reason: 'version_conflict',
            clientVersion: 1,
            serverVersion: 2,
            serverData: {},
          }));

          globalThis.fetch = vi.fn()
            .mockResolvedValueOnce({
              ok: true,
              status: 200,
              json: async () => ({ applied, rejected }),
            })
            .mockResolvedValueOnce({
              ok: true,
              status: 200,
              json: async () => ({ records: [], deletedRecordIds: [] }),
            });

          const sdk = makeOnlineSdk();
          const completeEvents: { applied: number; rejected: number }[] = [];
          sdk.on('sync-complete', (e) => completeEvents.push(e));
          await sdk.sync();

          return (
            completeEvents.length === 1 &&
            completeEvents[0].applied === appliedCount &&
            completeEvents[0].rejected === rejectedCount
          );
        },
      ),
      { numRuns: 100 },
    );
  });
});
