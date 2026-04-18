# Step 02: Cloud SQL Production Design 🗄️

## ຈຸດປະສົງ (Objective)
ອອກແບບ ແລະ ກຳນົດຄ່າ (Configuration) ສຳລັບ Google Cloud SQL (PostgreSQL 18) ໃຫ້ເປັນລະດັບ Production ໂດຍເນັ້ນຄວາມປອດໄພ (Private IP), ການສຳຮອງຂໍ້ມູນ (Backup/PITR), ແລະ ການຮອງຮັບ Load ຜ່ານ Read Replicas.

## ຕາຕະລາງການອອກແບບ Cloud SQL Instances (Production)

| Instance Name | Service / Schema | Tier (vCPU/RAM) | Storage | Read Replica | Workload Type |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `panda-ev-prod-admin-db` | `panda_ev_system` | `db-custom-2-7680` (2 vCPU, 7.5GB) | 20GB+ (Auto) | 1 Replica | Read-heavy |
| `panda-ev-prod-mobile-db` | `panda_ev_core` | `db-custom-2-7680` (2 vCPU, 7.5GB) | 50GB+ (Auto) | 1 Replica | Balanced |
| `panda-ev-prod-ocpp-db` | `panda_ev_ocpp` | `db-custom-4-15360` (4 vCPU, 15GB) | 100GB+ (Auto)| 1 Replica | **Write-heavy** ⚠️ |
| `panda-ev-prod-noti-db` | `panda_ev_noti` | `db-custom-1-3840` (1 vCPU, 3.75GB) | 20GB+ (Auto) | 1 Replica | Write-heavy |
| `panda-ev-prod-gateway-db` | `panda_ev_gateway`| `db-custom-1-3840` (1 vCPU, 3.75GB) | 10GB+ (Auto) | 1 Replica | Balanced |

## ການຕັ້ງຄ່າ Infrastructure (Standard Settings)
ເພື່ອໃຫ້ເປັນ Production-grade, ທຸກ Instance ຕ້ອງຖືກຕັ້ງຄ່າດັ່ງນີ້:
- **Availability:** Regional (High Availability - HA) ໂດຍມີ Standby instance ຢູ່ Zone ອື່ນ.
- **Connectivity:** **Private IP Only** (ເຊື່ອມຕໍ່ຜ່ານ VPC Peering ຫາ GKE Cluster).
- **Storage:** Enable **Automatic Storage Increase** (ເພື່ອປ້ອງກັນ DB Full).
- **Backups:** 
  - Automated daily backups (Retention 7 ວັນ).
  - Enable **Point-in-time recovery (PITR)** (ໃຊ້ Transaction logs ເພື່ອ Restore ລະດັບວິນາທີ).
- **Database Flags:** ຕັ້ງຄ່າ `max_connections` ໃຫ້ເໝາະສົມ ແລະ `cloudsql.enable_pgaudit` ສຳລັບ Admin DB.

## Cloud SQL Auth Proxy Sidecar Configuration (YAML)
ທຸກ Service ໃນ GKE ຈະເຊື່ອມຕໍ່ຫາ DB ຜ່ານ Sidecar Container ນີ້:

```yaml
# ຕົວຢ່າງ Deployment snippet ສຳລັບ sidecar
apiVersion: apps/v1
kind: Deployment
metadata:
  name: panda-ev-service
spec:
  template:
    spec:
      containers:
      - name: app-container
        image: gcr.io/pandaev/service-image:latest
        env:
        - name: DB_HOST
          value: "127.0.0.1" # ເຊື່ອມຕໍ່ຫາ proxy ທີ່ run ຢູ່ localhost
        - name: DB_PORT
          value: "5432"

      # Cloud SQL Auth Proxy Sidecar
      - name: cloud-sql-proxy
        image: gcr.io/cloud-sql-connectors/cloud-sql-proxy:2.8.1
        args:
          - "--private-ip"
          - "--port=5432"
          - "pandaev:asia-southeast1:panda-ev-prod-xxxx-db" # ປ່ຽນຕາມຊື່ instance
        securityContext:
          runAsNonRoot: true
        resources:
          requests:
            memory: "128Mi"
            cpu: "100m"
```

## 📋 Checklist ສຳລັບ Step ນີ້
- [x] ກຳນົດຊື່ Instance ແລະ Tier ໃຫ້ທຸກ 5 Services.
- [x] ວາງແຜນການໃຊ້ Read Replica ສຳລັບແຕ່ລະ DB.
- [x] ຕັ້ງຄ່າ Backup Policy (7 ວັນ + PITR).
- [x] ຕັ້ງຄ່າ Network ເປັນ Private IP ເທົ່ານັ້ນ.
- [x] ກຽມ YAML Config ສຳລັບ Cloud SQL Auth Proxy sidecar.

## ⚠️ ສິ່ງທີ່ຕ້ອງລະວັງ (Notes)
- **Review Instance `panda-ev-core-instance-db-a1`:** ຈາກການກວດສອບ, Instance ນີ້ຄວນຖືກ **Migrate** ແຍກອອກເປັນ `panda-ev-prod-noti-db` ແລະ `panda-ev-prod-gateway-db` ເພື່ອຄວາມເປັນລະບຽບ ແລະ ບໍ່ໃຫ້ Service ໃດໜຶ່ງດຶງ Resource ຂອງອີກ Service ໜຶ່ງ.
- **OCPP DB Performance:** ເນື່ອງຈາກ OCPP ເປັນ Write-heavy (60+ chargers), ຕ້ອງຕິດຕາມ IOPS ແລະ CPU ຢ່າງໃກ້ຊິດ. ການໃຊ້ SSD Storage ເປັນສິ່ງຈຳເປັນ.
- **Cost Warning:** ການເປີດ HA (High Availability) ແລະ Read Replica ຈະເຮັດໃຫ້ຄ່າໃຊ້ຈ່າຍເພີ່ມຂຶ້ນ 2-3 ເທົ່າຂອງ Instance ປົກກະຕິ.

---
✅ Step 02 ສຳເລັດ — ບັນທຶກໃສ່ STEP-02-cloud-sql-design.md
