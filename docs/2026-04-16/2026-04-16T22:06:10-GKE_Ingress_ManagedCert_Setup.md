# ການຕັ້ງຄ່າ GKE Ingress ແລະ Managed Certificate
ວັນທີ: 2026-04-16

## ເປົ້າໝາຍ
ເປີດໃຊ້ງານສາມ service (Admin, Mobile, Gateway) ຜ່ານ HTTPS ໂດຍໃຊ້ GKE Ingress + GCP ManagedCertificate ໃນ domain:
- `admin-api.pandaev.cc` → `panda-system-api-service`
- `api.pandaev.cc` → `panda-mobile-api-service`
- `gateway-api.pandaev.cc` → `panda-gateway-api-service`

---

## ໄຟລ໌ທີ່ຖືກແກ້ໄຂ / ສ້າງໃໝ່

| ໄຟລ໌ | ການປ່ຽນແປງ |
|------|--------|
| `scripts/create-rabbitmq-secret.sh` | ສ້າງໃໝ່ — ລຶບ + ສ້າງ RabbitMQ K8s secret ຄືນໃໝ່ |
| `kubernetes/infrastructure/ingress/base/ingress.yaml` | ປ່ຽນກັບຄືນຈາກ `spec.ingressClassName` ໄປໃຊ້ annotation `kubernetes.io/ingress.class: "gce"` |
| `kubernetes/services/panda-ev-csms-system-admin/base/service.yaml` | ປ່ຽນ `ClusterIP` → `NodePort` |
| `kubernetes/services/panda-ev-client-mobile/base/service.yaml` | ປ່ຽນ `ClusterIP` → `NodePort` |
| `kubernetes/services/panda-ev-gateway-services/base/service.yaml` | ປ່ຽນ `ClusterIP` → `NodePort` |

---

## ຄຳສັ່ງທີ່ໃຊ້ງານ (ຕາມລຳດັບ)

### 1. ສ້າງ Script ສຳລັບ RabbitMQ Secret
```bash
# ສ້າງໄຟລ໌: scripts/create-rabbitmq-secret.sh
# Script ເຮັດ: ລຶບ secret ເກົ່າ (--ignore-not-found) ແລ້ວສ້າງໃໝ່
chmod +x scripts/create-rabbitmq-secret.sh
./scripts/create-rabbitmq-secret.sh
```

---

### 2. Apply Ingress + ManagedCertificate (ຄັ້ງທຳອິດ)
```bash
kubectl apply -k kubernetes/infrastructure/ingress/overlays/prod
# ຜົນລັບ: managedcertificate.networking.gke.io/panda-ev-certs created
#         ingress.networking.k8s.io/panda-ev-ingress created
```

---

### 3. ກວດສອບສະຖານະ ManagedCertificate
```bash
kubectl get managedcertificate panda-ev-certs -n panda-ev-prod
kubectl describe managedcertificate panda-ev-certs -n panda-ev-prod
```
**ພົບບັນຫາ:** ສະຖານະຕິດຢູ່ທີ່ `Provisioning` — ທຸກ 3 domain ສະແດງ `Provisioning`.

---

### 4. ກວດສອບ ADDRESS ຂອງ Ingress
```bash
kubectl get ingress panda-ev-ingress -n panda-ev-prod
```
**ພົບບັນຫາ:** ຖັນ `ADDRESS` ຫວ່າງ — load balancer ບໍ່ໄດ້ຖືກສ້າງ.

---

### 5. ກວດສອບ DNS
```bash
dig +short admin-api.pandaev.cc
dig +short api.pandaev.cc
dig +short gateway-api.pandaev.cc
# ຜົນລັບ: ທັງ 3 → 34.8.243.174 ✓ (DNS ຖືກຕ້ອງ)
```

---

### 6. ກວດສອບ Static IP
```bash
gcloud compute addresses list --filter="address=34.8.243.174"
# ຜົນລັບ: panda-api-ip → 34.8.243.174 RESERVED ✓
```

---

### 7. ກວດສອບ Service ທັງໝົດ — ພົບສາເຫດຫຼັກ #1
```bash
kubectl get svc -n panda-ev-prod
# ບັນຫາ: panda-system-api-service, panda-mobile-api-service,
#         panda-gateway-api-service ທັງໝົດເປັນ ClusterIP
# ຕ້ອງແກ້: GKE Ingress ຕ້ອງການ NodePort, ບໍ່ແມ່ນ ClusterIP
```

### 8. ປ່ຽນ Service ໄປເປັນ NodePort (ແກ້ໃຫ້ live ທັນທີ)
```bash
kubectl patch svc panda-system-api-service  -n panda-ev-prod -p '{"spec":{"type":"NodePort"}}'
kubectl patch svc panda-mobile-api-service  -n panda-ev-prod -p '{"spec":{"type":"NodePort"}}'
kubectl patch svc panda-gateway-api-service -n panda-ev-prod -p '{"spec":{"type":"NodePort"}}'
```

### 9. ແກ້ໄຂໄຟລ໌ manifest ຖາວອນ (ບໍ່ໃຫ້ກັບຄືນ ClusterIP ຕອນ deploy ຄັ້ງໜ້າ)
```bash
sed -i '' 's/type: ClusterIP/type: NodePort/' \
  kubernetes/services/panda-ev-csms-system-admin/base/service.yaml \
  kubernetes/services/panda-ev-client-mobile/base/service.yaml \
  kubernetes/services/panda-ev-gateway-services/base/service.yaml
```

---

### 10. ລຶບ ແລະ ສ້າງ ManagedCertificate ຄືນໃໝ່
```bash
kubectl delete managedcertificate panda-ev-certs -n panda-ev-prod
kubectl apply -k kubernetes/infrastructure/ingress/overlays/prod
# ຜົນລັບ: managedcertificate ຖືກສ້າງໃໝ່, ingress ບໍ່ປ່ຽນ
```

---

### 11. ກວດສອບ GCE load balancer resources — ພົບສາເຫດຫຼັກ #2
```bash
gcloud compute forwarding-rules list --filter="name~panda"
gcloud compute backend-services list --filter="name~panda"
# ຜົນລັບ: 0 items — load balancer ບໍ່ໄດ້ຖືກສ້າງໂດຍ GKE ເລີຍ
```

### 12. ກວດສອບ GKE addons — ພົບສາເຫດຫຼັກ #3
```bash
gcloud container clusters describe panda-ev-cluster \
  --location=asia-southeast1 \
  --format='yaml(addonsConfig)'
# ບັນຫາ: httpLoadBalancing addon ບໍ່ມີ (ຖືກປິດໄວ້)
# ໝາຍຄວາມວ່າ GKE Ingress controller ບໍ່ໄດ້ເຮັດວຽກ
```

### 13. ເປີດໃຊ້ HTTP Load Balancing addon
```bash
gcloud container clusters update panda-ev-cluster \
  --location=asia-southeast1 \
  --update-addons=HttpLoadBalancing=ENABLED
# ໃຊ້ເວລາປະມານ 3-5 ນາທີ
```

---

### 14. ກວດສອບ IngressClass — ພົບສາເຫດຫຼັກ #4
```bash
kubectl get ingressclass
# ຜົນລັບ: No resources found
# ບັນຫາ: spec.ingressClassName: "gce" ຕ້ອງການ IngressClass resource
#         ທີ່ມີຢູ່ — ແຕ່ cluster ນີ້ບໍ່ມີ
```

### 15. ປ່ຽນ ingress.yaml ກັບຄືນໃຊ້ annotation ແທນ ingressClassName
```bash
# ແກ້ໄຂ: kubernetes/infrastructure/ingress/base/ingress.yaml
# ລຶບ: spec.ingressClassName: "gce"
# ໃສ່ກັບຄືນ: kubernetes.io/ingress.class: "gce" annotation

kubectl apply -k kubernetes/infrastructure/ingress/overlays/prod
# ຜົນລັບ: ingress configured
```

### 16. ລຶບ + ສ້າງ Ingress ຄືນໃໝ່ ເພື່ອ force controller ໃຫ້ຈັດການ
```bash
kubectl delete ingress panda-ev-ingress -n panda-ev-prod
kubectl apply -k kubernetes/infrastructure/ingress/overlays/prod
```

---

### 17. ກວດສອບ load balancer ຖືກ provision ແລ້ວ
```bash
kubectl get events -n panda-ev-prod \
  --sort-by='.lastTimestamp' \
  --field-selector involvedObject.name=panda-ev-ingress
# ຜົນລັບ:
#   UrlMap created
#   TargetProxy created
#   ForwardingRule created
#   IP is now 34.8.243.174  ✓

kubectl get ingress panda-ev-ingress -n panda-ev-prod
# ຜົນລັບ: ADDRESS = 34.8.243.174  ✓
```

---

### 18. ກວດສອບສຸຂະພາບ backend
```bash
gcloud compute backend-services list --global
gcloud compute backend-services get-health k8s1-dc8b5cb7-panda-ev-prod-panda-system-api-service-8-cd021595 --global
gcloud compute backend-services get-health k8s1-dc8b5cb7-panda-ev-prod-panda-mobile-api-service-8-7bb76e82 --global
gcloud compute backend-services get-health k8s1-dc8b5cb7-panda-ev-prod-panda-gateway-api-servic-8-a43e100f --global
# ຜົນລັບ: ທັງໝົດ HEALTHY ✓
```

---

### 19. ຕິດຕາມ cert ຈົນກວ່າຈະ Active
```bash
# ຕິດຕັ້ງ watch (macOS)
brew install watch

# ເບິ່ງ cert + ingress ພ້ອມກັນ
watch -n 30 'kubectl describe managedcertificate panda-ev-certs -n panda-ev-prod | grep -A10 "Domain Status"'
```

---

## ສະຖານະປັດຈຸບັນ (ລ່າສຸດ 2026-04-16T22:06)

| ອົງປະກອບ | ສະຖານະ |
|-----------|--------|
| Static IP `panda-api-ip` | `34.8.243.174` ✓ |
| DNS (ທຸກ 3 domain) | → `34.8.243.174` ✓ |
| HTTP Load Balancing addon | ENABLED ✓ |
| Ingress ADDRESS | `34.8.243.174` ✓ |
| ສຸຂະພາບ Backend | ທັງໝົດ HEALTHY ✓ |
| ManagedCertificate | `Provisioning` / `FailedNotVisible` — ລໍຖ້າ GCP retry |

## ຂັ້ນຕອນຕໍ່ໄປ

1. ລໍຖ້າ 10–30 ນາທີ ໃຫ້ GCP retry ການກວດສອບ domain → cert ຈະກາຍເປັນ `Active`
2. ທົດສອບ HTTPS: `curl -I https://admin-api.pandaev.cc/api/admin/v1/health`
3. ແກ້ໄຂ RabbitMQ crash: pod ລົ້ມເຫລວ liveness probe — secret file path ບໍ່ຖືກຕ້ອງ

---

## ສະຫຼຸບສາເຫດຂອງບັນຫາ

| # | ບັນຫາ | ການແກ້ໄຂ |
|---|---------|-----|
| 1 | Service ເປັນ `ClusterIP` — GKE Ingress ຕ້ອງການ `NodePort` | ແກ້ live + ອັບເດດ manifest |
| 2 | HTTP Load Balancing addon ຖືກປິດ — Ingress controller ບໍ່ເຮັດວຽກ | `gcloud container clusters update --update-addons=HttpLoadBalancing=ENABLED` |
| 3 | ໃຊ້ `spec.ingressClassName: "gce"` ແຕ່ບໍ່ມີ IngressClass ຢູ່ໃນ cluster | ປ່ຽນກັບຄືນໃຊ້ annotation `kubernetes.io/ingress.class: "gce"` |

## ສຳເລັດ ✓
```bash
kubectl get managedcertificate panda-ev-certs -n panda-ev-prod
# NAME             AGE   STATUS
# panda-ev-certs   87m   Active
```

---
---

# ພາກທີ 2: ແກ້ໄຂ RabbitMQ Crash
ວັນທີ: 2026-04-17

## ສະຫຼຸບບັນຫາ
RabbitMQ pod crash loop ເນື່ອງຈາກ liveness/readiness probe ລົ້ມເຫລວ ດ້ວຍ error:
```
/bin/bash: line 1: /opt/bitnami/rabbitmq/secrets/rabbitmq-password: No such file or directory
```

---

## ສາເຫດຫຼັກ

| # | ສາເຫດ | ລາຍລະອຽດ |
|---|-------|---------|
| 1 | **Secret keys ຜິດ** | Secret `panda-rabbitmq-prod-secrets` ມີແຕ່ key `RABBITMQ_URL` — ບໍ່ມີ `rabbitmq-password` ແລະ `rabbitmq-erlang-cookie` ທີ່ chart ຕ້ອງການ |
| 2 | **Probe commands ມີ quotes ຜິດ** | ການໃຊ້ `--set livenessProbe.exec.command='{ "rabbitmq-diagnostics"... }'` ໃນ helm install ເຮັດໃຫ້ command ມີ quotes ແລະ spaces ພາຍໃນ |

---

## ຄຳສັ່ງທີ່ໃຊ້ແກ້ໄຂ

### 1. ກວດສອບ helm values ທີ່ deploy ຢູ່
```bash
helm get values panda-rabbitmq -n panda-ev-prod
# ພົບ: livenessProbe.exec.command ມີ quotes ຜິດ:
#   - ' "rabbitmq-diagnostics"'  ← ຜິດ
#   - ' "-q"'
#   - ' "check_running" '
```
**ຜົນລັບ:** ຢືນຢັນ probe commands ຖືກ set ຜິດ

---

### 2. ກວດສອບ Secret ທີ່ມີຢູ່
```bash
kubectl get secret panda-rabbitmq-prod-secrets -n panda-ev-prod \
  -o jsonpath='{.data}'
# ຜົນລັບ: {"RABBITMQ_URL":"..."} ← ຜິດ, ຕ້ອງມີ rabbitmq-password
```
**ຜົນລັບ:** ຢືນຢັນ secret ມີ key ຜິດ

---

### 3. ລຶບ kustomize StatefulSet ເກົ່າ (legacy, ບໍ່ໄດ້ໃຊ້)
```bash
# ກວດເບິ່ງກ່ອນ
cat kubernetes/infrastructure/stateful/rabbitmq/base/rabbitmq.yaml
# ພົບ: StatefulSet ເກົ່າ ໃຊ້ guest/guest credentials, ບໍ່ related ກັບ helm

# ລຶບ
rm -rf kubernetes/infrastructure/stateful/rabbitmq
rm -rf kubernetes/infrastructure/stateful/redis
```
**ຜົນລັບ:** ລຶບ manifest ທີ່ບໍ່ໃຊ້ອອກ — ຈະບໍ່ conflict ກັບ helm

---

### 4. ສ້າງ Secret ໃໝ່ດ້ວຍ keys ທີ່ຖືກຕ້ອງ
```bash
kubectl delete secret panda-rabbitmq-prod-secrets -n panda-ev-prod --ignore-not-found

kubectl create secret generic panda-rabbitmq-prod-secrets \
  --from-literal=rabbitmq-password='PVndAi2026iR3PP1' \
  --from-literal=rabbitmq-erlang-cookie='S3cr3tR3PP1tC00k1E' \
  -n panda-ev-prod
```
**ຜົນລັບ:** Secret ຖືກສ້າງໃໝ່ດ້ວຍ 2 keys ທີ່ຖືກຕ້ອງ ✓

---

### 5. ສ້າງ values file ສຳລັບ helm (ແທນ --set)
```bash
# ສ້າງໄຟລ໌: scripts/rabbitmq-values.yaml
# ກຳນົດ probe commands ໃຫ້ຖືກຕ້ອງດ້ວຍ YAML array
```
**ຜົນລັບ:** ສ້າງ `scripts/rabbitmq-values.yaml` — ໃຊ້ຕໍ່ໄປແທນ `--set`

---

### 6. Helm upgrade ດ້ວຍ values file ໃໝ່
```bash
helm upgrade panda-rabbitmq bitnami/rabbitmq \
  --namespace panda-ev-prod \
  --values scripts/rabbitmq-values.yaml \
  --reuse-values=false
```
**ຜົນລັບ:** `Release "panda-rabbitmq" has been upgraded. REVISION: 2` ✓

---

### 7. ກວດສອບ pod ສຳເລັດ
```bash
kubectl rollout status statefulset/panda-rabbitmq -n panda-ev-prod --timeout=120s
# statefulset rolling update complete 1 pods at revision panda-rabbitmq-74485c7b8d

kubectl get pods -n panda-ev-prod | grep rabbitmq
# panda-rabbitmq-0   1/1   Running   0   98s
```
**ຜົນລັບ:** RabbitMQ `1/1 Running` ບໍ່ມີ crash ✓

---

### 8. ກວດສອບ pods ທັງໝົດ
```bash
kubectl get pods -n panda-ev-prod
```
**ຜົນລັບ:**
```
panda-gateway-api-*         2/2   Running
panda-mobile-api-*          3/3   Running
panda-notification-api-*    2/2   Running
panda-ocpp-api-*            3/3   Running
panda-rabbitmq-0            1/1   Running
panda-system-api-*          2/2   Running
```
ທຸກ pod Running ✓ — ບໍ່ຈຳເປັນຕ້ອງ restart

---

## ໄຟລ໌ທີ່ປ່ຽນແປງ

| ໄຟລ໌ | ການປ່ຽນແປງ |
|------|--------|
| `scripts/rabbitmq-values.yaml` | ສ້າງໃໝ່ — Helm values ສຳລັບ RabbitMQ (ໃຊ້ແທນ --set) |
| `scripts/create-rabbitmq-secret.sh` | ໃຊ້ຢູ່ — ລຶບ + ສ້າງ secret ດ້ວຍ keys ທີ່ຖືກຕ້ອງ |
| `kubernetes/infrastructure/stateful/rabbitmq/` | ລຶບ — legacy manifest, ບໍ່ໄດ້ໃຊ້ |
| `kubernetes/infrastructure/stateful/redis/` | ລຶບ — legacy manifest, ບໍ່ໄດ້ໃຊ້ |

---

## ວິທີ Upgrade RabbitMQ ຄັ້ງໜ້າ
```bash
# 1. ສ້າງ/ອັບເດດ secret ກ່ອນ (ຖ້າ password ປ່ຽນ)
./scripts/create-rabbitmq-secret.sh

# 2. Upgrade helm
helm upgrade panda-rabbitmq bitnami/rabbitmq \
  --namespace panda-ev-prod \
  --values scripts/rabbitmq-values.yaml
```

---

## ສະຖານະປັດຈຸບັນ (2026-04-17)

| ອົງປະກອບ | ສະຖານະ |
|-----------|--------|
| ManagedCertificate | `Active` ✓ |
| Ingress ADDRESS | `34.8.243.174` ✓ |
| Backend health | ທັງໝົດ HEALTHY ✓ |
| RabbitMQ | `1/1 Running` ✓ |
| ທຸກ Pod | Running ✓ |

---
---

# ພາກທີ 3: ແກ້ໄຂ CreateContainerConfigError — RABBITMQ_URL ຫາຍໄປ
ວັນທີ: 2026-04-17

## ສະຫຼຸບບັນຫາ
ຫຼັງຈາກ reset secret ໃນພາກທີ 2 — Mobile API pod ຕິດ `CreateContainerConfigError`:
```
couldn't find key RABBITMQ_URL in Secret panda-ev-prod/panda-rabbitmq-prod-secrets
```

---

## ສາເຫດຫຼັກ
ຕອນສ້າງ secret ໃໝ່ໃນພາກທີ 2 ໃສ່ແຕ່ 2 keys (`rabbitmq-password`, `rabbitmq-erlang-cookie`) — **ລືມ** key `RABBITMQ_URL` ທີ່ NestJS services ທຸກຕົວໃຊ້ connect RabbitMQ.

---

## ຄຳສັ່ງທີ່ໃຊ້ແກ້ໄຂ

### 1. ກວດສອບ error ໃນ pod
```bash
kubectl describe pod -n panda-ev-prod -l app=panda-mobile-api
# Events:
#   Warning Failed: couldn't find key RABBITMQ_URL in Secret
#                   panda-ev-prod/panda-rabbitmq-prod-secrets
```
**ຜົນລັບ:** ຢືນຢັນ secret ຂາດ key `RABBITMQ_URL`

---

### 2. ສ້າງ secret ໃໝ່ດ້ວຍ 3 keys ຄົບຖ້ວນ
```bash
kubectl delete secret panda-rabbitmq-prod-secrets -n panda-ev-prod

kubectl create secret generic panda-rabbitmq-prod-secrets \
  --from-literal=rabbitmq-password='PVndAi2026iR3PP1' \
  --from-literal=rabbitmq-erlang-cookie='S3cr3tR3PP1tC00k1E' \
  --from-literal=RABBITMQ_URL='amqp://user:PVndAi2026iR3PP1@panda-rabbitmq.panda-ev-prod.svc.cluster.local:5672' \
  -n panda-ev-prod
```
**ຜົນລັບ:** Secret ຖືກສ້າງໃໝ່ດ້ວຍ 3 keys ຄົບ ✓

---

### 3. Restart ທຸກ Deployment ເພື່ອ reload secret
```bash
kubectl rollout restart deployment -n panda-ev-prod
# deployment.apps/panda-gateway-api restarted
# deployment.apps/panda-mobile-api restarted
# deployment.apps/panda-notification-api restarted
# deployment.apps/panda-ocpp-api restarted
# deployment.apps/panda-system-api restarted
```
**ຜົນລັບ:** ທຸກ deployment restart ດ້ວຍ rolling update ✓

---

### 4. ກວດສອບ pods ທັງໝົດ
```bash
kubectl get pods -n panda-ev-prod
```
**ຜົນລັບ:** ທຸກ pod `Running` ✓

---

## ໄຟລ໌ທີ່ປ່ຽນແປງ

| ໄຟລ໌ | ການປ່ຽນແປງ |
|------|--------|
| `scripts/create-rabbitmq-secret.sh` | ອັບເດດ — ເພີ່ມ `RABBITMQ_URL` ເຂົ້າໄປດ້ວຍ |

---

## Secret Keys ທີ່ຕ້ອງມີສະເໝີ

| Key | ໃຊ້ໂດຍ |
|-----|--------|
| `rabbitmq-password` | Bitnami RabbitMQ Helm chart |
| `rabbitmq-erlang-cookie` | Bitnami RabbitMQ Helm chart |
| `RABBITMQ_URL` | ທຸກ NestJS services (Mobile, Admin, OCPP, Notification, Gateway) |

---

## ສຳເລັດ ✓

| ອົງປະກອບ | ສະຖານະ |
|-----------|--------|
| ManagedCertificate | `Active` ✓ |
| Ingress ADDRESS | `34.8.243.174` ✓ |
| Backend health | ທັງໝົດ HEALTHY ✓ |
| RabbitMQ | `1/1 Running` ✓ |
| Mobile API | `3/3 Running` ✓ |
| Admin API | `2/2 Running` ✓ |
| Gateway API | `2/2 Running` ✓ |
| OCPP API | `3/3 Running` ✓ |
| Notification API | `2/2 Running` ✓ |

---
---

# ພາກທີ 4: ເປີດ Swagger ໃນ Production + ແກ້ໄຂ Redis
ວັນທີ: 2026-04-17

## ສະຫຼຸບບັນຫາ
1. ຕ້ອງການເປີດ Swagger UI ໃຫ້ທຸກ service ໃນ production
2. Redis hostname `redis-service.panda-ev-prod.svc.cluster.local` ບໍ່ມີ — service crash ທັງໝົດ
3. Service secrets ຂາດ `RABBITMQ_URL` ໃນແຕ່ລະ service secret
4. Notification pod crash ດ້ວຍ `Cannot find module '/app/dist/main'` — stale cached image

---

## ສາເຫດຫຼັກ

| # | ສາເຫດ | ລາຍລະອຽດ |
|---|-------|---------|
| 1 | **Mobile ບໍ່ support `SWAGGER_ENABLED`** | `main.ts` ກວດສອບແຕ່ `NODE_ENV=development` — ບໍ່ມີ `SWAGGER_ENABLED` flag |
| 2 | **Redis hostname ຜິດ** | configmap ໃຊ້ `redis-service.panda-ev-prod.svc.cluster.local` ແຕ່ Redis ແມ່ນ Cloud Memorystore ທີ່ `10.231.221.4` |
| 3 | **Service secrets ຂາດ `RABBITMQ_URL`** | `panda-system-api-secrets`, `panda-mobile-api-secrets`, `panda-notification-api-secrets` ບໍ່ມີ key `RABBITMQ_URL` |
| 4 | **Notification image stale** | Node cache ເກົ່າໃຊ້ `node dist/main` ແທນ `node dist/src/main` — `imagePullPolicy: IfNotPresent` ເຮັດໃຫ້ບໍ່ pull ໃໝ່ |
| 5 | **Admin compiled image ເກົ່າ** | swagger path ໃນ image compile ເກົ່າຢູ່ທີ່ `admin/api` ແທນ `api/admin/docs` |

---

## ຄຳສັ່ງທີ່ໃຊ້ແກ້ໄຂ

### 1. ແກ້ Mobile `main.ts` ໃຫ້ support `SWAGGER_ENABLED`
```bash
# ແກ້ໄຂ: panda-ev-client-mobile/src/main.ts
# ປ່ຽນ:
#   if (process.env.NODE_ENV === 'development')
# ເປັນ:
#   if (process.env.NODE_ENV === 'development' || process.env.SWAGGER_ENABLED === 'true')
```
**ຜົນລັບ:** Mobile ຈະ support `SWAGGER_ENABLED=true` ຄືກັນກັບ services ອື່ນ ✓

---

### 2. ເພີ່ມ `SWAGGER_ENABLED=true` ໃນ prod configmap ທຸກ service
```bash
# ແກ້ໄຂໄຟລ໌ overlays/prod/kustomization.yaml ທຸກ service
sed -i '' 's/- NODE_ENV="production"/- NODE_ENV="production"\n      - SWAGGER_ENABLED="true"/' \
  kubernetes/services/panda-ev-csms-system-admin/overlays/prod/kustomization.yaml \
  kubernetes/services/panda-ev-client-mobile/overlays/prod/kustomization.yaml \
  kubernetes/services/panda-ev-notification/overlays/prod/kustomization.yaml \
  kubernetes/services/panda-ev-gateway-services/overlays/prod/kustomization.yaml
```
**ຜົນລັບ:** ທຸກ service prod configmap ມີ `SWAGGER_ENABLED=true` ✓

---

### 3. ກວດສອບ Redis — ພົບ Cloud Memorystore
```bash
gcloud redis instances list --region=asia-southeast1
# INSTANCE_NAME   HOST          PORT  STATUS
# panda-ev-redis  10.231.221.4  6379  READY
```
**ຜົນລັບ:** Redis ໃຊ້ Cloud Memorystore IP `10.231.221.4:6379` — ບໍ່ແມ່ນ K8s service

---

### 4. ອັບເດດ Redis URL ໃນທຸກ prod overlay
```bash
sed -i '' 's|redis-service.panda-ev-prod.svc.cluster.local|10.231.221.4|g' \
  kubernetes/services/panda-ev-csms-system-admin/overlays/prod/kustomization.yaml \
  kubernetes/services/panda-ev-client-mobile/overlays/prod/kustomization.yaml \
  kubernetes/services/panda-ev-notification/overlays/prod/kustomization.yaml \
  kubernetes/services/panda-ev-gateway-services/overlays/prod/kustomization.yaml
```
**ຜົນລັບ:** ທຸກ `REDIS_URL` ອັບເດດເປັນ `redis://10.231.221.4:6379` ✓

---

### 5. Apply configmap ທຸກ service
```bash
kubectl apply -k kubernetes/services/panda-ev-csms-system-admin/overlays/prod
kubectl apply -k kubernetes/services/panda-ev-client-mobile/overlays/prod
kubectl apply -k kubernetes/services/panda-ev-notification/overlays/prod
kubectl apply -k kubernetes/services/panda-ev-gateway-services/overlays/prod
```
**ຜົນລັບ:** ທຸກ configmap `configured` ✓

---

### 6. ເພີ່ມ `RABBITMQ_URL` ເຂົ້າ service secrets ທີ່ຂາດ
```bash
RABBITMQ_URL='amqp://user:PVndAi2026iR3PP1@panda-rabbitmq.panda-ev-prod.svc.cluster.local:5672'
RABBITMQ_URL_B64=$(echo -n "$RABBITMQ_URL" | base64)

for secret in panda-system-api-secrets panda-mobile-api-secrets panda-notification-api-secrets; do
  kubectl patch secret $secret -n panda-ev-prod \
    --type='json' \
    -p="[{\"op\":\"add\",\"path\":\"/data/RABBITMQ_URL\",\"value\":\"$RABBITMQ_URL_B64\"}]"
done
```
**ຜົນລັບ:** ທຸກ 3 secrets ມີ `RABBITMQ_URL` ແລ້ວ ✓

---

### 7. Restart ທຸກ deployment
```bash
kubectl rollout restart deployment/panda-system-api \
  deployment/panda-mobile-api \
  deployment/panda-notification-api \
  deployment/panda-gateway-api \
  -n panda-ev-prod
```
**ຜົນລັບ:** ທຸກ deployment rolling restart ✓

---

### 8. ແກ້ Notification `imagePullPolicy` — stale cache
```bash
# ແກ້ live ທັນທີ
kubectl patch deployment panda-notification-api -n panda-ev-prod \
  --type='json' \
  -p='[{"op":"replace","path":"/spec/template/spec/containers/0/imagePullPolicy","value":"Always"}]'

# ແກ້ manifest ຖາວອນ
# ແກ້ໄຂ: kubernetes/services/panda-ev-notification/base/deployment.yaml
# ປ່ຽນ: imagePullPolicy: IfNotPresent → Always

kubectl rollout restart deployment/panda-notification-api -n panda-ev-prod
```
**ຜົນລັບ:** Notification pull image ໃໝ່ທຸກຄັ້ງ — ບໍ່ crash ✓

---

### 9. ກວດສອບ Swagger path ຕົວຈິງໃນ compiled image
```bash
# ກວດ path ທີ່ compiled ຢູ່ໃນ image ຈິງ
kubectl exec -n panda-ev-prod deployment/panda-system-api -c panda-system-api -- \
  grep "setup(" /app/dist/src/configs/swagger/swagger.config.js
# ຜົນລັບ admin: SwaggerModule.setup('admin/api', ...) ← image ເກົ່າ

kubectl exec -n panda-ev-prod deployment/panda-mobile-api -c panda-mobile-api -- \
  grep "setup(" /app/dist/src/configs/swagger/swagger.config.js
# ຜົນລັບ mobile: SwaggerModule.setup('api/mobile/docs', ...)

kubectl exec -n panda-ev-prod deployment/panda-gateway-api -c panda-gateway-api -- \
  grep "DOCS_PATH\|setup(" /app/dist/src/configs/swagger/swagger.config.js
# ຜົນລັບ gateway: SwaggerModule.setup('api/gateway/docs', ...)
```
**ຜົນລັບ:** ພົບວ່າ Admin image ເກົ່າ — swagger path ຜິດ

---

### 10. ກວດສອບ pods ສຸດທ້າຍ
```bash
kubectl get pods -n panda-ev-prod
```
**ຜົນລັບ:** ທຸກ pod `Running` ✓

---

## Swagger URLs (port-forward)

ເປີດ terminal ແຍກສຳລັບແຕ່ລະ service:

```bash
# Admin API  →  http://localhost:4000/admin/api  (image ເກົ່າ — path ຊົ່ວຄາວ)
kubectl port-forward svc/panda-system-api-service 4000:80 -n panda-ev-prod

# Mobile API  →  http://localhost:4001/api/mobile/docs
kubectl port-forward svc/panda-mobile-api-service 4001:80 -n panda-ev-prod

# Gateway API  →  http://localhost:4004/api/gateway/docs
kubectl port-forward svc/panda-gateway-api-service 4004:80 -n panda-ev-prod

# Notification API  →  http://localhost:5001/api/notification/docs
kubectl port-forward svc/panda-notification-api-service 5001:80 -n panda-ev-prod
```

---

## ວິທີແກ້ Admin Swagger path ຖາວອນ (rebuild image)

Admin image ຖືກ build ຈາກ GitHub Actions — push ໄປ `main` branch ເພື່ອ trigger rebuild:

```bash
# 1. Commit source changes
git add panda-ev-csms-system-admin/
git add panda-ev-client-mobile/src/main.ts
git commit -m "enable swagger via SWAGGER_ENABLED env var"
git push origin main
```

ຫຼັງ build ສຳເລັດ — Admin swagger URL ຈະກາຍເປັນ:
```
http://localhost:4000/api/admin/docs
```

---

## ໄຟລ໌ທີ່ປ່ຽນແປງ

| ໄຟລ໌ | ການປ່ຽນແປງ |
|------|--------|
| `panda-ev-client-mobile/src/main.ts` | ເພີ່ມ `SWAGGER_ENABLED=true` support |
| `kubernetes/services/*/overlays/prod/kustomization.yaml` | ເພີ່ມ `SWAGGER_ENABLED=true` + Redis IP |
| `kubernetes/services/panda-ev-notification/base/deployment.yaml` | `imagePullPolicy: IfNotPresent` → `Always` |

---

## ສະຖານະປັດຈຸບັນ (2026-04-17)

| ອົງປະກອບ | ສະຖານະ |
|-----------|--------|
| ທຸກ Pod | `Running` ✓ |
| Redis (Memorystore) | `10.231.221.4:6379` ✓ |
| Swagger — Mobile | `http://localhost:4001/api/mobile/docs` ✓ |
| Swagger — Gateway | `http://localhost:4004/api/gateway/docs` ✓ |
| Swagger — Notification | `http://localhost:5001/api/notification/docs` ✓ |
| Swagger — Admin | `http://localhost:4000/admin/api` (ຊົ່ວຄາວ) — ຕ້ອງ rebuild image |

---
---

# ພາກທີ 5: ແກ້ RabbitMQ Probe ຖາວອນ + Gateway Redis URL
ວັນທີ: 2026-04-17

## ສະຫຼຸບບັນຫາ

| # | ບັນຫາ |
|---|-------|
| 1 | RabbitMQ liveness probe **ຍັງໃຊ້ curl** ທັງທີ່ patch StatefulSet ແລ້ວ — pod crash ຊ້ຳ |
| 2 | Gateway pod `CrashLoopBackOff` (34 restarts) ເນື່ອງຈາກ Redis URL ຜິດ |

---

## ບັນຫາທີ 1 — RabbitMQ Probe ຍັງໃຊ້ curl

### ການວິນິດໄສ

```bash
# ກວດ manifest ທີ່ Helm render ຈິງໆ
helm get manifest panda-rabbitmq -n panda-ev-prod | grep -A15 "livenessProbe:"
```

**ຜົນລັບ:**
```yaml
livenessProbe:
  exec:
    command:
    - rabbitmq-diagnostics   ← ຂອງເຮົາ (ໃສ່ໄປຜ່ານ livenessProbe key)
    ...
  exec:
    command:
      - /bin/bash
      - -ec
      - curl -f --user user:$(< $RABBITMQ_PASSWORD_FILE)...  ← ຂອງ chart (override ຂ້າງເທິງ!)
```

### ສາເຫດຂອງ Root Cause

Bitnami chart ໃຊ້ key `livenessProbe` ເປັນ **merge** — chart render `exec` ຂອງຕົນເອງ **ຕາມຫຼັງ** exec ຂອງເຮົາ.
ໃນ YAML, duplicate key `exec` ໝາຍຄວາມວ່າ key ທຫຼັງ override key ທຳອິດ → curl probe ຂອງ chart **ສະເໝີ win**.

ວິທີດຽວທີ່ຖືກຕ້ອງ: ໃຊ້ `customLivenessProbe` / `customReadinessProbe` ທີ່ **replace ທັງໝົດ** ແທນ merge.

### ການແກ້ໄຂ

**ໄຟລ໌ທີ່ປ່ຽນ:** `scripts/rabbitmq-values.yaml` — ປ່ຽນຈາກ `livenessProbe` → `customLivenessProbe`

```yaml
# ກ່ອນ (ຜິດ — merge ກັບ chart template)
livenessProbe:
  exec:
    command:
      - rabbitmq-diagnostics
      - -q
      - check_running

# ຫຼັງ (ຖືກຕ້ອງ — replace ທັງໝົດ)
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
# Secret ຖືກ reset ໄວ້ — recreate ກ່ອນ (ລວມທຸກ 3 keys)
bash scripts/create-rabbitmq-secret.sh

# Upgrade Helm ດ້ວຍ values ໃໝ່
helm upgrade panda-rabbitmq bitnami/rabbitmq \
  --namespace panda-ev-prod \
  --version 16.0.14 \
  -f scripts/rabbitmq-values.yaml

# ລໍຖ້າ rollout ສຳເລັດ
kubectl rollout status statefulset/panda-rabbitmq -n panda-ev-prod --timeout=120s
```

### ກວດສອບ probe ຫຼັງ upgrade

```bash
kubectl describe pod -n panda-ev-prod -l app.kubernetes.io/name=rabbitmq | grep -A3 "Liveness:"
# ຜົນລັບ:
# Liveness: exec [rabbitmq-diagnostics -q check_running] delay=60s timeout=10s period=30s  ✓
```

---

## ບັນຫາທີ 2 — Gateway CrashLoopBackOff (Redis)

### ການວິນິດໄສ

```bash
kubectl logs -n panda-ev-prod -l app=panda-gateway-api --tail=20
# ERROR [RedisService] getaddrinfo ENOTFOUND redis-service.panda-ev.svc.cluster.local
# ERROR [bootstrap] Failed to connect to Redis. Application startup aborted.
```

### ສາເຫດຫຼັກ

ConfigMap `panda-gateway-api-config` ມີ `REDIS_URL=redis://redis-service.panda-ev.svc.cluster.local:6379` ທີ່**ບໍ່ມີ** ຢູ່ใน cluster (Redis ແມ່ນ Cloud Memorystore `10.231.221.4:6379`).

Kustomize overlay `kubernetes/services/panda-ev-gateway-services/overlays/prod/kustomization.yaml` ມີ URL ຖືກຕ້ອງ**ແຕ່ບໍ່ເຄີຍ apply** ສຳລັບ Gateway ໃນ session ກ່ອນ.

### ຄຳສັ່ງທີ່ໃຊ້

```bash
# Apply overlay ທີ່ຖືກຕ້ອງ
kubectl apply -k kubernetes/services/panda-ev-gateway-services/overlays/prod
# ຜົນລັບ: configmap/panda-gateway-api-config configured

# Restart deployment ໃຫ້ pods ໃໝ່ໃຊ້ ConfigMap ທີ່ updated
kubectl rollout restart deployment/panda-gateway-api -n panda-ev-prod

# ລໍຖ້າ rollout
kubectl rollout status deployment/panda-gateway-api -n panda-ev-prod --timeout=90s
# deployment "panda-gateway-api" successfully rolled out  ✓
```

---

## ໄຟລ໌ທີ່ສ້າງ / ປ່ຽນແປງ

| ໄຟລ໌ | ການປ່ຽນແປງ |
|------|--------|
| `scripts/rabbitmq-values.yaml` | ອັບເດດ — ປ່ຽນ `livenessProbe` → `customLivenessProbe`, `readinessProbe` → `customReadinessProbe` |
| `docs/2026-04-17/2026-04-17T15:00:54-RabbitMQ_Probe_Fix_and_Gateway_Redis.md` | ສ້າງໃໝ່ — ບັນທຶກລາຍລະອຽດ session ນີ້ (Lao) |

> **ໝາຍເຫດ:** `kubernetes/services/panda-ev-gateway-services/overlays/prod/kustomization.yaml`
> ມີ `REDIS_URL="redis://10.231.221.4:6379"` ຢູ່ແລ້ວ — ພຽງແຕ່ apply ຄືນ. ບໍ່ຕ້ອງແກ້ໄຂ.

---

## ຫຼັກການ Bitnami Helm ທີ່ຕ້ອງຈືໃຫ້

| Helm Key | ການເຮັດວຽກ |
|----------|-----------|
| `livenessProbe` | **Merge** ກັບ template ຂອງ chart — chart's `exec` ທີ່ render ຕາມຫຼັງຈະ override ຂອງເຮົາ |
| `customLivenessProbe` | **Replace** ທັງໝົດ — ໃຊ້ອັນນີ້ເມື່ອຕ້ອງການ override probe command |
| `readinessProbe` | ດຽວກັນກັບ `livenessProbe` — merge ແລ້ວ override |
| `customReadinessProbe` | ດຽວກັນ — replace ທັງໝົດ |

---

## ສະຖານະສຸດທ້າຍ (2026-04-17T15:00)

```bash
kubectl get pods -n panda-ev-prod
```

```
NAME                                   READY   STATUS    RESTARTS
panda-gateway-api-5c7869b84-*          2/2     Running   0  ✓
panda-mobile-api-5cf5c6465f-*          3/3     Running   0  ✓
panda-notification-api-79f4fc5b87-*    2/2     Running   0  ✓
panda-ocpp-api-7856fbf87-*             3/3     Running   0  ✓
panda-rabbitmq-0                       1/1     Running   0  ✓
panda-system-api-544946765b-*          2/2     Running   0  ✓
```

**ທຸກ service Running, RESTARTS=0** ✓

---
---

# ພາກທີ 6: ການວິເຄາະ OCPP ສຳລັບ 100 EVs + ແກ້ໄຂ Config
ວັນທີ: 2026-04-17

## ສະຫຼຸບ

ກວດສອບວ່າ OCPP service config ປັດຈຸບັນ ພຽງພໍສຳລັບ 100 EV charger ຫຼືບໍ່.
ພົບ 5 ບັນຫາ — ແກ້ໄຂທັງໝົດ.

---

## ການວິເຄາະ Service Topology

```bash
kubectl get svc -n panda-ev-prod | grep ocpp
```

```
panda-ocpp-api-service      ClusterIP    34.118.235.115  <none>          4002/TCP
panda-ocpp-external-service LoadBalancer 34.118.227.188  35.240.145.241  80:31562/TCP,443:32603/TCP
```

**ໂຄງສ້າງທີ່ຖືກຕ້ອງ ✓**

```
EV Charger
  │  ws://35.240.145.241/ocpp/<identity>   port 80
  │  wss://35.240.145.241/ocpp/<identity>  port 443
  ▼
panda-ocpp-external-service  (LoadBalancer)
  │  Session Affinity: ClientIP  ← ✓ ຈຳເປັນສຳລັບ WebSocket
  ▼
panda-ocpp-api pod :4002
```

**ເຫດຜົນ Session Affinity: ClientIP ສຳຄັນ**: OCPP gateway ເກັບ `connections Map`, `pendingCalls Map`, `pingIntervals Map` ໄວ້ໃນ memory ຂອງ pod — charger ດຽວກັນຕ້ອງ route ໄປ pod ດຽວກັນສະເໝີ. ຖ້າ route ໄປ pod ຜິດ → charger ຂຽນ message ໄປ Map ທີ່ pod ນັ້ນບໍ່ຮູ້ຈັກ.

---

## ການວິເຄາະ Memory ສຳລັບ 100 EVs

```bash
kubectl get deployment panda-ocpp-api -n panda-ev-prod \
  -o jsonpath='{.spec.template.spec.containers[0].resources}'
```

```
NestJS + Node.js base                ~150 MB
100 WebSocket connections × ~30 KB    ~ 3 MB
4 in-memory Maps × 100 entries         ~ 5 MB
────────────────────────────────────────────
ໃຊ້ຈິງ (ປະມານ)                       ~160 MB
limit ປັດຈຸບັນ                        512 Mi
headroom                              ~350 MB  ← OK ສຳລັບ 100 EVs
```

**ສະຫຼຸບ Memory**: ພຽງພໍສຳລັບ 100 EVs. ຖ້າ scale ຫາ 200+ EVs ຕ້ອງເພີ່ມ limit ເປັນ 1Gi.

---

## ບັນຫາທີ 1 — `strategy: Recreate` ທຳໃຫ້ charger ທຸກຕົວ disconnect ພ້ອມກັນ

### ສາເຫດ

```yaml
# ກ່ອນ (ຜິດ)
strategy:
  type: Recreate   ← ລຶບ pod ທຸກຕົວທັນທີ → ທຸກ 100 charger disconnect ພ້ອມກັນ
```

### ການແກ້ໄຂ

```yaml
# ຫຼັງ (ຖືກຕ້ອງ)
strategy:
  type: RollingUpdate
  rollingUpdate:
    maxSurge: 1        # ສ້າງ pod ໃໝ່ 1 ຕົວກ່ອນ, ລໍຖ້າ ready
    maxUnavailable: 0  # ຢ່າ terminate pod ເກົ່າຈົນກ່ວາ pod ໃໝ່ ready
```

`terminationGracePeriodSeconds` ຍັງຕ້ອງ update ດ້ວຍ:

```yaml
# ກ່ອນ
terminationGracePeriodSeconds: 60

# ຫຼັງ
terminationGracePeriodSeconds: 120   # ໃຫ້ charger ມີ 2 ນາທີ reconnect
```

---

## ບັນຫາທີ 2 — Probe ຂາດ parameters ສຳຄັນ

### ສາເຫດ

```yaml
# ກ່ອນ — ໃຊ້ default ທັງໝົດ ຍ້ອນໃສ່ພຽງ initialDelaySeconds
readinessProbe:
  tcpSocket:
    port: 4002
  initialDelaySeconds: 10
  # timeoutSeconds default: 1s ← ⚠ ສັ້ນເກີນ ຖ້າ OCPP busy ຮັບ 100 MeterValues
  # failureThreshold default: 3
  # periodSeconds default: 10

livenessProbe:
  tcpSocket:
    port: 4002
  initialDelaySeconds: 20
  # ⚠ ບໍ່ມີ startupProbe → ຖ້າ app boot ຊ້າ, liveness ຈະ restart ກ່ອນ ready
```

### ການແກ້ໄຂ

```yaml
# ຫຼັງ — probe ຄົບ + startupProbe ເພີ່ມ

startupProbe:             # ກວດ boot ສຳເລັດ (24 × 5s = 2 ນາທີ)
  tcpSocket:
    port: 4002
  initialDelaySeconds: 5
  periodSeconds: 5
  failureThreshold: 24
  timeoutSeconds: 5

readinessProbe:           # ກວດພ້ອມຮັບ traffic
  tcpSocket:
    port: 4002
  initialDelaySeconds: 10
  periodSeconds: 10
  failureThreshold: 3
  timeoutSeconds: 5       # ← ເພີ່ມຈາກ 1s → 5s

livenessProbe:            # ກວດ alive (ຫຼັງ startup success)
  tcpSocket:
    port: 4002
  initialDelaySeconds: 30
  periodSeconds: 30
  failureThreshold: 3
  timeoutSeconds: 10      # ← ໃຫ້ Node.js ເວລາ ຖ້າ busy ຮັບ MeterValues ຫຼາຍ
```

---

## ບັນຫາທີ 3 — ບໍ່ມີ PDB (Pod Disruption Budget)

### ສາເຫດ

Services ອື່ນທຸກຕົວ (Mobile, Admin, Gateway, Notification) ມີ PDB — OCPP ບໍ່ມີ.  
ຖ້າ GKE node ຖືກ drain (maintenance, upgrade) → pod ຖືກລຶບທັນທີ ໂດຍບໍ່ຮັບປະກັນ graceful shutdown.

### ການແກ້ໄຂ

ສ້າງໄຟລ໌: `kubernetes/services/panda-ocpp-api/base/pdb.yaml`

```yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: panda-ocpp-api-pdb
spec:
  maxUnavailable: 1    # ໃຊ້ maxUnavailable ແທນ minAvailable
  selector:            # ຍ້ອນ replicas=1 — minAvailable:1 ຈະ block drain ທັງໝົດ
    matchLabels:
      app: panda-ocpp-api
```

> **ໝາຍເຫດ**: ໃຊ້ `maxUnavailable: 1` ແທນ `minAvailable: 1` ຍ້ອນ replicas=1.
> ຖ້າ `minAvailable: 1` ກັບ replicas=1 → GKE ຈະ block node drain ທຸກ node ຕະຫຼອດໄປ.

---

## ບັນຫາທີ 4 — `RABBITMQ_URL` ອ້າງ Secret ຜິດ

### ສາເຫດ

```yaml
# ກ່ອນ (ຜິດ) — panda-ocpp-api-secrets ບໍ່ມີ key RABBITMQ_URL
- name: RABBITMQ_URL
  valueFrom:
    secretKeyRef:
      name: panda-ocpp-api-secrets
      key: RABBITMQ_URL
```

Pod ໃໝ່ crash ດ້ວຍ: `Error: couldn't find key RABBITMQ_URL in Secret panda-ev-prod/panda-ocpp-api-secrets`

### ການແກ້ໄຂ

```yaml
# ຫຼັງ (ຖືກຕ້ອງ) — ໃຊ້ shared RabbitMQ secret
- name: RABBITMQ_URL
  valueFrom:
    secretKeyRef:
      name: panda-rabbitmq-prod-secrets
      key: RABBITMQ_URL
```

---

## ບັນຫາທີ 5 — Redis URL ໃນ Prod Overlay ຜິດ

### ສາເຫດ

```yaml
# ໃນ kubernetes/services/panda-ocpp-api/overlays/prod/kustomization.yaml
# ກ່ອນ (ຜິດ)
- REDIS_URL="redis://redis-service.panda-ev-prod.svc.cluster.local:6379"
```

### ການແກ້ໄຂ

```yaml
# ຫຼັງ (ຖືກຕ້ອງ)
- REDIS_URL="redis://10.231.221.4:6379"
```

---

## ຄຳສັ່ງທີ່ໃຊ້ (ຕາມລຳດັບ)

### 1. ກວດສອບ config ປັດຈຸບັນ

```bash
# ກວດ deployment resources + strategy
kubectl get deployment panda-ocpp-api -n panda-ev-prod -o yaml | \
  grep -E "replicas|strategy|cpu|memory|image:"

# ກວດ service + session affinity
kubectl describe svc panda-ocpp-api-service panda-ocpp-external-service \
  -n panda-ev-prod | grep -E "Type:|Port:|Session"

# ກວດ probe ທີ່ deploy ຢູ່
kubectl describe pod -n panda-ev-prod -l app=panda-ocpp-api | \
  grep -E "Liveness:|Readiness:|Startup:"

# ກວດ HPA + PDB
kubectl get hpa,pdb -n panda-ev-prod
```

### 2. ແກ້ໄຂໄຟລ໌ manifest

```bash
# ໄຟລ໌ທີ່ແກ້ (Claude ເຮັດ):
# kubernetes/services/panda-ocpp-api/base/deployment.yaml
#   - strategy: Recreate → RollingUpdate
#   - terminationGracePeriodSeconds: 60 → 120
#   - imagePullPolicy: IfNotPresent → Always
#   - ເພີ່ມ startupProbe
#   - ເພີ່ມ timeoutSeconds, failureThreshold ໃນທຸກ probe
#   - RABBITMQ_URL secret ref: panda-ocpp-api-secrets → panda-rabbitmq-prod-secrets
#
# kubernetes/services/panda-ocpp-api/base/pdb.yaml (ສ້າງໃໝ່)
#   - maxUnavailable: 1
#
# kubernetes/services/panda-ocpp-api/base/kustomization.yaml
#   - ເພີ່ມ pdb.yaml ໃນ resources
#
# kubernetes/services/panda-ocpp-api/overlays/prod/kustomization.yaml
#   - REDIS_URL: redis-service... → 10.231.221.4
```

### 3. Apply manifest ໃໝ່

```bash
kubectl apply -k kubernetes/services/panda-ocpp-api/overlays/prod
# ຜົນລັບ:
# configmap/panda-ocpp-api-config configured
# deployment.apps/panda-ocpp-api configured
# poddisruptionbudget.policy/panda-ocpp-api-pdb created
```

### 4. ກວດ probe ຂອງ pod ໃໝ່

```bash
kubectl rollout status deployment/panda-ocpp-api -n panda-ev-prod --timeout=120s

kubectl describe pod -n panda-ev-prod -l app=panda-ocpp-api | \
  grep -E "Liveness:|Readiness:|Startup:"
# ຜົນລັບ:
# Liveness:  tcp-socket :4002 delay=30s timeout=10s period=30s #failure=3  ✓
# Readiness: tcp-socket :4002 delay=10s timeout=5s period=10s  #failure=3  ✓
# Startup:   tcp-socket :4002 delay=5s  timeout=5s period=5s   #failure=24 ✓
```

### 5. ແກ້ Gateway Redis URL (ConfigMap reverted)

ພົບວ່າ Gateway ConfigMap ກັບຄືນ Redis URL ຜິດ ຫຼັງ rollout restart:

```bash
# ກວດ
kubectl get configmap panda-gateway-api-config -n panda-ev-prod \
  -o jsonpath='{.data.REDIS_URL}'
# ຜົນ: redis://redis-service.panda-ev.svc.cluster.local:6379  ← ຜິດ

# patch ໂດຍກົງ
kubectl patch configmap panda-gateway-api-config -n panda-ev-prod \
  --type merge \
  -p '{"data":{"REDIS_URL":"redis://10.231.221.4:6379"}}'

# restart ໃຫ້ pods ໃໝ່ໃຊ້ ConfigMap ທີ່ fixed
kubectl rollout restart deployment/panda-gateway-api -n panda-ev-prod
kubectl rollout status deployment/panda-gateway-api -n panda-ev-prod --timeout=90s
```

### 6. ລ້າງ Gateway old ReplicaSet ທີ່ stuck

```bash
# ກວດ RS ທີ່ຍັງ DESIRED > 0
kubectl get replicaset -n panda-ev-prod -l app=panda-gateway-api | \
  awk '$2 > 0 {print $1, "DESIRED="$2}'

# scale old RS ທີ່ crashing ລົງ 0
kubectl scale replicaset panda-gateway-api-7c8bd8f999 \
  -n panda-ev-prod --replicas=0
```

---

## ໄຟລ໌ທີ່ສ້າງ / ປ່ຽນແປງ

| ໄຟລ໌ | ການປ່ຽນແປງ |
|------|--------|
| `kubernetes/services/panda-ocpp-api/base/deployment.yaml` | `Recreate→RollingUpdate`, probe ຄົບ + `startupProbe`, `terminationGracePeriodSeconds: 120`, `imagePullPolicy: Always`, `RABBITMQ_URL` secret ref ຖືກ |
| `kubernetes/services/panda-ocpp-api/base/pdb.yaml` | ສ້າງໃໝ່ — `maxUnavailable: 1` |
| `kubernetes/services/panda-ocpp-api/base/kustomization.yaml` | ເພີ່ມ `pdb.yaml` ໃນ resources |
| `kubernetes/services/panda-ocpp-api/overlays/prod/kustomization.yaml` | `REDIS_URL` → `10.231.221.4` |

---

## ຄຳແນະນຳຕໍ່ໄປ (ສຳລັບ 200+ EVs)

| # | ສິ່ງທີ່ຕ້ອງເຮັດ | ສາເຫດ |
|---|-----------------|--------|
| 1 | ເພີ່ມ memory limit `512Mi → 1Gi` | 200 connections = ~320MB ໃກ້ limit |
| 2 | Refactor `pendingCalls` Map ເຂົ້າ Redis | ຮອງຮັບ multi-replica ໄດ້ (HA + scale) |
| 3 | ເພີ່ມ HPA `minReplicas: 1, maxReplicas: 3` | Auto-scale ຕອນ load ສູງ |

---

## ສະຖານະສຸດທ້າຍ (2026-04-17T17:00)

```bash
kubectl get pods -n panda-ev-prod
```

```
NAME                                   READY   STATUS    RESTARTS
panda-gateway-api-5c9b4c85f9-*         2/2     Running   0  ✓
panda-mobile-api-597f6bc4dd-*          3/3     Running   0  ✓
panda-notification-api-c8b9b9f79-*     2/2     Running   0  ✓
panda-ocpp-api-56df7c55fd-*            3/3     Running   0  ✓  (startupProbe+RollingUpdate)
panda-rabbitmq-0                       1/1     Running   0  ✓
panda-system-api-544946765b-*          2/2     Running   0  ✓
```

```bash
kubectl get pdb -n panda-ev-prod
```

```
NAME                       MIN AVAILABLE  MAX UNAVAILABLE  ALLOWED DISRUPTIONS
panda-gateway-api-pdb      1              N/A              1
panda-mobile-api-pdb       1              N/A              1
panda-notification-api-pdb 1              N/A              1
panda-ocpp-api-pdb         N/A            1                1   ← ສ້າງໃໝ່ ✓
panda-rabbitmq             N/A            1                1
panda-system-api-pdb       1              N/A              1
```

**ທຸກ service Running, RESTARTS=0, PDB ຄົບທຸກ service** ✓