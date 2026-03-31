# Syncra SDK — Quick Start

## Install

```bash
npm install @syncra/sdk
```

## Usage

```ts
import { SyncraSDK } from '@syncra/sdk';

const syncra = new SyncraSDK({
  baseUrl: 'https://api.syncra.com',
  apiKey: 'syncra_pk_live_your_key_here',
  // optional: tie records to a specific user
  userId: 'user_123',
});

await syncra.initialize();

// Create a record — stored locally immediately, synced when online
const record = await syncra.createRecord({ name: 'Test', value: 42 });

// Trigger a manual sync
await syncra.sync();

// Listen to sync events
syncra.on('sync-complete', ({ applied, rejected }) => {
  console.log(`Synced ${applied} records, ${rejected} conflicts`);
});

// Custom conflict resolution (optional)
syncra.onConflict((conflict) => ({
  id: conflict.recordId,
  data: conflict.serverData,   // accept server version
  version: conflict.serverVersion,
}));
```

## How to get an API key

1. Sign up at [syncra.dev](https://syncra.dev)
2. Go to your **Dashboard**
3. Click **Create Project** and give it a name
4. Copy the API key shown under your project — it looks like `syncra_pk_live_...`

## SDK Options

| Option | Type | Required | Description |
|---|---|---|---|
| `baseUrl` | `string` | Yes | Your Syncra API base URL |
| `apiKey` | `string` | Yes | Project API key from the dashboard |
| `userId` | `string` | No | Optional user identifier sent as `x-user-id` |
| `syncInterval` | `number` | No | Auto-sync interval in ms (default: `30000`) |

## Events

| Event | Payload | Description |
|---|---|---|
| `sync-start` | — | Sync cycle started |
| `sync-complete` | `{ applied, rejected }` | Sync finished |
| `sync-failed` | `{ error }` | Sync encountered an error |
| `conflict` | `LocalConflict` | A conflict was detected |
| `online` | — | Device came online |
| `offline` | — | Device went offline |
