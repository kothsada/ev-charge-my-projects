# ແກ້ໄຂບັນຫາ: Mobile API ປະຕິເສດ message ຈາກ Notification Service (PANDA_EV_FCM_CLEANUP) + ເພີ່ມ NOTI_DATABASE_URL

**ວັນທີ:** 2026-04-18  
**ຜູ້ດຳເນີນການ:** kothsada  
**ລະດັບຄວາມຮຸນແຮງ:** High — stale FCM token ບໍ່ຖືກລຶບ ເຮັດໃຫ້ push notification ລົ້ມເຫຼວຊ້ຳ

---

## 1. ອາການຂອງບັນຫາ (Symptoms)

ເຫັນ log ເຕືອນຢູ່ໃນ Mobile API pod:

```
[Nest] 1  - 04/18/2026, 12:43:11 PM    WARN [ServiceJwtService] No trusted key for issuer "notification-api" — token rejected
[Nest] 1  - 04/18/2026, 12:43:11 PM    WARN [RabbitMQService] Rejected unauthenticated/invalid message from queue "PANDA_EV_FCM_CLEANUP" — discarding
```

---

## 2. ສາເຫດ (Root Cause)

### ການໄຫຼຂອງຂໍ້ມູນ (Flow)

```
Notification Service
  └─► publish → PANDA_EV_FCM_CLEANUP
        (x-service-token signed by "notification-api" RS256 key)

Mobile API (FcmService)
  └─► consume PANDA_EV_FCM_CLEANUP
        └─► ServiceJwtService.verify(token)
              └─► ERROR: ບໍ່ມີ public key ສຳລັບ issuer "notification-api"
                    └─► discard message ທັງໝົດ
```

### ຜົນກະທົບ

- `FcmService.handleStaleTokenCleanup()` ບໍ່ຖືກເອີ້ນໃຊ້ເລີຍ
- FCM token ທີ່ expired/invalid ສະສົມຢູ່ໃນ `user_devices` table
- Notification Service ສົ່ງ push ໄປຫາ token ທີ່ dead ຊ້ຳແລ້ວຊ້ຳອີກ

### ສາເຫດຕົ້ນຕໍ

ໄຟລ໌ 2 ບ່ອນຂາດ `notification-api` ໃນລາຍການ trusted issuers:

| ໄຟລ໌ | ບັນຫາ |
|---|---|
| `panda-ev-client-mobile/.env` | `TRUSTED_SERVICE_ISSUERS` ຂາດ `notification-api:notification` |
| `panda-ev-client-mobile/create-secret.sh` | `TRUSTED_KEYS` JSON ຂາດ entry ສຳລັບ `notification-api` |

---

## 3. ການແກ້ໄຂທັງໝົດ (All File Changes)

### 3.1 Fix: `notification-api` Trusted Issuer

#### ແກ້ໄຂ `panda-ev-client-mobile/.env`

**ກ່ອນ:**
```env
TRUSTED_SERVICE_ISSUERS=admin-api:admin,ocpp-csms:ocpp,gateway-api:gateway
```

**ຫຼັງ:**
```env
TRUSTED_SERVICE_ISSUERS=admin-api:admin,ocpp-csms:ocpp,notification-api:notification,gateway-api:gateway
```

---

### 3.2 ເພີ່ມ `NOTI_DATABASE_URL` — Notification History API

Mobile API ຕ້ອງການ read notification logs ຈາກ `panda_ev_noti` schema ເພື່ອ serve `GET /api/mobile/v1/notifications`.

#### ສາຍເຊື່ອມຕໍ່

```
Mobile API pod (127.0.0.1:5432)
       │
  Cloud SQL Proxy  →  panda-ev-core-instance (ດຽວກັນກັບ DATABASE_URL)
       │
       ├─ DATABASE_URL      → /panda_ev_mobile  user: panda_mobile_user
       └─ NOTI_DATABASE_URL → /panda_ev_core    user: panda_noti_user  schema=panda_ev_noti
```

> **ໝາຍເຫດ:** ໃຊ້ port 5432 ດຽວກັນ — ຍ້ອນ `panda_ev_noti` ຢູ່ໃນ instance ດຽວກັນກັບ `panda_ev_mobile` (CORE instance). ບໍ່ມີ conflict ຍ້ອນ PostgreSQL ແຍກດ້ວຍ database name + user credentials.

#### Port Map ໃນ Pod

| Port | Cloud SQL Instance | ໃຊ້ໂດຍ |
|---|---|---|
| 5432 | CORE | `DATABASE_URL` (mobile schema) + `NOTI_DATABASE_URL` (noti schema) |
| 5433 | CORE replica | `DATABASE_REPLICA_URL` |
| 5434 | SYSTEM | `SYSTEM_DATABASE_URL` |

---

## 4. ສະຖານະໄຟລ໌ທີ່ຖືກແກ້ໄຂ (Final File State)

### `panda-ev-client-mobile/create-secret.sh` (ສະຖານະປັດຈຸບັນ)

```bash
#!/bin/bash
set -euo pipefail

NAMESPACE=${1:-""}
if [ -z "$NAMESPACE" ]; then echo "Usage: ./create-secret.sh <namespace>"; exit 1; fi

KEYS_DIR="$(cd "$(dirname "$0")" && pwd)/keys"
b64() { base64 < "$1" | tr -d '\n'; }

DB_PASS_VAL='Panda>2026>WriteMobile1234567890>'
DB_PASS_VAL_REPLICA='Panda>2026>ReadMobile1234567890>'
RABBITMQ_HOST="panda-rabbitmq.panda-ev-prod.svc.cluster.local"
RABBITMQ_PORT="5672"
RMQ_USER="user"
RMQ_PASS="PVndAi2026iR3PP1"
SYSTEM_DB_PASS='Panda>2026>Admin1234567890>'
NOTI_DB_PASS='Panda>2026>ReadNotification1234567890>'   # ເພີ່ມໃໝ່

MOBILE_PRIVATE_KEY="$(b64 "$KEYS_DIR/mobile.pem")"
MOBILE_PUBLIC_KEY="$(b64 "$KEYS_DIR/mobile.pub")"
ADMIN_PUBLIC_KEY="$(b64 "$KEYS_DIR/admin.pub")"
OCPP_PUBLIC_KEY="$(b64 "$KEYS_DIR/ocpp.pub")"
NOTIFICATION_PUBLIC_KEY="$(b64 "$KEYS_DIR/notification.pub")"   # ເພີ່ມໃໝ່
GATEWAY_PUBLIC_KEY="$(b64 "$KEYS_DIR/gateway.pub")"

# notification-api ເພີ່ມເຂົ້າ TRUSTED_KEYS
TRUSTED_KEYS="[{\"iss\":\"admin-api\",\"key\":\"${ADMIN_PUBLIC_KEY}\"},{\"iss\":\"ocpp-csms\",\"key\":\"${OCPP_PUBLIC_KEY}\"},{\"iss\":\"notification-api\",\"key\":\"${NOTIFICATION_PUBLIC_KEY}\"},{\"iss\":\"gateway-api\",\"key\":\"${GATEWAY_PUBLIC_KEY}\"}]"

kubectl delete secret panda-mobile-api-secrets --namespace=$NAMESPACE --ignore-not-found

kubectl create secret generic panda-mobile-api-secrets --namespace=$NAMESPACE \
  --from-literal=DATABASE_URL="postgresql://panda_mobile_user:${DB_PASS_VAL}@127.0.0.1:5432/panda_ev_mobile?schema=panda_ev_mobile&options=-c%20timezone%3DAsia%2FVientiane" \
  --from-literal=DATABASE_REPLICA_URL="postgresql://panda_mobile_reader:${DB_PASS_VAL_REPLICA}@127.0.0.1:5433/panda_ev_mobile?schema=panda_ev_mobile&options=-c%20timezone%3DAsia%2FVientiane" \
  --from-literal=JWT_PRIVATE_KEY="${MOBILE_PRIVATE_KEY}" \
  --from-literal=JWT_PUBLIC_KEY="${MOBILE_PUBLIC_KEY}" \
  --from-literal=SERVICE_JWT_PRIVATE_KEY="${MOBILE_PRIVATE_KEY}" \
  --from-literal=TRUSTED_SERVICE_PUBLIC_KEYS="${TRUSTED_KEYS}" \
  --from-literal=QR_SIGNING_SECRET="3a4ba26e58f4d22e09f40bced74f998d1fcf70820d050ed699e728fb4b940b56" \
  --from-literal=JWT_SECRET="${JWT_SECRET:-K0thsada90}" \
  --from-literal=JWT_REFRESH_SECRET="${JWT_REFRESH_SECRET:-K0thsada90_REFRESH}" \
  --from-literal=SYSTEM_DATABASE_URL="postgresql://panda_admin_user:${SYSTEM_DB_PASS}@127.0.0.1:5434/panda_ev_system?schema=panda_ev_system&options=-c%20timezone%3DAsia%2FVientiane" \
  --from-literal=NOTI_DATABASE_URL="postgresql://panda_noti_user:${NOTI_DB_PASS}@127.0.0.1:5432/panda_ev_core?schema=panda_ev_noti&options=-c%20timezone%3DAsia%2FVientiane" \   # ເພີ່ມໃໝ່
  --from-literal=SMTP_PASS="${SMTP_PASS:-re_Pf3ifXAz_CSUwKShVJJ4djQjB4UsYvGrm}"
```

### `panda-ev-client-mobile/k8s/base/deployment.yaml` (env section — ເພີ່ມໃໝ່)

```yaml
            - name: NOTI_DATABASE_URL
              valueFrom:
                secretKeyRef:
                  name: panda-mobile-api-secrets
                  key: NOTI_DATABASE_URL
```

ເພີ່ມຕໍ່ຈາກ `SYSTEM_DATABASE_URL` block.

---

## 5. ຂັ້ນຕອນ Deploy (Step-by-Step)

### ສຳລັບ Local Dev

ກວດສອບ key file ແລະ restart:

```bash
ls -la panda-ev-client-mobile/keys/notification.pub
# ຖ້າບໍ່ມີ: ./generate-service-keys-local.sh

cd panda-ev-client-mobile
npm run start:dev
```

### ສຳລັບ Kubernetes Production

```bash
# 1. ກວດ key
ls -la panda-ev-client-mobile/keys/notification.pub

# 2. Re-create secret (ລວມ NOTI_DATABASE_URL + notification-api trusted key)
cd panda-ev-client-mobile
./create-secret.sh panda-ev-prod

# 3. Apply deployment (NOTI_DATABASE_URL env var ໃໝ່)
kubectl apply -k k8s/overlays/prod

# 4. Restart pod
kubectl rollout restart deployment panda-mobile-api -n panda-ev-prod

# 5. ກວດ log
kubectl logs -n panda-ev-prod -l app=panda-mobile-api --tail=50 -f
```

**ຄວນເຫັນ** (ດີ):
```
[NotiDbService] Noti DB connected
[RabbitMQService] Consuming queue: PANDA_EV_FCM_CLEANUP
```

**ບໍ່ຄວນເຫັນອີກ**:
```
WARN [ServiceJwtService] No trusted key for issuer "notification-api"
WARN [RabbitMQService] Rejected unauthenticated/invalid message from queue "PANDA_EV_FCM_CLEANUP"
ERROR [NotiDbService] Noti DB operation failed
```

---

## 6. Trust Matrix ທີ່ຖືກຕ້ອງ (ຫຼັງແກ້ໄຂ)

| Service | Trusts (TRUSTED_SERVICE_ISSUERS) |
|---|---|
| **Mobile API** | `admin-api`, `ocpp-csms`, `notification-api` ✅, `gateway-api` |
| **Admin API** | `mobile-api`, `ocpp-csms`, `notification-api`, `gateway-api` |
| **OCPP CSMS** | `mobile-api`, `admin-api` |
| **Notification** | `mobile-api`, `admin-api`, `ocpp-csms` |
| **Gateway** | `admin-api`, `mobile-api` |

---

## 7. ໄຟລ໌ທີ່ຖືກແກ້ໄຂທັງໝົດ (Changed Files)

```
panda-ev-client-mobile/.env
panda-ev-client-mobile/create-secret.sh
panda-ev-client-mobile/k8s/base/deployment.yaml
panda-ev-client-mobile/src/configs/prisma/noti-db.service.ts       (ໃໝ່)
panda-ev-client-mobile/src/configs/prisma/prisma.module.ts
panda-ev-client-mobile/src/modules/notification/notification.module.ts    (ໃໝ່)
panda-ev-client-mobile/src/modules/notification/notification.controller.ts (ໃໝ່)
panda-ev-client-mobile/src/modules/notification/notification.service.ts    (ໃໝ່)
panda-ev-client-mobile/src/modules/notification/dto/query-notification.dto.ts (ໃໝ່)
panda-ev-client-mobile/src/app.module.ts
```
