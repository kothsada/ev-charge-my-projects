# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

NestJS 11 **Notification Microservice** for the Panda EV platform. Handles FCM push delivery, delivery deduplication, rate limiting, real-time admin dashboard via WebSocket, and pre-aggregated session/notification statistics. Port **5001**.

### Platform context

| Service | Port | DB schema | Purpose |
|---|---|---|---|
| **Notification** (this repo) | 5001 | `panda_ev_notifications` | Push delivery, stats, admin WS dashboard |
| Mobile API | 4001 | `panda_ev_core` | Auth, wallet, charging sessions |
| Admin | 3001 | `panda_ev_system` | IAM, stations, pricing |
| OCPP CSMS | 4002 | `panda_ev_ocpp` | OCPP 1.6J charger protocol |

## Commands

```bash
npm install
npm run start:dev          # port 5001 with hot reload
npm run build
npm run start:prod         # node dist/main
npm run lint               # ESLint --fix
npm run format             # Prettier
npx tsc --noEmit           # type-check

npm run test
npm run test:cov
npx jest src/modules/notification/notification.processor.spec.ts

# Prisma
npx prisma generate        # regenerate to generated/prisma/
npx prisma migrate deploy  # apply pending migrations

# Apply migration manually (preferred):
psql "$DATABASE_URL" < prisma/migrations/20260322000001_init_notifications/migration.sql
npx prisma migrate resolve --applied 20260322000001_init_notifications
npx prisma generate

# Seed notification templates
npx ts-node prisma/seed/seed-templates.ts
```

## Environment Variables

| Variable | Default | Notes |
|---|---|---|
| `PORT` | `5001` | |
| `DATABASE_URL` | — | PostgreSQL, `?schema=panda_ev_notifications` |
| `REDIS_URL` | `redis://localhost:6379` | **Hard requirement** — app exits on failure |
| `RABBITMQ_URL` | — | Soft-fails if unset |
| `RABBITMQ_NOTIFICATIONS_QUEUE` | `PANDA_EV_NOTIFICATIONS` | Main inbound queue (with DLQ) |
| `RABBITMQ_NOTIFICATIONS_DLQ` | `PANDA_EV_NOTIFICATIONS_DLQ` | Dead-letter queue |
| `RABBITMQ_NOTIFICATIONS_DLX` | `PANDA_EV_NOTIFICATIONS_DLX` | Dead-letter exchange (fanout) |
| `RABBITMQ_OCPP_EVENTS_QUEUE` | `PANDA_EV_QUEUE` | OCPP events consumed for aggregation only |
| `FIREBASE_SERVICE_ACCOUNT_PATH` | — | Option A: JSON key file |
| `FIREBASE_PROJECT_ID` | — | Option B: individual env vars |
| `FIREBASE_CLIENT_EMAIL` | — |  |
| `FIREBASE_PRIVATE_KEY` | — | `\n` escaped newlines |
| `SERVICE_NAME` | — | e.g. `notification-service` (JWT iss claim) |
| `SERVICE_JWT_PRIVATE_KEY_PATH` | — | Option A: PEM file path |
| `TRUSTED_SERVICE_PUBLIC_KEYS_DIR` | — | Option A: directory of `<stem>.pub` files |
| `TRUSTED_SERVICE_ISSUERS` | — | e.g. `mobile-api:mobile,admin-api:admin` |
| `SERVICE_JWT_PRIVATE_KEY` | — | Option B: base64 PEM (K8s) |
| `TRUSTED_SERVICE_PUBLIC_KEYS` | — | Option B: JSON array `[{"iss":"…","key":"<b64>"}]` |
| `NODE_ENV` | — | `development` enables Swagger |
| `SWAGGER_ENABLED` | — | `true` enables Swagger in any env |

## Architecture

### Message flow

```
Mobile API ──publish──► PANDA_EV_NOTIFICATIONS ──► NotificationRouter ──► NotificationProcessor
                         (notification.targeted /        │                   (dedup → rate-limit
                          notification.session /          │                    → FCM → DB log
                          notification.broadcast /        │                    → aggregation
                          notification.overstay_reminder) │                    → WebSocket emit)
                                                          │
OCPP CSMS ──publish──► PANDA_EV_QUEUE ──────────────────►│ (aggregation + live dashboard only)
           (transaction.started / transaction.stopped)
```

**FCM tokens are passed in the RabbitMQ message** — this service never looks up tokens from a database.

### Module inventory

| Module | Purpose |
|---|---|
| `notification` | `NotificationRouter` (queue consumer) + `NotificationProcessor` (pipeline) + `NotificationController` (REST) |
| `fcm` | Firebase Admin SDK wrapper; `send(tokens, notification)` — no Prisma |
| `dedup` | `DedupService.isNewNotification(sessionId, type)` — Redis `SET NX` guard (TTL 24 h) |
| `rate-limit` | `RateLimitService.isAllowed(userId, type)` — Redis sorted-set sliding window |
| `template` | `TemplateService` — CRUD for `notification_templates` table |
| `aggregation` | `AggregationService` — event-driven UPSERT to hourly/daily stats tables via `$executeRaw` |
| `websocket` | `AdminStatsGateway` — Socket.IO `/admin-stats` namespace; emits live session + notification events |
| `health` | `GET /health` liveness probe |

### Global modules (inject anywhere, no explicit imports needed)

| Module | Exports |
|---|---|
| `PrismaModule` | `PrismaService` |
| `RedisModule` | `RedisService` |
| `ServiceAuthModule` | `ServiceJwtService` |
| `RabbitMQModule` | `RabbitMQService` |

### Notification processing pipeline

`NotificationProcessor.process()` runs each notification through:
1. **Dedup** — Redis NX check on `dedup:{sessionId}:{type}` (TTL 24 h); returns `SUPPRESSED` if key exists
2. **Rate limit** — sliding window check; returns `SUPPRESSED` if exceeded
3. **FCM send** — multicast to provided `fcmTokens[]`
4. **DB log** — write `NotificationLog` record (soft-fail)
5. **Aggregation** — UPSERT to `notification_daily_stats`
6. **WebSocket** — emit `notification:sent` to `/admin-stats`

### RabbitMQ queues consumed

`NotificationRouter` starts both consumers in `onModuleInit`:

| Queue | Pattern | Handler |
|---|---|---|
| `PANDA_EV_NOTIFICATIONS` | With DLQ; 3 retries at 5s / 30s / 120s | `handleNotificationMessage()` — routes by `routingKey` |
| `PANDA_EV_QUEUE` | Plain consume (no DLQ) | `handleOcppEvent()` — aggregation + WebSocket emit only |

### RabbitMQ message routing keys (inbound)

| routingKey | Description |
|---|---|
| `notification.targeted` | Single user push from Mobile; must include `fcmTokens[]` |
| `notification.session` | Session-event push; dedup applied via `sessionId+type` |
| `notification.broadcast` | Bulk push; `skipDedup: true` |
| `notification.overstay_reminder` | Scheduled overstay push; `notifyAt` field controls delay |

### WebSocket admin dashboard

Namespace: `/admin-stats`. Connect via `io(url, { path: '/socket.io' })`.

| Event emitted | Payload | Trigger |
|---|---|---|
| `notification:sent` | `{ type, userId, stationId, chargerIdentity, status, sentAt }` | After each FCM send |
| `session:live_update` | OCPP transaction event + `event` field | `transaction.started` / `transaction.stopped` |
| `stats:hourly_updated` | `{ stationId, stationName, hour, … }` | After aggregation UPSERT |
| `system:alert` | `{ level, message, data }` | Errors / DLQ events |

### Prisma client location

Generated to `generated/prisma/` (not `@prisma/client`).

```ts
// from src/modules/foo/foo.service.ts  (3 levels deep)
import { Prisma } from '../../../generated/prisma/client';

// from src/modules/foo/dto/foo.dto.ts  (4 levels deep)
import { SomeEnum } from '../../../../generated/prisma/client';
```

### Aggregation — no raw queries rule

`AggregationService` uses `$executeRaw` UPSERT pattern exclusively — never reads the full stats table to recalculate:

```ts
await this.prisma.$executeRaw`
  INSERT INTO "panda_ev_notifications"."station_hourly_stats"
    ("id", "stationId", "stationName", "hour", "sessionsStarted")
  VALUES (gen_random_uuid(), ${stationId}, ${stationName}, ${hour}, 1)
  ON CONFLICT ("stationId", "hour") DO UPDATE
    SET "sessionsStarted" = "station_hourly_stats"."sessionsStarted" + 1
`;
```

### Service-to-service JWT

`ServiceJwtService` (global, `src/common/service-auth/`) — identical pattern to Mobile API and OCPP service. RS256 30-second tokens with Redis jti anti-replay. Generate keys:

```bash
openssl genrsa -out keys/notification.pem 2048
openssl rsa -in keys/notification.pem -pubout -out keys/notification.pub
# Copy notification.pub to peer services' keys/ directory
```

## Code Style

Prettier: single quotes, trailing commas. ESLint: `@typescript-eslint/no-explicit-any` off. Fire-and-forget async calls use `.catch(() => null)` to avoid blocking pipeline.
