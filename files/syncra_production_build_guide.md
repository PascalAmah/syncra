# Syncra — Production Build Guide

## 1. Project Overview
Syncra is a production-grade offline-first sync engine that ensures data consistency, reliability, and seamless operation in unreliable network environments.

This guide is designed to help you start building immediately.

---

## 2. Tech Stack (Recommended)

### Backend
- Node.js (NestJS)
- PostgreSQL
- Redis (queue + caching)

### Client SDK
- TypeScript
- IndexedDB (Web) / SQLite (Mobile)

### DevOps
- Docker
- GitHub Actions

---

## 3. Monorepo Structure

```
syncra/
│
├── apps/
│   ├── api/                # Backend (NestJS)
│   ├── sdk/                # JS SDK
│   └── demo-app/           # Demo (React)
│
├── packages/
│   ├── core/               # Shared logic (types, utils)
│   └── config/             # Shared configs
│
├── infra/
│   ├── docker/
│   └── scripts/
│
├── docs/
└── package.json
```

---

## 4. Backend Setup (NestJS)

### Step 1: Initialize Project

```bash
npm i -g @nestjs/cli
nest new api
cd api
```

### Step 2: Install Dependencies

```bash
npm install @nestjs/config @nestjs/typeorm typeorm pg
npm install class-validator class-transformer
npm install ioredis bullmq
npm install uuid
```

---

## 5. Database Setup (PostgreSQL)

### Install (Docker)

```bash
docker run --name syncra-postgres \
  -e POSTGRES_PASSWORD=postgres \
  -p 5432:5432 \
  -d postgres
```

### Environment Variables

```
DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASS=postgres
DB_NAME=syncra
```

---

## 6. Core Database Schema

### users
- id (uuid)
- email
- password
- created_at

### records
- id (uuid)
- user_id
- data (jsonb)
- version (int)
- updated_at

### sync_operations
- id (uuid)
- user_id
- operation_type (create/update/delete)
- record_id
- payload (jsonb)
- idempotency_key
- status
- created_at

### events
- id (uuid)
- record_id
- type
- payload (jsonb)
- created_at

### versions
- record_id
- version

---

## 7. Core API Endpoints

### POST /sync
Handles batched operations

Request:
```
{
  "operations": [
    {
      "id": "uuid",
      "type": "create",
      "recordId": "uuid",
      "payload": {},
      "version": 1,
      "idempotencyKey": "abc"
    }
  ]
}
```

---

### GET /sync/updates
Fetch delta updates

---

### CRUD
- POST /records
- GET /records

---

## 8. Sync Flow (Core Logic)

1. Client performs action offline
2. Operation stored in local queue
3. When online:
   - Send batch to /sync
4. Server:
   - Validate idempotency
   - Check version
   - Apply operation
   - Log event
5. Server returns updated records
6. Client updates local DB

---

## 9. Client SDK Setup

### Install

```bash
npm init -y
npm install axios idb uuid
```

### Core Modules

- db.ts (IndexedDB setup)
- queue.ts (operation queue)
- sync.ts (sync logic)

---

## 10. Basic SDK Functions

```ts
createRecord(data)
updateRecord(id, data)
deleteRecord(id)
sync()
```

---

## 11. Offline Queue Design

Structure:

```
{
  id,
  type,
  payload,
  retries,
  status
}
```

---

## 12. Retry Strategy

Exponential backoff:

```
retryDelay = base * (2 ^ attempts)
```

---

## 13. Redis Queue (BullMQ)

### Setup

```bash
npm install bullmq ioredis
```

Used for:
- background sync processing
- retries

---

## 14. Docker Setup

### docker-compose.yml

```yaml
version: '3'
services:
  postgres:
    image: postgres
    ports:
      - "5432:5432"
    environment:
      POSTGRES_PASSWORD: postgres

  redis:
    image: redis
    ports:
      - "6379:6379"
```

---

## 15. Running the Project

### Backend

```bash
cd apps/api
npm run start:dev
```

### SDK

```bash
cd apps/sdk
npm run dev
```

---

## 16. Immediate Next Steps

1. Setup backend project
2. Create database tables
3. Implement /sync endpoint (basic)
4. Build local queue in SDK
5. Connect SDK to backend

---

## 17. Definition of Done (MVP)

- Offline create/update/delete works
- Sync works when online
- No duplicate operations
- Version conflict detected
- Retry system functional

---

## 18. Notes

- Keep everything idempotent
- Never trust client state blindly
- Always version records

---

You can now start building Syncra immediately.

