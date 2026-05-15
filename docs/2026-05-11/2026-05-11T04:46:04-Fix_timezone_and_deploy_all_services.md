# ແກ້ໄຂ Timezone ແລະ Deploy ທຸກ Service

**ວັນທີ:** 2026-05-11  
**ຜູ້ດຳເນີນການ:** kothsada  
**Cluster:** `gke_pandaev_asia-southeast1_panda-ev-cluster`  
**Namespace:** `panda-ev-prod`

---

## ບັນຫາທີ 1 — Log ສະແດງເວລາຜິດ (UTC ແທນ Vientiane)

### ອາການ
NestJS logger ສະແດງເວລາເປັນ UTC (`23:32:16`) ທັງໆທີ່ Vientiane ຄວນສະແດງ `04:32:16 +07:00`

### ສາເຫດ
GKE node ໃຊ້ timezone UTC ໂດຍ default. Node.js ອ່ານ timezone ຈາກ environment ຂອງ container, ເຊິ່ງຖ້າບໍ່ຕັ້ງ `TZ` ໄວ້ ກໍຈະໃຊ້ UTC.

### ການແກ້ໄຂ
ເພີ່ມ `TZ=Asia/Vientiane` ເຂົ້າໃນ `env:` ຂອງ main container ທຸກ deployment:

| Service | File |
|---|---|
| Admin (CSMS) | `kubernetes/services/panda-ev-csms-system-admin/base/deployment.yaml` |
| Mobile | `kubernetes/services/panda-ev-client-mobile/base/deployment.yaml` |
| Notification | `kubernetes/services/panda-ev-notification/base/deployment.yaml` |
| OCPP | `kubernetes/services/panda-ocpp-api/base/deployment.yaml` |
| Gateway | `kubernetes/services/panda-ev-gateway-services/base/deployment.yaml` |

```yaml
env:
  - name: TZ
    value: Asia/Vientiane
  - name: DATABASE_URL
    ...
```

> **ໝາຍເຫດ:** `Asia/Vientiane` ແລະ `Asia/Bangkok` ແມ່ນ UTC+7 ຄືກັນ. Node.js ອ່ານ `TZ` ກ່ອນ `Date` call ໃດໆ ດັ່ງນັ້ນ NestJS logger ຈຶ່ງສະແດງ Vientiane time ທັນທີ.

---

## ການ Apply ຮອບທຳອິດ — ພົບ 3 ບັນຫາ

ຫຼັງຈາກ dry-run ຜ່ານທຸກ service, apply ຄັ້ງທຳອິດ:

```bash
kubectl apply -k services/<svc>/overlays/prod
```

**OCPP ແລະ Gateway** rollout ສຳເລັດທັນທີ.  
**Admin, Mobile, Notification** ຕິດ `CreateContainerConfigError`.

---

## ບັນຫາທີ 2 — Mobile: RABBITMQ_URL ຊີ້ໄປ Secret ຜິດ

### ສາເຫດ
`panda-ev-client-mobile/base/deployment.yaml` ອ້າງ `RABBITMQ_URL` ຈາກ `panda-mobile-api-secrets` ແຕ່ key ນີ້ບໍ່ມີຢູ່ໃນ secret ດັ່ງກ່າວ.

```
Error: couldn't find key RABBITMQ_URL in Secret panda-ev-prod/panda-mobile-api-secrets
```

### ການແກ້ໄຂ
ປ່ຽນໃຫ້ຊີ້ໄປ `panda-rabbitmq-prod-secrets` (ຄືກັນກັບ Admin ທຳຢູ່ແລ້ວ):

```yaml
# ກ່ອນ
- name: RABBITMQ_URL
  valueFrom:
    secretKeyRef:
      name: panda-mobile-api-secrets   # ❌ ບໍ່ມີ key ນີ້
      key: RABBITMQ_URL

# ຫຼັງ
- name: RABBITMQ_URL
  valueFrom:
    secretKeyRef:
      name: panda-rabbitmq-prod-secrets  # ✅
      key: RABBITMQ_URL
```

**File:** `kubernetes/services/panda-ev-client-mobile/base/deployment.yaml`

---

## ບັນຫາທີ 3 — Notification: RABBITMQ_URL ຊີ້ໄປ Secret ຜິດ

### ສາເຫດ
ຄືກັນກັບ Mobile — `panda-ev-notification/base/deployment.yaml` ອ້າງ `RABBITMQ_URL` ຈາກ `panda-notification-api-secrets` ແຕ່ key ນີ້ກໍບໍ່ມີ.

```
Error: couldn't find key RABBITMQ_URL in Secret panda-ev-prod/panda-notification-api-secrets
```

### ການແກ້ໄຂ
```yaml
# ກ່ອນ
- name: RABBITMQ_URL
  valueFrom:
    secretKeyRef:
      name: panda-notification-api-secrets  # ❌
      key: RABBITMQ_URL

# ຫຼັງ
- name: RABBITMQ_URL
  valueFrom:
    secretKeyRef:
      name: panda-rabbitmq-prod-secrets  # ✅
      key: RABBITMQ_URL
```

**File:** `kubernetes/services/panda-ev-notification/base/deployment.yaml`

---

## ບັນຫາທີ 4 — Admin: MOBILE_DATABASE_WRITE_URL ຂາດໃນ Secret + ຂາດ Sidecar

### ສາເຫດ
`panda-ev-csms-system-admin/base/deployment.yaml` ອ້າງ `MOBILE_DATABASE_WRITE_URL` ຈາກ `panda-system-api-secrets` ແຕ່ key ນີ້ຍັງບໍ່ໄດ້ເພີ່ມເຂົ້າ secret. ນອກຈາກນັ້ນ, `cloud-sql-proxy-mobile` sidecar (port 5434 → mobile DB) ທີ່ໃຊ້ເຊື່ອມຕໍ່ mobile database ໄດ້ຖືກລຶບອອກຈາກ prod overlay ໃນໄລຍະທີ່ຜ່ານມາ.

```
Error: couldn't find key MOBILE_DATABASE_WRITE_URL in Secret panda-ev-prod/panda-system-api-secrets
```

### `MOBILE_DATABASE_WRITE_URL` ໃຊ້ເຮັດຫຍັງ?
Admin service ມີ `core-db-write.service.ts` ທີ່ໃຊ້ `MOBILE_DATABASE_WRITE_URL` ສຳລັບ **wallet mutations** — admin ຕ້ອງ write ໄປ mobile database ໂດຍກົງ (ຕົວຢ່າງ: ເຕີມເງິນ, ປັບ balance).

### ການແກ້ໄຂ — ສ່ວນ Overlay

ເພີ່ມ `cloud-sql-proxy-mobile` sidecar ເຂົ້າໃນ `kubernetes/services/panda-ev-csms-system-admin/overlays/prod/kustomization.yaml`:

```yaml
# 2. ADD Mobile DB Proxy (Port 5434) for cross-service wallet mutations
- op: add
  path: /spec/template/spec/containers/-
  value:
    name: cloud-sql-proxy-mobile
    image: gcr.io/cloud-sql-connectors/cloud-sql-proxy:2.14.2
    args:
      - "--structured-logs"
      - "--port=5434"
      - "--private-ip"
      - "--health-check"
      - "--http-address=0.0.0.0"
      - "--http-port=9092"
      - "pandaev:asia-southeast1:panda-ev-instance-mobile-db-a2"
    securityContext:
      runAsNonRoot: true
      allowPrivilegeEscalation: false
    resources:
      requests:
        cpu: "50m"
        memory: "64Mi"
      limits:
        cpu: "200m"
        memory: "128Mi"
```

### ການແກ້ໄຂ — Patch Secret

`MOBILE_DATABASE_WRITE_URL` ໃຊ້ `panda_mobile_user` (write user) ເຊື່ອມຕໍ່ port 5434 (cloud-sql-proxy-mobile):

```bash
WRITE_URL="postgresql://panda_mobile_user:<PASSWORD>@127.0.0.1:5434/panda_ev_mobile?schema=panda_ev_mobile&options=-c%20timezone%3DAsia%2FVientiane"
ENCODED=$(echo -n "$WRITE_URL" | base64)
kubectl patch secret panda-system-api-secrets -n panda-ev-prod \
  --type='json' \
  -p="[{\"op\":\"add\",\"path\":\"/data/MOBILE_DATABASE_WRITE_URL\",\"value\":\"$ENCODED\"}]"
```

---

## Container Layout ຂອງ Admin Pod (ຫຼັງແກ້ໄຂ)

| Container | Port | Cloud SQL Instance |
|---|---|---|
| `panda-system-api` | 4000 | — (app) |
| `cloud-sql-proxy-master` | 5432 | `panda-ev-instance-system-db-a2` |
| `cloud-sql-proxy-mobile` | 5434 | `panda-ev-instance-mobile-db-a2` |

---

## ຜົນລັບສຸດທ້າຍ

```
panda-gateway-api-*          2/2   Running  ✅
panda-mobile-api-*           3/3   Running  ✅
panda-notification-api-*     2/2   Running  ✅
panda-ocpp-api-*             3/3   Running  ✅
panda-system-api-*           3/3   Running  ✅
```

ທຸກ service ຢູ່ໃນ namespace `panda-ev-prod` ໄດ້ rollout ສຳເລັດ. Log timestamp ຈະສະແດງ Vientiane time (UTC+7) ຫຼັງ restart.

---

## Files ທີ່ໄດ້ປ່ຽນແປງ

```
kubernetes/services/panda-ev-csms-system-admin/base/deployment.yaml         # +TZ env
kubernetes/services/panda-ev-csms-system-admin/overlays/prod/kustomization.yaml  # +cloud-sql-proxy-mobile sidecar
kubernetes/services/panda-ev-client-mobile/base/deployment.yaml              # +TZ env, fix RABBITMQ_URL secret ref
kubernetes/services/panda-ev-notification/base/deployment.yaml               # +TZ env, fix RABBITMQ_URL secret ref
kubernetes/services/panda-ocpp-api/base/deployment.yaml                      # +TZ env
kubernetes/services/panda-ev-gateway-services/base/deployment.yaml           # +TZ env
```

**K8s Secret ທີ່ໄດ້ Patch:**
```
panda-system-api-secrets  →  ເພີ່ມ key MOBILE_DATABASE_WRITE_URL
```
