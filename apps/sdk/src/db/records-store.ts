import { SyncRecord } from '../types';
import { getDb } from './database';
import { STORE_NAMES } from './schema';

export async function getAllRecords(userId: string): Promise<SyncRecord[]> {
  const db = await getDb();
  const index = db.transaction(STORE_NAMES.RECORDS).store.index('user_id');
  return index.getAll(userId);
}

export async function getRecord(id: string): Promise<SyncRecord | undefined> {
  const db = await getDb();
  return db.get(STORE_NAMES.RECORDS, id);
}

export async function upsertRecord(record: SyncRecord): Promise<void> {
  const db = await getDb();
  await db.put(STORE_NAMES.RECORDS, record);
}

export async function deleteRecord(id: string): Promise<void> {
  const db = await getDb();
  await db.delete(STORE_NAMES.RECORDS, id);
}
