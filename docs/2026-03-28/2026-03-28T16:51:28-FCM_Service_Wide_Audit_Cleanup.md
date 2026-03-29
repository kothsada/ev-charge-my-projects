# FCM Service-Wide Audit & Dead Code Cleanup
**Date:** 2026-03-28 16:50
**Scope:** `panda-ev-client-mobile` — all test files in `charging-session` module
**Trigger:** Follow-up to FCM Decoupling Implementation (2026-03-28 16:27)

---

## Objective

After removing `FcmService` from `OcppConsumerService` (FCM decoupling), run a service-wide audit to:
1. Find remaining stale references to `FcmService` / `firebase-admin` in test files
2. Remove dead code and unused imports
3. Verify `NotificationPayload` schema sent from each service matches `ProcessNotificationDto` in Notification Service
4. Verify OCPP and Admin services have no unintended Firebase references

---

## Findings

### Mobile API — Test Files (Stale — Required Fixes)

| File | Stale Code | Action |
|---|---|---|
| `ocpp-consumer.integration.spec.ts` | `FcmService` import, `buildMockFcm()`, `mockFcm` vars, 3 `sendToUser` assertions | Fixed |
| `regression.spec.ts` | `FcmService` import, `buildMockFcm()`, `mockFcm` vars, 6 `sendToUser` assertions | Fixed |
| `charging-session.service.spec.ts` | `FcmService` import, `makeFcm()`, 1 stale provider | Fixed |
| `billing.atomicity.integration.spec.ts` | `FcmService` import, 1 stale provider | Fixed |
| `user-charging-flow.spec.ts` | No changes needed — `FcmService` used for `AuthService` (valid) | Kept |

### Mobile API — Source Files (Legitimate — Kept As-Is)

| File | Usage | Status |
|---|---|---|
| `fcm/fcm.service.ts` | Owns `firebase-admin` SDK — correct | VALID |
| `auth/auth.service.ts` | `FcmService.unregisterAllDevices()` on logout/delete | VALID |
| `fcm/device.controller.ts` | `fcmService.sendToUser()` for test-push endpoint | VALID |

### OCPP Service (`panda-ev-ocpp`)
- **Result:** Zero `firebase-admin` or `FcmService` references. Clean.

### Admin Service (`panda-ev-csms-system-admin`)
- **Result:** Zero `firebase-admin` or `FcmService` references. Clean.

---

## Changes Made

### 1. `ocpp-consumer.integration.spec.ts`

**Removed:**
- `import { FcmService } from '../fcm/fcm.service'`
- `buildMockFcm()` factory function
- `let mockFcm: ReturnType<typeof buildMockFcm>` from all 6 suites
- `mockFcm = buildMockFcm()` from all `beforeEach` blocks
- `{ provide: FcmService, useValue: mockFcm }` from `buildModule` providers array
- `mockFcm` 4th parameter from all `buildModule(...)` calls

**Added:**
- `publish: jest.fn().mockResolvedValue(undefined)` to `buildMockRabbitMQ()`
- `userDevice: { findMany: jest.fn().mockResolvedValue([{ fcmToken: 'mock-fcm-token' }]) }` to `buildMockPrisma()`

**Assertions replaced (3 locations):**

| Old | New |
|---|---|
| `expect(mockFcm.sendToUser).toHaveBeenCalledWith(userId, { title, data })` | `expect(mockRabbitMQ.publish).toHaveBeenCalledWith(expect.stringContaining('PANDA_EV'), expect.objectContaining({ userId, title, data }))` |
| `expect(mockFcm.sendToUser).not.toHaveBeenCalled()` | `expect(mockRabbitMQ.publish).not.toHaveBeenCalled()` |

---

### 2. `regression.spec.ts`

**Removed:**
- `import { FcmService } from '../fcm/fcm.service'`
- `buildMockFcm()` factory function
- `let mockFcm` vars + `mockFcm = buildMockFcm()` from all 3 suites
- `{ provide: FcmService, useValue: mockFcm }` provider
- `mockFcm` 4th arg from `buildModule` calls

**Added:**
- `publish: jest.fn().mockResolvedValue(undefined)` to `buildMockRabbitMQ()`
- `userDevice: { findMany: jest.fn().mockResolvedValue([{ fcmToken: 'regression-mock-token' }]) }` to `buildMockPrisma()`

**Assertions replaced (6 locations):**

| Test | Old | New |
|---|---|---|
| D4 | `mockFcm.sendToUser` called with `MOBILE_USER, { title: 'Charging Start Failed' }` | `mockRabbitMQ.publish` called with `PANDA_EV_*`, `{ userId: MOBILE_USER, title: 'Charging Start Failed' }` |
| D5 | `mockFcm.sendToUser.mock.calls[0][1].body` | `mockRabbitMQ.publish.mock.calls[0][1].body` |
| E3 | `mockFcm.sendToUser` called with `MOBILE_USER, { title: 'Charger Not Responding' }` | `mockRabbitMQ.publish` called with `PANDA_EV_*`, `{ userId: MOBILE_USER, title: 'Charger Not Responding' }` |
| E4 | `mockFcm.sendToUser.mock.calls[0][1].body` | `mockRabbitMQ.publish.mock.calls[0][1].body` |
| E5 | `expect(mockFcm.sendToUser).not.toHaveBeenCalled()` | `expect(mockRabbitMQ.publish).not.toHaveBeenCalled()` |
| E6 | `mockFcm.sendToUser.mock.calls[0][1].data` | `mockRabbitMQ.publish.mock.calls[0][1].data` |

---

### 3. `charging-session.service.spec.ts`

**Removed:**
- `import { FcmService } from '../fcm/fcm.service'`
- `function makeFcm()` factory
- `{ provide: FcmService, useValue: makeFcm() }` from `OcppConsumerService` test module providers

**Added:**
- `userDevice: { findMany: jest.fn().mockResolvedValue([]) }` to `makePrisma()`

---

### 4. `billing.atomicity.integration.spec.ts`

**Removed:**
- `import { FcmService } from '../fcm/fcm.service'`
- `{ provide: FcmService, useValue: { sendToUser: jest.fn().mockResolvedValue(undefined) } }` provider

> Note: This test uses a real PostgreSQL database. `OcppConsumerService.publishPush()` calls `prisma.userDevice.findMany()` which will return `[]` for test users — causing `publishPush` to return early. No FCM-related side effects.

---

## NotificationPayload Schema Verification

`OcppConsumerService.publishPush()` sends:
```typescript
{
  routingKey: 'notification.targeted' | 'notification.session',
  userId: string,
  fcmTokens: string[],
  type: string,
  title: string,
  body: string,
  data?: Record<string, string>,
  sessionId?: string,
  chargerIdentity?: string,
  skipDedup: boolean,
  priority: 'high',
}
```

`ProcessNotificationDto` in Notification Service expects:
```typescript
{
  userId: string,
  fcmTokens: string[],
  type: string,
  title: string,
  body: string,
  data?: Record<string, string>,
  sessionId?: string,
  chargerIdentity?: string,
  skipDedup?: boolean,
  priority?: 'high' | 'normal',
  // extras: stationId?, imageUrl?, skipRateLimit?
}
```

**Result: Fully aligned. ✓**
`routingKey` is an extra field read by `NotificationRouter` before casting to `ProcessNotificationDto` — no issue.

---

## Type-Check Results

```
cd panda-ev-client-mobile && npx tsc --noEmit  → 0 errors ✓
cd panda-ev-notification  && npx tsc --noEmit  → 0 errors ✓
```

---

## Key Pattern for Future Test Updates

When `OcppConsumerService` (or any service) is decoupled from `FcmService`:

1. Remove `FcmService` from test module `providers` array
2. Add `userDevice: { findMany: jest.fn().mockResolvedValue([{ fcmToken: '...' }]) }` to Prisma mock (so `publishPush` has tokens to work with)
3. Add `publish: jest.fn().mockResolvedValue(undefined)` to RabbitMQ mock
4. Replace `mockFcm.sendToUser` assertions with `mockRabbitMQ.publish` assertions:
   - Called: `expect(mockRabbitMQ.publish).toHaveBeenCalledWith(expect.stringContaining('PANDA_EV'), expect.objectContaining({ userId, title, data }))`
   - Not called: `expect(mockRabbitMQ.publish).not.toHaveBeenCalled()`
   - Payload access: `const [, payload] = mockRabbitMQ.publish.mock.calls[0]`
