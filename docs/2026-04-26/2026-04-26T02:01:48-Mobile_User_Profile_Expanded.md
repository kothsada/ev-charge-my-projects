# Mobile User Profile — Expanded Sync & Rich Detail View

## What changed

### Admin (`panda-ev-csms-system-admin`)

**Schema — `prisma/schema.prisma`**
- `MobileUserProfile` gained 5 new synced fields: `avatarUrl`, `dateOfBirth`, `gender`, `acceptedTermsAt`, `lastLoginAt`
- New `MobileVehicle` model synced from `vehicle.created/updated/deleted` events; FK to `MobileUserProfile.mobileUserId` with CASCADE delete

**Migration** — `20260426120000_mobile_user_profile_expanded`
- `ALTER TABLE ... ADD COLUMN` for the 5 new profile fields
- `CREATE TABLE panda_ev_system.mobile_vehicles` with unique `vehicle_id`, index on `mobile_user_id`

**New service** — `src/configs/prisma/core-db.service.ts`
- Raw pg Pool to `panda_ev_core` schema (reuses `NOTI_DATABASE_URL` since both schemas share the same PostgreSQL instance)
- Reads: wallets, wallet_transactions, charging_sessions
- Same `withClient<T>()` soft-fail pattern as `NotiDbService`
- Registered in `PrismaModule` as global provider

**`mobile-user.service.ts`** — major update
- `handleUserUpsert`: syncs all 5 new fields; partial-update-safe (only overwrites fields present in payload)
- `handleUserDeleted`: nullifies the 5 new fields on deletion
- `handleVehicleUpsert` (NEW): upserts `MobileVehicle` on `vehicle.created/updated`
- `handleVehicleDeleted` (NEW): soft-deletes `MobileVehicle` on `vehicle.deleted`
- `findOne` / `findByMobileUserId`: now include `vehicles` (admin DB) + `enrichProfile()` cross-DB call
- `enrichProfile()` fires 6 concurrent cross-DB reads:
  - `devices` — `panda_ev_noti.user_fcm_devices` (last 50, by `last_used_at`)
  - `wallet` — `panda_ev_core.wallets` (balance + member_id)
  - `walletTransactions` — `panda_ev_core.wallet_transactions` (last 50)
  - `chargingSessions` — `panda_ev_core.charging_sessions` (last 50)
  - `smsLogs` — `panda_ev_noti.sms_logs` (last 50)
  - `notificationLogs` — `panda_ev_noti.notification_logs` (last 50)
  - All return `[]` / `null` gracefully when cross-DB pools are unavailable

### Mobile API (`panda-ev-client-mobile`)

**`src/modules/auth/auth.service.ts`**
- `register()`: adds `avatarUrl`, `dateOfBirth`, `gender`, `acceptedTermsAt`, `lastLoginAt` to `user.registered` payload
- `verifyOtp()`: same new fields added to `user.updated` payload
- `login()`: `lastLoginAt` (now current) + `avatarUrl`, `dateOfBirth`, `gender`, `acceptedTermsAt` added to `user.updated`

**`src/modules/profile/profile.service.ts`**
- `updateProfile()`: adds `avatarUrl`, `dateOfBirth`, `gender` (from `updated`) + `acceptedTermsAt`, `lastLoginAt` (from `user`) to `user.updated` payload

## Cross-DB read strategy

The `findAll()` list endpoint intentionally does NOT enrich (no cross-DB reads) — only detail endpoints (`findOne`, `findByMobileUserId`) do. This keeps list performance fast and avoids N+1 cross-DB calls at list time.

## No new env vars required

`CoreDbService` reuses `NOTI_DATABASE_URL` (both schemas on same PostgreSQL host). No K8s secrets changes needed.
