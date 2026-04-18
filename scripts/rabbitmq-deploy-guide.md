# RabbitMQ — ຄູ່ມືການ Deploy, Monitor, ແລະ Test
**Namespace:** `panda-ev-prod`  
**Helm Chart:** `bitnami/rabbitmq` version `16.0.14`  
**App Version:** RabbitMQ `4.0`  
**ອັບເດດລ່າສຸດ:** 2026-04-17

---

## ສາລະບານ

1. [ໂຄງສ້າງໄຟລ໌](#1-ໂຄງສ້າງໄຟລ໌)
2. [ຄວາມຮູ້ Kubernetes Probes](#2-ຄວາມຮູ້-kubernetes-probes)
3. [ຄຳອະທິບາຍ Helm Values](#3-ຄຳອະທິບາຍ-helm-values)
4. [ຂັ້ນຕອນ Deploy ຄັ້ງທຳອິດ](#4-ຂັ້ນຕອນ-deploy-ຄັ້ງທຳອິດ)
5. [ຄຳສັ່ງ Upgrade / Redeploy](#5-ຄຳສັ່ງ-upgrade--redeploy)
6. [ຄຳສັ່ງ Monitor ແລະ ກວດສອບ](#6-ຄຳສັ່ງ-monitor-ແລະ-ກວດສອບ)
7. [ຄຳສັ່ງ Test ການເຊື່ອມຕໍ່](#7-ຄຳສັ່ງ-test-ການເຊື່ອມຕໍ່)
8. [ການ Rotate Password](#8-ການ-rotate-password)
9. [ການ Uninstall ແລະ ລ້າງຂໍ້ມູນ](#9-ການ-uninstall-ແລະ-ລ້າງຂໍ້ມູນ)
10. [ຂໍ້ຜິດພາດທີ່ພົບເລື້ອຍ](#10-ຂໍ້ຜິດພາດທີ່ພົບເລື້ອຍ)

---

## 1. ໂຄງສ້າງໄຟລ໌

```
scripts/
  rabbitmq-values.yaml          ← Helm values config (ຫຼັກ)
  create-rabbitmq-secret.sh     ← ສ້າງ K8s secret (credentials)
  rabbitmq-deploy-guide.md      ← ໄຟລ໌ນີ້
```

---

## 2. ຄວາມຮູ້ Kubernetes Probes

> ອ້າງອີງຈາກ: Kubernetes Official Docs — *Configure Liveness, Readiness and Startup Probes*

Kubernetes ມີ probe 3 ປະເພດ ທີ່ kubelet ໃຊ້ກວດສຸຂະພາບ container. ທຸກ probe ເຮັດວຽກ **ແຍກກັນ** ແລະ ມີໜ້າທີ່ຕ່າງກັນ.

---

### 2.1 ປະເພດ Probe

```
┌─────────────────────────────────────────────────────────────────┐
│  STARTUP PROBE        ← ເຮັດວຽກຕອນ boot ເທົ່ານັ້ນ             │
│  ↓ (ສຳເລັດ 1 ຄັ້ງ → ຢຸດ, ສ່ົງ liveness ຕໍ່)                  │
│  LIVENESS PROBE       ← ເຮັດວຽກຕະຫຼອດ lifetime                 │
│  READINESS PROBE      ← ເຮັດວຽກຕະຫຼອດ lifetime (ແຍກຈາກ liveness)│
└─────────────────────────────────────────────────────────────────┘
```

| Probe | ໜ້າທີ່ | ຖ້າ fail |
|-------|--------|----------|
| **Liveness** | ກວດວ່າ container ຍັງ alive (ບໍ່ freeze / deadlock) | kubelet **restart** container |
| **Readiness** | ກວດວ່າ container ພ້ອມຮັບ traffic | kubelet **ຫຍຸດ route traffic** ມາ pod (ບໍ່ restart) |
| **Startup** | ກວດວ່າ app boot ສຳເລັດ (ສຳລັບ app ທີ່ boot ຊ້າ) | kubelet **restart** container ຖ້າ fail ເກີນ threshold |

---

### 2.2 ວິທີ Probe (Probe Mechanisms)

Kubernetes ຮອງຮັບ 4 ວິທີ:

#### ① exec — ສັ່ງ command ພາຍໃນ container

```yaml
livenessProbe:
  exec:
    command:
      - cat
      - /tmp/healthy
  initialDelaySeconds: 5
  periodSeconds: 5
```

> ✓ ຖ້າ command return `exit code 0` = healthy  
> ✗ ຖ້າ return non-zero = fail → restart

**ໃຊ້ເມື່ອ**: app ບໍ່ມີ HTTP endpoint ຫຼື port — ເຊັ່ນ RabbitMQ ໃຊ້ `rabbitmq-diagnostics`

---

#### ② httpGet — ສົ່ງ HTTP GET request

```yaml
livenessProbe:
  httpGet:
    path: /healthz
    port: 8080
    httpHeaders:
      - name: Custom-Header
        value: Awesome
  initialDelaySeconds: 3
  periodSeconds: 3
```

> ✓ HTTP status code `200–399` = healthy  
> ✗ status code ອື່ນ = fail → restart

**ໃຊ້ເມື່ອ**: app ເປັນ HTTP server — ເຊັ່ນ NestJS `/health` endpoint  
ສາມາດໃຊ້ **named port** ໄດ້:

```yaml
ports:
  - name: http
    containerPort: 4000

livenessProbe:
  httpGet:
    path: /health
    port: http          # ← ໃຊ້ຊື່ port ແທນ ເລກ
```

---

#### ③ tcpSocket — ພະຍາຍາມ connect TCP port

```yaml
livenessProbe:
  tcpSocket:
    port: 8080
  initialDelaySeconds: 15
  periodSeconds: 10
```

> ✓ TCP connection ສຳເລັດ = healthy  
> ✗ ຕໍ່ບໍ່ໄດ້ = fail → restart

**ໃຊ້ເມື່ອ**: app ບໍ່ໄດ້ HTTP ແຕ່ listen TCP port — ເຊັ່ນ database, AMQP

---

#### ④ grpc — ກວດຜ່ານ gRPC Health Checking Protocol

```yaml
livenessProbe:
  grpc:
    port: 2379
  initialDelaySeconds: 10
```

**ໃຊ້ເມື່ອ**: app implement gRPC Health Protocol (Kubernetes v1.27+)

---

### 2.3 Parameters ທຸກຕົວ

```yaml
livenessProbe:
  # ─── ວິທີ probe (ເລືອກ 1 ອັນ) ───────────────────────
  exec:          # ① run command
  httpGet:       # ② HTTP GET
  tcpSocket:     # ③ TCP connect
  grpc:          # ④ gRPC

  # ─── ເວລາ ─────────────────────────────────────────────
  initialDelaySeconds: 0
  # ↑ ລໍຖ້າ N ວິ ຫຼັງ container start ກ່ອນ probe ຄັ້ງທຳອິດ
  #   ⚠ ຕ່ຳເກີນ = probe ກ່ອນ app ready → restart loop
  #   ທາງທີ່ດີກວ່າ: ໃຊ້ startupProbe ແທນ initialDelaySeconds ໃຫຍ່

  periodSeconds: 10
  # ↑ probe ທຸກ N ວິ

  timeoutSeconds: 1
  # ↑ ຖ້າ probe ບໍ່ຕອບໃນ N ວິ = ນັບ 1 failure

  # ─── Threshold ────────────────────────────────────────
  failureThreshold: 3
  # ↑ fail N ຄັ້ງຕິດກັນ → action (restart ຫຼື remove from LB)
  #   ເວລາ tolerate failure: failureThreshold × periodSeconds

  successThreshold: 1
  # ↑ success N ຄັ້ງ → ຖືວ່າ healthy ຄືນ
  #   liveness/startup ຕ້ອງເປັນ 1 ສະເໝີ
  #   readiness ສາມາດ > 1 ໄດ້ (ຕ້ອງ stable ຫຼາຍຄັ້ງ)
```

---

### 2.4 Startup Probe — ແກ້ໄຂ App ທີ່ Boot ຊ້າ

**ບັນຫາ**: ຖ້າ `initialDelaySeconds` ໃຫຍ່ເກີນ — ຊ້າ detect deadlock.  
ຖ້ານ້ອຍເກີນ — probe ກ່ອນ app ready → restart loop.

**ວິທີທີ່ຖືກຕ້ອງ**: ໃຊ້ `startupProbe` ຮ່ວມ

```yaml
ports:
  - name: http
    containerPort: 8080

# startupProbe ຈະເຮັດວຽກກ່ອນ — ຈົນກ່ວາ success ຄັ້ງທຳອິດ
startupProbe:
  httpGet:
    path: /healthz
    port: http
  failureThreshold: 30   # ←┐ ສູງສຸດ 30 × 10s = 5 ນາທີ boot
  periodSeconds: 10      # ←┘

# ຫຼັງຈາກ startup success → liveness ຮັບໜ້າທີ່ຕໍ່
livenessProbe:
  httpGet:
    path: /healthz
    port: http
  failureThreshold: 1    # ← ຕອບສະໜອງໄວ ຫຼັງ boot ສຳເລັດ
  periodSeconds: 10
```

> `failureThreshold × periodSeconds` = ເວລາ boot ສູງສຸດທີ່ອະນຸຍາດ  
> ຖ້າ startupProbe ບໍ່ success ຄາ threshold — container ຖືກ **restart**

---

### 2.5 Readiness vs Liveness — ຄວາມແຕກຕ່າງ

```
Liveness fail  → kubelet RESTART container
                 (ໃຊ້ກັບ app ທີ່ freeze / deadlock ບໍ່ recover ເອງ)

Readiness fail → kubelet REMOVE pod ຈາກ Service endpoints
                 (traffic ຢຸດ, container ຍັງ run ຢູ່)
                 (ໃຊ້ກັບ app ທີ່ busy / loading ຊົ່ວຄາວ)
```

**ໃຊ້ທັງສອງ**ຮ່ວມກັນເສມີ:
- **Readiness** = ຮັບປະກັນ traffic ບໍ່ເຂົ້າ pod ທີ່ basy ຫຼື booting
- **Liveness** = ຮັບປະກັນ pod ທີ່ deadlock ຖືກ restart ອັດຕະໂນມັດ

```yaml
readinessProbe:
  exec:
    command: [cat, /tmp/healthy]
  initialDelaySeconds: 5
  periodSeconds: 5

livenessProbe:
  exec:
    command: [cat, /tmp/healthy]
  initialDelaySeconds: 5
  periodSeconds: 5
```

> ⚠ readiness ແລະ liveness **ບໍ່ depend** ກັນ — ທຳງານ parallel

---

### 2.6 ການ Apply ໃນ RabbitMQ ຂອງເຮົາ

```yaml
# scripts/rabbitmq-values.yaml ໃຊ້ exec probe ຍ້ອນ RabbitMQ ບໍ່ expose HTTP health endpoint
# ໃຊ້ customLivenessProbe (ບໍ່ແມ່ນ livenessProbe) ຍ້ອນ Bitnami chart merge behavior

customLivenessProbe:
  exec:
    command: [rabbitmq-diagnostics, -q, check_running]
  initialDelaySeconds: 60   # RabbitMQ boot ຊ້າ — ລໍຖ້າ 60 ວິ
  periodSeconds: 30
  timeoutSeconds: 10
  failureThreshold: 6       # 6 × 30s = 3 ນາທີ tolerate
  successThreshold: 1

customReadinessProbe:
  exec:
    command: [rabbitmq-diagnostics, -q, check_running]
  initialDelaySeconds: 20   # readiness ເລີ່ມໄວກວ່า liveness
  periodSeconds: 10
  timeoutSeconds: 5
  failureThreshold: 3       # 3 × 10s = 30 ວິ ຢຸດ traffic
  successThreshold: 1

# ⚠ ເຫດຜົນໃຊ້ customLivenessProbe ແທນ livenessProbe:
#   Bitnami chart template render exec ຂອງຕົນເອງ (curl-based) ຫຼັງ exec ຂອງເຮົາ
#   YAML duplicate key = last wins → chart probe override ຂອງເຮົາ
#   customLivenessProbe = chart skip template ຂອງຕົນເອງ → ໃຊ້ຂອງເຮົາທັງໝົດ
```

---

## 3. ຄຳອະທິບາຍ Helm Values

ໄຟລ໌: `scripts/rabbitmq-values.yaml`

```yaml
# ══════════════════════════════════════════════════════
#  auth — ການຈັດການ credentials
# ══════════════════════════════════════════════════════
auth:
  existingErlangSecret: panda-rabbitmq-prod-secrets
  # ↑ ຊື່ K8s Secret ທີ່ເກັບ erlang cookie
  #   (ສ້າງດ້ວຍ scripts/create-rabbitmq-secret.sh)

  existingErlangSecretKey: rabbitmq-erlang-cookie
  # ↑ key ພາຍໃນ Secret ທີ່ເກັບ erlang cookie
  #   erlang cookie ໃຊ້ສຳລັບການສື່ສານລະຫວ່າງ RabbitMQ nodes
  #   ຕ້ອງ match ກັນທຸກ node ໃນ cluster

  existingPasswordSecret: panda-rabbitmq-prod-secrets
  # ↑ ຊື່ K8s Secret ທີ່ເກັບ password ຜູ້ໃຊ້ "user"

  existingPasswordSecretKey: rabbitmq-password
  # ↑ key ພາຍໃນ Secret ທີ່ເກັບ password

  usePasswordFiles: false
  # ↑ false = ອ່ານ password ຈາກ env var ໂດຍກົງ
  #   true  = chart ຈະ mount secret ເປັນໄຟລ໌ (/opt/bitnami/rabbitmq/secrets/)
  #   ⚠ ຕ້ອງ false — ຖ້າ true ແລ້ວ probe ຈະ probe ຜ່ານ file path ທີ່ຕ້ອງ mount


# ══════════════════════════════════════════════════════
#  global.security — ຄວາມປອດໄພລະດັບ global
# ══════════════════════════════════════════════════════
global:
  security:
    allowInsecureImages: true
    # ↑ true = ອະນຸຍາດໃຫ້ pull image ຈາກ registry ທີ່ບໍ່ໄດ້ verified
    #   ຕ້ອງ true ເພາະໃຊ້ public.ecr.aws ແທນ registry.bitnami.com


# ══════════════════════════════════════════════════════
#  image — image ທີ່ deploy
# ══════════════════════════════════════════════════════
image:
  registry: public.ecr.aws
  # ↑ ໃຊ້ Amazon ECR Public ແທນ Bitnami registry ທີ່ຕ້ອງ subscribe

  repository: bitnami/rabbitmq
  # ↑ ຊື່ image repository

  tag: "4.0"
  # ↑ RabbitMQ version 4.0.x (rolling tag)
  #   ⚠ production ຄວນໃຊ້ tag ຄົງທີ່ເຊັ່ນ "4.0.7" ແທນ "4.0"


# ══════════════════════════════════════════════════════
#  replicaCount — ຈຳນວນ node
# ══════════════════════════════════════════════════════
replicaCount: 1
# ↑ ຈຳນວນ RabbitMQ pod
#   1 = single node (ພຽງພໍສຳລັບ production ທຳດາ)
#   3 = HA cluster (ຕ້ອງການ 3 GKE node ຢ່າງໜ້ອຍ)
#   ⚠ ຖ້າຕ້ອງການ scale ຈາກ 1 → 3 ຕ້ອງລຶບ PVC ເກົ່າດ້ວຍ


# ══════════════════════════════════════════════════════
#  customLivenessProbe — ກວດວ່າ pod ຍັງ alive
# ══════════════════════════════════════════════════════
customLivenessProbe:
  exec:
    command:
      - rabbitmq-diagnostics
      - -q
      - check_running
  # ↑ ໃຊ້ customLivenessProbe (ບໍ່ແມ່ນ livenessProbe)
  #   ເຫດຜົນ: Bitnami chart ໃຊ້ livenessProbe ເປັນ "merge" — chart ຈະ
  #   append curl-based exec ຂອງຕົນເອງ ຕາມຫຼັງ exec ຂອງເຮົາ ແລ້ວ override
  #   customLivenessProbe = "replace" ທັງໝົດ — ປອດໄພ

  initialDelaySeconds: 60
  # ↑ ລໍຖ້າ 60 ວິນາທີກ່ອນ probe ຄັ້ງທຳອິດ
  #   RabbitMQ ໃຊ້ເວລາ boot ນານ — ຕ່ຳກວ່ານີ້ pod ຈະ restart ກ່ອນ ready

  periodSeconds: 30
  # ↑ probe ທຸກ 30 ວິນາທີ

  timeoutSeconds: 10
  # ↑ ຖ້າ probe ບໍ່ຕອບໃນ 10 ວິ = fail 1 ຄັ້ງ

  failureThreshold: 6
  # ↑ fail 6 ຄັ້ງຕິດກັນ = restart pod
  #   6 × 30s = 3 ນາທີ — ໃຫ້ເວລາ RabbitMQ recover ກ່ອນ restart

  successThreshold: 1
  # ↑ ສຳເລັດ 1 ຄັ້ງ = ຖືວ່າ alive


# ══════════════════════════════════════════════════════
#  customReadinessProbe — ກວດວ່າ pod ພ້ອມຮັບ traffic
# ══════════════════════════════════════════════════════
customReadinessProbe:
  exec:
    command:
      - rabbitmq-diagnostics
      - -q
      - check_running
  # ↑ ດຽວກັນກັບ liveness — ກວດວ່າ RabbitMQ daemon ເຮັດວຽກ

  initialDelaySeconds: 20
  # ↑ readiness probe ເລີ່ມໄວກວ່າ liveness (20 vs 60 ວິ)

  periodSeconds: 10
  # ↑ probe ທຸກ 10 ວິ — ໄວກວ່າ liveness ເພາະຕ້ອງການ detect ready ໄວ

  timeoutSeconds: 5
  failureThreshold: 3
  # ↑ fail 3 ຄັ້ງ = ຫຍຸດ route traffic ມາ pod ນີ້ (ບໍ່ restart)

  successThreshold: 1


# ══════════════════════════════════════════════════════
#  persistence — ການເກັບຂໍ້ມູນ
# ══════════════════════════════════════════════════════
persistence:
  enabled: true
  # ↑ true = ໃຊ້ PersistentVolumeClaim ເກັບ queue data
  #   false = ຂໍ້ມູນ queue ຫາຍເມື່ອ pod restart (ໃຊ້ dev ເທົ່ານັ້ນ)

  size: 20Gi
  # ↑ ຂະໜາດ disk ສຳລັບ queue data
  #   ໃຊ້ disk ຫຼາຍ = queue stack ໄດ້ຫຼາຍ ກ່ອນ memory ເຕັມ

  storageClass: premium-rwo
  # ↑ GKE StorageClass
  #   premium-rwo = SSD (pd-ssd) — ໄວ, ດີສຳລັບ production
  #   standard-rwo = HDD (pd-standard) — ຖືກກວ່າ, ຊ້າກວ່າ


# ══════════════════════════════════════════════════════
#  resources — CPU ແລະ Memory
# ══════════════════════════════════════════════════════
resources:
  requests:
    cpu: 500m
    # ↑ ຂໍ CPU 0.5 core ເພື່ອ schedule pod ໄດ້
    memory: 1Gi
    # ↑ ຂໍ memory 1GB — RabbitMQ ໃຊ້ memory ເກັບ queue ໃນ RAM

  limits:
    cpu: 1000m
    # ↑ ໃຊ້ CPU ໄດ້ສູງສຸດ 1 core
    memory: 2Gi
    # ↑ ໃຊ້ memory ໄດ້ສູງສຸດ 2GB
    #   ⚠ RabbitMQ ຈະ block publish ເມື່ອ memory > 40% ຂອງ limit (800MB)
    #   ຖ້າ queue ໃຫຍ່ ໃຫ້ເພີ່ມ memory limit


# ══════════════════════════════════════════════════════
#  volumePermissions — ການ init volume
# ══════════════════════════════════════════════════════
volumePermissions:
  image:
    registry: public.ecr.aws
    repository: bitnami/os-shell
    tag: 12-debian-12-r1
    # ↑ init container ທີ່ set file permissions ໃຫ້ RabbitMQ ອ່ານ volume ໄດ້
    #   ໃຊ້ ECR Public ຄືກັນ ເພາະ allowInsecureImages: true
```

---

## 4. ຂັ້ນຕອນ Deploy ຄັ້ງທຳອິດ

### ຂັ້ນຕອນ 1 — ເພີ່ມ Helm repo (ເຮັດຄັ້ງດຽວ)

```bash
helm repo add bitnami https://charts.bitnami.com/bitnami
helm repo update
```

### ຂັ້ນຕອນ 2 — ສ້າງ K8s Secret

```bash
# ສ້າງ secret ທີ່ມີ 3 keys ທີ່ຈຳເປັນ
bash scripts/create-rabbitmq-secret.sh

# ກວດສອບ keys ທີ່ຢູ່ໃນ secret
kubectl get secret panda-rabbitmq-prod-secrets -n panda-ev-prod \
  -o jsonpath='{.data}' | \
  python3 -c "import sys,json; print(list(json.load(sys.stdin).keys()))"
# ຕ້ອງໄດ້: ['rabbitmq-password', 'rabbitmq-erlang-cookie', 'RABBITMQ_URL']
```

### ຂັ້ນຕອນ 3 — Install RabbitMQ

```bash
helm install panda-rabbitmq bitnami/rabbitmq \
  --namespace panda-ev-prod \
  --version 16.0.14 \
  -f scripts/rabbitmq-values.yaml
```

### ຂັ້ນຕອນ 4 — ລໍຖ້າ pod ready

```bash
kubectl rollout status statefulset/panda-rabbitmq \
  -n panda-ev-prod \
  --timeout=180s
```

### ຂັ້ນຕອນ 5 — ກວດສອບ

```bash
kubectl get pods -n panda-ev-prod | grep rabbitmq
# ຜົນທີ່ຕ້ອງການ: panda-rabbitmq-0   1/1   Running   0
```

---

## 5. ຄຳສັ່ງ Upgrade / Redeploy

### Upgrade ປົກກະຕິ (ປ່ຽນ values)

```bash
helm upgrade panda-rabbitmq bitnami/rabbitmq \
  --namespace panda-ev-prod \
  --version 16.0.14 \
  -f scripts/rabbitmq-values.yaml
```

### Upgrade + recreate secret (ຖ້າ secret ໝົດ / ປ່ຽນ password)

```bash
# 1. recreate secret ກ່ອນ
bash scripts/create-rabbitmq-secret.sh

# 2. upgrade helm
helm upgrade panda-rabbitmq bitnami/rabbitmq \
  --namespace panda-ev-prod \
  --version 16.0.14 \
  -f scripts/rabbitmq-values.yaml

# 3. ລໍຖ້າ
kubectl rollout status statefulset/panda-rabbitmq -n panda-ev-prod --timeout=180s
```

### Force restart pod (ບໍ່ປ່ຽນ config)

```bash
kubectl rollout restart statefulset/panda-rabbitmq -n panda-ev-prod
kubectl rollout status statefulset/panda-rabbitmq -n panda-ev-prod --timeout=120s
```

---

## 6. ຄຳສັ່ງ Monitor ແລະ ກວດສອບ

### ກວດສອບ pod ໂດຍລວມ

```bash
# ສະຖານະ pod
kubectl get pods -n panda-ev-prod | grep rabbitmq

# ລາຍລະອຽດ pod (probe, events, resource usage)
kubectl describe pod panda-rabbitmq-0 -n panda-ev-prod

# ກວດ probe ໂດຍສະເພາະ
kubectl describe pod -n panda-ev-prod -l app.kubernetes.io/name=rabbitmq \
  | grep -A4 "Liveness:\|Readiness:"
```

### ກວດສອບ logs

```bash
# logs ລ່າສຸດ 50 ບັນທັດ
kubectl logs panda-rabbitmq-0 -n panda-ev-prod --tail=50

# logs ແບບ realtime (follow)
kubectl logs panda-rabbitmq-0 -n panda-ev-prod -f

# logs ຈາກ pod ທີ່ crash ແລ້ວ (previous container)
kubectl logs panda-rabbitmq-0 -n panda-ev-prod --previous --tail=50
```

### ກວດສອບ resource usage

```bash
# CPU + Memory ປັດຈຸບັນ
kubectl top pod panda-rabbitmq-0 -n panda-ev-prod

# PersistentVolumeClaim (disk usage)
kubectl get pvc -n panda-ev-prod | grep rabbitmq
```

### ກວດສອບ Helm release

```bash
# ສະຖານະ release
helm status panda-rabbitmq -n panda-ev-prod

# Values ທີ່ deploy ຢູ່ປັດຈຸບັນ
helm get values panda-rabbitmq -n panda-ev-prod

# ກວດ probe ທີ່ Helm render ຈິງໆ (ສຳຄັນ — ກວດສອບ duplicate exec bug)
helm get manifest panda-rabbitmq -n panda-ev-prod \
  | grep -A12 "livenessProbe:"

# ປະຫວັດ revision
helm history panda-rabbitmq -n panda-ev-prod
```

### ກວດສອບ StatefulSet

```bash
# ສະຖານະ StatefulSet
kubectl get statefulset panda-rabbitmq -n panda-ev-prod

# ກວດ probe ໃນ StatefulSet spec
kubectl get statefulset panda-rabbitmq -n panda-ev-prod \
  -o jsonpath='{.spec.template.spec.containers[0].livenessProbe}' \
  | python3 -m json.tool
```

### ຕິດຕາມແບບ realtime

```bash
# ເບິ່ງ pod status ທຸກ 5 ວິ
watch -n 5 'kubectl get pods -n panda-ev-prod | grep rabbitmq'

# ເບິ່ງ events ທຸກ 10 ວິ
watch -n 10 'kubectl get events -n panda-ev-prod \
  --sort-by=.lastTimestamp \
  --field-selector involvedObject.name=panda-rabbitmq-0 \
  | tail -10'
```

---

## 7. ຄຳສັ່ງ Test ການເຊື່ອມຕໍ່

### ເປີດ Port-Forward ໄປ Management UI

```bash
# ເປີດ terminal ໃໝ່ແລ້ວ run:
kubectl port-forward svc/panda-rabbitmq -n panda-ev-prod 15672:15672

# ຈາກນັ້ນເປີດ browser:
# http://localhost:15672
# Username: user
# Password: PVndAi2026iR3PP1
```

### Test AMQP ເຊື່ອມຕໍ່ດ້ວຍ curl (HTTP API)

```bash
# ເປີດ port-forward ກ່ອນ (ເບິ່ງຂ້າງເທິງ)
# ຈາກນັ້ນ test:

# ກວດສຸຂະພາບ node
curl -s -u user:PVndAi2026iR3PP1 \
  http://localhost:15672/api/healthchecks/node \
  | python3 -m json.tool
# ຕ້ອງໄດ້: {"status": "ok"}

# ລາຍຊື່ virtual hosts
curl -s -u user:PVndAi2026iR3PP1 \
  http://localhost:15672/api/vhosts \
  | python3 -m json.tool

# ລາຍຊື່ queues ທັງໝົດ
curl -s -u user:PVndAi2026iR3PP1 \
  http://localhost:15672/api/queues \
  | python3 -c "import sys,json; [print(q['name'], q.get('messages',0), 'msgs') for q in json.load(sys.stdin)]"

# ລາຍຊື່ connections
curl -s -u user:PVndAi2026iR3PP1 \
  http://localhost:15672/api/connections \
  | python3 -c "import sys,json; [print(c['name'], c['state']) for c in json.load(sys.stdin)]"

# overview stats (memory, message rates)
curl -s -u user:PVndAi2026iR3PP1 \
  http://localhost:15672/api/overview \
  | python3 -c "
import sys,json
d=json.load(sys.stdin)
print('Node:', d['node'])
print('Messages ready:', d['queue_totals'].get('messages_ready',0))
print('Connections:', d['object_totals']['connections'])
print('Queues:', d['object_totals']['queues'])
"
```

### Test ຈາກ pod ໃນ cluster ໂດຍກົງ

```bash
# exec ເຂົ້າ RabbitMQ pod
kubectl exec -it panda-rabbitmq-0 -n panda-ev-prod -- bash

# ພາຍໃນ pod — ກວດ diagnostics
rabbitmq-diagnostics check_running
rabbitmq-diagnostics check_local_alarms
rabbitmq-diagnostics memory_breakdown

# ກວດ queues
rabbitmqctl list_queues name messages consumers

# ກວດ connections
rabbitmqctl list_connections user peer_host peer_port state

# ອອກຈາກ pod
exit
```

### Test AMQP publish/consume (ຈາກ laptop)

```bash
# ຕ້ອງຕິດຕັ້ງ python pika ກ່ອນ
pip install pika

# ເປີດ port-forward AMQP
kubectl port-forward svc/panda-rabbitmq -n panda-ev-prod 5672:5672 &

# test publish + consume
python3 - <<'EOF'
import pika, sys

creds = pika.PlainCredentials('user', 'PVndAi2026iR3PP1')
params = pika.ConnectionParameters('localhost', 5672, '/', creds)

try:
    conn = pika.BlockingConnection(params)
    ch = conn.channel()
    ch.queue_declare(queue='test_ping', durable=False)

    # publish
    ch.basic_publish(exchange='', routing_key='test_ping', body='ping')
    print('✓ Published: ping')

    # consume 1 message
    method, props, body = next(ch.consume('test_ping', auto_ack=True))
    print(f'✓ Received: {body.decode()}')

    ch.queue_delete(queue='test_ping')
    conn.close()
    print('✓ AMQP connection OK')
except Exception as e:
    print(f'✗ Error: {e}', file=sys.stderr)
    sys.exit(1)
EOF
```

### ກວດ Queues ທີ່ Panda EV ໃຊ້

```bash
# ເປີດ port-forward management ກ່ອນ
kubectl port-forward svc/panda-rabbitmq -n panda-ev-prod 15672:15672 &

# ກວດທຸກ queue ທີ່ຮູ້ຈັກ
QUEUES=(
  PANDA_EV_QUEUE
  PANDA_EV_QUEUE_DLQ
  PANDA_EV_CSMS_COMMANDS
  PANDA_EV_NOTIFICATIONS
  PANDA_EV_NOTIFICATIONS_DLQ
  PANDA_EV_USER_EVENTS
  PANDA_EV_SYSTEM_EVENTS
  PANDA_EV_ADMIN_COMMANDS
  PANDA_EV_CHARGER_SYNC
  PANDA_EV_PAYMENT_COMMANDS
  PANDA_EV_PAYMENT_EVENTS
  PANDA_EV_SMS
)

echo "Queue Name | Messages | Consumers"
echo "-----------|----------|----------"
for q in "${QUEUES[@]}"; do
  result=$(curl -s -u user:PVndAi2026iR3PP1 \
    "http://localhost:15672/api/queues/%2F/$q" 2>/dev/null)
  msgs=$(echo "$result" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('messages',0))" 2>/dev/null || echo "not found")
  consumers=$(echo "$result" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('consumers',0))" 2>/dev/null || echo "-")
  echo "$q | $msgs | $consumers"
done
```

---

## 8. ການ Rotate Password

> ⚠ **ຄຳເຕືອນ**: ການ rotate password ຕ້ອງ update K8s secrets ຂອງທຸກ service ພ້ອມກັນ

```bash
# 1. ກຳນົດ password ໃໝ່
NEW_PASSWORD="NewP@ssw0rd2026"
NEW_ERLANG_COOKIE="NewC00k1eV@lue2026"

# 2. ອັບເດດ scripts/create-rabbitmq-secret.sh ດ້ວຍ password ໃໝ່
#    ແກ້ໄຂ 2 ບ່ອນ: rabbitmq-password ແລະ RABBITMQ_URL

# 3. ລຶບ secret ເກົ່າ + ສ້າງໃໝ່
bash scripts/create-rabbitmq-secret.sh

# 4. ອັບເດດ RABBITMQ_URL ໃນ service secrets ທຸກຕົວ
NEW_URL="amqp://user:${NEW_PASSWORD}@panda-rabbitmq.panda-ev-prod.svc.cluster.local:5672"
NEW_URL_B64=$(echo -n "$NEW_URL" | base64)

for secret in panda-system-api-secrets panda-mobile-api-secrets \
              panda-notification-api-secrets panda-gateway-api-secrets \
              panda-ocpp-api-secrets; do
  kubectl patch secret "$secret" -n panda-ev-prod \
    --type='json' \
    -p="[{\"op\":\"replace\",\"path\":\"/data/RABBITMQ_URL\",\"value\":\"${NEW_URL_B64}\"}]" \
    2>/dev/null || echo "skip: $secret (not found)"
done

# 5. Upgrade RabbitMQ ໃຫ້ reload password
helm upgrade panda-rabbitmq bitnami/rabbitmq \
  --namespace panda-ev-prod \
  --version 16.0.14 \
  -f scripts/rabbitmq-values.yaml

# 6. Restart ທຸກ NestJS service
kubectl rollout restart deployment \
  panda-system-api panda-mobile-api \
  panda-notification-api panda-gateway-api \
  panda-ocpp-api \
  -n panda-ev-prod
```

---

## 9. ການ Uninstall ແລະ ລ້າງຂໍ້ມູນ

```bash
# ⚠ ອ່ານຄຳເຕືອນກ່ອນ run

# Uninstall Helm release (ຮັກສາ PVC ໄວ້)
helm uninstall panda-rabbitmq -n panda-ev-prod

# ລຶບ secret
kubectl delete secret panda-rabbitmq-prod-secrets -n panda-ev-prod

# ລຶບ PVC (ຂໍ້ມູນ queue ຈະຫາຍ — ຕ້ອງຢືນຢັນກ່ອນ)
kubectl delete pvc data-panda-rabbitmq-0 -n panda-ev-prod
```

---

## 10. ຂໍ້ຜິດພາດທີ່ພົບເລື້ອຍ

| Error | ສາເຫດ | ການແກ້ໄຂ |
|-------|--------|----------|
| `/opt/bitnami/rabbitmq/secrets/rabbitmq-password: No such file or directory` | `usePasswordFiles: true` ແຕ່ secret ບໍ່ໄດ້ mount ເປັນ file | ຕັ້ງ `usePasswordFiles: false` |
| `Liveness probe failed: curl ... $(< $RABBITMQ_PASSWORD_FILE)` | ໃຊ້ `livenessProbe` key ແທນ `customLivenessProbe` — chart override probe | ປ່ຽນໄປໃຊ້ `customLivenessProbe` |
| `couldn't find key rabbitmq-password in Secret` | Secret ຂາດ key ທີ່ຈຳເປັນ | `bash scripts/create-rabbitmq-secret.sh` |
| `PASSWORDS ERROR: ... does not contain the key "rabbitmq-password"` | Secret ຖືກ recreate ໂດຍບໍ່ມີ key ທີ່ chart ຕ້ອງການ | recreate secret ດ້ວຍ 3 keys ຄົບ |
| Pod stuck `Pending` | PVC ບໍ່ສ້າງ (storageClass ບໍ່ຖືກ / quota ໝົດ) | `kubectl describe pvc data-panda-rabbitmq-0 -n panda-ev-prod` |
| Pod restart ຊ້ຳ `CrashLoopBackOff` | memory limit ຕ່ຳເກີນ ຫຼື erlang cookie ບໍ່ match | ເພີ່ມ memory limit ຫຼື recreate secret |
| Services ຕໍ່ RabbitMQ ບໍ່ໄດ້ | `RABBITMQ_URL` ຜິດ ໃນ service secret | patch RABBITMQ_URL ທຸກ service secret |

---

## Quick Reference

```bash
# ─── Deploy ───────────────────────────────────────────
bash scripts/create-rabbitmq-secret.sh
helm install panda-rabbitmq bitnami/rabbitmq -n panda-ev-prod --version 16.0.14 -f scripts/rabbitmq-values.yaml

# ─── Upgrade ──────────────────────────────────────────
bash scripts/create-rabbitmq-secret.sh
helm upgrade panda-rabbitmq bitnami/rabbitmq -n panda-ev-prod --version 16.0.14 -f scripts/rabbitmq-values.yaml

# ─── Status ───────────────────────────────────────────
kubectl get pods -n panda-ev-prod | grep rabbitmq
helm status panda-rabbitmq -n panda-ev-prod

# ─── Logs ─────────────────────────────────────────────
kubectl logs panda-rabbitmq-0 -n panda-ev-prod -f

# ─── Management UI ────────────────────────────────────
kubectl port-forward svc/panda-rabbitmq -n panda-ev-prod 15672:15672
# open: http://localhost:15672  (user / PVndAi2026iR3PP1)

# ─── AMQP port-forward ────────────────────────────────
kubectl port-forward svc/panda-rabbitmq -n panda-ev-prod 5672:5672
# amqp://user:PVndAi2026iR3PP1@localhost:5672
```
