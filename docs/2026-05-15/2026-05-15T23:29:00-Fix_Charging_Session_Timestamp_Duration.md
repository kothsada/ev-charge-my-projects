# Fix: Charging Session Timestamp & Duration Incorrect (7-Hour Offset)

**Date:** 2026-05-15  
**Services affected:** `panda-ev-ocpp`, `panda-ev-client-mobile`

---

## Problem

After a charging session completed, the bill showed:

- `startedAt` and `endedAt` were **7 hours ahead** of the real Vientiane local time  
  (e.g., session started at `23:05:13+07:00` but displayed as `06:05:13+07:00` next day)
- `durationMinutes` was **≈ 420 minutes** (~7 hours) for a session that only lasted 1 minute

Example billing response that exposed the bug:

```json
{
  "startedAt": "2026-05-16T06:05:13+07:00",
  "endedAt":   "2026-05-16T06:09:48+07:00",
  "durationMinutes": 5
}
```

Expected:

```json
{
  "startedAt": "2026-05-15T23:05:13+07:00",
  "endedAt":   "2026-05-15T23:09:48+07:00",
  "durationMinutes": 4
}
```

---

## Root Cause

### The charger sends Bangkok local time without a timezone offset

The OCPP 1.6 spec (§4.1) requires timestamps in UTC with a `Z` suffix. The physical charger at **PANDA-PHONSAY-01** is non-compliant: it sends Bangkok/Vientiane local time strings with **no timezone indicator**, e.g.:

```
"2026-05-15T23:09:48"   ← charger sends this (local 23:09 = UTC 16:09)
```

### OCPP service parsed it as UTC

In `ocpp.service.ts`, both `handleStartTransaction` and `handleStopTransaction` used:

```ts
new Date(payload.timestamp)
```

`new Date("2026-05-15T23:09:48")` on a UTC server → **23:09:48 UTC** (7 hours too late).

### Timestamp propagated through the pipeline

The OCPP service then called `toVientianIso()` on that wrong UTC epoch and published it to RabbitMQ as `stopTime`. The mobile service received the message and stored `endedAt` from that wrong value. Result: `endedAt` stored as **23:09 UTC** (actual: **16:09 UTC**).

### Duration mismatch (secondary symptom)

`session.startedAt` was set by the mobile server with `new Date()` = **16:05 UTC** (correct). `stopTime` arrived as **23:09 UTC** (wrong, 7 hours ahead). Duration = `(23:09 − 16:05) / 60000 ≈ 420 minutes ≈ 7 hours`.

---

## Fix

### 1. OCPP service — `parseChargerTimestamp()` in `date.helper.ts`

Added a new helper that normalises charger timestamps before use. If no timezone indicator is present, the value is treated as Vientiane local time (`+07:00`):

**File:** `panda-ev-ocpp/src/common/helpers/date.helper.ts`

```ts
/**
 * Parses a timestamp string from an OCPP charger message into a UTC Date.
 *
 * OCPP 1.6 §4.1 requires UTC timestamps (`…Z` suffix).  Chargers in the
 * Vientiane/Bangkok region (UTC+7) often send local time without a timezone
 * indicator (e.g. `"2026-05-15T23:09:48"`).  When no offset is present we
 * treat the value as Vientiane local time (+07:00) so the resulting epoch is
 * correct.  If `ts` is absent, the current server time is used.
 */
export function parseChargerTimestamp(ts: string | undefined | null): Date {
  if (!ts) return new Date();
  const hasOffset = /Z$|[+-]\d{2}:?\d{2}$/.test(ts.trim());
  return hasOffset ? new Date(ts) : new Date(`${ts}+07:00`);
}
```

Examples:

| Charger sends | Before fix | After fix |
|---|---|---|
| `"2026-05-15T23:09:48"` (no TZ) | `23:09:48 UTC` ✗ | `16:09:48 UTC` ✓ |
| `"2026-05-15T16:09:48Z"` (UTC) | `16:09:48 UTC` ✓ | `16:09:48 UTC` ✓ |
| `"2026-05-15T23:09:48+07:00"` | `16:09:48 UTC` ✓ | `16:09:48 UTC` ✓ |

---

### 2. OCPP service — use `parseChargerTimestamp` in `ocpp.service.ts`

**File:** `panda-ev-ocpp/src/modules/ocpp/ocpp.service.ts`

**`handleStartTransaction`** — before:
```ts
startTime: payload.timestamp ? new Date(payload.timestamp) : new Date(),
```
After:
```ts
startTime: parseChargerTimestamp(payload.timestamp),
```

**`handleStopTransaction`** — before:
```ts
stopTime: new Date(payload.timestamp),   // DB write
...
stopTime: toVientianIso(new Date(payload.timestamp)),  // RabbitMQ publish
```
After:
```ts
const stopTime = parseChargerTimestamp(payload.timestamp);
...
stopTime,                          // DB write  (correct UTC Date)
...
stopTime: toVientianIso(stopTime), // RabbitMQ publish (correct Vientiane string)
```

---

### 3. Mobile service — sync `session.startedAt` from OCPP transaction startTime

**File:** `panda-ev-client-mobile/src/modules/charging-session/ocpp-consumer.service.ts`

`handleSessionStarted` previously set `session.startedAt` only once at mobile session creation (`new Date()`). The OCPP service publishes the charger's `startTime` in the `transaction.started` RabbitMQ event but it was being ignored. By updating `startedAt` from that OCPP timestamp, both `startedAt` and `stopTime` share the same clock reference (the charger's clock), ensuring an accurate relative duration even if the charger clock is misconfigured.

Changes in `handleSessionStarted`:

```ts
// Extract OCPP transaction start time (same clock reference as stopTime)
const startTime = msg.startTime as string | undefined;
const ocppStartedAt = startTime ? new Date(startTime) : undefined;

// Normal path — link OCPP transaction ID + sync startedAt
await this.prisma.chargingSession.update({
  where: { id: sessionId },
  data: {
    ocppTransactionId,
    ...(ocppStartedAt ? { startedAt: ocppStartedAt } : {}),
  },
});

// Orphan path — same
await this.prisma.chargingSession.update({
  where: { id: orphan.id },
  data: {
    ocppTransactionId,
    ...(ocppStartedAt ? { startedAt: ocppStartedAt } : {}),
  },
});
```

---

## Data Flow After Fix

**Charger sends** (Bangkok local, no TZ): `"2026-05-15T23:05:13"` start / `"2026-05-15T23:09:48"` stop

```
OCPP service:
  parseChargerTimestamp("2026-05-15T23:05:13") → 16:05:13 UTC ✓
  parseChargerTimestamp("2026-05-15T23:09:48") → 16:09:48 UTC ✓
  toVientianIso(16:05:13 UTC)  → "2026-05-15T23:05:13+07:00"  → RabbitMQ startTime ✓
  toVientianIso(16:09:48 UTC)  → "2026-05-15T23:09:48+07:00"  → RabbitMQ stopTime ✓

Mobile service:
  session.startedAt  ← new Date("2026-05-15T23:05:13+07:00") = 16:05:13 UTC ✓
  session.endedAt    ← new Date("2026-05-15T23:09:48+07:00") = 16:09:48 UTC ✓
  durationMinutes    = (16:09:48 − 16:05:13) / 60000 = 4.58 → 5 min ✓

TimezoneInterceptor:
  startedAt  → "2026-05-15T23:05:13+07:00" ✓
  endedAt    → "2026-05-15T23:09:48+07:00" ✓
```

**VCP (sends correct UTC `…Z`):** behaviour unchanged — `parseChargerTimestamp` detects the `Z` and passes through directly.

---

## Files Changed

| File | Change |
|---|---|
| `panda-ev-ocpp/src/common/helpers/date.helper.ts` | Added `parseChargerTimestamp()` export |
| `panda-ev-ocpp/src/modules/ocpp/ocpp.service.ts` | Imported and used `parseChargerTimestamp` in `handleStartTransaction` + `handleStopTransaction` |
| `panda-ev-client-mobile/src/modules/charging-session/ocpp-consumer.service.ts` | `handleSessionStarted` now updates `session.startedAt` from OCPP `startTime` |

---

## Deployment

Both services must be redeployed:

```bash
# panda-ev-ocpp
cd panda-ev-ocpp && npm run build

# panda-ev-client-mobile
cd panda-ev-client-mobile && npm run build
```

Existing COMPLETED sessions with wrong timestamps in the DB are not retroactively corrected. Only new sessions after deployment will have correct times.

---

## Notes

- The VCP simulator (`ocpp-virtual-charge-point`) always sends proper UTC with `Z` and is unaffected.
- If a future charger is added that sends UTC correctly, `parseChargerTimestamp` handles it transparently (regex detects the `Z` or `±HH:MM` offset).
- Long-term: configure the physical charger to send UTC timestamps per OCPP 1.6 spec if the firmware supports it.
