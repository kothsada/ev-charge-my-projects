# Refactor Bank Payment Methods — Combine into `bank_provider_configs`

**Date**: 2026-04-19  
**Session type**: Refactor (follow-up to `2026-04-19T14:53:44-Implement_Bank_Payment_Method_Gateway_Mobile_Sync.md`)  
**Services changed**: `panda-ev-gateway-services`, `panda-ev-csms-system-admin`, `panda-ev-client-mobile`

---

## Why the Refactor

The initial implementation created a separate `payment_methods` table in the Gateway and synced it to an `available_payment_methods` table in Mobile via RabbitMQ. This was redundant — `bank_provider_configs` already owns all credential data (mcid, shopcode, terminalId, bankAccount) that banks provide. Mobile users only need to **select** which bank to use; they never see credentials.

**Decision**: Drop both new tables, add `logo_url` + `sort_order` to `bank_provider_configs`, expose a safe public endpoint on the gateway, and let Mobile call it directly via HTTP.

---

## Architecture After Refactor

```
Admin
  PATCH /api/admin/v1/gateway/bank-configs/:id
    → updates bank_provider_configs.logo_url / sort_order
         │
         ▼
  panda_ev_gateway.bank_provider_configs  ← single source of truth

Gateway
  GET /api/gateway/v1/payments/bank-methods  (public, no auth)
    → returns active mode configs (safe fields only, no credentials)
         │
         ▼
Mobile
  GET /api/mobile/v1/payment/methods/available
    → proxies gateway HTTP call → returns list to app

  POST /api/mobile/v1/payment/initiate
    paymentMethodId = bank_provider_configs.id  (bankConfigId)
         │
         ▼
  POST /api/gateway/v1/payments/internal
    bankConfigId → gateway resolves provider + mode internally
```

No RabbitMQ sync needed. No local table in Mobile. Always live from gateway.

---

## Migrations Applied

### Gateway — `20260419130000_refactor_bank_provider_configs`

```sql
DROP TABLE IF EXISTS "panda_ev_gateway"."payment_methods";

ALTER TABLE "panda_ev_gateway"."bank_provider_configs"
  ADD COLUMN IF NOT EXISTS "logo_url"   VARCHAR(500),
  ADD COLUMN IF NOT EXISTS "sort_order" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS "idx_bank_provider_configs_sort_order"
  ON "panda_ev_gateway"."bank_provider_configs" ("sort_order");
```

**Actual output:**
```
DROP TABLE
ALTER TABLE
CREATE INDEX
```

### Mobile — `20260419130001_drop_available_payment_methods`

```sql
DROP TABLE IF EXISTS "panda_ev_mobile"."available_payment_methods";
```

**Actual output:**
```
DROP TABLE
```

---

## Files Changed

### Gateway (`panda-ev-gateway-services`)

| File | Change |
|------|--------|
| `prisma/schema.prisma` | Removed `PaymentMethod` model; added `logoUrl` + `sortOrder` to `BankProviderConfig` |
| `prisma/migrations/20260419130000_refactor_bank_provider_configs/migration.sql` | New migration |
| `src/modules/payment/dto/service-initiate-payment.dto.ts` | Added `bankConfigId?: string`; overrode `provider` as `@IsOptional()` |
| `src/modules/payment/payment.service.ts` | Added `getBankMethods()`; updated `initiateInternal()` to resolve provider from `bankConfigId` |
| `src/modules/payment/payment.controller.ts` | Added `GET /bank-methods` (`@Public()`, no auth) |

### Admin (`panda-ev-csms-system-admin`)

| File | Change |
|------|--------|
| `src/modules/gateway-payments/dto/gateway-payment.dto.ts` | Removed `CreatePaymentMethodDto`, `UpdatePaymentMethodDto`, `QueryPaymentMethodDto`; added `logoUrl?` + `sortOrder?` to `UpdateBankConfigDto` |
| `src/modules/gateway-payments/gateway-payments.service.ts` | Removed RabbitMQ injection, payment method CRUD methods; updated SELECT queries to include `logo_url`/`sort_order`; added `logoUrl`/`sortOrder` to `updateBankConfig` fieldMap |
| `src/modules/gateway-payments/gateway-payments.controller.ts` | Removed `GatewayPaymentMethodController` |
| `src/modules/gateway-payments/gateway-payments.module.ts` | Removed `GatewayPaymentMethodController` from controllers array |

### Mobile (`panda-ev-client-mobile`)

| File | Change |
|------|--------|
| `prisma/schema.prisma` | Removed `AvailablePaymentMethod` model |
| `prisma/migrations/20260419130001_drop_available_payment_methods/migration.sql` | New migration |
| `src/modules/payment/payment.service.ts` | Removed `GATEWAY_PROVIDER_MAP`; updated `getAvailableMethods()` to call gateway HTTP; updated `initiate()` to pass `bankConfigId` instead of resolving provider locally |
| `src/modules/payment/payment-event.consumer.ts` | Removed `payment_method.synced` and `payment_method.deleted` handlers |

---

## Gateway New Endpoint

### `GET /api/gateway/v1/payments/bank-methods`

- **Auth**: `@Public()` — no authentication required
- **Response**: active mode configs, safe fields only

```json
[
  {
    "id": "uuid",
    "provider": "BCEL",
    "name": "BCEL Bank",
    "minAmount": 1000,
    "logoUrl": "https://storage.pandaev.com/logos/bcel.png",
    "sortOrder": 0
  }
]
```

### Updated `POST /api/gateway/v1/payments/internal`

Now accepts `bankConfigId` in addition to `provider`:

```json
{
  "userId": "user-uuid",
  "bankConfigId": "bank-config-uuid",
  "amount": 50000,
  "idempotencyKey": "TOPUP-xxx",
  "context": "wallet_topup"
}
```

If `bankConfigId` is provided: gateway looks up `bank_provider_configs` → resolves `provider` + `mode` automatically.  
If `bankConfigId` is absent: falls back to `provider` field, or defaults to `BCEL` if neither is set.

---

## Mobile Flow After Refactor

1. Mobile calls `GET /payment/methods/available`
2. Mobile service calls `GET {GATEWAY_URL}/api/gateway/v1/payments/bank-methods`
3. User selects a bank — stores its `id` as `paymentMethodId`
4. Mobile calls `POST /payment/initiate` with `{ paymentMethodId: "bank-config-uuid", amount: ... }`
5. Mobile service calls gateway with `{ bankConfigId: "bank-config-uuid", ... }`
6. Gateway resolves provider internally → generates QR

---

## Admin Flow After Refactor

To set logo and sort order for a bank provider:

```bash
PATCH /api/admin/v1/gateway/bank-configs/:id
{
  "logoUrl": "https://storage.pandaev.com/logos/bcel.png",
  "sortOrder": 0
}
```

No separate "payment methods" concept — admins manage `bank_provider_configs` directly.

---

## Type Check Results

```
panda-ev-gateway-services   → npx tsc --noEmit → ✅ 0 errors
panda-ev-csms-system-admin  → npx tsc --noEmit → ✅ 0 errors
panda-ev-client-mobile      → npx tsc --noEmit → ✅ 0 errors
```

---

## Key Design Decisions

| Decision | Reason |
|----------|--------|
| Use `bank_provider_configs` as source of truth | It already holds bank credentials; adding display fields avoids a parallel table |
| Gateway exposes `GET /bank-methods` as `@Public()` | Mobile doesn't need service JWT for a read-only, non-sensitive list |
| `bankConfigId` → gateway resolves provider | Mobile never needs to know provider strings; gateway handles all credential mapping |
| RabbitMQ sync removed | No local table to sync; HTTP call is synchronous and always fresh |
| RabbitMQ fallback path still uses `provider: 'BCEL'` | Fallback path is a degraded mode; BCEL is the only production provider currently |
