# Bank Payment Method Management

**Date**: 2026-04-19  
**Services affected**: Gateway, Admin (CSMS), Mobile

---

## Overview

Implemented admin-managed bank payment methods that are synced to the mobile app so users can select a payment provider when topping up their wallet.

**Requirement**: Only superadmin can create/update/delete payment methods.

---

## Architecture

```
Admin superadmin
  POST/PATCH/DELETE /api/admin/v1/gateway/payment-methods
        ↓ (writes to panda_ev_gateway.payment_methods via GatewayDbService)
        ↓ (publishes payment_method.synced / payment_method.deleted to PANDA_EV_PAYMENT_EVENTS)
                                ↓
                      Mobile PaymentEventConsumer
                        → upsert / delete panda_ev_mobile.available_payment_methods
                                ↓
                      GET /api/mobile/v1/payment/methods/available
```

---

## Files Changed

### Gateway (`panda-ev-gateway-services`)

| File | Change |
|---|---|
| `prisma/schema.prisma` | Added `PaymentMethod` model |
| `prisma/migrations/20260419120000_add_payment_methods/migration.sql` | New table |

### Admin (`panda-ev-csms-system-admin`)

| File | Change |
|---|---|
| `src/modules/gateway-payments/dto/gateway-payment.dto.ts` | Added `CreatePaymentMethodDto`, `UpdatePaymentMethodDto`, `QueryPaymentMethodDto` |
| `src/modules/gateway-payments/gateway-payments.service.ts` | Injected `RabbitMQService`; added `createPaymentMethod`, `findAllPaymentMethods`, `findOnePaymentMethod`, `updatePaymentMethod`, `deletePaymentMethod` |
| `src/modules/gateway-payments/gateway-payments.controller.ts` | Added `GatewayPaymentMethodController` |
| `src/modules/gateway-payments/gateway-payments.module.ts` | Registered new controller |

### Mobile (`panda-ev-client-mobile`)

| File | Change |
|---|---|
| `prisma/schema.prisma` | Added `AvailablePaymentMethod` model |
| `prisma/migrations/20260419120001_add_available_payment_methods/migration.sql` | New table |
| `src/modules/payment/payment-event.consumer.ts` | Added `onPaymentMethodSynced` and `onPaymentMethodDeleted` handlers |
| `src/modules/payment/payment.service.ts` | Added `getAvailableMethods()` |
| `src/modules/payment/payment.controller.ts` | Added `GET /payment/methods/available` |

---

## Admin Endpoints

All under `/api/admin/v1/gateway/payment-methods`:

| Method | Path | Permission | Superadmin only |
|---|---|---|---|
| `POST` | `/` | `payments:manage` | ✅ |
| `GET` | `/` | `payments:read` | ❌ |
| `GET` | `/:id` | `payments:read` | ❌ |
| `PATCH` | `/:id` | `payments:manage` | ✅ |
| `DELETE` | `/:id` | `payments:manage` | ✅ |

Superadmin check: `permissions.includes('roles:manage')` → throws 403 if missing.

---

## Mobile Endpoint

`GET /api/mobile/v1/payment/methods/available`  
Returns active methods ordered by `sortOrder`, then `syncedAt`.

---

## RabbitMQ Events (PANDA_EV_PAYMENT_EVENTS)

### `payment_method.synced`
Published on create and update:
```json
{
  "routingKey": "payment_method.synced",
  "id": "uuid",
  "name": "BCEL OnePay",
  "code": "BCEL",
  "provider": "BCEL",
  "description": "...",
  "logoUrl": "https://...",
  "isActive": true,
  "sortOrder": 0,
  "minAmount": 1000,
  "maxAmount": null,
  "currency": "LAK"
}
```

### `payment_method.deleted`
Published on soft-delete:
```json
{
  "routingKey": "payment_method.deleted",
  "id": "uuid",
  "code": "BCEL"
}
```

---

## Deployment Steps

```bash
# 1. Apply gateway migration
psql "$GATEWAY_DATABASE_URL" < panda-ev-gateway-services/prisma/migrations/20260419120000_add_payment_methods/migration.sql
cd panda-ev-gateway-services && npx prisma migrate resolve --applied 20260419120000_add_payment_methods && npx prisma generate

# 2. Apply mobile migration
psql "$DATABASE_URL" < panda-ev-client-mobile/prisma/migrations/20260419120001_add_available_payment_methods/migration.sql
cd panda-ev-client-mobile && DATABASE_URL=... npx prisma migrate resolve --applied 20260419120001_add_available_payment_methods && DATABASE_URL=... npx prisma generate

# 3. Deploy admin and mobile services
```

---

## Notes

- `GatewayDbService` is used for both reads AND writes (following the existing `updateBankConfig` precedent).
- `PANDA_EV_PAYMENT_EVENTS` is reused for method sync — mobile's `PaymentEventConsumer` now handles `payment_method.*` routing keys before the `context === 'wallet_topup'` guard.
- Mobile's `AvailablePaymentMethod.id` is the same UUID as the gateway record, enabling idempotent upserts.
