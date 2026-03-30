# Panda EV — K8s / GCP DevOps Analysis & Fixes

**Date:** 2026-03-30
**Scope:** 4 services — OCPP, Admin, Mobile, Notification
**Cluster:** `panda-ev-cluster` | Region: `asia-southeast1` | Namespace: `panda-ev`

---

## Architecture Overview

```
Internet
  │
  ├─ GKE Ingress (L7 HTTPS) ──────────────────────────────────┐
  │   admin-api.pandaev.cc       → panda-system-api-service    │
  │   api.pandaev.cc             → panda-mobile-api-service     │
  │   notification-api.pandaev.cc → panda-notification-api-service │
  │                                                             │
  └─ L4 LoadBalancer (TCP) ─────────────────────────────────── ┤
      ws/wss://ocpp.pandaev.cc  → panda-ocpp-external-service  │
                                                                │
      [panda-ev namespace]                                      │
      ┌──────────────────────────────────────────────────────┐  │
      │ panda-system-api      (port 4000)   replicas: 2 HPA  │◄─┘
      │ panda-mobile-api      (port 4001)   replicas: 2 HPA  │◄─┘
      │ panda-ocpp-api        (port 4002)   replicas: 1      │◄─┘
      │ panda-notification-api (port 5001)  replicas: 2 HPA  │◄─┘
      │                                                       │
      │ redis-service         (port 6379)   replicas: 1 ⚠️   │
      │ rabbitmq-service      (port 5672)   replicas: 1 ⚠️   │
      └──────────────────────────────────────────────────────┘
```

---

## Issues Found & Fixed

### 🔴 Critical (P1)

---

#### [FIXED] P1.1 — OCPP: Port 443 (WSS) ไม่มี TLS env vars ใน Deployment

**ปัญหา:**
`panda-ev-ocpp-lb.yaml` เปิด port 443 สำหรับ WSS แต่ `deployment.yaml` ไม่มี `TLS_CERT_BASE64` / `TLS_KEY_BASE64` env vars
→ charger ที่ connect port 443 จะได้ plain WS แทน WSS — ใช้งานไม่ได้

**แก้ไขใน:** `panda-ev-ocpp/k8s/deployment.yaml`
- เพิ่ม `TLS_CERT_BASE64` + `TLS_KEY_BASE64` เป็น optional secret refs (`panda-ocpp-tls-secrets`)
- อัพเดต PRE-REQUISITES comment ให้มีขั้นตอนสร้าง TLS secret

```yaml
# TLS/WSS — optional: omit both if using plain ws:// only (port 80).
# Required when panda-ev-ocpp-lb.yaml port 443 (wss://) is in use.
- name: TLS_CERT_BASE64
  valueFrom:
    secretKeyRef:
      name: panda-ocpp-tls-secrets
      key: TLS_CERT_BASE64
      optional: true
- name: TLS_KEY_BASE64
  valueFrom:
    secretKeyRef:
      name: panda-ocpp-tls-secrets
      key: TLS_KEY_BASE64
      optional: true
```

**สร้าง TLS secret (เมื่อมี cert):**
```bash
kubectl create secret generic panda-ocpp-tls-secrets \
  --namespace=panda-ev \
  --from-literal=TLS_CERT_BASE64="$(base64 < /path/to/cert.pem | tr -d '\n')" \
  --from-literal=TLS_KEY_BASE64="$(base64 < /path/to/key.pem | tr -d '\n')"
```

---

#### [FIXED] P1.2 — OCPP: ขาด RabbitMQ queue env vars ใน ConfigMap

**ปัญหา:**
ConfigMap ไม่มี `RABBITMQ_ADMIN_COMMANDS_QUEUE` และ `RABBITMQ_CHARGER_SYNC_QUEUE`
→ Admin commands (Reset, ChangeAvailability ฯลฯ) และ Charger sync จะทำงานไม่ได้

**แก้ไขใน:** `panda-ev-ocpp/k8s/deployment.yaml` ConfigMap
```yaml
RABBITMQ_ADMIN_COMMANDS_QUEUE: "PANDA_EV_ADMIN_COMMANDS"
RABBITMQ_CHARGER_SYNC_QUEUE: "PANDA_EV_CHARGER_SYNC"
```

---

#### [FIXED] P1.3 — OCPP: LoadBalancer ไม่มี sessionAffinity (Critical สำหรับ WebSocket)

**ปัญหา:**
OCPP charger ถือ persistent WebSocket connection ต่อ pod
ถ้าไม่มี sticky session → charger ที่ reconnect อาจไปคนละ pod → in-memory state หาย
(ไม่มีผลตอน replicas: 1 แต่จะพังทันทีเมื่อ scale)

**แก้ไขใน:** `panda-ev-ocpp/k8s/panda-ev-ocpp-lb.yaml`
```yaml
sessionAffinity: ClientIP
sessionAffinityConfig:
  clientIP:
    timeoutSeconds: 10800  # 3 h — covers typical charger session duration
```

---

#### [FIXED] P1.4 — OCPP: ไม่มี Static IP annotation สำหรับ LoadBalancer

**ปัญหา:**
IP เปลี่ยนทุก deploy → charger config ต้องอัพเดต DNS ทุกครั้ง

**แก้ไขใน:** `panda-ev-ocpp/k8s/panda-ev-ocpp-lb.yaml`
```yaml
# TODO: set to the reserved static IP from PRE-REQUISITES step 1
# loadBalancerIP: "x.x.x.x"
```

**สร้าง static IP:**
```bash
gcloud compute addresses create panda-ocpp-ip \
  --region=asia-southeast1 --project=pandaev
```

---

#### [FIXED] P1.5 — Mobile: `NODE_ENV: "development"` ใน Production ConfigMap

**ปัญหา:**
NestJS อยู่ใน development mode → Swagger เปิดให้ทุกคนเห็น, ไม่ optimize performance

**แก้ไขใน:** `panda-ev-client-mobile/k8s/deployment.yaml`
```yaml
# เดิม
NODE_ENV: "development"
# แก้เป็น
NODE_ENV: "production"
```

---

#### [FIXED] P1.6 — Mobile: ขาด RabbitMQ DLQ/DLX และ User Events queue

**ปัญหา:**
- ขาด `RABBITMQ_USER_EVENTS_QUEUE` → user sync ไป Admin DB ทำงานไม่ได้
- ขาด `RABBITMQ_OCPP_EVENTS_DLQ` + `RABBITMQ_OCPP_EVENTS_DLX` → `consumeWithDlq()` ใช้ default values ที่อาจไม่ match queue ที่ declare ไว้

**แก้ไขใน:** `panda-ev-client-mobile/k8s/deployment.yaml`
```yaml
RABBITMQ_USER_EVENTS_QUEUE: "PANDA_EV_USER_EVENTS"
RABBITMQ_OCPP_EVENTS_DLQ: "PANDA_EV_QUEUE_DLQ"
RABBITMQ_OCPP_EVENTS_DLX: "PANDA_EV_QUEUE_DLX"
```

---

#### [FIXED] P1.7 — Notification Service: ไม่มี Dockerfile, docker-entrypoint.sh และ k8s manifests

**ปัญหา:**
Service deploy บน GKE ไม่ได้เลย

**สร้างไฟล์ใหม่:**

| ไฟล์ | รายละเอียด |
|---|---|
| `panda-ev-notification/Dockerfile` | Two-stage build, port 5001, entry: `dist/main` |
| `panda-ev-notification/docker-entrypoint.sh` | Write DATABASE_URL → .env, wait DB, migrate, start |
| `panda-ev-notification/k8s/deployment.yaml` | ConfigMap, SA, Deployment, BackendConfig (Socket.IO timeout 3600s), Service, HPA, PDB |

**K8s resources สร้างใหม่:**
- ConfigMap: NODE_ENV production, port 5001, DLQ/DLX queues
- ServiceAccount: Workload Identity → `panda-notification-api-sa`
- Deployment: replicas 2, RollingUpdate, Cloud SQL proxy sidecar (`panda-ev-noti-db`)
- BackendConfig: health `/health` + `timeoutSec: 3600` (Socket.IO long-lived connections)
- Service (ClusterIP): port 80 → 5001
- HPA: min 2 / max 4
- PDB: minAvailable 1

**สร้าง K8s Secret:**
```bash
kubectl create secret generic panda-notification-api-secrets \
  --namespace=panda-ev \
  --from-literal=DATABASE_URL="postgresql://USER:PASS@127.0.0.1:5432/DB_NAME?schema=panda_ev_notifications" \
  --from-literal=RABBITMQ_URL="amqp://USER:PASS@rabbitmq-service:5672" \
  --from-literal=FIREBASE_PROJECT_ID="<project-id>" \
  --from-literal=FIREBASE_CLIENT_EMAIL="<client-email>" \
  --from-literal=FIREBASE_PRIVATE_KEY="<private-key>" \
  --from-literal=SERVICE_JWT_PRIVATE_KEY="$(base64 < keys/notification.pem | tr -d '\n')" \
  --from-literal=TRUSTED_SERVICE_PUBLIC_KEYS='[{"iss":"mobile-api","key":"<base64(mobile.pub)>"},{"iss":"admin-api","key":"<base64(admin.pub)>"},{"iss":"ocpp-csms","key":"<base64(ocpp.pub)>"}]'
```

**สร้าง notification keypair:**
```bash
openssl genrsa -out keys/notification.pem 2048
openssl rsa -in keys/notification.pem -pubout -out keys/notification.pub
# Copy notification.pub ไปยัง peer services ที่ต้อง trust notification
```

---

### 🟡 Warning (P2)

---

#### [FIXED] P2.1 — Admin: Port ผิดใน CLAUDE.md

**ปัญหา:** main `CLAUDE.md` บันทึก port `3001` แต่ service จริงใช้ `4000`

**แก้ไขใน:** `/CLAUDE.md`
- ตาราง services: `3001` → `4000`
- Architecture diagram: `Admin System (3001)` → `Admin System (4000)`

---

#### [FIXED] P2.2 — Admin: `SWAGGER_ENABLED: "true"` ใน Production

**ปัญหา:** Swagger UI เปิดให้ทุกคนเห็น endpoint ทั้งหมดใน production

**แก้ไขใน:** `panda-ev-csms-system-admin/k8s/deployment.yaml`
```yaml
# เดิม
SWAGGER_ENABLED: "true"
# แก้เป็น
SWAGGER_ENABLED: "false"
```

---

#### [FIXED] P2.3 — Ingress และ ManagedCertificate: ขาด Notification subdomain

**ปัญหา:**
Notification service เพิ่งสร้างใหม่ ยังไม่มีใน Ingress และ TLS cert

**แก้ไขใน:** `panda-ev-csms-system-admin/k8s/panda-ev-ingress.yaml`
```yaml
- host: notification-api.pandaev.cc
  http:
    paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: panda-notification-api-service
            port:
              number: 80
```

**แก้ไขใน:** `panda-ev-csms-system-admin/k8s/managed-cert.yaml`
```yaml
spec:
  domains:
    - admin-api.pandaev.cc
    - api.pandaev.cc
    - notification-api.pandaev.cc  # เพิ่มใหม่
```

---

### 🔵 Open Issues (P3) — ยังไม่ได้แก้

---

#### P3.1 — Redis: Single Point of Failure

**ปัญหา:**
```
redis Pod (replicas: 1) + PVC (ReadWriteOnce)
  → ถ้า node ล่ม หรือ GKE node upgrade
  → Redis Pod ถูก Evict
  → รอ PVC re-attach ~2-5 นาที
  → Mobile, Admin, Notification crash ทันที (hard requirement)
  → OCPP session state หาย
```

**แนวทางแก้ไข (แนะนำ):**

**Option A — Google Cloud Memorystore** ⭐ แนะนำ
```bash
gcloud redis instances create panda-ev-redis \
  --size=1 \
  --region=asia-southeast1 \
  --tier=STANDARD_HA \
  --project=pandaev
```
- Standard HA tier = automatic failover < 1 นาที
- ลบ `redis Deployment` + `redis PVC` + `redis Service` ออกจาก Admin k8s
- อัพเดต REDIS_URL ใน ConfigMap ทุก service:
  ```yaml
  REDIS_URL: "redis://<memorystore-ip>:6379"
  ```
- ต้องใช้ VPC network เดียวกับ GKE cluster (Private IP)

**Option B — Redis Sentinel (self-managed)**
```bash
helm install redis bitnami/redis \
  --namespace panda-ev \
  --set architecture=replication \
  --set sentinel.enabled=true \
  --set replica.replicaCount=2
```
- 1 master + 2 replica + sentinel
- ซับซ้อนกว่า, ต้องดูแลเอง

---

#### P3.2 — RabbitMQ: Single Point of Failure

**ปัญหา:**
```
rabbitmq Pod (replicas: 1) + PVC (ReadWriteOnce)
  → ถ้า node ล่ม
  → RabbitMQ Pod ถูก Evict
  → Messages ที่อยู่ใน queue ระหว่างนั้นหาย
  → DLQ ไม่ทำงาน (OCPP events, Notification queue หาย)
```

**แนวทางแก้ไข (แนะนำ):**

**Option A — CloudAMQP (Managed RabbitMQ SaaS)** ⭐ แนะนำ
- สมัคร plan ที่มี HA (e.g. Bunny plan หรือสูงกว่า)
- ได้ `RABBITMQ_URL` ใหม่ → อัพเดต K8s Secrets ทุก service
- ลบ `rabbitmq Deployment` + `rabbitmq PVC` + `rabbitmq Service` ออกจาก Admin k8s

**Option B — RabbitMQ Cluster Operator (self-managed)**
```bash
kubectl apply -f https://github.com/rabbitmq/cluster-operator/releases/latest/download/cluster-operator.yml

kubectl apply -f - <<EOF
apiVersion: rabbitmq.com/v1beta1
kind: RabbitmqCluster
metadata:
  name: rabbitmq
  namespace: panda-ev
spec:
  replicas: 3
  resources:
    requests:
      cpu: 200m
      memory: 512Mi
  persistence:
    storageClassName: standard-rwo
    storage: 10Gi
EOF
```
- 3-node cluster กับ Quorum Queues = messages ไม่หายเมื่อ node ล่ม
- ซับซ้อนกว่า, ต้องดูแลเอง

---

## Deployment Checklist (Apply order)

เมื่อ deploy ครั้งแรกหรือ re-deploy ทั้งหมด ให้ apply ตามลำดับนี้:

```bash
# Namespace (ถ้ายังไม่มี)
kubectl apply -f panda-ev-csms-system-admin/k8s/deployment.yaml  # contains Namespace

# Infrastructure (Redis, RabbitMQ)
# → ถ้าใช้ Memorystore/CloudAMQP ข้ามขั้นตอนนี้
kubectl apply -f panda-ev-csms-system-admin/k8s/deployment.yaml  # Redis + RabbitMQ included

# Services (ไม่มี dependency ระหว่างกัน — apply พร้อมกันได้)
kubectl apply -f panda-ev-ocpp/k8s/deployment.yaml
kubectl apply -f panda-ev-ocpp/k8s/panda-ev-ocpp-lb.yaml
kubectl apply -f panda-ev-csms-system-admin/k8s/deployment.yaml
kubectl apply -f panda-ev-client-mobile/k8s/deployment.yaml
kubectl apply -f panda-ev-notification/k8s/deployment.yaml

# Ingress + TLS (apply หลัง services พร้อมแล้ว)
kubectl apply -f panda-ev-csms-system-admin/k8s/managed-cert.yaml
kubectl apply -f panda-ev-csms-system-admin/k8s/panda-ev-ingress.yaml
```

---

## Domain & Port Summary

| Service | Internal Port | External URL | Protocol |
|---|---|---|---|
| Admin API | 4000 | `https://admin-api.pandaev.cc` | HTTPS (L7 Ingress) |
| Mobile API | 4001 | `https://api.pandaev.cc` | HTTPS (L7 Ingress) |
| OCPP CSMS | 4002 | `ws://ocpp.pandaev.cc` (port 80) | WS (L4 LB) |
| OCPP CSMS | 4002 | `wss://ocpp.pandaev.cc` (port 443) | WSS (L4 LB + app TLS) |
| Notification | 5001 | `https://notification-api.pandaev.cc` | HTTPS + Socket.IO (L7 Ingress) |

---

## K8s Secrets Reference

| Service | Secret Name | Keys |
|---|---|---|
| Admin | `panda-system-api-secrets` | DATABASE_URL, JWT_SECRET, JWT_REFRESH_SECRET, JWT_PRIVATE_KEY, JWT_PUBLIC_KEY, SERVICE_JWT_PRIVATE_KEY, TRUSTED_SERVICE_PUBLIC_KEYS, RABBITMQ_URL |
| Mobile | `panda-mobile-api-secrets` | DATABASE_URL, SYSTEM_DATABASE_URL, JWT_SECRET, JWT_REFRESH_SECRET, JWT_PRIVATE_KEY, JWT_PUBLIC_KEY, SERVICE_JWT_PRIVATE_KEY, TRUSTED_SERVICE_PUBLIC_KEYS, RABBITMQ_URL, FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY, SMTP_PASS |
| OCPP | `panda-ocpp-api-secrets` | DATABASE_URL, RABBITMQ_URL, SERVICE_JWT_PRIVATE_KEY, TRUSTED_SERVICE_PUBLIC_KEYS |
| OCPP (TLS/optional) | `panda-ocpp-tls-secrets` | TLS_CERT_BASE64, TLS_KEY_BASE64 |
| Notification | `panda-notification-api-secrets` | DATABASE_URL, RABBITMQ_URL, FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY, SERVICE_JWT_PRIVATE_KEY, TRUSTED_SERVICE_PUBLIC_KEYS |

---

## Service-to-Service JWT Trust Matrix

| Service (Consumer) | Trusts tokens from |
|---|---|
| Admin | `mobile-api`, `ocpp-csms` |
| Mobile | `admin-api`, `ocpp-csms` |
| OCPP | `mobile-api`, `admin-api` |
| Notification | `mobile-api`, `admin-api`, `ocpp-csms` |

---

## Cloud SQL Instances

| Service | Instance Connection Name | Port |
|---|---|---|
| Admin | `pandaev:asia-southeast1:panda-ev-csms-system` | 5432 |
| Mobile (core DB) | `pandaev:asia-southeast1:panda-ev-core-mobile-db` | 5432 |
| Mobile (system DB) | `pandaev:asia-southeast1:panda-ev-csms-system` | 5433 |
| OCPP | `pandaev:asia-southeast1:panda-ev-ocpp-db` | 5432 |
| Notification | `pandaev:asia-southeast1:panda-ev-noti-db` | 5432 |
