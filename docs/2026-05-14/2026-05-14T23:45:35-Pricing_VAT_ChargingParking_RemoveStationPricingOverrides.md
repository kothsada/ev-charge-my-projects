# Pricing: VAT + Charging Parking Fee + Remove StationPricing Overrides

## Summary

Two sets of changes applied in this session:

1. **Pricing Tier Extensions** — Added VAT, per-minute charging parking fee, and force-stop support to `pricing_tiers`.
2. **StationPricing Cleanup** — Removed 3 parking override columns from `station_pricings` (all were always null; pricing is now exclusively in `pricing_tiers`).

---

## 1 — Pricing Tier Extensions

### New columns on `panda_ev_system.pricing_tiers`

| Column | Type | Default | Purpose |
|---|---|---|---|
| `vat_pct` | SMALLINT | NULL | VAT percentage (10 = 10%) |
| `enable_charging_parking_fee` | BOOLEAN | FALSE | 150 LAK/min while actively charging (whole session) |
| `charging_parking_fee_per_minute` | INTEGER | NULL | Rate in LAK |
| `force_stop_at_end_time` | BOOLEAN | FALSE | Auto-stop all active sessions at `end_time` |

### Billing formula (Mobile `ocpp-consumer.service.ts`)

```
energyCost            = round(energyKwh × pricePerKwh)
chargingParkingFee    = durationMinutes × chargingParkingFeePerMinute  (if enabled)
unplugFee             = unplugFeeAmount                                 (if enabled)
subtotal              = energyCost + chargingParkingFee + unplugFee
vatAmount             = round(subtotal × vatPct / 100)
totalCost             = subtotal + vatAmount
actualDebit           = min(totalCost, walletBalance)
```

One atomic wallet transaction replaces the previous two-step energy + unplug debit.
Invoice `tax_rate` and `tax_amount` now carry real VAT (previously hardcoded 0).

### Force-stop (Golden Hour)

- At session start: if tier has `forceStopAtEndTime=true`, registers `sessionId` in Redis sorted set `force:stop:sessions` with score = Unix timestamp of `endTime` (UTC).
- `ParkingMonitorService.checkForceStopSessions()` (`@Cron(EVERY_MINUTE)`) calls `zrangebyscore` for entries ≤ now, publishes `session.stop` to `PANDA_EV_CSMS_COMMANDS` for each, then removes from sorted set.

### Migration file

```
prisma/migrations/20260514000000_pricing_tier_vat_charging_parking_force_stop/migration.sql
```

---

## 2 — Remove StationPricing Parking Override Columns

### Removed columns from `panda_ev_system.station_pricings`

| Column | Was type |
|---|---|
| `enable_parking_fee` | BOOLEAN (nullable) |
| `parking_fee_per_minute` | INTEGER (nullable) |
| `parking_free_minutes` | INTEGER (nullable) |

All rows were null in production. Parking config now lives exclusively in `pricing_tiers`.
Mobile billing SQL simplified from `COALESCE(sp.field, pt2.field)` → `pt2.field` in all 4 queries.

### Migration file

```
prisma/migrations/20260514120000_drop_station_pricing_parking_overrides/migration.sql
```

---

## Apply Both Migrations (in order)

Run from the **admin service directory** (`panda-ev-csms-system-admin/`):

```bash
# Step 1 — Apply migration 1: add new pricing_tier columns
psql "$DATABASE_URL" < prisma/migrations/20260514000000_pricing_tier_vat_charging_parking_force_stop/migration.sql
npx prisma migrate resolve --applied 20260514000000_pricing_tier_vat_charging_parking_force_stop

# Step 2 — Apply migration 2: drop station_pricings override columns
psql "$DATABASE_URL" < prisma/migrations/20260514120000_drop_station_pricing_parking_overrides/migration.sql
npx prisma migrate resolve --applied 20260514120000_drop_station_pricing_parking_overrides

# Step 3 — Regenerate Prisma client
npx prisma generate

# Step 4 — Run standard seed (re-seeds stations with new fields)
npx ts-node prisma/seed/seed-stations.ts

# Step 5 — Run Grand Opening & Golden Hour seed
npx ts-node prisma/seed/seed-grand-opening.ts
```

---

## Files Changed

### Admin service (`panda-ev-csms-system-admin/`)

| File | Change |
|---|---|
| `prisma/schema.prisma` | Added 4 fields to `PricingTier`; removed 3 fields from `StationPricing` |
| `prisma/migrations/20260514000000_.../migration.sql` | ADD COLUMN for vat_pct, enable_charging_parking_fee, charging_parking_fee_per_minute, force_stop_at_end_time |
| `prisma/migrations/20260514120000_.../migration.sql` | DROP COLUMN for enable_parking_fee, parking_fee_per_minute, parking_free_minutes |
| `prisma/seed/seed-stations.ts` | Updated standard tiers with new fields; removed Grand Opening + Golden Hour (moved to seed-grand-opening.ts) |
| `prisma/seed/seed-grand-opening.ts` | **New** — standalone seed for Grand Opening (all stations, priority 20) and Golden Hour (Phonsay only, priority 30, GBT + CCS2 tiers) |
| `prisma/seed/seed.ts` | No change (seed-grand-opening.ts is run separately) |
| `src/modules/pricing/dto/update-station-pricing.dto.ts` | Removed 3 parking override fields |
| `tsconfig.json` | Added `seed-grand-opening.ts` to include array |

### Mobile service (`panda-ev-client-mobile/`)

| File | Change |
|---|---|
| `src/configs/redis/redis.service.ts` | Added `zadd`, `zrangebyscore`, `zrem` for force-stop sorted set |
| `src/modules/charging-session/charging-session.service.ts` | New pricing fields in SQL queries; `computeForceStopAt()` helper; billing snapshot extended; all 4 COALESCE(sp.*, pt2.*) replaced with `pt2.*` |
| `src/modules/charging-session/ocpp-consumer.service.ts` | New billing formula with VAT + charging parking; atomic single wallet transaction; force-stop fallback logic |
| `src/modules/charging-session/parking-monitor.service.ts` | New `checkForceStopSessions()` cron + `processForceStop()` for Golden Hour end |

---

## Seed UUIDs (stable, idempotent)

| Tier | UUID |
|---|---|
| GBT Standard | `04321842-92da-4abf-9af6-2f8d97685a0a` |
| CCS2 Standard | `912895fd-7169-43cf-bdc1-44567376ed7e` |
| GBT Grand Opening | `0c66106a-cf4b-4c8c-a9a6-29bb24dcb636` |
| CCS2 Grand Opening | `89227531-93ab-4804-b62a-2af2ac45a810` |
| GBT Golden Hour — Phonsay | `b7e3a1f2-4c8d-4e9b-a5f6-3d2c1b0a9e87` |
| CCS2 Golden Hour — Phonsay | `c8f4b2a3-5d9e-4f0c-b6a7-4e3d2c1b0a98` |
