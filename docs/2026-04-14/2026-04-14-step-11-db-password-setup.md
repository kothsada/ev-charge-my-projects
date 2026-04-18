# Step 11: Cloud SQL Password Setup & Database Initialization (April 14, 2026)

## ບົດນຳ
ຂັ້ນຕອນນີ້ແມ່ນການຕັ້ງຄ່າ Password ໃຫ້ກັບ User `postgres` ໃນແຕ່ລະ Instance ທີ່ຫາກໍ່ສ້າງໃໝ່ (`-a2`), ການຕັ້ງຄ່າ Timezone, ແລະ ການ Run SQL Scripts.

---

### **0. ວິທີການຕັ້ງ Timezone ເປັນ Asia/Vientiane**
ເນື່ອງຈາກ Instance ຖືກສ້າງຂຶ້ນແລ້ວ, ໃຫ້ Run ຄຳສັ່ງນີ້ເພື່ອປ່ຽນ Timezone ໃຫ້ເປັນເວລາຂອງປະເທດລາວ:

```bash
# ປັບປຸງ Master Instances
gcloud sql instances patch panda-ev-instance-system-db-a2 --database-flags timezone=Asia/Vientiane
gcloud sql instances patch panda-ev-instance-mobile-db-a2 --database-flags timezone=Asia/Vientiane
gcloud sql instances patch panda-ev-instance-ocpp-db-a2   --database-flags timezone=Asia/Vientiane
gcloud sql instances patch panda-ev-instance-core-db-a2   --database-flags timezone=Asia/Vientiane

# ປັບປຸງ Read Replicas (Slaves)
gcloud sql instances patch panda-ev-instance-mobile-db-a2-replica --database-flags timezone=Asia/Vientiane
gcloud sql instances patch panda-ev-instance-ocpp-db-a2-replica   --database-flags timezone=Asia/Vientiane
```

---

### **1. ວິທີການຕັ້ງ Password ໃຫ້ User `postgres`**
ກະລຸນາ Run ຄຳສັ່ງເຫຼົ່ານີ້ໃນ Terminal ຂອງທ່ານ (ປ່ຽນ `YOUR_NEW_PASSWORD` ເປັນ Password ທີ່ທ່ານຕ້ອງການ):

```bash
# 1. ສໍາລັບ System Admin DB
gcloud sql users set-password postgres \
    --instance=panda-ev-instance-system-db-a2 \
    --password='YOUR_NEW_PASSWORD'

# 2. ສໍາລັບ Mobile API DB
gcloud sql users set-password postgres \
    --instance=panda-ev-instance-mobile-db-a2 \
    --password='YOUR_NEW_PASSWORD'

# 3. ສໍາລັບ OCPP API DB
gcloud sql users set-password postgres \
    --instance=panda-ev-instance-ocpp-db-a2 \
    --password='YOUR_NEW_PASSWORD'

# 4. ສໍາລັບ Core DB (Gateway/Notification)
gcloud sql users set-password postgres \
    --instance=panda-ev-instance-core-db-a2 \
    --password='YOUR_NEW_PASSWORD'
```

---

### **2. ວິທີການ Run SQL Initialization Scripts**

#### **ຂັ້ນຕອນທີ 1: ເປີດ Cloud SQL Auth Proxy**
ກະລຸນາເປີດ Proxy ເພື່ອເຊື່ອມຕໍ່ໄປຫາແຕ່ລະ Instance ເທື່ອລະຕົວ (ປ່ຽນຊື່ Instance ຕາມລຳດັບ):
```bash
cloud-sql-proxy --address 0.0.0.0 --port 5433 pandaev:asia-southeast1:<INSTANCE_NAME_A2>
```

#### **ຂັ້ນຕອນທີ 2: Run SQL Script**
ເປີດ Terminal ໃໝ່ ແລະ Run ຄຳສັ່ງລຸ່ມນີ້ຕາມລຳດັບ (ລະບົບຈະຖາມ Password ທີ່ທ່ານຫາກໍ່ຕັ້ງໄປ):

```bash
# 1. Setup System Admin DB
psql "host=127.0.0.1 port=5433 user=postgres" -f scripts/init/01-init-system-db.sql

# 2. Setup Mobile API DB
psql "host=127.0.0.1 port=5433 user=postgres" -f scripts/init/02-init-mobile-db.sql

# 3. Setup OCPP API DB
psql "host=127.0.0.1 port=5433 user=postgres" -f scripts/init/03-init-ocpp-db.sql

# 4. Setup Core DB (Gateway & Notification)
psql "host=127.0.0.1 port=5433 user=postgres" -f scripts/init/04-init-core-db.sql
```

---

### **3. ລາຍລະອຽດຂອງ Schema ທີ່ຖືກສ້າງ**
ຫຼັງຈາກ Run Script ສຳເລັດ, ທ່ານຈະໄດ້ໂຄງສ້າງດັ່ງນີ້:

| Service | Instance | Database Name | Schema | SQL User |
| :--- | :--- | :--- | :--- | :--- |
| Admin | `system-db-a2` | `panda_ev_system` | `panda_ev_system` | `panda_admin_user` |
| Mobile | `mobile-db-a2` | `panda_ev_mobile` | `panda_ev_core` | `panda_mobile_user` |
| OCPP | `ocpp-db-a2` | `panda_ev_ocpp` | `panda_ev_ocpp` | `panda_ocpp_user` |
| Gateway | `core-db-a2` | `panda_ev_core` | `panda_ev_gateway` | `panda_gateway_user` |
| Notification | `core-db-a2` | `panda_ev_core` | `panda_ev_noti` | `panda_noti_user` |

---

### **4. ການແກ້ໄຂບັນຫາ (Troubleshooting)**
ຖ້າທ່ານພົບ Error `must be able to SET ROLE`:
ຂ້າພະເຈົ້າໄດ້ແກ້ໄຂໄຟລ໌ SQL ໃຫ້ມີຄຳສັ່ງ `GRANT <role> TO postgres;` ຢູ່ນອກ Block ແລ້ວ. ໃຫ້ທ່ານລອງ Run ໄຟລ໌ SQL ອີກຄັ້ງ ມັນຈະຈັດການສິດໃຫ້ໂດຍອັດຕະໂນມັດ.

---

### **Next Step: Kubernetes Deployment**
ເມື່ອສ້າງ Database ສຳເລັດແລ້ວ, ທ່ານສາມາດ Deploy ລະບົບໄປຫາ Production Namespace ໄດ້ທັນທີ:
```bash
kubectl apply -k kubernetes/environments/prod
```
