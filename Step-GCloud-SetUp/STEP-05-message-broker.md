# Step 05: Message Broker Production Design 📩

## ຈຸດປະສົງ (Objective)
ເພື່ອອອກແບບລະບົບ Message Broker ສຳລັບການສື່ສານລະຫວ່າງ Services ແບບ Asynchronous ໂດຍປຽບທຽບລະຫວ່າງ RabbitMQ Cluster Operator ແລະ Google Cloud Pub/Sub ເພື່ອເລືອກ Solution ທີ່ດີທີ່ສຸດສຳລັບ Production.

## 1. ການປຽບທຽບ (Comparison)

| Feature | RabbitMQ Cluster Operator (K8s Native) | Google Cloud Pub/Sub (Managed) |
| :--- | :--- | :--- |
| **Operational Effort** | Medium (Managed by Operator in GKE) | **Very Low** (Serverless, No management) |
| **Scalability** | High (Scaling nodes/pods) | **Infinite** (Scales automatically) |
| **Protocol** | AMQP, MQTT, STOMP | Pub/Sub (REST/gRPC) |
| **Complexity** | Support complex routing/priority queues | Simple Topic/Subscription model |
| **NestJS Integration** | Native support (Easy) | Requires specific GCP libraries |
| **Cost** | Cost of Nodes/Storage in GKE | Pay-per-use (Might be high if volume is high) |

### **⭐ ການແນະນຳ (Recommendation):**
ຂ້ອຍແນະນຳໃຫ້ໃຊ້ **RabbitMQ Cluster Operator** ເທິງ GKE ຍ້ອນວ່າ:
1. **Compatibility:** Services ເດີມແລ່ນເທິງ RabbitMQ ຢູ່ແລ້ວ, ການຍ້າຍໄປ Cluster Operator ຈະບໍ່ຕ້ອງແກ້ໄຂ Code ຫຼັກ (NestJS Microservices).
2. **Specific Features:** OCPP ແລະ IoT Services ມັກຈະຕ້ອງການການຈັດການ Queue ທີ່ລະອຽດ (ເຊັ່ນ: Priority queues, TTL, ແລະ DLQ complex patterns) ເຊິ່ງ RabbitMQ ເຮັດໄດ້ດີກວ່າ.
3. **Control:** ຂໍ້ມູນ Queue ຢູ່ໃນ VPC ຂອງທ່ານເອງ, ຄວບຄຸມ Network Latency ໄດ້ດີກວ່າ.

## 2. RabbitMQ High Availability (HA) Design
ເຮົາຈະ Deploy RabbitMQ Cluster ໂດຍໃຊ້ Operator ທີ່ມີ 3 Nodes ເພື່ອໃຫ້ເປັນ HA.

### RabbitMQCluster YAML (Production-Ready):
```yaml
apiVersion: rabbitmq.com/v1beta1
kind: RabbitmqCluster
metadata:
  name: panda-ev-rabbitmq-prod
  namespace: panda-ev
spec:
  replicas: 3 # ສ້າງ 3 Nodes ເພື່ອ High Availability
  image: rabbitmq:3.12-management
  resources:
    requests:
      cpu: "1"
      memory: "2Gi"
    limits:
      cpu: "2"
      memory: "4Gi"
  persistence:
    storageClassName: premium-rwo # ໃຊ້ SSD Storage ໃນ GCP
    storage: 20Gi
  rabbitmq:
    additionalConfig: |
      cluster_partition_handling = pause_minority
      vm_memory_high_watermark.relative = 0.4
```

## 3. Queue & Topic Mapping (Dead Letter Design)
ທຸກ Queue ທີ່ສຳຄັນຕ້ອງມີ **Dead Letter Queue (DLQ)** ເພື່ອເກັບ Message ທີ່ປະມວນຜົນບໍ່ສຳເລັດ.

| Queue Name | Type | Exchange | Dead Letter Queue (DLX) |
| :--- | :--- | :--- | :--- |
| `PANDA_EV_QUEUE` | Durable | `panda.ev.main` | `PANDA_EV_QUEUE_DLQ` |
| `PANDA_EV_NOTIFICATIONS` | Durable | `panda.ev.noti` | `PANDA_EV_NOTIFICATIONS_DLQ` |
| `PANDA_EV_CSMS_COMMANDS`| Durable | `panda.ev.csms` | `PANDA_EV_CSMS_COMMANDS_DLQ` |
| `PANDA_EV_PAYMENT_COMMANDS` | Durable | `panda.ev.payment` | `PANDA_EV_PAYMENT_DLQ` |

**Policy ເພື່ອເຮັດ HA Queue:**
```bash
# ຕັ້ງຄ່າໃຫ້ທຸກ Queue ມີການ Copy ຂໍ້ມູນຂ້າມ Node (Replication)
rabbitmqctl set_policy HA ".*" '{"ha-mode":"all","ha-sync-mode":"automatic"}' --apply-to queues
```

## 4. Auto-scaling (KEDA)
ສຳລັບ Production, ເຮົາຈະໃຊ້ **KEDA (Kubernetes-based Event-Driven Autoscaling)** ເພື່ອ Scale Pods ຂອງ NestJS ຕາມ "ຈຳນວນ Message ທີ່ຄ້າງຢູ່ໃນ Queue".
- ຖ້າມີ Message ຢູ່ໃນ `PANDA_EV_NOTIFICATIONS` > 100, ໃຫ້ Scale Notification Service ເປັນ 5-10 Pods ທັນທີ.

## 📋 Checklist ສຳລັບ Step ນີ້
- [x] ປຽບທຽບ RabbitMQ vs Pub/Sub ແລະ ເລືອກ RabbitMQ Cluster Operator.
- [x] ອອກແບບ RabbitMQ Cluster (3 Nodes HA) ພ້ອມ Resources limits.
- [x] ກຳນົດ Queue Mapping ແລະ ຍຸດທະສາດ Dead Letter Queue (DLQ).
- [x] ວາງແຜນການໃຊ້ KEDA ເພື່ອ Auto-scaling ຕາມ Load ຂອງ Message.

## ⚠️ ສິ່ງທີ່ຕ້ອງລະວັງ (Notes)
- **Disk Space:** ຖ້າ Consumer ຕາຍ ແລະ Message ຄ້າງຫຼາຍ, Disk ອາດຈະເຕັມ. ຕ້ອງຕັ້ງ Alert ຕິດຕາມ "Queue Depth".
- **Memory Pressure:** RabbitMQ ຈະຢຸດຮັບ Message ຖ້າ Memory ເຖິງຂີດຈຳກັດ (High Watermark). ຕ້ອງຕັ້ງ Memory Limits ໃຫ້ເໝາະສົມ.
- **Partitioning:** ໃນກໍລະນີ Network ໃນ Cluster ມີບັນຫາ, ຕ້ອງໃຊ້ `pause_minority` ເພື່ອປ້ອງກັນຂໍ້ມູນບໍ່ຕົງກັນ (Split-brain).

---
✅ Step 05 ສຳເລັດ — ບັນທຶກໃສ່ STEP-05-message-broker.md
