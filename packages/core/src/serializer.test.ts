import { describe, it, expect } from 'vitest';
import { RecordSerializer, OperationSerializer } from './serializer';
import type { Operation, SyncRecord } from './types';

const serializer = new RecordSerializer();

const baseRecord: SyncRecord = {
  id: 'rec-1',
  data: { name: 'Alice', score: 42 },
  version: 1,
  updated_at: '2024-01-15T10:00:00.000Z',
  created_at: '2024-01-01T00:00:00.000Z',
};

describe('RecordSerializer', () => {
  describe('serialize', () => {
    it('produces a valid JSON string', () => {
      const json = serializer.serialize(baseRecord);
      expect(() => JSON.parse(json)).not.toThrow();
    });

    it('converts Date objects in data to ISO 8601 strings', () => {
      const record: SyncRecord = {
        ...baseRecord,
        data: { createdOn: new Date('2024-03-01T12:00:00.000Z'), label: 'test' },
      };
      const json = serializer.serialize(record);
      const parsed = JSON.parse(json);
      expect(parsed.data.createdOn).toBe('2024-03-01T12:00:00.000Z');
      expect(parsed.data.label).toBe('test');
    });

    it('preserves non-Date values in data unchanged', () => {
      const json = serializer.serialize(baseRecord);
      const parsed = JSON.parse(json);
      expect(parsed.data.name).toBe('Alice');
      expect(parsed.data.score).toBe(42);
    });
  });

  describe('deserialize', () => {
    it('parses a JSON string into a SyncRecord', () => {
      const json = serializer.serialize(baseRecord);
      const result = serializer.deserialize(json);
      expect(result.id).toBe(baseRecord.id);
      expect(result.version).toBe(baseRecord.version);
    });

    it('converts ISO 8601 strings in data back to Date objects', () => {
      const record: SyncRecord = {
        ...baseRecord,
        data: { createdOn: new Date('2024-03-01T12:00:00.000Z') },
      };
      const json = serializer.serialize(record);
      const result = serializer.deserialize(json);
      expect(result.data.createdOn).toBeInstanceOf(Date);
      expect((result.data.createdOn as Date).toISOString()).toBe('2024-03-01T12:00:00.000Z');
    });

    it('does not convert ISO strings in top-level fields to Date', () => {
      const json = serializer.serialize(baseRecord);
      const result = serializer.deserialize(json);
      // updated_at and created_at should remain strings
      expect(typeof result.updated_at).toBe('string');
      expect(typeof result.created_at).toBe('string');
    });
  });

  describe('round-trip', () => {
    it('deserialize(serialize(record)) is deeply equal to original for plain data', () => {
      const json = serializer.serialize(baseRecord);
      const result = serializer.deserialize(json);
      expect(result).toEqual(baseRecord);
    });

    it('round-trips a record with Date in data (Date becomes Date)', () => {
      const date = new Date('2024-06-15T08:30:00.000Z');
      const record: SyncRecord = {
        ...baseRecord,
        data: { event: date, count: 5 },
      };
      const result = serializer.deserialize(serializer.serialize(record));
      expect(result.data.event).toBeInstanceOf(Date);
      expect((result.data.event as Date).getTime()).toBe(date.getTime());
      expect(result.data.count).toBe(5);
    });
  });

  describe('prettyPrint', () => {
    it('returns a formatted JSON string with 2-space indent', () => {
      const pretty = serializer.prettyPrint(baseRecord);
      expect(pretty).toContain('\n');
      expect(pretty).toContain('  ');
      // Should be parseable
      expect(() => JSON.parse(pretty)).not.toThrow();
    });

    it('converts Date objects in data to ISO strings in pretty output', () => {
      const record: SyncRecord = {
        ...baseRecord,
        data: { ts: new Date('2024-01-01T00:00:00.000Z') },
      };
      const pretty = serializer.prettyPrint(record);
      expect(pretty).toContain('2024-01-01T00:00:00.000Z');
    });
  });
});

const opSerializer = new OperationSerializer();

const baseOperation: Operation = {
  id: 'op-uuid-1234',
  type: 'update',
  recordId: 'rec-uuid-5678',
  payload: { name: 'Bob', score: 99 },
  version: 3,
  idempotencyKey: 'idem-key-abcd',
};

describe('OperationSerializer', () => {
  describe('serialize', () => {
    it('produces a valid JSON string', () => {
      const json = opSerializer.serialize(baseOperation);
      expect(() => JSON.parse(json)).not.toThrow();
    });

    it('preserves all Operation fields', () => {
      const json = opSerializer.serialize(baseOperation);
      const parsed = JSON.parse(json);
      expect(parsed.id).toBe(baseOperation.id);
      expect(parsed.type).toBe(baseOperation.type);
      expect(parsed.recordId).toBe(baseOperation.recordId);
      expect(parsed.version).toBe(baseOperation.version);
      expect(parsed.idempotencyKey).toBe(baseOperation.idempotencyKey);
      expect(parsed.payload).toEqual(baseOperation.payload);
    });

    it('handles all operation types', () => {
      for (const type of ['create', 'update', 'delete'] as const) {
        const op: Operation = { ...baseOperation, type };
        const json = opSerializer.serialize(op);
        expect(JSON.parse(json).type).toBe(type);
      }
    });

    it('handles empty payload', () => {
      const op: Operation = { ...baseOperation, payload: {} };
      const json = opSerializer.serialize(op);
      expect(JSON.parse(json).payload).toEqual({});
    });
  });

  describe('deserialize', () => {
    it('parses a JSON string into an Operation', () => {
      const json = opSerializer.serialize(baseOperation);
      const result = opSerializer.deserialize(json);
      expect(result.id).toBe(baseOperation.id);
      expect(result.type).toBe(baseOperation.type);
      expect(result.recordId).toBe(baseOperation.recordId);
      expect(result.version).toBe(baseOperation.version);
      expect(result.idempotencyKey).toBe(baseOperation.idempotencyKey);
    });

    it('restores payload correctly', () => {
      const json = opSerializer.serialize(baseOperation);
      const result = opSerializer.deserialize(json);
      expect(result.payload).toEqual(baseOperation.payload);
    });
  });

  describe('round-trip', () => {
    it('deserialize(serialize(op)) is deeply equal to original', () => {
      const json = opSerializer.serialize(baseOperation);
      const result = opSerializer.deserialize(json);
      expect(result).toEqual(baseOperation);
    });

    it('round-trips nested payload objects', () => {
      const op: Operation = {
        ...baseOperation,
        payload: { nested: { a: 1, b: [2, 3] }, flag: true },
      };
      const result = opSerializer.deserialize(opSerializer.serialize(op));
      expect(result.payload).toEqual(op.payload);
    });
  });
});
