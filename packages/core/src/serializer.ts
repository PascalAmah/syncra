import type { Operation, SyncRecord } from './types';
import { isValidOperation, isValidRecord } from './validators';

// ISO 8601 date string pattern
const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

/**
 * JSON replacer that converts Date objects in the `data` field to ISO 8601 strings.
 * Used during serialization.
 */
function dateReplacer(this: any, key: string, value: any): any {
  // `this` is the object containing the key; convert Date to ISO string
  const raw = this[key];
  if (raw instanceof Date) {
    return raw.toISOString();
  }
  return value;
}

/**
 * JSON reviver that converts ISO 8601 date strings inside `data` back to Date objects.
 * Only applies to keys nested under `data`.
 *
 * JSON.parse reviver is called bottom-up. When the reviver is called for the `data`
 * key, its value is already the fully-assembled object (with string leaves). We
 * post-process that object in-place to convert ISO strings to Dates.
 */
function dataReviver(_key: string, value: any): any {
  if (_key === 'data' && typeof value === 'object' && value !== null) {
    return convertIsoStringsInObject(value);
  }
  return value;
}

function convertIsoStringsInObject(obj: Record<string, any>): Record<string, any> {
  const result: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'string' && ISO_DATE_REGEX.test(v)) {
      result[k] = new Date(v);
    } else if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
      result[k] = convertIsoStringsInObject(v);
    } else {
      result[k] = v;
    }
  }
  return result;
}

export class RecordSerializer {
  /**
   * Serializes a SyncRecord to a JSON string.
   * Date objects in `data` are converted to ISO 8601 strings.
   */
  serialize(record: SyncRecord): string {
    return JSON.stringify(record, dateReplacer);
  }

  /**
   * Deserializes a JSON string back into a typed SyncRecord.
   * ISO 8601 date strings in `data` are converted back to Date objects.
   * Throws if the parsed value does not conform to the SyncRecord shape.
   */
  deserialize(json: string): SyncRecord {
    const parsed: unknown = JSON.parse(json, dataReviver);
    if (!isValidRecord(parsed)) {
      throw new Error(
        'Invalid SyncRecord: expected { id, data, version, updated_at, created_at }',
      );
    }
    return parsed;
  }

  /**
   * Formats a SyncRecord as a human-readable JSON string (2-space indent).
   */
  prettyPrint(record: SyncRecord): string {
    return JSON.stringify(record, dateReplacer, 2);
  }
}

export class OperationSerializer {
  /**
   * Serializes an Operation to a JSON string.
   * All fields (id, type, recordId, payload, version, idempotencyKey) are preserved.
   */
  serialize(op: Operation): string {
    return JSON.stringify(op);
  }

  /**
   * Deserializes a JSON string back into a typed Operation.
   * Throws if the parsed value does not conform to the Operation shape.
   */
  deserialize(json: string): Operation {
    const parsed: unknown = JSON.parse(json);
    if (!isValidOperation(parsed)) {
      throw new Error(
        'Invalid Operation: expected { id, type, recordId, payload, version, idempotencyKey }',
      );
    }
    return parsed;
  }

  /**
   * Formats an Operation as a human-readable JSON string (2-space indent).
   */
  prettyPrint(op: Operation): string {
    return JSON.stringify(op, null, 2);
  }
}
