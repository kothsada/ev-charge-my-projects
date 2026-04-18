# Step 12: GCP Cost Estimation & Optimization 💰

## ຈຸດປະສົງ (Objective)
ເພື່ອປະເມີນຄ່າໃຊ້ຈ່າຍ (Cost Estimation) ຂອງລະບົບ Panda EV Hub ເທິງ Google Cloud Platform (GCP) ສຳລັບສະພາບແວດລ້ອມ Production. ໂດຍຄິດໄລ່ອີງຕາມການຮອງຮັບ Chargers 60 ເຄື່ອງໃນເບື້ອງຕົ້ນ ແລະ ວາງແຜນການຂະຫຍາຍຕົວໄປຫາ 120 ແລະ 200 ເຄື່ອງໃນອະນາຄົດ.

## 1. ການປະເມີນຄ່າໃຊ້ຈ່າຍລາຍເດືອນ (60 Chargers)
*ໝາຍເຫດ: ລາຄານີ້ເປັນພຽງການປະເມີນເບື້ອງຕົ້ນ (Estimate) ອີງຕາມລາຄາ Region: asia-southeast1.*

| Resource Component | Configuration Details | Estimated Cost / Month |
| :--- | :--- | :--- |
| **Cloud SQL (5 Instances)** | HA Mode, Read Replicas, SSD Storage | $1,200 - $1,500 |
| **GKE (Nodes & Mgmt)** | 2 Node Pools (Stateless + OCPP HA) | $800 - $1,200 |
| **Memorystore (Redis)** | Standard Tier HA (2GB) | $100 - $150 |
| **Networking & LB** | GCLB, Static IP, Data Transfer | $100 - $200 |
| **Cloud Operations** | Logging, Monitoring, Alerts | $50 - $100 |
| **Secrets & Storage** | Secret Manager, GCS Backup | $30 - $50 |
| **Total (Estimated)** | | **$2,280 - $3,200** |

## 2. Cost Projection (ການຂະຫຍາຍຕົວ)

### 🚀 Scale ໄປຫາ 120 Chargers
- **GKE:** ຈະມີການ Auto-scale Nodes ເພີ່ມຂຶ້ນປະມານ 30-50%.
- **Cloud SQL (OCPP):** ອາດຈະຕ້ອງ Upgrade CPU/RAM ຂອງ OCPP DB ເພື່ອຮອງຮັບ Write Load ທີ່ເພີ່ມຂຶ້ນ.
- **ຄາດຄະເນຄ່າໃຊ້ຈ່າຍ:** **$3,500 - $4,500 / ເດືອນ**

### 🚀 Scale ໄປຫາ 200 Chargers
- **GKE:** ຕ້ອງການ Node Pools ທີ່ໃຫຍ່ຂຶ້ນ ແລະ ການຈັດການ Resource Limits ທີ່ເຂັ້ມງວດ.
- **Networking:** ຄ່າ Data Transfer ຈາກ WebSocket ຈະເພີ່ມຂຶ້ນຢ່າງເຫັນໄດ້ຊັດ.
- **Cloud SQL:** ອາດຈະຕ້ອງແຍກ Read Replica ເພີ່ມສຳລັບ Dashboard/Reporting.
- **ຄາດຄະເນຄ່າໃຊ້ຈ່າຍ:** **$5,500 - $7,000 / ເດືອນ**

## 3. Tips ການປະຢັດຄ່າໃຊ້ຈ່າຍ (Cost Optimization)
- [ ] **Commitment Use Discounts (CUDs):** ຖ້າໝັ້ນໃຈວ່າຈະໃຊ້ GCP ດົນກວ່າ 1 ປີ, ໃຫ້ຊື້ CUDs ເພື່ອຮັບສ່ວນຫຼຸດສູງເຖິງ 37-57%.
- [ ] **Cloud SQL Consolidation:** ຖ້າບາງ Service ມີ Load ຕໍ່າ (ເຊັ່ນ Gateway ຫຼື Noti), ສາມາດລວມ DB Instance ດຽວກັນແຕ່ແຍກ Schema ເພື່ອຫຼຸດຄ່າ Instance fee.
- [ ] **Log Filtering:** ເລືອກເກັບສະເພາະ Log ທີ່ຈຳເປັນ (Error/Critical) ໄວ້ໃນ Cloud Logging. Log ທົ່ວໄປໃຫ້ສົ່ງໄປ BigQuery ໂດຍກົງ (Log Sink) ເຊິ່ງຈະຖືກກວ່າ.
- [ ] **Spot VMs:** ສຳລັບ Stateless Services ທີ່ບໍ່ Critical ຫຼາຍ, ສາມາດທົດລອງໃຊ້ Spot VMs ໃນ GKE ເພື່ອຫຼຸດຄ່າ Node ໄດ້ເຖິງ 60-90%.

## 📋 Checklist ສຳລັບ Step ນີ້
- [x] ວິເຄາະຄ່າໃຊ້ຈ່າຍແຕ່ລະສ່ວນ (SQL, GKE, Redis, Networking).
- [x] ຄາດຄະເນການຂະຫຍາຍຕົວ (120/200 Chargers).
- [x] ກວດສອບຄວາມເໝາະສົມຂອງ Instance Tiers ຕໍ່ກັບງົບປະມານ.
- [x] ວາງແຜນການໃຊ້ CUDs ແລະ Optimization tips ເພື່ອຫຼຸດ Cost.

## ⚠️ ສິ່ງທີ່ຕ້ອງລະວັງ (Notes)
- **Data Transfer Out:** ຄ່າ Internet Traffic ຈາກ GCP ອອກຫາ Chargers ໃນລາວ ອາດຈະແພງກວ່າການສື່ສານພາຍໃນ GCP ເອງ. ຕ້ອງຕິດຕາມ Metric ນີ້ໃຫ້ດີ.
- **Snapshot & Backup:** ການເກັບ Backup ໄວ້ຫຼາຍເກີນໄປຈະເຮັດໃຫ້ຄ່າ Storage ເພີ່ມຂຶ້ນ. ໃຫ້ຕັ້ງ Retention Policy ຕາມທີ່ກຳນົດ (7 ວັນ).
- **Idle Resources:** ໝັ່ນກວດສອບ ແລະ ລຶບ Static IP ທີ່ບໍ່ໄດ້ໃຊ້ ຫຼື Disks ທີ່ຄ້າງຢູ່ (Unused resources) ເພື່ອບໍ່ໃຫ້ເສຍເງິນລ້າໆ.

---
✅ Step 12 ສຳເລັດ — ບັນທຶກໃສ່ STEP-12-cost-estimation.md
