// Core types previously from @syncra/core — inlined for self-contained publishing

export interface SyncRecord {
  id: string;
  data: Record<string, any>;
  version: number;
  updated_at: string;
  created_at: string;
}

export interface QueuedOperation {
  id: string;
  type: 'create' | 'update' | 'delete';
  recordId: string;
  payload: Record<string, any>;
  version: number;
  idempotencyKey: string;
  status: 'pending' | 'applied' | 'failed';
  retries: number;
  maxRetries?: number;
  createdAt: Date;
  nextRetryAt?: Date;
}

export interface ResolvedRecord {
  data: Record<string, any>;
  version: number;
}

export interface SyncPushResponse {
  applied: Array<{
    operationId: string;
    recordId: string;
    newVersion?: number;
    data?: Record<string, any>;
  }>;
  rejected: Array<{
    operationId: string;
    recordId: string;
    clientVersion: number;
    serverVersion: number;
    serverData: Record<string, any>;
  }>;
}

export interface SyncPullResponse {
  records: SyncRecord[];
  deletedRecordIds: string[];
}
