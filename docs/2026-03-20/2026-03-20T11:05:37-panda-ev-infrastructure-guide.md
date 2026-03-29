# 📑 Panda EV: Master Infrastructure & Troubleshooting Guide (v2.0)

---

## Step 1: ການຕັ້ງຄ່າ Identity & Access (IAM)

ເປັນການສ້າງສິດໃຫ້ Application ສາມາດເຂົ້າເຖິງຊັບພະຍາກອນຂອງ Google Cloud (GCP) ໄດ້.

### 1.1 ສ້າງ GCP Service Account (GSA)

```bash
# ສ້າງ Account ສໍາລັບ App
gcloud iam service-accounts create panda-system-api-sa --project=pandaev

# ໃຫ້ສິດ Cloud SQL Client (ເພື່ອໃຫ້ App ຕໍ່ Database ໄດ້)
gcloud projects add-iam-policy-binding pandaev \
  --member="serviceAccount:panda-system-api-sa@pandaev.iam.gserviceaccount.com" \
  --role="roles/cloudsql.client"
```

### 1.2 ຜູກສິດ Workload Identity

ເຮັດໃຫ້ Kubernetes Service Account (KSA) ສາມາດໃຊ້ສິດຂອງ GSA ໄດ້.

```bash
gcloud iam service-accounts add-iam-policy-binding \
  panda-system-api-sa@pandaev.iam.gserviceaccount.com \
  --role="roles/iam.workloadIdentityUser" \
  --member="serviceAccount:pandaev.svc.id.goog[panda-ev/panda-system-api-ksa]"
```

---

## Step 2: ການຈັດການ Docker Images (AMD64)

> **ປັນຫາທີ່ພົບ:** `exec format error` ຍ້ອນ Build ຈາກ Mac M1/M2 (ARM64).  
> **ວິທີແກ້:** ຕ້ອງບັງຄັບໃຫ້ເປັນ `linux/amd64` ເພື່ອໃຫ້ລັນເທິງ GKE ໄດ້.

```bash
# Redis
docker pull --platform linux/amd64 redis:7-alpine
docker tag redis:7-alpine asia-southeast1-docker.pkg.dev/pandaev/panda-ev-repo/redis:dev
docker push asia-southeast1-docker.pkg.dev/pandaev/panda-ev-repo/redis:dev

# RabbitMQ
docker pull --platform linux/amd64 rabbitmq:3-management-alpine
docker tag rabbitmq:3-management-alpine asia-southeast1-docker.pkg.dev/pandaev/panda-ev-repo/rabbitmq:dev
docker push asia-southeast1-docker.pkg.dev/pandaev/panda-ev-repo/rabbitmq:dev
```

---

## Step 3: ການຈັດການ Secrets & Database URL

> **ປັນຫາທີ່ພົບ:** `P1013 (Invalid Port)` ຍ້ອນ Password ມີຕົວອັກສອນພິເສດ ແລະ ຊື່ Database ປ່ຽນໃໝ່.

### 3.1 ການ Encode Password

ຖ້າ Password ມີຕົວອັກສອນພິເສດ ເຊັ່ນ `#`, `^`, `}` ຕ້ອງປ່ຽນເປັນ:

| ຕົວອັກສອນ | Encoded |
|-----------|---------|
| `#`       | `%23`   |
| `^`       | `%5E`   |
| `}`       | `%7D`   |

### 3.2 ສ້າງ Secret ໃໝ່ (ຊີ້ຫາ Database ໃໝ່: `panda-ev-csms-system`)

```bash
# ລຶບຕົວເກົ່າກ່ອນ
kubectl delete secret panda-system-api-secrets -n panda-ev

# ສ້າງໃໝ່ (ໃຊ້ Password ທີ່ Encode ແລ້ວ ແລະ ຊື່ DB ໃໝ່)
kubectl create secret generic panda-system-api-secrets \
  --namespace=panda-ev \
  --from-literal=DATABASE_URL='postgresql://postgres:1234567890@127.0.0.1:5432/panda-ev-system-db?schema=panda_ev_system' \
  --from-literal=PORT='4000' \
  --from-literal=NODE_ENV='production' \
  --from-literal=RABBITMQ_URL='amqp://guest:guest@rabbitmq-service:5672' \
  --from-literal=REDIS_URL='redis://redis-service:6379' \
  --from-literal=JWT_SECRET='K0thsada90' \
  --from-literal=JWT_REFRESH_SECRET='K0thsada90_REFRESH' \
  --from-literal=RABBITMQ_QUEUE='PANDA_EV_SYSTEM_QUEUE' \
  --from-literal=RABBITMQ_SYSTEM_EVENTS_QUEUE='PANDA_EV_SYSTEM_EVENTS' \
  --from-literal=JWT_ACCESS_EXPIRES_IN='60m' \
  --from-literal=JWT_REFRESH_EXPIRES_IN='7d' \
  --from-literal=SWAGGER_ENABLED='true'
```

---

## Step 4: ການລ້າງລະບົບເພື່ອ Deploy ໃໝ່ (Cleanup)

ກ່ອນຈະ Push ຈາກ GitHub ໃໝ່ ໃຫ້ລ້າງ Deployment ເກົ່າທີ່ Crash ອອກກ່ອນ:

```bash
# ລຶບ Deployment
kubectl delete deployment panda-system-api -n panda-ev

# (ທາງເລືອກ) ລຶບທຸກ Pod ໃນ Namespace ເພື່ອຄວາມສະອາດ
kubectl delete pods --all -n panda-ev
```

---

## Step 5: Troubleshooting & Monitoring (ຄູ່ມືເບິ່ງ Log)

ໃຊ້ໃນການກວດສອບວ່າເປັນຫຍັງ Pod ຈຶ່ງບໍ່ Ready (`0/2`).

### 5.1 ລຳດັບການ Check Log

**1. ເບິ່ງພາບລວມ:**

```bash
kubectl get pods -n panda-ev
```

**2. ເບິ່ງ Error ຂອງ NestJS:**

```bash
kubectl logs -l app=panda-system-api -n panda-ev -c panda-system-api
```

> ຖ້າເຫັນ `P3009` — ໝາຍຄວາມວ່າ Migration ເກົ່າ Fail (ຕ້ອງ Resolve ຫຼື Reset DB).

**3. ເບິ່ງ Error ຂອງ DB Proxy:**

```bash
kubectl logs -l app=panda-system-api -n panda-ev -c cloud-sql-proxy
```

> - ຖ້າເຫັນ `i/o timeout` — ເຊັກ Network ຫຼື Firewall.  
> - ຖ້າເຫັນ `403 Forbidden` — ເຊັກສິດ IAM ໃນ Step 1.

---

## Step 6: ການຈັດການ Database ຜ່ານ Public IP (Local Machine)

ວິທີນີ້ຊ່ວຍໃຫ້ເຈົ້າລັນ `npx prisma migrate` ຫຼື Reset DB ຈາກເຄື່ອງເຈົ້າໄດ້ໂດຍກົງ.

### 6.1 ການຕັ້ງຄ່າຢູ່ເທິງ Google Cloud Console (ສຳຄັນ)

ກ່ອນຈະລັນ Proxy ຢູ່ເຄື່ອງ, ເຈົ້າຕ້ອງອະນຸຍາດໃຫ້ Instance ຂອງເຈົ້າຮັບການເຊື່ອມຕໍ່ແບບ Public ກ່ອນ:

1. ໄປທີ່ **Cloud SQL** > ເລືອກ Instance `panda-ev-system-db`.
2. ໄປທີ່ເມນູ **Connections** > Tab **Networking**.
3. ຕິກເລືອກ **Public IP**.
4. ໃນສ່ວນ **Authorized Networks**, ກົດ **Add Network**:
   - ຊື່: `My Local Machine`
   - Network: ໃສ່ IP ຂອງເຄື່ອງເຈົ້າ (ກວດເບິ່ງໄດ້ຈາກ [whatsmyip.org](https://www.whatsmyip.org))
5. ກົດ **SAVE**.

### 6.2 ການເປີດ Cloud SQL Auth Proxy ຢູ່ເຄື່ອງ Local

ເປີດ Terminal ແລ້ວລັນຄຳສັ່ງນີ້ (ປັບພອດເປັນ `5433` ເພື່ອບໍ່ໃຫ້ຕຳກັບ Postgres ຢູ່ເຄື່ອງ):

```bash
cloud-sql-proxy --address 0.0.0.0 --port 5433 pandaev:asia-southeast1:panda-ev-system-db
```

> ໝາຍເຫດ: ໃຫ້ແນ່ໃຈວ່າໃຊ້ Connection Name ທີ່ຖືກຕ້ອງຂອງ Instance.

### 6.3 ການລັນ Prisma ຈາກເຄື່ອງ Local

ຫຼັງຈາກ Proxy ລັນແລ້ວ, ອັບເດດໄຟລ໌ `.env` ຢູ່ເຄື່ອງໃຫ້ຊີ້ຫາພອດ `5433`:

```env
# ຕົວຢ່າງໃນໄຟລ໌ .env ຢູ່ເຄື່ອງ Local
DATABASE_URL="postgresql://postgres:PASSWORD@127.0.0.1:5433/panda-ev-system-db?schema=panda_ev_system"
```

ຈາກນັ້ນລັນຄຳສັ່ງຈັດການ Database:

```bash
# Reset Database
npx prisma migrate reset

# Deploy Schema
npx prisma migrate deploy
```

---

## 📘 Troubleshooting Update: Public Connection

### 🌐 Public Access Checklist

**ປັນຫາ:** Proxy ຂຶ້ນ `i/o timeout` ຫຼື `Connection Refused`.

**ວິທີກວດສອບ:**

1. ເຊັກວ່າໄດ້ເປີດ **Public IP** ໃນ Cloud SQL ແລ້ວຫຼືຍັງ?
2. ເຊັກວ່າ IP ຂອງເຄື່ອງ (Public IP) ໄດ້ຖືກເພີ່ມເຂົ້າໃນ **Authorized Networks** ແລ້ວຫຼືຍັງ?  
   > IP ຫ້ອງການ/ບ້ານ ມັກຈະປ່ຽນເລື້ອຍໆ — ຖ້າຕໍ່ບໍ່ໄດ້ໃຫ້ມາເຊັກຈຸດນີ້ກ່ອນ.
3. ໝັ້ນໃຈວ່າບໍ່ມີ Firewall ຂອງບໍລິສັດບລັອກພອດ `3307` (ພອດຫຼັກທີ່ Proxy ໃຊ້ລົມກັບ GCP).

---

## 🚀 ບາດກ້າວຕໍ່ໄປ

ຕອນນີ້ Infrastructure ທຸກຢ່າງພ້ອມແລ້ວ!

1. ເປີດ Public IP ແລະ Add IP ເຄື່ອງ.
2. ລັນ Proxy ດ້ວຍພອດ `5433`.
3. ລັນ `npx prisma migrate reset` (ເພື່ອໃຫ້ DB `panda-ev-system-db` ສະອາດ).
4. **Push code ຈາກ GitHub** ເພື່ອໃຫ້ມັນ Deploy App ໃໝ່ລົງໄປ.

**ຄຳສັ່ງຈັດການ Database (Prisma):**

```bash
npx prisma migrate reset                            # ລ້າງ DB ໃໝ່ໝົດ
npx prisma migrate resolve --applied [ຊື່_MIGRATION] # ແກ້ໄຂ Migration ທີ່ Fail
```

---

## 💡 ຂໍ້ຄວນລະວັງສຸດທ້າຍ (Final Advice)

- **GitHub Deploy:** ເມື່ອເຈົ້າ Push ໃໝ່, GitHub ຈະສ້າງ Pod ທີ່ໃຊ້ Secret ໃໝ່. ຖ້າ Database ໃໝ່ຍັງວ່າງເປົ່າ, ໝັ້ນໃຈວ່າ App ຂອງເຈົ້າມີຄຳສັ່ງ `npx prisma migrate deploy` ຢູ່ໃນຕອນ Start.
- **Architecture:** ທຸກໆ Image ທີ່ Push ເອງ (Redis/RabbitMQ) ຕ້ອງເປັນ **AMD64** ເທົ່ານັ້ນ.

---

*ຄູ່ມືນີ້ຈະຊ່ວຍໃຫ້ເຈົ້າ ແລະ ທີມງານຈັດການລະບົບໄດ້ຢ່າງເປັນມືອາຊີບ ແລະ ແກ້ໄຂບັນຫາໄດ້ກົງຈຸດ!*
