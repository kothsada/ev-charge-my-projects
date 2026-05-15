# ຄຳສັ່ງອ້າງອີງ — Panda EV Platform
> ລວມຄຳສັ່ງທັງໝົດທີ່ໃຊ້ງານໃນໂປຣເຈັກ ພ້ອມຄຳອະທິບາຍເປັນພາສາລາວ

---

## 1. ການຕັ້ງຄ່າໂປຣເຈັກ (Project Setup)

```bash
npm install
```
> ຕິດຕັ້ງ dependencies ທັງໝົດຂອງ service ທີ່ເລືອກ

```bash
npm run build
```
> ແປງ TypeScript ເປັນ JavaScript ເພື່ອໃຊ້ງານໃນ production

---

## 2. ການລັນ Server (Running the Server)

```bash
npm run start:dev
```
> ລັນ server ໃນ development mode ພ້ອມ hot-reload (ໄຟລ໌ປ່ຽນ → restart ອັດຕະໂນມັດ)

```bash
npm run start:prod
```
> ລັນ server ໃນ production mode (ຕ້ອງ build ກ່ອນ)

| Service | Port |
|---------|------|
| panda-ev-csms-system-admin | 4000 (prod) / 3000 (dev) |
| panda-ev-client-mobile | 4001 |
| panda-ev-ocpp | 4002 |
| panda-ev-gateway-services | 4004 |
| panda-ev-notification | 5001 |

---

## 3. Prisma — ຖານຂໍ້ມູນ (Database)

```bash
npx prisma generate
```
> ສ້າງ Prisma Client ໃໝ່ຫຼັງຈາກແກ້ໄຂ `schema.prisma` — ຕ້ອງລັນທຸກຄັ້ງທີ່ schema ປ່ຽນ

```bash
npx prisma migrate deploy
```
> Apply migration ທີ່ຍັງບໍ່ໄດ້ apply ໃສ່ database (ໃຊ້ໃນ production/CI)

```bash
npx prisma migrate status
```
> ກວດສອບວ່າ migration ໃດຍັງ pending ຢູ່

```bash
npx prisma migrate resolve --applied <migration-name>
```
> ໝາຍ migration ທີ່ apply SQL ໂດຍກົງແລ້ວວ່າ "applied" ໂດຍບໍ່ run SQL ຊ້ຳ

```bash
npx prisma studio
```
> ເປີດ GUI ສຳລັບເບິ່ງ/ແກ້ໄຂຂໍ້ມູນໃນ database ຜ່ານ browser

---

## 4. Seed ຂໍ້ມູນ (Seeding)

### Admin Service (`panda-ev-csms-system-admin`)

```bash
npx prisma db seed
```
> ໃສ່ຂໍ້ມູນເລີ່ມຕົ້ນທັງໝົດ: permissions (99), roles (4), admin user, ສະຖານທີ່, ສະຖານີສາກໄຟ

```bash
npx ts-node prisma/seed/seed.ts
```
> ລັນ seed script ໂດຍກົງ (ຄືກັນກັບ `npx prisma db seed`)

```bash
npx ts-node prisma/seed/seed-locations.ts
```
> ໃສ່ຂໍ້ມູນພູມສາດ: 4 ພາກ, 18 ແຂວງ, 139 ເມືອງ/ເທດສະບານ

```bash
npx ts-node prisma/seed/seed-stations.ts
```
> ໃສ່ຂໍ້ມູນສະຖານີສາກໄຟ 6 ສະຖານີ ໃນນະຄອນຫຼວງວຽງຈັນ

```bash
npx ts-node prisma/seed/seed-demo.ts
```
> ໃສ່ຂໍ້ມູນ demo ສຳລັບທົດສອບ

```bash
npx ts-node prisma/seed/seed-ocpp-actions.ts
```
> ໃສ່ຂໍ້ມູນ OCPP 1.6J actions ທັງ 28 ລາຍການ

### Notification Service (`panda-ev-notification`)

```bash
npx ts-node prisma/seed/seed-templates.ts
```
> ໃສ່ template ການແຈ້ງເຕືອນເລີ່ມຕົ້ນ (FCM push templates)

---

## 5. ການກວດສອບ Code (Code Quality)

```bash
npx tsc --noEmit
```
> ກວດສອບ TypeScript type errors ທັງໝົດໂດຍບໍ່ compile ໄຟລ໌ — **ລັນກ່ອນ push ສະເໝີ**

```bash
npm run lint
```
> ກວດສອບ code style ດ້ວຍ ESLint ແລະ auto-fix ບັນຫາທີ່ fix ໄດ້

```bash
npm run format
```
> Format code ດ້ວຍ Prettier

---

## 6. Testing

```bash
npm run test
```
> ລັນ unit tests ທັງໝົດ

```bash
npm run test:cov
```
> ລັນ tests ພ້ອມສະແດງ coverage report

```bash
npx jest src/modules/auth/auth.service.spec.ts
```
> ລັນ test ສຳລັບໄຟລ໌ດຽວ (ປ່ຽນ path ຕາມຕ້ອງການ)

```bash
npm run test:e2e
```
> ລັນ end-to-end tests

---

## 7. Migration ດ້ວຍ SQL ໂດຍກົງ (Manual Migration Workflow)

> ໃຊ້ວິທີນີ້ເພາະ `prisma migrate dev` ຕ້ອງການ interactive TTY ແລະ shadow DB

```bash
# ຂັ້ນຕອນທີ 1: ສ້າງ migration folder ແລະ ຂຽນ SQL
mkdir -p prisma/migrations/$(date +%Y%m%d%H%M%S)_your_migration_name
# ຈາກນັ້ນຂຽນ SQL ໃສ່ migration.sql

# ຂັ້ນຕອນທີ 2: Apply SQL ກັບ database ໂດຍກົງ
psql "$DATABASE_URL" < prisma/migrations/<timestamp>_<name>/migration.sql

# ຂັ້ນຕອນທີ 3: ໝາຍວ່າ applied ແລ້ວ
npx prisma migrate resolve --applied <timestamp>_<name>

# ຂັ້ນຕອນທີ 4: Regenerate Prisma Client
npx prisma generate
```

---

## 8. Docker

```bash
docker build -t panda-system-api .
```
> Build Docker image ຂອງ admin service

```bash
docker-compose up -d
```
> ເລີ່ມ services ທັງໝົດ (PostgreSQL, Redis, RabbitMQ) ໃນ background

```bash
docker-compose logs -f panda-system-api
```
> ເບິ່ງ logs ແບບ real-time

> ⚠️ **ໝາຍເຫດ**: Entry point ຂອງ admin service ຢູ່ທີ່ `dist/src/main.js` (ບໍ່ແມ່ນ `dist/main.js`) ເພາະ `tsconfig.json` ບໍ່ມີ `rootDir`

---

## 9. Kubernetes / GKE

```bash
# Login ກັບ GCP (ຕ້ອງ login ດ້ວຍຕົນເອງ)
gcloud auth login
gcloud container clusters get-credentials <cluster-name> --region asia-southeast1
```
> ຕັ້ງຄ່າ kubeconfig ສຳລັບເຊື່ອມຕໍ່ GKE cluster

```bash
kubectl get pods -n panda-ev-prod
```
> ເບິ່ງ pod ທັງໝົດໃນ namespace production

```bash
kubectl logs -f deployment/panda-system-api -n panda-ev-prod
```
> ເບິ່ງ logs ຂອງ admin service ແບບ real-time

```bash
kubectl rollout restart deployment/panda-system-api -n panda-ev-prod
```
> Restart deployment (ໃຊ້ຫຼັງ update secret ຫຼື config)

```bash
# Deploy ດ້ວຍ GitHub Actions
gh workflow run "Build and Deploy — panda-system-api"
```
> Trigger CI/CD pipeline ດ້ວຍ manual

---

## 10. Key Generation — RS256 JWT

```bash
# ສ້າງ key pairs ທັງໝົດ ສຳລັບທຸກ services (ລັນຈາກ monorepo root)
chmod +x generate-service-keys-local.sh
./generate-service-keys-local.sh
```
> ສ້າງ RS256 private/public key pairs ສຳລັບ service-to-service JWT ທຸກ service

```bash
# ສ້າງ QR signing secret (ຕ້ອງໃຊ້ secret ດຽວກັນໃນ Admin ແລະ Mobile)
export QR_SIGNING_SECRET=$(openssl rand -hex 32)
echo $QR_SIGNING_SECRET  # ບັນທຶກໄວ້ — ຫາກ shell ປິດ secret ຈະໝົດ
```
> ສ້າງ secret ສຳລັບ sign QR code (HMAC-SHA256)

```bash
# Push secrets ໄປ Kubernetes (ລັນ script ໃນ shell ດຽວກັນຫຼັງ export)
cd panda-ev-csms-system-admin && ./create-secret.sh
cd ../panda-ev-client-mobile  && ./create-secret.sh
cd ../panda-ev-ocpp           && ./create-secret.sh
```
> ສ້າງ Kubernetes Secret ຈາກ key files ທ້ອງຖິ່ນ

---

## 11. RabbitMQ — ກວດສອບ Queue

```bash
# ເຂົ້າ RabbitMQ Management UI
open http://localhost:15672
# username: user / password: password (ຕາມ .env)
```
> ກວດສອບ queues, messages, consumers ຜ່ານ browser

---

## 12. Redis — ກວດສອບ Cache

```bash
# ເຊື່ອມຕໍ່ Redis ໂດຍກົງ
redis-cli -u $REDIS_URL

# ຄຳສັ່ງທີ່ໃຊ້ເລື້ອຍ
KEYS cache:*           # ເບິ່ງ cache keys ທັງໝົດ
GET cache:stations:*   # ເບິ່ງ cache ສະຖານີ
DEL cache:stations:*   # ລົບ cache ສະຖານີ
TTL <key>              # ກວດ TTL ຂອງ key
```

---

## 13. PostgreSQL — ກວດສອບ Database

```bash
# ເຊື່ອມຕໍ່ database ໂດຍກົງ
psql "$DATABASE_URL"

# ຄຳສັ່ງທີ່ໃຊ້ເລື້ອຍ
\dt panda_ev_system.*          # ເບິ່ງ tables ໃນ schema
\d "panda_ev_system"."users"   # ເບິ່ງ structure ຂອງ table

# ກວດສອບ permissions ທີ່ assign ໃຫ້ user
SELECT p.slug FROM permissions p
JOIN role_permissions rp ON rp.permission_id = p.id
JOIN user_roles ur ON ur.role_id = rp.role_id
WHERE ur.user_id = '<user-id>';
```

---

## 14. OCPP Virtual Charge Point (Simulator)

```bash
# ລັນ OCPP 1.6 simulator
cd ocpp-virtual-charge-point
npm start index_16.ts

# ລັນ OCPP 2.0.1 simulator
npm start index_201.ts

# ກວດສອບ code quality
npm run check
```

```bash
# ສັ່ງງານ simulator ຜ່ານ admin HTTP API (port 9999)
curl -X POST http://localhost:9999/execute \
  -H "Content-Type: application/json" \
  -d '{"action": "Heartbeat", "payload": {}}'
```
> ໃຊ້ simulator ທົດສອບ OCPP protocol ໂດຍບໍ່ຕ້ອງການ charger ຈິງ

---

## 15. Session Documentation

```bash
# ສ້າງ folder ສຳລັບ session ວັນນີ້
mkdir -p docs/$(date +%Y-%m-%d)

# ສ້າງໄຟລ໌ documentation ພ້ອມ timestamp
TIMESTAMP=$(date '+%Y-%m-%dT%H:%M:%S')
touch "docs/$(date +%Y-%m-%d)/${TIMESTAMP}-Feature_Name.md"
```
> ບັນທຶກ implementation session ຕາມ convention ຂອງໂປຣເຈັກ

---

## 16. ຄຳສັ່ງທີ່ໃຊ້ໃນ Session ນີ້ (2026-04-19)

```bash
# ກວດສອບ TypeScript types
npx tsc --noEmit

# ລັນ seed ຫຼັງຈາກເພີ່ມ permissions ໃໝ່ (payments:read, payments:manage)
npx prisma db seed
```

### ສິ່ງທີ່ implement ໃນ session ນີ້:

| Module | Path | ຄຳອະທິບາຍ |
|--------|------|-----------|
| `GatewayPaymentsModule` | `src/modules/gateway-payments/` | ອ່ານຂໍ້ມູນ payments, refunds, webhook logs, bank configs ຈາກ schema `panda_ev_gateway` |
| `NotiManagementModule` | `src/modules/noti-management/` | CRUD notification templates + ອ່ານ logs, devices, SMS logs, station stats ຈາກ schema `panda_ev_noti` |
| `GatewayDbService` | `src/configs/prisma/gateway-db.service.ts` | Raw pg Pool ເຊື່ອມຕໍ່ `panda_ev_gateway` schema (fallback ໄປ `DATABASE_URL`) |
| `NotiDbService` | `src/configs/prisma/noti-db.service.ts` | Raw pg Pool ເຊື່ອມຕໍ່ `panda_ev_noti` schema (fallback ໄປ `DATABASE_URL`) |

### Permissions ທີ່ເພີ່ມໃໝ່:

| Permission | ໃຜມີ | ຄຳອະທິບາຍ |
|-----------|------|-----------|
| `payments:read` | super-admin, admin, manager, viewer | ເບິ່ງ payment transactions, refunds, webhook logs |
| `payments:manage` | super-admin, admin | ແກ້ໄຂ bank provider configs |

### Sensitive fields masking (Bank Config):

> ຜູ້ໃຊ້ທີ່ **ບໍ່ແມ່ນ super-admin** ຈະເຫັນ fields ເຫຼົ່ານີ້ເປັນ `•••••••`:
> - `mcid`, `shopcode`, `mcc`, `bankAccount`, `terminalId`
>
> **Super-admin** ກວດສອບໂດຍ: `permissions.includes('roles:manage')` — ເພາະ role `admin` ບໍ່ມີ `roles:*` permissions

### Environment variables ທີ່ເພີ່ມໃໝ່:

**`.env` (local dev — port 5433 ຜ່ານ Cloud SQL Proxy ທ້ອງຖິ່ນ):**
```env
DATABASE_URL="postgresql://panda_admin_user:Panda>2026>Admin1234567890>@127.0.0.1:5433/panda_ev_system?schema=panda_ev_system&options=-c%20timezone%3DAsia%2FVientiane"
GATEWAY_DATABASE_URL="postgresql://panda_gateway_user:Panda>2026>WriteGateway1234567890>@127.0.0.1:5433/panda_ev_core"
NOTI_DATABASE_URL="postgresql://panda_noti_user:Panda>2026>ReadNotification1234567890>@127.0.0.1:5433/panda_ev_core"
```

### Seed Users (ຫຼັງ rename):

| Email | Password | Role | ສິດທິ |
|-------|----------|------|-------|
| `superadmin@pandaev.com` | `Admin@123456` | `super-admin` | ທຸກສິດ (99) |
| `admin@pandaev.com` | `Admin@123456` | `admin` | 89 ສິດ (ຍົກເວັ້ນ roles/permissions) |

> ⚠️ **Rename logic**: ໃຊ້ `findUnique` + `update` in-place ເພື່ອຮັກສາ user ID — ບໍ່ delete ເພາະ `audit_logs` ມີ FK `RESTRICT`

---

## 17. ການ Deploy ໄປ Kubernetes (csms-system-admin)

### Architecture ຂອງ DB connections ໃນ K8s:

```
panda-system-api pod
├── cloud-sql-proxy-master  (port 5432) → pandaev:asia-southeast1:panda-ev-instance-system-db-a2
│     └── DATABASE_URL → panda_ev_system schema
└── cloud-sql-proxy-core    (port 5433) → pandaev:asia-southeast1:panda-ev-instance-core-db-a2
      ├── GATEWAY_DATABASE_URL → panda_ev_core / panda_ev_gateway schema
      └── NOTI_DATABASE_URL    → panda_ev_core / panda_ev_noti schema
```

### ຂັ້ນຕອນ Deploy:

```bash
# ຂັ້ນຕອນທີ 1: ສ້າງ/ອັບເດດ Kubernetes Secret (ລັນໃນ shell ດຽວກັນ)
cd panda-ev-csms-system-admin
./create-secret.sh panda-ev-prod

# ຂັ້ນຕອນທີ 2: Trigger CI/CD pipeline
gh workflow run "Build and Deploy — panda-system-api"

# ກວດສອບ deployment status
kubectl get pods -n panda-ev-prod -l app=panda-system-api
kubectl rollout status deployment/panda-system-api -n panda-ev-prod
```

### ໄຟລ໌ທີ່ອັບເດດສຳລັບ deploy:

| ໄຟລ໌ | ການປ່ຽນແປງ |
|------|-----------|
| `create-secret.sh` | ເພີ່ມ `GATEWAY_DATABASE_URL`, `NOTI_DATABASE_URL` ໃສ່ secret |
| `k8s/base/deployment.yaml` | ເພີ່ມ env vars ທັງສອງ + sidecar `cloud-sql-proxy-core` (port 5433) |
| `k8s/overlays/prod/kustomization.yaml` | Patch proxy ທັງ 2 ດ້ວຍ instance names ຈິງ |
| `k8s/overlays/dev/kustomization.yaml` | Patch proxy ທັງ 2 ສຳລັບ dev namespace |

### DB Users ສຳລັບ Production:

| Service | User | Database | Schema |
|---------|------|----------|--------|
| Admin (Prisma) | `panda_admin_user` | `panda_ev_system` | `panda_ev_system` |
| Admin (GatewayDb) | `panda_gateway_user` | `panda_ev_core` | `panda_ev_gateway` |
| Admin (NotiDb) | `panda_noti_user` | `panda_ev_core` | `panda_ev_noti` |

---

## 18. API Endpoints ໃໝ່ (Gateway + Noti)

### Gateway Payments `/api/admin/v1/gateway/`

| Method | Path | Permission | ຄຳອະທິບາຍ |
|--------|------|-----------|-----------|
| GET | `gateway/payments` | `payments:read` | ລາຍການ transactions ທັງໝົດ |
| GET | `gateway/payments/stats` | `payments:read` | ສະຖິຕິ payments |
| GET | `gateway/payments/:id` | `payments:read` | ເບິ່ງ payment ດຽວ |
| GET | `gateway/payments/:id/refunds` | `payments:read` | ລາຍການ refunds ຂອງ payment |
| GET | `gateway/webhook-logs` | `payments:read` | ລາຍການ webhook logs |
| GET | `gateway/webhook-logs/:id` | `payments:read` | ເບິ່ງ webhook log ດຽວ |
| GET | `gateway/bank-configs` | `payments:read` | ລາຍການ bank provider configs |
| GET | `gateway/bank-configs/:id` | `payments:read` | ເບິ່ງ bank config ດຽວ |
| PATCH | `gateway/bank-configs/:id` | `payments:manage` | ແກ້ໄຂ bank config |

### Noti Management `/api/admin/v1/noti/`

| Method | Path | Permission | ຄຳອະທິບາຍ |
|--------|------|-----------|-----------|
| GET | `noti/templates` | `notifications:read` | ລາຍການ notification templates |
| POST | `noti/templates` | `notifications:manage` | ສ້າງ template ໃໝ່ |
| GET | `noti/templates/:id` | `notifications:read` | ເບິ່ງ template ດຽວ |
| PATCH | `noti/templates/:id` | `notifications:manage` | ແກ້ໄຂ template |
| DELETE | `noti/templates/:id` | `notifications:manage` | ລົບ template |
| GET | `noti/logs` | `notifications:read` | ລາຍການ notification logs |
| GET | `noti/logs/stats` | `notifications:read` | ສະຖິຕິ notifications ລາຍວັນ |
| GET | `noti/logs/:id` | `notifications:read` | ເບິ່ງ log ດຽວ |
| GET | `noti/devices` | `notifications:read` | ລາຍການ FCM devices |
| GET | `noti/sms-logs` | `notifications:read` | ລາຍການ SMS logs |
| GET | `noti/sms-logs/stats` | `notifications:read` | ສະຖິຕິ SMS ລາຍວັນ |
| GET | `noti/station-stats` | `notifications:read` | ສະຖິຕິ station ລາຍວັນ |
