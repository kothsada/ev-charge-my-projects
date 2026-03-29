# รายการตรวจสอบความพร้อมสำหรับ Production — สถาปัตยกรรม Notification

> **ขอบเขต**: การ deploy notification service ใหม่ + การเปลี่ยนแปลง service ที่เกี่ยวข้อง (FCM decoupling, DLQ, RS256 x-service-token)
> **วันที่**: 2026-03-28
> **Release Manager**: ใช้รายการตรวจสอบนี้เป็น gate ก่อน promote ขึ้น production

---

## วิธีใช้งาน

- แต่ละรายการมี **คำสั่งตรวจสอบ (Verify Command)** หรือ **สถานะที่คาดหวัง (Expected State)** — ยืนยันแล้วติ๊กถูก
- รายการที่ระบุว่า **[BLOCKER]** ต้องผ่านก่อน deploy ส่วนรายการอื่นถือเป็น best-effort
- รันการตรวจสอบจาก production environment เท่านั้น ไม่ใช่ development

---

## 1. RS256 Key Pairs — การยืนยันตัวตนระหว่าง Service (x-service-token)

ทั้งห้า service ลงนามและตรวจสอบ RabbitMQ messages ระหว่าง service ด้วย RS256 JWT หาก key ขาดหาย, ไม่ตรงกัน, หรือเป็น placeholder สำหรับ dev จะทำให้ข้อความทั้งหมดถูกปล่อยทิ้งโดยไม่มีการแจ้งเตือน (nack-and-discard)

### 1.1 ตรวจสอบว่า Key Files ถูกสร้างและ Cross-Copy แล้ว

**[BLOCKER]** ต้องรัน script `generate-service-keys-local.sh` สำหรับ production environment แล้ว แต่ละ service ต้องมีไฟล์ PEM ที่ถูกต้องอยู่ใน directory `keys/`

| Service | Private key ของตัวเอง | Public key ของ peer ที่เชื่อถือ |
|---|---|---|
| `panda-ev-notification` | `notification.pem` | `mobile.pub`, `admin.pub` |
| `panda-ev-ocpp` | `ocpp.pem` | `mobile.pub`, `admin.pub` |
| `panda-ev-client-mobile` | `mobile.pem` | `admin.pub`, `ocpp.pub` |
| `panda-ev-csms-system-admin` | `admin.pem` | `mobile.pub`, `ocpp.pub` |

```bash
# ตรวจสอบว่าแต่ละ service มีไฟล์ key ที่ต้องการ (รันแยกต่อ service)
ls -la panda-ev-notification/keys/
# ที่คาดหวัง: notification.pem, mobile.pub, admin.pub

ls -la panda-ev-ocpp/keys/
# ที่คาดหวัง: ocpp.pem, mobile.pub, admin.pub

ls -la panda-ev-client-mobile/keys/
# ที่คาดหวัง: mobile.pem, admin.pub, ocpp.pub

ls -la panda-ev-csms-system-admin/keys/
# ที่คาดหวัง: admin.pem, mobile.pub, ocpp.pub
```

- [ ] `panda-ev-notification/keys/` — มีครบ 3 ไฟล์ (notification.pem + peer .pub 2 ไฟล์)
- [ ] `panda-ev-ocpp/keys/` — มีครบ 3 ไฟล์ (ocpp.pem + peer .pub 2 ไฟล์)
- [ ] `panda-ev-client-mobile/keys/` — มีครบ 3 ไฟล์ (mobile.pem + peer .pub 2 ไฟล์)
- [ ] `panda-ev-csms-system-admin/keys/` — มีครบ 3 ไฟล์ (admin.pem + peer .pub 2 ไฟล์)

### 1.2 ตรวจสอบรูปแบบ Key

**[BLOCKER]** Key ต้องเป็น RS256 PEM ที่ถูกต้อง หาก key ขาดหายหรือเสียหายจะทำให้ service crash ตั้งแต่เริ่มต้น

```bash
# ตรวจสอบว่า private key แต่ละตัวอ่านได้ (exit code 0 = ถูกต้อง)
openssl rsa -in panda-ev-notification/keys/notification.pem -check -noout
openssl rsa -in panda-ev-ocpp/keys/ocpp.pem -check -noout
openssl rsa -in panda-ev-client-mobile/keys/mobile.pem -check -noout
openssl rsa -in panda-ev-csms-system-admin/keys/admin.pem -check -noout

# ตรวจสอบ public key แต่ละตัว
openssl rsa -in panda-ev-notification/keys/mobile.pub -pubin -noout
openssl rsa -in panda-ev-notification/keys/admin.pub -pubin -noout
# ... ทำซ้ำสำหรับ .pub ไฟล์อื่นทั้งหมด
```

- [ ] Private key ทุกตัวผ่าน `openssl rsa -check -noout` (exit 0)
- [ ] Peer public key ทุกตัวผ่าน `openssl rsa -pubin -noout` (exit 0)

### 1.3 ตรวจสอบความสัมพันธ์ของ Key Pair

**[BLOCKER]** Public key ที่แต่ละ peer ถือครองต้องเป็นคู่ public ของ private key ของ service ที่ออก token หาก key ไม่ตรงกัน ข้อความขาเข้าจาก service นั้นจะล้มเหลวในการตรวจสอบทั้งหมด

```bash
# ดึง public key จาก private key แล้วเปรียบเทียบ modulus กับ .pub ที่แจกจ่าย
# ตัวอย่าง: ตรวจสอบว่า notification service เชื่อถือ public key จริงของ mobile
openssl rsa -in panda-ev-client-mobile/keys/mobile.pem -pubout 2>/dev/null | openssl rsa -pubin -modulus -noout
openssl rsa -in panda-ev-notification/keys/mobile.pub -pubin -modulus -noout
# ทั้งสอง Modulus ต้องตรงกันทุกตัวอักษร
```

- [ ] mobile.pub ใน notification/ocpp/admin ตรงกับ private key ใน panda-ev-client-mobile
- [ ] admin.pub ใน notification/mobile/ocpp ตรงกับ private key ใน panda-ev-csms-system-admin
- [ ] ocpp.pub ใน mobile/admin ตรงกับ private key ใน panda-ev-ocpp
- [ ] notification.pub (ถ้ามี) ใน service ที่เชื่อถือตรงกับ private key ของ panda-ev-notification

### 1.4 ตรวจสอบ Environment Variable

**[BLOCKER]** แต่ละ service ต้องตั้งค่า `SERVICE_NAME`, `SERVICE_JWT_PRIVATE_KEY_PATH` (หรือ `SERVICE_JWT_PRIVATE_KEY` สำหรับ K8s) และ `TRUSTED_SERVICE_ISSUERS` ให้ถูกต้อง หาก `SERVICE_NAME` ผิด token ที่ลงนามจะไม่ถูก peer รู้จัก

| Service | `SERVICE_NAME` ต้องเท่ากับ |
|---|---|
| `panda-ev-notification` | `notification-service` |
| `panda-ev-ocpp` | `ocpp-csms` |
| `panda-ev-client-mobile` | `mobile-api` |
| `panda-ev-csms-system-admin` | `admin-api` |

```bash
# ตรวจสอบจาก container ที่กำลังรัน (แทนที่ชื่อ container จริง)
docker exec <notification-container> printenv SERVICE_NAME
docker exec <ocpp-container> printenv SERVICE_NAME
docker exec <mobile-container> printenv SERVICE_NAME
docker exec <admin-container> printenv SERVICE_NAME
```

- [ ] `SERVICE_NAME` ตรงกับค่าที่คาดหวังใน service ทั้งสี่
- [ ] `TRUSTED_SERVICE_ISSUERS` มีชื่อ service ทุกตัวที่ service นี้รับข้อความจาก
- [ ] `TRUSTED_SERVICE_PUBLIC_KEYS_DIR` ชี้ไปยัง directory ที่มีอยู่และอ่านได้ (โหมด file-based)
  **หรือ** `TRUSTED_SERVICE_PUBLIC_KEYS` เป็น JSON array ที่ถูกรูปแบบ (โหมด K8s)

### 1.5 ลำดับการโหลด ServiceAuthModule

**[BLOCKER]** ใน `app.module.ts` ของแต่ละ service `ServiceAuthModule` ต้องอยู่ **ก่อน** `RabbitMQModule` หากลำดับสลับกัน `RabbitMQService` จะไม่สามารถ inject `ServiceJwtService` ได้ตั้งแต่เริ่มต้น

```bash
# ยืนยันลำดับ import จาก source หรือ compiled output
grep -n "ServiceAuthModule\|RabbitMQModule" panda-ev-notification/src/app.module.ts
grep -n "ServiceAuthModule\|RabbitMQModule" panda-ev-ocpp/src/app.module.ts
grep -n "ServiceAuthModule\|RabbitMQModule" panda-ev-client-mobile/src/app.module.ts
grep -n "ServiceAuthModule\|RabbitMQModule" panda-ev-csms-system-admin/src/app.module.ts
```

- [ ] หมายเลขบรรทัดของ `ServiceAuthModule` < หมายเลขบรรทัดของ `RabbitMQModule` ใน `app.module.ts` ทั้งสี่ไฟล์

### 1.6 ทดสอบการลงนาม Token จริง (Smoke Test)

ส่ง test message ผ่าน RabbitMQ management UI หรือ CLI แล้วยืนยันว่า notification service รับข้อความได้ (ไม่ถูก nack)

```bash
# ตรวจสอบ log ของ notification service หลังจาก publish test message
docker logs <notification-container> --tail=50 | grep -E "x-service-token|nack|invalid token"
# ที่คาดหวัง: ไม่มีบรรทัด nack; ข้อความถูกประมวลผลสำเร็จ
```

- [ ] Test message ไปยัง `PANDA_EV_NOTIFICATIONS` ถูก consume โดยไม่มี error การปฏิเสธ token ใน log

---

## 2. การตั้งค่า RabbitMQ Queue และ Dead Letter Exchange

### 2.1 การมีอยู่ของ Queue และ Exchange

**[BLOCKER]** Queue และ exchange ทั้งหมดต้องถูก declare เป็น durable Queue ที่ไม่ใช่ durable จะสูญหายเมื่อ RabbitMQ รีสตาร์ท

```bash
# ผ่าน RabbitMQ Management HTTP API (แทนที่ credentials)
curl -u user:password http://rabbitmq-host:15672/api/queues/%2F \
  | jq '.[] | {name: .name, durable: .durable, arguments: .arguments}'
```

ยืนยันว่า queue เหล่านี้มีอยู่และเป็น durable:

| Queue | Durable | `x-dead-letter-exchange` arg ที่คาดหวัง |
|---|---|---|
| `PANDA_EV_NOTIFICATIONS` | yes | `PANDA_EV_NOTIFICATIONS_DLX` |
| `PANDA_EV_NOTIFICATIONS_DLQ` | yes | *(ไม่มี — terminus queue)* |
| `PANDA_EV_QUEUE` | yes | *(ไม่มี — OCPP events ไม่มี DLQ)* |
| `PANDA_EV_CSMS_COMMANDS` | yes | *(ไม่มี)* |
| `PANDA_EV_ADMIN_COMMANDS` | yes | *(ไม่มี)* |
| `PANDA_EV_CHARGER_SYNC` | yes | *(ไม่มี)* |
| `PANDA_EV_USER_EVENTS` | yes | *(ไม่มี)* |
| `PANDA_EV_SYSTEM_EVENTS` | yes | *(ไม่มี)* |
| `PANDA_EV_FCM_CLEANUP` | yes | *(ไม่มี)* |

```bash
# ตรวจสอบการ declare exchange
curl -u user:password http://rabbitmq-host:15672/api/exchanges/%2F/PANDA_EV_NOTIFICATIONS_DLX \
  | jq '{name: .name, type: .type, durable: .durable}'
# ที่คาดหวัง: type=fanout, durable=true
```

- [ ] `PANDA_EV_NOTIFICATIONS` — durable, มี `x-dead-letter-exchange: PANDA_EV_NOTIFICATIONS_DLX`
- [ ] `PANDA_EV_NOTIFICATIONS_DLX` — exchange มีอยู่, type=fanout, durable=true
- [ ] `PANDA_EV_NOTIFICATIONS_DLQ` — durable, ผูก (bound) กับ `PANDA_EV_NOTIFICATIONS_DLX` ด้วย routing key `#` หรือ `""`
- [ ] Queue อื่นๆ ทั้งหมดในตารางด้านบน — durable=true

### 2.2 ตรวจสอบ DLQ Binding

**[BLOCKER]** DLQ ต้องถูก bind กับ DLX หากไม่มี binding ข้อความที่ dead-letter จะถูกทิ้งโดยเงียบๆ

```bash
curl -u user:password http://rabbitmq-host:15672/api/bindings/%2F/e/PANDA_EV_NOTIFICATIONS_DLX/q/PANDA_EV_NOTIFICATIONS_DLQ
# ที่คาดหวัง: คืนค่า binding object (ไม่ใช่ empty array [])
```

- [ ] Binding จาก `PANDA_EV_NOTIFICATIONS_DLX` → `PANDA_EV_NOTIFICATIONS_DLQ` มีอยู่

### 2.3 ตรวจสอบค่า Retry Strategy

Notification processor retry 3 ครั้ง โดยมี delay 5s → 30s → 120s ก่อน dead-letter ตรวจสอบว่า logic การ retry ตรงกับ code ที่ deploy

```bash
# ยืนยัน retry config ใน source
grep -n "maxRetries\|retryDelays\|5000\|30000\|120000" \
  panda-ev-notification/src/modules/notification/notification.router.ts
```

- [ ] `maxRetries = 3` ยืนยันใน source
- [ ] Delays array = `[5000, 30000, 120000]` ยืนยันใน source
- [ ] หลัง retry ครั้งที่ 3 ข้อความถูก nack ไปยัง DLX (ไม่ requeue)

### 2.4 Environment Variables ของ RabbitMQ

**[BLOCKER]** ชื่อ queue ใน env vars ต้องตรงกับชื่อ queue ที่ declare ไว้ทุกตัวอักษร (case-sensitive)

```bash
# ตรวจสอบ env vars ของ notification service
docker exec <notification-container> printenv | grep RABBITMQ
# ที่คาดหวัง:
# RABBITMQ_URL=amqp://...@<production-host>:5672
# RABBITMQ_NOTIFICATIONS_QUEUE=PANDA_EV_NOTIFICATIONS
# RABBITMQ_NOTIFICATIONS_DLQ=PANDA_EV_NOTIFICATIONS_DLQ
# RABBITMQ_NOTIFICATIONS_DLX=PANDA_EV_NOTIFICATIONS_DLX
# RABBITMQ_OCPP_EVENTS_QUEUE=PANDA_EV_QUEUE
```

- [ ] `RABBITMQ_URL` ชี้ไปยัง production host (ไม่ใช่ `localhost` หรือ `127.0.0.1`)
- [ ] ชื่อ queue ใน env vars ตรงกับชื่อ queue ที่ declare จริงทุกตัวอักษร
- [ ] RabbitMQ user/password ใน `RABBITMQ_URL` เป็น credentials สำหรับ production (ไม่ใช่ `user:password`)

### 2.5 RabbitMQ Prefetch / Consumer Concurrency

ตรวจสอบว่า notification service consumer ไม่รับข้อความพร้อมกันมากเกินไป เพื่อหลีกเลี่ยงการ overload FCM batch limit (500 tokens ต่อ `sendMulticast` call)

```bash
grep -n "prefetch\|concurrency\|noAck" \
  panda-ev-notification/src/modules/notification/notification.router.ts \
  panda-ev-notification/src/configs/rabbitmq/rabbitmq.service.ts
```

- [ ] `prefetch` ตั้งค่าไว้ที่ ≤ 10 ต่อ consumer หรือ `noAck: false` (ยืนยัน manual ack mode)

### 2.6 การแจ้งเตือน DLQ Monitoring

ข้อความที่ dead-letter บ่งชี้ถึงความล้มเหลวในการประมวลผล ทีม Ops ต้องมีการมองเห็น (visibility)

- [ ] ความลึกของ queue `PANDA_EV_NOTIFICATIONS_DLQ` ใน RabbitMQ ถูก monitor (กำหนด alert threshold แล้ว)
- [ ] Alert ทำงานหาก DLQ depth > 0 นานกว่า 5 นาที (หรือตาม SLA ที่ทีมตกลงกัน)
- [ ] มี Runbook สำหรับ re-queue หรือตรวจสอบข้อความใน DLQ ด้วยตนเอง

---

## 3. ความปลอดภัยของ Credentials และ Secrets

### 3.1 JWT_REFRESH_SECRET — ต้องไม่ใช่ค่าสำหรับ Development

**[BLOCKER]** Placeholder สำหรับ development ต้องไม่ถูกนำขึ้น production หาก refresh secret เดาได้ง่ายจะทำให้ผู้ไม่หวังดีปลอมแปลง token ได้

ค่า placeholder สำหรับ development ที่รู้จัก (จาก `.env` และ `docker-compose.yml` ในโปรเจกต์):
- `panda-ev-refresh-secret-change-in-production`
- `panda-ev-refresh-secret`
- `change-me-refresh-32-chars-minimum`

```bash
# ตรวจสอบ container ที่กำลังรัน
docker exec <mobile-container> printenv JWT_REFRESH_SECRET
docker exec <admin-container> printenv JWT_REFRESH_SECRET

# ต้องไม่ตรงกับ placeholder ใดๆ ข้างต้น
# ต้องมีอย่างน้อย 32 ตัวอักษรของข้อมูลแบบสุ่ม
# สร้างได้ด้วย: openssl rand -base64 48
```

- [ ] `JWT_REFRESH_SECRET` (Mobile) — ไม่ใช่ placeholder ที่รู้จัก, ≥ 32 ตัวอักษร
- [ ] `JWT_REFRESH_SECRET` (Admin) — ไม่ใช่ placeholder ที่รู้จัก, ≥ 32 ตัวอักษร
- [ ] `JWT_SECRET` (Mobile, Admin, OCPP, Notification) — ไม่ใช่ placeholder ที่รู้จัก, ≥ 32 ตัวอักษร
- [ ] `ADMIN_STATS_WS_SECRET` (Notification, ถ้าตั้งค่าไว้) — ไม่ใช่ placeholder

### 3.2 JWT Algorithm — ต้องเป็น RS256 ไม่ใช่ HS256 Fallback

**[BLOCKER]** `JwtStrategy` จะ fallback ไปใช้ HS256 (`JWT_SECRET`) หากไม่ได้ตั้งค่า RS256 keys ไว้ Production ต้องใช้ RS256

```bash
# ยืนยันว่า RS256 keys ถูกตั้งค่าไว้ (อย่างน้อยหนึ่งในสองตัวเลือก)
# ตัวเลือก A (file path):
docker exec <mobile-container> printenv JWT_PRIVATE_KEY_PATH
docker exec <mobile-container> printenv JWT_PUBLIC_KEY_PATH
# ตัวเลือก B (K8s base64):
docker exec <mobile-container> printenv JWT_PRIVATE_KEY | wc -c   # ต้องมากกว่า 0
docker exec <mobile-container> printenv JWT_PUBLIC_KEY | wc -c    # ต้องมากกว่า 0
```

- [ ] Mobile API มี `JWT_PRIVATE_KEY_PATH` + `JWT_PUBLIC_KEY_PATH` **หรือ** `JWT_PRIVATE_KEY` + `JWT_PUBLIC_KEY` ถูกตั้งค่าไว้
- [ ] Admin API มี RS256 key vars ถูกตั้งค่าไว้
- [ ] `JWT_SECRET` / `JWT_REFRESH_SECRET` ยังคงตั้งค่าไว้เป็น fallback สำหรับความเข้ากันได้ระหว่างการหมุน key
- [ ] HS256 fallback (path ที่ใช้แค่ `JWT_SECRET`) ไม่ใช่ auth path ที่ active อยู่ (audit P1.5 จาก system audit ได้รับการแก้ไขแล้ว)

### 3.3 Firebase Service Account — ต้องไม่ใช่บัญชีสำหรับ Test/Emulator

**[BLOCKER]** การใช้ Firebase test project หรือบัญชี emulator หมายความว่าจะไม่มีการส่ง push notification จริง

```bash
# ตัวเลือก A (file path): ตรวจสอบ service account
cat panda-ev-notification/keys/firebase-service-account.json | jq '{project_id, client_email}'
# project_id ต้องเป็น Firebase project สำหรับ production (ไม่ใช่ "demo-*" หรือ "test-*")
# client_email ต้องเป็น IAM service account email จริง

# ตัวเลือก B (env vars):
docker exec <notification-container> printenv FIREBASE_PROJECT_ID
docker exec <notification-container> printenv FIREBASE_CLIENT_EMAIL
```

- [ ] `FIREBASE_PROJECT_ID` — production project ID (ไม่ใช่ `demo-*`, `test-*`, และไม่ว่างเปล่า)
- [ ] `FIREBASE_CLIENT_EMAIL` — production service account email (ลงท้ายด้วย `@<project>.iam.gserviceaccount.com`)
- [ ] `FIREBASE_PRIVATE_KEY` หรือ service account JSON — ตรงกับ production IAM service account
- [ ] Firebase service account ได้รับสิทธิ์ `Firebase Cloud Messaging API` (`cloudmessaging.messages.create`) แล้ว

```bash
# Smoke test: ทดลอง dry-run notification (ใช้ FCM token จาก dev device ที่รู้ว่าถูกต้อง)
# ตรวจสอบ log ของ notification service ว่า Firebase init สำเร็จ ไม่ใช่ emulator mode
docker logs <notification-container> | grep -i "firebase\|FCM\|initialized"
# ที่คาดหวัง: "Firebase initialized" พร้อม project ID ปรากฏ, ไม่มี warning เกี่ยวกับ "emulator"
```

- [ ] Firebase Admin SDK initialize สำเร็จเมื่อเริ่มต้น service (ไม่มี warning "emulator" หรือ "test credential" ใน log)

### 3.4 Firebase Private Key — การ Escape ขึ้นบรรทัดใหม่

Firebase private keys มีอักขระ `\n` จริงๆ ที่ต้อง escape เป็น `\\n` เมื่อเก็บใน environment variables (ไม่ใช่ใน JSON files) key ที่รูปแบบผิดจะทำให้ Firebase ล้มเหลวโดยไม่มีสัญญาณหรือแสดง error ที่เข้าใจยาก

```bash
# ถ้าใช้รูปแบบ env var ตรวจสอบว่า key มีการ escape ขึ้นบรรทัดใหม่
docker exec <notification-container> printenv FIREBASE_PRIVATE_KEY | head -1
# ต้องขึ้นต้นด้วย: -----BEGIN RSA PRIVATE KEY-----
# การขึ้นบรรทัดใหม่ใน key body ต้องปรากฏเป็น \n ตามตัวอักษร ไม่ใช่การขึ้นบรรทัดจริง
```

- [ ] `FIREBASE_PRIVATE_KEY` (ถ้าตั้งเป็น env var) — มีการ escape `\n` ไม่ใช่การขึ้นบรรทัดจริง
  **หรือ** ใช้ `FIREBASE_SERVICE_ACCOUNT_PATH` แทน (ไม่ต้อง escape ใน JSON file)

### 3.5 Database URLs — ต้องไม่ใช่ Development Host

```bash
docker exec <notification-container> printenv DATABASE_URL
# ต้องไม่มี: localhost, 127.0.0.1, postgrespassword, postgresuser (credentials dev เริ่มต้น)
```

- [ ] `DATABASE_URL` (Notification) — production host และ credentials
- [ ] `DATABASE_URL` (OCPP, Mobile, Admin) — production hosts และ credentials
- [ ] `SYSTEM_DATABASE_URL` (Mobile) — production host และ credentials

### 3.6 Redis URL — ต้องไม่ใช่ Instance สำหรับ Dev เริ่มต้น

```bash
docker exec <notification-container> printenv REDIS_URL
# ต้องไม่ใช่ redis://localhost:6379 (ยกเว้นว่าตั้งใจให้ Redis อยู่ร่วมกันใน prod)
```

- [ ] `REDIS_URL` — production Redis endpoint พร้อม auth (ถ้ามี: `redis://:password@host:6379`)

---

## 4. การตรวจสอบการ Startup และ Integration

### 4.1 Service ทั้งหมด Start ได้โดยไม่มี Error

```bash
# ตรวจสอบ exit code และ log ล่าสุดของแต่ละ container
docker logs <notification-container> --tail=30
docker logs <ocpp-container> --tail=30
docker logs <mobile-container> --tail=30
docker logs <admin-container> --tail=30
```

- [ ] Notification service — ไม่มี `Error`, ไม่มี `Cannot read properties of undefined (ServiceJwtService)`, ไม่มี `Firebase` init error
- [ ] OCPP service — ไม่มี `RabbitMQ connection failed permanently`, ไม่มี service auth error
- [ ] Mobile API — ไม่มี startup error
- [ ] Admin API — ไม่มี startup error
- [ ] ไม่มี service ใดอยู่ในสถานะ crash-loop (สถานะ `Restarting` ใน `docker ps`)

### 4.2 การเชื่อมต่อ Redis

**[BLOCKER]** Service ทั้งหมด hard-exit หาก Redis ไม่พร้อมใช้งานเมื่อเริ่มต้น

```bash
docker logs <notification-container> | grep -i "redis\|connected\|failed"
# ที่คาดหวัง: "Redis connected" หรือ success message ที่เทียบเท่า
```

- [ ] Service ทั้งสี่แสดง log การเชื่อมต่อ Redis สำเร็จเมื่อเริ่มต้น

### 4.3 การทดสอบ Notification Flow แบบ End-to-End

ทริกเกอร์การเริ่ม charging session จาก mobile app (dev device) แล้วยืนยัน chain ทั้งหมด:

1. Mobile API publish ไปยัง `PANDA_EV_NOTIFICATIONS` (routingKey: `notification.session`)
2. Notification service consume, ผ่านการตรวจสอบ dedup + rate-limit
3. FCM multicast call สำเร็จ
4. สร้าง record `NotificationLog` ใน notification DB
5. `notification_daily_stats` UPSERT ถูกดำเนินการ
6. Admin WebSocket dashboard emit event `notification:sent`

```bash
# ติดตาม log ของ notification service ระหว่างทดสอบ
docker logs -f <notification-container> | grep -E "FCM|sent|failed|dedup|rate"
```

- [ ] E2E flow สำเร็จโดยไม่มี error
- [ ] FCM delivery ได้รับการยืนยัน (ตรวจสอบ Firebase Console → Cloud Messaging → Recent Messages)
- [ ] มี row `notification_daily_stats` สำหรับวันนี้ในฐานข้อมูล

### 4.4 Admin WebSocket Dashboard (`/admin-stats`)

```bash
# เชื่อมต่อด้วย admin JWT ที่ถูกต้องและยืนยันว่า stats events มาถึง
# (ใช้ browser devtools WS inspector หรือ wscat)
wscat -c "wss://<production-host>/admin-stats" \
  -H "Authorization: Bearer <valid-admin-jwt>"
# ที่คาดหวัง: เชื่อมต่อสำเร็จ, ไม่มีการตัดการเชื่อมต่อด้วย auth_error
```

- [ ] WebSocket เชื่อมต่อสำเร็จด้วย JWT ที่ถูกต้อง
- [ ] `auth_error` คืนค่าสำหรับ token ที่หมดอายุ/ไม่ถูกต้อง (การตรวจสอบความปลอดภัย)

### 4.5 DLQ Baseline — ต้องว่างเปล่าเมื่อ Launch

ก่อน launch DLQ ควรว่างเปล่า ข้อความที่มีอยู่ก่อนแสดงถึง testing artifacts หรือความล้มเหลวก่อนหน้า

```bash
curl -u user:password http://rabbitmq-host:15672/api/queues/%2F/PANDA_EV_NOTIFICATIONS_DLQ \
  | jq '.messages'
# ที่คาดหวัง: 0
```

- [ ] จำนวน message ใน `PANDA_EV_NOTIFICATIONS_DLQ` = 0 เมื่อ deploy

---

## 5. ความพร้อมด้านการปฏิบัติงาน (Operational Readiness)

### 5.1 การรวบรวม Log

- [ ] Container ของ service ทั้งหมดส่ง log ไปยัง central log store (ELK / Loki / CloudWatch)
- [ ] Log level เป็น `warn` หรือ `error` ใน production (`NODE_ENV=production`)
- [ ] `SWAGGER_ENABLED` เป็น `false` (หรือถูกลบออก) ใน production สำหรับ service ทั้งหมด

### 5.2 การ Apply Prisma Migrations

```bash
# Notification service DB
cd panda-ev-notification && npx prisma migrate deploy
# ต้องสำเร็จด้วย "All migrations have been applied" (ไม่ใช่ "X pending migrations")
```

- [ ] Notification service DB migrations ถูก apply ครบถ้วนแล้ว
- [ ] ไม่มี pending migrations ในฐานข้อมูลของ service ใดๆ

### 5.3 แผนการ Rollback

- [ ] Docker image tag ก่อนหน้าถูกเก็บไว้ (ไม่ใช้ `:latest` เป็น tag เดียว)
- [ ] การ redeclare RabbitMQ queue เมื่อ rollback ไม่ทำให้เกิดปัญหา (args เดิม = idempotent)
- [ ] RS256 keys ถูก backup ไว้นอก cluster (การหมุน key ต้องการ re-deploy service ทั้งหมดพร้อมกัน)

---

## การอนุมัติ (Sign-Off)

| หัวข้อ | ผู้รับผิดชอบ | สถานะ | วันที่ |
|---|---|---|---|
| RS256 Key Pairs | | | |
| RabbitMQ / DLQ | | | |
| Secrets & Credentials | | | |
| E2E Smoke Tests | | | |
| Monitoring / Alerts | | | |

**อนุมัติ deploy โดย**: ___________________  **วันที่**: ___________________
