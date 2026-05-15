# ຄູ່ມືການ Migration — ລະບົບວິທີຊຳລະເງິນທະນາຄານ (Bank Payment Methods)

**ວັນທີ**: 2026-04-19  
**ກ່ຽວຂ້ອງກັບ**: Gateway Service, Mobile Service  
**ຜູ້ດຳເນີນການ**: superadmin / DevOps

---

## ພາບລວມ (Overview)

Migration ນີ້ສ້າງຕາຕະລາງໃໝ່ 2 ຕາຕະລາງ:

| Service | Schema | ຕາຕະລາງ | ຈຸດປະສົງ |
|---------|--------|----------|----------|
| Gateway | `panda_ev_gateway` | `payment_methods` | ເກັບຮັກສາວິທີຊຳລະເງິນທີ່ admin ສ້າງ (ຕົ້ນສະບັບ) |
| Mobile  | `panda_ev_mobile`  | `available_payment_methods` | ສຳເນົາຂໍ້ມູນຈາກ Gateway (sync ຜ່ານ RabbitMQ) |

---

## ໝາຍເຫດສຳຄັນ (ອ່ານກ່ອນລັນ)

> **`prisma migrate dev` ໃຊ້ບໍ່ໄດ້ໃນ Environment ຈິງ** — ຄຳສັ່ງນີ້ຕ້ອງການ Interactive TTY ແລະ Shadow Database. ໃຫ້ໃຊ້ວິທີ Manual ທີ່ລະບຸໄວ້ດ້ານລຸ່ມສະເໝີ.

> **Password ທີ່ມີ `>` ໃນ Connection String**:
> - `psql "..."` — ໃຊ້ `>` ໂດຍກົງໄດ້ (ຢູ່ໃນ double quotes)
> - `DATABASE_URL=...` (Prisma) — ຕ້ອງ encode `>` ເປັນ `%3E` ເພາະ Prisma parse URL ຢ່າງເຂັ້ມງວດ

---

## ຂັ້ນຕອນທີ 1 — Gateway Service

### 1.1 ເຂົ້າໄປໃນ Directory

```bash
cd panda-ev-gateway-services
```

### 1.2 ລັນ SQL Migration ໂດຍກົງ

```bash
psql "postgresql://panda_gateway_user:Panda>2026>WriteGateway1234567890>@127.0.0.1:5435/panda_ev_core" \
  < ./prisma/migrations/20260419120000_add_payment_methods/migration.sql
```

**ຜົນລັບຕົວຈິງ (actual output):**

```
CREATE TABLE
CREATE INDEX
CREATE INDEX
CREATE INDEX
```

> ✅ ສ້າງຕາຕະລາງ `payment_methods` ສຳເລັດ ພ້ອມ Index 3 ຕົວ

### 1.3 ໝາຍ Migration ວ່າຖືກ Apply ແລ້ວ ແລະ Regenerate Client

```bash
npx prisma migrate resolve --applied 20260419120000_add_payment_methods \
  && npx prisma generate
```

**ຜົນລັບຕົວຈິງ (actual output):**

```
Loaded Prisma config from prisma.config.ts.

Prisma schema loaded from prisma/schema.prisma.
Datasource "db": PostgreSQL database "panda_ev_core", schemas "panda_ev_gateway" at "127.0.0.1:5435"

Migration 20260419120000_add_payment_methods marked as applied.

Loaded Prisma config from prisma.config.ts.

Prisma schema loaded from prisma/schema.prisma.

✔ Generated Prisma Client (7.7.0) to ./generated/prisma/client in 31ms
```

> ✅ Gateway Migration ສຳເລັດ

---

## ຂັ້ນຕອນທີ 2 — Mobile Service

### 2.1 ເຂົ້າໄປໃນ Directory

```bash
cd ../panda-ev-client-mobile
```

### 2.2 ລັນ SQL Migration ໂດຍກົງ

> ⚠️ `psql` ໃຊ້ Connection String ໂດຍກົງໄດ້ (`>` ບໍ່ຕ້ອງ encode)

```bash
psql "postgresql://panda_mobile_user:Panda>2026>WriteMobile1234567890>@127.0.0.1:5434/panda_ev_mobile" \
  < ./prisma/migrations/20260419120001_add_available_payment_methods/migration.sql
```

**ຜົນລັບຕົວຈິງ (actual output):**

```
CREATE TABLE
CREATE INDEX
CREATE INDEX
```

> ✅ ສ້າງຕາຕະລາງ `available_payment_methods` ສຳເລັດ

### 2.3 ໝາຍ Migration ວ່າຖືກ Apply ແລ້ວ

> ⚠️ `DATABASE_URL` ສຳລັບ Prisma ຕ້ອງ encode `>` ເປັນ `%3E`

```bash
DATABASE_URL="postgresql://panda_mobile_user:Panda%3E2026%3EWriteMobile1234567890%3E@127.0.0.1:5434/panda_ev_mobile?schema=panda_ev_mobile" \
  npx prisma migrate resolve --applied 20260419120001_add_available_payment_methods
```

**ຜົນລັບຕົວຈິງ (actual output):**

```
Loaded Prisma config from prisma.config.ts.

Prisma schema loaded from prisma/schema.prisma.
Datasource "db": PostgreSQL database "panda_ev_mobile", schemas "panda_ev_mobile" at "127.0.0.1:5434"

Migration 20260419120001_add_available_payment_methods marked as applied.
```

### 2.4 Regenerate Prisma Client

```bash
DATABASE_URL="postgresql://panda_mobile_user:Panda%3E2026%3EWriteMobile1234567890%3E@127.0.0.1:5434/panda_ev_mobile?schema=panda_ev_mobile" \
  npx prisma generate
```

**ຜົນລັບຕົວຈິງ (actual output):**

```
Loaded Prisma config from prisma.config.ts.

Prisma schema loaded from prisma/schema.prisma.

✔ Generated Prisma Client (7.4.1) to ./generated/prisma in 69ms
```

> ✅ Mobile Migration ສຳເລັດ

### 2.5 ກວດສອບ Migration ຖືກບັນທຶກ

```bash
psql "postgresql://panda_mobile_user:Panda>2026>WriteMobile1234567890>@127.0.0.1:5434/panda_ev_mobile" \
  -c "SELECT migration_name, finished_at FROM panda_ev_mobile._prisma_migrations ORDER BY finished_at DESC LIMIT 5;"
```

**ຜົນລັບຕົວຈິງ (actual output):**

```
                migration_name                |          finished_at
----------------------------------------------+-------------------------------
 20260419120001_add_available_payment_methods | 2026-04-19 14:59:17.633255+07
(1 row)
```

> ✅ Prisma ຮັບຮູ້ Migration ແລ້ວ

---

## ຂັ້ນຕອນທີ 3 — Deploy Services

ຫຼັງຈາກ Migration ສຳເລັດ ໃຫ້ Deploy ທັງ 3 Service:

```bash
# Build ແລະ Deploy Gateway
cd panda-ev-gateway-services
npm run build

# Build ແລະ Deploy Admin (CSMS)
cd ../panda-ev-csms-system-admin
npm run build

# Build ແລະ Deploy Mobile
cd ../panda-ev-client-mobile
npm run build
```

---

## ໂຄງສ້າງຂໍ້ມູນ (Table Structure)

### `panda_ev_gateway.payment_methods`

| Column | Type | ຄຳອະທິບາຍ |
|--------|------|-----------|
| `id` | UUID | Primary key |
| `name` | VARCHAR(255) | ຊື່ສະແດງໃຫ້ User ເຫັນ ເຊັ່ນ "BCEL OnePay" |
| `code` | VARCHAR(50) | ລະຫັດສັ້ນ ເຊັ່ນ "BCEL", "JDB" (unique) |
| `provider` | ENUM | ໂດຍ Gateway: BCEL, LAOQR, LDB, JDB |
| `description` | VARCHAR(500) | ຄຳອະທິບາຍສັ້ນ |
| `logo_url` | VARCHAR(500) | URL ຮູບ Logo |
| `is_active` | BOOLEAN | ສະແດງ/ຊ່ອນໃນ App |
| `sort_order` | INTEGER | ລຳດັບການສະແດງ (0 = ກ່ອນ) |
| `min_amount` | INTEGER | ຈຳນວນຂັ້ນຕ່ຳ (ກີບ) |
| `max_amount` | INTEGER | ຈຳນວນສູງສຸດ (null = ບໍ່ຈຳກັດ) |
| `currency` | VARCHAR(10) | ສະກຸນເງິນ (LAK) |
| `deleted_at` | TIMESTAMPTZ | Soft delete (ບໍ່ລຶບຂໍ້ມູນຕົວຈິງ) |
| `created_at` | TIMESTAMPTZ | ວັນທີສ້າງ |
| `updated_at` | TIMESTAMPTZ | ວັນທີແກ້ໄຂ |

### `panda_ev_mobile.available_payment_methods`

ໂຄງສ້າງດຽວກັນກັບ Gateway (ຍົກເວັ້ນ `deleted_at`) ບວກ `synced_at` ສຳລັບຕິດຕາມເວລາ sync ຫຼ້າສຸດ.

---

## ການທົດສອບ (Verification)

### ກວດສອບຕາຕະລາງ Gateway

```bash
psql "postgresql://panda_gateway_user:Panda>2026>WriteGateway1234567890>@127.0.0.1:5435/panda_ev_core" \
  -c "SELECT id, name, code, provider, is_active FROM panda_ev_gateway.payment_methods ORDER BY sort_order;"
```

### ກວດສອບຕາຕະລາງ Mobile

```bash
psql "postgresql://panda_mobile_user:Panda>2026>WriteMobile1234567890>@127.0.0.1:5434/panda_ev_mobile" \
  -c "SELECT id, name, code, is_active, synced_at FROM panda_ev_mobile.available_payment_methods ORDER BY sort_order;"
```

### ທົດສອບ API (Admin — ສ້າງ Payment Method)

```bash
# Login ດ້ວຍ superadmin ກ່ອນ ແລ້ວໃຊ້ Token
curl -X POST http://localhost:4000/api/admin/v1/gateway/payment-methods \
  -H "Authorization: Bearer <superadmin-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "BCEL OnePay",
    "code": "BCEL",
    "provider": "BCEL",
    "description": "ຊຳລະຜ່ານ BCEL OnePay QR Code",
    "isActive": true,
    "sortOrder": 0,
    "minAmount": 1000,
    "currency": "LAK"
  }'
```

### ທົດສອບ API (Mobile — ດຶງລາຍການ)

```bash
curl http://localhost:4001/api/mobile/v1/payment/methods/available \
  -H "Authorization: Bearer <user-token>"
```

---

## ການແກ້ໄຂບັນຫາ (Troubleshooting)

### ບັນຫາ: `relation "panda_ev_gateway"."payment_methods" does not exist`

**ສາເຫດ**: SQL Migration ຍັງບໍ່ໄດ້ລັນ  
**ວິທີແກ້**: ລັນຂັ້ນຕອນ 1.2 ຄືນໃໝ່

### ບັນຫາ: `Property 'availablePaymentMethod' does not exist on type 'PrismaService'`

**ສາເຫດ**: Prisma Client ຍັງບໍ່ໄດ້ Regenerate ຫຼັງຈາກ Schema ປ່ຽນ  
**ວິທີແກ້**: ລັນຂັ້ນຕອນ 2.4 ຄືນໃໝ່

### ບັນຫາ: `Migration already exists in the database` ເວລາລັນ `migrate resolve`

**ສາເຫດ**: ລັນ `migrate resolve` ຊ້ຳ  
**ວິທີແກ້**: ກວດດ້ວຍ `SELECT migration_name FROM panda_ev_mobile._prisma_migrations` — ຖ້າມີຢູ່ແລ້ວ ບໍ່ຕ້ອງລັນຊ້ຳ

### ບັນຫາ: Mobile ບໍ່ໄດ້ຮັບຂໍ້ມູນ Sync ຫຼັງ Admin ສ້າງ Payment Method

**ສາເຫດ**: RabbitMQ `PANDA_EV_PAYMENT_EVENTS` ອາດຈະ offline ຫຼື Mobile service ຍັງບໍ່ໄດ້ restart  
**ວິທີແກ້**: ກວດສອບ RabbitMQ connection ໃນ Admin ແລະ Mobile service logs; restart Mobile service ຖ້າຈຳເປັນ

### ບັນຫາ: `Only super-admins can manage bank payment methods` (403)

**ສາເຫດ**: User ທີ່ Login ບໍ່ໃຊ່ Superadmin (ຂາດ Permission `roles:manage`)  
**ວິທີແກ້**: Login ດ້ວຍ Account ທີ່ມີ Role `super-admin`  
Default: `admin@pandaev.com` / `Admin@123456`

### ບັນຫາ: `password authentication failed` ໃນ Prisma (DATABASE_URL)

**ສາເຫດ**: ລືມ encode `>` ເປັນ `%3E` ໃນ DATABASE_URL  
**ວິທີແກ້**: ກວດ URL ໃຫ້ `Panda%3E2026%3EWriteMobile1234567890%3E` (ບໍ່ແມ່ນ `Panda>2026>...`)
