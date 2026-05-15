# OCPP Physical Charger Integration Fixes

**Date:** 2026-05-06 / 2026-05-07  
**Chargers:** PANDA-DONGNASOK-01, PANDA-DONGNASOK-02  
**Hardware:** Steve-SGC Dual-120kW, firmware V3.2  
**Service:** `panda-ev-ocpp` (namespace: `panda-ev-prod`)

---

## Issues Found & Fixed

### Issue 1 — Timezone offset (8 hours) on charger machine

**Finding:** Charger was sending timestamps as `17:17:19.000Z` when actual UTC was `09:17:19`. Exactly 8 hours ahead.

**Root cause:** Charger OS was configured with UTC+8 (China Standard Time) instead of UTC+7 (Laos/Bangkok). The charger was stamping its local time with a `Z` suffix, incorrectly treating local time as UTC.

**Fix:** Physical fix on the charger machine — set timezone to `Asia/Vientiane`:
```bash
timedatectl set-timezone Asia/Vientiane
```
**Status: Fixed by ops team on 2026-05-06.**

---

### Issue 2 — Constant connect/disconnect every ~30 seconds

**Finding:** Both chargers were cycling: Connect → BootNotification → StatusNotification × 2 → Disconnect — repeating every 20–30 seconds.

**Root cause (initial hypothesis):** `HEARTBEAT_INTERVAL = 30` in our OCPP service told the charger to send Heartbeat every 30 seconds. Steve-SGC chargers do **not** use OCPP Heartbeat — they use StatusNotification instead. The charger's firmware was reconnecting due to unmet heartbeat expectation.

**Fix applied — `panda-ev-ocpp/src/modules/ocpp/ocpp.service.ts`:**
```diff
- private readonly HEARTBEAT_INTERVAL = 30;
+ private readonly HEARTBEAT_INTERVAL = 3600;
```

**Result:** Did not fully resolve the disconnect cycle. Root cause was deeper (see Issue 3).

---

### Issue 3 — Steve-SGC uses push-model connections (not persistent)

**Finding after further analysis:** The charger's design is intentional short-lived connections:
1. Charger connects
2. Sends BootNotification (first connect only)
3. Sends StatusNotification for each connector
4. **Disconnects itself** — this is by design
5. Reconnects ~20 seconds later and repeats

This is a "push model" — the charger pushes status updates via short-lived connections rather than maintaining a persistent WebSocket. Confirmed by Chinese team (Steve-SGC).

**Our server was incorrectly reacting to WebSocket connect/disconnect events** by flipping charger status ONLINE → OFFLINE → ONLINE repeatedly.

---

## Code Changes Made

### 1. Remove WS ping/pong keepalive (`ocpp.gateway.ts`)

Our server was pinging every 60s and terminating connections that didn't respond within 90s. Chinese team said no need — the machine manages its own connection lifecycle.

**Removed from class declarations:**
```ts
// REMOVED:
private readonly pingIntervals = new Map<string, ReturnType<typeof setInterval>>();
private readonly lastPong = new Map<string, number>();
```

**Removed from `handleConnection`:**
```ts
// REMOVED:
this.lastPong.set(identity, Date.now());
client.on('pong', () => { this.lastPong.set(identity, Date.now()); });
const pingInterval = setInterval(() => {
  if (Date.now() - last > 90_000) { client.terminate(); }
  client.ping();
}, 60_000);
this.pingIntervals.set(identity, pingInterval);
```

**Removed from `handleDisconnect`:**
```ts
// REMOVED:
const pingInterval = this.pingIntervals.get(identity);
if (pingInterval) { clearInterval(pingInterval); this.pingIntervals.delete(identity); }
this.lastPong.delete(identity);
```

---

### 2. Stop marking charger ONLINE on WebSocket connect (`ocpp.gateway.ts`)

**Removed from `handleConnection`:**
```ts
// REMOVED:
this.ocppService.updateChargerOnline(identity).catch(...);
```

Status ONLINE is now only set when `BootNotification` is received and processed — not on raw WebSocket connect.

---

### 3. Stop marking charger OFFLINE on WebSocket disconnect (`ocpp.gateway.ts`)

**Removed from `handleDisconnect`:**
```ts
// REMOVED:
void this.ocppService.updateChargerOffline(identity);
```

This also stopped the cascade of marking all connectors `UNAVAILABLE` every time the charger did its normal push-then-disconnect cycle.

---

### 4. Remove `[OUT]` CALLRESULT log noise (`ocpp.gateway.ts`)

Every CALLRESULT we sent was logged, creating log noise for every StatusNotification response.

**Removed from `sendCallResult`:**
```ts
// REMOVED:
const identity = client._ocppIdentity ?? 'unknown';
this.logger.log(`[OUT] ${identity} ← CALLRESULT ${JSON.stringify(payload)}`);
```

Logs now only show `[IN]` messages (what the machine sends us).

---

## Final Behavior After All Fixes

| Event | Before | After |
|---|---|---|
| WebSocket connect | Mark charger ONLINE in DB | Log only |
| WebSocket disconnect | Mark charger OFFLINE + connectors UNAVAILABLE | Log only |
| BootNotification received | Mark ONLINE + update DB | Mark ONLINE + update DB ✓ |
| StatusNotification received | Update connector status | Update connector status ✓ |
| WS ping/pong | Ping every 60s, kill if no pong in 90s | Removed |
| `[OUT]` CALLRESULT | Logged every response | Silent |

**Charger status is now driven exclusively by OCPP messages, not WebSocket connection events.**

---

## Key Insight — Chinese Team (Steve-SGC) Design

> "We don't need heartbeat check. Just check once on machine start (BootNotification), then the machine will send StatusNotification to your OCPP server."

Steve-SGC chargers use **StatusNotification as the source of truth** for connector status. The WebSocket connection is intentionally short-lived. Our OCPP server must be a passive receiver — accept whatever the machine sends, update state from OCPP messages only, do not try to keep the connection alive or react to disconnects.

---

## Files Changed

| File | Change |
|---|---|
| `panda-ev-ocpp/src/modules/ocpp/ocpp.service.ts` | `HEARTBEAT_INTERVAL`: `30` → `3600` |
| `panda-ev-ocpp/src/modules/ocpp/ocpp.gateway.ts` | Remove ping/pong, remove connect/disconnect status marking, remove `[OUT]` log |
