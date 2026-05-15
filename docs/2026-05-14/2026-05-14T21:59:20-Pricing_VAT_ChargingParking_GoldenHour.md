# Pricing Update: VAT + Charging Parking Fee + Golden Hour

## Summary

Implemented new pricing requirements:

1. **Standard Pricing** — updated all tiers with:
   - Charging parking fee: **150 LAK/min** while actively charging (entire session duration)
   - Overstay: 10 min free, then 1,000 LAK/min (unchanged)
   - Unlock fee: 9,000 LAK (unchanged)
   - Energy: 2,900 LAK/kWh (unchanged)
   - **VAT 10%** applied to session total (energy + parking + unplug)

2. **Golden Hour** — Phonsay Station only, 2026-05-17, 09:09–11:09:
   - Energy: **999 LAK/kWh**
   - Unlock fee: 9,000 LAK
   - Parking while charging: 150 LAK/min
   - No overstay (sessions force-stopped at 11:09)
   - VAT 10%
   - Priority 30 (beats Grand Opening 20, beats Standard 10)

## Schema Changes

### `panda_ev_system.pricing_tiers` (admin service migration `20260514000000_...`)
| Column | Type | Purpose |
|---|---|---|
| `vat_pct` | SMALLINT | VAT percentage (10 = 10%) |
| `enable_charging_parking_fee` | BOOLEAN | 150 LAK/min while charging |
| `charging_parking_fee_per_minute` | INTEGER | Rate in LAK |
| `force_stop_at_end_time` | BOOLEAN | Auto-stop all sessions at `end_time` |

## Billing Recalculation (Mobile `ocpp-consumer.service.ts`)

New formula (all in LAK):
```
energyCost            = round(energyKwh × pricePerKwh)
chargingParkingFee    = durationMinutes × chargingParkingFeePerMinute
unplugFee             = unplugFeeAmount (if enabled)
subtotal              = energyCost + chargingParkingFee + unplugFee
vatAmount             = round(subtotal × vatPct / 100)
totalCost             = subtotal + vatAmount
actualDebit           = min(totalCost, walletBalance)
```

One atomic wallet transaction replaces the previous two-step energy+unplug debit.

Invoice `tax_rate` and `tax_amount` now reflect real VAT (previously hardcoded 0).

## Force-Stop Implementation

- When session starts with `forceStopAtEndTime=true`, registers in Redis sorted set `force:stop:sessions` with score = Unix timestamp of `endTime` in UTC
- `ParkingMonitorService.checkForceStopSessions()` (new `@Cron(EVERY_MINUTE)`) processes the sorted set, sends `session.stop` to OCPP CSMS for each expired session
- Clean-up: removes the session from sorted set regardless of result

## Seed Changes

- `TIER_IDS.GOLDEN_HOUR_PHONSAY` = `b7e3a1f2-4c8d-4e9b-a5f6-3d2c1b0a9e87`
- Standard tiers updated with new fields (re-runnable upsert)
- Golden Hour linked to Phonsay station only (priority 30, expires 2026-05-17 23:59:59+07:00)

## Files Changed

| File | Change |
|---|---|
| `panda-ev-csms-system-admin/prisma/schema.prisma` | 4 new fields on PricingTier |
| `panda-ev-csms-system-admin/prisma/migrations/20260514000000_.../migration.sql` | New migration |
| `panda-ev-csms-system-admin/prisma/seed/seed-stations.ts` | New pricing constants + Golden Hour tier |
| `panda-ev-client-mobile/src/configs/redis/redis.service.ts` | Added `zadd`, `zrangebyscore`, `zrem` |
| `panda-ev-client-mobile/src/modules/charging-session/charging-session.service.ts` | New SQL columns, billing snapshot, force-stop registration |
| `panda-ev-client-mobile/src/modules/charging-session/ocpp-consumer.service.ts` | New billing formula with VAT + charging parking |
| `panda-ev-client-mobile/src/modules/charging-session/parking-monitor.service.ts` | Force-stop cron job |
