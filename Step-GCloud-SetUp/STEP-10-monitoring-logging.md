# Step 10: Monitoring & Logging (Cloud Operations) 📊

## ຈຸດປະສົງ (Objective)
ເພື່ອອອກແບບ ແລະ ຕັ້ງຄ່າລະບົບຕິດຕາມການເຮັດງານ (Monitoring) ແລະ ການເກັບ Log (Logging) ໃນລະດັບ Production ໂດຍໃຊ້ **Google Cloud Operations Suite (Stackdriver)**. ເນັ້ນການສ້າງ Dashboards ສໍາລັບສຸຂະພາບຂອງລະບົບ, ການຕັ້ງຄ່າ Alerts ເມື່ອເກີດບັນຫາ ແລະ ການຕິດຕາມ Metrics ພິເສດຂອງ OCPP WebSocket.

## 1. Cloud Monitoring Dashboards ທີ່ຕ້ອງມີ

### 1.1 Dashboard: Platform Overview
- **GKE Clusters:** CPU/Memory Utilization ແຍກຕາມ Node Pool.
- **HTTP/WSS Traffic:** Request count, Error rate (4xx, 5xx), Latency ຈາກ Load Balancer.
- **Pod Status:** ຈຳນວນ Replicas ທີ່ Ready vs Desired.

### 1.2 Dashboard: Database & Cache Performance
- **Cloud SQL:** CPU, Memory, Disk, Active Connections, ແລະ Read Replica Lag.
- **Memorystore Redis:** Memory Usage, Connection Count, ແລະ Cache Hit/Miss Ratio.

### 1.3 Dashboard: OCPP Specific Metrics (Critical)
- **Active WebSocket Connections:** ຈຳນວນ Chargers ທີ່ Online ຢູ່ແທ້ໆ.
- **Message Rate:** ຈຳນວນ OCPP Messages (BootNotification, Heartbeat, MeterValues) ຕໍ່ວິນາທີ.
- **Database Write Latency:** ຄວາມໄວໃນການບັນທຶກ ocpp_logs ແລະ meter_values.

## 2. Alerts & Notifications Setup
ເຮົາຈະຕັ້ງຄ່າ Alerting Policy ເພື່ອແຈ້ງເຕືອນຜ່ານ Email, Slack ຫຼື PagerDuty:

| Alert Name | Condition | Severity |
| :--- | :--- | :--- |
| **Charger Disconnect** | ຈຳນວນ WebSocket < 55 (ຈາກ 60) ເປັນເວລາ 5 ນາທີ | **Critical** |
| **High Error Rate** | HTTP 5xx Error > 2% ໃນ 5 ນາທີ | **High** |
| **DB Storage Low** | SQL Storage Usage > 80% | **Warning** |
| **Queue Backlog** | RabbitMQ Queue Depth > 10,000 Messages | **High** |
| **Pod Restart** | Container restart count > 3 ຄັ້ງໃນ 1 ຊົ່ວໂມງ | **Warning** |

## 3. Log Aggregation & Analysis (Cloud Logging)
- **Log Scoping:** ເກັບ Logs ຈາກທຸກ Pods ໃນ Namespace `panda-ev-prod`.
- **Log Sinks:** ສ້າງ Log Sink ເພື່ອສົ່ງ Logs ທີ່ສຳຄັນ (ເຊັ່ນ Audit Logs, Payment Logs) ໄປເກັບໄວ້ໃນ **BigQuery** ເພື່ອເຮັດ Report ໄລຍະຍາວ.
- **Error Reporting:** ເປີດໃຊ້ Cloud Error Reporting ເພື່ອໃຫ້ NestJS ສົ່ງ Stack Traces ຂອງ Exception ມາລວມໄວ້ບ່ອນດຽວ.

## 4. Custom Metrics with NestJS
ໃຊ້ Prometheus client ໃນ NestJS ເພື່ອສົ່ງ Metrics ພິເສດຫາ Cloud Monitoring:
```typescript
// ຕົວຢ່າງ Metrics ທີ່ຄວນເກັບ
const activeConnections = new Gauge({ name: 'ocpp_active_connections', help: 'Current active WS' });
const chargingSessions = new Counter({ name: 'ev_charging_sessions_total', help: 'Total sessions' });
```

## 📋 Checklist ສຳລັບ Step ນີ້
- [x] ອອກແບບ Cloud Monitoring Dashboards (GKE, DB, OCPP).
- [x] ກຳນົດ Alerting Policies (Critical, High, Warning).
- [x] ຕັ້ງຄ່າ Log Aggregation ແລະ Log Sinks ຫາ BigQuery.
- [x] ເປີດໃຊ້ Cloud Error Reporting ສໍາລັບ NestJS Exception tracking.
- [x] ວາງແຜນການເກັບ Custom Metrics ສຳລັບ OCPP ໂດຍສະເພາະ.

## ⚠️ ສິ່ງທີ່ຕ້ອງລະວັງ (Notes)
- **Log Volume Cost:** ການເກັບ Log ທຸກຢ່າງ (ໂດຍສະເພາະ OCPP Debug logs) ອາດເຮັດໃຫ້ຄ່າໃຊ້ຈ່າຍສູງ. ຄວນຕັ້ງ Log Level ໃນ Production ເປັນ `info` ຫຼື `warn` ເທົ່ານັ້ນ.
- **Metric Retention:** Cloud Monitoring ເກັບ Metrics ໄວ້ພຽງ 6 ອາທິດ (Standard). ຖ້າຕ້ອງການເກັບດົນກວ່າຕ້ອງ Export ຫາ BigQuery.
- **Alert Fatigue:** ຢ່າຕັ້ງ Alert ຫຼາຍເກີນໄປຈົນກາຍເປັນ Noise. ໃຫ້ເນັ້ນສະເພາະ Metric ທີ່ບົ່ງບອກວ່າ User/Charger ມີບັນຫາແທ້ໆ.

---
✅ Step 10 ສຳເລັດ — ບັນທຶກໃສ່ STEP-10-monitoring-logging.md
