# Syncra Demo App — Field Service Jobs

A runnable example of the **Syncra SDK** (offline-first sync engine). It mounts the
SDK inside a small React app: every job you create/edit/delete is a Syncra
*record*, stored immediately in **IndexedDB** and synced to the Syncra API
whenever the device is online.

> Use this to evaluate Syncra: see offline writes, automatic re-sync, delta
> pulls, and conflict resolution working end to end.

---

## What it demonstrates

| Syncra feature | Where to see it |
|---|---|
| Offline-first writes | Create/edit a job while offline — it saves instantly (IndexedDB) |
| Pending sync queue | Yellow "Unsaved" dot on cards + **Pending Sync** stat |
| Auto re-sync on reconnect | Go back online — queued changes flush automatically |
| Delta pull (server → client) | Sync pulls latest server records into the local store |
| Conflict resolution | Server-wins dialog when two clients edit the same job |
| Live status events | `sync-start` / `sync-complete` / `sync-failed` / `online` / `offline` in the status bar |

---

## Prerequisites

You need a running Syncra API to see actual syncing:

```bash
# 1. Start PostgreSQL + Redis (Docker)
cd infra/docker && docker-compose up -d

# 2. Configure and run the API from the repo root
cp infra/docker/.env.example apps/api/.env
pnpm --filter @syncra/api start:dev        # serves on http://localhost:3000
```

### API URL

The app resolves the API base URL from the `VITE_SYNCRA_API_URL` env var
(set at build/dev time), falling back to `http://localhost:3000/api`:

```bash
# local dev (default fallback is fine)
pnpm --filter @syncra/demo-app dev

# if your API is elsewhere
VITE_SYNCRA_API_URL=http://localhost:3000/api pnpm --filter @syncra/demo-app dev
```

> **Deploying:** set `VITE_SYNCRA_API_URL` as an env var on your host (e.g.
> Vercel dashboard / build), pointing at the deployed Syncra API. Keep it in
> sync with the API's `CORS_ORIGINS` allowed-origins list.

### Account + API key

1. Register / log in from the demo's login screen (creates the account and sets
   the JWT used for requests).
2. The SDK also supports an API key. Set it in the browser before loading the
   app, e.g. in DevTools console:

   ```js
   localStorage.setItem('syncra_api_key', 'syncra_pk_live_...');
   location.reload();
   ```

   If you don't have a key, the demo still works — it authenticates with the
   login JWT instead.

---

## Run it

```bash
pnpm install
pnpm --filter @syncra/demo-app dev
```

Open the printed URL (default `http://localhost:5173`).

---

## 30-second test script

1. **Create / edit a job** → saved locally immediately.
2. **Go offline**: DevTools → Network → throttling → "Offline".
   Edit a job again → the card shows a yellow "Unsaved" dot and **Pending
   Sync** increases. No error — the write succeeded locally.
3. **Go back online** → the SDK auto-syncs; the dot turns green and the server
   copy is updated.
4. **Force a conflict**: open the demo in a **second browser tab** logged into
   the same account. Edit the *same* job in both tabs while offline, then bring
   both online → the **Conflict** dialog appears, and server data wins.

> Tip: collapse the "What am I looking at?" panel at the top of the board for a
> copy of these instructions in-app.

---

## Code map

| File | Purpose |
|---|---|
| `src/context/SdkContext.tsx` | Constructs the SDK, calls `initialize()`, shares it via React context |
| `src/pages/JobsPage.tsx` | CRUD + sync orchestration against the SDK |
| `src/components/sync/SyncStatus.tsx` | Subscribes to SDK events, shows live sync state |
| `src/components/sync/ConflictDialog.tsx` | Renders `conflict` events (server-wins) |
| `src/components/sync/AboutPanel.tsx` | In-app "what am I looking at / how to test" |
| `src/config/index.ts` | Resolves the API URL from env |
| `src/types/index.ts` | The `Job` domain shape (lives inside a record's `data`) |

## License

MIT
