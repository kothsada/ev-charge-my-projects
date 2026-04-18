# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

NestJS 11 **Notification Microservice** for the Panda EV platform. Handles FCM push delivery, delivery deduplication, rate limiting, centralized FCM device registry, real-time admin dashboard via WebSocket, and pre-aggregated session/notification statistics. Port **5001**.

**Canonical FCM token store:** `user_fcm_devices` table. Mobile API syncs tokens via `device.registered`/`device.unregistered` RabbitMQ events. Notification Service automatically detects and soft-deletes stale tokens after failed FCM sends.

### Platform context

| Service | Port | DB schema | Purpose |
|---|---|---|---|
| **Notification** (this repo) | 5001 | `panda_ev_noti` | Push delivery, stats, admin WS dashboard |
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
| `DATABASE_URL` | — | PostgreSQL, `?schema=panda_ev_noti` |
| `REDIS_URL` | `redis://localhost:6379` | **Hard requirement** — app exits on failure |
| `RABBITMQ_URL` | — | Soft-fails if unset |
| `RABBITMQ_NOTIFICATIONS_QUEUE` | `PANDA_EV_NOTIFICATIONS` | Main inbound queue (with DLQ) |
| `RABBITMQ_NOTIFICATIONS_DLQ` | `PANDA_EV_NOTIFICATIONS_DLQ` | Dead-letter queue |
| `RABBITMQ_NOTIFICATIONS_DLX` | `PANDA_EV_NOTIFICATIONS_DLX` | Dead-letter exchange (fanout) |
| `RABBITMQ_OCPP_EVENTS_QUEUE` | `PANDA_EV_QUEUE` | OCPP events consumed for aggregation only |
| `RABBITMQ_SMS_QUEUE` | `PANDA_EV_SMS` | SMS send requests from Mobile/CSMS |
| `RABBITMQ_SMS_DLQ` | `PANDA_EV_SMS_DLQ` | SMS dead-letter queue |
| `RABBITMQ_SMS_DLX` | `PANDA_EV_SMS_DLX` | SMS dead-letter exchange (fanout) |
| `LTC_SMS_BASE_URL` | `https://apicenter.laotel.com:9443/api/sms_center` | LTC API base URL |
| `LTC_SMS_API_KEY` | — | LTC API key (omit for dry-run mode) |
| `LTC_SMS_HEADER` | `PANDAEV` | Default SMS sender name shown on handset |
| `LTC_SMS_PARTNER_ID` | `PEV` | Prefix for transaction ID generation |
| `LTC_ONNET_OPERATOR_PREFIXES` | `205` | Comma-separated LTC operator prefixes — `205` is LTC/Laotel (onnet = 200 LAK; all others = offnet = 300 LAK) |
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

Mobile/CSMS ──publish──► PANDA_EV_SMS ──────────────────► SmsRouter ──► SmsService ──► LTC API
              (sms.otp / sms.text)                                        (parse phone → detect onnet/offnet
                                                                           → submit_sms → log → aggregate stats)
           (transaction.started / transaction.stopped)
```

**FCM token resolution:** `fcmTokens[]` in inbound messages is now **optional**. If provided, those tokens are used directly (backwards-compat). If omitted, the processor looks up active tokens from `user_fcm_devices` by `userId`.

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
| `device` | `DeviceService` — centralized FCM token CRUD; `DeviceController` — `POST/DELETE/GET /v1/devices` (internal REST) |
| `sms` | `SmsService` — LTC SMS API client; `SmsRouter` — `PANDA_EV_SMS` queue consumer; `SmsAggregationService` — auto-incremented daily stats; `SmsController` — REST API |
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
| `notification.targeted` | Single user push; `fcmTokens[]` optional — resolved from `user_fcm_devices` if omitted |
| `notification.session` | Session-event push; dedup applied via `sessionId+type` |
| `notification.broadcast` | Bulk push; `skipDedup: true` |
| `notification.overstay_reminder` | Scheduled overstay push; `notifyAt` field controls delay |
| `device.registered` | Sync new FCM token from Mobile API → `user_fcm_devices` |
| `device.unregistered` | Soft-delete FCM token in `user_fcm_devices` (logout) |

### REST API

Global prefix: `/api/notification` (all routes below are under this prefix). Swagger at `/api/notification/docs` (dev or `SWAGGER_ENABLED=true`).

| Method | Path | Description |
|---|---|---|
| `POST` | `/v1/notifications/send` | Direct send (bypasses RabbitMQ) |
| `GET` | `/v1/notifications/history` | Paginated logs with filtering |
| `PATCH` | `/v1/notifications/:id/status` | Update status (`DELIVERED`/`READ`/`CLICKED`) |
| `GET` | `/v1/notifications/stats/daily` | Pre-aggregated daily delivery stats |
| `GET` | `/v1/notifications/stats/stations` | Per-station daily stats |
| `GET` | `/health` | Liveness probe (no prefix) |
| `POST` | `/v1/devices` | Register FCM token (from Mobile API, internal) |
| `DELETE` | `/v1/devices` | Deactivate FCM token |
| `GET` | `/v1/devices/:userId` | List devices for a user |
| `POST` | `/v1/sms/send` | Send SMS directly (bypasses RabbitMQ — for testing in Swagger) |
| `POST` | `/v1/sms/verify` | Verify SMS delivery via LTC verify_sms (check 5-10 min after send) |
| `GET` | `/v1/sms/history` | Paginated SMS transaction log with filtering |
| `GET` | `/v1/sms/stats/daily` | Pre-aggregated daily stats (onnet/offnet counts, amounts, success/fail, OTP/TEXT) |

### WebSocket admin dashboard

Namespace: `/admin-stats`. Connect via `io(url, { path: '/socket.io' })`. No auth on connection — open namespace.

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

### Rate-limit windows

Default limits in `RateLimitService` (sliding window via Redis sorted-set + Lua):

| Type | Window | Max |
|---|---|---|
| `overstay_warning` | 24 h | 4 |
| `soc_80` | 24 h | 1 |
| `promo` | 24 h | 2 |
| `global` (all types) | 1 h | 20 |

### Common infrastructure

All responses are wrapped by `ResponseInterceptor` → `{ success, statusCode, data, message, timestamp }`. `GlobalExceptionFilter` catches all exceptions and formats them identically. `TimeoutInterceptor` enforces per-request timeout. CORS is open (`origin: '*'`).

### Aggregation — no raw queries rule

`AggregationService` uses `$executeRaw` UPSERT pattern exclusively — never reads the full stats table to recalculate:

```ts
await this.prisma.$executeRaw`
  INSERT INTO "panda_ev_noti"."station_hourly_stats"
    ("id", "stationId", "stationName", "hour", "sessionsStarted")
  VALUES (gen_random_uuid(), ${stationId}, ${stationName}, ${hour}, 1)
  ON CONFLICT ("stationId", "hour") DO UPDATE
    SET "sessionsStarted" = "station_hourly_stats"."sessionsStarted" + 1
`;
```

### SMS Module

#### LTC API

- **Submit**: `POST {LTC_SMS_BASE_URL}/submit_sms` — `{ transaction_id, header, phoneNumber, message }`
- **Verify**: `POST {LTC_SMS_BASE_URL}/verify_sms` — `{ SMID }` — check 5-10 min after submit
- Success response: `resultCode === "20000"` with `SMID` field
- Dry-run mode: when `LTC_SMS_API_KEY` is unset, calls are skipped and a fake SMID is returned

#### Phone number parsing

`parsePhoneNumber("8562078559999")` →
- `countryCode = "856"`, `mobileNumber = "2078559999"`, `operator = "207"`
- Network type determined by operator prefix: onnet (LTC) = 200 LAK, offnet = 300 LAK
- Configure LTC prefixes via `LTC_ONNET_OPERATOR_PREFIXES` env var (comma-separated 3-digit codes)

#### RabbitMQ message contract (published by Mobile / CSMS)

Queue: `PANDA_EV_SMS` (with DLX `PANDA_EV_SMS_DLX` and DLQ `PANDA_EV_SMS_DLQ`)

```json
{
  "routingKey": "sms.otp",
  "phoneNumber": "8562078559999",
  "message": "Your OTP is 123456. Valid for 5 minutes.",
  "header": "PANDAEV",
  "userId": "uuid-...",
  "sessionId": "uuid-...",
  "sourceService": "mobile"
}
```

| routingKey | Purpose |
|---|---|
| `sms.otp` | One-time password / verification code |
| `sms.text` | General-purpose text message |

#### Stats schema

`SmsDailyStat` auto-increments on every SMS send via `ON CONFLICT DO UPDATE`. Fields:
`onnetCount`, `onnetAmountLak`, `offnetCount`, `offnetAmountLak`, `totalCount`, `totalAmountLak`,
`successCount`, `failCount`, `otpCount`, `textCount`, `uniqueRecipients`

### Service-to-service JWT

`ServiceJwtService` (global, `src/common/service-auth/`) — identical pattern to Mobile API and OCPP service. RS256 30-second tokens with Redis jti anti-replay. Generate keys:

```bash
openssl genrsa -out keys/notification.pem 2048
openssl rsa -in keys/notification.pem -pubout -out keys/notification.pub
# Copy notification.pub to peer services' keys/ directory
```

## Code Style

Prettier: single quotes, trailing commas. ESLint: `@typescript-eslint/no-explicit-any` off. Fire-and-forget async calls use `.catch(() => null)` to avoid blocking pipeline.
