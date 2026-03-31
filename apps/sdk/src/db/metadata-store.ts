import { getDb } from './database';
import { STORE_NAMES } from './schema';

interface MetadataEntry {
  key: string;
  value: string;
}

export async function getMetadata(key: string): Promise<string | undefined> {
  const db = await getDb();
  const entry = await db.get(STORE_NAMES.METADATA, key) as MetadataEntry | undefined;
  return entry?.value;
}

export async function setMetadata(key: string, value: string): Promise<void> {
  const db = await getDb();
  await db.put(STORE_NAMES.METADATA, { key, value } satisfies MetadataEntry);
}
