# Step 06: GKE Cluster & Scaling Design ☸️

## ຈຸດປະສົງ (Objective)
ອອກແບບໂຄງສ້າງ GKE Cluster ສຳລັບ Production ໂດຍເນັ້ນການແຍກ Workload ລະຫວ່າງ Stateless services ແລະ Stateful (OCPP), ການຕັ້ງຄ່າ Auto-scaling ຜ່ານ HPA ແລະ ການຈັດການ Sticky Sessions ສຳລັບ WebSocket.

## 1. Node Pool Design (Production)
ເພື່ອຄວາມສະຖຽນ, ເຮົາຈະແຍກ Node Pools ອອກເປັນ 2 ກຸ່ມຕາມລັກສະນະຂອງ Service:

| Node Pool Name | Machine Type | Autoscaling | Purpose |
| :--- | :--- | :--- | :--- |
| `stateless-pool` | `e2-standard-4` | 2-10 Nodes | Admin, Mobile, Gateway, Notification |
| `ocpp-pool` | `n2-standard-4` | 3-6 Nodes | **OCPP Service ເທົ່ານັ້ນ** (ຕ້ອງການ Network ທີ່ດີກວ່າ) |

- **Taints & Tolerations:** ໃຊ້ເພື່ອບັງຄັບໃຫ້ OCPP Pod ແລ່ນສະເພາະຢູ່ໃນ `ocpp-pool` ເທົ່ານັ້ນ ເພື່ອປ້ອງກັນການແຍ່ງ Resource ຈາກ Service ອື່ນ.
- **Node Auto-provisioning:** ເປີດໃຊ້ງານເພື່ອໃຫ້ GKE ສ້າງ Node ໃໝ່ອັດຕະໂນມັດເມື່ອ Resource ບໍ່ພໍ.

## 2. Horizontal Pod Autoscaler (HPA) Config
ທຸກ Service (ຍົກເວັ້ນ OCPP) ຈະຖືກ Scale ຕາມ CPU ແລະ Memory:

```yaml
apiVersion: autoscaling/v2
kind: HPA
metadata:
  name: panda-ev-mobile-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: panda-ev-client-mobile
  minReplicas: 2
  maxReplicas: 10
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 60
  - type: Resource
    resource:
      name: memory
      target:
        type: Utilization
        averageUtilization: 70
```

## 3. OCPP Sticky Sessions & WebSocket Handling
ເນື່ອງຈາກ OCPP ເປັນ WebSocket (Stateful), ເຮົາຈະໃຊ້ **Nginx Ingress Controller** ຫຼື **GCP GCLB** ທີ່ມີການຕັ້ງຄ່າ Session Affinity:

- **Sticky Session:** ໃຊ້ `Generated Cookie` ຫຼື `Client IP` ເພື່ອໃຫ້ Charger ເຊື່ອມຕໍ່ຫາ Pod ເດີມສະເໝີ.
- **Graceful Shutdown:** ຕັ້ງຄ່າ `terminationGracePeriodSeconds: 60` ເພື່ອໃຫ້ OCPP Pod ມີເວລາປິດ WebSocket connection ກ່ອນຈະຖືກ Scale-in.

## 4. Resource Requests & Limits (Recommendation)

| Service | CPU Request / Limit | Memory Request / Limit |
| :--- | :--- | :--- |
| **Admin** | 200m / 500m | 512Mi / 1Gi |
| **Mobile API** | 500m / 1000m | 1Gi / 2Gi |
| **OCPP CSMS** | **1000m / 2000m** | **2Gi / 4Gi** (High priority) |
| **Notification**| 200m / 500m | 512Mi / 1Gi |
| **Gateway** | 200m / 500m | 512Mi / 1Gi |

## 📋 Checklist ສຳລັບ Step ນີ້
- [x] ອອກແບບແຍກ Node Pools (Stateless vs OCPP).
- [x] ກຳນົດ HPA Config ສຳລັບທຸກ Service ຕາມ CPU/Memory.
- [x] ວາງແຜນການໃຊ້ Sticky Session ສຳລັບ OCPP WebSocket.
- [x] ກຳນົດ Resource Requests/Limits ໃຫ້ທຸກ Pod ໃນ Production.

## ⚠️ ສິ່ງທີ່ຕ້ອງລະວັງ (Notes)
- **OCPP Scaling:** ຫ້າມ Scale-in (ຫຍໍ້ຂະໜາດ) OCPP Pod ແບບກະທັນຫັນ ເພາະຈະເຮັດໃຫ້ Charger ຫຼຸດການເຊື່ອມຕໍ່. ຄວນຕັ້ງ `minReplicas` ໃຫ້ພຽງພໍກັບຈຳນວນ Charger (60 Chargers = ຢ່າງໜ້ອຍ 3 Pods ເພື່ອ HA).
- **Cluster Overheads:** ຢ່າລືມເຫຼືອ Resource ໄວ້ໃຫ້ System components ເຊັ່ນ: kube-proxy, fluentd, ແລະ metrics-server.
- **Node Pool Upgrades:** ເວລາອັບເກຣດ GKE Node, ໃຫ້ໃຊ້ `Surge Upgrade` ເພື່ອບໍ່ໃຫ້ລະບົບຢຸດເຮັດວຽກ.

---
✅ Step 06 ສຳເລັດ — ບັນທຶກໃສ່ STEP-06-gke-cluster-design.md
