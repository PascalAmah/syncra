# Syncra — Offline-First Sync Engine

Syncra is a production-grade offline-first sync engine that ensures data consistency, reliability, and seamless operation in unreliable network environments. It provides a TypeScript SDK for client applications and a NestJS backend API that handles batched sync operations, conflict resolution, delta pulls, and retry logic.

---

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Monorepo Structure](#monorepo-structure)
- [Tech Stack](#tech-stack)
- [Getting Started](#getting-started)
- [Environment Variables](#environment-variables)
- [Running the Project](#running-the-project)
- [SDK Usage](#sdk-usage)
- [API Reference](#api-reference)
- [Sync Flow](#sync-flow)
- [Conflict Resolution](#conflict-resolution)
- [Retry Strategy](#retry-strategy)
- [Database Schema](#database-schema)
- [Testing](#testing)
- [Scripts](#scripts)
- [License](#license)

---

## Overview

Syncra solves the hard problem of keeping client data in sync with a server when the network is unreliable or unavailable. Key capabilities:

- **Offline-first writes** — records are written to IndexedDB immediately, no network required
- **Batched sync** — pending operations are flushed to the server in a single request when online
- **Delta pull** — only changed records since the last sync are fetched from the server
- **Conflict resolution** — last-write-wins by default, with support for custom resolution handlers
- **Idempotent operations** — every operation carries a unique idempotency key, preventing duplicates
- **Exponential backoff retries** — failed syncs are retried automatically with increasing delays
- **Async job support** — large sync batches are processed asynchronously via BullMQ with polling

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     Client App                          │
│                                                         │
│  ┌──────────────┐    ┌──────────────────────────────┐  │
│  │  SyncraSDK   │───▶│  IndexedDB (records + queue) │  │
│  └──────┬───────┘    └──────────────────────────────┘  │
│         │ online?                                        │
└─────────┼───────────────────────────────────────────────┘
          │ HTTPS
          ▼
┌─────────────────────────────────────────────────────────┐
│                   NestJS API                            │
│                                                         │
│  POST /sync ──▶ BullMQ Queue ──▶ Sync Worker           │
│  GET  /sync/updates ──▶ Delta Query                     │
│  GET  /sync/job/:id ──▶ Job Status Poll                 │
│                                                         │
│  ┌──────────────┐    ┌──────────────────────────────┐  │
│  │  PostgreSQL  │    │          Redis               │  │
│  │  (records,   │    │  (BullMQ job queue + cache)  │  │
│  │   versions,  │    └──────────────────────────────┘  │
│  │   events)    │                                       │
│  └──────────────┘                                       │
└─────────────────────────────────────────────────────────┘
```

---

## Monorepo Structure

```
syncra/
├── apps/
│   ├── api/              # NestJS backend API
│   ├── sdk/              # TypeScript client SDK
│   ├── demo-app/         # React demo application
│   └── landing/          # Landing page & dashboard UI
├── packages/
│   ├── core/             # Shared types, interfaces, utilities
│   └── config/           # Environment configuration schemas
├── infra/
│   ├── docker/           # Docker Compose for local dev
│   └── scripts/          # Migration runner and setup scripts
├── docs/                 # Architecture and API documentation
└── files/                # Project assets and build guides
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Node.js, NestJS, TypeScript |
| Database | PostgreSQL (records, versions, events) |
| Queue / Cache | Redis, BullMQ |
| Client SDK | TypeScript, IndexedDB (via `idb`) |
| Demo App | React 18, Vite, Zustand |
| Testing | Vitest, fast-check (property-based testing) |
| Monorepo | pnpm workspaces, Turborepo |
| Infrastructure | Docker, Docker Compose |

---

## Getting Started

### Prerequisites

- Node.js >= 18.0.0
- pnpm >= 8.0.0
- Docker & Docker Compose

### Installation

```bash
# 1. Clone the repo
git clone https://github.com/your-org/syncra.git
cd syncra

# 2. Install all workspace dependencies
pnpm install

# 3. Start PostgreSQL and Redis via Docker
cd infra/docker
docker-compose up -d

# 4. Copy and configure environment variables
cp infra/docker/.env.example apps/api/.env

# 5. Run database migrations
pnpm --filter @syncra/api migrate

# 6. Start all apps in development mode
pnpm run start:dev
```

---

## Environment Variables

Create `apps/api/.env` with the following:

```env
# Database
DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASS=postgres
DB_NAME=syncra

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379

# Auth
JWT_SECRET=your-secret-here
JWT_EXPIRES_IN=7d

# App
PORT=3000
NODE_ENV=development
```

---

## Running the Project

```bash
# Build all packages
pnpm build

# Start API in dev mode
pnpm --filter @syncra/api start:dev

# Start demo app
pnpm --filter @syncra/demo-app dev

# Run all tests
pnpm test

# Lint all packages
pnpm lint

# Type-check all packages
pnpm type-check
```

---

## SDK Usage

### Install

```bash
npm install @syncra/sdk
```

### Initialize

```ts
import { SyncraSDK } from '@syncra/sdk';

const syncra = new SyncraSDK({
  baseUrl: 'https://api.syncra.dev',
  apiKey: 'syncra_pk_live_your_key_here',
  userId: 'user_123',          // optional
  syncInterval: 30000,         // auto-sync every 30s (default)
});

await syncra.initialize(); // restores state from IndexedDB on page reload
```

### CRUD Operations

```ts
// Create — written to IndexedDB immediately, queued for sync
const record = await syncra.createRecord({ name: 'Task', done: false });

// Update
const updated = await syncra.updateRecord(record.id, { name: 'Task', done: true });

// Delete
await syncra.deleteRecord(record.id);

// Read all local records
const records = syncra.getRecords();
```

### Manual Sync

```ts
const result = await syncra.sync();
console.log(`Applied: ${result.applied}, Conflicts: ${result.rejected}`);
```

### Events

```ts
syncra.on('sync-start', () => console.log('Syncing...'));
syncra.on('sync-complete', ({ applied, rejected }) => {
  console.log(`Done — ${applied} applied, ${rejected} conflicts`);
});
syncra.on('sync-failed', ({ error }) => console.error(error));
syncra.on('conflict', (conflict) => console.warn('Conflict:', conflict));
syncra.on('online', () => console.log('Back online'));
syncra.on('offline', () => console.log('Gone offline'));
```

### Custom Conflict Resolution

```ts
syncra.onConflict((conflict) => ({
  id: conflict.recordId,
  data: conflict.serverData,     // accept server version
  version: conflict.serverVersion,
}));
```

### SDK Options

| Option | Type | Default | Description |
|---|---|---|---|
| `baseUrl` | `string` | `''` | Syncra API base URL |
| `apiKey` | `string` | — | Project API key |
| `userId` | `string` | — | Optional user identifier (`x-user-id` header) |
| `syncInterval` | `number` | `30000` | Auto-sync interval in ms. Set to `0` to disable |
| `networkStateManagerOptions` | `object` | — | Custom network detection options |

---

## API Reference

### `POST /sync`

Push a batch of pending operations to the server.

**Request body:**
```json
{
  "operations": [
    {
      "id": "uuid",
      "type": "create",
      "recordId": "uuid",
      "payload": { "name": "Task" },
      "version": 1,
      "idempotencyKey": "uuid"
    }
  ]
}
```

**Response (200):**
```json
{
  "applied": [{ "operationId": "uuid", "recordId": "uuid", "newVersion": 2 }],
  "rejected": [{ "operationId": "uuid", "recordId": "uuid", "clientVersion": 1, "serverVersion": 3, "serverData": {} }]
}
```

**Response (202 — async):** Returns `{ "jobId": "uuid" }`. Poll `GET /sync/job/:jobId` for the result.

---

### `GET /sync/updates?since=<ISO timestamp>`

Fetch all records updated since the given timestamp (delta pull).

**Response:**
```json
{
  "records": [{ "id": "uuid", "data": {}, "version": 2, "updated_at": "...", "created_at": "..." }],
  "deletedRecordIds": ["uuid"]
}
```

---

### `GET /sync/job/:jobId`

Poll the status of an async sync job.

**Response:**
```json
{
  "jobId": "uuid",
  "status": "completed",
  "result": { "applied": [], "rejected": [] }
}
```

---

### `POST /auth/register` / `POST /auth/login`

Standard JWT-based authentication. Returns a bearer token used for user-scoped requests.

---

### `GET /projects` / `POST /projects`

Manage projects. Each project has an API key (`syncra_pk_live_...`) used by the SDK.

---

## Sync Flow

```
1. User performs action (create / update / delete)
2. Record written to IndexedDB immediately
3. Operation enqueued in IndexedDB offline queue
4. When online:
   a. SDK sends batch to POST /sync
   b. Server validates idempotency keys (no duplicate processing)
   c. Server checks record versions
   d. Applied operations update records + log events
   e. Rejected operations (conflicts) returned to client
5. Client processes conflicts (last-write-wins or custom handler)
6. Client pulls delta via GET /sync/updates
7. Local IndexedDB updated with server state
8. Last sync timestamp saved for next delta pull
```

---

## Conflict Resolution

When a client operation is rejected due to a version mismatch, Syncra provides two strategies:

**Last-write-wins (default):** The server version overwrites the local record. The conflicting operation is removed from the queue.

**Custom handler:** Register a handler with `syncra.onConflict(fn)`. The handler receives the conflict details and returns a resolved record, which is re-enqueued as an update operation.

```ts
syncra.onConflict(({ recordId, clientVersion, serverVersion, serverData }) => ({
  id: recordId,
  data: { ...serverData, myField: 'merged value' },
  version: serverVersion,
}));
```

---

## Retry Strategy

Failed sync requests are retried with exponential backoff:

```
retryDelay = baseDelay * (2 ^ retryCount)
```

- Max retries: **5** (configurable per operation)
- After max retries, the operation is marked `failed` and a `sync-failed` event is emitted
- Network errors trigger retry; 4xx client errors do not

---

## Database Schema

| Table | Purpose |
|---|---|
| `users` | User accounts (email + hashed password) |
| `records` | Versioned JSONB data records per user |
| `sync_operations` | Audit log of all sync operations with idempotency keys |
| `events` | Immutable event log per record |
| `versions` | Denormalized version cache for fast conflict checks |
| `projects` | Projects with associated API keys |

Migrations live in `apps/api/migrations/` and run in order via the migration service.

---

## Testing

Syncra uses [Vitest](https://vitest.dev/) for unit tests and [fast-check](https://fast-check.io/) for property-based testing.

```bash
# Run all tests
pnpm test

# Run tests for a specific package
pnpm --filter @syncra/api test
pnpm --filter @syncra/sdk test

# Run in watch mode
pnpm --filter @syncra/sdk vitest
```

Property-based tests are in `*.properties.spec.ts` files and verify correctness invariants like idempotency, ordering guarantees, and conflict resolution consistency.

---

## Scripts

| Command | Description |
|---|---|
| `pnpm build` | Build all packages |
| `pnpm test` | Run all tests |
| `pnpm lint` | Lint all packages |
| `pnpm type-check` | TypeScript type checking across all packages |
| `pnpm --filter @syncra/api migrate` | Run pending database migrations |
| `docker-compose up -d` | Start PostgreSQL and Redis locally |

---

## License

MIT
