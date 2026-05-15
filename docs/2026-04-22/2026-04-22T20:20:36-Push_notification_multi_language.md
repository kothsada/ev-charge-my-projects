# Push Notification Multi-Language Support

**Date:** 2026-04-22  
**Services affected:** `panda-ev-client-mobile`, `panda-ev-csms-system-admin`

---

## Problem

Push notification `title` and `body` strings sent to mobile devices were hardcoded in English (or inconsistently Lao) across all background consumers. The existing i18n system (`AsyncLocalStorage`-based) only works in HTTP request context, so background consumers (OCPP event handler, parking monitor cron, payment event consumer) always fell back to `DEFAULT_LANGUAGE` regardless of user preference.

---

## Solution Architecture

### Language storage
- A new `UserLangInterceptor` runs after every authenticated HTTP request.
- It reads the user's language from the already-set `AsyncLocalStorage` context (populated by `I18nMiddleware` from `Accept-Language` header).
- It writes `user:lang:{userId}` to Redis with a 30-day TTL.

### Background consumer language resolution
- A new helper `getUserLang(userId, redis)` reads `user:lang:{userId}` from Redis, falling back to `DEFAULT_LANGUAGE` if absent.
- Background consumers call this before building any push notification, then pass the resolved language to `t(key, params, lang)`.

### Modified `t()` function
- Added an optional third parameter `langOverride?: SupportedLanguage` to both mobile and admin `t()` functions.
- When provided, it bypasses `getCurrentLang()` (AsyncLocalStorage). HTTP-triggered calls are unaffected.

---

## Files Changed

### `panda-ev-client-mobile`

| File | Change |
|---|---|
| `src/common/i18n/i18n.service.ts` | Added `langOverride?` param to `t()` |
| `src/common/i18n/push-i18n.helper.ts` | **New** — `getUserLang()` and `setUserLang()` helpers |
| `src/common/i18n/index.ts` | Exported `getUserLang`, `setUserLang` |
| `src/common/interceptors/user-lang.interceptor.ts` | **New** — stores `user:lang:{userId}` in Redis on authenticated requests |
| `src/common/interceptors/index.ts` | Exported `UserLangInterceptor` |
| `src/app.module.ts` | Registered `UserLangInterceptor` as `APP_INTERCEPTOR` |
| `src/common/i18n/translations/en.json` | Added `push.*` namespace (19 notification types) |
| `src/common/i18n/translations/lo.json` | Added `push.*` namespace in Lao |
| `src/common/i18n/translations/zh.json` | Added `push.*` namespace in Chinese |
| `src/modules/charging-session/ocpp-consumer.service.ts` | All 10 hardcoded push strings replaced with `getUserLang()` + `t()` |
| `src/modules/charging-session/parking-monitor.service.ts` | Parking started/reminder pushes now translated |
| `src/modules/payment/payment-event.consumer.ts` | QR ready, wallet topped up, payment failed pushes now translated |

### `panda-ev-csms-system-admin`

| File | Change |
|---|---|
| `src/common/i18n/i18n.service.ts` | Added `langOverride?` param to `t()` |
| `src/common/i18n/translations/en.json` | Added `push.new_message.title` |
| `src/common/i18n/translations/lo.json` | Added `push.new_message.title` in Lao |
| `src/common/i18n/translations/zh.json` | Added `push.new_message.title` in Chinese |
| `src/modules/notification/notification.service.ts` | `handleNewMessage()` uses `t('push.new_message.title')` |

---

## Push Translation Keys Added (Mobile API)

```
push.session_completed.title / .body          — Charging complete with kWh + amount
push.parking_warning.title / .body            — Fully charged, please unplug
push.remote_start_failed_timeout.title / .body — Charger not responding
push.remote_start_failed_rejected.title / .body — Charger rejected start
push.remote_stop_failed.title
push.remote_stop_failed.body_offline           — Charger offline, unplug manually
push.remote_stop_failed.body_rejected          — Charger rejected stop command
push.remote_stop_failed.body_timeout           — Charger did not respond
push.charger_offline.title / .body
push.charger_rebooted.title / .body
push.charger_fault.title / .body
push.balance_low_warning.title / .body         — Wallet nearly empty, stop in 1 min
push.balance_depleted.title / .body            — Wallet empty, charging auto-stopped
push.parking_fee_charged.title / .body / .body_negative
push.parking_started.title / .body             — Parking fee per minute started
push.parking_reminder.title / .body            — Accrued fee reminder every 5 min
push.payment_qr_ready.title / .body
push.wallet_topped_up.title / .body
push.payment_qr_expired.title / .body
push.payment_failed.title / .body
```

---

## Services NOT Changed

| Service | Reason |
|---|---|
| `panda-ev-ocpp` | Does not publish FCM push — publishes OCPP events; Mobile API handles FCM from those |
| `panda-ev-gateway-services` | Does not publish FCM push — publishes payment events; Mobile API handles FCM from those |
| `panda-ev-notification` | Delivery layer only — receives pre-translated `title`/`body` from publishers |

---

## How It Works End-to-End

1. User opens the mobile app with `Accept-Language: lo` header.
2. `I18nMiddleware` sets `lang = 'lo'` in `AsyncLocalStorage`.
3. `UserLangInterceptor` (after JWT auth) writes `user:lang:{userId} = lo` to Redis (TTL 30 days).
4. Later, OCPP billing event fires in the background for that user.
5. `OcppConsumerService` calls `getUserLang(userId, redis)` → returns `'lo'`.
6. `t('push.session_completed.body', { kwh: '12.50', amount: '12,500' }, 'lo')` → `"ທ່ານສາກ 12.50 kWh ລາຄາ 12,500 ກີບ."`
7. Notification Service sends this translated string to FCM.

If the user has never made an authenticated request (no Redis key), `getUserLang()` returns `DEFAULT_LANGUAGE` (`'en'`).
