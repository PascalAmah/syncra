/**
 * IndexedDB schema constants for Syncra SDK
 */

export const DB_NAME = 'syncra-db';
export const DB_VERSION = 1;

export const STORE_NAMES = {
  RECORDS: 'records',
  OFFLINE_QUEUE: 'offline_queue',
  METADATA: 'metadata',
} as const;

export type StoreName = (typeof STORE_NAMES)[keyof typeof STORE_NAMES];

export const INDEXES = {
  RECORDS: {
    USER_ID: { name: 'user_id', keyPath: 'user_id', options: { unique: false } },
    UPDATED_AT: { name: 'updated_at', keyPath: 'updated_at', options: { unique: false } },
  },
  OFFLINE_QUEUE: {
    STATUS: { name: 'status', keyPath: 'status', options: { unique: false } },
    RETRIES: { name: 'retries', keyPath: 'retries', options: { unique: false } },
    CREATED_AT: { name: 'created_at', keyPath: 'createdAt', options: { unique: false } },
  },
} as const;
