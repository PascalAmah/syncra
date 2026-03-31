/**
 * Property-based tests for serialization round-trips.
 * Properties 35 and 36 from the Syncra offline sync engine spec.
 */
import { describe, it } from 'vitest';
import fc from 'fast-check';
import { OperationSerializer, RecordSerializer } from './serializer';

const opSerializer = new OperationSerializer();
const recSerializer = new RecordSerializer();

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const operationArb = fc.record({
  id: fc.uuid(),
  type: fc.constantFrom('create' as const, 'update' as const, 'delete' as const),
  recordId: fc.uuid(),
  payload: fc.dictionary(
    fc.string({ minLength: 1, maxLength: 20 }),
    fc.oneof(fc.string(), fc.integer(), fc.boolean(), fc.constant(null)),
  ),
  version: fc.integer({ min: 1, max: 10000 }),
  idempotencyKey: fc.uuid(),
});

// Use integer timestamps to avoid invalid Date edge cases during shrinking
const isoDateArb = fc
  .integer({ min: 1577836800000, max: 1893456000000 }) // 2020-01-01 to 2030-01-01
  .map((ms) => new Date(ms).toISOString());

const recordArb = fc.record({
  id: fc.uuid(),
  data: fc.dictionary(
    fc.string({ minLength: 1, maxLength: 20 }),
    fc.oneof(fc.string(), fc.integer(), fc.boolean(), fc.constant(null)),
  ),
  version: fc.integer({ min: 1, max: 10000 }),
  updated_at: isoDateArb,
  created_at: isoDateArb,
});

// ---------------------------------------------------------------------------
// Property 35: Operation Serialization Round-Trip
// Validates: Requirements 13.3
// ---------------------------------------------------------------------------

describe('Feature: syncra-offline-sync-engine, Property 35: Operation Serialization Round-Trip', () => {
  it('should produce an object deeply equal to the original after serialize then deserialize', () => {
    fc.assert(
      fc.property(operationArb, (op) => {
        const json = opSerializer.serialize(op);
        const result = opSerializer.deserialize(json);
        // Deep equality check
        if (result.id !== op.id) return false;
        if (result.type !== op.type) return false;
        if (result.recordId !== op.recordId) return false;
        if (result.version !== op.version) return false;
        if (result.idempotencyKey !== op.idempotencyKey) return false;
        if (JSON.stringify(result.payload) !== JSON.stringify(op.payload)) return false;
        return true;
      }),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 36: Record Serialization Round-Trip
// Validates: Requirements 13.6
// ---------------------------------------------------------------------------

describe('Feature: syncra-offline-sync-engine, Property 36: Record Serialization Round-Trip', () => {
  it('should produce an object deeply equal to the original after serialize then deserialize', () => {
    fc.assert(
      fc.property(recordArb, (record) => {
        const json = recSerializer.serialize(record);
        const result = recSerializer.deserialize(json);
        if (result.id !== record.id) return false;
        if (result.version !== record.version) return false;
        if (result.updated_at !== record.updated_at) return false;
        if (result.created_at !== record.created_at) return false;
        // Compare data (note: Date objects in data are converted back from ISO strings)
        if (JSON.stringify(result.data) !== JSON.stringify(record.data)) return false;
        return true;
      }),
      { numRuns: 100 },
    );
  });
});
