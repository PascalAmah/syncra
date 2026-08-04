import { v4 as uuidv4 } from 'uuid';
import { ResolvedRecord, SyncPullResponse, SyncPushResponse, QueuedOperation } from './types';
import { getRecord, upsertRecord, deleteRecord as deleteRecordFromStore } from './db/records-store';
import {
  enqueueOperation,
  getPendingOperations,
  markOperationApplied,
  removeOperation,
  updateOperation,
} from './db/queue-store';
import { getMetadata, setMetadata } from './db/metadata-store';
import { getDb } from './db/database';
import { STORE_NAMES } from './db/schema';
import { calculateNextRetryAt, calculateRetryDelay, MAX_RETRIES } from './retry';
import { classifyResponseError, SyncError, wrapError } from './errors';
import { NetworkStateManager, NetworkStateManagerOptions } from './network-state-manager';

const LAST_CURSOR_KEY = 'lastCursor';
const CLIENT_ID_KEY = 'clientId';

/** Maximum job-status polls before giving up (avoids an unbounded hang). */
const MAX_JOB_POLLS = 60;

export interface LocalRecord {
  id: string;
  data: Record<string, unknown>;
  version: number;
  updatedAt: Date;
  createdAt: Date;
  collection?: string;
}

export interface LocalQueuedOperation {
  id: string;
  type: 'create' | 'update' | 'delete';
  recordId: string;
  payload: Record<string, unknown>;
  version: number;
  idempotencyKey: string;
  status: 'pending' | 'applied' | 'failed';
  retries: number;
  createdAt: Date;
  nextRetryAt?: Date;
  collection?: string;
}

export interface LocalConflict {
  recordId: string;
  clientVersion: number;
  serverVersion: number;
  serverData: Record<string, unknown>;
}

export interface SyncResult {
  applied: number;
  rejected: number;
}

type SyncEventListener<T = unknown> = (data: T) => void;

export interface SyncEvents {
  'sync-start': void;
  'sync-complete': SyncResult;
  'sync-failed': { error: Error };
  conflict: LocalConflict;
  online: void;
  offline: void;
}

export class SyncraSDK {
  private records: Map<string, LocalRecord> = new Map();
  private queue: Map<string, LocalQueuedOperation> = new Map();
  private isOnline: boolean = navigator.onLine;
  private conflictHandler: ((conflict: LocalConflict) => ResolvedRecord) | null = null;
  private eventListeners: Map<string, Set<SyncEventListener<any>>> = new Map();
  private networkStateManager: NetworkStateManager;
  private syncIntervalId: ReturnType<typeof setInterval> | null = null;
  private syncInterval: number;

  /** Base URL for the Syncra API (e.g. "http://localhost:3000") */
  private baseUrl: string;
  /** API key for authenticated requests */
  private apiKey: string | null = null;
  /** Optional user id sent as x-user-id header */
  private userId: string | null = null;
  /** Optional JWT bearer token for user-authenticated requests */
  private bearerToken: string | null = null;
  /** Persistent client identifier, generated once and stored in IndexedDB */
  private clientId: string | null = null;

  constructor(
    options: {
      baseUrl?: string;
      apiKey?: string;
      userId?: string;
      bearerToken?: string;
      syncInterval?: number;
      networkStateManagerOptions?: NetworkStateManagerOptions;
    } = {}
  ) {
    this.baseUrl = options.baseUrl ?? '';
    this.apiKey = options.apiKey ?? null;
    this.userId = options.userId ?? null;
    this.bearerToken = options.bearerToken ?? null;
    this.syncInterval = options.syncInterval ?? 30000;

    this.networkStateManager = new NetworkStateManager(options.networkStateManagerOptions);
    this.networkStateManager.subscribe((online: boolean) => {
      if (online) {
        this.isOnline = true;
        this.emit('online');
        this.sync();
        this.startPeriodicSync();
      } else {
        this.isOnline = false;
        this.emit('offline');
        this.stopPeriodicSync();
      }
    });

    // Start periodic sync immediately if already online
    if (this.isOnline) {
      this.startPeriodicSync();
    }
  }

  /** Update the API key (e.g. after project creation) */
  setApiKey(apiKey: string): void {
    this.apiKey = apiKey;
  }

  /** Update the user id */
  setUserId(userId: string): void {
    this.userId = userId;
  }

  /** Update the JWT bearer token (e.g. after login) */
  setBearerToken(token: string): void {
    this.bearerToken = token;
  }

  /** Get a namespaced Collection handle for scoped record operations (Phase 5) */
  collection(name: string): Collection {
    return new Collection(this, name);
  }

  // ---------------------------------------------------------------------------
  // Event emitter helpers
  // ---------------------------------------------------------------------------

  on<K extends keyof SyncEvents>(event: K, listener: SyncEventListener<SyncEvents[K]>): void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set());
    }
    this.eventListeners.get(event)!.add(listener as SyncEventListener<any>);
  }

  off<K extends keyof SyncEvents>(event: K, listener: SyncEventListener<SyncEvents[K]>): void {
    this.eventListeners.get(event)?.delete(listener as SyncEventListener<any>);
  }

  private emit<K extends keyof SyncEvents>(event: K, data?: SyncEvents[K]): void {
    this.eventListeners.get(event)?.forEach(listener => listener(data as any));
  }

  // ---------------------------------------------------------------------------
  // Conflict handler registration
  // ---------------------------------------------------------------------------

  /** Register a custom conflict resolution handler (Requirement 8.3) */
  onConflict(handler: (conflict: LocalConflict) => ResolvedRecord): void {
    this.conflictHandler = handler;
  }

  /**
   * Loads all pending operations and all records from IndexedDB into the
   * in-memory cache. Must be called after construction to restore state
   * across app restarts.
   */
  async initialize(): Promise<void> {
    // Restore or generate persistent client identity (Phase 4)
    let storedClientId = await getMetadata(CLIENT_ID_KEY);
    if (!storedClientId) {
      storedClientId = uuidv4();
      await setMetadata(CLIENT_ID_KEY, storedClientId);
    }
    this.clientId = storedClientId;

    const pending = await getPendingOperations();
    for (const op of pending) {
      this.queue.set(op.id, {
        id: op.id,
        type: op.type,
        recordId: op.recordId,
        payload: op.payload as Record<string, unknown>,
        version: op.version,
        idempotencyKey: op.idempotencyKey,
        status: op.status,
        retries: op.retries,
        createdAt: op.createdAt,
        nextRetryAt: op.nextRetryAt,
        collection: op.collection,
      });
    }

    // Restore records from IndexedDB so getRecords() works after a page reload.
    const db = await getDb();
    const allStored = await db.getAll(STORE_NAMES.RECORDS);
    for (const r of allStored) {
      this.records.set(r.id, {
        id: r.id,
        data: r.data as Record<string, unknown>,
        version: r.version,
        updatedAt: new Date(r.updated_at),
        createdAt: new Date(r.created_at),
        collection: r.collection,
      });
    }
  }

  private startPeriodicSync(): void {
    if (this.syncInterval > 0) {
      this.stopPeriodicSync(); // clear any existing interval first
      this.syncIntervalId = setInterval(() => this.sync(), this.syncInterval);
    }
  }

  private stopPeriodicSync(): void {
    if (this.syncIntervalId !== null) {
      clearInterval(this.syncIntervalId);
      this.syncIntervalId = null;
    }
  }

  destroy(): void {
    this.networkStateManager.destroy();
    this.stopPeriodicSync();
  }

  async createRecord(
    data: Record<string, unknown>,
    collection: string = 'default'
  ): Promise<LocalRecord> {
    const id = uuidv4();
    const now = new Date();
    const nowIso = now.toISOString();

    const record: LocalRecord = {
      id,
      data,
      version: 1,
      updatedAt: now,
      createdAt: now,
      collection,
    };

    // Persist record to IndexedDB
    await upsertRecord({
      id,
      data: data as Record<string, any>,
      version: 1,
      updated_at: nowIso,
      created_at: nowIso,
      collection,
    });

    this.records.set(id, record);

    const operationId = uuidv4();
    const idempotencyKey = uuidv4();

    const operation: LocalQueuedOperation = {
      id: operationId,
      type: 'create',
      recordId: id,
      payload: data,
      version: 1,
      idempotencyKey,
      status: 'pending',
      retries: 0,
      createdAt: now,
      collection,
    };

    // Persist operation to IndexedDB offline queue
    await enqueueOperation({
      id: operationId,
      type: 'create',
      recordId: id,
      payload: data as Record<string, any>,
      version: 1,
      idempotencyKey,
      status: 'pending',
      retries: 0,
      maxRetries: 5,
      createdAt: now,
      collection,
    });

    this.queue.set(operation.id, operation);

    return record;
  }

  async updateRecord(
    id: string,
    data: Record<string, unknown>,
    collection: string = 'default'
  ): Promise<LocalRecord> {
    // Fetch from IndexedDB first, fall back to in-memory cache
    const storedRecord = await getRecord(id);
    if (!storedRecord) {
      throw new Error(`Record with id ${id} not found`);
    }

    const currentVersion = storedRecord.version;
    const now = new Date();
    const nowIso = now.toISOString();

    // Persist updated record to IndexedDB
    await upsertRecord({
      id,
      data: data as Record<string, any>,
      version: currentVersion + 1,
      updated_at: nowIso,
      created_at: storedRecord.created_at,
      collection,
    });

    const updatedRecord: LocalRecord = {
      id,
      data,
      version: currentVersion + 1,
      updatedAt: now,
      createdAt: new Date(storedRecord.created_at),
      collection,
    };

    this.records.set(id, updatedRecord);

    const operationId = uuidv4();
    const idempotencyKey = uuidv4();

    // Enqueue operation to IndexedDB with pre-increment version
    await enqueueOperation({
      id: operationId,
      type: 'update',
      recordId: id,
      payload: data as Record<string, any>,
      version: currentVersion,
      idempotencyKey,
      status: 'pending',
      retries: 0,
      maxRetries: 5,
      createdAt: now,
      collection,
    });

    const operation: LocalQueuedOperation = {
      id: operationId,
      type: 'update',
      recordId: id,
      payload: data,
      version: currentVersion,
      idempotencyKey,
      status: 'pending',
      retries: 0,
      createdAt: now,
      collection,
    };

    this.queue.set(operation.id, operation);

    return updatedRecord;
  }

  async deleteRecord(id: string, collection: string = 'default'): Promise<void> {
    // Fetch from IndexedDB first, fall back to in-memory cache
    const storedRecord = await getRecord(id);
    if (!storedRecord) {
      throw new Error(`Record with id ${id} not found`);
    }

    const currentVersion = storedRecord.version;
    const now = new Date();

    // Mark record as deleted in local database
    await deleteRecordFromStore(id);
    this.records.delete(id);

    const operationId = uuidv4();
    const idempotencyKey = uuidv4();

    // Enqueue delete operation to IndexedDB offline queue
    await enqueueOperation({
      id: operationId,
      type: 'delete',
      recordId: id,
      payload: {},
      version: currentVersion,
      idempotencyKey,
      status: 'pending',
      retries: 0,
      maxRetries: 5,
      createdAt: now,
      collection,
    });

    const operation: LocalQueuedOperation = {
      id: operationId,
      type: 'delete',
      recordId: id,
      payload: {},
      version: currentVersion,
      idempotencyKey,
      status: 'pending',
      retries: 0,
      createdAt: now,
      collection,
    };

    this.queue.set(operation.id, operation);
  }

  async sync(): Promise<SyncResult> {
    if (!this.isOnline) {
      console.log('Cannot sync: offline');
      return { applied: 0, rejected: 0 };
    }

    const pendingOperations = await getPendingOperations();

    if (pendingOperations.length === 0) {
      this.emit('sync-start');
      try {
        await this.pullDelta();
      } catch (error) {
        // A failed background delta pull is not fatal — emit the failure and
        // let the next periodic sync retry. Returning a resolved result avoids
        // unhandled rejections from un-awaited timer-driven sync() calls.
        this.emit('sync-failed', {
          error: error instanceof Error ? error : new Error(String(error)),
        });
      }
      const syncResult: SyncResult = { applied: 0, rejected: 0 };
      this.emit('sync-complete', syncResult);
      return syncResult;
    }

    this.emit('sync-start');

    try {
      const body = {
        operations: pendingOperations.map(op => ({
          id: op.id,
          type: op.type,
          recordId: op.recordId,
          payload: op.payload,
          version: op.version,
          idempotencyKey: op.idempotencyKey,
          collection: op.collection,
        })),
      };

      const headers = this.buildHeaders();
      headers['Content-Type'] = 'application/json';

      const response = await fetch(`${this.baseUrl}/sync`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const err = classifyResponseError(
          response.status,
          `Sync request failed with status ${response.status}`
        );
        if (err.retriable) {
          // Transient failure (5xx, 408, 429) — apply retry logic and let the
          // periodic sync retry. Returning a resolved result avoids unhandled
          // rejections from un-awaited timer-driven sync() calls.
          await this.applyRetryLogic(pendingOperations);
          const syncResult: SyncResult = { applied: 0, rejected: 0 };
          this.emit('sync-complete', syncResult);
          return syncResult;
        }
        // Non-retriable (e.g. validation) — throw so the catch block marks the
        // operations as failed and emits sync-failed.
        throw err;
      }

      let result: SyncPushResponse;

      if (response.status === 202) {
        const { jobId } = await response.json();
        result = await this.pollJobStatus(jobId);
      } else {
        result = await response.json();
      }

      for (const applied of result.applied) {
        await markOperationApplied(applied.operationId);
        this.updateQueueEntryStatus(applied.operationId, 'applied');

        // Update local record with server-confirmed data/version if provided
        if (applied.data !== undefined && applied.newVersion !== undefined) {
          const existing = await getRecord(applied.recordId);
          if (existing) {
            await upsertRecord({
              ...existing,
              data: applied.data as Record<string, any>,
              version: applied.newVersion,
              updated_at: new Date().toISOString(),
            });
          }
        }
      }

      for (const rejected of result.rejected) {
        const conflict: LocalConflict = {
          recordId: rejected.recordId,
          clientVersion: rejected.clientVersion,
          serverVersion: rejected.serverVersion,
          serverData: rejected.serverData as Record<string, unknown>,
        };

        this.emit('conflict', conflict);

        if (this.conflictHandler) {
          const resolved = this.conflictHandler(conflict);
          const existing = await getRecord(rejected.recordId);
          const opCollection =
            pendingOperations.find(op => op.id === rejected.operationId)?.collection ?? 'default';
          if (existing) {
            await upsertRecord({
              ...existing,
              data: resolved.data as Record<string, any>,
              version: resolved.version,
              updated_at: new Date().toISOString(),
            });
          }
          // Re-enqueue an update operation with the resolved data
          const newOpId = uuidv4();
          await enqueueOperation({
            id: newOpId,
            type: 'update',
            recordId: rejected.recordId,
            payload: resolved.data as Record<string, any>,
            version: resolved.version,
            idempotencyKey: uuidv4(),
            status: 'pending',
            retries: 0,
            maxRetries: 5,
            createdAt: new Date(),
            collection: opCollection,
          });
        } else {
          const existing = await getRecord(rejected.recordId);
          if (existing) {
            await upsertRecord({
              ...existing,
              data: rejected.serverData as Record<string, any>,
              version: rejected.serverVersion,
              updated_at: new Date().toISOString(),
            });
          }
          // Remove the conflicting operation from the queue
          await removeOperation(rejected.operationId);
          this.queue.delete(rejected.operationId);
        }
      }

      await this.pullDelta();

      const syncResult: SyncResult = {
        applied: result.applied.length,
        rejected: result.rejected.length,
      };

      this.emit('sync-complete', syncResult);
      return syncResult;
    } catch (error) {
      const syncErr = error instanceof SyncError ? error : wrapError(error);
      if (syncErr.retriable) {
        await this.applyRetryLogic(pendingOperations);
      } else {
        // Non-retriable errors (e.g. validation) will never succeed — mark the
        // affected operations as failed instead of retrying them forever.
        await this.markOperationsFailed(pendingOperations);
      }
      this.emit('sync-failed', { error: syncErr });
      throw syncErr;
    }
  }

  /**
   * Polls GET /sync/job/:jobId until the job is completed or failed.
   * Uses exponential backoff delay between polls.
   * When completed, returns the SyncPushResponse result.
   * When failed, emits sync-failed and throws.
   */
  private async pollJobStatus(jobId: string): Promise<SyncPushResponse> {
    const headers = this.buildHeaders();

    let pollAttempt = 0;

    while (true) {
      if (pollAttempt >= MAX_JOB_POLLS) {
        // Give up polling after MAX_JOB_POLLS attempts. This is a transient
        // condition (job may still complete), so it is NOT marked nonRetriable:
        // the caller's retry logic will re-attempt the push on the next sync.
        throw new Error(`Sync job ${jobId} did not finish after ${MAX_JOB_POLLS} polls`);
      }

      const delay = calculateRetryDelay(pollAttempt);
      await new Promise(resolve => setTimeout(resolve, delay));

      const pollResponse = await fetch(`${this.baseUrl}/sync/job/${jobId}`, { headers });

      if (!pollResponse.ok) {
        throw new Error(`Job status poll failed with status ${pollResponse.status}`);
      }

      const jobStatus: {
        jobId: string;
        status: string;
        result?: SyncPushResponse;
        failedReason?: string;
      } = await pollResponse.json();

      if (jobStatus.status === 'completed' && jobStatus.result) {
        return jobStatus.result;
      }

      if (jobStatus.status === 'failed') {
        const error = new SyncError(jobStatus.failedReason ?? 'Sync job failed', false);
        this.emit('sync-failed', { error });
        throw error;
      }

      // Still queued or active — keep polling
      pollAttempt++;
    }
  }

  /**
   * Applies retry logic to a batch of operations after a sync failure.
   * Increments retries, calculates backoff delay, sets nextRetryAt.
   * If retries >= maxRetries, marks operation as failed and emits sync-failed.
   */
  private async applyRetryLogic(operations: QueuedOperation[]): Promise<void> {
    const failedOps: QueuedOperation[] = [];

    for (const op of operations) {
      const newRetries = op.retries + 1;
      const maxRetries = op.maxRetries ?? MAX_RETRIES;

      if (newRetries >= maxRetries) {
        await updateOperation(op.id, { status: 'failed', retries: newRetries });
        this.updateQueueEntryStatus(op.id, 'failed');
        failedOps.push({ ...op, retries: newRetries, status: 'failed' });
      } else {
        const nextRetryAt = calculateNextRetryAt(newRetries);
        await updateOperation(op.id, { retries: newRetries, nextRetryAt });
        const entry = this.queue.get(op.id);
        if (entry) {
          this.queue.set(op.id, { ...entry, retries: newRetries, nextRetryAt });
        }
      }
    }

    if (failedOps.length > 0) {
      this.emit('sync-failed', {
        error: new Error(`${failedOps.length} operation(s) failed after max retries`),
      });
    }
  }

  /**
   * Permanently marks operations as failed without retrying.
   * Used for non-retriable errors (e.g. validation) that will never succeed.
   */
  private async markOperationsFailed(operations: QueuedOperation[]): Promise<void> {
    for (const op of operations) {
      await updateOperation(op.id, { status: 'failed', retries: op.retries + 1 });
      this.updateQueueEntryStatus(op.id, 'failed');
    }
  }

  /**
   * Builds a headers object for authenticated API requests.
   * Includes x-api-key (or Authorization) and optional x-user-id.
   */
  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};
    if (this.apiKey) {
      headers['x-api-key'] = this.apiKey;
    } else if (this.bearerToken) {
      headers['Authorization'] = `Bearer ${this.bearerToken}`;
    }
    if (this.userId) {
      headers['x-user-id'] = this.userId;
    }
    if (this.clientId) {
      headers['x-client-id'] = this.clientId;
    }
    return headers;
  }

  /**
   * Pulls delta updates from the server since the last known cursor,
   * upserts returned records into the local database, removes deleted records,
   * and advances the cursor to the highest seen value.
   *
   * Uses a monotonic cursor (BIGINT) instead of wall-clock timestamps
   * to guarantee no records are missed due to clock skew between client
   * and server (Phase 1).
   *
   * Pages through results in chunks of PAGE_SIZE, continuing until both
   * records and tombstones return fewer than a full page.
   */
  private async pullDelta(): Promise<void> {
    const lastCursorStr = await getMetadata(LAST_CURSOR_KEY);
    let cursor = lastCursorStr ? Number(lastCursorStr) : 0;
    const headers = this.buildHeaders();
    const PAGE_SIZE = 500;
    let maxCursor = cursor;

    while (true) {
      const response = await fetch(
        `${this.baseUrl}/sync/updates?cursor=${cursor}&limit=${PAGE_SIZE}`,
        { headers }
      );

      if (!response.ok) {
        throw new Error(`Delta pull failed with status ${response.status}`);
      }

      const delta: SyncPullResponse = await response.json();

      // Upsert each returned record into local database
      for (const record of delta.records) {
        await upsertRecord(record);
        this.records.set(record.id, {
          id: record.id,
          data: record.data as Record<string, unknown>,
          version: record.version,
          updatedAt: new Date(record.updated_at),
          createdAt: new Date(record.created_at),
          collection: record.collection,
        });
        if (record.cursor !== undefined && record.cursor > maxCursor) {
          maxCursor = record.cursor;
        }
      }

      // Remove each deleted record from local database (Requirement 7.2.3)
      for (const deletedId of delta.deletedRecordIds) {
        await deleteRecordFromStore(deletedId);
        this.records.delete(deletedId);
      }

      // Track tombstone cursors so the client advances past deletions (Phase 2)
      if (delta.tombstones) {
        for (const t of delta.tombstones) {
          if (t.cursor > maxCursor) {
            maxCursor = t.cursor;
          }
        }
      }

      // Break when both records and tombstones are below a full page
      if (
        delta.records.length < PAGE_SIZE &&
        (!delta.tombstones || delta.tombstones.length < PAGE_SIZE)
      ) {
        break;
      }

      // Advance cursor for next page
      cursor = maxCursor;
    }

    // Advance cursor to the highest seen value
    await setMetadata(LAST_CURSOR_KEY, String(maxCursor));
  }

  /** Helper to update the in-memory queue entry status */
  private updateQueueEntryStatus(
    operationId: string,
    status: LocalQueuedOperation['status']
  ): void {
    const entry = this.queue.get(operationId);
    if (entry) {
      this.queue.set(operationId, { ...entry, status });
    }
  }

  getRecords(collection?: string): LocalRecord[] {
    const all = Array.from(this.records.values());
    if (collection !== undefined) {
      return all.filter(r => r.collection === collection);
    }
    return all;
  }

  getPendingOperations(): LocalQueuedOperation[] {
    return Array.from(this.queue.values()).filter(op => op.status === 'pending');
  }

  isOnlineState(): boolean {
    return this.isOnline;
  }
}

export class Collection {
  constructor(
    private sdk: SyncraSDK,
    readonly name: string
  ) {}

  async create(data: Record<string, unknown>): Promise<LocalRecord> {
    return this.sdk.createRecord(data, this.name);
  }

  async update(id: string, data: Record<string, unknown>): Promise<LocalRecord> {
    return this.sdk.updateRecord(id, data, this.name);
  }

  async delete(id: string): Promise<void> {
    return this.sdk.deleteRecord(id, this.name);
  }

  list(): LocalRecord[] {
    return this.sdk.getRecords(this.name);
  }
}
