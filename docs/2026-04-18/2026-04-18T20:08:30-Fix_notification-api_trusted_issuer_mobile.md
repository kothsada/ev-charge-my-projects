# ແກ້ໄຂບັນຫາ: Mobile API + ການ Deploy Production

**ວັນທີ:** 2026-04-18 / 2026-04-19
**ຜູ້ດຳເນີນການ:** kothsada
**ສະຖານະ:** ✅ ສຳເລັດທຸກຢ່າງ — ທຸກ pod Running

---

## ພາບລວມບັນຫາທີ່ພົບ (Problem Overview)

ໃນ session ນີ້ ພົບ 3 ບັນຫາຕໍ່ກັນ ດັ່ງນີ້:

| # | ບັນຫາ | ສະຖານທີ່ | ສາເຫດ |
|---|---|---|---|
| 1 | `No trusted key for issuer "notification-api"` | Mobile API log | ຂາດ `notification-api` ໃນ trusted issuers |
| 2 | `CreateContainerConfigError` — pod start ບໍ່ໄດ້ | Mobile API pod | Secret ຂາດ key `NOTI_DATABASE_URL` |
| 3 | `NotiDbService password authentication failed` | Mobile API log | `NOTI_DATABASE_URL` ໃຊ້ port ຜິດ — Cloud SQL instance ຄະນະ |

---

## ບັນຫາທີ 1: `notification-api` ບໍ່ຢູ່ໃນ Trusted Issuers

### ອາການ (Symptoms)

```
WARN [ServiceJwtService] No trusted key for issuer "notification-api" — token rejected
WARN [RabbitMQService] Rejected unauthenticated/invalid message from queue "PANDA_EV_FCM_CLEANUP" — discarding
```

### ສາເຫດ (Root Cause)

Notification Service publish message ໄປ `PANDA_EV_FCM_CLEANUP` ໂດຍ sign ດ້ວຍ RS256 JWT issuer `notification-api`. Mobile API (ຜູ້ consume) ບໍ່ມີ public key ຂອງ `notification-api` ໃນລາຍການ trusted issuers ທັງ `.env` ແລະ `create-secret.sh`.

ຜົນກະທົບ:
- `FcmService.handleStaleTokenCleanup()` ບໍ່ຖືກເອີ້ນໃຊ້ເລີຍ
- FCM token ທີ່ expired ສະສົມໃນ `user_devices` table
- Notification service ສົ່ງ push ໄປ token ທີ່ dead ຊ້ຳຮ້ອຍ

### Audit: Trust Matrix ກ່ອນແກ້ໄຂ

ກວດທຸກ `create-secret.sh` ພົບ 2 service ທີ່ຂາດ `notification-api`:

| Service | `create-secret.sh` TRUSTED_KEYS | `.env` TRUSTED_SERVICE_ISSUERS |
|---|---|---|
| **Admin** | ❌ ຂາດ `notification-api` | ❌ ຂາດ `notification-api`, `gateway-api` |
| **Mobile** | ❌ ຂາດ `notification-api` | ❌ ຂາດ `notification-api` |
| OCPP | ✅ ຖືກຕ້ອງ | ✅ |
| Notification | ✅ ຖືກຕ້ອງ | ✅ |
| Gateway | ✅ ຖືກຕ້ອງ | ✅ |

### ການແກ້ໄຂ — ໄຟລ໌ທີ່ແກ້ໄຂ

#### 1A. `panda-ev-client-mobile/.env`

```diff
- TRUSTED_SERVICE_ISSUERS=admin-api:admin,ocpp-csms:ocpp,gateway-api:gateway
+ TRUSTED_SERVICE_ISSUERS=admin-api:admin,ocpp-csms:ocpp,notification-api:notification,gateway-api:gateway
```

#### 1B. `panda-ev-client-mobile/create-secret.sh`

```diff
  OCPP_PUBLIC_KEY="$(b64 "$KEYS_DIR/ocpp.pub")"
+ NOTIFICATION_PUBLIC_KEY="$(b64 "$KEYS_DIR/notification.pub")"
  GATEWAY_PUBLIC_KEY="$(b64 "$KEYS_DIR/gateway.pub")"

- TRUSTED_KEYS="[{"iss":"admin-api",...},{"iss":"ocpp-csms",...},{"iss":"gateway-api",...}]"
+ TRUSTED_KEYS="[{"iss":"admin-api",...},{"iss":"ocpp-csms",...},{"iss":"notification-api","key":"${NOTIFICATION_PUBLIC_KEY}"},{"iss":"gateway-api",...}]"
```

#### 1C. `panda-ev-csms-system-admin/.env`

```diff
- TRUSTED_SERVICE_ISSUERS=mobile-api:mobile,ocpp-csms:ocpp
+ TRUSTED_SERVICE_ISSUERS=mobile-api:mobile,ocpp-csms:ocpp,notification-api:notification,gateway-api:gateway
```

#### 1D. `panda-ev-csms-system-admin/create-secret.sh`

```diff
  OCPP_PUBLIC_KEY="$(b64 "$KEYS_DIR/ocpp.pub")"
+ NOTIFICATION_PUBLIC_KEY="$(b64 "$KEYS_DIR/notification.pub")"
  GATEWAY_PUBLIC_KEY="$(b64 "$KEYS_DIR/gateway.pub")"

- TRUSTED_KEYS="[{"iss":"mobile-api",...},{"iss":"ocpp-csms",...},{"iss":"gateway-api",...}]"
+ TRUSTED_KEYS="[{"iss":"mobile-api",...},{"iss":"ocpp-csms",...},{"iss":"notification-api","key":"${NOTIFICATION_PUBLIC_KEY}"},{"iss":"gateway-api",...}]"
```

---

## ບັນຫາທີ 2: `CreateContainerConfigError` — Pod Start ບໍ່ໄດ້

### ອາການ

```
kubectl get pods -n panda-ev-prod
NAME                              READY   STATUS                       RESTARTS   AGE
panda-mobile-api-7d7b88c58d-b9z49  2/3   CreateContainerConfigError     0        4m19s
```

```
kubectl describe pod panda-mobile-api-7d7b88c58d-b9z49 -n panda-ev-prod
...
Warning  Failed  Error: couldn't find key NOTI_DATABASE_URL in Secret panda-ev-prod/panda-mobile-api-secrets
```

### ສາເຫດ

`deployment.yaml` ໄດ້ຮັບ `NOTI_DATABASE_URL` ເປັນ env var ແລ້ວ (ຈາກ secret) ແຕ່ `create-secret.sh` ໄດ້ຮັບ `NOTI_DATABASE_URL` ເພີ່ມໃໝ່ ແຕ່ secret ໃນ K8s ຍັງ version ເກົ່າ (ຍັງບໍ່ໄດ້ re-create).

### ການແກ້ໄຂ

Re-create secret ໂດຍ run `create-secret.sh`:

```bash
# ກວດ key files ກ່ອນ
ls -la panda-ev-client-mobile/keys/
# ຕ້ອງເຫັນ: notification.pub, admin.pub, ocpp.pub, gateway.pub, mobile.pem, mobile.pub

# ໄປ mobile directory ແລ້ວ run
cd panda-ev-client-mobile
./create-secret.sh panda-ev-prod
```

**Output ທີ່ຖືກຕ້ອງ:**
```
secret "panda-mobile-api-secrets" deleted from panda-ev-prod namespace
secret/panda-mobile-api-secrets created
secret "panda-rabbitmq-prod-secrets" deleted from panda-ev-prod namespace
secret/panda-rabbitmq-prod-secrets created
```

**ກວດ rollout:**
```bash
kubectl rollout status deployment/panda-mobile-api -n panda-ev-prod --timeout=120s
# deployment "panda-mobile-api" successfully rolled out
```

---

## ບັນຫາທີ 3: `NotiDbService password authentication failed`

### ອາການ

```
WARN [NotiDbService] Noti DB connection failed — notification history disabled:
     password authentication failed for user "panda_noti_user"
```

### ສາເຫດ — Cloud SQL Instance ຄະນະ

ຕ້ອງເຂົ້າໃຈ architecture ຂອງ Cloud SQL proxy ໃນ mobile pod:

```
Mobile API Pod (3 containers)
├── panda-mobile-api (app)
├── cloud-sql-proxy-master  → port 5432 → panda-ev-instance-mobile-db-a2  (MOBILE instance)
│                              port 5434 → panda-ev-instance-system-db-a2  (SYSTEM instance)
└── cloud-sql-proxy-replica → port 5433 → panda-ev-instance-mobile-db-a2-replica

Notification Pod (2 containers)
├── panda-notification-api (app)
└── cloud-sql-proxy → port 5432 → panda-ev-instance-core-db-a2  (CORE instance)
```

**`NOTI_DATABASE_URL` ເດີມໃຊ້ port 5432** → mobile proxy port 5432 → MOBILE instance

ແຕ່ `panda_ev_core` database (ທີ່ `panda_ev_noti` schema ຢູ່) ແມ່ນຢູ່ **CORE instance** (`panda-ev-instance-core-db-a2`) ບໍ່ແມ່ນ MOBILE instance!

ສະນັ້ນ `panda_noti_user` ຢູ່ CORE instance ແຕ່ mobile pod ບໍ່ໄດ້ proxy CORE instance ໄວ້ → authentication ລົ້ມເຫຼວ.

### Port Map ທີ່ຖືກຕ້ອງ (ຫຼັງແກ້ໄຂ)

| Port | Cloud SQL Instance | Database | ໃຊ້ໂດຍ |
|---|---|---|---|
| 5432 | `panda-ev-instance-mobile-db-a2` | `panda_ev_mobile` | `DATABASE_URL` |
| 5433 | `panda-ev-instance-mobile-db-a2-replica` | `panda_ev_mobile` | `DATABASE_REPLICA_URL` |
| 5434 | `panda-ev-instance-system-db-a2` | `panda_ev_system` | `SYSTEM_DATABASE_URL` |
| **5435** | **`panda-ev-instance-core-db-a2`** | **`panda_ev_core`** | **`NOTI_DATABASE_URL`** ✅ ເພີ່ມໃໝ່ |

### ການແກ້ໄຂ — ໄຟລ໌ທີ່ແກ້ໄຂ

#### 3A. `panda-ev-client-mobile/k8s/overlays/prod/kustomization.yaml`

ເພີ່ມ CORE instance ເຂົ້າ `cloud-sql-proxy-master` args:

```diff
  value:
    - "--structured-logs"
    - "--port=5432"
    - "--private-ip"
    - "--health-check"
    - "--http-address=0.0.0.0"
    - "pandaev:asia-southeast1:panda-ev-instance-mobile-db-a2"
    - "pandaev:asia-southeast1:panda-ev-instance-system-db-a2?port=5434"
+   - "pandaev:asia-southeast1:panda-ev-instance-core-db-a2?port=5435"
```

#### 3B. `panda-ev-client-mobile/create-secret.sh`

ປ່ຽນ port ຈາກ 5432 → 5435:

```diff
- NOTI_DATABASE_URL="postgresql://panda_noti_user:${NOTI_DB_PASS}@127.0.0.1:5432/panda_ev_core?schema=panda_ev_noti&..."
+ NOTI_DATABASE_URL="postgresql://panda_noti_user:${NOTI_DB_PASS}@127.0.0.1:5435/panda_ev_core?schema=panda_ev_noti&..."
```

---

## ຄຳສັ່ງທັງໝົດທີ່ Run (All Commands Executed)

### ຂັ້ນຕອນທີ 1: ກວດສອບ cluster ແລະ pod status

```bash
kubectl get nodes -n panda-ev-prod
kubectl get pods -n panda-ev-prod
```

### ຂັ້ນຕອນທີ 2: ກວດສອບ pod ທີ່ error

```bash
kubectl describe pod panda-mobile-api-7d7b88c58d-b9z49 -n panda-ev-prod
# → ພົບ: couldn't find key NOTI_DATABASE_URL in Secret
```

### ຂັ້ນຕອນທີ 3: ກວດ key files

```bash
ls -la panda-ev-client-mobile/keys/
# ພົບ: notification.pub ມີຢູ່ ✅
```

### ຂັ້ນຕອນທີ 4: Re-create secret (ບັນຫາທີ 1 + 2 ທັງສອງ)

```bash
cd panda-ev-client-mobile
./create-secret.sh panda-ev-prod
```

### ຂັ້ນຕອນທີ 5: ກວດ rollout ຫຼັງ secret ໃໝ່

```bash
kubectl rollout status deployment/panda-mobile-api -n panda-ev-prod --timeout=120s
# → deployment "panda-mobile-api" successfully rolled out
```

### ຂັ້ນຕອນທີ 6: ກວດ log — ພົບ NotiDb ບັນຫາ

```bash
kubectl logs -n panda-ev-prod -l app=panda-mobile-api --tail=20 \
  | grep -E "WARN|ERROR|NotiDb|FCM_CLEANUP|started"
# → WARN [NotiDbService] password authentication failed for user "panda_noti_user"
```

### ຂັ້ນຕອນທີ 7: ຄົ້ນຫາ Cloud SQL instance ຂອງ notification pod

```bash
kubectl get deployment panda-notification-api -n panda-ev-prod \
  -o jsonpath='{.spec.template.spec.containers[*].args}'
# → ພົບ: panda-ev-instance-core-db-a2 (CORE instance ຄະນະ!)
```

### ຂັ້ນຕອນທີ 8: ກວດ mobile pod proxy config

```bash
kubectl get deployment panda-mobile-api -n panda-ev-prod \
  -o jsonpath='{.spec.template.spec.containers[*].name}'
# → panda-mobile-api cloud-sql-proxy-master cloud-sql-proxy-replica

# ອ່ານ kustomization.yaml ກວດ args ຂອງ cloud-sql-proxy-master
# → port 5432 = mobile-db, port 5434 = system-db (ບໍ່ມີ core-db!)
```

### ຂັ້ນຕອນທີ 9: Re-create secret ດ້ວຍ port 5435

```bash
cd panda-ev-client-mobile
./create-secret.sh panda-ev-prod
```

### ຂັ້ນຕອນທີ 10: Apply k8s overlay ດ້ວຍ proxy ໃໝ່ (port 5435)

```bash
kubectl apply -k k8s/overlays/prod
# → deployment.apps/panda-mobile-api configured
```

### ຂັ້ນຕອນທີ 11: ລໍຖ້າ rollout ສຳເລັດ

```bash
kubectl rollout status deployment/panda-mobile-api -n panda-ev-prod --timeout=180s
# → deployment "panda-mobile-api" successfully rolled out
```

### ຂັ້ນຕອນທີ 12: ກວດ final status

```bash
kubectl get pods -n panda-ev-prod
kubectl logs -n panda-ev-prod -l app=panda-mobile-api --tail=15 \
  | grep -E "WARN|ERROR|NotiDb|FCM_CLEANUP|started on port"
```

---

## ຜົນລັບສຸດທ້າຍ (Final Result)

### Pod Status

```
NAME                                      READY   STATUS    RESTARTS   AGE
panda-gateway-api-5c9b4c85f9-bj65n        2/2     Running   0          30h
panda-gateway-api-5c9b4c85f9-fxmv7        2/2     Running   0          30h
panda-mobile-api-df8755d57-n8lbg          3/3     Running   0          66s  ✅
panda-mobile-api-df8755d57-w95hg          3/3     Running   0          45s  ✅
panda-notification-api-7f7566678f-brvx2   2/2     Running   0          7h
panda-notification-api-7f7566678f-knlbr   2/2     Running   0          7h
panda-ocpp-api-87f8fd6b-cmqg5             3/3     Running   0          9h
panda-rabbitmq-0                          1/1     Running   0          33h
panda-system-api-7c59cbcc94-qfwbt         2/2     Running   0          16m
panda-system-api-7c59cbcc94-tn994         2/2     Running   0          15m
```

### Mobile API Log (ສຸດທ້າຍ)

```
LOG [NotiDbService] Noti DB connected                          ✅ ເຊື່ອມ panda_ev_noti ໄດ້
LOG [bootstrap] Application successfully started on port 4001  ✅
LOG [RabbitMQService] Consuming queue (with service auth): PANDA_EV_FCM_CLEANUP  ✅ ບໍ່ reject ອີກ
```

### Warning ທີ່ຫາຍໄປ (ຫຼັງແກ້ໄຂ)

```
❌ ບໍ່ເຫັນອີກ: WARN [ServiceJwtService] No trusted key for issuer "notification-api"
❌ ບໍ່ເຫັນອີກ: WARN [RabbitMQService] Rejected unauthenticated/invalid message from queue "PANDA_EV_FCM_CLEANUP"
❌ ບໍ່ເຫັນອີກ: WARN [NotiDbService] Noti DB connection failed — password authentication failed
```

---

## ສາຫຼຸບ Trust Matrix ທີ່ຖືກຕ້ອງ (ຫຼັງແກ້ໄຂ)

| Service | Trusts (TRUSTED_SERVICE_ISSUERS) |
|---|---|
| **Admin** | `mobile-api`, `ocpp-csms`, `notification-api` ✅, `gateway-api` ✅ |
| **Mobile** | `admin-api`, `ocpp-csms`, `notification-api` ✅, `gateway-api` |
| OCPP | `mobile-api`, `admin-api` |
| Notification | `mobile-api`, `admin-api`, `ocpp-csms` |
| Gateway | `admin-api`, `mobile-api` |

---

## ໄຟລ໌ທີ່ຖືກແກ້ໄຂທັງໝົດ (All Changed Files)

```
panda-ev-client-mobile/.env
panda-ev-client-mobile/create-secret.sh
panda-ev-client-mobile/k8s/overlays/prod/kustomization.yaml
panda-ev-csms-system-admin/.env
panda-ev-csms-system-admin/create-secret.sh
```
