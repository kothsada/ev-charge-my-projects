# Mobile_Service_Documentation_and_Audit.md

> **เวอร์ชัน:** 1.0.0
> **วันที่จัดทำ:** 24 มีนาคม 2026
> **ขอบเขต:** `panda-ev-client-mobile` — NestJS REST API (Mobile BFF, Port 4001)
> **ภาษา:** ไทย (Thai) — สำหรับทีมพัฒนาและ QA

---

## สารบัญ

1. [ภาพรวม Mobile App & Tech Stack](#1-ภาพรวม)
2. [API Integration Reference](#2-api-integration-reference)
3. [Feature Implementation Details](#3-feature-implementation-details)
4. [Security & Performance Recommendations](#4-security--performance)
5. [Testing Manual](#5-testing-manual)
6. [Known Issues & Roadmap](#6-known-issues--roadmap)

---

## 1. ภาพรวม

### 1.1 สถาปัตยกรรมระบบ

`panda-ev-client-mobile` คือ **Mobile Backend-for-Frontend (BFF)** ที่เป็นตัวกลางระหว่าง Mobile App (iOS/Android) กับบริการหลังบ้านทั้งหมด ได้แก่ PostgreSQL, Redis, RabbitMQ, Firebase (FCM), และ OCPP CSMS

```
┌─────────────────────────────────────────────────────────┐
│                   Mobile App (Client)                   │
│              iOS / Android / Flutter / RN               │
└───────────────────────┬─────────────────────────────────┘
                        │  HTTPS REST (Bearer JWT)
                        ▼
┌─────────────────────────────────────────────────────────┐
│         panda-ev-client-mobile  (Port 4001)             │
│  NestJS 10 · TypeScript · Prisma 7 · Passport-JWT       │
│  Global prefix: /api/mobile/v1/...                      │
├──────────┬──────────┬────────────┬───────────┬──────────┤
│PostgreSQL│  Redis   │  RabbitMQ  │  Firebase │SystemDB  │
│(core_db) │(required)│ (soft-fail)│(soft-fail)│(soft-fail│
└──────────┴──────────┴────────────┴───────────┴──────────┘
                        │ RabbitMQ
                        ▼
┌─────────────────────────────────────────────────────────┐
│         panda-ev-ocpp  (Port 3000/4002)                 │
│         OCPP 1.6J CSMS · WebSocket                      │
└─────────────────────────────────────────────────────────┘
```

### 1.2 Tech Stack

| ส่วนประกอบ | เทคโนโลยี | หมายเหตุ |
|---|---|---|
| Framework | NestJS 10 + TypeScript | Modular architecture |
| ORM | Prisma 7 | Generated client ที่ `generated/prisma/` |
| Database หลัก | PostgreSQL — schema `panda_ev_core` | สำหรับ Mobile user data |
| Database รอง | PostgreSQL — schema `panda_ev_system` | อ่านข้อมูล Station/Pricing จาก Admin |
| Cache / Session | Redis (ioredis) | **บังคับ** — app หยุดถ้า connect ไม่ได้ |
| Message Queue | RabbitMQ (amqplib) | Soft-fail — ปิด OCPP integration ถ้าไม่มี |
| Push Notification | Firebase Admin SDK (FCM) | Soft-fail ถ้าไม่ได้ตั้งค่า |
| Auth | JWT (RS256 หรือ HS256 fallback) | Access 15 นาที / Refresh 30 วัน |
| Service-to-Service Auth | RS256 JWT ใน AMQP header `x-service-token` | ป้องกัน replay ด้วย Redis jti blacklist |
| i18n | AsyncLocalStorage-based | รองรับ en / lo / zh |
| API Docs | Swagger (Dev only) | `/api/mobile/docs` |

### 1.3 Architecture Pattern

```
Request Lifecycle:
HTTP → JwtAuthGuard → ValidationPipe → TimezoneInterceptor
     → Controller → Service → Prisma / Redis / RabbitMQ
     → ResponseInterceptor (wrap response)
     → GlobalExceptionFilter (handle errors)
```

- **Module Pattern**: Feature modules แต่ละอันมี controller + service + DTO
- **Global Modules**: `PrismaModule`, `RedisModule`, `ServiceAuthModule`, `RabbitMQModule`, `I18nModule`, `AppConfigModule` — inject ได้เลยโดยไม่ต้อง import
- **Soft Delete**: ไม่ลบข้อมูลจริง — ตั้ง `deletedAt: new Date()` แทน
- **Timezone**: ทุก response date แปลงเป็น Asia/Vientiane (UTC+7) ผ่าน `TimezoneInterceptor`

---

## 2. API Integration Reference

> **Base URL:** `https://<host>/api/mobile/v1`
> **Auth:** `Authorization: Bearer <access_token>` (เว้นแต่จะระบุว่า Public)
> **Response Shape ทุก endpoint:**

```json
{
  "success": true,
  "statusCode": 200,
  "data": {},
  "message": "string",
  "meta": { "total": 100, "page": 1, "limit": 20, "totalPages": 5 },
  "timestamp": "2026-03-24T10:00:00+07:00"
}
```

---

### 2.1 Authentication (`/auth`)

#### `POST /auth/register` — Public
**วัตถุประสงค์:** ลงทะเบียนผู้ใช้ใหม่ + ส่ง OTP ทันที

```json
// Request
{
  "phoneNumber": "+8562012345678",
  "email": "user@example.com",
  "password": "P@ssw0rd123",
  "firstName": "ສົມຊາຍ",
  "lastName": "ວົງໄຊ",
  "agreedToTerms": true
}

// Response 201
{
  "data": {
    "userId": "uuid",
    "message": "OTP ส่งแล้ว กรุณาตรวจสอบ SMS/Email ของคุณ"
  }
}
```

**Error Cases:**

| HTTP | เหตุผล |
|---|---|
| 400 | `agreedToTerms` ไม่ใช่ true, รูปแบบเบอร์โทรไม่ถูกต้อง |
| 409 | อีเมลหรือเบอร์โทรนี้มีบัญชีอยู่แล้ว (และ ACTIVE) |

---

#### `POST /auth/verify-otp` — Public
**วัตถุประสงค์:** ยืนยัน OTP เพื่อเปิดใช้งานบัญชี + รับ token

```json
// Request
{
  "userId": "uuid",
  "otp": "123456"
}

// Response 200
{
  "data": {
    "accessToken": "eyJ...",
    "refreshToken": "eyJ...",
    "user": {
      "id": "uuid",
      "firstName": "ສົມຊາຍ",
      "lastName": "ວົງໄຊ",
      "phoneNumber": "+8562012345678",
      "email": "user@example.com",
      "status": "ACTIVE",
      "acceptedTermsAt": "2026-03-24T10:00:00+07:00"
    }
  }
}
```

---

#### `POST /auth/login` — Public
**วัตถุประสงค์:** Login ด้วยเบอร์โทร/อีเมล + password

```json
// Request
{
  "identifier": "+8562012345678",
  "password": "P@ssw0rd123"
}

// Response 200
{
  "data": {
    "accessToken": "eyJ...",
    "refreshToken": "eyJ...",
    "user": { "...user profile..." },
    "defaultVehicle": {
      "id": "uuid",
      "brand": "Tesla",
      "model": "Model 3",
      "plugType": "CCS2",
      "plateNumber": "GP-0001"
    }
  }
}
```

**Error Cases:**

| HTTP | เหตุผล |
|---|---|
| 401 | รหัสผ่านผิด |
| 403 | บัญชีถูก SUSPENDED / INACTIVE / PENDING_VERIFICATION |
| 404 | ไม่พบบัญชีนี้ |

---

#### `POST /auth/refresh` — Public
**วัตถุประสงค์:** ต่ออายุ access token ด้วย refresh token

```json
// Request
{ "refreshToken": "eyJ..." }

// Response 200
{
  "data": {
    "accessToken": "eyJ...",
    "refreshToken": "eyJ..."
  }
}
```

**Real-time consideration:** Mobile app ควร implement token refresh แบบ automatic เมื่อ API ตอบกลับ 401 โดยใช้ interceptor/middleware ใน HTTP client layer

---

#### `POST /auth/logout` — Auth Required

```json
// Request
{
  "refreshToken": "eyJ...",
  "fcmToken": "firebase-token..."
}
```

---

#### Password Reset — 3 Steps (Public)

```
Step 1: POST /auth/forgot-password
  Body: { "identifier": "+8562012345678" }
  → ส่ง OTP (response เหมือนกันทั้ง found/not-found เพื่อป้องกัน enumeration attack)

Step 2: POST /auth/forgot-password/verify-otp
  Body: { "userId": "uuid", "otp": "123456" }
  → Response: { "resetToken": "...", "expiresIn": 900 }  // 15 นาที

Step 3: POST /auth/reset-password
  Body: { "userId": "uuid", "resetToken": "...", "newPassword": "NewP@ss123" }
  → Invalidates ทุก session ที่มีอยู่
```

---

### 2.2 Profile (`/profile`)

#### `GET /profile` — Auth Required

```json
// Response 200
{
  "data": {
    "id": "uuid",
    "firstName": "ສົມຊາຍ",
    "lastName": "ວົງໄຊ",
    "phoneNumber": "+8562012345678",
    "email": "user@example.com",
    "avatarUrl": "https://...",
    "status": "ACTIVE",
    "lastLoginAt": "2026-03-24T09:00:00+07:00",
    "vehicles": [
      { "id": "uuid", "brand": "Tesla", "model": "Model 3", "plugType": "CCS2", "isDefault": true }
    ]
  }
}
```

#### `PUT /profile` — Auth Required

```json
// Request (ทุก field เป็น optional)
{
  "firstName": "ສົມຊາຍ",
  "lastName": "ວົງໄຊ",
  "avatarUrl": "https://cdn.example.com/avatar.jpg",
  "email": "newemail@example.com",
  "phoneNumber": "+8562098765432"
}
```

#### `DELETE /profile` — Auth Required
ลบบัญชี — anonymize ข้อมูล PII ทั้งหมด (ไม่สามารถกู้คืนได้)

---

### 2.3 Vehicles (`/vehicles`)

| Method | Path | Auth | วัตถุประสงค์ |
|---|---|---|---|
| GET | `/vehicles` | Yes | List ยานพาหนะทั้งหมด (default อยู่ก่อน) |
| GET | `/vehicles/:id` | Yes | ดูรายละเอียดยานพาหนะ |
| POST | `/vehicles` | Yes | เพิ่มยานพาหนะใหม่ |
| PUT | `/vehicles/:id` | Yes | แก้ไขข้อมูลยานพาหนะ |
| DELETE | `/vehicles/:id` | Yes | ลบยานพาหนะ (soft-delete) |

```json
// POST/PUT Request Body
{
  "brand": "Tesla",
  "model": "Model 3",
  "country": "USA",
  "plugType": "CCS2",
  "year": 2024,
  "plateNumber": "GP-0001",
  "isDefault": true
}
```

---

### 2.4 Wallet (`/wallet`)

#### `GET /wallet` — Auth Required
**พฤติกรรมพิเศษ:** สร้าง wallet อัตโนมัติถ้ายังไม่มี (lazy create)

```json
// Response 200
{
  "data": {
    "id": "uuid",
    "balance": 50000.00,
    "memberId": "PV-8429",
    "cardHolder": "ສົມຊາຍ ວົງໄຊ",
    "readyForCharging": true
  }
}
```

#### `POST /wallet/topup` — Auth Required

```json
// Request
{
  "amount": 100000,
  "description": "Top up via BCEL",
  "referenceId": "TXN-001"
}

// Response 200
{
  "data": {
    "newBalance": 150000.00,
    "transaction": {
      "id": "uuid", "type": "TOPUP",
      "amount": 100000, "balanceAfter": 150000,
      "createdAt": "2026-03-24T10:00:00+07:00"
    }
  }
}
```

#### `GET /wallet/transactions` — Auth Required

```
Query params: page=1, limit=20, type=TOPUP|CHARGE|REFUND
```

---

### 2.5 Charging Sessions (`/charging-sessions`)

#### `POST /charging-sessions/start` — Auth Required

```json
// Request
{
  "stationId": "uuid",
  "chargerId": "uuid",
  "connectorId": 1,
  "chargerIdentity": "EVCP-001",
  "vehicleId": "uuid"
}

// Response 201
{
  "data": {
    "sessionId": "uuid",
    "status": "ACTIVE",
    "pricePerKwh": 2500,
    "message": "กำลังส่งคำสั่งไปยัง Charger..."
  }
}
```

**Validation ก่อน start:**
1. ตรวจ `min_charging_balance` จาก DB config (default 10,000 LAK)
2. ตรวจว่า charger นั้นไม่มี session กำลังใช้งานอยู่ (Redis lock)
3. ดึง PricingTier จาก admin DB ผ่าน LATERAL JOIN

**Error Cases:**

| HTTP | เหตุผล |
|---|---|
| 402 | ยอดเงินไม่เพียงพอ (ต่ำกว่า min_charging_balance) |
| 409 | Charger กำลังมี session ใช้งานอยู่ |
| 503 | ไม่สามารถดึงข้อมูล Pricing จาก admin DB |

---

#### `DELETE /charging-sessions/:id` — Auth Required

```json
// Response 200
{
  "data": { "sessionId": "uuid", "message": "กำลังส่งคำสั่งหยุดไปยัง Charger..." }
}
```

---

#### `GET /charging-sessions/:id/live` — Auth Required

```json
// Response 200
{
  "data": {
    "sessionId": "uuid",
    "status": "ACTIVE",
    "energyKwh": 12.5,
    "estimatedCost": 31250,
    "durationMinutes": 45,
    "chargerIsOnline": true,
    "meterStart": 0,
    "meterCurrentWh": 12500,
    "pricePerKwh": 2500
  }
}
```

**Real-time Strategy:** ใช้ **Polling** ทุก 10–15 วินาที หรือรับ push notification เมื่อ session สำเร็จ

---

#### `GET /charging-sessions/stats` — Auth Required

```
Query params: period=7d|30d|90d (default: 30d)
```

ข้อมูลสถิติสำหรับ line chart แสดงพลังงาน/ค่าใช้จ่าย/จำนวนครั้ง

---

### 2.6 Stations (`/stations`) — Public

| Method | Path | วัตถุประสงค์ |
|---|---|---|
| GET | `/stations` | List สถานี paginated (search, status filter) |
| GET | `/stations/map` | Map pins ทุกสถานี (filter plugType) |
| GET | `/stations/nearby` | สถานีใกล้เคียง (lat, lng, radiusKm) |
| GET | `/stations/:id` | รายละเอียดสถานีเต็ม + images + chargers |
| GET | `/stations/:id/chargers/status` | สถานะ charger real-time overlay จาก Redis |

---

### 2.7 Payment (`/payment`)

| Method | Path | วัตถุประสงค์ |
|---|---|---|
| GET | `/payment/methods` | รายการช่องทางชำระเงินที่บันทึกไว้ |
| POST | `/payment/methods` | เพิ่มช่องทางชำระเงิน |
| PATCH | `/payment/methods/:id/set-default` | ตั้งเป็นช่องทางหลัก |
| DELETE | `/payment/methods/:id` | ลบช่องทางชำระเงิน |
| POST | `/payment/initiate` | เริ่มกระบวนการเติมเงิน |
| GET | `/payment/history` | ประวัติการชำระเงิน |

```json
// POST /payment/methods Request
{
  "type": "BCEL_ONLINE",
  "label": "BCEL xxxxxxxxx1234",
  "accountNumber": "1234567890",
  "isDefault": true
}

// POST /payment/initiate Request
{
  "amount": 100000,
  "paymentMethodId": "uuid",
  "description": "Top up wallet"
}
```

---

### 2.8 Invoice (`/invoices`)

| Method | Path | วัตถุประสงค์ |
|---|---|---|
| GET | `/invoices` | รายการใบเสร็จ (filter: status, dateFrom, dateTo) |
| GET | `/invoices/stats` | สถิติใบเสร็จ |
| GET | `/invoices/:id` | รายละเอียดใบเสร็จ |
| POST | `/invoices` | สร้างใบเสร็จจาก session ที่สำเร็จแล้ว |

```json
// POST /invoices Request
{ "sessionId": "uuid" }
```

---

### 2.9 Financial (`/financial`)

| Method | Path | วัตถุประสงค์ |
|---|---|---|
| GET | `/financial/summary` | ยอดรวมทั้งหมด + เดือนนี้ + ยอดกระเป๋าเงิน |
| GET | `/financial/monthly` | สถิติรายเดือน 12 เดือน (ระบุปี) |
| GET | `/financial/transactions` | ประวัติธุรกรรมรวม (CHARGE แสดงเป็นลบ) |
| GET | `/financial/export` | Export ข้อมูล (1m/3m/6m/1y/all) |

---

### 2.10 Favorites (`/favorites`)

| Method | Path | วัตถุประสงค์ |
|---|---|---|
| GET | `/favorites` | รายการสถานีโปรด |
| POST | `/favorites` | เพิ่มสถานีโปรด |
| DELETE | `/favorites/:stationId` | ลบสถานีออกจากโปรด |

---

### 2.11 Devices / FCM (`/devices`)

| Method | Path | วัตถุประสงค์ |
|---|---|---|
| POST | `/devices/fcm` | ลงทะเบียน FCM token (เรียกทุกครั้งที่เปิดแอป) |
| GET | `/devices/fcm` | รายการอุปกรณ์ที่ลงทะเบียน (token ถูก mask) |
| POST | `/devices/fcm/test` | ทดสอบส่ง push notification |
| DELETE | `/devices/fcm` | ยกเลิกลงทะเบียน FCM token (เรียกตอน logout) |

---

### 2.12 Content (`/contents`) — Public

#### `GET /contents/:slug`
ดึงเนื้อหา legal/manual ตาม slug เช่น `privacy-policy`, `terms-of-service`
ข้อมูล cache 30 นาที + invalidate ผ่าน RabbitMQ จาก Admin

---

### 2.13 Miscellaneous

| Method | Path | Auth | วัตถุประสงค์ |
|---|---|---|---|
| GET | `/enums` | No | ค่า enum ทั้งหมดสำหรับ dropdown |
| GET | `/enums/:key` | No | ค่า enum เฉพาะกลุ่ม |
| GET | `/audit-logs` | Yes | ประวัติการกระทำของผู้ใช้ |
| GET | `/health` | No | Health check |

---

## 3. Feature Implementation Details

### 3.1 Authentication Flow

**3.1.1 Registration + OTP Verification**

```
Mobile App                    API Server                   Redis / DB
    │                             │                              │
    ├─POST /auth/register──────►  │                              │
    │                             ├─ Hash password (bcrypt 12)   │
    │                             ├─ Create user PENDING_VERIF.  │
    │                             ├─ Generate 6-digit OTP ──────►│ SET otp:{userId} TTL 5m
    │                             ├─ Send OTP via SMS/Email       │
    │◄─ 201 { userId } ──────────┤                              │
    │                             │                              │
    ├─POST /auth/verify-otp ─────►│                              │
    │  { userId, otp }            ├─ GET otp:{userId} ──────────►│
    │                             │◄─ OTP value ─────────────────┤
    │                             ├─ Verify match                 │
    │                             ├─ Set user ACTIVE              │
    │                             ├─ Issue access + refresh token │
    │◄─ 200 { tokens, user } ────┤                              │
```

**3.1.2 JWT Storage — คำแนะนำสำหรับ Mobile Client**

| Token | วิธีเก็บ (แนะนำ) | ห้ามเก็บใน |
|---|---|---|
| Access Token (15m) | In-memory / Secure Memory | Shared Preferences / AsyncStorage |
| Refresh Token (30d) | **Secure Storage** (Keychain/Keystore) | SharedPreferences, LocalStorage |

- iOS: `Keychain Services` หรือ `flutter_secure_storage`
- Android: `Android Keystore` + `EncryptedSharedPreferences`

**3.1.3 Token Refresh Strategy**

```
Mobile App ──► API (Resource) ──► 401 Unauthorized
     │
     ├─► POST /auth/refresh { refreshToken }
     │       ├─ Success ──► เก็บ token ใหม่ + retry request เดิม
     │       └─ Failure ──► Force logout → redirect ไปหน้า Login
```

**3.1.4 Biometric Auth (FaceID/TouchID)**

API ไม่มี biometric endpoint โดยตรง — implement ที่ Mobile client layer โดยเก็บ credentials ใน Keychain แล้วใช้ biometric เพื่อ unlock ก่อนเรียก `/auth/login`

---

### 3.2 Charging Flow — Step by Step

```
┌─────────────────────────────────────────────────────────────────┐
│                  EV Charging User Journey                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  1. ค้นหาสถานี ──► GET /stations/nearby?lat=&lng=&radiusKm=5    │
│                                                                   │
│  2. ดูรายละเอียด ─► GET /stations/:id                           │
│                   ─► GET /stations/:id/chargers/status           │
│                                                                   │
│  3. สแกน QR Code ─► decode: { stationId, chargerId,             │
│                               connectorId, identity }            │
│                                                                   │
│  4. ตรวจสอบยอดเงิน ──► GET /wallet                              │
│     (readyForCharging = true ?)                                   │
│                                                                   │
│  5. เริ่ม Session ──► POST /charging-sessions/start             │
│     API ส่ง RabbitMQ → OCPP CSMS → RemoteStartTransaction       │
│                                                                   │
│  6. รอ OCPP ตอบกลับ (5–30 วินาที)                               │
│     - ถ้า ACCEPTED: transaction.started event → session ACTIVE   │
│     - ถ้า REJECTED/TIMEOUT: remote_start.failed → FCM push      │
│                                                                   │
│  7. Monitor ──► GET /charging-sessions/:id/live (polling 15s)   │
│     แสดง: ไฟฟ้า kWh / ค่าประมาณ / เวลาที่ใช้                  │
│                                                                   │
│  8. หยุด Session ──► DELETE /charging-sessions/:id              │
│     API ส่ง RabbitMQ → OCPP CSMS → RemoteStopTransaction        │
│                                                                   │
│  9. Billing (อัตโนมัติ — OCPP → Mobile via RabbitMQ)            │
│     transaction.stopped event:                                    │
│     - คำนวณ energy = (meterStop - meterStart) / 1000 kWh        │
│     - amount = kWh × pricePerKwh                                 │
│     - Atomic: ตัดยอดกระเป๋า + บันทึก WalletTransaction         │
│     - FCM push: "ชาร์จเสร็จแล้ว ยอดค่าไฟ X LAK"               │
│                                                                   │
│ 10. Parking Fee (ถ้าเปิดใช้งาน)                                  │
│     - เมื่อรถไม่ plug out → คิดค่า overstay ต่อนาที            │
│     - Connector Available → หักค่าจอด                           │
│                                                                   │
│ 11. สร้างใบเสร็จ ──► POST /invoices { sessionId }               │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

**Push Notification Types ในระหว่างชาร์จ:**

| type (data field) | เวลาที่ส่ง | ข้อความ |
|---|---|---|
| `remote_start_failed` | OCPP ปฏิเสธ/timeout | "ไม่สามารถเริ่มชาร์จได้" |
| `session_completed` | transaction.stopped | "ชาร์จเสร็จแล้ว X kWh" |
| `parking_warning` | หลัง session complete | "กรุณาถอดสายเพื่อหลีกเลี่ยงค่าจอด" |
| `charger_offline` | charger.offline event | "Charger ออฟไลน์ระหว่างชาร์จ" |
| `charger_restarted` | charger.booted event | "Charger ถูก restart" |

---

### 3.3 Maps & Location

ข้อมูลสถานีมาจาก `panda_ev_system` DB (Admin-owned) อ่านผ่าน `SystemDbService`

```
Mobile App ──► GET /stations/nearby?lat=17.97&lng=102.60&radiusKm=5
                    │
                    ├─ ตรวจ Redis cache ก่อน (TTL 2 นาที)
                    │   Key: station:nearby:17.97:102.60:5
                    ├─ Cache miss → Query system DB (Haversine formula)
                    └─ Cache result → Return ≤ 50 สถานีเรียงตามระยะทาง
```

**Cache Strategy:**

| Endpoint | Cache Key Pattern | TTL |
|---|---|---|
| Station list | `station:list:{page}:{limit}:{status}` | 5 นาที |
| Map pins | `station:map:{plugType}` | 5 นาที |
| Nearby | `station:nearby:{lat2dp}:{lng2dp}:{radius}` | 2 นาที |
| Station detail | `station:detail:{id}` | 5 นาที |

**แนะนำ Mobile Client:**
- ใช้ map library ที่รองรับ clustering (Google Maps SDK, Mapbox)
- Cache map tiles ใน client สำหรับ offline mode
- แสดงสถานะ charger จาก `/stations/:id/chargers/status` overlay บน map markers

---

### 3.4 Payment Gateway

> ปัจจุบัน: **Dev mode** — payment สำเร็จทันทีโดยไม่ผ่าน payment gateway จริง
> Production: Flow ควรเป็น PENDING → webhook จาก gateway → COMPLETED

```
POST /payment/initiate
    │
    ├─ Dev mode: COMPLETED ทันที → เติมยอด Wallet
    └─ Prod mode (TODO): Create PENDING Payment
                          → Redirect URL ไปยัง BCEL/JDB portal
                          → Webhook callback → mark COMPLETED
                          → เติมยอด Wallet
```

**Payment Methods ที่รองรับ:** `BCEL_ONLINE`, `JDB`, `CARD`, `CASH`

---

## 4. Security & Performance

### 4.1 Security Audit

#### ✅ สิ่งที่ทำได้ดีแล้ว

| ด้าน | การดำเนินการ |
|---|---|
| **JWT Signing** | รองรับ RS256 (ไฟล์ PEM หรือ base64) พร้อม fallback HS256 |
| **Service-to-Service Auth** | RS256 JWT ใน AMQP `x-service-token` + Redis jti blacklist (anti-replay 60s) |
| **Password Hashing** | bcrypt salt rounds 12 |
| **Input Validation** | `ValidationPipe` + `class-validator` ทุก endpoint — whitelist + transform |
| **Enumeration Prevention** | Forgot password ตอบเหมือนกันทั้ง found/not-found |
| **Audit Log** | บันทึกทุก critical action พร้อม IP + User-Agent |
| **Token Blacklist** | Refresh token เก็บใน Redis — revoke ได้ทันที |
| **Stale FCM Token Pruning** | ลบ token ที่หมดอายุอัตโนมัติหลัง multicast |

#### ⚠️ สิ่งที่ควรปรับปรุง

**Rate Limiting — ยังไม่มี Implementation จริง**
```
ความเสี่ยง: OTP brute-force, Password brute-force, API flooding
แนะนำ: ใช้ @nestjs/throttler หรือ Redis-based rate limiter
  - POST /auth/login: 5 ครั้ง / 15 นาที ต่อ IP
  - POST /auth/register: 3 ครั้ง / ชั่วโมง ต่อ IP
  - POST /auth/resend-otp: 3 ครั้ง / 10 นาที ต่อ userId
```

**SSL Pinning (Mobile Client)**
```
ความเสี่ยง: Man-in-the-middle attack
แนะนำ:
  - Flutter: dio + certificate_pinner
  - React Native: react-native-ssl-pinning
  - Pin ทั้ง Certificate fingerprint และ Public Key
```

**CORS Configuration**
```typescript
// ปัจจุบัน: CORS เปิดทุก origin
app.enableCors(); // ⚠️ ควรจำกัดใน production

// แนะนำ production config:
app.enableCors({
  origin: ['https://app.pandaev.com'],
  credentials: true,
});
```

**`GET /cache/otp` ไม่มี Auth Guard**
```
⚠️ Dev endpoint นี้คืนค่า OTP โดยไม่ต้อง login
   ต้องปิดใน production หรือใส่ JWT guard
แนะนำ: ตรวจ NODE_ENV=production แล้ว throw NotFoundException
```

---

### 4.2 Performance Audit

#### ✅ สิ่งที่ดีแล้ว

| ด้าน | การดำเนินการ |
|---|---|
| **Station Caching** | Redis cache 2–5 นาที ทุก station endpoint |
| **Content Caching** | Legal content cache 30 นาที + smart invalidation ผ่าน RabbitMQ |
| **Billing Snapshot** | Snapshot pricing ลง Redis ที่ session start — ไม่ query pricing ซ้ำระหว่างชาร์จ |
| **FCM Multicast** | ส่งเป็น chunk 500 tokens — รองรับ user ที่มีหลายอุปกรณ์ |
| **Near Location Cache** | Round lat/lng ทศนิยม 2 ตำแหน่ง — ใช้ cache ร่วมกันได้ในรัศมี ~1km |

#### ⚠️ แนะนำเพิ่มเติม

**Live Session ใช้ Polling — Battery Drain**
```
แนะนำ:
  1. ใช้ FCM push แทน polling เมื่อ session สำเร็จ
  2. ลด polling frequency เมื่อ app อยู่ background (30s)
  3. Stop polling เมื่อ session status = COMPLETED/FAILED
```

**Database Indexes สำหรับ Session Queries**
```
แนะนำ: เพิ่ม composite index บน ChargingSession:
  @@index([userId, status, createdAt(sort: Desc)])
```

---

### 4.3 Offline Mode

| Feature | Offline Behavior (แนะนำ) |
|---|---|
| Station Map | Cache map tiles + last station list ใน local DB |
| Session History | Cache ใน SQLite/Hive/Room — sync เมื่อ online |
| Active Session | แสดงข้อมูล session ล่าสุดจาก cache + แจ้ง "กำลังเชื่อมต่อใหม่..." |
| Payment | Block — ต้องการ network |
| Start Charging | Block — ต้องการ network + OCPP connection |

---

## 5. Testing Manual

### 5.1 Environment Setup

```bash
# 1. Install dependencies
cd panda-ev-client-mobile && npm install

# 2. Setup infrastructure
docker-compose up -d postgres redis rabbitmq

# 3. Setup database
npx prisma migrate deploy
npx prisma generate

# 4. Configure environment
cp .env.example .env
# แก้ไข DATABASE_URL, REDIS_URL, JWT_SECRET

# 5. Start dev server
npm run start:dev   # port 4001

# 6. เปิด Swagger docs
open http://localhost:4001/api/mobile/docs

# 7. ตรวจสอบ health
curl http://localhost:4001/health
```

---

### 5.2 Unit Tests

```bash
# Run all unit tests
npm run test

# Run specific test file
npx jest src/modules/auth/auth.service.spec.ts
npx jest src/modules/charging-session/ocpp-consumer.integration.spec.ts

# With coverage
npm run test:cov

# Watch mode
npm run test:watch
```

---

### 5.3 Critical Test Cases

#### Authentication

```
TC-AUTH-01: Register + Verify OTP สำเร็จ
  1. POST /auth/register → ได้ userId
  2. GET /cache/otp?identifier=<phone> (dev only) → ดู OTP
  3. POST /auth/verify-otp → ได้ tokens
  Expected: status ACTIVE, accessToken valid

TC-AUTH-02: Login ด้วยเบอร์โทรและอีเมล
  Expected: ทั้งสองกรณีสำเร็จ, ได้ defaultVehicle ถ้ามี

TC-AUTH-03: Token Refresh
  1. Login → เก็บ refreshToken
  2. Set JWT_ACCESS_EXPIRES_IN=10s → รอ token หมดอายุ
  3. Call API → ได้ 401
  4. POST /auth/refresh → ได้ token ใหม่
  5. Retry API → สำเร็จ

TC-AUTH-04: Logout + Refresh Token Invalidation
  1. Login → เก็บ refreshToken
  2. POST /auth/logout
  3. POST /auth/refresh ด้วย token เดิม
  Expected: 401 Unauthorized

TC-AUTH-05: Forgot Password — Enumeration Prevention
  1. POST /auth/forgot-password (เบอร์ที่มีอยู่)
  2. POST /auth/forgot-password (เบอร์ที่ไม่มี)
  Expected: ทั้งสองกรณีตอบ 200 เหมือนกัน
```

#### Charging Session

```
TC-CHARGE-01: Start Session สำเร็จ
  Prerequisites: wallet balance > 10,000 LAK
  1. GET /wallet → readyForCharging: true
  2. POST /charging-sessions/start
  Expected: sessionId, status ACTIVE

TC-CHARGE-02: Start Session — ยอดเงินไม่พอ
  Expected: 402 Payment Required

TC-CHARGE-03: Double-Start Prevention
  1. Start session บน charger A
  2. Start session บน charger A อีกครั้ง
  Expected: 409 Conflict

TC-CHARGE-04: Live Status Polling
  1. Start session
  2. GET /charging-sessions/:id/live ทุก 10 วินาที
  Expected: energyKwh และ estimatedCost เพิ่มขึ้น

TC-CHARGE-05: Session Completed + Billing
  1. Start session
  2. Simulate transaction.stopped ผ่าน RabbitMQ
  3. GET /wallet
  Expected: balance ลดลงตาม energyKwh × pricePerKwh

TC-CHARGE-06: Parking Fee Calculation
  1. Complete session (transaction.stopped)
  2. ไม่ plug out → รอเกิน free parking minutes
  3. Simulate connector.status_changed to Available
  Expected: ค่าจอดถูกหักจาก wallet ตรงตาม formula
```

#### Wallet & Payment

```
TC-WALLET-01: Wallet Lazy Creation
  1. Register user ใหม่
  2. GET /wallet (ครั้งแรก)
  Expected: สร้าง wallet อัตโนมัติ, balance = 0, memberId = "PV-XXXX"

TC-WALLET-02: Top-up Atomicity
  ทดสอบ concurrent top-up 2 requests พร้อมกัน
  Expected: ยอดรวมถูกต้อง ไม่มี race condition
```

#### Push Notifications

```
TC-FCM-01: Device Registration + Test Send
  1. POST /devices/fcm { fcmToken: "valid-token", platform: "android" }
  2. POST /devices/fcm/test
  Expected: { sent: 1, failed: 0, pruned: 0 } + notification บน device

TC-FCM-02: Stale Token Cleanup
  1. Register expired/invalid FCM token
  2. POST /devices/fcm/test
  Expected: { pruned: 1 } — token ถูกลบออกจาก DB
```

#### Edge Cases

```
TC-EDGE-01: Low Battery / Charger Offline During Session
  Simulate: charger.offline event ผ่าน RabbitMQ
  Expected: FCM push ถึง user, session record ยังคงอยู่ใน DB

TC-EDGE-02: Invalid QR Code
  POST /charging-sessions/start ด้วย chargerIdentity ที่ไม่มี
  Expected: 404 Not Found

TC-EDGE-03: OTP Expiry
  1. POST /auth/register
  2. รอ 5+ นาที
  3. POST /auth/verify-otp
  Expected: 400 OTP expired

TC-EDGE-04: Account Delete + Re-register
  1. DELETE /profile
  2. Register ด้วยเบอร์โทรเดิม
  Expected: สามารถลงทะเบียนได้ใหม่
```

---

### 5.4 Tools & Debugging

#### Network Debugging

```bash
# Charles Proxy / Proxyman
# ตั้งค่า proxy บน device: host IP:8888
# ตรวจ JWT tokens, request headers, response times

# Redis inspection
redis-cli KEYS "charging:*"           # active sessions
redis-cli KEYS "otp:*"                # pending OTPs
redis-cli TTL "charging:session:uuid" # ตรวจ TTL

# Server logs (dev)
npm run start:dev 2>&1 | grep -E "ERROR|WARN|charging|FCM"
```

#### Postman / Insomnia

```
1. Import Swagger: http://localhost:4001/api/mobile/docs-json
2. ตั้ง environment variable: {{baseUrl}}, {{accessToken}}
3. ใช้ Pre-request Script เพื่อ auto-refresh token
```

---

### 5.5 Build Environments

```bash
# Type check
npx tsc --noEmit

# Lint
npm run lint

# Production build
npm run build
node dist/main.js
```

| Feature | Development | Production |
|---|---|---|
| Swagger docs | ✅ เปิด | ❌ ปิด |
| `GET /cache/otp` | ✅ เปิด | ❌ ต้องปิด |
| CORS | ทุก origin | จำกัด domain |
| Payment | Simulated (instant) | Real gateway |

---

## 6. Known Issues & Roadmap

### 6.1 Known Issues

| ระดับ | ปัญหา | แนะนำการแก้ไข |
|---|---|---|
| 🔴 Critical | **ไม่มี Rate Limiting** — OTP/Login brute-force ได้ | เพิ่ม `@nestjs/throttler` |
| 🔴 Critical | **`GET /cache/otp` ไม่มี auth** — ดู OTP ได้โดยไม่ต้อง login | ปิดใน production |
| 🔴 Critical | **CORS เปิดทุก origin** | จำกัดเฉพาะ production domain |
| 🟡 High | **Payment Gateway ไม่มี Production Implementation** | Implement webhook receiver สำหรับ BCEL/JDB |
| 🟡 High | **ไม่มี Account Lockout** หลัง login ผิดหลายครั้ง | เพิ่ม failed attempt counter ใน Redis (5 ครั้ง → lock 30 นาที) |
| 🟡 High | **Wallet Top-up ไม่ตรวจ transaction ซ้ำ** ด้วย referenceId | เพิ่ม unique constraint บน `referenceId` |
| 🟠 Medium | **Live Session ใช้ Polling** — battery drain | เพิ่ม SSE หรือ WebSocket channel |
| 🟠 Medium | **ไม่มี Input Sanitization สำหรับ HTML** ใน ContentService | Sanitize HTML ก่อน return |
| 🟢 Low | Biometric Auth ไม่มีใน API layer | เพิ่ม `/auth/biometric/challenge` endpoint (optional) |

---

### 6.2 Roadmap

**Phase 1 — Security Hardening (ก่อน Production)**
- [ ] Rate Limiting ทุก auth endpoint
- [ ] ปิด `/cache/otp` ใน production
- [ ] จำกัด CORS origin
- [ ] Implement Payment Gateway webhook
- [ ] Account lockout (5 failed attempts → 30 min lock)

**Phase 2 — Performance & UX**
- [ ] WebSocket / SSE สำหรับ live session (แทน polling)
- [ ] Database composite indexes สำหรับ session queries
- [ ] HTTP ETags สำหรับ station endpoints
- [ ] Push notification localization (lo/zh)

**Phase 3 — Feature Enhancement**
- [ ] Biometric auth support
- [ ] Charging schedule / reservation system
- [ ] Loyalty points / reward system
- [ ] Multi-language OTP message (lo/zh/en)
- [ ] PDF invoice export
- [ ] Receipt sharing

---

*จัดทำโดย: Claude Code — Senior Mobile API Architect*
*วันที่: 24 มีนาคม 2026*
*สำหรับ: ทีมพัฒนา Panda EV Hub*
