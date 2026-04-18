# ການແກ້ໄຂ RabbitMQ Liveness Probe ແລະ Gateway Redis URL

**ວັນທີ**: 2026-04-17  
**Namespace**: `panda-ev-prod`

---

## ບັນຫາທີ 1 — RabbitMQ Liveness Probe ໃຊ້ `curl` ທີ່ຜິດ

### ອາການ

```
Liveness probe failed: /bin/bash: line 1: /opt/bitnami/rabbitmq/secrets/rabbitmq-password: No such file or directory
```

Pod ໃຊ້ probe ແບບ curl:
```
exec [/bin/bash -ec curl -f --user user:$(< $RABBITMQ_PASSWORD_FILE) 127.0.0.1:15672/...]
```

ທັງທີ່ StatefulSet YAML ສະແດງ probe ທີ່ຖືກຕ້ອງ (`rabbitmq-diagnostics -q check_running`)

### ສາເຫດ

Bitnami Helm chart ໃຊ້ key `livenessProbe.exec.command` ໂດຍ **merge** probe ຂອງ chart ຕົນເອງ (curl) ໄວ້ **ຫຼັງ** probe ທີ່ເຮົາໃສ່ໄປ. ໃນ YAML, duplicate key `exec` ລຽງຕ່ໍໝາຍ key ທຳອິດ — ດັ່ງນັ້ນ chart's probe ຈຶ່ງ override ຂອງເຮົາ.

```
helm get manifest panda-rabbitmq -n panda-ev-prod | grep -A15 "livenessProbe:"
# → ສະແດງ exec ສອງອັນ: ຂອງເຮົາກ່ອນ, ຂອງ chart ຕາມຫຼັງ (wins)
```

### ການແກ້ໄຂ

ໃຊ້ `customLivenessProbe` / `customReadinessProbe` ແທນ `livenessProbe` / `readinessProbe`.  
`customXxxProbe` **replace** probe template ທັງໝົດຂອງ chart, ບໍ່ merge.

**ໄຟລ໌**: `scripts/rabbitmq-values.yaml`

```yaml
customLivenessProbe:
  exec:
    command:
      - rabbitmq-diagnostics
      - -q
      - check_running
  initialDelaySeconds: 60
  periodSeconds: 30
  timeoutSeconds: 10
  failureThreshold: 6
  successThreshold: 1

customReadinessProbe:
  exec:
    command:
      - rabbitmq-diagnostics
      - -q
      - check_running
  initialDelaySeconds: 20
  periodSeconds: 10
  timeoutSeconds: 5
  failureThreshold: 3
  successThreshold: 1
```

### ຄຳສັ່ງທີ່ໃຊ້

```bash
# Secret ຖືກລຶບລ້າງ keys — recreate ກ່ອນ
bash scripts/create-rabbitmq-secret.sh

# Upgrade Helm release ດ້ວຍ values ໃໝ່
helm upgrade panda-rabbitmq bitnami/rabbitmq \
  --namespace panda-ev-prod \
  --version 16.0.14 \
  -f scripts/rabbitmq-values.yaml

# ລໍຖ້າ rollout
kubectl rollout status statefulset/panda-rabbitmq -n panda-ev-prod --timeout=120s
```

### ຜົນ

```
Liveness: exec [rabbitmq-diagnostics -q check_running] delay=60s timeout=10s period=30s #success=1 #failure=6
```

RabbitMQ pod: `Running`, `RESTARTS: 0`

---

## ບັນຫາທີ 2 — Gateway pod CrashLoopBackOff (Redis URL ຜິດ)

### ອາການ

```
ERROR [RedisService] Redis connection error: getaddrinfo ENOTFOUND redis-service.panda-ev.svc.cluster.local
ERROR [bootstrap] Failed to connect to Redis. Application startup aborted.
```

### ສາເຫດ

`panda-gateway-api-config` ConfigMap ມີ Redis URL ທີ່ໃຊ້ K8s service `redis-service.panda-ev` ທີ່ **ບໍ່ມີ** — Redis ຈິງໆແມ່ນ Cloud Memorystore ທີ່ `10.231.221.4:6379`.

Overlay `kubernetes/services/panda-ev-gateway-services/overlays/prod/kustomization.yaml` ມີ URL ຖືກຕ້ອງ (`redis://10.231.221.4:6379`) ແຕ່ **ບໍ່ໄດ້ reapply** ກ່ອນໜ້ານີ້.

### ການແກ້ໄຂ

```bash
# Apply overlay prod ທີ່ຖືກຕ້ອງ
kubectl apply -k kubernetes/services/panda-ev-gateway-services/overlays/prod

# Restart deployment ໃຫ້ pods ໃໝ່ໃຊ້ ConfigMap ທີ່ updated
kubectl rollout restart deployment/panda-gateway-api -n panda-ev-prod

# ລໍຖ້າ rollout
kubectl rollout status deployment/panda-gateway-api -n panda-ev-prod --timeout=90s
```

### ຜົນ

Gateway pods: `2/2 Running`, `RESTARTS: 0`

---

## ສະຖານະ Pod ສຸດທ້າຍ

```
NAME                                   READY   STATUS    RESTARTS
panda-gateway-api-*                    2/2     Running   0
panda-mobile-api-*                     3/3     Running   0
panda-notification-api-*               2/2     Running   0
panda-ocpp-api-*                       3/3     Running   0
panda-rabbitmq-0                       1/1     Running   0
panda-system-api-*                     2/2     Running   0
```

ທຸກ service ສະຖານະ **Running** ປົກກະຕິ.

---

## ຫຼັກການທີ່ຕ້ອງຈືໃຫ້ (Bitnami Helm)

| Key | ການເຮັດວຽກ |
|-----|-----------|
| `livenessProbe` | Merge ກັບ template ຂອງ chart — `exec` ທີ່ chart ໃສ່ຕາມຫຼັງຈະ override ຂອງເຮົາ |
| `customLivenessProbe` | **Replace** ທັງໝົດ — ໃຊ້ອັນນີ້ເມື່ອຕ້ອງການ override probe command |

ກົດດຽວກັນກັບ `readinessProbe` / `customReadinessProbe`.
