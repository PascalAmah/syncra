import type { Operation, SyncRecord } from './types';

const OPERATION_TYPES = new Set(['create', 'update', 'delete']);

/**
 * Type guard that checks whether an unknown value conforms to the Operation interface.
 */
export function isValidOperation(obj: unknown): obj is Operation {
  if (typeof obj !== 'object' || obj === null) return false;
  const o = obj as Record<string, unknown>;

  return (
    typeof o['id'] === 'string' &&
    typeof o['type'] === 'string' &&
    OPERATION_TYPES.has(o['type']) &&
    typeof o['recordId'] === 'string' &&
    typeof o['payload'] === 'object' &&
    o['payload'] !== null &&
    !Array.isArray(o['payload']) &&
    typeof o['version'] === 'number' &&
    typeof o['idempotencyKey'] === 'string'
  );
}

/**
 * Type guard that checks whether an unknown value conforms to the SyncRecord interface.
 */
export function isValidRecord(obj: unknown): obj is SyncRecord {
  if (typeof obj !== 'object' || obj === null) return false;
  const o = obj as Record<string, unknown>;

  return (
    typeof o['id'] === 'string' &&
    typeof o['data'] === 'object' &&
    o['data'] !== null &&
    !Array.isArray(o['data']) &&
    typeof o['version'] === 'number' &&
    typeof o['updated_at'] === 'string' &&
    typeof o['created_at'] === 'string'
  );
}
