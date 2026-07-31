/**
 * Core type definitions for Syncra offline-first sync engine
 * Shared between API and SDK
 */

/**
 * A user-owned data entity stored in both local and server databases
 */
export interface SyncRecord {
  id: string;
  data: Record<string, any>;
  version: number;
  updated_at: string; // ISO 8601 timestamp
  created_at: string; // ISO 8601 timestamp
  /** Monotonic cursor for deterministic delta pulls (Phase 1). */
  cursor?: number;
  /** Collection namespace (Phase 5). */
  collection?: string;
}

/**
 * A discrete mutation (create, update, or delete) operation
 */
export interface Operation {
  id: string;
  type: 'create' | 'update' | 'delete';
  recordId: string;
  payload: Record<string, any>;
  version: number;
  idempotencyKey: string;
  /** Collection namespace (Phase 5). */
  collection?: string;
}

/**
 * An operation queued locally for sync
 */
export interface QueuedOperation extends Operation {
  status: 'pending' | 'applied' | 'failed';
  retries: number;
  maxRetries: number;
  createdAt: Date;
  nextRetryAt?: Date;
}

/**
 * Response from server when a conflict is detected
 */
export interface ConflictResponse {
  operationId: string;
  recordId: string;
  reason: string;
  clientVersion: number;
  serverVersion: number;
  serverData: Record<string, any>;
}

/**
 * Result of a single operation application
 */
export interface OperationResult {
  operationId: string;
  recordId: string;
  newVersion?: number;
  data?: Record<string, any>;
}

/**
 * Response from POST /sync endpoint
 */
export interface SyncPushResponse {
  applied: OperationResult[];
  rejected: ConflictResponse[];
}

/**
 * A tombstone recording that a record was deleted.
 * Carries a cursor so the delta pull can propagate deletions
 * using the same monotonic cursor as record mutations (Phase 2).
 */
export interface TombstoneEntry {
  recordId: string;
  cursor: number;
}

/**
 * Response from GET /sync/updates endpoint
 */
export interface SyncPullResponse {
  records: SyncRecord[];
  deletedRecordIds: string[];
  /** Tombstones with cursors for delete propagation (Phase 2). */
  tombstones?: TombstoneEntry[];
}

/**
 * Conflict object emitted to SDK event listeners
 */
export interface Conflict {
  recordId: string;
  clientVersion: number;
  serverVersion: number;
  serverData: Record<string, any>;
  clientData?: Record<string, any>;
}

/**
 * Resolved record returned from custom conflict handler
 */
export interface ResolvedRecord {
  data: Record<string, any>;
  version: number;
}

/**
 * User authentication response
 */
export interface AuthResponse {
  id: string;
  email: string;
  token: string;
  expiresIn?: number;
}

/**
 * Health check response
 */
export interface HealthResponse {
  status: 'healthy' | 'unhealthy';
  database: 'connected' | 'disconnected';
  redis: 'connected' | 'disconnected';
  timestamp: string;
}

/**
 * Async job status response
 */
export interface JobStatusResponse {
  jobId: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  result?: SyncPushResponse;
  error?: string;
}
