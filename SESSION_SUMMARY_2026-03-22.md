# Session Summary — 2026-03-22

## 1. Mobile API Enhancements (`panda-ev-client-mobile`)

### New OCPP Event Handlers (`ocpp-consumer.service.ts`)

| Routing Key | Handler | Behavior |
|---|---|---|
| `charger.offline` | `handleChargerOffline()` | Reads `charging:charger:{identity}` from Redis to find active session; reads session billing state; sends FCM "Charger Offline" notification to user (soft-fail) |
| `charger.booted` | `handleChargerBooted()` | Finds active session for charger; marks it `FAILED` with `endedAt`; deletes `charging:session:{id}` + `charging:charger:{identity}` Redis keys; sends FCM "Charger Restarted" notification |

### New REST Endpoint — Live Charging Status

**`GET /api/mobile/v1/charging-sessions/:id/live`** (requires JWT)

Added `ChargingSessionService.getLiveStatus(userId, sessionId)` — reads 3 Redis keys and merges:

| Redis Key | Data |
|---|---|
| `charging:session:{sessionId}` | Billing snapshot: `userId`, `walletId`, `pricePerKwh`, `chargerIdentity`, `connectorId`, `meterStart` |
| `charging:live:{chargerIdentity}:{connectorId}` | Current `meterWh`, `transactionId`, `updatedAt` (from MeterValues) |
| `charger_status:{chargerIdentity}` | Online/offline status from OCPP CSMS |

Response shape:
```json
{
  "sessionId": "...",
  "status": "ACTIVE",
  "chargerIdentity": "PANDA-01",
  "connectorId": 1,
  "startedAt": "...",
  "durationMinutes": 12,
  "meterStartWh": 1000,
  "currentMeterWh": 4500,
  "energyKwh": 3.5,
  "pricePerKwh": 1000,
  "estimatedCost": 3500,
  "meterUpdatedAt": "...",
  "chargerOnline": true
}
```

### New REST Endpoint — Live Charger Status per Station

**`GET /api/mobile/v1/stations/:id/chargers/status`** (public, no auth)

Added `StationService.getChargersStatus(stationId)` — queries chargers from admin DB via `SystemDbService`, then overlays live status from Redis `charger_status:{ocppIdentity}` for each charger.

Response includes: `id`, `displayName`, `ocppIdentity`, `status`, `sortOrder`, `connectorCount`, `liveStatus`, `liveUpdatedAt`, `isOnline` (`true`/`false`/`null`).

### Integration Test Fix (`ocpp-consumer.integration.spec.ts`)

- Added `get: jest.fn().mockResolvedValue(null)` to `buildMockRedis()` (required by `handleChargerBooted`)
- Added `updateMany: jest.fn().mockResolvedValue({ count: 1 })` to `buildMockPrisma().chargingSession`
- Changed routing key in "unknown event" test from `'charger.booted'` → `'some.unknown.event'`
- All 151 tests pass after fixes

---

## 2. Admin Service DI Fix (`panda-ev-csms-system-admin`)

**Error:** `UnknownDependenciesException: Nest can't resolve dependencies of the OcppCommandService (PrismaService, RedisService, ?). Please make sure that the argument RabbitMQService at index [2] is available in the StationModule context.`

**Root cause:** Admin service's `RabbitMQModule` is **not** `@Global()` (unlike Mobile's). `OcppCommandService` injects `RabbitMQService` but `StationModule` had no `imports: [RabbitMQModule]`.

**Fix:** `src/modules/station/station.module.ts`
```ts
@Module({
  imports: [RabbitMQModule],   // ← added
  controllers: [...],
  providers: [...],
  exports: [...],
})
```

---

## 3. Notification Microservice — Full Scaffolding (`panda-ev-notification`)

New NestJS 11 service created at `/Users/tohatcode/Development/customers/pandaEV/panda-ev-notification/`.

**Port:** 5001
**DB Schema:** `panda_ev_notifications`
**Swagger:** `GET /api/notification/docs`

### Prisma Schema — 6 Models, 3 Enums

| Model | Table | Purpose |
|---|---|---|
| `NotificationTemplate` | `notification_templates` | Trilingual templates (en/lo/zh), deep link, action buttons |
| `NotificationLog` | `notification_logs` | Per-delivery record with status, retry count, FCM message ID |
| `UserNotificationPreference` | `user_notification_preferences` | Per-user channel preferences, quiet hours, FCM tokens |
| `StationHourlyStat` | `station_hourly_stats` | Pre-aggregated hourly stats per station |
| `StationDailyStat` | `station_daily_stats` | Pre-aggregated daily stats per station |
| `NotificationDailyStat` | `notification_daily_stats` | Daily notification funnel (sent/delivered/read/clicked/failed) |

Enums: `NotificationChannel` (FCM/WEBSOCKET/BOTH), `NotificationStatus` (PENDING→CLICKED/FAILED/SUPPRESSED), `NotificationPriority` (HIGH/NORMAL/LOW)

### Migration

File: `prisma/migrations/20260322000001_init_notifications/migration.sql`

Apply:
```bash
psql "$DATABASE_URL" < prisma/migrations/20260322000001_init_notifications/migration.sql
npx prisma migrate resolve --applied 20260322000001_init_notifications
npx prisma generate
```

### Module Architecture

```
src/
├── configs/
│   ├── prisma/          PrismaService (@Global)
│   ├── redis/           RedisService (@Global)
│   └── rabbitmq/        RabbitMQService (@Global) — DLX/DLQ setup + 3-retry backoff (5s/30s/120s)
├── common/
│   ├── service-auth/    ServiceJwtService (@Global) — RS256 inter-service JWT
│   ├── interceptors/    ResponseInterceptor
│   └── filters/         GlobalExceptionFilter
└── modules/
    ├── fcm/             FcmService — send(tokens[], notification) — no Prisma dependency
    ├── dedup/           DedupService — Redis SET NX guard per sessionId+type (TTL 24h)
    ├── rate-limit/      RateLimitService — sliding window via Redis sorted sets
    ├── template/        TemplateService — CRUD for notification_templates
    ├── aggregation/     AggregationService — $executeRaw UPSERT to hourly/daily stats
    ├── websocket/       AdminStatsGateway — Socket.IO /admin-stats namespace
    ├── notification/    NotificationRouter (queue consumer) + NotificationProcessor (pipeline)
    └── health/          GET /health
```

### Notification Processing Pipeline

`NotificationProcessor.process()` runs each message through:

1. **Dedup** — `DedupService.isNewNotification(sessionId, type)` → Redis `SET dedup:{sid}:{type} 1 EX 86400 NX`
2. **Rate limit** — `RateLimitService.isAllowed(userId, type)` → sliding window check
3. **FCM send** — `FcmService.send(fcmTokens[], notification)` — multicast
4. **DB log** — `NotificationLog` record created (soft-fail)
5. **Aggregation** — UPSERT to `notification_daily_stats`
6. **WebSocket** — emit `notification:sent` to `/admin-stats`

### RabbitMQ Queues Consumed

| Queue | Pattern | Purpose |
|---|---|---|
| `PANDA_EV_NOTIFICATIONS` | DLQ, 3 retries (5s/30s/120s) | Inbound notifications from Mobile/Admin |
| `PANDA_EV_QUEUE` | Plain consume | OCPP events for aggregation + live dashboard only |

### Inbound Routing Keys

| routingKey | Description |
|---|---|
| `notification.targeted` | Single user push; `fcmTokens[]` required in message |
| `notification.session` | Session-event push with dedup |
| `notification.broadcast` | Bulk push; dedup skipped |
| `notification.overstay_reminder` | Scheduled overstay; delayed by `notifyAt` field |

### WebSocket Events (Admin Dashboard)

Namespace `/admin-stats`:

| Event | Trigger |
|---|---|
| `notification:sent` | After each FCM delivery attempt |
| `session:live_update` | OCPP `transaction.started` / `transaction.stopped` |
| `stats:hourly_updated` | After aggregation UPSERT |
| `system:alert` | Errors / DLQ overflow |

### Key Design Decisions

- **FCM tokens are in the message payload** — no cross-DB lookup; Mobile provides `fcmTokens: string[]`
- **No raw query rule** — all stats are pre-aggregated via `$executeRaw` UPSERT on each event
- **Soft-fails** — Firebase, RabbitMQ all soft-fail; Redis is the only hard requirement

### Seed Templates

11 trilingual templates (en/lo/zh):

```bash
npx ts-node prisma/seed/seed-templates.ts
```

---

## 4. Service Key Generation (`generate-service-keys-local.sh`)

Updated monorepo key generation script to include the notification service.

### Changes

- Added `notification` to `SERVICES` list and `service_dir()` case
- Added `notification` key generation: `keys/notification.pem` + `keys/notification.pub`
- Cross-copy `notification.pub` → `admin/keys/` and `mobile/keys/`
- Cross-copy `admin.pub` + `mobile.pub` → `notification/keys/`
- Added `NOTIF_PUB` base64 to peer services' `TRUSTED_SERVICE_PUBLIC_KEYS`
- Updated `TRUSTED_SERVICE_ISSUERS` for admin and mobile to include `notification-service:notification`
- Added Option A + Option B `.env` blocks for `panda-ev-notification`

### Trust Matrix (after update)

| Service | Trusts Incoming JWTs From |
|---|---|
| notification | `mobile-api`, `admin-api` |
| mobile | `admin-api`, `ocpp-csms`, `notification-service` |
| admin | `mobile-api`, `ocpp-csms`, `notification-service` |
| ocpp | `mobile-api`, `admin-api` |

### Keys Generated This Session

```
panda-ev-notification/keys/
  notification.pem   ← private key (chmod 600)
  notification.pub   ← public key  (chmod 644)
  admin.pub          ← cross-copied from admin/keys/
  mobile.pub         ← cross-copied from mobile/keys/

panda-ev-csms-system-admin/keys/
  notification.pub   ← cross-copied (NEW)

panda-ev-client-mobile/keys/
  notification.pub   ← cross-copied (NEW)
```

---

## 5. Prisma Deprecation Fix

Removed deprecated `previewFeatures = ["multiSchema"]` from `panda-ev-notification/prisma/schema.prisma` (feature is stable in Prisma 7 and no longer requires preview opt-in).

---

## 6. Documentation Updates

| File | Change |
|---|---|
| `panda-ev-notification/CLAUDE.md` | Created — full service guidance |
| `CLAUDE.md` (monorepo root) | Added notification service row to service table; added `PANDA_EV_NOTIFICATIONS` + DLQ queue entries to RabbitMQ table |
| `memory/MEMORY.md` | Updated service count (5→6); added notification service architecture notes + migration entry |

---

## Pending (Not Yet Applied)

| Task | Command |
|---|---|
| Apply DB migration | `psql "$DATABASE_URL" < prisma/migrations/20260322000001_init_notifications/migration.sql` |
| Mark migration applied | `npx prisma migrate resolve --applied 20260322000001_init_notifications` |
| Regenerate Prisma client | `npx prisma generate` |
| Seed notification templates | `npx ts-node prisma/seed/seed-templates.ts` |
| Wire Mobile → `PANDA_EV_NOTIFICATIONS` | Replace direct FCM calls in `OcppConsumerService` with RabbitMQ publish to decouple services |
