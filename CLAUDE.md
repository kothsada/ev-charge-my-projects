# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Structure

This monorepo contains services for a Panda EV (electric vehicle) charging platform. Each NestJS service has its own `CLAUDE.md` with service-specific guidance.

| Service | Port | Purpose |
|---------|------|---------|
| `panda-ev-ocpp/` | 4002 | OCPP 1.6J CSMS — WebSocket server handling charger protocol |
| `panda-ev-csms-system-admin/` | 4000 | Admin backend — IAM, stations, pricing, CMS |
| `panda-ev-client-mobile/` | 4001 | Mobile app backend — auth, wallet, charging sessions |
| `panda-ev-notification/` | 5001 | Notification microservice — FCM push, stats aggregation, admin WS dashboard |
| `panda-ev-gateway-services/` | 4004 | Payment gateway — BCEL OnePay QR integration |
| `ocpp-virtual-charge-point/` | N/A | OCPP simulator for testing (1.6, 2.0.1, 2.1) |

## Commands

All NestJS services share the same npm scripts. Run from within each service directory:

```bash
npm run start:dev       # Watch mode with hot reload
npm run build           # Compile TypeScript
npm run start:prod      # Run compiled build
npm run lint            # ESLint with auto-fix
npx tsc --noEmit        # Type-check without emitting

npm run test            # Jest unit tests
npm run test:cov        # With coverage
npx jest src/modules/auth/auth.service.spec.ts   # Run a single test file

# Prisma (run from service directory)
npx prisma generate          # Regenerate client after schema changes
npx prisma migrate deploy    # Apply migrations (production)
npx prisma db seed           # Seed database
```

### Creating migrations

`prisma migrate dev` requires interactive TTY and often fails. Safe manual workflow:
1. Create `prisma/migrations/<YYYYMMDDHHMMSS>_<name>/migration.sql`
2. Write plain SQL using schema-qualified names (e.g. `"panda_ev_core"."table"`)
3. Apply: `psql "$DATABASE_URL" < prisma/migrations/<name>/migration.sql`
4. Mark applied: `npx prisma migrate resolve --applied <name>`
5. Regenerate: `npx prisma generate`

For `ocpp-virtual-charge-point` (uses Bun + Biome):

```bash
npm start index_16.ts        # Run OCPP 1.6 simulator
npm start index_201.ts       # Run OCPP 2.0.1 simulator
npm run check                # lint + format:check + typecheck
```

### K8s secrets workflow

Each service has a `create-secret.sh` that creates the Kubernetes Secret from local key files:

```bash
# 1. Generate RS256 key pairs for all services (once, or after key rotation)
chmod +x generate-service-keys-local.sh
./generate-service-keys-local.sh
# → writes keys to <service>/keys/ in each service; cross-copies peer public keys

# 2. QR_SIGNING_SECRET — generate ONCE, export before running Admin + Mobile scripts
#    Must be the SAME value in both services or QR verification fails at runtime
export QR_SIGNING_SECRET=$(openssl rand -hex 32)

# 3. Push secrets to K8s (run from each service directory, in same shell session)
cd panda-ev-csms-system-admin && ./create-secret.sh
cd ../panda-ev-client-mobile  && ./create-secret.sh
cd ../panda-ev-ocpp           && ./create-secret.sh
```

`generate-service-keys.sh` (monorepo root) is the original version that stores all keys in a single `keys/` directory. `generate-service-keys-local.sh` stores each service's keys inside that service's own `keys/` directory and cross-copies peer public keys automatically — prefer this one.

**Note:** If the shell is closed after generating `QR_SIGNING_SECRET`, the value is lost. Re-export the same value before running both scripts again, otherwise QR signature verification will silently fail in production.

## Architecture

### Service Communication

```
Mobile App ──► Mobile API (4001) ──► PostgreSQL (panda_ev_core)
                    │
               RabbitMQ (signed x-service-token)
          ┌─────────┴──────────┐
          │                    │
    OCPP CSMS (4002) ◄──WS── Chargers
    PostgreSQL (panda_ev_ocpp)

Admin Portal ──► Admin System (4000) ──► PostgreSQL (panda_ev_system)

All services ──► Notification (5001) ──► FCM / WebSocket dashboard
```

### RabbitMQ Queues

All RabbitMQ messages are signed with RS256 `x-service-token` headers. Consumers verify the token before processing.

| Queue | Direction | Payload |
|---|---|---|
| `PANDA_EV_CSMS_COMMANDS` | Mobile → OCPP | `{ routingKey: 'session.start'\|'session.stop', sessionId, identity, connectorId, mobileUserId }` |
| `PANDA_EV_OCPP_EVENTS_FX` | OCPP fanout exchange | Delivers a full copy to both `PANDA_EV_QUEUE` and `PANDA_EV_QUEUE_NOTI` — eliminates competing-consumer race; env: `RABBITMQ_OCPP_EVENTS_FX` |
| `PANDA_EV_QUEUE` | OCPP → Mobile (via fanout) | `transaction.started`, `transaction.stopped`, `charger.booted`, `connector.status_changed` |
| `PANDA_EV_QUEUE_NOTI` | OCPP → Notification (via fanout) | Same events as `PANDA_EV_QUEUE`; consumed for aggregation + WebSocket dashboard; env: `RABBITMQ_OCPP_EVENTS_NOTI_QUEUE` |
| `PANDA_EV_NOTIFICATIONS` | Mobile/Admin → Notification | `{ routingKey: 'notification.targeted'\|'notification.session'\|'notification.broadcast'\|'notification.overstay_reminder', fcmTokens[], userId, type, title, body, … }` |
| `PANDA_EV_QUEUE_DLQ` | Mobile (dead-letter for PANDA_EV_QUEUE) | Failed OCPP events after 3 retries (5s/30s/120s backoff); use `rabbitMQ.consumeWithDlq()` |
| `PANDA_EV_QUEUE_DLX` | Mobile (dead-letter exchange) | Fanout exchange — DLQ is bound to this; set in `RABBITMQ_OCPP_EVENTS_DLX` env |
| `PANDA_EV_NOTIFICATIONS_DLQ` | Notification (dead-letter) | Failed messages after 3 retries (5s/30s/120s backoff) |
| `PANDA_EV_USER_EVENTS` | Mobile → Admin | user registration events (admin mirrors user profiles) |
| `PANDA_EV_SYSTEM_EVENTS` | Admin → Mobile | `{ routingKey: 'content.invalidate', slug }` for Redis cache invalidation |
| `PANDA_EV_ADMIN_COMMANDS` | Admin → OCPP | `{ action, commandId, ocppIdentity, ... }` — remote OCPP commands; result written to Redis `ocpp:cmd:result:{commandId}` (90s TTL) |
| `PANDA_EV_CHARGER_SYNC` | Admin → OCPP | `charger.provisioned\|updated\|decommissioned`, `connector.provisioned\|updated\|decommissioned` — keeps `panda_ev_ocpp.chargers` in sync with admin DB |
| `message.created` | Chat → Admin | consumed by Admin notification module for push notifications |
| `PANDA_EV_PAYMENT_COMMANDS` | Mobile → Gateway | Request QR payment creation; optional `idempotencyKey` (24 h dedup) |
| `PANDA_EV_PAYMENT_EVENTS` | Gateway → all | Payment lifecycle events: `payment.initiated`, `payment.confirmed`, `payment.voided`, `payment.failed`; carry `context` field for consumer filtering |
| `PANDA_EV_SMS` | Mobile/Admin → Notification | SMS send requests: `{ routingKey: 'sms.otp'\|'sms.text', phoneNumber, message, header?, userId?, sessionId?, sourceService }` |

### Service-to-Service Security (RS256 JWT)

All NestJS services implement `ServiceAuthModule` (`src/common/service-auth/`) which provides `ServiceJwtService`:

- **Signing** (`RabbitMQService.publish`): attaches a 30-second RS256 JWT as `x-service-token` AMQP header. Token payload: `{ iss, aud, iat, exp, jti }`.
- **Verification** (`RabbitMQService` consumer): validates `x-service-token` signature against the issuer's trusted public key, then checks Redis jti blacklist (60 s TTL) to prevent replay. Messages that fail verification are nacked and discarded. **Redis key format**: `svc:jti:{serviceName}:{jti}` — namespaced per-consumer so fanout deliveries of the same token to multiple services don't false-positive as replays.
- **WebSocket gateways** (Admin `NotificationGateway`, `PricingGateway`): verify the user Bearer JWT on `handleConnection`, disconnect with `auth_error` if invalid.
- **User JWT (RS256)**: Admin and Mobile sign access tokens with `JWT_PRIVATE_KEY` (RS256). The `JwtStrategy` resolves verification key via: `JWT_PUBLIC_KEY_PATH` → `JWT_PUBLIC_KEY` (base64) → `JWT_SECRET` (HS256 fallback).

**Key loading — two mutually exclusive options:**

| | Option A (local/Docker) | Option B (K8s Secrets) |
|---|---|---|
| Service private key | `SERVICE_JWT_PRIVATE_KEY_PATH=./keys/<svc>.pem` | `SERVICE_JWT_PRIVATE_KEY=<base64>` |
| Trusted peer keys | `TRUSTED_SERVICE_PUBLIC_KEYS_DIR=./keys` + `TRUSTED_SERVICE_ISSUERS=mobile-api:mobile,ocpp-csms:ocpp` | `TRUSTED_SERVICE_PUBLIC_KEYS=[{"iss":"mobile-api","key":"<base64>"},...]` |
| User JWT | `JWT_PRIVATE_KEY_PATH` + `JWT_PUBLIC_KEY_PATH` | `JWT_PRIVATE_KEY` + `JWT_PUBLIC_KEY` (base64) |

**Trust matrix** (which services' public keys each service needs in its `keys/` dir):

| Service | Trusts incoming from |
|---|---|
| Admin | `mobile-api`, `ocpp-csms` |
| Mobile | `admin-api`, `ocpp-csms` |
| OCPP | `mobile-api`, `admin-api` |
| Notification | `mobile-api`, `admin-api`, `ocpp-csms` |

`generate-service-keys-local.sh` cross-copies peer public keys automatically, so `TRUSTED_SERVICE_PUBLIC_KEYS_DIR` works without manual steps.

**Module load order**: `ServiceAuthModule` must be imported before `RabbitMQModule` in each service's `app.module.ts` because `RabbitMQService` injects `ServiceJwtService`.

**OCPP does not issue user JWTs** — it only needs `SERVICE_JWT_PRIVATE_KEY` and `TRUSTED_SERVICE_PUBLIC_KEYS`.

**Notification WebSocket** (`/admin-stats` namespace): verifies user Bearer JWT on `handleConnection`, disconnects unauthenticated clients — despite having open CORS. Auth token passed via `socket.handshake.auth.token` or `Authorization: Bearer` header.

### Database Isolation

Each service owns its schema exclusively — no cross-database joins:

- `panda_ev_ocpp` — Charger, Connector, Transaction, OcppLog
- `panda_ev_core` — User, Profile, Vehicle, Wallet, ChargingSession, Payment, Invoice, + others
- `panda_ev_system` — User (admin), Role, Group, Permission, Station, Charger, Connector, Banner, News, PricingTier, + others
- `panda_ev_noti` — NotificationLog, UserFcmDevice, NotificationTemplate, DeliveryStats (owned by Notification Service)
- `panda_ev_gateway` — PaymentProvider, Payment, PaymentEvent (owned by Gateway Service)

**Prisma client** is generated to `generated/prisma/` at each service root (not `@prisma/client`). Import path from `src/modules/foo/` (3 levels deep): `../../../generated/prisma/client`.

**Cross-DB exception**: Mobile API reads station/pricing data from `panda_ev_system` via `SystemDbService` (raw pg Pool at `src/configs/prisma/system-db.service.ts`). Call `this.systemDb.withClient(async (client) => { ... })`. Always Redis-cache results (TTL 2–5 min). Writes to admin DB are fire-and-forget via `.catch(() => null)`.

### OCPP WebSocket

Charge points connect to `ws://<host>/ocpp/<chargeBoxIdentity>` with subprotocol `ocpp1.6`. The VCP simulator exposes an admin HTTP API on port 9999: `POST http://localhost:9999/execute` with `{ action, payload }`. Admin scripts live in `ocpp-virtual-charge-point/admin/`.

### Shared Conventions (all NestJS services)

**Infrastructure**: Redis (hard requirement — app exits if unreachable at boot), RabbitMQ (soft-fail with warning), PostgreSQL via Prisma.

**URL prefixes**: Admin → `/api/admin/v1/`, Mobile → `/api/mobile/v1/`, Gateway → `/api/gateway/v1/`, OCPP → WebSocket only.

**API response shape**:
```ts
{ success: boolean, statusCode: number, data: T | null, message: string, errorCode?: string, errors?: ValidationErrorDetail[], meta?: PaginationMeta, timestamp: string }
```

**Soft delete**: Never hard-delete. Set `deletedAt: new Date()`. All queries filter `deletedAt: null`.

**Timezone**: All response dates convert to Asia/Vientiane (UTC+7) via `TimezoneInterceptor`. Date helper rule (OCPP service `src/common/helpers/date.helper.ts`): OCPP protocol fields and RabbitMQ/Redis payloads use Bangkok time (`nowBangkokIso()`); Prisma/PostgreSQL stores UTC `Date` objects — convert only when serialising to JSON.

**Energy units**: All internal energy values are stored and processed in **Wh (integer)**. `handleMeterValues` normalises charger readings on ingestion (kWh × 1000 → Wh). Billing uses `energyKwh = (meterStop − meterStart) / 1000`.

**i18n**: Custom `AsyncLocalStorage`-based (not `@nestjs/i18n`). Use helpers from `src/common/i18n/`:
- `t('key')` — for return values / data payloads
- `i18nMessage('key')` — for thrown exceptions only; `GlobalExceptionFilter` resolves the `i18n:key` sentinel. **Do not use in return values** — the sentinel leaks to the client.

Translation files: `src/common/i18n/translations/{en,lo,zh}.json`. Add new keys to all three files.

**Auth guard**: `@Public()` bypasses `JwtAuthGuard`. Admin also has `PermissionsGuard` — permission slugs follow `{resource}:{action}` format (e.g. `stations:read`).

**Exception pattern**: Use typed exceptions (`NotFoundException`, `ConflictException`) or `HttpException(i18nMessage('key'), HttpStatus.X)`. `TooManyRequestsException` does not exist in NestJS — use `HttpException` with `HttpStatus.TOO_MANY_REQUESTS`.

### Module Inventory

**Admin** (`panda-ev-csms-system-admin/src/modules/`):
`auth`, `iam` (users/roles/groups/permissions), `cms`, `news`, `notification`, `noti-management` (send/broadcast via notification service REST), `audit-log`, `system-settings`, `station`, `location`, `pricing`, `mobile-user`, `legal-content`, `gateway-payments` (admin view of payment records from Gateway), `enums`, `health`, `cache`, `upload`

**Mobile** (`panda-ev-client-mobile/src/modules/`):
`auth`, `profile`, `vehicle`, `wallet`, `charging-session`, `station`, `payment`, `invoice`, `financial`, `content`, `banner`, `news`, `favorite`, `fcm`, `notification`, `app-config`, `enums`, `health`, `cache`, `audit-log`

**OCPP** (`panda-ev-ocpp/src/modules/`):
`ocpp` (single module — handles all charger WebSocket protocol, auth, and message routing)

**Notification** (`panda-ev-notification/src/modules/`):
`notification` (processor, router), `fcm` (delivery), `dedup`, `rate-limit`, `device` (FCM token registry), `aggregation` (stats), `template`, `websocket` (admin dashboard), `sms` (LTC SMS delivery + aggregation), `health`

**Gateway** (`panda-ev-gateway-services/src/modules/`):
`payment` (only module — BCEL QR initiation, PubNub callback, void, refund, mode switch, reconciliation)

### Gateway Service — BCEL OnePay QR

The Gateway handles all payment integration for the Laos market (LAK currency). It is the only service that talks to BCEL's REST API.

**Flow**: Mobile API (or any service) publishes to `PANDA_EV_PAYMENT_COMMANDS` → Gateway creates QR → payment confirmation arrives via **PubNub** channel `mcid-{mcid}-{shopcode}` → Gateway publishes `payment.confirmed` to `PANDA_EV_PAYMENT_EVENTS`.

**Mode switching** (TEST ↔ PRODUCTION): stored in Redis `gateway:bcel:active_mode`. Switch via `PATCH /api/gateway/v1/payments/bcel/mode`. Both modes subscribe to PubNub at startup.

**Idempotency**: Pass `idempotencyKey` in command payload; server deduplicates for 24 h (Redis). Omitting it auto-generates `{userId}:{provider}:{amount}:{minuteWindow}` — deduplicates within the same 1-minute window.

### Billing Architecture

All billing config lives in `panda_ev_system.pricing_tiers` — **not** in stations. Stations only store name, address, location, and hours.

`PricingTier` fields: `rate_per_kwh`, `plug_type` (GBT/CCS2/null=all), `enable_unplug_fee`, `unplug_fee_amount`, `enable_parking_fee`, `parking_fee_per_minute`, `parking_free_minutes`. `StationPricing` links tiers to stations with `priority` (higher = used first).

Session start flow in Mobile API (`charging-session.service.ts`):
1. Query highest-priority active `PricingTier` for the charger+connector via LATERAL JOIN through `SystemDbService`
2. Snapshot entire billing config into Redis at `charging:session:{id}` (8 h TTL)
3. `OcppConsumerService` reads only from Redis at billing time — never re-queries pricing

### QR Code Charging Flow (Option C Hybrid)

QR codes are generated per-connector by Admin and scanned by the Mobile App to start a session in **1 API call** instead of 5.

**QR URL format:** `pandaev://charge?sid=<base62-22>&cid=<base62-22>&nid=<1-9>&sig=<hmac-16>`
- `sid`/`cid` = stationId/chargerId encoded as 22-char Base62 (UUID → BigInt → Base62)
- `nid` = OCPP connector number (1-based)
- `sig` = `HMAC-SHA256(sid|cid|nid, QR_SIGNING_SECRET).hex.slice(0, 16)` — verified with `timingSafeEqual`

**Cross-service shared secret**: `QR_SIGNING_SECRET` env var must be **identical** in Admin and Mobile. It lives in both `panda-system-api-secrets` and `panda-mobile-api-secrets` K8s secrets. Rotate by changing the value and re-running both `create-secret.sh` scripts. QR codes themselves are permanent (no TTL) — rotation invalidates all existing QRs.

**Admin:** `GET /admin/v1/stations/:id/chargers/:chargerId/connectors/:connectorUuid/qr` (permission: `connectors:read`) → `QrService.getConnectorQr()` in `station/services/qr.service.ts`.

**Mobile endpoints:**
- `GET /api/mobile/v1/charging-sessions/qr-preview` — verify sig + return live status/pricing preview (no lock, no session)
- `POST /api/mobile/v1/charging-sessions/qr-start` — full start: verify → decode → resolve Admin DB → per-user lock (30s) → per-charger lock (8h) → wallet check → create session → publish RabbitMQ

**`pricePerKwh` and `stationName` are never accepted from the client** in `qr-start` — always resolved from the Admin DB LATERAL JOIN query.

### SMS — Notification Service Routes via LTC API

Mobile and Admin publish to `PANDA_EV_SMS`; Notification's `SmsRouter` consumes and calls LTC's REST API:

- **Submit**: `POST {LTC_SMS_BASE_URL}/submit_sms` — success = `resultCode === "20000"` + `SMID`
- **Phone parsing**: `"8562078559999"` → `countryCode=856`, operator prefix determines onnet (LTC, 200 LAK) vs offnet (300 LAK). Configure via `LTC_ONNET_OPERATOR_PREFIXES` (comma-separated 3-digit codes; default `205`).
- **Dry-run**: when `LTC_SMS_API_KEY` is unset, calls are skipped and a fake SMID is returned — safe for dev.
- **Stats**: auto-increment `SmsDailyStat` on every send (`ON CONFLICT DO UPDATE`); tracks onnet/offnet counts, amounts, OTP/text breakdown, success/fail.
- **DLQ**: `PANDA_EV_SMS` → DLX `PANDA_EV_SMS_DLX` → DLQ `PANDA_EV_SMS_DLQ`; 3 retries at 5s/30s/120s.

### FCM Push — Notification Service is the Canonical Sender

Mobile API does **not** call Firebase directly. All push notifications are routed via RabbitMQ:

```
Mobile API ──publish──► PANDA_EV_NOTIFICATIONS ──► Notification Service ──► FCM
```

`FcmModule` in Mobile API handles only device token management (`user_fcm_devices` table is in `panda_ev_notifications` schema, owned by Notification Service). Mobile API syncs tokens via `device.registered`/`device.unregistered` events.

Notification Service (`NotificationProcessor`) handles dedup, rate-limiting, FCM delivery, DB logging, stats aggregation, and WebSocket emit — in that order.

### Mobile — OCPP Consumer DLQ Pattern

`OcppConsumerService` uses `rabbitMQ.consumeWithDlq(OCPP_EVENTS_QUEUE, handler)` instead of `consume()`. On handler throw: retries up to 3× with 5s/30s/120s backoff (tracked via `x-retry-count` AMQP header), then dead-letters to `PANDA_EV_QUEUE_DLX` → `PANDA_EV_QUEUE_DLQ`. Main queue (`PANDA_EV_QUEUE`) is **not** re-asserted with DLX args from Mobile — OCPP owns that assertion. Mobile only asserts the DLX exchange and DLQ queue.

Required env vars in `panda-ev-client-mobile/.env`:
```
RABBITMQ_OCPP_EVENTS_DLQ=PANDA_EV_QUEUE_DLQ
RABBITMQ_OCPP_EVENTS_DLX=PANDA_EV_QUEUE_DLX
```

### Mobile — Real-time Charging Status (SSE vs Polling)

Two endpoints serve live session data — choose based on use case:

| Endpoint | Type | Use when |
|---|---|---|
| `GET /api/mobile/v1/charging-sessions/:id/stream` | SSE (push) | Mobile app active screen — server pushes on every MeterValues |
| `GET /api/mobile/v1/charging-sessions/:id/live` | HTTP (snapshot) | One-shot status check, or platforms without SSE support |

SSE events: meter data object → `{ heartbeat: true }` every 30s → `{ ended: true, status, sessionId }` when session leaves ACTIVE. Client must close `EventSource` on `ended: true`.

**Known Mobile API gaps**: No `GET /charging-sessions/:id` single-session detail endpoint — use `GET /charging-sessions?limit=1` filtered by id, or fetch via invoice. No FCM push sent on session `COMPLETED` (only `parking_warning` if parking fee is enabled).

### CacheService Pattern

```ts
const cached = await this.cache.get<T>('resource', query);
if (cached) return cached;
// ... query DB ...
await this.cache.set('resource', query, result);
// On mutations:
await this.cache.invalidate('resource');
```

Cache keys: `cache:{resource}:{md5(params)}`. Per-resource TTLs configured in `cache.service.ts`.

### Admin RBAC Seed Data

- 90 permissions across 9 modules (`{resource}:{action}` format)
- 3 roles: `super-admin` (all), `admin` (80), `viewer` (18 read-only)
- Default admin: `admin@pandaev.com` / `Admin@123456`

### Docker — Admin Service Entry Point

`panda-ev-csms-system-admin` has no `rootDir` in `tsconfig.json`, so TypeScript preserves `src/` in output. **Production entry is `dist/src/main.js`**, not `dist/main.js`. `docker-entrypoint.sh`: (1) writes `DATABASE_URL` to `/app/.env` (Prisma 7 reads `.env` file, not `process.env`), (2) runs `prisma migrate deploy`, (3) starts `node dist/src/main`.

## Session Documentation Convention

Implementation sessions are saved to `docs/YYYY-MM-DD/YYYY-MM-DDTHH:mm:ss-Topic_Name.md`. Create the date directory first (`mkdir -p docs/$(date +%Y-%m-%d)`), then write the file with timestamp prefix using `date '+%Y-%m-%d %H:%M:%S'`.
