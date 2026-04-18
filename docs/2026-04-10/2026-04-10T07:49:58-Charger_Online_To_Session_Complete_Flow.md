# Charger Online → Charging → Session Complete — Full E2E Flow

**Date:** 2026-04-10 (updated 2026-04-10 — added `PANDA_EV_CHARGER_STATUS` queue; fixed `registerConsumer` timing bug)  
**Services involved:** OCPP (4002), Mobile API (4001), Admin (4000), Redis, RabbitMQ

---

## Phase 1 — Charger Comes Online

```
Charger ──WS connect──► OCPP (4002)
                             │
              ┌──────────────┴──────────────────┐
              │                                  │
         PANDA_EV_QUEUE                PANDA_EV_CHARGER_STATUS
    (Mobile + Notification)           (Admin-exclusive consumer)
              │                                  │
         Mobile API (4001)           OcppStatusConsumerService
         Notification (5001)           updates panda_ev_system
                                       chargers + connectors
```

1. **Charger sends `BootNotification`** → OCPP:
   - Updates `panda_ev_ocpp.chargers.status = ONLINE`, `lastHeartbeat`
   - Writes Redis `charger_status:{identity} = { status: 'ONLINE', updatedAt }`
   - Publishes `charger.booted` → `PANDA_EV_QUEUE` (Mobile + Notification consumers)
   - Publishes `charger.booted` → `PANDA_EV_CHARGER_STATUS` (Admin-exclusive)
     → `OcppStatusConsumerService` updates `panda_ev_system.chargers.status = ONLINE`, `lastHeartbeat`

2. **Charger sends `StatusNotification` (connectorId=0)** → OCPP:
   - Updates charger-level status in `panda_ev_ocpp.chargers`
   - Updates Redis `charger_status:{identity}`
   - Publishes `charger.status_changed` → `PANDA_EV_CHARGER_STATUS`
     → `OcppStatusConsumerService` updates `panda_ev_system.chargers.status` (`UNAVAILABLE` → `OFFLINE`, else `ONLINE`)

3. **Charger sends `StatusNotification` (connectorId=1, status=Available)** → OCPP:
   - Updates `panda_ev_ocpp.connector.status = AVAILABLE`
   - Writes Redis `connector_status:{identity}:1 = { status: 'Available', updatedAt }`
   - Publishes `connector.status_changed` → `PANDA_EV_QUEUE` (Mobile)
   - Publishes `connector.status_changed` → `PANDA_EV_CHARGER_STATUS` (Admin-exclusive)
     → `OcppStatusConsumerService` looks up charger by `ocppIdentity`, updates `panda_ev_system.connectors.status = AVAILABLE`

4. **Admin dashboard** (`GET /api/admin/v1/chargers/dashboard`) now shows:
   - Charger: `ONLINE` (Redis overlay `charger_status:{identity}`, fallback to DB)
   - Connector: `AVAILABLE` (Redis overlay `connector_status:{identity}:1` uppercased, fallback to DB)

---

## Phase 2 — User Starts Charging

```
Mobile App ──POST /charging-sessions/qr-start (or /start)──► Mobile API (4001)
```

### 2.1 — Mobile API pre-flight checks

1. Verifies HMAC signature on QR params (`sid|cid|nid`, `QR_SIGNING_SECRET`)
2. Base62-decodes `sid`/`cid` → station UUID, charger UUID
3. LATERAL JOIN on admin DB (`SystemDbService`) → resolves highest-priority active `PricingTier`:
   - `rate_per_kwh`, `enable_unplug_fee`, `unplug_fee_amount`
   - `enable_parking_fee`, `parking_fee_per_minute`, `parking_free_minutes`
4. Checks `charging:charger:{identity}` Redis key — **must be absent** (else 409 Conflict)
5. Per-user lock: `SET charging:user:{userId} NX EX 30` — prevents double-session from same user
6. Wallet balance check: `balance >= MIN_CHARGING_BALANCE` (default 10,000 LAK)

### 2.2 — Session creation

7. Creates `ChargingSession` in `panda_ev_core` DB (`status = PENDING`)
8. Per-charger lock: `SET charging:charger:{identity} {sessionId} NX EX 28800` (8h)
9. **Billing snapshot** saved to Redis `charging:session:{sessionId}` (TTL 8h):
   ```json
   {
     "userId": "...", "walletId": "...",
     "pricePerKwh": 1000,
     "chargerIdentity": "PANDA-01", "connectorId": 1,
     "enableUnplugFee": false, "unplugFeeAmount": null,
     "enableParkingFee": true, "parkingFeePerMinute": 50, "parkingFreeMinutes": 15,
     "meterStart": null
   }
   ```
10. Publishes `session.start` → `PANDA_EV_CSMS_COMMANDS`:
    ```json
    { "routingKey": "session.start", "sessionId": "...", "identity": "PANDA-01", "connectorId": 1, "mobileUserId": "..." }
    ```
11. Releases per-user lock in `finally` block

### 2.3 — OCPP executes RemoteStart

12. **OCPP** receives `session.start` from queue:
    - Stores pending session in Redis `session:pending:{identity}:{connectorId}` (TTL 300s):
      ```json
      { "mobileUserId": "...", "idTag": "MOBILE-...", "sessionId": "..." }
      ```
    - Sends `RemoteStartTransaction` to charger (15s timeout; dev: 60s)
    - On `TIMEOUT` or `REJECTED`: deletes pending session, publishes `remote_start.failed` → `PANDA_EV_QUEUE`

13. **Charger** accepts → sends `StartTransaction` back to OCPP:
    - OCPP reads `session:pending` from Redis to get `sessionId` + `mobileUserId`
    - Creates `panda_ev_ocpp.Transaction` (ACTIVE), sets `Connector.currentTransactionId`
    - Deletes `session:pending:{identity}:{connectorId}`
    - Publishes `transaction.started` → `PANDA_EV_QUEUE`:
      ```json
      { "routingKey": "transaction.started", "sessionId": "...", "ocppTransactionId": 42, "meterStart": 1000, "identity": "PANDA-01" }
      ```

14. **Mobile API** (`OcppConsumerService`) receives `transaction.started`:
    - Links `ocppTransactionId` to `ChargingSession` record in DB
    - Merges `meterStart` into Redis billing snapshot `charging:session:{sessionId}`

15. **Charger** sends `StatusNotification connector=1 → Charging`:
    - Redis `connector_status:{identity}:1 = { status: 'Charging' }`
    - Publishes `connector.status_changed` → `PANDA_EV_CHARGER_STATUS`
      → `OcppStatusConsumerService` updates `panda_ev_system.connectors.status = CHARGING`
    - Admin dashboard shows connector `CHARGING` (Redis overlay + DB now in sync)

---

## Phase 3 — During Charging (Live Updates)

```
Charger ──MeterValues (every ~60s)──► OCPP ──► Redis Pub/Sub ──► Mobile App SSE
```

Every `MeterValues` message from the charger:

1. OCPP normalises energy to **Wh** (if charger sends kWh: `raw × 1000`)
2. Writes Redis `charging:live:{identity}:{connectorId}` (TTL 8h):
   ```json
   { "meterWh": 5000, "powerW": 7400, "voltageV": 230, "currentA": 32, "socPercent": 60, "updatedAt": "..." }
   ```
3. Publishes to Redis Pub/Sub channel `meter:{identity}:{connectorId}`
4. **Mobile SSE endpoint** (`GET /api/mobile/v1/charging-sessions/:id/stream`) subscribes via `SseManagerService`:
   - Pushes live payload to app on every MeterValues event
   - Sends `{ heartbeat: true }` every 30s to keep connection alive
   - Polls session status every 10s — when session is no longer ACTIVE: sends `{ ended: true, status, sessionId }` → app closes `EventSource`
5. **Polling fallback**: `GET /api/mobile/v1/charging-sessions/:id/live` reads `charging:live:*` directly from Redis

---

## Phase 4 — Charging Stops

**Triggered by:** user stops in app, charger auto-stops, or plug removed.

```
Charger ──StopTransaction──► OCPP ──► PANDA_EV_QUEUE ──► Mobile API (billing)
```

### 4.1 — OCPP handles StopTransaction

1. Updates `panda_ev_ocpp.Transaction → status=COMPLETED`, saves `meterStop`, `stopReason`
2. Clears `panda_ev_ocpp.Connector.currentTransactionId = null`
3. Publishes `transaction.stopped` → `PANDA_EV_QUEUE`:
   ```json
   { "routingKey": "transaction.stopped", "ocppTransactionId": 42, "meterStop": 8500, "meterStart": 1000, "stopReason": "Local", "identity": "PANDA-01" }
   ```

4. **Charger** sends `StatusNotification connector=1 → Available`:
   - Redis `connector_status:{identity}:1 = { status: 'Available' }`
   - Publishes `connector.status_changed` → `PANDA_EV_CHARGER_STATUS`
     → `OcppStatusConsumerService` updates `panda_ev_system.connectors.status = AVAILABLE`
   - Admin shows connector `AVAILABLE` again (Redis overlay + DB in sync)

### 4.2 — Mobile API bills the session (via DLQ-backed consumer)

5. **Idempotency check**: reads `billing:done:{ocppTransactionId}` — skip if already processed (prevents double-billing on retry)
6. Loads billing snapshot from Redis `charging:session:{sessionId}`
7. Calculates:
   - `energyKwh = (meterStop − meterStart) / 1000`
   - `durationMinutes = (stopTime − startedAt) / 60000`
   - `amount = Math.round(energyKwh × pricePerKwh)` (LAK)

8. **Atomic DB transaction** (`prisma.$transaction`):
   ```
   a. ChargingSession → status=COMPLETED, energyKwh, durationMinutes, amount, endedAt
   b. UPDATE wallets SET balance = balance - amount WHERE id = walletId AND balance >= amount
      (atomic conditional — balance can never go negative)
   c. WalletTransaction.create({ type: 'CHARGE', amount, balanceAfter })
   d. [if enableUnplugFee] second atomic debit + WalletTransaction (description: 'Service Fee for Unplugging')
   ```

9. Sets Redis `billing:done:{ocppTransactionId} = '1'` (TTL 24h)
10. **If parking fee enabled**:
    - Sets Redis `parking:timer:{identity}:{connectorId}` (TTL 8h):
      ```json
      { "sessionId": "...", "userId": "...", "walletId": "...", "parkingFeePerMinute": 50, "parkingFreeMinutes": 15, "sessionCompletedAt": "..." }
      ```
    - Sends FCM push → *"Your car is fully charged. Please unplug to avoid parking fees."*
11. Cleans up Redis:
    - Deletes `charging:session:{sessionId}`
    - Deletes `charging:charger:{identity}` (charger lock released)
12. **SSE stream** detects session no longer ACTIVE → pushes `{ ended: true, status: 'COMPLETED', sessionId }` → app closes `EventSource`
13. Invoice is now queryable via `GET /api/mobile/v1/invoices`

---

## Phase 5 — Overstay Parking Fee (if car left plugged in)

When charger eventually sends `StatusNotification connector=1 → Available` (car unplugged after delay):

```
Charger ──StatusNotification(Available)──► OCPP ──► PANDA_EV_QUEUE ──► Mobile API
```

`OcppConsumerService.handleConnectorStatusChanged()`:

1. Checks Redis `parking:timer:{identity}:{connectorId}` — if present:
2. Calculates `elapsedMinutes = (now − sessionCompletedAt) / 60000`
3. `billableMinutes = max(0, elapsedMinutes − parkingFreeMinutes)`
4. If `billableMinutes > 0`:
   ```sql
   UPDATE wallets SET balance = balance - (billableMinutes × parkingFeePerMinute)
   WHERE id = walletId AND balance >= fee
   ```
   Creates `WalletTransaction` (description: `"Overstay Parking Fee (N min × X LAK)"`)
5. Deletes `parking:timer:{identity}:{connectorId}`

---

## Redis Key Reference (session lifecycle)

| Key | TTL | Written by | Content |
|---|---|---|---|
| `charger_status:{identity}` | 600s | OCPP | `{ status: 'ONLINE'\|'OFFLINE', updatedAt }` |
| `connector_status:{identity}:{connectorId}` | 300s | OCPP | `{ status: 'Available'\|'Charging'\|..., updatedAt }` |
| `session:pending:{identity}:{connectorId}` | 300s | OCPP | `{ mobileUserId, idTag, sessionId }` |
| `charging:charger:{identity}` | 8h | Mobile | `sessionId` (charger lock) |
| `charging:user:{userId}` | 30s | Mobile | `'1'` (per-user start lock) |
| `charging:session:{sessionId}` | 8h | Mobile | Full billing snapshot (pricing, walletId, meterStart) |
| `charging:live:{identity}:{connectorId}` | 8h | OCPP | `{ meterWh, powerW, voltageV, currentA, socPercent }` |
| `parking:timer:{identity}:{connectorId}` | 8h | Mobile | Parking fee timer state |
| `billing:done:{ocppTransactionId}` | 24h | Mobile | `'1'` (idempotency guard) |

---

## RabbitMQ Queue Reference

| Queue | Publisher | Consumer(s) | Events |
|---|---|---|---|
| `PANDA_EV_QUEUE` | OCPP | Mobile API, Notification | `charger.booted`, `charger.status_changed`, `connector.status_changed`, `charger.offline`, `transaction.started`, `transaction.stopped`, `charger.heartbeat` |
| `PANDA_EV_CSMS_COMMANDS` | Mobile API | OCPP | `session.start`, `session.stop` |
| `PANDA_EV_ADMIN_COMMANDS` | Admin | OCPP | All remote OCPP commands (`ChangeAvailability`, `Reset`, etc.) |
| `PANDA_EV_CHARGER_SYNC` | Admin | OCPP | `charger.provisioned\|updated\|decommissioned`, `connector.provisioned\|updated\|decommissioned` |
| `PANDA_EV_CHARGER_STATUS` | OCPP | **Admin only** (`OcppStatusConsumerService`) | `charger.booted`, `charger.status_changed`, `connector.status_changed`, `charger.offline` |
| `PANDA_EV_NOTIFICATIONS` | Mobile, Admin | Notification | FCM push events |

> **Why a separate `PANDA_EV_CHARGER_STATUS` queue?** RabbitMQ work queues are round-robin — if Admin consumed from `PANDA_EV_QUEUE` alongside Mobile + Notification, each message would only reach one consumer. A dedicated queue means Admin gets every status event independently.

### Admin `RabbitMQService.registerConsumer` — Timing Fix (2026-04-10)

**Bug:** NestJS runs `onModuleInit()` in dependency order. `RabbitMQService.onModuleInit()` runs first and iterates the `consumers` Map — but it's empty at that point because `OcppStatusConsumerService.onModuleInit()` hasn't run yet. By the time `OcppStatusConsumerService.onModuleInit()` calls `registerConsumer()`, it only added to the Map; `channel.consume()` was never called, so `PANDA_EV_CHARGER_STATUS` was silently ignored.

**Fix:** `registerConsumer()` now calls `startConsumer()` immediately if `this.channel` is already up (i.e. if `RabbitMQService.onModuleInit()` already ran). The channel consume logic was extracted into a private `startConsumer(queue, handler)` method shared by both code paths.

```
onModuleInit order (before fix):
  1. RabbitMQService.onModuleInit() → consumers Map empty → no channel.consume() started
  2. OcppStatusConsumerService.onModuleInit() → registerConsumer() → Map updated, but channel never consumed ✗

onModuleInit order (after fix):
  1. RabbitMQService.onModuleInit() → consumers Map empty → nothing to consume yet
  2. OcppStatusConsumerService.onModuleInit() → registerConsumer() → channel already up → startConsumer() called immediately ✓
```

---

## DB Writes Per Service Summary

| Service | Schema | Tables written |
|---|---|---|
| OCPP | `panda_ev_ocpp` | `chargers` (status, heartbeat), `connectors` (status, currentTransactionId), `transactions` |
| Mobile | `panda_ev_core` | `charging_sessions`, `wallets`, `wallet_transactions` |
| Admin | `panda_ev_system` | `chargers` (status, lastHeartbeat via `OcppStatusConsumerService`), `connectors` (status via `OcppStatusConsumerService`) |

---

## Error Paths

| Scenario | Handler | Outcome |
|---|---|---|
| `RemoteStartTransaction` timeout (15s) | `SessionService` | Publishes `remote_start.failed`; Mobile marks session `FAILED`, releases charger lock, sends FCM |
| `transaction.stopped` handler throws | DLQ retry: 5s → 30s → 120s → `PANDA_EV_QUEUE_DLQ` | Retried 3× before dead-lettering |
| Charger goes offline with active session | `handleChargerOffline` | Session → `FAILED`; deletes `charging:charger:*` + `charging:session:*`; sends FCM |
| Wallet balance insufficient at billing | `$executeRaw WHERE balance >= amount` | Session still `COMPLETED` but no wallet deduction; logged as warning |
| Redis billing snapshot missing | `handleSessionCompleted` | Session marked `COMPLETED` with null amount; wallet untouched; error logged |
| Double-start attempt (same charger) | `charging:charger:{identity}` setNX fails | 409 Conflict returned immediately |





# ############################
# ---- Below is the Raw Flow by Toh ----  #
# ############################
## Full Flow: Charger Online → Charging → Complete

  Phase 1 — Charger Comes Online

  Charger ──WS connect──► OCPP (4002)

  1. Charger sends BootNotification → OCPP:
    - Updates panda_ev_ocpp.chargers.status = ONLINE, lastHeartbeat
    - Writes Redis charger_status:{identity} = { status: 'ONLINE' }
    - Publishes charger.booted → PANDA_EV_QUEUE
  2. Charger sends StatusNotification (connectorId=0) → OCPP updates charger-level status in Redis
  3. Charger sends StatusNotification (connectorId=1, status=Available) → OCPP:
    - Updates panda_ev_ocpp.connector.status = AVAILABLE
    - Writes Redis connector_status:{identity}:1 = { status: 'Available' }
    - Publishes connector.status_changed → PANDA_EV_QUEUE
  4. Admin dashboard now shows ONLINE / AVAILABLE (via Redis overlay from our fix)

  ---
  Phase 2 — User Starts Charging (QR scan or manual)

  Mobile App ──POST qr-start──► Mobile API (4001)

  1. Mobile API (qrStartSession / startSession):
    - Verifies HMAC sig, decodes Base62 UUIDs
    - LATERAL JOIN → resolves PricingTier from admin DB
    - Checks charging:charger:{identity} Redis key — must be empty (else 409)
    - Per-user lock: charging:user:{userId} setNX TTL 30s
    - Per-charger lock: charging:charger:{identity} setNX TTL 8h
    - Checks wallet balance ≥ MIN_CHARGING_BALANCE
    - Creates ChargingSession in DB (status=PENDING)
    - Publishes session.start → PANDA_EV_CSMS_COMMANDS
    - Snapshots billing config → Redis charging:session:{sessionId} (8h TTL): { userId, walletId,
  pricePerKwh, enableUnplugFee, enableParkingFee, parkingFeePerMinute, … }
  2. OCPP receives session.start from queue:
    - Stores { mobileUserId, idTag, sessionId } in Redis session:pending:{identity}:{connectorId}
  (TTL 300s)
    - Sends RemoteStartTransaction to charger (15s timeout)
  3. Charger accepts → sends StartTransaction back to OCPP:
    - OCPP creates panda_ev_ocpp.Transaction record (ACTIVE)
    - Sets Connector.currentTransactionId
    - Deletes session:pending Redis key
    - Publishes transaction.started → PANDA_EV_QUEUE with { sessionId, ocppTransactionId,
  meterStart }
  4. Mobile API (OcppConsumerService) receives transaction.started:
    - Links ocppTransactionId to ChargingSession record
    - Saves meterStart into Redis charging:session:{sessionId}
    - Charger also sends StatusNotification connector=1 → Charging → Redis
  connector_status:{identity}:1 = 'Charging'
  5. Admin dashboard now shows connector CHARGING

  ---
  Phase 3 — During Charging (live updates)

  Charger ──MeterValues every ~60s──► OCPP

  Every MeterValues message:
  - OCPP normalises to Wh (kWh × 1000 if needed)
  - Writes Redis charging:live:{identity}:{connectorId} → { meterWh, powerW, voltageV, currentA,
  socPercent }
  - Publishes to Redis Pub/Sub channel meter:{identity}:{connectorId}
  - Mobile SSE (GET /charging-sessions/:id/stream) receives the Pub/Sub event → pushes to app in
  real-time
  - Heartbeat every 30s to keep SSE connection alive

  ---
  Phase 4 — Charging Stops

  Triggered by: user presses stop in app, charger stops automatically, or plug removed.

  Charger ──StopTransaction──► OCPP

  1. OCPP receives StopTransaction:
    - Updates panda_ev_ocpp.Transaction → status=COMPLETED, saves meterStop
    - Clears Connector.currentTransactionId = null
    - Publishes transaction.stopped → PANDA_EV_QUEUE with { ocppTransactionId, meterStop,
  meterStart, stopReason }
  2. Charger sends StatusNotification connector=1 → Available:
    - Redis connector_status:{identity}:1 = 'Available'
    - Admin shows AVAILABLE again
  3. Mobile API (OcppConsumerService) receives transaction.stopped (with DLQ retry):
    - Idempotency check: reads billing:done:{ocppTransactionId} Redis key — skip if already billed
    - Loads billing snapshot from Redis charging:session:{sessionId}
    - Calculates: energyKwh = (meterStop − meterStart) / 1000, amount = energyKwh × pricePerKwh
    - Atomic DB transaction:
        - Updates ChargingSession → COMPLETED with energyKwh, durationMinutes, amount
      - UPDATE wallets SET balance = balance − amount WHERE balance >= amount (no negative balance)
      - Creates WalletTransaction record (type=CHARGE)
      - If enableUnplugFee: second atomic debit + another WalletTransaction (description: 'Service
  Fee for Unplugging')
    - Marks billing:done:{ocppTransactionId} = '1' in Redis (24h TTL)
    - If parking fee enabled:
        - Sets Redis parking:timer:{identity}:{connectorId} with timer state
      - Sends FCM push: "Your car is fully charged. Please unplug to avoid parking fees."
    - Cleans up Redis: deletes charging:session:{sessionId} + charging:charger:{identity}
    - SSE stream detects session no longer ACTIVE → sends { ended: true, status: 'COMPLETED' } to
  app → app closes EventSource
  4. Invoice is now queryable via GET /invoices

  ---
  Phase 5 — Overstay Parking Fee (if car left plugged in)

  When charger eventually sends StatusNotification connector=1 → Available (car unplugged):

  - OcppConsumerService.handleConnectorStatusChanged() checks Redis
  parking:timer:{identity}:{connectorId}
  - Calculates billableMinutes = totalMinutes − parkingFreeMinutes
  - If billableMinutes > 0: atomic $executeRaw debit + WalletTransaction with description "Overstay
   Parking Fee (N min × X LAK)"
  - Deletes parking:timer Redis key

  ---
  Data written per service — summary

  ┌──────────────┬─────────────────────────────────────────┬───────────────────────────────────┐
  │   Service    │                DB writes                │           Redis writes            │
  ├──────────────┼─────────────────────────────────────────┼───────────────────────────────────┤
  │              │ panda_ev_ocpp.chargers, .connectors,    │ charger_status:*,                 │
  │ OCPP         │ .transactions                           │ connector_status:*,               │
  │              │                                         │ charging:live:*                   │
  ├──────────────┼─────────────────────────────────────────┼───────────────────────────────────┤
  │              │ panda_ev_core.charging_sessions,        │ charging:session:* (billing       │
  │ Mobile       │ .wallets, .wallet_transactions          │ snapshot), charging:charger:*     │
  │              │                                         │ (lock), billing:done:*            │
  ├──────────────┼─────────────────────────────────────────┼───────────────────────────────────┤
  │              │ panda_ev_system.chargers (status,       │ reads charger_status:*,           │
  │ Admin        │ lastHeartbeat), .connectors (status)    │ connector_status:*                │
  │              │ via OcppStatusConsumerService           │ (for API overlay)                 │
  └──────────────┴─────────────────────────────────────────┴───────────────────────────────────┘
