# ຄໍາອະທິບາຍ: ການເຊື່ອມຕໍ່ລະຫວ່າງ Admin CSMS ←→ OCPP Service

## ພາບລວມຂອງລະບົບ

```
┌──────────────────────────────────────────────────────────────┐
│                PANDA-EV-OCPP  (Port 4002)                    │
│                                                              │
│  ☁️  ລົດ EV ✦ ຕໍ່ WebSocket ✦ ocpp.gateway.ts              │
│         │                                                    │
│         ▼                                                    │
│  📡 ocpp.service.ts                                          │
│         │                                                    │
│         ├─► ✍️  ຂຽນ Redis: charger_status:{identity}        │
│         └─► 📤 Publish RabbitMQ → PANDA_EV_QUEUE            │
└──────────────────────────────────────────────────────────────┘
            │ Redis                      │ RabbitMQ
            ▼                           ▼
┌───────────────────────────┐   ┌──────────────────────┐
│  PANDA-EV-CSMS-ADMIN      │   │  Mobile API ເທົ່ານັ້ນ  │
│   (Port 3001)             │   │  (OCPP→Mobile)        │
│                           │   └──────────────────────┘
│  📖 ອ່ານ Redis:           │
│  charger-live-status      │
│  .service.ts              │
│                           │
│  GET /stations/:id/       │
│      chargers/live        │
└───────────────────────────┘
```

---

## ຈຸດເຊື່ອມຕໍ່ທີ່ 1 — Redis Shared State (ສຳຄັນທີ່ສຸດ)

ນີ້ແມ່ນ **ຊ່ອງທາງດຽວ** ທີ່ Admin ແລະ OCPP ສົ່ງຂໍ້ມູນຫາກັນໂດຍກົງ.

### OCPP ຂຽນ → Admin ອ່ານ

```
OCPP Service                          Admin Service
──────────────────────────────────    ─────────────────────────────────
ocpp.service.ts                       charger-live-status.service.ts
  handleBootNotification()    ──────►  getChargerLiveStatus()
  handleStatusNotification()  ──────►  (connectorId = 0)
  updateChargerOffline()      ──────►

Redis Key: charger_status:{ocppIdentity}
TTL: 600 ວິນາທີ (10 ນາທີ)

ຮູບແບບຂໍ້ມູນ:
{
  status: "Available" | "Charging" | "OFFLINE",
  identity: "PANDA-01",
  updatedAt: "2026-03-22T08:00:00+07:00"
}
```

### Flow ເຕັມ

```
1. ລົດ EV ຕໍ່ WebSocket ກັບ OCPP
      ↓
2. ocpp.gateway.ts:handleConnection()
      ↓
3. ລົດສົ່ງ BootNotification / StatusNotification
      ↓
4. ocpp.service.ts ຂຽນ Redis:
   redis.set("charger_status:PANDA-01", { status: "Available", ... }, 600)
      ↓
5. Admin staff ເປີດ Dashboard ➜ GET /admin/v1/stations/:id/chargers/live
      ↓
6. charger-live-status.service.ts:getChargerLiveStatus()
   ອ່ານ redis.get("charger_status:PANDA-01")
      ↓
7. ສົ່ງ live status ຄືນໃຫ້ Admin Dashboard
   { liveStatus: "Available", isRealTime: true, liveUpdatedAt: "..." }
```

### Admin ຂຽນ → OCPP ອ່ານ (API Key Authentication)

```
Admin Service                          OCPP Service
──────────────────────────────────     ─────────────────────────────────
ການຈັດການ Charger ໃນ Admin Panel  ──►  ocpp.gateway.ts:verifyBasicAuth()

Redis Key: charger:apikey:{identity}

(ໃຊ້ສະເພາະຕອນ OCPP_AUTH_ENABLED=true)
```

---

## ຈຸດເຊື່ອມຕໍ່ທີ່ 2 — RabbitMQ (OCPP → Mobile ເທົ່ານັ້ນ, ບໍ່ຜ່ານ Admin)

> ⚠️ **ສໍາຄັນ:** OCPP ສົ່ງ event ໄປຫາ Mobile API **ໂດຍກົງ** — Admin **ບໍ່ຮັບ** event ເຫຼົ່ານີ້ເລີຍ.

```
OCPP Service                Queue                   ຜູ້ຮັບ
─────────────────────────   ──────────────────────  ───────────────────
ocpp.service.ts publish ──► PANDA_EV_QUEUE       ──► Mobile API ✅
                                                     Admin ❌ (ບໍ່ຮັບ)

Events ທີ່ OCPP publish:
  • charger.booted          ← ລົດ EV ເຊື່ອມຕໍ່ສຳເລັດ
  • charger.status_changed  ← ສະຖານະ Charger (connectorId=0) ປ່ຽນ
  • connector.status_changed← ສະຖານະ Connector ປ່ຽນ
  • charger.heartbeat       ← ລົດ EV ສົ່ງ ping
  • transaction.started     ← ເລີ່ມການ Charge
  • transaction.stopped     ← ຈົບການ Charge (Billing!)
  • charger.offline         ← ລົດ EV ຕັດຈາກລະບົບ
```

---

## ການຄວບຄຸມ Session (Mobile → OCPP, Admin ບໍ່ກ່ຽວ)

```
Mobile API ──► PANDA_EV_CSMS_COMMANDS ──► OCPP
               (ບໍ່ຜ່ານ Admin)

Commands:
  • session.start  → session.service.ts:handleSessionStart()
                     → ocpp.gateway.ts:sendRemoteStart()
  • session.stop   → session.service.ts:handleSessionStop()
                     → ocpp.gateway.ts:sendRemoteStop()
```

---

## ສະຫຼຸບ: ສິ່ງທີ່ Admin ແລະ OCPP ເຊື່ອມຕໍ່ກັນ ແທ້ໆ

| ຊ່ອງທາງ | ທິດທາງ | ຈຸດປະສົງ | ໄຟລ໌ OCPP | ໄຟລ໌ Admin |
|---|---|---|---|---|
| **Redis** `charger_status:*` | OCPP → Admin | Dashboard live status | `ocpp.service.ts` | `charger-live-status.service.ts` |
| **Redis** `charger:apikey:*` | Admin → OCPP | Auth ລົດ EV (ຖ້າເປີດ) | `ocpp.gateway.ts` | Charger management |
| **ຖານຂໍ້ມູນ** | ❌ ບໍ່ມີ | ແຍກກັນຢ່າງສົມບູນ | `panda_ev_ocpp` | `panda_ev_system` |
| **RabbitMQ** | ❌ ບໍ່ໂດຍກົງ | Admin ບໍ່ consume OCPP events | — | — |

---

## ສະຫຼຸບສັ້ນ

- **ການຕິດຕໍ່ຫຼັກ** ລະຫວ່າງ Admin ↔ OCPP ມີພຽງ **Redis ດຽວ**: OCPP ຂຽນ `charger_status`, Admin ອ່ານສະຖານະ real-time ໃຫ້ Dashboard.
- **OCPP ບໍ່ຮູ້ຈັກ Admin DB** ເລີຍ (ຂໍ້ມູນ `panda_ev_system` ຢູ່ Admin ເທົ່ານັ້ນ).
- **RabbitMQ events** ຈາກ OCPP ໄຫຼໄປ Mobile API — ບໍ່ຜ່ານ Admin.
- **Session start/stop** ຄວບຄຸມໂດຍ Mobile ↔ OCPP ໂດຍກົງ, Admin ພຽງແຕ່ **ເບິ່ງ** ສະຖານະ.

---

## ໄຟລ໌ທີ່ກ່ຽວຂ້ອງ

| ໄຟລ໌ | Service | ໜ້າທີ່ |
|---|---|---|
| `src/modules/ocpp/ocpp.service.ts` | OCPP | ຂຽນ Redis charger_status, publish RabbitMQ |
| `src/modules/ocpp/ocpp.gateway.ts` | OCPP | ຮັບ WebSocket, ອ່ານ Redis charger:apikey |
| `src/modules/ocpp/services/session.service.ts` | OCPP | ຈັດການ session.start / session.stop |
| `src/configs/redis/cache.service.ts` | OCPP | Cache helper ສຳລັບ charger:apikey |
| `src/modules/station/services/charger-live-status.service.ts` | Admin | ອ່ານ Redis charger_status |
| `src/modules/station/controllers/station.controller.ts` | Admin | Endpoint GET /stations/:id/chargers/live |
