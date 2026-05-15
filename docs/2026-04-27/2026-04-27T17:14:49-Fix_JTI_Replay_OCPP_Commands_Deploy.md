# ບັນທຶກການແກ້ໄຂ: JTI Replay Bug, OCPP Commands, Mobile Deploy

**ວັນທີ**: 2026-04-27  
**Services ທີ່ກ່ຽວຂ້ອງ**: panda-ev-ocpp, panda-ev-csms-system-admin, panda-ev-client-mobile, panda-ev-notification  
**Namespace**: `panda-ev-prod`

---

## ສາລະບານ

1. [ບັນຫາທີ 1 — JTI Replay Bug (RabbitMQ Fanout)](#1-jti-replay-bug)
2. [ໄຟລ໌ທີ່ແກ້ໄຂ](#2-ໄຟລ໌ທີ່ແກ້ໄຂ)
3. [ຂັ້ນຕອນ Deploy](#3-ຂັ້ນຕອນ-deploy)
4. [ບັນຫາທີ 2 — Mobile Deploy Pending (OOM)](#4-mobile-deploy-pending)
5. [ການກວດ Logs ຫຼັງ Deploy](#5-ກວດ-logs)
6. [ທົດສອບ OCPP Commands via CSMS](#6-ທົດສອບ-ocpp-commands)
7. [ສະຫຼຸບຜົນ](#7-ສະຫຼຸບ)

---

## 1. JTI Replay Bug

### ອາການ (Symptoms)

- OCPP publish `transaction.started` / `transaction.stopped` ໄປ fanout exchange `PANDA_EV_OCPP_EVENTS_FX`
- Mobile API ຖິ້ມ message: `Replayed service token (jti=xxx) from "ocpp-csms"`
- Notification Service ຖິ້ມ message ດຽວກັນ
- ຜົນ: Mobile ບໍ່ຮັບ OCPP events → session ບໍ່ complete, wallet ບໍ່ deduct

### Root Cause

OCPP ໃຊ້ **fanout exchange** — ສ້າງ `x-service-token` **ດຽວ** (jti ດຽວ) ແລ້ວ deliver ໃຫ້ 2 queues ພ້ອມກັນ:

```
OCPP publish → PANDA_EV_OCPP_EVENTS_FX (fanout)
                    ├── PANDA_EV_QUEUE        → Mobile API
                    └── PANDA_EV_QUEUE_NOTI   → Notification Service
```

Redis jti blacklist key ເກົ່າ (ຜິດ):
```
svc:jti:{jti}   ← shared ທຸກ service ໃຊ້ key ດຽວກັນ
```

**ລຳດັບ error**:
1. Mobile API verify token ກ່ອນ → store `svc:jti:abc123` ໃນ Redis (TTL 360s)
2. Notification Service verify token ດຽວກັນ → ພົບ `svc:jti:abc123` ຢູ່ Redis ແລ້ວ → **REJECTED** "Replayed"
3. ຫຼືກັບກັນ — ຂຶ້ນກັບ service ໃດ verify ກ່ອນ

### Fix

ປ່ຽນ Redis key ໃຫ້ **namespace ດ້ວຍ serviceName** ເພື່ອໃຫ້ແຕ່ລະ service ມີ jti blacklist ຂອງຕົນເອງ:

```typescript
// ກ່ອນ fix (ຜິດ)
const jtiKey = `svc:jti:${payload.jti}`;

// ຫຼັງ fix (ຖືກ)
const jtiKey = `svc:jti:${this.serviceName}:${payload.jti}`;
```

ຜົນ:
- Mobile API ເກັບ: `svc:jti:mobile-api:abc123`
- Notification ເກັບ: `svc:jti:notification-api:abc123`
- ທັງ 2 service ຮັບ message ດຽວກັນໄດ້ໂດຍບໍ່ conflict

---

## 2. ໄຟລ໌ທີ່ແກ້ໄຂ

ແກ້ໄຂ **4 ໄຟລ໌** — ທຸກ service ທີ່ implement `ServiceJwtService`:

| Service | ໄຟລ໌ | Line |
|---|---|---|
| panda-ev-ocpp | `src/common/service-auth/service-jwt.service.ts` | 293 |
| panda-ev-csms-system-admin | `src/common/service-auth/service-jwt.service.ts` | 290 |
| panda-ev-client-mobile | `src/common/service-auth/service-jwt.service.ts` | 288 |
| panda-ev-notification | `src/common/service-auth/service-jwt.service.ts` | 290 |

### Code ທີ່ແກ້ໄຂ (ຄືກັນທຸກໄຟລ໌)

```typescript
// ຊອກຫາ block ນີ້ໃນ verify() method:
if (payload.jti) {
  // ກ່ອນ:
  const jtiKey = `svc:jti:${payload.jti}`;
  // ຫຼັງ:
  const jtiKey = `svc:jti:${this.serviceName}:${payload.jti}`;
  const alreadySeen = await this.redis.get(jtiKey);
  if (alreadySeen) {
    this.logger.warn(`Replayed service token ...`);
    return null;
  }
  await this.redis.set(jtiKey, '1', this.JTI_BLACKLIST_TTL_S);
}
```

---

## 3. ຂັ້ນຕອນ Deploy

### 3.1 Commit ແຕ່ລະ service

```bash
# OCPP
cd panda-ev-ocpp
git add src/common/service-auth/service-jwt.service.ts
git commit -m "fix: scope jti blacklist key to service name to prevent fanout replay rejection"
git push origin HEAD

# Admin
cd panda-ev-csms-system-admin
git add src/common/service-auth/service-jwt.service.ts
git commit -m "fix: scope jti blacklist key to service name to prevent fanout replay rejection"
git push origin HEAD

# Mobile
cd panda-ev-client-mobile
git add src/common/service-auth/service-jwt.service.ts
git commit -m "fix: scope jti blacklist key to service name to prevent fanout replay rejection"
git push origin HEAD

# Notification
cd panda-ev-notification
git add src/common/service-auth/service-jwt.service.ts
git commit -m "fix: scope jti blacklist key to service name to prevent fanout replay rejection"
git push origin HEAD
```

### 3.2 Merge ໄປ main/develop

ຫຼັງ push ໄປ feature branch ຕ້ອງ merge ໄປ `main` ຫຼື `develop` ເພື່ອໃຫ້ GitHub Actions trigger deploy ອັດຕະໂນມັດ.

Workflows trigger condition:
```yaml
on:
  push:
    branches:
      - main
      - develop
```

---

## 4. Mobile Deploy Pending

### ອາການ

ຫຼັງ merge + deploy, pod ໃໝ່ `panda-mobile-api` ຢູ່ໃນ `Pending` ນານກວ່າ 10 ນາທີ.

### ຄຳສັ່ງກວດ

```bash
# ກວດ pods
kubectl get pods -n panda-ev-prod

# ຜົນ:
# panda-mobile-api-569557f674-mj87k   0/3   Pending   0   10m
# panda-mobile-api-b79996666-dcjhk    3/3   Running   0   143m
# panda-mobile-api-b79996666-f97jt    3/3   Running   0   143m

# ກວດ pod events
kubectl describe pod panda-mobile-api-569557f674-mj87k -n panda-ev-prod
```

### Root Cause

```
Warning  FailedScheduling   0/2 nodes are available: 2 Insufficient memory.
Warning  FailedScaleUp      Node scale up failed: GCE quota exceeded.
```

- Nodes ທັງ 2 ມີ memory allocated 98% ແລ້ວ
- Deployment strategy `maxSurge: 1, maxUnavailable: 0` → K8s ສ້າງ pod ໃໝ່ **ກ່ອນ** ລຶບ pod ເກົ່າ
- ບໍ່ມີ memory ພໍສຳລັບ pod ທີ 3
- Cluster autoscaler ພະຍາຍາມ add node ແຕ່ **GCE quota ໝົດ**

### Node resource ທີ່ເວລານັ້ນ

```bash
kubectl describe nodes | grep -A5 "Allocated resources"
# Node 1: cpu 88%, memory 98%
# Node 2: cpu 92%, memory 98%
```

### Fix

ປ່ຽນ strategy ໃຫ້ **ລຶບ pod ເກົ່າກ່ອນ** ຈຶ່ງ schedule ໃໝ່:

```bash
# Patch cluster ທັນທີ (ບໍ່ຕ້ອງລໍ CI/CD)
kubectl patch deployment panda-mobile-api -n panda-ev-prod --type='json' \
  -p='[
    {"op":"replace","path":"/spec/strategy/rollingUpdate/maxSurge","value":0},
    {"op":"replace","path":"/spec/strategy/rollingUpdate/maxUnavailable","value":1}
  ]'
```

ແກ້ໄຂ `kubernetes/services/panda-ev-client-mobile/base/deployment.yaml`:

```yaml
# ກ່ອນ (ຜິດ)
strategy:
  type: RollingUpdate
  rollingUpdate:
    maxSurge: 1
    maxUnavailable: 0

# ຫຼັງ (ຖືກ)
strategy:
  type: RollingUpdate
  rollingUpdate:
    maxSurge: 0
    maxUnavailable: 1
```

### ອະທິບາຍ maxSurge vs maxUnavailable

| Setting | ຄວາມໝາຍ | ໃຊ້ເມື່ອ |
|---|---|---|
| `maxSurge: 1, maxUnavailable: 0` | ສ້າງ pod ໃໝ່ກ່ອນ ຈຶ່ງລຶບເກົ່າ | Nodes ມີ resource ເຫຼືອ |
| `maxSurge: 0, maxUnavailable: 1` | ລຶບ pod ເກົ່າກ່ອນ ຈຶ່ງ schedule ໃໝ່ | **Nodes memory tight (ກໍລະນີນີ້)** |

### ຜົນຫຼັງ patch

```bash
kubectl get pods -n panda-ev-prod -l app=panda-mobile-api

# ຜົນ:
# panda-mobile-api-569557f674-65cw9   3/3   Running   0   100s  ✅
# panda-mobile-api-569557f674-mj87k   3/3   Running   0   15m   ✅
```

---

## 5. ກວດ Logs ຫຼັງ Deploy

### ຄຳສັ່ງກວດ logs

```bash
# ກວດ jti replay error (ຄວນຫວ່າງ)
kubectl logs -n panda-ev-prod -l app=panda-ocpp-api --since=10m | grep "Replayed"
kubectl logs -n panda-ev-prod -l app=panda-mobile-api --since=10m | grep "Replayed"
kubectl logs -n panda-ev-prod -l app=panda-notification-api --since=10m | grep "Replayed"

# ກວດ RabbitMQ consumers startup
kubectl logs -n panda-ev-prod -l app=panda-mobile-api --tail=50 | grep -E "RabbitMQ|Consumer"
kubectl logs -n panda-ev-prod -l app=panda-notification-api --tail=50 | grep -E "RabbitMQ|Consumer"
```

### ຜົນ logs ທີ່ດີ (ຫຼັງ fix)

**Mobile API** — ຮັບ OCPP events ປົກກະຕິ:
```
[OcppConsumerService] Session 1c9b5bd6... completed — 10.517 kWh, 31551 LAK deducted
[OcppConsumerService] Auto-generated invoice INV-20260427-0001
[OcppConsumerService] Session 0f6e6946... linked to OCPP txId 55, meterStart=0 Wh
[OcppConsumerService] Session 0f6e6946... completed — 18.001 kWh, 54003 LAK deducted
```

**Notification Service** — consumers ທຸກ queue online:
```
[RabbitMQService] Consuming queue "PANDA_EV_SMS" with DLQ support
[RabbitMQService] Consuming queue "PANDA_EV_NOTIFICATIONS" with DLQ support
[RabbitMQService] Consuming queue (with service auth): PANDA_EV_QUEUE_NOTI
[FcmService] FCM send complete: sent=3, failed=4
```

**Admin** — ຮັບ OCPP status sync:
```
[OcppStatusConsumerService] [OCPP-SYNC] PANDA-DONGNASOK-01 connector 1 → AVAILABLE
[OcppStatusConsumerService] [OCPP-SYNC] PANDA-DONGNASOK-01 → OFFLINE
```

---

## 6. ທົດສອບ OCPP Commands

### ການ Setup ກ່ອນ Test

ຕ້ອງການ charger online — ໃຊ້ Virtual Charge Point (VCP):

```bash
# ໃນ ocpp-virtual-charge-point directory
npm start index_16.ts
# ຈະ connect ໄປ ws://35.240.145.241/ocpp ດ້ວຍ chargePointId ທີ່ config
```

ກວດ VCP connect:
```bash
kubectl logs -n panda-ev-prod -l app=panda-ocpp-api --since=2m | grep "DONGNASOK-02"

# ຜົນ:
# [OcppGateway] Connected: PANDA-DONGNASOK-02 (total: 1)
# [OcppService] Charger marked ONLINE: PANDA-DONGNASOK-02
# [OcppGateway] BootNotification accepted: PANDA-DONGNASOK-02
# [OcppService] StatusNotification: PANDA-DONGNASOK-02 connector 1 → Available
```

### Step 1: Login ດຶງ Token

```bash
TOKEN=$(curl -s -X POST http://admin-api.pandaev.cc/api/admin/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@pandaev.com","password":"Admin@123456"}' \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['data']['accessToken'])")

echo "Token length: ${#TOKEN}"
```

### Step 2: ຫາ Charger ID

```bash
curl -s "http://admin-api.pandaev.cc/api/admin/v1/stations?limit=10" \
  -H "Authorization: Bearer $TOKEN" | python3 -c "
import json,sys
for s in json.load(sys.stdin).get('data',[]):
    for c in s.get('chargers',[]):
        print(f\"id={c['id']} | identity={c['ocppIdentity']} | status={c.get('liveStatus') or c['status']}\")
"
```

**PANDA-DONGNASOK-02:**
```
charger_id = d794a6ce-8b42-42ba-9ac3-3e1de9505f18
identity   = PANDA-DONGNASOK-02
station    = Panda EV — Dongnasok
```

### Step 3: ທົດສອບ GetConfiguration

```bash
CHARGER_ID="d794a6ce-8b42-42ba-9ac3-3e1de9505f18"

# ສົ່ງ command
curl -s -X POST \
  "http://admin-api.pandaev.cc/api/admin/v1/chargers/${CHARGER_ID}/commands/get-configuration" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}'
```

**ຜົນ dispatch:**
```json
{
  "commandId": "14468d14-92ec-4180-bb22-8d9a561ad01a",
  "message": "Command dispatched to charger"
}
```

```bash
# Poll result (ລໍຖ້າ 5 ວິ)
sleep 5
curl -s "http://admin-api.pandaev.cc/api/admin/v1/chargers/${CHARGER_ID}/commands/14468d14-92ec-4180-bb22-8d9a561ad01a/result" \
  -H "Authorization: Bearer $TOKEN"
```

**ຜົນ result:**
```json
{
  "commandId": "14468d14-92ec-4180-bb22-8d9a561ad01a",
  "status": "success",
  "result": {
    "configurationKey": [
      { "key": "SupportedFeatureProfiles", "readonly": true,  "value": "Core,FirmwareManagement,LocalAuthListManagement,Reservation,SmartCharging,RemoteTrigger" },
      { "key": "ChargeProfileMaxStackLevel", "readonly": true,  "value": "99" },
      { "key": "HeartbeatInterval",          "readonly": false, "value": "300" },
      { "key": "GetConfigurationMaxKeys",    "readonly": true,  "value": "99" }
    ],
    "unknownKey": []
  },
  "executedAt": "2026-04-27T17:09:18.007+07:00"
}
```

### Step 4: ທົດສອບ ChangeAvailability (Inoperative)

```bash
# Disable connector 1
curl -s -X POST \
  "http://admin-api.pandaev.cc/api/admin/v1/chargers/${CHARGER_ID}/commands/change-availability" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"connectorId":1,"type":"Inoperative"}'
```

**ຜົນ:**
```json
{
  "status": "success",
  "result": { "status": "Accepted" },
  "executedAt": "2026-04-27T17:11:10.385+07:00"
}
```

### Step 5: ທົດສອບ ChangeAvailability (Operative)

```bash
# Re-enable connector 1
curl -s -X POST \
  "http://admin-api.pandaev.cc/api/admin/v1/chargers/${CHARGER_ID}/commands/change-availability" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"connectorId":1,"type":"Operative"}'
```

**ຜົນ:** `status: "success"` → `{ "status": "Accepted" }`

### Step 6: ທົດສອບ Reset (Soft)

```bash
curl -s -X POST \
  "http://admin-api.pandaev.cc/api/admin/v1/chargers/${CHARGER_ID}/commands/reset" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"type":"Soft"}'
```

**ຜົນ:** `status: "success"` → `{ "status": "Accepted" }`

### Command Endpoints ທັງໝົດ

| Command | Method + Path | Body |
|---|---|---|
| GetConfiguration | `POST .../commands/get-configuration` | `{}` |
| ChangeAvailability | `POST .../commands/change-availability` | `{"connectorId":1,"type":"Operative"\|"Inoperative"}` |
| Reset | `POST .../commands/reset` | `{"type":"Soft"\|"Hard"}` |
| ClearCache | `POST .../commands/clear-cache` | `{}` |
| UnlockConnector | `POST .../commands/unlock-connector` | `{"connectorId":1}` |
| ChangeConfiguration | `POST .../commands/change-configuration` | `{"key":"HeartbeatInterval","value":"60"}` |
| TriggerMessage | `POST .../commands/trigger-message` | `{"requestedMessage":"StatusNotification"}` |
| GetDiagnostics | `POST .../commands/get-diagnostics` | `{"location":"ftp://server/diag"}` |
| UpdateFirmware | `POST .../commands/update-firmware` | `{"location":"http://server/fw.bin","retrieveDate":"2026-04-27T18:00:00Z"}` |
| ReserveNow | `POST .../commands/reserve-now` | `{"connectorId":1,"expiryDate":"...","idTag":"user-tag","reservationId":1}` |
| CancelReservation | `POST .../commands/cancel-reservation` | `{"reservationId":1}` |
| SendLocalList | `POST .../commands/local-list` | `{"listVersion":1,"updateType":"Full","localAuthorizationList":[]}` |
| GetLocalListVersion | `POST .../commands/local-list-version` | `{}` |
| SetChargingProfile | `POST .../commands/set-charging-profile` | `{"connectorId":1,"csChargingProfiles":{...}}` |
| ClearChargingProfile | `POST .../commands/clear-charging-profile` | `{}` |
| GetCompositeSchedule | `POST .../commands/composite-schedule` | `{"connectorId":1,"duration":3600}` |
| **Poll result** | `GET .../commands/:commandId/result` | — |

URL prefix: `http://admin-api.pandaev.cc/api/admin/v1/chargers/{chargerId}`

---

## 7. ສະຫຼຸບ

### Bugs ທີ່ແກ້ໄຂ

| # | Bug | Root Cause | Fix |
|---|---|---|---|
| 1 | RabbitMQ fanout → Mobile/Notification reject messages | jti Redis key ບໍ່ namespace → shared → replay false positive | `svc:jti:${serviceName}:${jti}` |
| 2 | Mobile deploy Pending ຍາວ | `maxSurge:1` + nodes 98% memory + GCE quota ໝົດ | `maxSurge:0, maxUnavailable:1` |

### ຜົນ Test OCPP Commands

| Command | Result |
|---|---|
| GetConfiguration | ✅ `success` — 4 config keys |
| ChangeAvailability Inoperative | ✅ `success` — `Accepted` |
| ChangeAvailability Operative | ✅ `success` — `Accepted` |
| Reset Soft | ✅ `success` — `Accepted` |

### Services Deploy Status ຫຼັງ Fix

```bash
kubectl get pods -n panda-ev-prod

# ຜົນ:
# panda-gateway-api-*         2/2   Running   ✅
# panda-mobile-api-*          3/3   Running   ✅  (x2 pods)
# panda-notification-api-*    2/2   Running   ✅  (x2 pods)
# panda-ocpp-api-*            3/3   Running   ✅
# panda-system-api-*          3/3   Running   ✅  (x2 pods)
# panda-rabbitmq-0            1/1   Running   ✅
```

### Command ທີ່ໃຊ້ Debug

```bash
# ກວດ pods ທັງໝົດ
kubectl get pods -n panda-ev-prod

# ກວດ pod ສະເພາະ (ຫາ error)
kubectl describe pod <pod-name> -n panda-ev-prod

# ກວດ logs service
kubectl logs -n panda-ev-prod -l app=panda-ocpp-api --since=10m
kubectl logs -n panda-ev-prod -l app=panda-mobile-api --tail=50
kubectl logs -n panda-ev-prod -l app=panda-notification-api --tail=50
kubectl logs -n panda-ev-prod -l app=panda-system-api --tail=30

# ກວດ node resources
kubectl describe nodes | grep -A5 "Allocated resources"

# Patch deployment strategy ທັນທີ (ບໍ່ຕ້ອງ CI/CD)
kubectl patch deployment <deployment-name> -n panda-ev-prod --type='json' \
  -p='[{"op":"replace","path":"/spec/strategy/rollingUpdate/maxSurge","value":0},
       {"op":"replace","path":"/spec/strategy/rollingUpdate/maxUnavailable","value":1}]'
```

---

*ບັນທຶກໂດຍ Claude Code — 2026-04-27*
