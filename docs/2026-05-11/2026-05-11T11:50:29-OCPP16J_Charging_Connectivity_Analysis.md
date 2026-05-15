# ການວິເຄາະປັນຫາ OCPP 1.6J — EV Charging System

**Date:** 2026-05-11  
**Topic:** OCPP 1.6J Connectivity Issues — Root Cause Analysis & Solutions

---

## ຂໍ້ມູນລະບົບ

- EV charger ທີ່ນຳໃຊ້ OCPP 1.6J
- ມີການເຊື່ອມຕໍ່ແລ້ວ ແຕ່ບໍ່ສະຖຽນ
- ມີການສູນເສຍສັນຍານອິນເຕີເນັດເປັນບາງຄັ້ງ

## ອາການປັນຫາ

1. **ຂັດຂ້ອງການສາກ ຕອນກຳລັງສາກຢູ່** — ສາກຢູ່ປົກກະຕິ → ສັນຍານຍຸດ ບອກວ່າ "ຕູ້ no response" → ຕ້ອງ reboot ຈຶ່ງຈະກັບມາສາກໄດ້
2. **ສະຖານະຕູ້ອັບເດດຊ້າ** (slow status update)
3. **Session ຄ້າງ** — ກົດຍຸດສາກ ແຕ່ລະບົບຍັງຈຳວ່າກຳລັງສາກຢູ່
4. **ອິນເຕີເນັດຫຼຸດກາງຄັນ** — ລະບົບຕິດຕໍ່ຕູ້ບໍ່ໄດ້, ຕູ້ຍັງສາກໄດ້, ແຕ່ເມື່ອເນັດກັບ session ຍັງຄ້າງ

---

## 1. ຕາຕະລາງສະຫຼຸບ Root Cause vs Solution

| # | ອາການ | Root Cause (OCPP 1.6J) | Priority | Solution |
|---|---|---|---|---|
| P1 | ສາກຢູ່ແລ້ວ "ຕູ້ no response" | WebSocket ຂາດ + ບໍ່ມີ heartbeat timeout detection ທັງ 2 ຝ່າຍ | Critical | Heartbeat tuning + reconnect logic |
| P2 | ຕ້ອງ reboot ຈຶ່ງຈະ reset | Charger stuck ໃນ state `Charging` — ບໍ່ receive `StopTransaction.conf` | Critical | CSMS heartbeat watchdog + force-close stale transaction |
| P3 | Status update ຊ້າ | `StatusNotification.req` ຖືກ queue ຄ້າງ / Heartbeat interval ໃຫຍ່ເກີນ | High | ຫຼຸດ interval + improve queue flush |
| P4 | Session ຄ້າງ ຫຼັງຈາກ stop | `StopTransaction.req` ສົ່ງໄປ CSMS ບໍ່ຮອດ (network cut ກ່ອນ) | Critical | Offline queue + idempotent transaction handling |
| P5 | ເນັດກັບ + ຍັງ session ຄ້າງ | CSMS ບໍ່ sync state ຫຼັງ `BootNotification.req` reconnect | Critical | Post-reconnect reconciliation logic |

---

## 2. Root Cause Analysis ລະອຽດ

### P1 & P2 — ຕູ້ "no response" + ຕ້ອງ reboot

**ສາເຫດຫຼັກ:**

```
Charger ←── WebSocket ──► CSMS
             ↑
         ຂາດໄປ (network blip)
         
Charger: ລໍຖ້າ Heartbeat.conf / ບໍ່ໄດ້ຮັບ response
→ Internal timer expires
→ Charger enters "offline mode" / stuck state
→ CSMS ບໍ່ຮູ້ວ່າ WebSocket ຂາດ (TCP ບໍ່ close gracefully)
→ ທັງ 2 ຝ່າຍ "ຄິດວ່າ" connection ຍັງຢູ່
```

ນີ້ເອີ້ນວ່າ **"TCP Half-open connection"** — ເກີດຈາກ network ຂາດແບບ ungraceful (router reset, signal loss) ໂດຍທີ່ TCP FIN/RST ບໍ່ໄດ້ຖືກສົ່ງ.

**OCPP 1.6J ກຳນົດ** (Section 3.1.4):
> ຖ້າ Charger ບໍ່ໄດ້ຮັບ response ພາຍໃນ timeout ທີ່ກຳນົດ → ຕ້ອງ **reconnect ແລະ retry**

ປັນຫາ: ຖ້າ Charger firmware ບໍ່ implement reconnect ຢ່າງຖືກຕ້ອງ → ຕ້ອງ reboot ດ້ວຍຕົນເອງ.

---

### P3 — Status Update ຊ້າ

**ສາເຫດ:**

1. `Heartbeat interval` ໃຫຍ່ (ເຊັ່ນ: 300s) → CSMS ຮູ້ວ່າ charger offline ຊ້າ
2. `StatusNotification.req` ຖືກ buffer ໃນ queue ຂອງ charger ເວລາ network ຕ່ຳ
3. CSMS ປ່ຽນ status ຈາກ `Charging` → `Available` ກໍ່ຕ່ໍ ຫຼັງ `StopTransaction.conf` ເທົ່ານັ້ນ — ຖ້າ `StopTransaction` ຊ້າ, status ກໍ່ຊ້າ

---

### P4 — Session ຄ້າງ (Hung Transaction)

**Sequence ທີ່ເຮັດໃຫ້ session ຄ້າງ:**

```
User → [STOP] 
Charger → StopTransaction.req ──► CSMS  ← network ຂາດ ❌ (ບໍ່ຮອດ)
Charger ລໍຖ້າ StopTransaction.conf...
Timeout → Charger queue message
Network ກັບ → Charger reconnect
ແຕ່: Charger firmware bug → ບໍ່ flush queue ໃນ correct order
→ CSMS ຍັງ Transaction = ACTIVE
→ User ກົດ Start → "ຕູ້ກຳລັງສາກຢູ່"
```

ຫຼື worst case:
```
Charger reboot → ລືມ queued StopTransaction
→ Transaction "orphaned" ຢູ່ CSMS ຕະຫຼອດໄປ
```

---

### P5 — ເນັດກັບ + ຍັງ state ຜິດ

**OCPP 1.6J Reconnect Flow ທີ່ຖືກຕ້ອງ (Section 4.1.1):**

```
Charger reconnects
→ ສົ່ງ BootNotification.req  ← CSMS ຕ້ອງ respond ກ່ອນ
→ ສົ່ງ queued messages ຕາມລຳດັບ:
   1. StatusNotification.req (Faulted/Available)
   2. MeterValues.req (ຂໍ້ມູນ meter ທີ່ຂາດ)
   3. StopTransaction.req (ຖ້າ session ຈົບໃນຂະນະ offline)
```

ຖ້າ CSMS ຮັບ `StopTransaction.req` ທີ່ `transactionId` ຍັງ ACTIVE → **ຕ້ອງ close ແລະ update balance** — ນີ້ຄື idempotency requirement.

ປັນຫາທີ່ພົບ: **CSMS ບໍ່ handle late StopTransaction** → ປະຕິເສດ → transaction ຄ້າງ.

---

## 3. Solutions ແບ່ງຕາມຄວາມສຳຄັນ

### Quick Win (0–3 ມື້) — ແກ້ທີ່ CSMS Side

**QW-1: ຫຼຸດ Heartbeat Interval**

ໃຊ້ `ChangeConfiguration.req` ສົ່ງໄປຫາ charger:

```json
{
  "key": "HeartbeatInterval",
  "value": "30"
}
```

> ຄ່າ default ມັກເປັນ 300s → ຫຼຸດເປັນ **30–60s** ເພື່ອ detect offline ໄວຂຶ້ນ

**QW-2: ເປີດ WebSocket Ping/Pong**

ຕັ້ງຄ່າ WebSocket server (CSMS side) ໃຫ້ສົ່ງ **ping frame** ທຸກໆ 30s:

```typescript
// panda-ev-ocpp: WebSocket server config
const wss = new WebSocket.Server({
  ...options,
  clientTracking: true,
});

wss.on('connection', (ws) => {
  const pingInterval = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.ping();
    }
  }, 30_000);
  
  ws.on('pong', () => {
    charger.lastPong = Date.now(); // reset watchdog
  });

  ws.on('close', () => clearInterval(pingInterval));
});
```

**QW-3: Manual reconcile stale transactions**

ສ້າງ Admin endpoint ເພື່ອ force-close transaction:

```
POST /api/admin/v1/chargers/:id/transactions/:transactionId/force-stop
→ Mark transaction COMPLETED, reason: "CSMSForced"
→ StatusNotification: Available
```

---

### Short-term (3–14 ມື້)

**ST-1: CSMS Heartbeat Watchdog**

```typescript
// ໃນ OCPP CSMS: ຕິດຕາມ lastHeartbeat ຂອງທຸກ charger
const WATCHDOG_INTERVAL = 60_000; // 60s
const HEARTBEAT_TIMEOUT = 90_000; // 1.5x heartbeat interval

setInterval(async () => {
  const chargers = await getActiveChargers();
  for (const charger of chargers) {
    const timeSinceHeartbeat = Date.now() - charger.lastHeartbeatAt;
    if (timeSinceHeartbeat > HEARTBEAT_TIMEOUT) {
      // Mark charger as Unavailable
      await markChargerOffline(charger.ocppIdentity);
      // Suspend active transactions for this charger
      await suspendActiveTransactions(charger.ocppIdentity, 'Heartbeat timeout');
    }
  }
}, WATCHDOG_INTERVAL);
```

**ST-2: Idempotent StopTransaction Handler**

```typescript
// CSMS handler: ຮັບ StopTransaction.req
async handleStopTransaction(chargeBoxId: string, req: StopTransactionReq) {
  const { transactionId, meterStop, timestamp, reason } = req;
  
  // ຊອກຫາ transaction ໂດຍ transactionId (ທັງ ACTIVE ແລະ ອາດ COMPLETED ແລ້ວ)
  const transaction = await this.findTransaction(transactionId);
  
  if (!transaction) {
    // Unknown transaction — ສົ່ງ conf ກັບ (ຢ່າ reject)
    return { idTagInfo: { status: 'Invalid' } };
  }
  
  if (transaction.status === 'COMPLETED') {
    // Idempotent: already stopped — ສົ່ງ conf ກັບ ໂດຍບໍ່ error
    return { idTagInfo: { status: 'Accepted' } };
  }
  
  // Close transaction
  await this.closeTransaction({
    id: transactionId,
    meterStop,
    stoppedAt: new Date(timestamp),
    reason: reason ?? 'Remote',
  });
  
  return { idTagInfo: { status: 'Accepted' } };
}
```

**ST-3: Post-BootNotification Reconciliation**

```typescript
// ເມື່ອ Charger ສົ່ງ BootNotification.req (reconnect ຫຼື reboot)
async handleBootNotification(chargeBoxId: string, req: BootNotificationReq) {
  const charger = await this.findCharger(chargeBoxId);
  
  // ຊອກ active transactions ສຳລັບ charger ນີ້
  const activeTransactions = await this.getActiveTransactions(charger.id);
  
  for (const tx of activeTransactions) {
    const ageMinutes = (Date.now() - tx.startedAt.getTime()) / 60_000;
    
    if (ageMinutes > 15) {
      // Transaction ອາດຈົບໃນຂະນະ offline — mark as suspect
      await this.flagTransactionForReconciliation(tx.id);
      // ລໍຖ້າ charger ສົ່ງ StopTransaction ກ່ອນ force-close
    }
  }
  
  return {
    status: 'Accepted',
    currentTime: new Date().toISOString(),
    interval: 30, // ໃຊ້ 30s heartbeat
  };
}
```

**ST-4: Transaction Auto-expiry (Safety Net)**

```typescript
// Cron job: ທຸກໆ 5 ນາທີ
@Cron('*/5 * * * *')
async expireStaleTransactions() {
  const STALE_THRESHOLD = 4 * 60 * 60 * 1000; // 4 ຊົ່ວໂມງ
  
  const staleTransactions = await this.prisma.chargingSession.findMany({
    where: {
      status: 'ACTIVE',
      startedAt: { lt: new Date(Date.now() - STALE_THRESHOLD) },
    },
  });
  
  for (const tx of staleTransactions) {
    await this.forceCloseTransaction(tx.id, {
      reason: 'AutoExpired',
      note: 'No heartbeat or StopTransaction received within 4h',
    });
    // Notify admin via RabbitMQ → Notification Service
    await this.notifyStaleTransaction(tx);
  }
}
```

---

### Long-term (ປັບປຸງ Architecture)

**LT-1: Offline-Resilient Transaction Store**

```
Charger (Local Storage)
├── Pending queue: [StopTransaction, MeterValues, StatusNotification]
├── Last known transactionId
└── Flush order: guaranteed FIFO on reconnect

CSMS (Redis + PostgreSQL)
├── charger_state:{ocppIdentity} → { lastSeen, status, activeTransactionId }
├── transaction_lock:{transactionId} → Lua atomic check
└── reconciliation_queue → background worker
```

**LT-2: Dual-mode Transaction Lifecycle**

```
[ACTIVE]
   │
   ├── StopTransaction.req received → [STOPPING] → [COMPLETED]
   ├── Heartbeat timeout (3x) → [SUSPECT]
   │      └── on StopTransaction late arrival → [COMPLETED]
   │      └── on charger BootNotification + no StopTransaction → [FORCE_CLOSED]
   └── Auto-expiry (4h) → [EXPIRED]
```

**LT-3: Charger Firmware Configuration Audit**

ສົ່ງ `GetConfiguration.req` ໄປຫາທຸກ charger ເພື່ອກວດ:

```json
["HeartbeatInterval", "ConnectionTimeOut", "TransactionMessageAttempts", 
 "TransactionMessageRetryInterval", "StopTransactionOnEVSideDisconnect",
 "StopTransactionOnInvalidId", "LocalAuthorizeOffline"]
```

---

## 4. Logs ທີ່ຕ້ອງການ

### Charger Side Logs (ຂໍຈາກ vendor/technician)

```
[REQUIRED] ທຸກ log ໃນຊ່ວງ incident:
1. WebSocket connection/disconnection timestamps
2. Heartbeat sent/received log (ໃຫ້ເຫັນ gaps)
3. StopTransaction.req — ໄດ້ສົ່ງ + ໄດ້ຮັບ conf ຫຼື timeout?
4. Local offline queue contents (ຖ້າ firmware ຮອງຮັບ)
5. Internal state machine transitions (Charging → Finishing → Available)

Format ທີ່ຊອກຫາ:
[2026-05-11 14:32:01] WS DISCONNECT reason=timeout
[2026-05-11 14:32:15] QUEUE StopTransaction txId=1042 attempt=1
[2026-05-11 14:34:55] WS RECONNECT
[2026-05-11 14:34:56] FLUSH queue size=3
```

### CSMS Side Logs (panda-ev-ocpp service)

```typescript
// ຕ້ອງ log ສິ່ງຕໍ່ໄປນີ້:
logger.log(`[HEARTBEAT] ${ocppId} received, prev=${lastHb}, gap=${gapMs}ms`);
logger.log(`[BOOT] ${ocppId} reconnected, active_tx=${activeTx}`);
logger.warn(`[STALE_TX] txId=${id} age=${age}m, charger=${ocppId}`);
logger.error(`[STOP_TX] txId=${id} NOT FOUND — possible lost StopTransaction`);
logger.log(`[RECONCILE] txId=${id} forced closed, reason=BootAfterOffline`);

// OCPP message trace (raw):
logger.debug(`[OCPP→] ${ocppId} ${JSON.stringify(message)}`);
logger.debug(`[OCPP←] ${ocppId} ${JSON.stringify(response)}`);
```

---

## 5. Sequence Diagram — ສາກ + ເນັດຂາດ → ກັບ

```
User       Charger (CP)           Network         CSMS
 │              │                    │               │
 │──[Start]────►│                    │               │
 │              │──StartTransaction.req ────────────►│
 │              │◄─────────────── StartTransaction.conf (txId=1042)
 │              │                    │               │
 │              │─── [Charging] ─────────────────────│
 │              │──Heartbeat.req ─────────────────────►│ (t=30s)
 │              │◄─────────────── Heartbeat.conf ─────│
 │              │                    │               │
 │              │──MeterValues.req ──────────────────►│ (t=60s)
 │              │◄──────────── MeterValues.conf ──────│
 │              │                    │               │
 │              │          ╔══════════════╗           │
 │              │          ║ NETWORK CUT  ║           │
 │              │          ╚══════════════╝           │
 │              │                    ✗               │
 │              │──Heartbeat.req ────✗               │  ← ບໍ່ຮອດ
 │              │  [timeout 30s]     ✗               │
 │              │──Heartbeat.req ────✗               │  ← retry
 │              │  [TCP half-open]                   │
 │              │                                    │
 │              │  [Charger: still charging locally] │
 │              │  [Queue: MeterValues × N]           │
 │              │                                    │
 │──[STOP]─────►│                                    │
 │              │──StopTransaction.req ──────────────✗  ← ບໍ່ຮອດ
 │              │  [Queue: StopTransaction]           │
 │              │  Connector: Finishing state         │
 │              │                                    │
 │              │          ╔══════════════════╗       │
 │              │          ║  NETWORK BACK    ║       │
 │              │          ╚══════════════════╝       │
 │              │                    │               │
 │              │──WebSocket Connect ─────────────────►│
 │              │──BootNotification.req ──────────────►│
 │              │◄─────────── BootNotification.conf ──│
 │              │             (interval=30, Accepted)  │
 │              │                                    │
 │              │  [CSMS: sees active txId=1042]      │
 │              │  [CSMS: flags as SUSPECT]           │
 │              │                                    │
 │              │──StatusNotification.req ───────────►│ (Finishing)
 │              │◄── StatusNotification.conf ─────────│
 │              │                                    │
 │              │──MeterValues.req (queued) ──────────►│
 │              │◄── MeterValues.conf ────────────────│
 │              │                                    │
 │              │──StopTransaction.req ───────────────►│ ← late arrival!
 │              │  { txId: 1042, meterStop: 15000,   │
 │              │    reason: "Local" }                │
 │              │◄────── StopTransaction.conf ────────│ ← CSMS: idempotent accept
 │              │        { status: "Accepted" }       │
 │              │                                    │
 │              │──StatusNotification.req ───────────►│ (Available)
 │              │◄── StatusNotification.conf ─────────│
 │              │                                    │
 │   [Transaction COMPLETED ✓]  [Status: Available ✓]│
```

---

## 6. OCPP 1.6J Compliance Notes

### ສິ່ງທີ່ Charger ຄວນເຮັດ (Spec Requirement)

| Action | Section | Requirement |
|---|---|---|
| `BootNotification` ເມື່ອ reconnect | 4.2 | **MUST** ສົ່ງ BootNotification ຫຼັງ reconnect (ບໍ່ແມ່ນ reboot ເທົ່ານັ້ນ) |
| Queue messages ເວລາ offline | 4.1.1 | **MUST** queue `StopTransaction`, `MeterValues`, `StatusNotification` |
| Flush queue ຕາມ FIFO | 4.1.1 | **MUST** ສົ່ງ messages ຕາມລຳດັບ (ບໍ່ random) |
| `StopTransaction` reason field | 5.11 | **SHOULD** include `reason`: `Local`, `Remote`, `EVDisconnected`, `PowerLoss`, `Reboot`, `Other` |
| Heartbeat ຖ້າ idle | 4.3 | **MUST** ສົ່ງ Heartbeat ເມື່ອບໍ່ມີ traffic ອື່ນ |

### ສິ່ງທີ່ CSMS ຕ້ອງ Handle

| Scenario | Required Behaviour |
|---|---|
| ຮັບ `StopTransaction` ສຳລັບ txId ທີ່ ACTIVE | **MUST** accept ແລະ close transaction |
| ຮັບ `StopTransaction` ສຳລັບ txId ທີ່ COMPLETED ແລ້ວ | **MUST** return `Accepted` (idempotent) |
| ຮັບ `BootNotification` ໃນຂະນະທີ່ txId ຍັງ ACTIVE | **SHOULD** reconcile — ລໍຖ້າ StopTransaction ກ່ອນ force-close |
| ຮັບ `StartTransaction` ສຳລັບ connector ທີ່ ACTIVE | **MUST** reject ດ້ວຍ `idTagInfo.status = "ConcurrentTx"` |

### ຂໍ້ສັງເກດທີ່ Critical

> ⚠️ **OCPP 1.6J Section 3.4** — ລະບຸຊັດວ່າ: *"If the Central System does not receive a response to a request within a given timeout, it SHOULD assume the connection is broken and attempt to reconnect."*
>
> ຄວາມໝາຍ: **ທັງ CSMS ແລະ Charger ຕ້ອງ implement timeout + reconnect** — ບໍ່ແມ່ນ Charger ຝ່າຍດຽວ.

---

## 7. ການຕັ້ງຄ່າທີ່ແນະນຳ

### Heartbeat & Timeout Settings

```
┌─────────────────────────────────────────────────────┐
│           Recommended Configuration                  │
├─────────────────────────┬───────────────────────────┤
│ HeartbeatInterval       │ 30s (ລຸດຈາກ 300s)         │
│ ConnectionTimeOut       │ 90s (= 3x heartbeat)       │
│ WS Ping interval        │ 30s (CSMS side)            │
│ WS Pong timeout         │ 10s                        │
│ TransactionMessageRetry │ 3 attempts                 │
│ RetryInterval           │ 5s, 30s, 120s (backoff)    │
│ StaleTransaction expiry │ 4h (safety net)            │
│ MeterValueInterval      │ 60s (during charging)      │
└─────────────────────────┴───────────────────────────┘
```

### ການ Monitor ທີ່ຕ້ອງ Setup

```
Alerting rules (ຕັ້ງໃນ admin dashboard):
1. Charger offline > 2 ນາທີ → alert
2. Active transaction > 4 ຊົ່ວໂມງ → flag for review
3. StopTransaction ທີ່ CSMS reject > 0 → critical alert
4. BootNotification ທີ່ charger ມີ active tx → investigate
5. Heartbeat gap > 3x interval → mark charger SUSPECT
```

---

## 8. Action Plan

```
ທັນທີ (ວັນນີ້):
✅ ສົ່ງ ChangeConfiguration HeartbeatInterval=30 ໄປຫາທຸກ charger
✅ ເປີດ WebSocket ping/pong ໃນ CSMS
✅ ສ້າງ endpoint force-close stale transactions

ອາທິດ 1:
□ Implement idempotent StopTransaction handler
□ Implement post-BootNotification reconciliation
□ ເພີ່ມ structured logging ສຳລັບ OCPP message trace
□ ສ້າງ stale transaction auto-expiry cron

ອາທິດ 2-4:
□ Dual-state transaction lifecycle (SUSPECT state)
□ Charger firmware audit (GetConfiguration ທຸກ charger)
□ Dashboard monitoring + alerting rules
□ Load test reconnect scenario
```

---

## ສະຫຼຸບ

ສິ່ງສຳຄັນທີ່ສຸດ: **ທົດສອບ StopTransaction idempotency** ກ່ອນ — ຖ້າ CSMS ປະຕິເສດ late StopTransaction, session ຈະຄ້າງທຸກຄັ້ງທີ່ເນັດຂາດ, ບໍ່ວ່າ firmware charger ຈະດີຂະໜາດໃດ.

ຈຸດທີ 2 ທີ່ສຳຄັນ: **TCP Half-open detection** ຜ່ານ WebSocket ping/pong ແກ້ໄດ້ P1 ແລະ P2 ໂດຍບໍ່ຕ້ອງ reboot charger — ນີ້ຄື Quick Win ທີ່ມີຜົນທັນທີ.
