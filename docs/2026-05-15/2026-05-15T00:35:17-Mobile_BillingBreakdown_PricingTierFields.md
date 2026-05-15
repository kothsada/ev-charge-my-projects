# Mobile: Billing Breakdown + Pricing Tier VAT Fields

## Summary

Two sets of changes applied in this session:

1. **Billing Breakdown on Charging Sessions** — Added 5 breakdown columns to `charging_sessions` so the app can show a per-line-item receipt instead of just a total.
2. **VAT + Charging Parking Fields Surfaced in Previews** — The 3 preview endpoints (`qr-preview`, `charger-preview`, `qr-preview-short`) now return the new pricing tier fields added in the previous session (`vatPct`, `enableChargingParkingFee`, `chargingParkingFeePerMinute`, `forceStopAtEndTime`).

---

## 1 — Billing Breakdown on Charging Sessions

### New columns on `panda_ev_mobile.charging_sessions`

| Column | Type | Purpose |
|---|---|---|
| `energy_cost` | INTEGER | Energy charge in LAK (`round(energyKwh × pricePerKwh)`) |
| `charging_parking_fee` | INTEGER | Charging-while-plugged fee in LAK (`durationMin × rate`, 0 if disabled) |
| `unplug_fee` | INTEGER | One-time unplug/unlock fee in LAK (0 if disabled) |
| `vat_pct` | SMALLINT | VAT percentage applied (e.g. 10 = 10%; 0 if no VAT) |
| `vat_amount` | INTEGER | VAT amount in LAK (`round(subtotal × vatPct / 100)`) |

`amount` (existing column) still stores `actualDebit = min(totalCost, walletBalance)`.

`subtotal` is not stored — it is computed on the fly as `energyCost + chargingParkingFee + unplugFee`.

### Migration file

```
panda-ev-client-mobile/prisma/migrations/20260515000000_add_billing_breakdown_to_charging_sessions/migration.sql
```

### Response shape — `billing` sub-object

`GET /api/mobile/v1/charging-sessions` and `GET /api/mobile/v1/charging-sessions/:id` now return:

```json
{
  "id": "uuid",
  "stationName": "Central Park Hub",
  "energyKwh": 32.5,
  "durationMinutes": 90,
  "amount": 48950,
  "billing": {
    "energyCost": 32500,
    "chargingParkingFee": 12000,
    "unplugFee": 0,
    "subtotal": 44500,
    "vatPct": 10,
    "vatAmount": 4450
  }
}
```

`billing` is `null` for sessions created before this migration (backward-compatible).

---

## 2 — Pricing Tier VAT Fields in Preview Endpoints

All 3 preview endpoints now include new fields at the top level and inside `pricingTier`:

### Top-level additions

| Field | Type | Description |
|---|---|---|
| `vatPct` | number | VAT % from active pricing tier (0 = no VAT) |
| `enableChargingParkingFee` | boolean | Whether per-minute fee applies while charging |
| `chargingParkingFeePerMinute` | number | Rate in LAK (0 if disabled) |

### `pricingTier` sub-object additions

| Field | Type | Description |
|---|---|---|
| `vatPct` | number | VAT percentage |
| `enableChargingParkingFee` | boolean | Charging-while-plugged fee switch |
| `chargingParkingFeePerMinute` | number \| null | Rate in LAK |
| `forceStopAtEndTime` | boolean | Golden Hour auto-stop flag |

---

## 3 — Invoice `generate()` Fix

`POST /api/mobile/v1/invoices` now uses stored billing breakdown when available:

- **New sessions** (with breakdown columns): `subtotal = energyCost + chargingParkingFee + unplugFee`; `taxRate = vatPct / 100`; `taxAmount = vatAmount` — all read from the session record.
- **Old sessions** (pre-migration, breakdown columns are null): falls back to previous logic using `session.amount` as subtotal and `dto.taxRate` from the request.

---

## Admin Service — Pricing Tier DTO Update (same session)

`panda-ev-csms-system-admin` pricing tier DTOs updated to accept the new fields:

`CreatePricingTierDto` (and `UpdatePricingTierDto` via `PartialType`) now includes:
- `vatPct` — `@IsInt() @Min(0)`
- `enableChargingParkingFee` — `@IsBoolean()`
- `chargingParkingFeePerMinute` — `@IsInt() @Min(0)`
- `forceStopAtEndTime` — `@IsBoolean()`

`PricingTierService.create()` updated to pass these 4 fields to Prisma (booleans default to `false`). `update()` already spreads `...tierData` so no change needed there.

---

## Files Changed

### Mobile service (`panda-ev-client-mobile/`)

| File | Change |
|---|---|
| `prisma/schema.prisma` | Added 5 fields to `ChargingSession` model |
| `prisma/migrations/20260515000000_.../migration.sql` | ADD COLUMN for 5 breakdown fields |
| `src/modules/charging-session/ocpp-consumer.service.ts` | Stores breakdown columns on session completion |
| `src/modules/charging-session/charging-session.service.ts` | `formatSession` returns `billing` sub-object; all 3 preview return shapes add VAT fields |
| `src/modules/charging-session/charging-session.controller.ts` | Swagger examples updated for list, detail, and all 3 preview endpoints |
| `src/modules/invoice/invoice.service.ts` | `generate()` uses stored breakdown for subtotal/VAT; falls back for old sessions |
| `src/modules/invoice/invoice.controller.ts` | Swagger examples updated to show realistic VAT values |

### Admin service (`panda-ev-csms-system-admin/`)

| File | Change |
|---|---|
| `src/modules/pricing/dto/create-pricing-tier.dto.ts` | Added `vatPct`, `enableChargingParkingFee`, `chargingParkingFeePerMinute`, `forceStopAtEndTime` |
| `src/modules/pricing/services/pricing-tier.service.ts` | `create()` passes 4 new fields to Prisma |

---

## Apply Migration

Run from the **mobile service directory** (`panda-ev-client-mobile/`):

```bash
# Step 1 — Apply migration: add billing breakdown columns
psql "$DATABASE_URL" < prisma/migrations/20260515000000_add_billing_breakdown_to_charging_sessions/migration.sql

# Step 2 — Mark migration as applied
npx prisma migrate resolve --applied 20260515000000_add_billing_breakdown_to_charging_sessions

# Step 3 — Regenerate Prisma client (already done in dev)
npx prisma generate
```
