# Step 11: Migration Checklist (Dev to Production) 🚀

## ຈຸດປະສົງ (Objective)
ເພື່ອວາງແຜນການຍ້າຍລະບົບ (Migration) ຈາກສະພາບແວດລ້ອມ Dev ໄປຫາ Production ໃຫ້ມີຄວາມປອດໄພ, ຜິດພາດໜ້ອຍທີ່ສຸດ ແລະ ມີ Downtime ຕໍ່າທີ່ສຸດ (ໂດຍສະເພາະ OCPP ທີ່ Chargers ຕ້ອງຍັງ Online). ເນັ້ນການຈັດລຽງລຳດັບຂັ້ນຕອນການຍ້າຍຂໍ້ມູນ ແລະ ການປ່ຽນຖ່າຍ Traffic (Cutover).

## 1. ແຜນການຍ້າຍ (Migration Phases)

### Phase 1: Infrastructure Provisioning (7 ວັນກ່ອນ Launch)
- [ ] ສ້າງ Cloud SQL Instances (HA Mode) ໃນ Prod Project.
- [ ] ສ້າງ Memorystore Redis (Standard HA).
- [ ] ສ້າງ GKE Cluster ພ້ອມ 2 Node Pools (Stateless & OCPP).
- [ ] ຕິດຕັ້ງ RabbitMQ Cluster Operator ແລະ ສ້າງ Cluster 3 Nodes.
- [ ] ຕິດຕັ້ງ External Secrets Operator ແລະ ສ້າງ Secrets ໃນ Secret Manager.

### Phase 2: Application Preparation (3 ວັນກ່ອນ Launch)
- [ ] Build ແລະ Push Docker Images Version "Production" ໄປ GCP Artifact Registry.
- [ ] Deploy Stateless Services (Admin, Mobile, Noti, Gateway) ໃນ GKE Prod.
- [ ] ທົດສອບ Connectivity ລະຫວ່າງ App -> DB / Redis / RabbitMQ.
- [ ] ຕັ້ງຄ່າ SSL Certificate ໃຫ້ Managed Certificate ເປັນ "Active".

### Phase 3: Data Migration & Cutover (ມື້ Launch - Downtime Window)
- [ ] **DB Migration:** ໃຊ້ `pg_dump` ຈາກ Dev DB ແລະ `pg_restore` ໄປ Prod DB (ແນະນຳໃຫ້ປິດ Write Traffic ຢູ່ Dev ກ່ອນເພື່ອປ້ອງກັນ Data loss).
- [ ] **OCPP Zero-downtime Strategy:**
  1. ສ້າງ OCPP Prod Service ໃຫ້ພ້ອມຮັບ Connection.
  2. ປ່ຽນ DNS ຂອງ `ocpp.pandaev.com` ຈາກ IP ຂອງ Dev ໄປຫາ Static IP ຂອງ Prod.
  3. Chargers ຈະຄ່ອຍໆ Reconnect ຫາ Prod Pods ຕາມ TTL ຂອງ DNS.
- [ ] **Mobile API Cutover:** ປ່ຽນ DNS ຂອງ `api.pandaev.com` ຫາ Load Balancer Prod.

## 2. Zero-downtime Strategy ສຳລັບ OCPP
ເນື່ອງຈາກ WebSocket ເປັນການເຊື່ອມຕໍ່ຄ້າງໄວ້ (Long-lived connections):
1. **Parallel Run:** ໃຫ້ OCPP Dev Pods ຍັງເຮັດວຽກຢູ່ ໃນຂະນະທີ່ Prod ກໍ່ເລີ່ມເຮັດວຽກ.
2. **DNS Swap:** ເມື່ອປ່ຽນ DNS ແລ້ວ, Connection ໃໝ່ຈາກ Charger ຈະເຂົ້າຫາ Prod.
3. **Graceful Reconnect:** ສົ່ງຄຳສັ່ງ `Soft Reset` ຫຼື `TriggerMessage(BootNotification)` ຜ່ານ OCPP ຫາ Charger (ເທື່ອລະກຸ່ມ) ເພື່ອບັງຄັບໃຫ້ມັນ Reconnect ຫາ DNS ໃໝ່ທັນທີໂດຍບໍ່ກະທົບກັບການຊາກທີ່ພວມດຳເນີນຢູ່.

## 3. Rollback Plan (ຖ້າເກີດບັນຫາ)
- [ ] **Database:** ຖ້າ Prod DB ພັງ ຫຼື ຂໍ້ມູນຜິດພາດ, ໃຫ້ກັບໄປໃຊ້ Dev DB ທີ່ຍັງມີຂໍ້ມູນ Backup ຫຼ້າສຸດກ່ອນ Migration.
- [ ] **Ingress:** ປ່ຽນ DNS CNAME/A Record ກັບຄືນຫາ IP/Endpoint ຂອງ Dev Environment.
- [ ] **Application:** ໃຊ້ `kubectl rollout undo` ເພື່ອຖອຍກັບຫາ Deployment version ກ່ອນໜ້າ (ຖ້າເປັນການ Update ໃນ Prod ເອງ).

## 4. Pre-launch Checklist (Final Check)
- [ ] [ ] DB Connection limits ຕັ້ງຄ່າພຽງພໍກັບ Pods ທັງໝົດ.
- [ ] [ ] Redis HA failover test ຜ່ານ (ທົດສອບປິດ 1 Node).
- [ ] [ ] RabbitMQ DLQ config ເຮັດວຽກໄດ້ຖືກຕ້ອງ (ທົດສອບສົ່ງ Message ຜິດ).
- [ ] [ ] Managed SSL Certificate ສະຖານະເປັນ "Active" (Green).
- [ ] [ ] Backup policy ໃນ Cloud SQL ເປີດໃຊ້ງານແລ້ວ.
- [ ] [ ] Load Balancer Health checks ທຸກຕົວເປັນ "Healthy".

## ⚠️ ສິ່ງທີ່ຕ້ອງລະວັງ (Notes)
- **Data Consistency:** ລະວັງຂໍ້ມູນ MeterValues ທີ່ເກີດຂຶ້ນໃນຊ່ວງ Migration. ຖ້າຍ້າຍບໍ່ທັນ, ຂໍ້ມູນບາງສ່ວນອາດຈະຄ້າງຢູ່ Dev.
- **Charger Reconnection:** Charger ບາງລຸ້ນອາດຈະມີ Cache DNS ເກົ່າຄ້າງໄວ້ດົນ, ອາດຕ້ອງໄດ້ Restart Charger ຈາກທາງໄກ.
- **DNS TTL:** ຄວນປັບ DNS TTL ໃຫ້ຕໍ່າ (ເຊັ່ນ 60 ວິນາທີ) ກ່ອນມື້ Migration ຢ່າງໜ້ອຍ 24 ຊົ່ວໂມງ.

---
✅ Step 11 ສຳເລັດ — ບັນທຶກໃສ່ STEP-11-migration-checklist.md
