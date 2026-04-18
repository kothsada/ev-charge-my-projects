# Step 01: Architecture Overview & Production Design 🏗️

## ຈຸດປະສົງ (Objective)
ເພື່ອອອກແບບພາບລວມຂອງລະບົບ (Architecture Overview) ສຳລັບ Panda EV Hub ໃນສະພາບແວດລ້ອມ Production. ລະບົບນີ້ຈະຮອງຮັບ Chargers 60 ເຄື່ອງຂຶ້ນໄປ ໂດຍເນັ້ນຄວາມສະຖຽນ (High Availability), ການຂະຫຍາຍຕົວ (Scalability), ແລະ ຄວາມປອດໄພ (Security) ເທິງ Google Cloud Platform (GCP) ໂດຍສະເພາະ GKE (Google Kubernetes Engine) ທີ່ Region `asia-southeast1`.

## ພາບລວມຂອງລະບົບ (Production Architecture Diagram)

```text
                                     [ Mobile App / Users ]        [ Charging Stations (60+) ]
                                                │                              │ (OCPP 1.6J / WSS)
                                                ▼                              ▼
┌─────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                 Google Cloud Load Balancer (HTTPS / WSS)                        │
│                                  (SSL/TLS Termination + Cloud Armor)                            │
└───────────────────────────────────────────────┬─────────────────────────────────────────────────┘
                                                │
                                                ▼
┌─────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                  GKE Cluster (asia-southeast1)                                  │
│                                                                                                 │
│  ┌──────────────────────────────┐                       ┌────────────────────────────────────┐  │
│  │   Stateless Node Pool (HPA)  │                       │      Stateful/OCPP Node Pool       │  │
│  │                              │                       │                                    │  │
│  │  [ Admin Service ] (Port 4000)                       │  [ OCPP CSMS Service ] (Port 4002) │  │
│  │        │          ▲          │                       │        │           ▲               │  │
│  │  [ Mobile API ] (Port 4001)  │                       │        │ (Sticky)  │               │  │
│  │        │          ▲          │                       │        ▼           │               │  │
│  │  [ Gateway ] (Port 4004)     │                       │     (PgBouncer Sidecar)            │  │
│  │        │          ▲          │                       └────────┬───────────┬───────────────┘  │
│  │  [ Notification ] (Port 5001)│                                │           │                  │
│  └────────┬──────────┬──────────┘                                │           │                  │
│           │          │                                           │           │                  │
│           ▼          ▼                                           ▼           ▼                  │
│  ┌──────────────────────────────┐                       ┌────────────────────────────────────┐  │
│  │    Message Broker System     │◄─────────────────────►│      Google Cloud Memorystore      │  │
│  │ (RabbitMQ HA / Cloud Pub/Sub)│                       │      (Redis Standard Tier HA)      │  │
│  │  [ Events / Commands / DLQ ] │                       │ [ Session, Cache, Rate Limit, Dedup]  │
│  └──────────────────────────────┘                       └────────────────────────────────────┘  │
│                                                                                                 │
└───────────────────────────────────────────────┬─────────────────────────────────────────────────┘
                                                │ (Cloud SQL Auth Proxy)
                                                ▼
┌─────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                Google Cloud SQL (PostgreSQL 18)                                 │
│                                (Private IP, HA, Read Replicas)                                  │
│                                                                                                 │
│  [ panda-ev-prod-admin-db ]   [ panda-ev-prod-mobile-db ]   [ panda-ev-prod-ocpp-db (Heavy) ]   │
│  [ panda-ev-prod-noti-db ]    [ panda-ev-prod-gateway-db ]                                      │
└─────────────────────────────────────────────────────────────────────────────────────────────────┘
```

## ສາຍພົວພັນການສື່ສານ (Communication Flow & Scaling)
- **Ingress Traffic:** 
  - Mobile/Web ຈະເຂົ້າຜ່ານ HTTPS (REST API).
  - Chargers ຈະເຂົ້າຜ່ານ WSS (WebSocket Secure) ໂດຍຕ້ອງມີ Sticky Sessions ຊີ້ໄປຫາ OCPP Pod ທີ່ຖືກຕ້ອງ.
- **Service to Database:** ທຸກ Service ຈະເຊື່ອມຕໍ່ຫາ Cloud SQL (Private IP) ຂອງຕົນເອງ ຜ່ານ **Cloud SQL Auth Proxy** (ຕັ້ງເປັນ Sidecar container ຢູ່ທຸກ Pod). ສຳລັບ OCPP ຈະມີການເພີ່ມ **PgBouncer** ເຂົ້າໄປເພື່ອຊ່ວຍຈັດການ Connection Pooling ທີ່ໜັກໜ່ວງ.
- **Service to Redis:** ໃຊ້ສຳລັບ Caching, Session Management (OCPP), Idempotency (Gateway), ແລະ Rate limiting. ທຸກ Service ຈະເຊື່ອມຕໍ່ຫາ Google Cloud Memorystore (Private IP).
- **Service to Broker:** ໃຊ້ RabbitMQ HA ຫຼື Pub/Sub ເພື່ອເຮັດ Asynchronous processing ເຊັ່ນ: Command execution, Event publishing, ແລະ Notifications ໂດຍມີ Dead Letter Queue (DLQ) ຮອງຮັບການ fail.
- **Scaling:** 
  - Admin, Mobile, Gateway, Notification ຈະຖືກ Scale ຂຶ້ນລົງອັດຕະໂນມັດຜ່ານ HPA (Horizontal Pod Autoscaler) ຕາມ CPU/Memory.
  - OCPP Service ຈະຖືກ Scale ຢ່າງລະມັດລະວັງ ໂດຍອີງຕາມຈຳນວນ Active WebSocket connections ແລະຕ້ອງຮອງຮັບ Reconnection routing.

## 📋 Checklist ສຳລັບ Step ນີ້
- [x] ອອກແບບພາບລວມ (Architecture Diagram) ຂອງລະບົບ Production.
- [x] ກຳນົດ Network Flow ສຳລັບການເຂົ້າເຖິງລະບົບ (Ingress, WebSockets).
- [x] ກຳນົດຮູບແບບການເຊື່ອມຕໍ່ຖານຂໍ້ມູນ (Cloud SQL Auth Proxy & PgBouncer).
- [x] ກຳນົດຮູບແບບການໃຊ້ງານ Cache & Message Broker.

## ⚠️ ສິ່ງທີ່ຕ້ອງລະວັງ (Notes)
- **OCPP WebSocket:** ເປັນ Stateful protocol. ການ Scale-in (ຫຍໍ້ຂະໜາດ) ຂອງ OCPP Pods ອາດເຮັດໃຫ້ Chargers ຫຼຸດການເຊື່ອມຕໍ່. ຕ້ອງມີການອອກແບບການປິດ Pod ແບບ Graceful shutdown.
- **Database Separation:** ການແຍກ Database Instance ອາດຈະເຮັດໃຫ້ຄ່າໃຊ້ຈ່າຍ (Cost) ສູງຂຶ້ນ ແຕ່ໄດ້ຄວາມປອດໄພ ແລະ ຄວາມສະຖຽນຂອງແຕ່ລະ Service ທີ່ແຍກຈາກກັນຢ່າງຊັດເຈນ. ຖ້າຢາກປະຢັດງົບ, ສາມາດລວມບາງ Database (ເຊັ່ນ Gateway + Noti) ໄວ້ໃນ Instance ດຽວກັນ ແຕ່ແຍກ Schema ໄດ້.
- **Private IP:** ການສື່ສານພາຍໃນ (GKE ຫາ Cloud SQL, Memorystore) ຕ້ອງແລ່ນຜ່ານ Private IP ພາຍໃນ VPC ດຽວກັນເທົ່ານັ້ນ ເພື່ອຄວາມປອດໄພສູງສຸດ.

---
✅ Step 01 ສຳເລັດ — ບັນທຶກໃສ່ STEP-01-architecture-overview.md
