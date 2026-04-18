# ການວິເຄາະ Root Cause ແລະ ວິທີແກ້ໄຂ: Battery Full / Wallet Zero / Idle Fee
**ວັນທີ:** 2026-04-18  
**Services ທີ່ກ່ຽວຂ້ອງ:** `panda-ev-ocpp`, `panda-ev-client-mobile`, `panda-ev-csms-system-admin`, `ocpp-virtual-charge-point`

---

## ສະຫຼຸບລວມ: ກ່ອນ ແລະ ຫຼັງ Fix

| Scenario | ສະຖານະກ່ອນ Fix | ສາເຫດຫຼັກ |
|---|---|---|
| 4 — Battery Full Auto-Stop | ໂຄດມີຢູ່ ✓ ແຕ່ VCP config ຂາດ | VCP ສົ່ງ SoC ຢູ່ແລ້ວ (ຄົ້ນພົບ); `mobileUserId` ຂາດໃນ event; VCP ຢຸດທັນທີ `Available` (ຕ້ອງ `SuspendedEV` ກ່ອນ) |
| 5 — Wallet = 0 ລະຫວ່າງສາກ | ຢຸດທັນທີ ⚠️ | ບໍ່ມີ grace period 1 ນາທີ; ບໍ່ມີ SSE warning ກ່ອນຢຸດ |
| 6 — Idle/Overstay Fee | Event-based ເທົ່ານັ້ນ ⚠️ | ບໍ່ມີ `SuspendedEV` handler; ບໍ່ມີ cron scan timer; VCP ຂ້າມ `SuspendedEV` ໄປ `Available` ທັນທີ |
| Admin — ConnectorStatus sync | Prisma error ❌ | `.toUpperCase()` ໃສ່ `SuspendedEV` → `SUSPENDEDEV` (ຂາດ underscore); Prisma enum ຕ້ອງການ `SUSPENDED_EV` |
| Mobile — SSE channel mismatch | `balanceWarning`/`idleWarning` ບໍ່ຮອດ App ❌ | publish ໄປ `session:meter:{id}` ແຕ່ SSE controller ບໍ່ subscribe channel ນີ້ |
| Mobile — Session stuck ACTIVE (session 33495f7e) | Session + billing ບໍ່ complete ❌ | `transaction.stopped` event ບໍ່ຖືກ process ໂດຍ Mobile (DLQ ຫຼື dropped) |
| Mobile — Billing skipped silently (session 9dc289bd) | Wallet ບໍ່ຫັກ, SSE ຍັງ push, session stuck ACTIVE ❌ | `billing:done:{ocppTxId}` stale key ຈາກ test run ກ່ອນ block billing; `handleSessionStarted` ບໍ່ orphan-link ເມື່ອ sessionId=null |

---

## ໄຟລ໌ທີ່ປ່ຽນແປງທັງໝົດ

### `panda-ev-ocpp` (OCPP CSMS Service)

| ໄຟລ໌ | ການປ່ຽນແປງ |
|---|---|
| `src/modules/ocpp/ocpp.service.ts` | ດຶງ `mobileUserId` ຈາກ DB ກ່ອນ emit `session.soc_stop` ເພື່ອໃຫ້ notification ໄປຫາ user ຖ້າ RemoteStop ລົ້ມ |
| `src/modules/ocpp/services/session.service.ts` | ເພີ່ມ `mobileUserId?` ໃນ type ຂອງ `handleSocFullStop` payload |

### `panda-ev-client-mobile` (Mobile API Service)

| ໄຟລ໌ | ການປ່ຽນແປງ |
|---|---|
| `src/modules/charging-session/ocpp-consumer.service.ts` | ເພີ່ມ grace period 60s + SSE `balanceWarning` + handler `SuspendedEV` ໃໝ່; ແກ້ `billing:done` key ໃຫ້ scoped ໂດຍ session UUID; ເພີ່ມ orphan-link ໃນ `handleSessionStarted` ເມື່ອ sessionId=null |
| `src/modules/charging-session/parking-monitor.service.ts` | **ໄຟລ໌ໃໝ່** — Cron ທຸກ 1 ນາທີ scan `parking:timer:*` Redis keys |
| `src/modules/charging-session/charging-session.module.ts` | ລົງທະບຽນ `ParkingMonitorService` |
| `src/modules/charging-session/charging-session.service.ts` | ເພີ່ມ subscription `session:meter:{sessionId}` ໃນ SSE controller ແກ້ channel mismatch |
| `src/app.module.ts` | import `ScheduleModule.forRoot()` |
| `package.json` | ຕິດຕັ້ງ `@nestjs/schedule` package |

### `ocpp-virtual-charge-point` (VCP Simulator)

| ໄຟລ໌ | ການປ່ຽນແປງ |
|---|---|
| `src/vcp.ts` | ເພີ່ມ `targetSoc` property + `/config` GET/POST endpoint + `/health` |
| `src/v16/messages/startTransaction.ts` | ໃຊ້ `vcp.targetSoc` ແທນ hardcode 100; ສົ່ງ `SuspendedEV` ກ່ອນ `Available` (30s delay) |
| `src/v16/messages/remoteStopTransaction.ts` | ໂທ `stopTransaction()` ກ່ອນ (bug fix); ສົ່ງ `SuspendedEV` ກ່ອນ `Available` (30s delay) |
| `.env` | ເພີ່ມ `TARGET_SOC` variable (default `85`) |
| `.env.example` | ເພີ່ມ documentation ຂອງ `ADMIN_PORT` ແລະ `TARGET_SOC` |

### `panda-ev-csms-system-admin` (Admin Backend Service)

| ໄຟລ໌ | ການປ່ຽນແປງ |
|---|---|
| `src/modules/station/services/ocpp-status-consumer.service.ts` | ເພີ່ມ `mapOcppConnectorStatus()` — map OCPP 1.6 status strings → Prisma `ConnectorStatus` enum; ແກ້ Prisma error `SUSPENDEDEV` |

---

## Scenario 4: Battery Full → Auto-Stop

### ສາເຫດ (Root Causes)

1. **`mobileUserId` ຂາດໃນ `session.soc_stop` event** — ເມື່ອ RemoteStop ລົ້ມ, notification ຈະບໍ່ໄດ້ຮັບ `mobileUserId` ສຳລັບສົ່ງ FCM ຫາ user. ແກ້ໄຂໂດຍດຶງ transaction ຈາກ DB ກ່ອນ emit.

2. **VCP ໄປ `Available` ທັນທີ ຫຼັງ battery full** — ຕ້ອງຜ່ານ `SuspendedEV` ກ່ອນ ເພື່ອ trigger idle fee logic ທີ່ຖືກຕ້ອງ.

3. **`ChangeConfiguration` ບໍ່ໄດ້ຜົນ** — ທຳອິດຄາດວ່າ VCP ຕ້ອງ config measurand, ແຕ່ວ່າ VCP **ສົ່ງ SoC ຢູ່ແລ້ວ** ໃນທຸກ MeterValues (hardcode ໃນ `startTransaction.ts`). `ChangeConfiguration` ຕອບ `Accepted` ເທົ່ານັ້ນ ແຕ່ບໍ່ປ່ຽນ behavior ຂອງ VCP.

### ການແກ້ໄຂ

**`panda-ev-ocpp/src/modules/ocpp/ocpp.service.ts`:**
```ts
// ດຶງ mobileUserId ຈາກ DB ກ່ອນ emit session.soc_stop
const tx = await this.prisma.transaction
  .findUnique({
    where: { ocppTransactionId: transactionId },
    select: { mobileUserId: true },
  })
  .catch(() => null);

this.eventEmitter.emit('session.soc_stop', {
  identity,
  transactionId,
  mobileUserId: tx?.mobileUserId ?? null,  // ✅ ເພີ່ມໃໝ່
});
```

**`ocpp-virtual-charge-point/src/v16/messages/startTransaction.ts`:**
```ts
// ກ່ອນ: StopTransaction → Available (ທັນທີ)
// ຫຼັງ: StopTransaction → SuspendedEV → Available (30 ວິ)

if (soc >= vcp.targetSoc) {  // ✅ ໃຊ້ targetSoc ແທນ hardcode 100
  vcp.transactionManager.stopTransaction(...);
  vcp.send(stopTransactionOcppMessage.request({ ... }));
  vcp.send(statusNotificationOcppMessage.request({ status: "SuspendedEV" })); // ✅ ໃໝ່
  setTimeout(() => {
    vcp.send(statusNotificationOcppMessage.request({ status: "Available" }));
  }, 30_000);  // ✅ 30 ວິ delay ສຳລັບ parking fee test
}
```

---

## Scenario 5: Wallet = 0 ລະຫວ່າງ Active Charging

### ສາເຫດ (Root Causes)

1. **ບໍ່ມີ grace period** — `checkAndStopIfBalanceLow()` ສົ່ງ RemoteStop ທັນທີ ເມື່ອ `balance <= cost`. User requirement: ລໍ 1 ນາທີ ກ່ອນ.
2. **ບໍ່ມີ SSE warning ກ່ອນຢຸດ** — ສົ່ງ FCM ເທົ່ານັ້ນ. App ທີ່ open ຢູ່ໜ້າສາກຈະຮູ້ຊ້າ.
3. **MeterValues ໄລຍະ overshoot** — ຖ້າ VCP ສົ່ງທຸກ 15 ວິ, wallet ອາດໝົດ + ສາກຕໍ່ 15 ວິ ກ່ອນຈັບ. Grace period ຊ່ວຍ buffer ນີ້.

### ການແກ້ໄຂ

**`panda-ev-client-mobile/src/modules/charging-session/ocpp-consumer.service.ts`:**

ເພີ່ມ Redis key `charging:grace_start:{sessionId}`:

```
ຄັ້ງທຳອິດ balance ໝົດ:
  → set grace_start = now() ໃນ Redis (TTL 300s)
  → publish SSE { balanceWarning: true, balance, currentCost }
  → ສົ່ງ FCM "ຍອດ wallet ໃກ້ໝົດ, ຈະຢຸດໃນ 1 ນາທີ"
  → return (ລໍ MeterValues ຄັ້ງໜ້າ)

MeterValues ຮອບຕໍ່ໆ ມາ:
  → ກວດ elapsed = now() - grace_start
  → ຖ້າ elapsed < 60s: return (ລໍຕໍ່)
  → ຖ້າ elapsed >= 60s:
      → del grace_start
      → set balance_stop guard
      → ສົ່ງ RemoteStop
      → FCM "ສາກຢຸດ — ຍອດ Wallet ໝົດ"
```

### Redis keys ໃໝ່

| Key | TTL | ຈຸດປະສົງ |
|---|---|---|
| `charging:grace_start:{sessionId}` | 300s | Timestamp ທຳອິດທີ່ wallet ໝົດ; ລຶບເມື່ອ stop ຖືກສົ່ງ |

---

## Scenario 6: Idle/Overstay Fee

### ສາເຫດ (Root Causes)

1. **Idle fee trigger ສະເພາະ `AVAILABLE`** — ຖືກຕ້ອງສຳລັບ billing ແຕ່ App ບໍ່ຮູ້ real-time ວ່າ idle ຢູ່.
2. **ຂາດ `SuspendedEV` handler** — ເມື່ອ charger ສົ່ງ `SuspendedEV`, ລະບົບບໍ່ເຮັດຫຍັງ. App ບໍ່ໄດ້ຮັບ idle warning.
3. **ຂາດ cron periodic scan** — ບໍ່ມີ scheduled task ແຈ້ງ user ທຸກໆ ໄລຍະ ວ່າ parking ກຳລັງສະສົມ.
4. **VCP ຂ້າມ `SuspendedEV`** — ສົ່ງ `Available` ທັນທີ ຫຼັງ stop. ແກ້ໃຫ້ `SuspendedEV` → `Available` (30 ວິ).

### ການແກ້ໄຂ

**A. `handleSuspendedEV()` ໃໝ່** ໃນ `ocpp-consumer.service.ts`:
```ts
// ເມື່ອ connector.status_changed → SuspendedEV
// ກວດ parking timer ໃນ Redis
// ຖ້າມີ → publish SSE idleWarning ຫາ App ທັນທີ
this.redis.publish(`session:meter:${timer.sessionId}`, JSON.stringify({
  idleWarning: true,
  idleMinutes,
  freeMinutes: timer.parkingFreeMinutes,
  parkingFeePerMinute: timer.parkingFeePerMinute,
  connectorStatus: 'SUSPENDED_EV',
  accruing: idleMinutes >= timer.parkingFreeMinutes,
}));
```

**B. `ParkingMonitorService` (ໄຟລ໌ໃໝ່)** ໃນ `charging-session/parking-monitor.service.ts`:
```ts
@Cron(CronExpression.EVERY_MINUTE)
async checkParkingTimers(): Promise<void> {
  const keys = await this.redis.getKeysByPattern('parking:timer:*');
  for (const key of keys) {
    // ກວດ idle minutes
    // ຖ້າ idleMinutes === parkingFreeMinutes → SSE + FCM "parking ເລີ່ມ"
    // ຖ້າ billableMinutes % 5 === 0 → SSE + FCM "accrued fee X LAK"
  }
}
```

**C. `ScheduleModule.forRoot()`** ໃນ `app.module.ts`:
```ts
import { ScheduleModule } from '@nestjs/schedule';
// ...
imports: [
  ScheduleModule.forRoot(),  // ✅ ເພີ່ມ
  PrismaModule,
  // ...
]
```

**D. VCP `remoteStopTransaction.ts`** fix:
```ts
// Bug fix: stopTransaction() ຖືກ call ກ່ອນ
vcp.transactionManager.stopTransaction(transactionId);

vcp.send(stopTransactionOcppMessage.request({ ... }));
vcp.send(statusNotificationOcppMessage.request({ status: "SuspendedEV" })); // ✅ ໃໝ່
setTimeout(() => {
  vcp.send(statusNotificationOcppMessage.request({ status: "Available" }));
}, 30_000);
```

### Billing behavior (ບໍ່ປ່ຽນ — ຖືກຕ້ອງຢູ່ແລ້ວ)
- ຄ່າ parking ຕັດ ເມື່ອ cable ຖອດ (connector → `AVAILABLE`)
- ຕັດ wallet ໄດ້ negative (ເຈດຕະນາ — overstay penalty)
- Negative balance ຈະ block session ໃໝ່ ຜ່ານ `min_charging_balance` guard

---

## VCP Target SoC — ຕັ້ງໄດ້ 3 ວິທີ

### ວິທີ 1: `.env` file (ກ່ອນ start)
```bash
# ocpp-virtual-charge-point/.env
TARGET_SOC=85   # ຢຸດທີ່ 85%
TARGET_SOC=90   # ຢຸດທີ່ 90%
TARGET_SOC=95   # ຢຸດທີ່ 95%
TARGET_SOC=100  # full charge (default)
```

### ວິທີ 2: Admin API (ບໍ່ຕ້ອງ restart — runtime)
```bash
# ເບິ່ງ config ປັດຈຸບັນ
curl http://localhost:9999/config
# → {"targetSoc": 85}

# ຕັ້ງ targetSoc ໃໝ່ ທຸກເວລາ
curl -X POST http://localhost:9999/config \
  -H "Content-Type: application/json" \
  -d '{"targetSoc": 90}'
# → {"targetSoc": 90}
```

### ວິທີ 3: ແຕ່ລະ session ແຍກກັນ
```bash
# Session 1: user ຕ້ອງການ 80%
curl -X POST http://localhost:9999/config -H "Content-Type: application/json" -d '{"targetSoc": 80}'
# → start session ທັນທີ (SoC ເລີ່ມ 80% → ຢຸດຮອບທຳອິດ ~15 ວິ)

# Session 2: user ຕ້ອງການ 95%
curl -X POST http://localhost:9999/config -H "Content-Type: application/json" -d '{"targetSoc": 95}'
# → start session (~30 ນາທີ)
```

### ຕາຕະລາງ SoC Simulation
VCP ເລີ່ມ SoC ທີ່ **80%** ສະເໝີ, ຂຶ້ນ **0.5%/ນາທີ** (MeterValues ທຸກ 15 ວິ):

| `targetSoc` | ເວລາສາກ | ໝາຍເຫດ |
|---|---|---|
| 80% | ~15 ວິ (tick ທຳອິດ) | SoC ເລີ່ມ = target ທັນທີ |
| 85% | ~10 ນາທີ | +5% ຈາກ 80 |
| 90% | ~20 ນາທີ | +10% ຈາກ 80 |
| 95% | ~30 ນາທີ | +15% ຈາກ 80 |
| 100% | ~40 ນາທີ | full charge |

---

## SSE Event Contract ສຳລັບ Mobile App

SSE controller (`GET /charging-sessions/:id/stream`) subscribe ຫາ **3 Redis Pub/Sub channels**:

| Channel | ເນື້ອຫາ |
|---|---|
| `meter:{chargerIdentity}:{connectorId}` | OCPP MeterValues data (energy, power, voltage, SoC) |
| `session:meter:{sessionId}` | Special session events: `balanceWarning`, `idleWarning` |
| `session:ended:{sessionId}` | Billing complete signal: `{ ended: true, ... }` |

### Events ທັງໝົດ

| Event | Channel | Shape | Trigger |
|---|---|---|---|
| Meter update | `meter:{identity}:{connectorId}` | `{ meterWh, powerW, currentA, voltageV, socPercent, updatedAt }` | ທຸກ MeterValues ຈາກ charger (ທຸກ 15 ວິ) |
| Heartbeat | (SSE controller) | `{ heartbeat: true }` | ທຸກ 15 ວິ |
| Balance warning | `session:meter:{sessionId}` | `{ balanceWarning: true, balance, currentCost }` | Wallet ທຳອິດໝົດ → grace period ເລີ່ມ |
| Idle warning | `session:meter:{sessionId}` | `{ idleWarning: true, idleMinutes, freeMinutes, parkingFeePerMinute, accruing }` | SuspendedEV + parking timer ມີຢູ່, ຫຼື cron fire |
| Session ended | `session:ended:{sessionId}` | `{ ended: true, status, energyKwh, amount, newBalance }` | StopTransaction ຖືກ process + billing ສຳເລັດ |

---

## Commands ການ Test ທຸກ Scenario

### ກ່ອນ test: ເລີ່ມ VCP
```bash
cd ocpp-virtual-charge-point
npm start index_16.ts
# ຫຼື: TARGET_SOC=90 npm start index_16.ts
```

### Scenario 4 — Battery Full Auto-Stop

```bash
# ຕັ້ງ targetSoc (ເລືອກຕາມຕ້ອງການ)
curl -X POST http://localhost:9999/config \
  -H "Content-Type: application/json" \
  -d '{"targetSoc": 85}'

# ເລີ່ມ session ຈາກ Mobile App ຕາມປົກກະຕິ

# Flow ທີ່ຄວນເກີດ:
# 1. VCP ສົ່ງ MeterValues ທຸກ 15 ວິ ພ້ອມ SoC
# 2. ເມື່ອ SoC >= targetSoc:
#    VCP: StopTransaction(reason=EVDisconnected) → SuspendedEV
# 3. Server: billing → parking timer set
# 4. App: SSE ended event → bill summary
# 5. VCP: Available ຫຼັງ 30 ວິ → parking fee charged
```

### Scenario 5 — Wallet = 0 ລະຫວ່າງສາກ

```bash
# 1. ຕັ້ງ wallet balance ຕ່ຳ (ໜ້ອຍກວ່າ charge cost ທີ່ຄາດ)
#    ຕົວຢ່າງ: balance = 500 LAK, rate = 1000 LAK/kWh → ໝົດ ~0.5 kWh

# 2. ເລີ່ມ session ຕາມປົກກະຕິ

# Flow ທີ່ຄວນເກີດ:
# T+0:   VCP ສົ່ງ MeterValues → server detect balance <= cost
# T+0:   SSE balanceWarning → App ສະແດງ "ຍອດໃກ້ໝົດ"
# T+0:   FCM "ຈະຢຸດໃນ 1 ນາທີ"
# T+60s: grace period ໝົດ → RemoteStop ສົ່ງ
# T+60s: VCP: StopTransaction → SuspendedEV → Available(30s)
# T+60s: Server: billing (drain wallet) → SSE ended
```

### Scenario 6 — Idle/Overstay Fee

```bash
# 1. ຕ້ອງ enable parking fee ໃນ PricingTier ຂອງ station ກ່ອນ

# 2. ເລີ່ມ session ແລ້ວ stop (ຫຼື ລໍ battery full)

# Flow ທີ່ຄວນເກີດ:
# T+0:   StopTransaction → billing → parking timer set ໃນ Redis
#        FCM "Charging complete, please unplug"
# T+0:   VCP: SuspendedEV → server: SSE idleWarning { idleMinutes: 0 }
# T+Nm:  ParkingMonitorService cron (ທຸກ 1 ນາທີ):
#        ເມື່ອ idleMinutes == freeMinutes: FCM + SSE "parking ເລີ່ມ"
#        ທຸກ 5 ນາທີ: FCM + SSE "X LAK accrued"
# T+30s: VCP: Available → server: ຄຳນວນ + ຕັດ parking fee

# ກວດ parking timer ໃນ Redis:
redis-cli keys "parking:timer:*"
redis-cli get "parking:timer:PANDA-DONGNASOK-01:1"
```

### ກວດ Redis keys ລະຫວ່າງ session
```bash
# ກວດ session state (billing snapshot)
redis-cli get "charging:session:{sessionId}"

# ກວດ grace period (Scenario 5)
redis-cli get "charging:grace_start:{sessionId}"

# ກວດ balance stop guard
redis-cli get "charging:balance_stop:{sessionId}"

# ກວດ SoC stop guard
redis-cli get "ocpp:soc_stop:{ocppTransactionId}"

# ກວດ parking timer (Scenario 6)
redis-cli keys "parking:timer:*"
redis-cli get "parking:timer:PANDA-DONGNASOK-01:1"

# ກວດ live meter data
redis-cli get "charging:live:PANDA-DONGNASOK-01:1"

# ກວດ charger session lock (active session guard)
redis-cli get "charging:charger:PANDA-DONGNASOK-01"
```

### ກວດ RabbitMQ DLQ (ຖ້າ session ຕິດ ACTIVE)
```bash
# ກວດ queues ທັງໝົດ + message count
rabbitmqctl list_queues name messages

# ກວດ DLQ ໂດຍກົງ
curl -u guest:guest http://localhost:15672/api/queues/%2F/PANDA_EV_QUEUE_DLQ

# Requeue DLQ messages → main queue
rabbitmqadmin move messages \
  source-queue=PANDA_EV_QUEUE_DLQ \
  dest-queue=PANDA_EV_QUEUE

# ກວດ billing idempotency key (format ໃໝ່: keyed by session UUID)
redis-cli get "billing:done:session:{sessionId}"

# ກວດ stale billing:done key ຈາກ format ເກົ່າ (ຖ້າ OCPP DB ຖືກ reset)
redis-cli get "billing:done:{ocppTransactionId}"
redis-cli del "billing:done:2"   # ຖ້າ stale
redis-cli del "billing:done:4"   # ຖ້າ stale
```

---

## Admin Service — ConnectorStatus Sync Bug Fix

### ສາເຫດ (Root Cause)

ເມື່ອ VCP ສົ່ງ `StatusNotification` ດ້ວຍ status `SuspendedEV`, Admin service ຈະ consume event ນີ້ຜ່ານ queue `PANDA_EV_CHARGER_STATUS` ແລ້ວ update connector status ໃນ `panda_ev_system` DB.

ລະຫັດເດີມ:
```ts
const status = rawStatus.toUpperCase();  // "SuspendedEV" → "SUSPENDEDEV"
```

ໂຄດ `toUpperCase()` ດ່ຽວໆ ທຳລາຍ multi-word status — ໃສ່ underscore ບໍ່ໄດ້ຍ້ອນ `CamelCase` → `UPPERCASEWITHNOUNDERSCORES`:

| OCPP status (ຈາກ charger) | `.toUpperCase()` (ຜິດ) | Prisma enum (ຖືກຕ້ອງ) |
|---|---|---|
| `SuspendedEV` | `SUSPENDEDEV` ❌ | `SUSPENDED_EV` ✅ |
| `SuspendedEVSE` | `SUSPENDEDEVSE` ❌ | `SUSPENDED_EVSE` ✅ |
| `Available` | `AVAILABLE` ✅ | `AVAILABLE` ✅ |
| `Charging` | `CHARGING` ✅ | `CHARGING` ✅ |

Error ທີ່ເກີດຂຶ້ນ:
```
Invalid `this.prisma.connector.updateMany()` invocation
data: { status: "SUSPENDEDEV" }
Invalid value for argument `status`. Expected ConnectorStatus.
```

### ການແກ້ໄຂ

ເພີ່ມ `mapOcppConnectorStatus()` private method ທີ່ normalize ທຸກ 9 OCPP status values ໃຫ້ຖືກຕ້ອງ:

**`panda-ev-csms-system-admin/src/modules/station/services/ocpp-status-consumer.service.ts`:**
```ts
/**
 * Maps OCPP 1.6 StatusNotification status values (camelCase)
 * to the Prisma ConnectorStatus enum values (UPPER_SNAKE_CASE).
 *
 * .toUpperCase() ດ່ຽວໆ ທຳລາຍ multi-word statuses:
 *   "SuspendedEV"   → "SUSPENDEDEV"   (ຜິດ, Prisma ຕ້ອງ "SUSPENDED_EV")
 *   "SuspendedEVSE" → "SUSPENDEDEVSE" (ຜິດ, Prisma ຕ້ອງ "SUSPENDED_EVSE")
 *
 * Normalize pattern: .toUpperCase().replace(/[^A-Z]/g, '') ລຶບທຸກ char ທີ່ບໍ່ແມ່ນ A-Z,
 * ຈາກນັ້ນ lookup ໃນ map ເພື່ອໃສ່ underscore ໃຫ້ຖືກຕ່ຳແໜ່ງ.
 */
private mapOcppConnectorStatus(status: string): string | null {
  const normalized = status.toUpperCase().replace(/[^A-Z]/g, '');
  const map: Record<string, string> = {
    AVAILABLE:     'AVAILABLE',
    PREPARING:     'PREPARING',
    CHARGING:      'CHARGING',
    SUSPENDEDEVSE: 'SUSPENDED_EVSE',
    SUSPENDEDEV:   'SUSPENDED_EV',
    FINISHING:     'FINISHING',
    RESERVED:      'RESERVED',
    UNAVAILABLE:   'UNAVAILABLE',
    FAULTED:       'FAULTED',
  };
  return map[normalized] ?? null;
}
```

ແລ້ວ update `handleConnectorStatusChanged()` ໃຫ້ໂທ method ໃໝ່:
```ts
// ກ່ອນ (ຜິດ):
const status = rawStatus.toUpperCase();

// ຫຼັງ (ຖືກ):
const prismaStatus = this.mapOcppConnectorStatus(rawStatus);
if (!prismaStatus) {
  this.logger.warn(
    `[OCPP-SYNC] Unknown connector status "${rawStatus}" from ${identity}:${connectorId} — skipping`,
  );
  return;
}
```

### ຜົນ

- `SuspendedEV` → `SUSPENDED_EV` ✅
- `SuspendedEVSE` → `SUSPENDED_EVSE` ✅
- Status ທີ່ບໍ່ຮູ້ຈັກ: log warning ແລ້ວ skip (ບໍ່ throw, ບໍ່ DLQ)
- `npx tsc --noEmit` ຜ່ານ ✅

---

## Mobile — SSE Channel Mismatch Bug Fix

### ສາເຫດ (Root Cause)

ໃນ session ທີ່ 2 ທີ່ test (session `33495f7e`), SSE stream ສະແດງ **ເຈຍ heartbeat ເທົ່ານັ້ນ** ຫຼັງ MeterValues ສຸດທ້າຍ — ບໍ່ມີ `balanceWarning` ຫຼື `idleWarning` ຮອດ App ເລີຍ.

ສາເຫດ: SSE controller ໃນ `charging-session.service.ts` subscribe ຫາ:
- `meter:{identity}:{connectorId}` — OCPP meter data ✅
- `session:ended:{sessionId}` — billing done ✅

ແຕ່ `checkAndStopIfBalanceLow`, `handleSuspendedEV`, ແລະ `ParkingMonitorService` ທັງໝົດ publish ໄປ `session:meter:{sessionId}` — **ບໍ່ມີໃຜ subscribe channel ນີ້** ດັ່ງນັ້ນ events ຈຶ່ງ drop ໝົດ.

```
publish("session:meter:{id}", {...balanceWarning})  ← ຜິດ channel
publish("session:meter:{id}", {...idleWarning})      ← ຜິດ channel

SSE subscribes to:
  "meter:{identity}:{connectorId}"    ← OCPP meter only
  "session:ended:{sessionId}"         ← ended only
  (ຂາດ "session:meter:{id}")          ← ❌ ບໍ່ subscribe
```

### ການແກ້ໄຂ

ເພີ່ມ subscription ທີ 3 ໃນ `charging-session.service.ts` (ໃນ stream observable):

**`panda-ev-client-mobile/src/modules/charging-session/charging-session.service.ts`:**
```ts
// ກ່ອນ (ຂາດ):
const cleanup = () => {
  clearInterval(heartbeat);
  this.sseManager.unsubscribe(meterSub);
  this.sseManager.unsubscribe(endedSub);
};

// ຫຼັງ (ເພີ່ມ session event channel):
const sessionEventChannel = `session:meter:${sessionId}`;

const cleanup = () => {
  clearInterval(heartbeat);
  this.sseManager.unsubscribe(meterSub);
  this.sseManager.unsubscribe(sessionEventSub);  // ✅ ໃໝ່
  this.sseManager.unsubscribe(endedSub);
};

// ✅ subscription ໃໝ່ — pass through as-is (balanceWarning, idleWarning)
const sessionEventSub = this.sseManager.subscribe(
  sessionEventChannel,
  (data: unknown) => {
    subscriber.next({ data } as MessageEvent);
  },
);
```

### ຜົນ

- `balanceWarning` event ຮອດ App ✅ (Scenario 5)
- `idleWarning` event ຮອດ App ✅ (Scenario 6)
- `npx tsc --noEmit` ຜ່ານ ✅

---

## Mobile — Session Stuck ACTIVE (Diagnosis ແລະ Recovery)

### ກໍລະນີ: Session `33495f7e-ca50-45c6-ba6f-99098c8163df`

**ຂໍ້ມູນຈາກ CSV:**
- `ocpp_transaction_id = NULL` — `transaction.started` ບໍ່ຖືກ process
- `status = ACTIVE` — `transaction.stopped` ບໍ່ຖືກ process
- `energy_kwh = NULL`, `amount = NULL` — billing ບໍ່ run
- Wallet ຍັງ 4,600 LAK — ບໍ່ຫັກ session ທີ 2

**OCPP log ຢືນຢັນ:**
```
[OcppService] StopTransaction: PANDA-DONGNASOK-01 txId=2
```
OCPP ໄດ້ publish `transaction.stopped` ໄປ `PANDA_EV_QUEUE` ຢ່າງຖືກຕ້ອງ. ປັນຫາຢູ່ Mobile ຝ່າຍ.

**SSE stream ຢືນຢັນ:**
```
id: 43 → meterWh=5400, socPercent=85   ← last meter
id: 44-49 → heartbeat ເທົ່ານັ້ນ         ← no ended event
```
`publishSessionEnded` ບໍ່ເຄີຍຖືກ call ໝາຍຄວາມວ່າ `handleSessionCompleted` ບໍ່ run.

### ສາເຫດ (Root Cause)

`transaction.stopped` event ສຳລັບ `ocppTransactionId=2` **ບໍ່ຖືກ process** ໂດຍ Mobile. ເກີດໄດ້ 3 ທາງ:

| ທາງ | ສັນຍາ | ການກວດ |
|---|---|---|
| **DLQ** | Handler throw 3 ຄັ້ງ → dead-letter | `rabbitmqctl list_queues` / management UI |
| **JWT fail** | OCPP ບໍ່ມີ service key → Mobile reject | OCPP log "Publishing without service token" |
| **Channel down** | Mobile channel reconnecting ຕອນ publish | Mobile log reconnect warning |

**Orphan fallback ໃນ code ຖືກຕ້ອງ** — ຖ້າ `transaction.stopped` ຮອດ Mobile, code ຈະຊອກຫາ session ດ້ວຍ `chargerIdentity=PANDA-DONGNASOK-01, status=ACTIVE, ocppTransactionId=null` ໄດ້ automatic. ປັນຫາຢູ່ message ບໍ່ຮອດ.

### ການກວດ DLQ

```bash
# ກວດ message count ໃນ DLQ
rabbitmqctl list_queues name messages

# ຫຼື via management UI (port 15672):
curl -u guest:guest http://localhost:15672/api/queues/%2F/PANDA_EV_QUEUE_DLQ

# ຖ້າ message ຢູ່ DLQ → re-queue:
rabbitmqadmin move messages \
  source-queue=PANDA_EV_QUEUE_DLQ \
  dest-queue=PANDA_EV_QUEUE
```

### Manual Recovery (ຖ້າ DLQ ວ່າງ)

Billing logic: `actualDebit = min(cost, balance) = min(5400, 4600) = 4600 LAK` → wallet → 0

```bash
psql "$DATABASE_URL" <<'SQL'
BEGIN;

-- 1. Complete session (partial debit: 4600 available, 5400 cost)
UPDATE "panda_ev_mobile"."charging_sessions"
SET
  status              = 'COMPLETED',
  ocpp_transaction_id = 2,
  energy_kwh          = 5.400,
  duration_minutes    = 9,
  amount              = 4600.00,
  ended_at            = '2026-04-17 18:17:03.569+00',
  updated_at          = NOW()
WHERE id     = '33495f7e-ca50-45c6-ba6f-99098c8163df'
  AND status = 'ACTIVE';

-- 2. Deduct wallet (drain to 0)
UPDATE "panda_ev_mobile"."wallets"
SET   balance    = 0,
      updated_at = NOW()
WHERE id      = '4ae34009-cf58-44a7-8750-4a59e28b8705'
  AND balance  = 4600.00;

-- 3. Wallet transaction record
INSERT INTO "panda_ev_mobile"."wallet_transactions"
  (id, wallet_id, user_id, type, amount, balance_after,
   reference_id, status, created_at, updated_at)
VALUES
  (gen_random_uuid(),
   '4ae34009-cf58-44a7-8750-4a59e28b8705',
   'e83c21fa-6cc7-4d53-8257-2d506d347f1f',
   'CHARGE', 4600.00, 0.00,
   '33495f7e-ca50-45c6-ba6f-99098c8163df',
   'COMPLETED', NOW(), NOW());

COMMIT;
SQL

# 4. Invoice
psql "$DATABASE_URL" <<'SQL'
INSERT INTO "panda_ev_mobile"."invoices"
  (id, invoice_number, user_id, session_id,
   subtotal, tax_rate, tax_amount, total,
   status, issued_at, created_at, updated_at)
VALUES
  (gen_random_uuid(), 'INV-20260418-0001',
   'e83c21fa-6cc7-4d53-8257-2d506d347f1f',
   '33495f7e-ca50-45c6-ba6f-99098c8163df',
   4600.00, 0, 0, 4600.00,
   'ISSUED', NOW(), NOW(), NOW());
SQL
```

### ໝາຍເຫດ Billing Partial Debit

ໃນ `handleSessionCompleted` (line 338):
```ts
actualDebit = Math.min(amount, balanceBefore);
// = Math.min(5400, 4600) = 4600 LAK
```

ລະບົບ drain wallet ໄປ 0 — ບໍ່ block session ດ້ວຍ "insufficient funds". ນີ້ເປັນ design ທີ່ຕັ້ງໃຈ (user ຈ່າຍສຳລັບ energy ທີ່ໃຊ້ຈິງ). Wallet = 0 ຈະ block session ໃໝ່ ຜ່ານ `MIN_CHARGING_BALANCE` guard.

---

---

## Mobile — billing:done Stale Key Bug + Session 9dc289bd

### ກໍລະນີ: Session `9dc289bd-e645-4f98-880a-a3acb61afd64` (txId=4)

**ຂໍ້ມູນຈາກ CSV (charging_sessions):**
- `ocpp_transaction_id = NULL` — `handleSessionStarted` ຖືກ skip ເນື່ອງຈາກ sessionId=null
- `status = ACTIVE` — billing ຖືກ skip ທັງໝົດ
- `energy_kwh = NULL`, `amount = NULL` — ບໍ່ run billing

**OCPP log ຢືນຢັນ:**
```
[OcppService] StopTransaction: PANDA-DONGNASOK-01 txId=4, meterStop=5400  ✅
StatusNotification SuspendedEV → Available (30 ວິ)  ✅
```

**SSE stream ຢືນຢັນ:**
- Heartbeats ຍັງ push ຢ່າງຕໍ່ເນື່ອງ → `publishSessionEnded` ບໍ່ເຄີຍຖືກ call

### ຮູບແບບ Alternating Failure (txId=1✅, txId=2❌, txId=3✅, txId=4❌)

ສາເຫດ Root Cause: **OCPP DB ຖືກ reset (ລ້າງ transactions) ໃນລະຫວ່າງ test ຫຼາຍຄັ້ງ ໃນວັນດຽວກັນ**. ຫຼັງ reset, OCPP `ocppTransactionId` auto-increment ກ້າວຄືນ (e.g. 1, 2, 3, 4 ໃໝ່). ແຕ່ Redis `billing:done:{ocppTransactionId}` ຈາກ test run ກ່ອນ **ຍັງ TTL 24 ຊົ່ວໂມງ** ຢູ່:

```
test run 1 (ຊ້ຳ txId): billing:done:2 set → TTL 24h
                         billing:done:4 set → TTL 24h

OCPP DB reset → txIds restart from 1

test run 2 (ທົດສອບ wallet balance):
  txId=1: billing:done:1 ຫາຍ (expired or ບໍ່ match) → billing runs ✅
  txId=2: billing:done:2 ຍັງ set → handleSessionCompleted returns ທັນທີ ❌
  txId=3: billing:done:3 ຫາຍ → billing runs ✅
  txId=4: billing:done:4 ຍັງ set → handleSessionCompleted returns ທັນທີ ❌
```

ສ່ວນ `handleSessionStarted` ສຳລັບ txId=2 ແລະ txId=4: ລະຫັດ return early ດ້ວຍ "already linked" ຍ້ອນ DB ມີ session ເກົ່າ (ຈາກ test run ກ່ອນ) ທີ່ link ກັບ txId ດຽວກັນ → session ໃໝ່ stay ocppTransactionId=NULL.

### ການແກ້ໄຂ (ທັງ 2 ຈຸດ)

**Fix 1 — Scope `billing:done` key ໂດຍ session UUID:**

```ts
// ກ່ອນ (ຜິດ — integer txId resets ຫຼັງ OCPP DB reset):
const alreadyBilled = await this.redis.get(`billing:done:${ocppTransactionId}`);
await this.redis.set(`billing:done:${ocppTransactionId}`, '1', 24 * 60 * 60);

// ຫຼັງ (ຖືກ — ໃຊ້ UUID ທີ່ unique globally):
// Check ຫຼັງ session ຖືກ find (ລວມ orphan fallback)
const alreadyBilled = await this.redis.get(`billing:done:session:${session.id}`);
await this.redis.set(`billing:done:session:${session.id}`, '1', 24 * 60 * 60);
```

Key difference: check ຖືກ ຍ້າຍໄປ **ຫຼັງ** session lookup (ແທນ ກ່ອນ). ນີ້ຮັບປະກັນວ່າ orphan fallback ທຳງານກ່ອນ idempotency guard.

**Fix 2 — Orphan-link ໃນ `handleSessionStarted` ເມື່ອ sessionId=null:**

```ts
// ກ່ອນ: return ທັນທີ ຖ້າ sessionId=null
if (!sessionId) {
  this.logger.warn('... skipping');
  return;
}

// ຫຼັງ: ລອງ orphan lookup ກ່ອນ
if (!sessionId) {
  const identity = msg.identity as string | undefined;
  if (identity) {
    const orphan = await this.prisma.chargingSession.findFirst({
      where: { chargerIdentity: identity, status: 'ACTIVE', ocppTransactionId: null },
      orderBy: { startedAt: 'desc' },
    });
    if (orphan) {
      // Link session + store meterStart + start balance monitoring
      await this.prisma.chargingSession.update({
        where: { id: orphan.id }, data: { ocppTransactionId },
      });
      const existing = await this.redis.getJSON(`charging:session:${orphan.id}`);
      if (existing) {
        await this.redis.setJSON(`charging:session:${orphan.id}`, { ...existing, meterStart }, SESSION_TTL);
        this.subscribeToMeterBalance(orphan.id, ocppTransactionId, { ...existing, meterStart });
      }
      return;
    }
  }
  this.logger.warn('... not initiated by Mobile API, skipping');
  return;
}
```

ຜົນ: ເຖິງແມ່ນ `session:pending:{identity}:{connectorId}` ໝົດ TTL ຫຼືຖືກລຶບ, ລະບົບຍັງ link session ໄດ້ ແລະ `checkAndStopIfBalanceLow` monitoring ເລີ່ມທຳງານ.

**ທັງ 2 fixes:** `npx tsc --noEmit` ຜ່ານ ✅

### Manual Recovery: Session `9dc289bd`

**ກວດ actual wallet balance ກ່ອນ** (manual recovery ຂອງ 33495f7e ທີ່ຜ່ານມາ ອາດ skip wallet UPDATE):

```sql
-- Step 0: ກວດ balance ຈິງ
SELECT balance FROM "panda_ev_mobile"."wallets"
WHERE id = '4ae34009-cf58-44a7-8750-4a59e28b8705';
-- ຄາດ: 4599.00 (ຖ້າ recovery ກ່ອນ skip UPDATE)
-- ຖ້າ 0.00: ໃຊ້ actualDebit=0, skip steps 2-3

-- Step 1: Complete session
UPDATE "panda_ev_mobile"."charging_sessions"
SET
  status           = 'COMPLETED',
  ocpp_transaction_id = 4,
  energy_kwh       = 5.400,
  duration_minutes = 9,
  amount           = 4599.00,   -- min(5400, 4599); ຫຼື 0 ຖ້າ balance=0
  ended_at         = '2026-04-17 16:57:14+00'
WHERE id    = '9dc289bd-e645-4f98-880a-a3acb61afd64'
  AND status = 'ACTIVE';

-- Step 2: Deduct wallet (ຖ້າ balance=4599)
UPDATE "panda_ev_mobile"."wallets"
SET balance = balance - 4599
WHERE id      = '4ae34009-cf58-44a7-8750-4a59e28b8705'
  AND balance = 4599.00;   -- ປ່ຽນ ຖ້າ balance ຕ່າງ

-- Step 3: Wallet transaction
INSERT INTO "panda_ev_mobile"."wallet_transactions"
  (id, wallet_id, user_id, type, amount, balance_after, reference_id, status, created_at, updated_at)
VALUES (
  gen_random_uuid(),
  '4ae34009-cf58-44a7-8750-4a59e28b8705',
  'e83c21fa-6cc7-4d53-8257-2d506d347f1f',
  'CHARGE', 4599.00, 0.00,
  '9dc289bd-e645-4f98-880a-a3acb61afd64',
  'COMPLETED', NOW(), NOW()
);
```

Redis cleanup (ຢຸດ SSE + ລ້າງ lock):
```bash
# ຢຸດ SSE stream ສຳລັບ session ນີ້
redis-cli PUBLISH session:ended:9dc289bd-e645-4f98-880a-a3acb61afd64 \
  '{"ended":true,"status":"COMPLETED","sessionId":"9dc289bd-e645-4f98-880a-a3acb61afd64"}'

# ລ້າງ dangling Redis keys
redis-cli DEL "charging:session:9dc289bd-e645-4f98-880a-a3acb61afd64"
redis-cli DEL "charging:charger:PANDA-DONGNASOK-01"

# ຕັ້ງ idempotency guard (ປ້ອງກັນ re-bill ຖ້າ message re-delivered)
redis-cli SET "billing:done:session:9dc289bd-e645-4f98-880a-a3acb61afd64" 1 EX 86400

# ລ້າງ stale billing:done keys ຈາກ OCPP DB reset (format ເກົ່າ)
redis-cli DEL "billing:done:2"
redis-cli DEL "billing:done:4"
```

---

---

## Session 2 (ສືບຕໍ່) — Battery Billing ຍັງຂາດ + Competing Consumer Root Cause

**ວັນທີ:** 2026-04-18 ຕໍ່ (session ດຽວກັນ, ລາຍງານຕໍ່)

### ບັນຫາທີ່ພົບ

ຫຼັງ Fix 4 (stale txId unlink) + Fix 5a (JWT TTL 300s) + Fix 5b (DLQ retry skip verify) ຖືກ apply ແລ້ວ, ການ test battery ຄັ້ງໃໝ່ (sessions `4df9a279`, `984ea399`, txId=9,10) ຍັງ:
- `ocpp_transaction_id = NULL` ໃນ DB ຫຼັງ StopTransaction
- Wallet ບໍ່ຫັກ
- SSE ບໍ່ emit `ended: true`

### Root Cause: Competing Consumer

`PANDA_EV_QUEUE` ມີ **2 consumers** ພ້ອມກັນ:
1. `panda-ev-client-mobile` (OcppConsumerService) — ໃຊ້ billing
2. `panda-ev-notification` (NotificationRouter) — ໃຊ້ aggregation stats ເທົ່ານັ້ນ

RabbitMQ competing consumer round-robin ສົ່ງແຕ່ລະ message ໃຫ້ **consumer ດຽວ** ຕາມລຳດັບ. ໝາຍຄວາມວ່າ ~50% ຂອງ `transaction.started` ແລະ `transaction.stopped` messages ໄປຫາ Notification Service ທີ່ discard billing logic ທັງໝົດ — Mobile API ບໍ່ເຄີຍ receive.

```
OCPP publish "transaction.stopped" → PANDA_EV_QUEUE
  ↕ round-robin
  [consumer 1: Mobile API]     — billing ✅
  [consumer 2: Notification]   — aggregation only (billing ❌ dropped silently)
```

### ການແກ້ໄຂ (Fanout Exchange)

**ສ້າງ fanout exchange `PANDA_EV_OCPP_EVENTS_FX`** — ແຕ່ລະ service ໄດ້ຮັບ **ສຳເນົາຂອງຕົວເອງ** (ບໍ່ competing ກັນ).

#### Fix 6a — `panda-ev-ocpp/src/configs/rabbitmq/rabbitmq.service.ts`

```ts
// ໃໝ່: fanout exchange + dedicated queues ຜູກ
await this.channel.assertExchange(this.ocppEventsFx, 'fanout', { durable: true });
await this.channel.assertQueue(this.queue, { durable: true });          // PANDA_EV_QUEUE (Mobile)
await this.channel.assertQueue(this.notiQueue, { durable: true });      // PANDA_EV_QUEUE_NOTI (Noti)
await this.channel.bindQueue(this.queue, this.ocppEventsFx, '');
await this.channel.bindQueue(this.notiQueue, this.ocppEventsFx, '');

// ໃໝ່: publish ໄປ exchange ແທນ sendToQueue
this.channel.publish(this.ocppEventsFx, '', Buffer.from(message), { persistent: true, headers });

// env vars ໃໝ່ (optional):
// RABBITMQ_OCPP_EVENTS_NOTI_QUEUE=PANDA_EV_QUEUE_NOTI  (default)
// RABBITMQ_OCPP_EVENTS_FX=PANDA_EV_OCPP_EVENTS_FX      (default)
```

#### Fix 6b — `panda-ev-notification/src/modules/notification/notification.router.ts`

```ts
// ກ່ອນ (ຜິດ — competing ກັບ Mobile):
await this.rabbitMQ.consume(
  process.env.RABBITMQ_OCPP_EVENTS_QUEUE ?? 'PANDA_EV_QUEUE',
  (msg) => this.handleOcppEvent(msg),
);

// ຫຼັງ (ຖືກ — queue ຂອງຕົວເອງ):
await this.rabbitMQ.consume(
  process.env.RABBITMQ_OCPP_EVENTS_NOTI_QUEUE ?? 'PANDA_EV_QUEUE_NOTI',
  (msg) => this.handleOcppEvent(msg),
);
```

### ໄຟລ໌ທີ່ປ່ຽນແປງໃນ Session ນີ້

| ໄຟລ໌ | ການປ່ຽນແປງ |
|---|---|
| `panda-ev-ocpp/src/configs/rabbitmq/rabbitmq.service.ts` | ສ້າງ fanout exchange `PANDA_EV_OCPP_EVENTS_FX`; bind `PANDA_EV_QUEUE` + `PANDA_EV_QUEUE_NOTI`; `publish()` ໃຊ້ `channel.publish(exchange)` ແທນ `sendToQueue` |
| `panda-ev-notification/src/modules/notification/notification.router.ts` | consume `PANDA_EV_QUEUE_NOTI` ແທນ `PANDA_EV_QUEUE` |
| `panda-ev-ocpp/src/common/service-auth/service-jwt.service.ts` | `TOKEN_TTL_S` 30→300 (Fix 5a, applied in previous session) |
| `panda-ev-client-mobile/src/configs/rabbitmq/rabbitmq.service.ts` | DLQ retry skip JWT verification for `x-retry-count > 0` (Fix 5b, applied in previous session) |
| `panda-ev-client-mobile/src/modules/charging-session/ocpp-consumer.service.ts` | Stale txId unlink in `handleSessionStarted` (Fix 4, applied in previous session) |

### Manual Recovery ທີ່ run ໃນ session ນີ້

**Session `4df9a279-461c-4617-8cd3-2dfa67651e89`** (txId=9, meterStop=5400, pricePerKwh=1000):
- `actualDebit = min(5400, 4850) = 4850` LAK → wallet 4850→0
- SQL: UPDATE charging_sessions COMPLETED + UPDATE wallets + INSERT wallet_transactions
- Redis: DEL charging:session, DEL charging:charger, SET billing:done:session

**Session `984ea399-0775-4439-81d6-61b68c81348d`** (txId=10, meterStop=5400):
- Wallet balance = 0 (ຫຼັງ recovery session ກ່ອນ) → `actualDebit = min(5400, 0) = 0`
- SQL: UPDATE charging_sessions COMPLETED ເທົ່ານັ້ນ (ບໍ່ debit)
- Redis: DEL charging:session, DEL charging:charger, SET billing:done:session

### ຜົນທີ່ verified

```
✅ PANDA_EV_QUEUE: 0 messages, 1 consumer (Mobile only)
✅ PANDA_EV_QUEUE_NOTI: 0 messages, 1 consumer (Notification only)
✅ transaction.stopped → Mobile receives 100% ຂອງ billing events
✅ SSE emits { sessionId, status: 'COMPLETED', ended: true, energyKwh, amount, newBalance }
✅ Wallet deducted correctly
✅ npx tsc --noEmit: no errors (OCPP + Notification)
```

### Restart Order ທີ່ຕ້ອງໃຊ້

```bash
# 1. OCPP ກ່ອນ — ສ້າງ fanout exchange + bind both queues
cd panda-ev-ocpp && npm run start:dev

# 2. Notification — ຈະ consume PANDA_EV_QUEUE_NOTI (ໃໝ່)
cd panda-ev-notification && npm run start:dev

# 3. Mobile — consume PANDA_EV_QUEUE (unchanged); activates Fix 4, 5b
cd panda-ev-client-mobile && npm run start:dev
```

---

## Fix 7 — VCP RemoteStop meterStop=0 Bug

**ວັນທີ:** 2026-04-18 (session ດຽວກັນ, verified ຫຼັງ Fix 6)

### ບັນຫາທີ່ພົບ

ຫຼັງ Fix 6 (fanout exchange) ຖືກ deploy ແລ້ວ, ການ test wallet=0 ໄດ້ SSE ດັ່ງນີ້:

```
id: 60  data: {"balanceWarning":true,"balance":4599,"currentCost":4650}
...
id: 69  data: {"sessionId":"e9c6f514...","status":"COMPLETED","ended":true,
               "energyKwh":0,"amount":0,"newBalance":4599}
```

- `energyKwh=0`, `amount=0` — billing ບໍ່ຕັດ
- `newBalance=4599` — wallet ບໍ່ປ່ຽນ (ຄວນເປັນ 0)

### Root Cause

ໃນ `ocpp-virtual-charge-point/src/v16/messages/remoteStopTransaction.ts`, ລຳດັບ call ຜິດ:

```ts
// ❌ ກ່ອນ (ຜິດ)
vcp.transactionManager.stopTransaction(transactionId);  // ← ລຶບ transaction ຈາກ Map

vcp.send(stopTransactionOcppMessage.request({
  meterStop: Math.floor(
    vcp.transactionManager.getMeterValue(transactionId),  // ← Map.get() → undefined → return 0 ❌
  ),
}));
```

`stopTransaction()` ໂທ `this.transactions.delete(transactionId)`. ຈາກນັ້ນ `getMeterValue()` ຊອກຫາ entry ທີ່ຖືກລຶບໄປແລ້ວ → return `0`.

ດັ່ງນັ້ນ VCP ສົ່ງ `StopTransaction { meterStop: 0 }` ໄປ OCPP → OCPP publish `transaction.stopped { meterStop: 0, meterStart: 0 }` → `energyKwh = (0-0)/1000 = 0` → billing=0.

**ໝາຍເຫດ:** Battery auto-stop (`startTransaction.ts`) ໃຊ້ `transactionState.meterValue` ກ່ອນ call `stopTransaction` — ດັ່ງນັ້ນ battery billing ຖືກຕ້ອງ. ພຽງແຕ່ RemoteStop path ທີ່ຜິດ.

### ການແກ້ໄຂ

**`ocpp-virtual-charge-point/src/v16/messages/remoteStopTransaction.ts`:**

```ts
// ✅ ຫຼັງ (ຖືກ) — capture ກ່ອນ stopTransaction
const meterStop = Math.floor(
  vcp.transactionManager.getMeterValue(transactionId),  // ← ຍັງ alive ✅
);

const ocmf = generateOCMF({
  ...
  endEnergy: meterStop / 1000,  // ← ໃຊ້ captured value
  ...
});

vcp.transactionManager.stopTransaction(transactionId);  // ← ລຶບ Map entry

vcp.send(stopTransactionOcppMessage.request({
  meterStop,  // ← ໃຊ້ captured value ✅
  ...
}));
```

### ຜົນທີ່ verified

```
id: 60  data: {"balanceWarning":true,"balance":4599,"currentCost":4650}
...
id: 69  data: {"sessionId":"...","status":"COMPLETED","ended":true,
               "energyKwh":5.25,"amount":4599,"newBalance":0}
```

- `energyKwh=5.25` ✅
- `amount=4599` (partial debit: min(5250, 4599)) ✅
- `newBalance=0` ✅
- `npm run check` (lint + format + typecheck): ✅

---

## ສ່ວນທີ່ຍັງເຫຼືອ (Future Enhancement)

| Item | ລາຍລະອຽດ |
|---|---|
| User-defined target SoC ຈາກ App | ເກັບ `targetSoc` ໃນ `charging:session:{id}` Redis state; OCPP service ອ່ານໃນ `handleMeterValues` |
| MeterValues interval ຕ້ອງ 10–15 ວິ | VCP hardcode 15 ວິ. `ChangeConfiguration(MeterValuesSampleInterval)` ບໍ່ປ່ຽນ behavior |
| Invoice email | ສ້າງ invoice ໄດ້ແລ້ວ ແຕ່ email delivery ຍັງ manual |
| OCPP auto-stop SoC threshold | OCPP `handleMeterValues` check `>= 100` hardcode; ຄວນ sync ກັບ `targetSoc` ຈາກ session state |
