# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Structure

This monorepo contains 4 services for a Panda EV (electric vehicle) charging platform. Each service has its own `CLAUDE.md` with service-specific guidance.

| Service | Port | Purpose |
|---------|------|---------|
| `panda-ev-ocpp/` | 4002 | OCPP 1.6J CSMS — WebSocket server handling charger protocol |
| `panda-ev-csms-system-admin/` | 3001 | Admin backend — IAM, stations, pricing, CMS |
| `panda-ev-client-mobile/` | 4001 | Mobile app backend — auth, wallet, charging sessions |
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

# 2. Push secrets to K8s (run from each service directory)
cd panda-ev-csms-system-admin && ./create-secret.sh
cd panda-ev-client-mobile     && ./create-secret.sh
cd panda-ev-ocpp              && ./create-secret.sh
```

`generate-service-keys.sh` (monorepo root) is the original version that stores all keys in a single `keys/` directory. `generate-service-keys-local.sh` stores each service's keys inside that service's own `keys/` directory and cross-copies peer public keys automatically — prefer this one.

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

Admin Portal ──► Admin System (3001) ──► PostgreSQL (panda_ev_system)
```

### RabbitMQ Queues

All RabbitMQ messages are signed with RS256 `x-service-token` headers. Consumers verify the token before processing.

| Queue | Direction | Payload |
|---|---|---|
| `PANDA_EV_CSMS_COMMANDS` | Mobile → OCPP | `{ routingKey: 'session.start'\|'session.stop', sessionId, identity, connectorId, mobileUserId }` |
| `PANDA_EV_QUEUE` | OCPP → Mobile | `transaction.started`, `transaction.stopped`, `charger.booted`, `connector.status_changed` |
| `PANDA_EV_USER_EVENTS` | Mobile → Admin | user registration events (admin mirrors user profiles) |
| `PANDA_EV_SYSTEM_EVENTS` | Admin → Mobile | `{ routingKey: 'content.invalidate', slug }` for Redis cache invalidation |
| `message.created` | Chat → Admin | consumed by Admin notification module for push notifications |

### Service-to-Service Security (RS256 JWT)

All three NestJS services implement `ServiceAuthModule` (`src/common/service-auth/`) which provides `ServiceJwtService`:

- **Signing** (`RabbitMQService.publish`): attaches a 30-second RS256 JWT as `x-service-token` AMQP header. Token payload: `{ iss, aud, iat, exp, jti }`.
- **Verification** (`RabbitMQService` consumer): validates `x-service-token` signature against the issuer's trusted public key, then checks Redis jti blacklist (60 s TTL) to prevent replay. Messages that fail verification are nacked and discarded.
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

`generate-service-keys-local.sh` cross-copies peer public keys automatically, so `TRUSTED_SERVICE_PUBLIC_KEYS_DIR` works without manual steps.

**Module load order**: `ServiceAuthModule` must be imported before `RabbitMQModule` in each service's `app.module.ts` because `RabbitMQService` injects `ServiceJwtService`.

**OCPP does not issue user JWTs** — it only needs `SERVICE_JWT_PRIVATE_KEY` and `TRUSTED_SERVICE_PUBLIC_KEYS`.

### Database Isolation

Each service owns its schema exclusively — no cross-database joins:

- `panda_ev_ocpp` — Charger, Connector, Transaction, OcppLog
- `panda_ev_core` — User, Profile, Vehicle, Wallet, ChargingSession, Payment, Invoice, + others
- `panda_ev_system` — User (admin), Role, Group, Permission, Station, Charger, Connector, Banner, News, PricingTier, + others

**Prisma client** is generated to `generated/prisma/` at each service root (not `@prisma/client`). Import path from `src/modules/foo/` (3 levels deep): `../../../generated/prisma/client`.

**Cross-DB exception**: Mobile API reads station/pricing data from `panda_ev_system` via `SystemDbService` (raw pg Pool at `src/configs/prisma/system-db.service.ts`). Call `this.systemDb.withClient(async (client) => { ... })`. Always Redis-cache results (TTL 2–5 min). Writes to admin DB are fire-and-forget via `.catch(() => null)`.

### OCPP WebSocket

Charge points connect to `ws://<host>/ocpp/<chargeBoxIdentity>` with subprotocol `ocpp1.6`. The VCP simulator exposes an admin HTTP API on port 9999: `POST http://localhost:9999/execute` with `{ action, payload }`. Admin scripts live in `ocpp-virtual-charge-point/admin/`.

### Shared Conventions (all NestJS services)

**Infrastructure**: Redis (hard requirement — app exits if unreachable at boot), RabbitMQ (soft-fail with warning), PostgreSQL via Prisma.

**URL prefixes**: Admin → `/admin/v1/`, Mobile → `/api/mobile/v1/`, OCPP → WebSocket only.

**API response shape**:
```ts
{ success: boolean, statusCode: number, data: T | null, message: string, errorCode?: string, errors?: ValidationErrorDetail[], meta?: PaginationMeta, timestamp: string }
```

**Soft delete**: Never hard-delete. Set `deletedAt: new Date()`. All queries filter `deletedAt: null`.

**Timezone**: All response dates convert to Asia/Vientiane (UTC+7) via `TimezoneInterceptor`.

**i18n**: Custom `AsyncLocalStorage`-based (not `@nestjs/i18n`). Use helpers from `src/common/i18n/`:
- `t('key')` — for return values / data payloads
- `i18nMessage('key')` — for thrown exceptions only; `GlobalExceptionFilter` resolves the `i18n:key` sentinel. **Do not use in return values** — the sentinel leaks to the client.

Translation files: `src/common/i18n/translations/{en,lo,zh}.json`. Add new keys to all three files.

**Auth guard**: `@Public()` bypasses `JwtAuthGuard`. Admin also has `PermissionsGuard` — permission slugs follow `{resource}:{action}` format (e.g. `stations:read`).

**Exception pattern**: Use typed exceptions (`NotFoundException`, `ConflictException`) or `HttpException(i18nMessage('key'), HttpStatus.X)`. `TooManyRequestsException` does not exist in NestJS — use `HttpException` with `HttpStatus.TOO_MANY_REQUESTS`.

### Module Inventory

**Admin** (`panda-ev-csms-system-admin/src/modules/`):
`auth`, `iam` (users/roles/groups/permissions), `cms`, `news`, `notification`, `audit-log`, `system-settings`, `station`, `location`, `pricing`, `mobile-user`, `legal-content`, `enums`, `health`, `cache`

**Mobile** (`panda-ev-client-mobile/src/modules/`):
`auth`, `profile`, `vehicle`, `wallet`, `charging-session`, `station`, `payment`, `invoice`, `financial`, `content`, `favorite`, `fcm`, `notification`, `app-config`, `enums`, `health`, `cache`, `audit-log`

**OCPP** (`panda-ev-ocpp/src/modules/`):
`ocpp` (single module — handles all charger WebSocket protocol, auth, and message routing)

### Billing Architecture

All billing config lives in `panda_ev_system.pricing_tiers` — **not** in stations. Stations only store name, address, location, and hours.

`PricingTier` fields: `rate_per_kwh`, `plug_type` (GBT/CCS2/null=all), `enable_unplug_fee`, `unplug_fee_amount`, `enable_parking_fee`, `parking_fee_per_minute`, `parking_free_minutes`. `StationPricing` links tiers to stations with `priority` (higher = used first).

Session start flow in Mobile API (`charging-session.service.ts`):
1. Query highest-priority active `PricingTier` for the charger+connector via LATERAL JOIN through `SystemDbService`
2. Snapshot entire billing config into Redis at `charging:session:{id}` (8 h TTL)
3. `OcppConsumerService` reads only from Redis at billing time — never re-queries pricing

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
