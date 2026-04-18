# Step 04: Memorystore for Redis Migration ⚡

## ຈຸດປະສົງ (Objective)
ເພື່ອຍ້າຍລະບົບ Cache ແລະ Session ຈາກ Redis ທີ່ເປັນ Self-hosted ຢູ່ໃນ GKE ໄປຫາ **Google Cloud Memorystore for Redis (Standard Tier HA)**. ເພື່ອໃຫ້ໄດ້ລະບົບທີ່ High Availability (HA), Managed ໂດຍ Google (ບໍ່ຕ້ອງແປງ/ອັບເດດເອງ), ແລະ ມີປະສິດທິພາບສູງກວ່າໃນລະດັບ Production.

## 1. Memorystore Design (Production)

| Parameter | Configuration |
| :--- | :--- |
| **Tier** | **Standard Tier (HA)** - ຈະມີ Replication ຂ້າມ Zone ອັດຕະໂນມັດ |
| **Capacity** | 2GB - 5GB (ເລີ່ມຕົ້ນ 2GB ແລະ ຂະຫຍາຍໄດ້ຕາມ Load) |
| **Region** | `asia-southeast1` (Singapore) - ບ່ອນດຽວກັບ GKE Cluster |
| **Network** | **Private IP** (VPC Peering ກັບ `panda-ev-vpc`) |
| **Redis Version** | 7.2 (ຫຼື ເວີຊັນຫຼ້າສຸດທີ່ GCP ຮອງຮັບ) |
| **AUTH/TLS** | Enable AUTH (Password) ແລະ ປິດ Public access |

## 2. ຍຸດທະສາດການຍ້າຍຂໍ້ມູນ (Migration Steps)
ເນື່ອງຈາກ Redis ໃນ Dev ສ່ວນໃຫຍ່ແມ່ນໃຊ້ເກັບຂໍ້ມູນຊົ່ວຄາວ (Stateless sessions, Caches), ເຮົາຈະໃຊ້ວິທີ **"Cold Cutover"** ທີ່ມີ Downtime ໜ້ອຍທີ່ສຸດ:

1. **Provisioning:** ສ້າງ Instance ໃໝ່ໃນ GCP Memorystore ຜ່ານ Google Cloud Console ຫຼື Terraform.
2. **Connectivity Check:** ສ້າງ Pod ທົດສອບໃນ GKE ເພື່ອ `ping` ຫາ Private IP ຂອງ Memorystore ໃຫ້ໝັ້ນໃຈວ່າ Network ເຊື່ອມຕໍ່ໄດ້.
3. **Environment Update:** ອັບເດດ `REDIS_HOST` ແລະ `REDIS_PASSWORD` ໃນ GCP Secret Manager ຫຼື ConfigMap.
4. **Rolling Update:** ເລີ່ມ Deploy Services (Mobile, Admin, OCPP, etc.) ໃໝ່ເທື່ອລະ Service ໃຫ້ໄປຊີ້ຫາ Memorystore ໃໝ່.
5. **Observation:** ກວດສອບ Dashboard ໃນ Cloud Monitoring ວ່າ Cache Hit Rate ແລະ Connection ປົກກະຕິ.
6. **Cleanup:** ຫຼັງຈາກໝັ້ນໃຈແລ້ວ, ຈຶ່ງປິດ ແລະ ລຶບ Redis Pod ເກົ່າທີ່ຢູ່ໃນ GKE.

## 3. Config Changes (NestJS Service Update)
ທຸກ Service ທີ່ໃຊ້ Redis ຕ້ອງປ່ຽນແປງ Config ດັ່ງນີ້:

```env
# ປ່ຽນຈາກ Service Name ໃນ K8s ມາເປັນ Private IP ຂອງ Memorystore
REDIS_HOST=10.x.x.x 
REDIS_PORT=6379
REDIS_PASSWORD=xxxxxx-xxxx-xxxx # Memorystore ປົກກະຕິຈະມີ Password ຖ້າເປີດ AUTH
REDIS_TLS_ENABLED=false # ຖ້າໃຊ້ພາຍໃນ VPC ບໍ່ຈຳເປັນຕ້ອງໃຊ້ TLS ກໍ່ໄດ້ (ແຕ່ແນະນຳໃຫ້ເປີດຖ້າຕ້ອງການຄວາມປອດໄພສູງສຸດ)
```

## 4. ການນຳໃຊ້ Redis ໃນແຕ່ລະ Service (Production Role)
- **OCPP:** ເກັບ WebSocket Identity ຂອງ Charger ເພື່ອເຮັດ Routing.
- **Mobile API:** ເກັບ User Session, OTP Rate-limit, ແລະ Cache ລາຄາພະລັງງານ.
- **Gateway:** ເກັບ Idempotency Key ຂອງການຈ່າຍເງິນ (ປ້ອງກັນການຈ່າຍຊໍ້າ).
- **Notification:** ເກັບ Dedup ID ຂອງ FCM ເພື່ອບໍ່ໃຫ້ສົ່ງ Push ຊໍ້າກັນ.

## 📋 Checklist ສຳລັບ Step ນີ້
- [x] ອອກແບບ Memorystore Instance (Standard Tier HA, 2GB+).
- [x] ກຳນົດ Network ເປັນ Private IP ພາຍໃນ VPC ດຽວກັນກັບ GKE.
- [x] ວາງແຜນການຍ້າຍຂໍ້ມູນແບບ Cold Cutover.
- [x] ກຽມ Environment Variables ສຳລັບການອັບເດດ Service.

## ⚠️ ສິ່ງທີ່ຕ້ອງລະວັງ (Notes)
- **Max Memory Policy:** ຕ້ອງຕັ້ງຄ່າ `maxmemory-policy` ເປັນ `allkeys-lru` ຫຼື `volatile-lru` ເພື່ອໃຫ້ Redis ລຶບ Key ເກົ່າອອກອັດຕະໂນມັດເມື່ອ Memory ເຕັມ.
- **Network Latency:** ການແລ່ນ Memorystore ໃນ Region ດຽວກັບ GKE ຈະໃຫ້ Latency ຕໍ່າທີ່ສຸດ (< 1ms).
- **Security:** ຫ້າມເປີດ Public IP ໃຫ້ Redis ເດັດຂາດ. ໃຫ້ໃຊ້ພຽງແຕ່ Private IP ພາຍໃນ VPC ເທົ່ານັ້ນ.

---
✅ Step 04 ສຳເລັດ — ບັນທຶກໃສ່ STEP-04-memorystore-migration.md
