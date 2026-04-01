import { QueuedOperation } from '../types';
import { getDb } from './database';
import { STORE_NAMES } from './schema';

export async function getPendingOperations(): Promise<QueuedOperation[]> {
  const db = await getDb();
  const index = db.transaction(STORE_NAMES.OFFLINE_QUEUE).store.index('status');
  const all = await index.getAll('pending');
  const now = Date.now();
  // exclude operations whose retry delay has not yet elapsed
  return all.filter((op) => !op.nextRetryAt || new Date(op.nextRetryAt).getTime() <= now);
}

export async function enqueueOperation(op: QueuedOperation): Promise<void> {
  const db = await getDb();
  await db.put(STORE_NAMES.OFFLINE_QUEUE, op);
}

export async function updateOperationStatus(
  id: string,
  status: QueuedOperation['status'],
): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(STORE_NAMES.OFFLINE_QUEUE, 'readwrite');
  const existing = await tx.store.get(id);
  if (existing) {
    await tx.store.put({ ...existing, status });
  }
  await tx.done;
}

export async function markOperationApplied(id: string): Promise<void> {
  return updateOperationStatus(id, 'applied');
}

export async function removeOperation(id: string): Promise<void> {
  const db = await getDb();
  await db.delete(STORE_NAMES.OFFLINE_QUEUE, id);
}

export async function updateOperation(
  id: string,
  patch: Partial<Pick<QueuedOperation, 'status' | 'retries' | 'nextRetryAt'>>,
): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(STORE_NAMES.OFFLINE_QUEUE, 'readwrite');
  const existing = await tx.store.get(id);
  if (existing) {
    await tx.store.put({ ...existing, ...patch });
  }
  await tx.done;
}
