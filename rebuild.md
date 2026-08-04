# Syncra Rebuild Roadmap

## Audit Summary (2026-07-29)

### Current Architecture

```
apps/api/           NestJS backend — 7 modules (auth, sync, records, projects, health, database, logger)
apps/sdk/           Standalone TypeScript SDK — IndexedDB + fetch-based sync client
apps/demo-app/      React 18 + Vite + Zustand — login, CRUD, sync status, conflict dialog
apps/landing/       Static HTML pages — disconnected from monorepo build pipeline
packages/core/      6 files — types, serializers, validators
packages/config/    2 files — Zod env schema + barrel export
infra/docker/       docker-compose: Postgres 15 Alpine + Redis 7 Alpine
infra/scripts/      Migration runner (tsx script)
```

**Data flow**: Client SDK writes to IndexedDB → queues operations → `POST /sync` → BullMQ queue → worker calls `SyncService.processOperations()` → PostgreSQL (transactions, version checks, idempotency) → client polls `GET /sync/job/:jobId` → `GET /sync/updates?cursor=` for delta pull.

### Top 10 Technical Problems (Ranked by Severity)

| # | Problem | Risk |
|---|---------|------|
| 1 | Timestamp-based delta pull — non-monotonic, clock-skew vulnerable | Data loss / stale reads |
| 2 | TOCTOU in version check vs mutation | Duplicate writes / inconsistency |
| 3 | No tombstone mechanism for deletes | Clients miss deletions |
| 4 | No collection/namespace concept | All records share one flat space |
| 5 | No client/device identity | Can't debug or track per-client state |
| 6 | No pagination on delta pull | OOM / timeout with large datasets |
| 7 | HealthService private field access | Runtime breakage on refactor |
| 8 | Environment variable docs/code mismatch | Developer can't start from README |
| 9 | MigrationService independent pool | Config drift, lifecycle mismatch |
| 10 | No multi-client test coverage | Core sync bugs untested |

---

## Implementation Phases

### Phase 1 — Monotonic Sync Cursor ✅ COMPLETE

**Status**: Done

Replace `updated_at > $since` with `cursor > $cursor` using a PostgreSQL `BIGSERIAL` sequence. Guarantees deterministic, monotonic ordering immune to clock skew.

**Files changed**:
- `apps/api/migrations/00008_sync_cursor.sql` (new)
- `apps/api/src/sync/dto/sync.dto.ts`
- `apps/api/src/sync/sync.controller.ts`
- `apps/api/src/sync/sync.service.ts`
- `packages/core/src/types.ts`
- `apps/sdk/src/types.ts`
- `apps/sdk/src/syncra-sdk.ts`

---

### Phase 2 — Tombstones + TOCTOU Fix ✅ COMPLETE

**Status**: Done

- **2a. Tombstones**: Added `tombstones` table whose `cursor` is drawn from the **same `records_cursor_seq`** as records, so records and tombstones share a single monotonic cursor space (migration `00012` converts existing databases that previously used a separate `BIGSERIAL` sequence). Every delete inserts a tombstone row. Delta pull returns tombstones alongside records, replacing the unbounded `sync_operations` scan.
- **2b. TOCTOU fix**: Merged `checkVersionConflict()` into `applyOperation()`. Version check uses `SELECT ... FOR UPDATE` inside the same transaction, eliminating the race window.

**Files changed**:
- `apps/api/migrations/00009_tombstones.sql` (new)
- `apps/api/src/sync/sync.service.ts`
- `apps/api/src/sync/dto/sync.dto.ts`
- `packages/core/src/types.ts`
- `apps/sdk/src/types.ts`
- `apps/sdk/src/syncra-sdk.ts`
- `apps/api/src/sync/sync.service.test.ts`
- `apps/api/src/api.properties.spec.ts`

---

### Phase 3 — Pagination ✅ COMPLETE

**Status**: Done

**What**: SDK's `pullDelta()` now loops with `PAGE_SIZE=500` until both records and tombstones return fewer than a full page. Also extracted `buildHeaders()` helper to eliminate duplicated auth-header logic.

**Files changed**:
- `apps/sdk/src/syncra-sdk.ts`

---

### Phase 4 — Client & Device Identity ✅ COMPLETE

**Status**: Done

**What**: SDK generates a persistent `clientId` (UUID, stored in IndexedDB metadata) and sends it as `x-client-id` header. Server upserts `client_cursors` table on each delta pull for per-client sync tracking.

**Files changed**:
- `apps/api/migrations/00010_client_cursors.sql` (new)
- `apps/api/src/sync/sync.controller.ts`
- `apps/api/src/sync/sync.service.ts`
- `apps/sdk/src/syncra-sdk.ts`

---

### Phase 5 — Collection Abstraction ✅ COMPLETE

**Status**: Done

**What**: SDK API now supports `syncra.collection("tasks").create(data)`. Collections are namespaced record groups with no schema enforcement. Old flat API (`createRecord(data)`) still works, defaulting to `'default'` collection. Server filters delta pulls by collection.

**Files changed**:
- `apps/api/migrations/00011_collections.sql` (new)
- `apps/api/src/sync/dto/sync.dto.ts`
- `apps/api/src/sync/sync.controller.ts`
- `apps/api/src/sync/sync.service.ts`
- `packages/core/src/types.ts`
- `apps/sdk/src/types.ts`
- `apps/sdk/src/syncra-sdk.ts` (new `Collection` class)

---

### Phase 6 — Multi-Client Test Suite ✅ COMPLETE

**Status**: Done

**What**: Integration tests (`apps/sdk/src/syncra-multi-client.test.ts`) that run two SDK instances concurrently against the same server. The server contract is simulated by an in-memory `MockServer` that faithfully mirrors `SyncService` (monotonic cursor, version-checked conflict detection, tombstones, idempotency), so tests run deterministically in Node without external infra. Scenarios: two clients creating different records and converging, concurrent updates to the same record (detected & resolved conflict), delete-vs-update conflict propagation, offline client reconnecting after N operations, and idempotency across clients.

**Why**: The existing suite only tested single-client scenarios. Multi-client concurrency is where sync bugs live.

**Files changed**:
- `apps/sdk/src/syncra-multi-client.test.ts` (new)

---

### Phase 7 — Observability Backend + Dashboard ✅ COMPLETE

**Status**: Done

**What**: Replaced the static dashboard with real backend endpoints and wired them into the dashboard page. New `metrics` and `audit` NestJS modules (all endpoints user-scoped via `DualAuthGuard`):
- `GET /api/metrics/sync` — operation counts (total/applied/rejected/pending), success & failure rates, last-hour throughput, applied-by-type breakdown
- `GET /api/metrics/conflicts` — rejected (version-conflict) counts by operation type
- `GET /api/audit/record/:id` — full immutable event log for a record (scoped to the authed user, 404 if not owned)
- `GET /api/audit/client/:id` — per-client sync state (last cursor, last seen, server max cursor, lag behind)

The dashboard (`apps/landing/pages/dashboard.html`) now shows live sync-metric cards and a record-audit lookup panel driven by these endpoints.

> Latency is deliberately not reported: `sync_operations` only stores `created_at` (no `processed_at`), so end-to-end processing latency isn't derivable from persisted data. Client-side conflict resolution outcome (LWW vs custom handler) isn't persisted server-side either — only the `version_conflict` rejection is recorded.

**Files changed**:
- `apps/api/src/metrics/` (new) — controller, service, module, service test
- `apps/api/src/audit/` (new) — controller, service, module, service test
- `apps/api/src/app.module.ts` — register MetricsModule + AuditModule
- `apps/landing/pages/dashboard.html` — observability panel

---

### Phase 8 — Environment & Config Cleanup ✅ COMPLETE

**Status**: Done

**What**: Developer should be able to clone, copy `.env.example`, and run without debugging config errors.
- **8a. Redis config mismatch**: `config.ts` now accepts `REDIS_URL` (preferred) **or** `REDIS_HOST`/`REDIS_PORT`/`REDIS_PASS` components (`superRefine` enforces one). `SyncQueueService.buildRedisUrl()` resolves the connection string from either, so `REDIS_URL` vs `REDIS_HOST`/`REDIS_PORT` no longer trips up a fresh checkout.
- **8b. Config tests**: Added `packages/config/src/config.test.ts` (8 tests) covering valid/invalid DB + Redis + JWT combos and defaults.
- **8c. MigrationService reuse**: `MigrationService` now injects `DatabaseService` and reuses its Postgres pool (single pool, no config drift, no duplicate `Pool`). It no longer ends the shared pool.
- **8d. HealthService private field access**: Replaced `this.syncQueueService['connection']` bracket access with a public `SyncQueueService.isRedisHealthy()` method.
- **Bonus reliability fixes** that were breaking `pnpm test`/`type-check`:
  - SDK: empty-queue `pullDelta()` failures were producing an unhandled rejection (background sync) — now caught, emits `sync-failed`, returns a resolved result. `pnpm test` for the SDK now exits 0.
  - SDK test: removed unused `EPOCH` const (fixed `type-check`).
  - Core serializer: fixed `__proto__` key loss in `convertIsoStringsInObject` (used a null-prototype object) — this flaked Property 36 intermittently.

**Files changed**:
- `packages/config/src/config.ts`, `packages/config/src/config.test.ts` (new)
- `apps/api/src/sync/sync-queue.service.ts`
- `apps/api/src/database/migration.service.ts`
- `apps/api/src/health/health.service.ts`, `apps/api/src/health/health.service.test.ts`
- `apps/api/src/api.properties.spec.ts`
- `apps/sdk/src/syncra-sdk.ts`, `apps/sdk/src/syncra-sdk.test.ts`
- `packages/core/src/serializer.ts`
- `README.md` (Redis env docs)

---

### Phase 9 — Reference Application ✅ COMPLETE

**Status**: Done

**What**: The demo app (`apps/demo-app/`) is now a **Field Service** app — workers view assigned jobs, visit customers, update records, collect data, work offline, and sync when back online. Uses the collection API from Phase 5 (`sdk.collection('jobs')`). Jobs are stored in the `jobs` collection with `ServiceType`/`JobStatus`/`JobPriority` domain types.

**Core flow**: Login/register → seed sample jobs → dashboard (`JobsPage`) with stats (pending / in-progress / completed / pending-sync) and status + service filters → create/edit/delete jobs → full offline support via the SDK (auto-sync, sync-status bar, pending indicators) → conflict dialog (last-write-wins).

**Files**: `apps/demo-app/src/`

**Implemented**:
- Domain types + seeding (`types/`), typed `Job` model in the `jobs` collection
- Job board with filters, job detail editor, new-job form
- SDK context provider, sync status bar, conflict dialog
- Online/offline banners and stats driven by `sdk.isOnlineState()` + sync events

**Fixes applied during completion**:
- Fixed malformed JSX in the online/offline toggle (`JobsPage`)
- Fixed `JobDetail` referencing undeclared `error`/`setError` state
- Deleted dead `AppShell.tsx` (old generic CRUD shell, superseded by `JobsPage`)
- Reworked `src/` into a structured layout: `pages/`, `context/`, `types/`, `components/{auth,jobs,sync}/`
- Fixed relative import paths and the `styles.css` import after moving `SdkContext`
- `tsc` + `vite build` green

---

### Phase 10 — Production Hardening ✅ COMPLETE

**What**: Rate limiting, API key rotation, JWT refresh, request size limits, graceful shutdown improvements, Docker restart policy, CI pipeline fixes, security audit, and SDK error categorization (retriable vs non-retriable).

**Why**: The difference between "works on my machine" and "a stranger can depend on this."

- **Rate limiting**: Dependency-free global in-memory fixed-window `RateLimitGuard` (`apps/api/src/common/rate-limit/`). Tracks per-user / per-API-key / per-IP budgets and returns 429 when exceeded. Configurable via `RATE_LIMIT_ENABLED` (default `true`), `RATE_LIMIT_LIMIT` (default 100), `RATE_LIMIT_TTL` in seconds (default 60). Idle buckets are periodically pruned.
- **Request size limits**: `main.ts` sets the JSON body parser limit from `BODY_SIZE_LIMIT` (default 1 MiB), rejecting oversized payloads.
- **JWT refresh**: `POST /auth/refresh` issues a new access token and a rotated refresh token. Only SHA-256 digests are persisted in a new `refresh_tokens` table; tokens are single-use (rotation revokes the presented token), so replay is rejected. Lifetime via `JWT_REFRESH_TTL` (default 30 days).
- **API key rotation**: `POST /projects/:id/rotate-key` atomically revokes the old active key and issues a new one (transactional, no zero/two-active-key window). `validateApiKey` now only accepts active keys. Requires migration `00013`.
- **Graceful shutdown**: explicit SIGTERM/SIGINT handling drains the app then force-exits after a 30s timeout so stuck keep-alive sockets can't hang a deploy. Nest listeners (DB pool, Redis/queue) close via `onModuleDestroy`.
- **Docker**: `restart: unless-stopped` added to Postgres and Redis services in `infra/docker/docker-compose.yml`.
- **CI pipeline + security audit**: Added a `pnpm audit --prod` step to `.github/workflows/ci.yml`.
- **SDK error categorization**: New `SyncError` class (readonly `retriable`) plus `isRetriableStatus` / `classifyResponseError` / `wrapError` in `apps/sdk/src/errors.ts`. Replaced ad-hoc `(err as any).nonRetriable` flags; 4xx (except 408/429) are non-retriable and immediately mark operations `failed`, while 5xx/408/429/network errors are retried with backoff.
- **Lint repair** (pre-existing breakages surfaced once lint actually ran): fixed Windows-incompatible single-quoted globs in every `package.json` lint script; installed the missing `eslint-plugin-prettier`, `eslint-config-prettier`, and `prettier` dev deps; set `endOfLine: auto` in `.prettierrc` so Windows CRLF checkouts lint clean; renamed the demo-app `.eslintrc.js` → `.eslintrc.cjs` and disabled `react/react-in-jsx-scope` for the Vite automatic JSX runtime; auto-fixed formatting drift in api/config/core/sdk/demo-app.

**Files changed**:
- `apps/api/src/common/rate-limit/` (new) — guard, module, options, tests
- `apps/api/src/auth/` — `auth.service.ts`, `auth.controller.ts`, new `dto/refresh-token.dto.ts`, new `auth.service.test.ts`, core `AuthResponse` gains `refreshToken`
- `apps/api/src/projects/` — `projects.service.ts` (rotation + active-only validation), `projects.controller.ts`, new `projects.service.test.ts`
- `apps/api/migrations/00013_api_key_rotation_refresh_tokens.sql` (new)
- `apps/api/src/main.ts` — body size limit, global rate-limit guard, graceful shutdown
- `apps/api/src/app.module.ts` — register `RateLimitModule`
- `packages/config/src/config.ts` + `config.test.ts` — hardening env vars
- `apps/sdk/src/errors.ts` (new) + `syncra-sdk.ts`, `index.ts`, tests
- `infra/docker/docker-compose.yml` — `restart: unless-stopped`
- `.github/workflows/ci.yml` — `pnpm audit --prod`
- `.prettierrc`, `apps/{api,demo-app,sdk}/package.json`, `packages/{config,core}/package.json` (lint repair), `apps/demo-app/.eslintrc.cjs`
- `README.md`, `rebuild.md`

**Files**: Various

---

## Dependency Graph

```
Phase 1 (Cursor) ✅
    │
    ├── Phase 2 (Tombstones + TOCTOU) ✅
    │       │
    │       └── Phase 3 (Pagination) ✅
    │               │
    │               └── Phase 4 (Client Identity) ✅
    │                       │
    │                       └── Phase 5 (Collections) ✅
    │                               │
    │                               └── Phase 6 (Multi-Client Tests) ✅
    │                                       │
    │                               └── Phase 7 (Observability) ✅
    │                                       │
    │                                               └── Phase 9 (Reference App) ✅
    │
    └── Phase 8 (Config Cleanup) ✅ — independent, can run in parallel

Phase 10 (Hardening) ✅ — after everything else
```

---

## Guiding Principles

1. **One path excellent first**: Web App → SDK → Local Store → Queue → Protocol → Backend → PostgreSQL
2. **Don't overbuild**: No CRDTs, no multi-region, no Kubernetes, no 20 SDKs until the core is stable
3. **Smallest robust change**: Preserve working functionality, avoid unnecessary rewrites, prefer simple designs
4. **Test everything**: Correctness tests are more important than flashy features
5. **Developer experience matters**: The SDK should let a developer add offline sync without understanding the internals
