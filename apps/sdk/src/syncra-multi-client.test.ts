/**
 * Phase 6 — Multi-Client Test Suite.
 *
 * Integration tests that run two SDK instances concurrently against the same
 * server. The server contract is simulated by an in-memory MockServer that
 * faithfully mirrors SyncService (monotonic cursor, version-checked conflict
 * detection, tombstones, idempotency), so tests run deterministically in Node
 * without external Postgres/Redis infrastructure.
 *
 * Required scenarios from the roadmap:
 *   1. Two clients create different records → both converge.
 *   2. Two clients update the same record → conflict detected & resolved.
 *   3. Client A deletes a record Client B updated → delete vs update conflict.
 *   4. Client offline for N operations → reconnects and converges.
 *   5. Idempotency across clients.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SyncraSDK } from './syncra-sdk';

// ---------------------------------------------------------------------------
// Per-client in-memory local store (isolated IndexedDB stand-in)
// ---------------------------------------------------------------------------

interface LocalDb {
  records: Map<string, any>;
  operations: Map<string, any>;
  metadata: Map<string, string>;
}

function createLocalDb(): LocalDb {
  return { records: new Map(), operations: new Map(), metadata: new Map() };
}

// Hoisted holder so the mocked store factories can route calls to whichever
// client is currently active, and expose the store mocks to the fixtures.
const storeState = vi.hoisted(() => {
  let active: LocalDb | null = null;
  const dbs: LocalDb[] = [];
  return {
    setActive(db: LocalDb) {
      active = db;
      if (!dbs.includes(db)) dbs.push(db);
    },
    getActive(): LocalDb {
      if (!active) {
        active = createLocalDb();
        dbs.push(active);
      }
      return active;
    },
    dbs,
  };
});

// ---------------------------------------------------------------------------
// Mock the IndexedDB-backed store modules so tests run in pure Node.
// Each SDK instance routes to its own isolated local store via storeState.
// ---------------------------------------------------------------------------

vi.mock('./db/records-store', () => ({
  getRecord: vi.fn(async (id: string) => storeState.getActive().records.get(id) ?? null),
  upsertRecord: vi.fn(async (rec: any) => {
    storeState.getActive().records.set(rec.id, rec);
  }),
  deleteRecord: vi.fn(async (id: string) => {
    storeState.getActive().records.delete(id);
  }),
  getAllRecords: vi.fn(async () => Array.from(storeState.getActive().records.values())),
}));

vi.mock('./db/queue-store', () => ({
  getPendingOperations: vi.fn(async () =>
    Array.from(storeState.getActive().operations.values()).filter(
      o =>
        o.status === 'pending' &&
        (!o.nextRetryAt || new Date(o.nextRetryAt).getTime() <= Date.now())
    )
  ),
  enqueueOperation: vi.fn(async (op: any) => {
    storeState.getActive().operations.set(op.id, op);
  }),
  markOperationApplied: vi.fn(async (operationId: string) => {
    const op = storeState.getActive().operations.get(operationId);
    if (op) op.status = 'applied';
  }),
  removeOperation: vi.fn(async (operationId: string) => {
    storeState.getActive().operations.delete(operationId);
  }),
  updateOperationStatus: vi.fn(async (operationId: string, status: string) => {
    const op = storeState.getActive().operations.get(operationId);
    if (op) op.status = status;
  }),
  updateOperation: vi.fn(async (operationId: string, patch: any) => {
    const op = storeState.getActive().operations.get(operationId);
    if (op) Object.assign(op, patch);
  }),
}));

vi.mock('./db/metadata-store', () => ({
  getMetadata: vi.fn(async (key: string) => storeState.getActive().metadata.get(key) ?? null),
  setMetadata: vi.fn(async (key: string, value: string) => {
    storeState.getActive().metadata.set(key, value);
  }),
}));

vi.mock('./db/database', () => ({
  getDb: vi.fn(async () => ({
    getAll: async (): Promise<any[]> => Array.from(storeState.getActive().records.values()),
    put: async () => undefined,
    get: async () => undefined,
    delete: async () => undefined,
  })),
}));

vi.mock('./db/schema', () => ({
  STORE_NAMES: { RECORDS: 'records', OPERATIONS: 'operations', METADATA: 'metadata' },
}));

// ---------------------------------------------------------------------------
// In-memory server that replicates the Syncra backend contract
// ---------------------------------------------------------------------------

interface ServerRecord {
  id: string;
  data: Record<string, any>;
  version: number;
  cursor: number;
  collection: string;
}

type ServerOpType = 'create' | 'update' | 'delete';

interface ServerOp {
  id: string;
  type: ServerOpType;
  recordId: string;
  payload: Record<string, any>;
  version: number;
  idempotencyKey: string;
  collection?: string;
}

interface AppliedOp {
  operationId: string;
  recordId: string;
  newVersion?: number;
  data?: Record<string, any>;
}

interface RejectedOp {
  operationId: string;
  recordId: string;
  reason: string;
  clientVersion: number;
  serverVersion: number;
  serverData: Record<string, any>;
}

class VersionConflict extends Error {
  constructor(public readonly conflict: RejectedOp) {
    super('version_conflict');
    this.name = 'VersionConflict';
  }
}

class MockServer {
  private cursorSeq = 0;
  private records = new Map<string, Map<string, ServerRecord>>();
  private tombstones = new Map<string, Map<string, number>>();
  private versions = new Map<string, Map<string, number>>();
  private appliedOps = new Map<
    string,
    Map<string, { recordId: string; payload: Record<string, any> }>
  >();

  private nextCursor(): number {
    return ++this.cursorSeq;
  }

  private mapFor(userId: string): Map<string, ServerRecord> {
    if (!this.records.has(userId)) {
      this.records.set(userId, new Map());
    }
    return this.records.get(userId)!;
  }

  /** Process a batch of operations — mirrors SyncService.processOperations. */
  push(userId: string, operations: ServerOp[]): { applied: AppliedOp[]; rejected: RejectedOp[] } {
    const applied: AppliedOp[] = [];
    const rejected: RejectedOp[] = [];

    for (const op of operations) {
      const cached = this.checkIdempotency(userId, op.idempotencyKey);
      if (cached) {
        applied.push(cached);
        continue;
      }
      try {
        applied.push(this.apply(userId, op));
      } catch (err) {
        if (err instanceof VersionConflict) {
          rejected.push(err.conflict);
        } else {
          throw err;
        }
      }
    }

    return { applied, rejected };
  }

  private apply(userId: string, op: ServerOp): AppliedOp {
    const collection = op.collection ?? 'default';

    if (op.type === 'update' || op.type === 'delete') {
      const serverVersion = this.versions.get(userId)?.get(op.recordId);
      if (serverVersion !== undefined && op.version !== serverVersion) {
        const rec = this.mapFor(userId).get(op.recordId);
        throw new VersionConflict({
          operationId: op.id,
          recordId: op.recordId,
          reason: 'version_conflict',
          clientVersion: op.version,
          serverVersion,
          serverData: rec ? rec.data : {},
        });
      }
    }

    let newVersion: number;

    if (op.type === 'create') {
      const rec = this.mapFor(userId).get(op.recordId);
      if (rec) {
        // Upsert semantics like ON CONFLICT DO UPDATE
        newVersion = rec.version + 1;
        rec.version = newVersion;
        rec.data = op.payload;
        rec.cursor = this.nextCursor();
        rec.collection = collection;
      } else {
        newVersion = 1;
        this.mapFor(userId).set(op.recordId, {
          id: op.recordId,
          data: op.payload,
          version: 1,
          cursor: this.nextCursor(),
          collection,
        });
      }
      this.setVersion(userId, op.recordId, newVersion);
    } else if (op.type === 'update') {
      const existing = this.mapFor(userId).get(op.recordId);
      if (existing) {
        newVersion = existing.version + 1;
        existing.version = newVersion;
        existing.data = op.payload;
        existing.cursor = this.nextCursor();
      } else {
        newVersion = 1;
        this.mapFor(userId).set(op.recordId, {
          id: op.recordId,
          data: op.payload,
          version: 1,
          cursor: this.nextCursor(),
          collection,
        });
      }
      this.setVersion(userId, op.recordId, newVersion);
    } else {
      // delete
      const existing = this.mapFor(userId).get(op.recordId);
      newVersion = existing ? existing.version : 0;
      this.mapFor(userId).delete(op.recordId);
      this.versions.get(userId)?.delete(op.recordId);
      if (!this.tombstones.has(userId)) {
        this.tombstones.set(userId, new Map());
      }
      this.tombstones.get(userId)!.set(op.recordId, this.nextCursor());
    }

    if (!this.appliedOps.has(userId)) {
      this.appliedOps.set(userId, new Map());
    }
    this.appliedOps.get(userId)!.set(op.idempotencyKey, {
      recordId: op.recordId,
      payload: op.payload,
    });

    return {
      operationId: op.id,
      recordId: op.recordId,
      newVersion,
      data: op.type !== 'delete' ? op.payload : undefined,
    };
  }

  private setVersion(userId: string, recordId: string, version: number): void {
    if (!this.versions.has(userId)) {
      this.versions.set(userId, new Map());
    }
    this.versions.get(userId)!.set(recordId, version);
  }

  private checkIdempotency(userId: string, idempotencyKey: string): AppliedOp | null {
    const cached = this.appliedOps.get(userId)?.get(idempotencyKey);
    return cached
      ? { operationId: idempotencyKey, recordId: cached.recordId, data: cached.payload }
      : null;
  }

  /** Delta pull — mirrors SyncService.getSyncUpdates. */
  pull(
    userId: string,
    cursor: number,
    collection?: string
  ): {
    records: ServerRecord[];
    deletedRecordIds: string[];
    tombstones: Array<{ recordId: string; cursor: number }>;
  } {
    const records = Array.from(this.mapFor(userId).values())
      .filter(r => r.cursor > cursor)
      .filter(r => !collection || r.collection === collection)
      .sort((a, b) => a.cursor - b.cursor);

    const tombstones = Array.from(this.tombstones.get(userId)?.entries() ?? [])
      .filter(([, c]) => c > cursor)
      .map(([recordId, c]) => ({ recordId, cursor: c }))
      .sort((a, b) => a.cursor - b.cursor);

    return {
      records: records.map(r => ({
        id: r.id,
        data: r.data,
        version: r.version,
        updated_at: new Date().toISOString(),
        created_at: new Date(0).toISOString(),
        cursor: r.cursor,
        collection: r.collection,
      })),
      deletedRecordIds: tombstones.map(t => t.recordId),
      tombstones,
    };
  }
}

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

function setupBrowserGlobals(onLine = true): void {
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

interface ClientScope {
  sdk: SyncraSDK;
  db: LocalDb;
}

interface Fixture {
  server: MockServer;
  makeClient: () => ClientScope;
}

/** Builds a shared server + two isolated SDK clients. */
function makeFixture(): Fixture {
  const server = new MockServer();

  const makeClient = (): ClientScope => {
    setupBrowserGlobals(true);
    const db = createLocalDb();
    storeState.setActive(db);

    const sdk = new SyncraSDK({
      baseUrl: 'http://localhost:3000',
      apiKey: 'test-token',
      syncInterval: 0,
      networkStateManagerOptions: { checkInterval: 0 },
    });

    return { sdk, db };
  };

  // Route fetch so any SDK's network calls hit the shared MockServer.
  globalThis.fetch = vi.fn(async (input: any, init?: RequestInit) => {
    const urlStr = typeof input === 'string' ? input : (input as Request).url;
    const pathname = new URL(urlStr).pathname;
    const method = (init?.method ?? 'GET') as string;

    if (method === 'POST' && pathname === '/sync') {
      const body = JSON.parse(String(init!.body)) as { operations: ServerOp[] };
      const userId = activeUserId();
      const result = server.push(userId, body.operations);
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (method === 'GET' && pathname.startsWith('/sync/updates')) {
      const q = new URL(urlStr).searchParams;
      const cursor = Number(q.get('cursor') ?? '0');
      const collection = q.get('collection') ?? undefined;
      const delta = server.pull(activeUserId(), cursor, collection);
      return new Response(JSON.stringify(delta), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    throw new Error(`Unhandled request in MockServer: ${method} ${pathname}`);
  });

  return { server, makeClient };
}

/** All clients share one user scope in these scenarios. */
function activeUserId(): string {
  return 'user-1';
}

async function activate(client: ClientScope): Promise<void> {
  storeState.setActive(client.db);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  setupBrowserGlobals(true);
});

describe('Phase 6 — Multi-Client Sync', () => {
  it('two clients create different records and both converge', async () => {
    const { makeClient } = makeFixture();
    const a = makeClient();
    const b = makeClient();

    await activate(a);
    await a.sdk.initialize();
    const aRecord = await a.sdk.createRecord({ title: 'A record' });

    await activate(b);
    await b.sdk.initialize();
    const bRecord = await b.sdk.createRecord({ title: 'B record' });

    // Each client pushes its own pending operation, then converge on the
    // complete server state via delta pull on a subsequent sync.
    await activate(a);
    await a.sdk.sync();
    await activate(b);
    await b.sdk.sync();

    // A further sync lets each client discover the other's record now that
    // its cursor has advanced past its own write.
    await activate(a);
    await a.sdk.sync();
    await activate(b);
    await b.sdk.sync();

    const aAll = a.sdk.getRecords();
    const bAll = b.sdk.getRecords();
    expect(aAll.length).toBe(2);
    expect(bAll.length).toBe(2);

    const titlesIn = (records: ReturnType<SyncraSDK['getRecords']>) =>
      records.map(r => r.data.title).sort();
    expect(titlesIn(aAll)).toEqual(['A record', 'B record']);
    expect(titlesIn(bAll)).toEqual(['A record', 'B record']);

    // Ids are preserved end-to-end.
    expect(aAll.some(r => r.id === aRecord.id)).toBe(true);
    expect(aAll.some(r => r.id === bRecord.id)).toBe(true);
  });

  it('two clients updating the same record → conflict detected & resolved deterministically', async () => {
    const { makeClient } = makeFixture();
    const a = makeClient();
    const b = makeClient();

    await activate(a);
    await a.sdk.initialize();
    const created = await a.sdk.createRecord({ value: 0 });

    // A creates; B pulls the shared record so both start at version 1.
    await activate(a);
    await a.sdk.sync();
    await activate(b);
    await b.sdk.initialize();
    await b.sdk.sync();
    expect(b.sdk.getRecords().some(r => r.id === created.id)).toBe(true);

    // Both clients update the same record from version 1.
    await activate(a);
    await a.sdk.updateRecord(created.id, { value: 1 });
    await activate(b);
    await b.sdk.updateRecord(created.id, { value: 2 });

    // A applies first (server 1 -> 2). B's update is based on stale version 1
    // and must be rejected as a version conflict.
    await activate(a);
    const aResult = await a.sdk.sync();
    await activate(b);
    const bResult = await b.sdk.sync();

    expect(aResult.applied).toBe(1);
    expect(aResult.rejected).toBe(0);
    expect(bResult.applied).toBe(0);
    expect(bResult.rejected).toBe(1);

    // Default last-write-wins: B adopts the server's value.
    const bRecord = b.sdk.getRecords().find(r => r.id === created.id)!;
    expect(bRecord.data.value).toBe(1);
  });

  it('Client A delete vs Client B update → delete propagates to both', async () => {
    const { makeClient } = makeFixture();
    const a = makeClient();
    const b = makeClient();

    await activate(a);
    await a.sdk.initialize();
    const created = await a.sdk.createRecord({ content: 'original' });
    await activate(a);
    await a.sdk.sync();

    await activate(b);
    await b.sdk.initialize();
    await b.sdk.sync();

    // B updates the record (server version bumps to 2).
    await activate(b);
    await b.sdk.updateRecord(created.id, { content: 'B updated' });
    await b.sdk.sync();

    // A deletes the record based on stale version 1 → rejected as conflict.
    await activate(a);
    await a.sdk.deleteRecord(created.id);
    const aResult = await a.sdk.sync();
    expect(aResult.rejected).toBe(1);
    expect(b.sdk.getRecords().some(r => r.id === created.id)).toBe(true);

    // A pulls and re-adopts the server's current record, then deletes at the
    // latest version. Both clients see the deletion via the tombstone.
    await activate(a);
    await a.sdk.deleteRecord(created.id);
    await a.sdk.sync();

    await activate(b);
    await b.sdk.sync();

    expect(a.sdk.getRecords().some(r => r.id === created.id)).toBe(false);
    expect(b.sdk.getRecords().some(r => r.id === created.id)).toBe(false);
  });

  it('client offline for N operations → reconnects and converges', async () => {
    const { makeClient } = makeFixture();
    const a = makeClient();
    const b = makeClient();

    await activate(a);
    await a.sdk.initialize();
    await activate(b);
    await b.sdk.initialize();

    // A goes "offline" by flipping its isOnline flag so sync no-ops while
    // operations are queued locally.
    (a.sdk as unknown as { isOnline: boolean }).isOnline = false;
    await activate(a);
    for (let i = 0; i < 3; i++) {
      await a.sdk.createRecord({ n: i });
    }

    // B stays online and works in parallel.
    await activate(b);
    await b.sdk.createRecord({ n: 'B' });
    await b.sdk.sync();

    // A comes back online and flushes the queue, then pulls B's delta.
    await activate(a);
    (a.sdk as unknown as { isOnline: boolean }).isOnline = true;
    const aResult = await a.sdk.sync();

    expect(aResult.applied).toBe(3);
    expect(aResult.rejected).toBe(0);
    expect(a.sdk.getRecords().map(r => r.data.n)).toContain('B');
    expect(a.sdk.getRecords().length).toBe(4);

    // B also pulls A's offline records.
    await activate(b);
    await b.sdk.sync();
    expect(b.sdk.getRecords().length).toBe(4);
  });

  it('operations are idempotent across clients', async () => {
    const { makeClient } = makeFixture();
    const a = makeClient();
    const b = makeClient();

    await activate(a);
    await a.sdk.initialize();
    await a.sdk.createRecord({ kind: 'once' });
    await a.sdk.sync();

    // Re-syncing without new local changes must not duplicate the record.
    await activate(a);
    await a.sdk.sync();
    await activate(b);
    await b.sdk.initialize();
    await b.sdk.sync();

    const countA = a.sdk.getRecords().filter(r => r.data.kind === 'once').length;
    const countB = b.sdk.getRecords().filter(r => r.data.kind === 'once').length;
    expect(countA).toBe(1);
    expect(countB).toBe(1);
  });
});
