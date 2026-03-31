# Notification System Refactor — FCM Centralization

**Date:** 2026-03-31
**Scope:** panda-ev-notification, panda-ev-client-mobile

---

## 1. Audit Summary

### What was scattered

| Service | Issue |
|---|---|
| **panda-ev-client-mobile** | `firebase-admin@13.7.0` + `firebase@12.10.0` installed; `FcmService` had full Firebase SDK init, `sendToUser`, `sendToUsers`, `sendToTopic`, `multicast`, `buildPlatformConfig` — all bypassing Notification Service |
| **panda-ev-csms-system-admin** | No Firebase SDK; `Notification`+`NotificationUser` models store `fcm_token` snapshots and `fcmMessageId` / `fcmResponse` — FCM coupling in schema |
| **panda-ev-ocpp** | Clean — no FCM involvement |

### Notification Service pre-refactor gaps

- `UserNotificationPreference` stored FCM tokens as a flat `String[]` — no per-device metadata (platform, appVersion, lastUsedAt, isActive)
- No API to register/query tokens
- No stale-token internal cleanup (relied entirely on Mobile's feedback loop)

---

## 2. Changes Made

### panda-ev-notification

#### Schema: new `user_fcm_devices` table
`prisma/schema.prisma` — added `UserFcmDevice` model:
- `fcmToken` UNIQUE — one row per token
- `isActive` — soft-delete for stale tokens
- `lastUsedAt` — updated on successful delivery
- `@@index([userId, isActive])` — fast active-device lookup
- `@@index([lastUsedAt])` — supports cleanup job (>90 days inactive)

`UserNotificationPreference` — removed `fcmTokens String[]`, `apnsTokens String[]`, `devicePlatforms String[]` (moved to `UserFcmDevice`)

#### Migration: `20260331000001_add_user_fcm_devices`
- Creates `user_fcm_devices` with all indexes
- Drops array columns from `user_notification_preferences`

#### New: `src/modules/device/`
- `DeviceService` — `registerToken`, `unregisterToken`, `unregisterAllForUser`, `getActiveTokens`, `markTokensStale`, `updateLastUsed`, `listDevices`
- `DeviceController` — `POST /v1/devices`, `DELETE /v1/devices`, `GET /v1/devices/:userId` (internal REST)
- `DeviceModule` — exported so `NotificationModule` can inject `DeviceService`

#### Updated: `NotificationProcessor`
- `fcmTokens` in `ProcessNotificationDto` is now **optional**
- If omitted, processor calls `deviceService.getActiveTokens(userId)` — enables future messages without token payload
- Stale token handling now calls `deviceService.markTokensStale()` first, then publishes to `PANDA_EV_FCM_CLEANUP` for Mobile's local cleanup
- On successful delivery, calls `deviceService.updateLastUsed()` to refresh `lastUsedAt`

#### Updated: `NotificationRouter`
- Handles two new routing keys on `PANDA_EV_NOTIFICATIONS` queue:
  - `device.registered` → `deviceService.registerToken(userId, fcmToken, platform, appVersion)`
  - `device.unregistered` → `deviceService.unregisterToken(fcmToken)`

#### Updated: `notification.module.ts`, `app.module.ts`
- `DeviceModule` added to imports

### panda-ev-client-mobile

#### `package.json`
- Removed `firebase@^12.10.0` and `firebase-admin@^13.7.0`
- No Firebase SDK in Mobile API anymore

#### `src/modules/fcm/fcm.service.ts`
- Removed: Firebase SDK init, `resolveCredential`, `messaging` field, `sendToUser`, `sendToUsers`, `sendToTopic`, `multicast`, `buildPlatformConfig`, `chunkArray`, `isConfigured`
- Kept: `registerDevice`, `unregisterDevice`, `unregisterAllDevices`, `listDevices`, stale token consumer
- Added: `sendTestNotification(userId)` — reads tokens from `user_devices`, publishes `notification.targeted` to `PANDA_EV_NOTIFICATIONS` queue
- Token registration now also publishes `device.registered` event to sync Notification Service's `user_fcm_devices`
- Token unregistration now also publishes `device.unregistered` event

#### `src/modules/fcm/device.controller.ts`
- `POST /devices/fcm/test` — no longer calls FCM directly; calls `sendTestNotification()` which enqueues through Notification Service pipeline
- Response changed from `{ sent, failed, pruned }` to `{ queued, deviceCount }`

---

## 3. Centralized FCM Token Schema

### `user_fcm_devices` design rationale

```sql
-- Per-device row (not per-user array) enables:
--   • Granular stale-token eviction
--   • Per-device platform/appVersion metadata
--   • lastUsedAt for cleanup job (purge >90 days inactive)
--   • Atomic upsert when device changes user (token re-registration)

CREATE INDEX ... WHERE is_active = true   -- partial index: only active devices
```

### Stale token lifecycle
1. FCM returns `messaging/invalid-registration-token` on send
2. `FcmService.send()` collects `staleTokens[]`
3. `NotificationProcessor` calls `DeviceService.markTokensStale(tokens)` → `isActive = false`
4. Publishes `device.token_stale` to `PANDA_EV_FCM_CLEANUP` → Mobile API deletes from `user_devices`

---

## 4. Multi-Language Template System

**Existing system in Notification Service is production-ready:**
- `notification_templates` table: `titleLo`, `titleEn`, `titleZh`, `bodyLo`, `bodyEn`, `bodyZh`
- `TemplateService.render(template, lang, vars)` — variable substitution with `{key}` syntax
- Fallback chain: requested lang → `en` default
- Extensible: add `titleTh`/`bodyTh` columns to support new language without code changes

**Template management:** `prisma/seed/seed-templates.ts` seeds all standard notification types.

---

## 5. Service Integration Standard

### RabbitMQ contract (all messages on `PANDA_EV_NOTIFICATIONS`)

| routingKey | Publisher | Consumer | Required fields |
|---|---|---|---|
| `notification.targeted` | Mobile | Notification | `userId`, `type`, `title`, `body`; optional: `fcmTokens[]`, `sessionId`, `data` |
| `notification.session` | Mobile | Notification | Same; dedup applied via `sessionId+type` |
| `notification.broadcast` | Any | Notification | `fcmTokens[]`, `type`, `title`, `body`; `skipDedup: true` implied |
| `notification.overstay_reminder` | Mobile | Notification | Above + `notifyAt` (ISO datetime) |
| `device.registered` | Mobile | Notification | `userId`, `fcmToken`; optional: `platform`, `appVersion` |
| `device.unregistered` | Mobile | Notification | `fcmToken` |

### fcmTokens field: backwards-compatible optional
- **With `fcmTokens[]`**: processor uses provided tokens (legacy path, still supported)
- **Without `fcmTokens[]`**: processor resolves from `user_fcm_devices` by `userId` (new path)
- Both work. Migration to token-free messages can happen incrementally per routing key.

### Direct REST send (bypass queue)
`POST /api/notification/v1/notifications/send` — same shape as `ProcessNotificationDto`; requires `x-service-token` header.

### Device REST API (internal, not in public ingress)
`POST /api/notification/v1/devices` — register token
`DELETE /api/notification/v1/devices` — unregister token
`GET /api/notification/v1/devices/:userId` — list devices

---

## 6. Remaining Work (Not In This PR)

- **Admin Service schema cleanup**: `Notification.fcmMessageId`, `Notification.fcmResponse`, `NotificationChannel` enum values `FCM_TOPIC/FCM_MULTICAST/FCM_SINGLE`, `NotificationUser.fcmToken` are FCM-coupled — can be migrated to use Notification Service logs instead
- **ocpp-consumer.service.ts**: Still reads `user_devices` and passes `fcmTokens[]` in messages — can migrate to userId-only once `user_fcm_devices` is populated
- **Token cleanup cron**: Add `@Cron()` in DeviceService to delete rows with `lastUsedAt < 90 days ago AND isActive = false`
- **P1.1** (charger lock race) and **P1.5** (JWT HS256 fallback) still open from prior audit
