# Grand Opening Promotion — Pricing Seed

**Date:** 2026-05-14  
**Service:** `panda-ev-csms-system-admin`  
**File changed:** `prisma/seed/seed-stations.ts`

---

## What Was Done

Added a **Grand Opening promotional pricing tier** seeded alongside the existing standard tiers. The promo runs for ~1 month (2026-05-14 → 2026-06-14) and is linked to all 5 stations with higher priority so it takes precedence automatically. When the promo expires, the standard tier resumes with no manual cleanup needed.

---

## New Pricing Tiers

| Field | Grand Opening (GBT) | Grand Opening (CCS2) |
|---|---|---|
| UUID | `0c66106a-cf4b-4c8c-a9a6-29bb24dcb636` | `89227531-93ab-4804-b62a-2af2ac45a810` |
| Name | `Panda EV Grand Opening — GB/T` | `Panda EV Grand Opening — CCS2` |
| `ratePerKwh` | 2,900 LAK | 2,900 LAK |
| `enableUnplugFee` | `true` | `true` |
| `unplugFeeAmount` | **9,500 LAK** (19,000 × 50%) | **9,500 LAK** (19,000 × 50%) |
| `enableParkingFee` | `true` | `true` |
| `parkingFeePerMinute` | 300 LAK | 300 LAK |
| `parkingFreeMinutes` | 10 min | 10 min |
| `validFrom` | 2026-05-14T00:00:00+07:00 | 2026-05-14T00:00:00+07:00 |
| `validTo` | 2026-06-14T23:59:59+07:00 | 2026-06-14T23:59:59+07:00 |

---

## Standard Tier (for reference)

| Field | GBT Standard | CCS2 Standard |
|---|---|---|
| UUID | `04321842-92da-4abf-9af6-2f8d97685a0a` | `912895fd-7169-43cf-bdc1-44567376ed7e` |
| `ratePerKwh` | 2,900 LAK | 2,900 LAK |
| `enableUnplugFee` | `false` | `false` |
| `enableParkingFee` | `true` | `true` |
| `parkingFeePerMinute` | 500 LAK | 500 LAK |
| `parkingFreeMinutes` | 10 min | 10 min |
| `validFrom` | 2026-01-01 (no expiry) | 2026-01-01 (no expiry) |

---

## StationPricing Links

Both tiers are linked to all 5 stations via `station_pricings`:

| Link | Standard | Grand Opening |
|---|---|---|
| `effectiveAt` | `2026-01-01T00:00:00+07:00` | `2026-05-14T00:00:00+07:00` |
| `priority` | 10 | **20** (wins during promo period) |
| `expiresAt` | `null` | `2026-06-14T23:59:59+07:00` |
| `isActive` | `true` | `true` |

Stations covered:
- Panda EV — Mekong Riverside (GBT → CCS2 m01 + GBT links; Grand Opening same)
- Panda EV — Dongnasok
- Panda EV — Phonsay
- Panda EV — BuengThatluang
- Panda EV — Hongkaikeo

---

## New Constants Added

```typescript
// In TIER_IDS:
GBT_GRAND_OPENING: '0c66106a-cf4b-4c8c-a9a6-29bb24dcb636',
CCS2_GRAND_OPENING: '89227531-93ab-4804-b62a-2af2ac45a810',

// Date boundaries:
const GRAND_OPENING_VALID_FROM = new Date('2026-05-14T00:00:00+07:00');
const GRAND_OPENING_VALID_TO   = new Date('2026-06-14T23:59:59+07:00');
const GRAND_OPENING_EFFECTIVE_AT = new Date('2026-05-14T00:00:00+07:00');

// Rates:
const GRAND_OPENING_PRICING = {
  ratePerKwh: 2900,
  enableUnplugFee: true,
  unplugFeeAmount: 9500,        // 19,000 × 50%
  enableParkingFee: true,
  parkingFeePerMinute: 300,
  parkingFreeMinutes: 10,
} as const;
```

---

## How to Apply

```bash
cd panda-ev-csms-system-admin
npx ts-node prisma/seed/seed-stations.ts
```

Seed is idempotent — safe to re-run. Upserts by stable UUID.

---

## Priority Logic (how billing resolves)

The Mobile API session-start flow queries the highest-priority **active** `StationPricing` for the charger+connector via LATERAL JOIN. During the promo window (priority 20) the Grand Opening tier wins. After `2026-06-14`, the standard tier (priority 10, no `expiresAt`) is the only active row and resumes automatically.
