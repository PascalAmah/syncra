import { openDB, deleteDB, IDBPDatabase } from 'idb';
import { DB_NAME, DB_VERSION, STORE_NAMES, INDEXES } from './schema';

export type SyncraDB = IDBPDatabase;

let dbInstance: SyncraDB | null = null;

/**
 * Opens (or creates) the syncra-db IndexedDB database with the required
 * object stores and indexes. Handles schema migrations via the upgrade callback.
 */
export async function openDatabase(): Promise<SyncraDB> {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db, oldVersion) {
      // Version 0 → 1: initial schema
      if (oldVersion < 1) {
        // records store
        const recordsStore = db.createObjectStore(STORE_NAMES.RECORDS, { keyPath: 'id' });
        recordsStore.createIndex(
          INDEXES.RECORDS.USER_ID.name,
          INDEXES.RECORDS.USER_ID.keyPath,
          INDEXES.RECORDS.USER_ID.options,
        );
        recordsStore.createIndex(
          INDEXES.RECORDS.UPDATED_AT.name,
          INDEXES.RECORDS.UPDATED_AT.keyPath,
          INDEXES.RECORDS.UPDATED_AT.options,
        );

        // offline_queue store
        const queueStore = db.createObjectStore(STORE_NAMES.OFFLINE_QUEUE, { keyPath: 'id' });
        queueStore.createIndex(
          INDEXES.OFFLINE_QUEUE.STATUS.name,
          INDEXES.OFFLINE_QUEUE.STATUS.keyPath,
          INDEXES.OFFLINE_QUEUE.STATUS.options,
        );
        queueStore.createIndex(
          INDEXES.OFFLINE_QUEUE.RETRIES.name,
          INDEXES.OFFLINE_QUEUE.RETRIES.keyPath,
          INDEXES.OFFLINE_QUEUE.RETRIES.options,
        );
        queueStore.createIndex(
          INDEXES.OFFLINE_QUEUE.CREATED_AT.name,
          INDEXES.OFFLINE_QUEUE.CREATED_AT.keyPath,
          INDEXES.OFFLINE_QUEUE.CREATED_AT.options,
        );

        // metadata store
        db.createObjectStore(STORE_NAMES.METADATA, { keyPath: 'key' });
      }

      // Version 1 → 2: add new indexes or stores here when needed
      // if (oldVersion < 2) { ... }
    },
  });
}

/**
 * Returns a cached DB instance, opening the database on first call.
 */
export async function getDb(): Promise<SyncraDB> {
  if (!dbInstance) {
    dbInstance = await openDatabase();
  }
  return dbInstance;
}

/**
 * Closes the current DB connection and resets the singleton.
 * Useful for cleanup in tests or before re-opening with a new version.
 */
export function closeDatabase(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}

/**
 * Deletes the entire database and resets the singleton.
 * Intended for test environments only.
 */
export async function resetDatabase(): Promise<void> {
  closeDatabase();
  await deleteDB(DB_NAME);
}
