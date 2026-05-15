# App Version Check Endpoint

**Date:** 2026-05-14  
**Services:** `panda-ev-csms-system-admin` (seed), `panda-ev-client-mobile` (endpoint)

---

## Overview

Forces mobile clients to update when a new version is released. Admin controls the version settings via the existing System Settings CRUD. Mobile exposes a public endpoint that checks the client's semver against the admin-managed config.

---

## Admin — New Seed Settings

File: `prisma/seed/seed.ts` → new `seedAppSettings()` function (step 7)

| Key | Default Value | Purpose |
|---|---|---|
| `app.min_version` | `1.0.0` | Below this → `forceUpdate: true` (user cannot proceed) |
| `app.latest_version` | `1.0.0` | Below this → `updateRequired: true` (soft prompt) |
| `app.store_url_ios` | `https://apps.apple.com/app/pandaev` | Shown to iOS users |
| `app.store_url_android` | `https://play.google.com/store/apps/details?id=com.pandaev` | Shown to Android users |

All 4 have `isPublic: true`, `group: 'app'`. Update via Admin UI: `PUT /api/admin/v1/system-settings/:id`.

Upsert is idempotent — **does not overwrite the value on re-run** (only label/description/group/isPublic are updated). Safe to re-seed.

---

## Mobile — New Endpoint

**`GET /api/mobile/v1/app-config/version-check`**  
No authentication required (`@Public()`).

### Query Parameters

| Param | Type | Example | Notes |
|---|---|---|---|
| `version` | string | `1.2.3` | Client's current semver; validated with regex `/^\d+\.\d+\.\d+$/` |
| `platform` | `ios` \| `android` | `ios` | Selects which store URL to return |

### Response

```json
{
  "success": true,
  "statusCode": 200,
  "data": {
    "currentVersion": "1.0.0",
    "latestVersion": "1.1.0",
    "minVersion": "1.0.0",
    "updateRequired": true,
    "forceUpdate": false,
    "storeUrl": "https://apps.apple.com/app/pandaev",
    "message": "A new version is available. Please update your app."
  },
  "message": "Success",
  "timestamp": "2026-05-14T10:48:00+07:00"
}
```

### Logic

| Condition | `forceUpdate` | `updateRequired` | Expected client behavior |
|---|---|---|---|
| `version >= latestVersion` | `false` | `false` | No action |
| `version < latestVersion` AND `version >= minVersion` | `false` | `true` | Show soft update banner |
| `version < minVersion` | `true` | `true` | Block UI, force user to store |

### Message (i18n, respects `Accept-Language: en/lo/zh`)

| Scenario | EN |
|---|---|
| Up to date | "Your app is up to date." |
| Soft update | "A new version is available. Please update your app." |
| Force update | "Your app version is no longer supported. Please update to continue." |

---

## Files Changed

### Admin
- `prisma/seed/seed.ts` — added `seedAppSettings()`, called as step 7 in `main()`

### Mobile
| File | Change |
|---|---|
| `src/modules/app-config/dto/version-check.dto.ts` | New — DTO (`VersionCheckQueryDto`) + `Platform` enum + `VersionCheckResult` interface |
| `src/modules/app-config/app-config.service.ts` | Added `checkVersion()` method; injected `SystemDbService` |
| `src/modules/app-config/app-config.controller.ts` | New — `GET /app-config/version-check` |
| `src/modules/app-config/app-config.module.ts` | Added `AppConfigController` to `controllers` array |
| `src/common/i18n/translations/en.json` | Added `app_config` namespace |
| `src/common/i18n/translations/lo.json` | Added `app_config` namespace |
| `src/common/i18n/translations/zh.json` | Added `app_config` namespace |

---

## How It Works Internally

1. Mobile reads `panda_ev_system.system_settings` via `SystemDbService` (cross-DB raw pg, same pattern as station/pricing reads)
2. Result is Redis-cached at `app_config:version_info` with **2-minute TTL** — short enough that admin changes propagate quickly
3. Semver comparison uses pure numeric split (no external library): `'1.2.3'.split('.').map(Number)`
4. `SystemDbService` gracefully returns `null` if Admin DB is unreachable — service falls back to safe defaults (`1.0.0` / no force update)

---

## How to Apply

```bash
# Admin — seed the version settings
cd panda-ev-csms-system-admin
npx ts-node prisma/seed/seed.ts   # or run standalone step if needed

# Test endpoint (mobile running on :4001)
curl "http://localhost:4001/api/mobile/v1/app-config/version-check?version=1.0.0&platform=ios"
```

---

## Updating Versions (after this seed)

Use the Admin API (no re-seeding needed):

```bash
# 1. Find the setting ID
GET /api/admin/v1/system-settings/key/app.latest_version

# 2. Update it
PUT /api/admin/v1/system-settings/{id}
{ "value": "1.1.0" }
```

Redis cache expires within 2 minutes — clients see the new version automatically.
