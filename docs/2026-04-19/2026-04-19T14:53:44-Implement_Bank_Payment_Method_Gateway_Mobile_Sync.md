# Implement Bank Payment Method — Gateway Owner → Mobile Sync

**Date**: 2026-04-19  
**Session type**: Feature implementation  
**Services changed**: `panda-ev-csms-system-admin`, `panda-ev-gateway-services`, `panda-ev-client-mobile`

---

## What Was Built

A full lifecycle for admin-managed bank payment methods:

1. **Admin (CSMS)** — Superadmin creates/updates/deletes a payment method via REST API
2. **Gateway** — Owns the source-of-truth table `payment_methods`; admin writes directly via `GatewayDbService`
3. **RabbitMQ** — Admin publishes a sync event to `PANDA_EV_PAYMENT_EVENTS`
4. **Mobile** — Consumes the event and upserts into `available_payment_methods`; exposes a read endpoint for the app

```
Superadmin
  POST /api/admin/v1/gateway/payment-methods
         │
         ▼
  GatewayDbService (raw SQL INSERT)
  → panda_ev_gateway.payment_methods   ← source of truth
         │
         ▼
  RabbitMQ: PANDA_EV_PAYMENT_EVENTS
  routingKey: payment_method.synced
         │
         ▼
  Mobile PaymentEventConsumer
  → prisma.availablePaymentMethod.upsert()
  → panda_ev_mobile.available_payment_methods
         │
         ▼
  GET /api/mobile/v1/payment/methods/available
```

---

## Why GatewayDbService for Writes?

The admin already used `GatewayDbService` to **write** in the existing `updateBankConfig()` method. This established precedent was followed for payment methods rather than adding a new internal HTTP endpoint on the gateway service, keeping the implementation simpler while staying consistent with the existing codebase pattern.

---

## Files Changed

### 1. `panda-ev-gateway-services`

#### `prisma/schema.prisma`
Added `PaymentMethod` model between `BankProviderConfig` and `WebhookLog`:

```prisma
model PaymentMethod {
  id          String          @id @default(uuid()) @db.Uuid
  name        String          @db.VarChar(255)
  code        String          @unique @db.VarChar(50)   // e.g. "BCEL", "JDB"
  provider    PaymentProvider
  description String?         @db.VarChar(500)
  logoUrl     String?         @map("logo_url") @db.VarChar(500)
  isActive    Boolean         @default(true) @map("is_active")
  sortOrder   Int             @default(0) @map("sort_order")
  minAmount   Int             @default(1000) @map("min_amount")
  maxAmount   Int?            @map("max_amount")
  currency    String          @default("LAK") @db.VarChar(10)
  deletedAt   DateTime?       @map("deleted_at") @db.Timestamptz(6)
  createdAt   DateTime        @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt   DateTime        @updatedAt @map("updated_at") @db.Timestamptz(6)

  @@index([isActive], map: "idx_payment_methods_active")
  @@index([provider], map: "idx_payment_methods_provider")
  @@map("payment_methods")
  @@schema("panda_ev_gateway")
}
```

#### `prisma/migrations/20260419120000_add_payment_methods/migration.sql` *(new)*
```sql
CREATE TABLE "panda_ev_gateway"."payment_methods" (
    "id"          UUID            NOT NULL DEFAULT gen_random_uuid(),
    "name"        VARCHAR(255)    NOT NULL,
    "code"        VARCHAR(50)     NOT NULL,
    "provider"    "panda_ev_gateway"."PaymentProvider" NOT NULL,
    "description" VARCHAR(500),
    "logo_url"    VARCHAR(500),
    "is_active"   BOOLEAN         NOT NULL DEFAULT true,
    "sort_order"  INTEGER         NOT NULL DEFAULT 0,
    "min_amount"  INTEGER         NOT NULL DEFAULT 1000,
    "max_amount"  INTEGER,
    "currency"    VARCHAR(10)     NOT NULL DEFAULT 'LAK',
    "deleted_at"  TIMESTAMPTZ(6),
    "created_at"  TIMESTAMPTZ(6)  NOT NULL DEFAULT NOW(),
    "updated_at"  TIMESTAMPTZ(6)  NOT NULL DEFAULT NOW(),
    CONSTRAINT "payment_methods_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "payment_methods_code_key" ON ...("code");
CREATE INDEX "idx_payment_methods_active" ON ...("is_active");
CREATE INDEX "idx_payment_methods_provider" ON ...("provider");
```

---

### 2. `panda-ev-csms-system-admin`

#### `src/modules/gateway-payments/dto/gateway-payment.dto.ts`
Added three new DTO classes at the bottom of the existing file:

| DTO | Purpose |
|-----|---------|
| `CreatePaymentMethodDto` | Validates POST body (`name`, `code`, `provider` required; rest optional) |
| `UpdatePaymentMethodDto` | Extends `PartialType(CreatePaymentMethodDto)` — all fields optional |
| `QueryPaymentMethodDto` | Query filters for list endpoint (`provider`, `isActive`) |

Key validator added to imports: `IsUrl`, `MaxLength`, `PartialType` (from `@nestjs/swagger`).

#### `src/modules/gateway-payments/gateway-payments.service.ts`
**Constructor change** — injected `RabbitMQService`:
```ts
constructor(
  private readonly gatewayDb: GatewayDbService,
  private readonly rabbitMQ: RabbitMQService,   // ← added
) {}
```

**New constant** at top of file:
```ts
const PAYMENT_EVENTS_QUEUE =
  process.env.RABBITMQ_PAYMENT_EVENTS_QUEUE ?? 'PANDA_EV_PAYMENT_EVENTS';
```

**New private helper**:
```ts
private assertSuperAdmin(permissions: string[]): void {
  if (!permissions.includes('roles:manage')) {
    throw new ForbiddenException(
      'Only super-admins can manage bank payment methods',
    );
  }
}
```

**New public methods**:

| Method | What it does |
|--------|-------------|
| `createPaymentMethod(dto, permissions)` | `assertSuperAdmin` → INSERT via GatewayDbService → publish `payment_method.synced` |
| `findAllPaymentMethods(query)` | SELECT with optional `provider` / `isActive` filters, ordered by `sort_order` |
| `findOnePaymentMethod(id)` | SELECT by id, throws `NotFoundException` if missing/deleted |
| `updatePaymentMethod(id, dto, permissions)` | `assertSuperAdmin` → dynamic SET clauses → publish `payment_method.synced` |
| `deletePaymentMethod(id, permissions)` | `assertSuperAdmin` → soft-delete (`deleted_at = NOW()`) → publish `payment_method.deleted` |
| `publishMethodSynced(row)` *(private)* | Publishes full method payload to `PANDA_EV_PAYMENT_EVENTS` |

**Insert uses `randomUUID()`** (Node crypto) to generate the UUID server-side before passing it as a SQL parameter — avoiding Prisma ORM for this cross-service write.

#### `src/modules/gateway-payments/gateway-payments.controller.ts`
Added a new controller class at the bottom of the file:

```ts
@ApiBearerAuth()
@ApiTags('Gateway — Payment Methods')
@Controller('gateway/payment-methods')
export class GatewayPaymentMethodController {

  @Post()            // superadmin — create
  @Get()             // payments:read — list
  @Get(':id')        // payments:read — detail
  @Patch(':id')      // superadmin — update
  @Delete(':id')     // superadmin — soft-delete
}
```

All write endpoints pass `@CurrentUser('permissions')` to the service so `assertSuperAdmin` can run.

#### `src/modules/gateway-payments/gateway-payments.module.ts`
Registered `GatewayPaymentMethodController` in the `controllers` array.

---

### 3. `panda-ev-client-mobile`

#### `prisma/schema.prisma`
Added `AvailablePaymentMethod` model (inserted between `Payment` and `AppConfig`):

```prisma
model AvailablePaymentMethod {
  id          String   @id @db.Uuid          // same UUID as gateway record
  name        String   @db.VarChar(255)
  code        String   @unique @db.VarChar(50)
  provider    String   @db.VarChar(50)       // stored as plain string (no enum needed)
  description String?  @db.VarChar(500)
  logoUrl     String?  @map("logo_url") @db.VarChar(500)
  isActive    Boolean  @default(true) @map("is_active")
  sortOrder   Int      @default(0) @map("sort_order")
  minAmount   Int      @default(1000) @map("min_amount")
  maxAmount   Int?     @map("max_amount")
  currency    String   @default("LAK") @db.VarChar(10)
  syncedAt    DateTime @default(now()) @map("synced_at") @db.Timestamptz(6)
  updatedAt   DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  @@index([isActive], map: "idx_avail_payment_methods_active")
  @@map("available_payment_methods")
  @@schema("panda_ev_mobile")
}
```

> **Design note**: `provider` is stored as `String` instead of an enum because mobile doesn't need to enforce gateway enum values — it just displays whatever the gateway sends.

> **Design note**: `id` has no `@default(uuid())` — the value always comes from the gateway record, so mobile never generates it.

#### `prisma/migrations/20260419120001_add_available_payment_methods/migration.sql` *(new)*
```sql
CREATE TABLE "panda_ev_mobile"."available_payment_methods" (
    "id"          UUID            NOT NULL,
    "name"        VARCHAR(255)    NOT NULL,
    "code"        VARCHAR(50)     NOT NULL,
    "provider"    VARCHAR(50)     NOT NULL,
    ...
    CONSTRAINT "available_payment_methods_pkey" PRIMARY KEY ("id")
);
```

#### `src/modules/payment/payment-event.consumer.ts`
**Router change** — payment method events are handled BEFORE the `context !== 'wallet_topup'` guard:

```ts
private async handleEvent(msg: Record<string, unknown>): Promise<void> {
  // ① Payment method sync — no context required
  switch (msg.routingKey) {
    case 'payment_method.synced':
      await this.onPaymentMethodSynced(msg);
      return;
    case 'payment_method.deleted':
      await this.onPaymentMethodDeleted(msg);
      return;
  }

  // ② Wallet top-up events (existing logic unchanged)
  const context = msg.context as string | undefined;
  if (context !== 'wallet_topup') return;
  ...
}
```

**New handler — `onPaymentMethodSynced`**:
```ts
await this.prisma.availablePaymentMethod.upsert({
  where: { id },
  create: { id, name, code, provider, ... },
  update: { name, code, provider, ..., syncedAt: new Date() },
});
```
Idempotent: replaying the same event produces the same result.

**New handler — `onPaymentMethodDeleted`**:
```ts
await this.prisma.availablePaymentMethod
  .delete({ where: { id } })
  .catch(() => null); // no-op if already gone
```

#### `src/modules/payment/payment.service.ts`
New method added after `listMethods()`:
```ts
async getAvailableMethods() {
  return this.prisma.availablePaymentMethod.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: 'asc' }, { syncedAt: 'asc' }],
    select: {
      id, name, code, provider, description,
      logoUrl, minAmount, maxAmount, currency, sortOrder,
    },
  });
}
```

#### `src/modules/payment/payment.controller.ts`
New endpoint added BEFORE `GET /payment/methods` (order matters for NestJS route matching):

```ts
@Get('methods/available')
async getAvailableMethods() {
  return this.paymentService.getAvailableMethods();
}
```

---

## RabbitMQ Event Contracts

### `payment_method.synced` (create + update)

```json
{
  "routingKey": "payment_method.synced",
  "id": "3f2e1a00-...",
  "name": "BCEL OnePay",
  "code": "BCEL",
  "provider": "BCEL",
  "description": "ຊຳລະຜ່ານ BCEL OnePay QR Code",
  "logoUrl": "https://storage.pandaev.com/logos/bcel.png",
  "isActive": true,
  "sortOrder": 0,
  "minAmount": 1000,
  "maxAmount": null,
  "currency": "LAK"
}
```

### `payment_method.deleted` (soft-delete)

```json
{
  "routingKey": "payment_method.deleted",
  "id": "3f2e1a00-...",
  "code": "BCEL"
}
```

Both events are published to the existing `PANDA_EV_PAYMENT_EVENTS` queue — no new queue was created.

---

## Admin API Reference

Base path: `/api/admin/v1/gateway/payment-methods`

| Method | Path | Permission | Superadmin required |
|--------|------|-----------|---------------------|
| `POST` | `/` | `payments:manage` | ✅ (`roles:manage`) |
| `GET` | `/` | `payments:read` | ❌ |
| `GET` | `/:id` | `payments:read` | ❌ |
| `PATCH` | `/:id` | `payments:manage` | ✅ |
| `DELETE` | `/:id` | `payments:manage` | ✅ |

**Request body example (POST / PATCH)**:
```json
{
  "name": "BCEL OnePay",
  "code": "BCEL",
  "provider": "BCEL",
  "description": "ຊຳລະຜ່ານ BCEL OnePay QR Code",
  "logoUrl": "https://storage.pandaev.com/logos/bcel.png",
  "isActive": true,
  "sortOrder": 0,
  "minAmount": 1000,
  "maxAmount": null,
  "currency": "LAK"
}
```

**Response shape**:
```json
{
  "success": true,
  "statusCode": 201,
  "data": {
    "id": "3f2e1a00-...",
    "name": "BCEL OnePay",
    "code": "BCEL",
    "provider": "BCEL",
    "description": "...",
    "logoUrl": "...",
    "isActive": true,
    "sortOrder": 0,
    "minAmount": 1000,
    "maxAmount": null,
    "currency": "LAK",
    "createdAt": "2026-04-19T07:28:54.000Z",
    "updatedAt": "2026-04-19T07:28:54.000Z"
  },
  "message": "Created",
  "timestamp": "2026-04-19T07:28:54.000Z"
}
```

---

## Mobile API Reference

`GET /api/mobile/v1/payment/methods/available`  
Requires: Bearer JWT (any authenticated user)

**Response example**:
```json
{
  "success": true,
  "statusCode": 200,
  "data": [
    {
      "id": "3f2e1a00-...",
      "name": "BCEL OnePay",
      "code": "BCEL",
      "provider": "BCEL",
      "description": "ຊຳລະຜ່ານ BCEL OnePay QR Code",
      "logoUrl": "https://storage.pandaev.com/logos/bcel.png",
      "minAmount": 1000,
      "maxAmount": null,
      "currency": "LAK",
      "sortOrder": 0
    }
  ],
  "message": "OK",
  "timestamp": "2026-04-19T07:28:54.000Z"
}
```

Filters: only `isActive = true` rows, ordered by `sort_order ASC`, then `synced_at ASC`.

---

## Type-check Results

```
panda-ev-csms-system-admin  →  npx tsc --noEmit  →  ✅ 0 errors
panda-ev-client-mobile      →  npx tsc --noEmit  →  ✅ 0 errors  (after prisma generate)
panda-ev-gateway-services   →  npx prisma generate  →  ✅ generated in 31ms
```

---

## Decisions & Trade-offs

| Decision | Reason |
|----------|--------|
| Admin writes to gateway DB directly (not via HTTP) | `updateBankConfig()` already did this — following existing precedent, simpler than adding an internal HTTP endpoint |
| Reuse `PANDA_EV_PAYMENT_EVENTS` queue | Queue already exists and mobile already subscribes; avoids a new queue + consumer wiring |
| `payment_method.*` handled BEFORE `wallet_topup` context guard | These events have no `context` field; the guard would silently drop them if checked first |
| Mobile stores `provider` as `String` not enum | Mobile doesn't enforce gateway enum values — display only; decouples mobile from gateway enum drift |
| `AvailablePaymentMethod.id` = gateway UUID | Enables true idempotent upsert; replaying the event never creates duplicates |
| Soft-delete on gateway, hard-delete on mobile | Gateway keeps audit trail; mobile only needs the live set |
