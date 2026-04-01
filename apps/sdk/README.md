# syncra-sdk

Offline-first sync SDK for the web. Records are written locally to IndexedDB instantly and synced to the Syncra API whenever the device is online.

## Install

```bash
npm install syncra-sdk
# or
yarn add syncra-sdk
# or
pnpm add syncra-sdk
```

## Quick Start

```ts
import { SyncraSDK } from 'syncra-sdk';

const syncra = new SyncraSDK({
  baseUrl: 'https://syncra-bwd0.onrender.com',
  apiKey: 'syncra_pk_live_your_key_here',
  userId: 'user_123',
});

// Restore state from IndexedDB on app load
await syncra.initialize();

// Create a record — persisted locally immediately, synced when online
const record = await syncra.createRecord({ name: 'Task', done: false });

// Update a record
const updated = await syncra.updateRecord(record.id, { name: 'Task', done: true });

// Delete a record
await syncra.deleteRecord(record.id);

// Read all local records
const records = syncra.getRecords();

// Manually trigger a sync
await syncra.sync();

// Clean up listeners and timers when done
syncra.destroy();
```

## Get an API Key

1. Sign up at [syncra-six.vercel.app](https://syncra-six.vercel.app)
2. Go to your **Dashboard**
3. Click **Create Project** and give it a name
4. Copy the API key — it looks like `syncra_pk_live_...`

## Constructor Options

| Option | Type | Required | Default | Description |
|---|---|---|---|---|
| `baseUrl` | `string` | Yes | — | Syncra API base URL |
| `apiKey` | `string` | Yes | — | Project API key from the dashboard |
| `userId` | `string` | No | — | User identifier sent as `x-user-id` header |
| `syncInterval` | `number` | No | `30000` | Auto-sync interval in ms. Set to `0` to disable |

## API

### `initialize(): Promise<void>`
Restores records and pending operations from IndexedDB. Call this once on app load before any reads or writes.

### `createRecord(data): Promise<LocalRecord>`
Creates a record locally and queues a create operation for sync.

### `updateRecord(id, data): Promise<LocalRecord>`
Updates a record locally and queues an update operation for sync.

### `deleteRecord(id): Promise<void>`
Deletes a record locally and queues a delete operation for sync.

### `getRecords(): LocalRecord[]`
Returns all records currently in the local in-memory cache.

### `getPendingOperations(): LocalQueuedOperation[]`
Returns all operations waiting to be synced.

### `sync(): Promise<SyncResult>`
Manually triggers a push/pull sync cycle. No-op when offline.

### `isOnlineState(): boolean`
Returns the current network state.

### `setApiKey(key: string): void`
Updates the API key at runtime (e.g. after project creation).

### `setUserId(id: string): void`
Updates the user ID at runtime.

### `on(event, listener): void`
Subscribe to a sync event.

### `off(event, listener): void`
Unsubscribe from a sync event.

### `onConflict(handler): void`
Register a custom conflict resolution handler. If not set, last-write-wins (server data takes precedence).

### `destroy(): void`
Cleans up network listeners and stops the auto-sync interval.

## Events

| Event | Payload | Description |
|---|---|---|
| `sync-start` | — | Sync cycle started |
| `sync-complete` | `{ applied: number, rejected: number }` | Sync finished successfully |
| `sync-failed` | `{ error: Error }` | Sync encountered an error |
| `conflict` | `LocalConflict` | A conflict was detected during sync |
| `online` | — | Device came online |
| `offline` | — | Device went offline |

```ts
syncra.on('sync-complete', ({ applied, rejected }) => {
  console.log(`Synced: ${applied} applied, ${rejected} conflicts`);
});

syncra.on('sync-failed', ({ error }) => {
  console.error('Sync failed:', error.message);
});

syncra.on('offline', () => {
  console.log('Working offline — changes will sync when reconnected');
});
```

## Conflict Resolution

By default, conflicts are resolved with last-write-wins (server wins). You can override this:

```ts
syncra.onConflict((conflict) => {
  // conflict.recordId       — the record that conflicted
  // conflict.clientVersion  — your local version
  // conflict.serverVersion  — the server version
  // conflict.serverData     — the server's data

  // Return the resolved data and version
  return {
    data: { ...conflict.serverData, ...myLocalChanges },
    version: conflict.serverVersion,
  };
});
```

## TypeScript Types

```ts
interface LocalRecord {
  id: string;
  data: Record<string, unknown>;
  version: number;
  updatedAt: Date;
  createdAt: Date;
}

interface LocalConflict {
  recordId: string;
  clientVersion: number;
  serverVersion: number;
  serverData: Record<string, unknown>;
}

interface SyncResult {
  applied: number;
  rejected: number;
}
```

## Offline Behavior

- All writes (`create`, `update`, `delete`) succeed immediately regardless of network state
- Operations are persisted to IndexedDB and survive page reloads
- When the device comes back online, a sync is triggered automatically
- Failed sync operations are retried with exponential backoff (up to 5 retries)

## License

MIT
