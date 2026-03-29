# CSMS_System_Documentation_and_Audit.md

> **Panda EV Hub Platform — เอกสารสถาปัตยกรรมและการตรวจสอบระบบฉบับสมบูรณ์**
>
> วันที่จัดทำ: 2026-03-24 | เวอร์ชัน: 1.0.0
> ผู้จัดทำ: Senior EV CSMS Architect Analysis

---

## สารบัญ

1. [ภาพรวมสถาปัตยกรรมระบบ](#1-ภาพรวมสถาปัตยกรรมระบบ)
2. [คู่มือ API Reference Guide](#2-คู่มือ-api-reference-guide)
3. [โครงสร้างฐานข้อมูลและโมเดลข้อมูล](#3-โครงสร้างฐานข้อมูลและโมเดลข้อมูล)
4. [การตรวจสอบความปลอดภัยและประสิทธิภาพ](#4-การตรวจสอบความปลอดภัยและประสิทธิภาพ)
5. [คู่มือการทดสอบระบบ](#5-คู่มือการทดสอบระบบ)
6. [ฟีเจอร์ที่ยังขาดและแผนพัฒนา](#6-ฟีเจอร์ที่ยังขาดและแผนพัฒนา)

---

## 1. ภาพรวมสถาปัตยกรรมระบบ

### 1.1 บทนำ

Panda EV Hub Platform คือระบบจัดการสถานีชาร์จยานยนต์ไฟฟ้า (EV Charging Station Management System หรือ CSMS) ที่พัฒนาด้วยสถาปัตยกรรม Microservices จำนวน 4 บริการหลัก ซึ่งแต่ละบริการแยกการทำงานและฐานข้อมูลออกจากกันอย่างเด็ดขาด โดยใช้ NestJS 11 เป็น framework หลักสำหรับบริการ REST/WebSocket

**เทคโนโลยีหลัก:**
- **Runtime**: Node.js + NestJS 11 (TypeScript)
- **ฐานข้อมูล**: PostgreSQL + Prisma 7 (multi-schema)
- **Cache/State**: Redis (ioredis) — hard requirement สำหรับทุกบริการ
- **Message Broker**: RabbitMQ (amqplib) — soft-fail
- **Push Notifications**: Firebase Cloud Messaging (FCM)
- **Real-time**: Socket.IO (WebSocket gateway)
- **โปรโตคอล EV**: OCPP 1.6J (JSON over WebSocket)
- **Security**: RS256 JWT + Redis anti-replay blacklist

### 1.2 ทะเบียนบริการ (Service Registry)

| บริการ | Directory | Port | URL Prefix | DB Schema | วัตถุประสงค์หลัก |
|--------|-----------|------|------------|-----------|-----------------|
| **Admin CSMS** | `panda-ev-csms-system-admin/` | 3001 | `/api/admin/v1/` | `panda_ev_system` | IAM, CMS, สถานีชาร์จ, ราคา, Audit |
| **Mobile API** | `panda-ev-client-mobile/` | 4001 | `/api/mobile/v1/` | `panda_ev_core` | Authentication, Wallet, Charging Sessions |
| **OCPP CSMS** | `panda-ev-ocpp/` | 4002 | WebSocket only | `panda_ev_ocpp` | โปรโตคอล OCPP 1.6J กับตัวชาร์จ |
| **Notification** | `panda-ev-notification/` | 5001 | `/api/notification/v1/` | `panda_ev_notifications` | FCM Push, สถิติ, Admin Dashboard WS |

### 1.3 แผนภาพสถาปัตยกรรม

```
┌─────────────────────────────────────────────────────────────────────┐
│                     Panda EV Hub Platform                           │
│                                                                     │
│  ┌──────────┐    HTTPS    ┌──────────────────────────────────────┐  │
│  │ Admin    │◄──────────►│ Admin CSMS (3001)                     │  │
│  │ Portal   │             │ panda_ev_system                       │  │
│  │ (Web)    │             │ IAM / CMS / Stations / Pricing        │  │
│  └──────────┘             └────────────────┬─────────────────────┘  │
│                                            │                        │
│  ┌──────────┐    HTTPS    ┌───────────────▼──────────────────────┐  │
│  │ Mobile   │◄──────────►│ Mobile API (4001)                     │  │
│  │ App      │             │ panda_ev_core                         │  │
│  │ (iOS/    │             │ Auth / Wallet / Charging Sessions     │  │
│  │  Android)│             └────────────────┬─────────────────────┘  │
│  └──────────┘                              │                        │
│                                            │ RabbitMQ               │
│  ┌────────────┐   OCPP 1.6J  ┌───────────▼──────────────────────┐  │
│  │ EV Charger │◄────────────►│ OCPP CSMS (4002)                 │  │
│  │ (Physical) │  WebSocket   │ panda_ev_ocpp                     │  │
│  └────────────┘              │ OCPP Protocol Handler             │  │
│                              └────────────────┬─────────────────┘  │
│                                               │                     │
│  ┌──────────────┐            ┌───────────────▼──────────────────┐  │
│  │ Admin        │◄──WS──────►│ Notification (5001)              │  │
│  │ Dashboard    │ /admin-    │ panda_ev_notifications            │  │
│  │ (Real-time)  │  stats     │ FCM / Stats / Live Dashboard      │  │
│  └──────────────┘            └──────────────────────────────────┘  │
│                                                                     │
│  ┌────────────────────────────────────────────────────────────┐     │
│  │ Shared Infrastructure                                      │     │
│  │  Redis (Cache, State, Anti-replay) │ RabbitMQ (Events)     │     │
│  │  PostgreSQL (4 Schemas)            │ Firebase (FCM)         │     │
│  └────────────────────────────────────────────────────────────┘     │
└─────────────────────────────────────────────────────────────────────┘
```

### 1.4 การสื่อสารระหว่างบริการ (Inter-Service Communication)

#### RabbitMQ Queues (ทั้งหมด 7 Queues)

| Queue | ทิศทาง | Payload หลัก |
|-------|---------|-------------|
| `PANDA_EV_CSMS_COMMANDS` | Mobile → OCPP | `session.start`, `session.stop` |
| `PANDA_EV_QUEUE` | OCPP → Mobile, Notification | `transaction.started/stopped`, `charger.booted`, `connector.status_changed`, `charger.offline/heartbeat` |
| `PANDA_EV_ADMIN_COMMANDS` | Admin → OCPP | คำสั่ง OCPP 17 ประเภท (reset, configuration, ฯลฯ) |
| `PANDA_EV_NOTIFICATIONS` | Mobile/Admin → Notification | `notification.targeted/session/broadcast/overstay_reminder` |
| `PANDA_EV_NOTIFICATIONS_DLQ` | ภายใน | Dead-letter (3 retry: 5s/30s/120s) |
| `PANDA_EV_USER_EVENTS` | Mobile → Admin | `user.registered` (sync mobile user profiles) |
| `PANDA_EV_SYSTEM_EVENTS` | Admin → Mobile | `content.invalidate` (invalidate Redis cache) |

#### ความปลอดภัยของ RabbitMQ Messages

ทุก message ที่ publish จะถูก sign ด้วย RS256 JWT header `x-service-token` (TTL 30 วินาที) และ consumer จะ verify signature + ตรวจสอบ Redis jti blacklist ก่อนประมวลผล Messages ที่ไม่ผ่านการตรวจสอบจะถูก `nack` และทิ้งทันที

### 1.5 Redis Key Reference (ทั้งระบบ)

| Redis Key Pattern | TTL | เจ้าของ | ข้อมูล |
|-------------------|-----|---------|-------|
| `charger_status:{identity}` | 600s | OCPP | สถานะออนไลน์/ออฟไลน์ |
| `connector_status:{chargerId}:{connectorId}` | 60s | OCPP | สถานะ connector |
| `session:pending:{identity}:{connectorId}` | 300s | OCPP | คำขอ RemoteStart ที่รอ charger ตอบ |
| `charging:session:{sessionId}` | 8h | Mobile | billing snapshot ทั้งหมด |
| `charging:charger:{identity}` | 8h | Mobile | sessionId ที่กำลัง active |
| `charging:live:{identity}:{connectorId}` | 8h | OCPP | MeterValues ล่าสุด (Wh) |
| `parking:timer:{identity}:{connectorId}` | 8h | Mobile | Overstay timer state |
| `ocpp:cmd:result:{commandId}` | 90s | Admin | ผลลัพธ์คำสั่ง OCPP Command |
| `dedup:{sessionId}:{type}` | 24h | Notification | ป้องกัน notification ซ้ำ |
| `ratelimit:{userId}:{type}` | Rolling | Notification | Rate limit sliding window |
| `refresh:{userId}:{tokenId}` | 7d | Admin/Mobile | Refresh token |
| `svc:jti:{jti}` | 60s | All | Anti-replay for service JWT |

### 1.6 Security Trust Matrix

| บริการ | เชื่อถือ JWT จาก |
|--------|----------------|
| Admin CSMS | `mobile-api`, `ocpp-csms`, `notification-service` |
| Mobile API | `admin-api`, `ocpp-csms`, `notification-service` |
| OCPP CSMS | `mobile-api`, `admin-api` |
| Notification | `mobile-api`, `admin-api` |

### 1.7 Business Flow หลัก — การชาร์จยานยนต์

```
1. ผู้ใช้เปิด App → เลือกสถานีและ charger → กด "เริ่มชาร์จ"
2. Mobile API ตรวจสอบ wallet balance (≥ MIN_CHARGING_BALANCE)
3. Mobile API ดึง PricingTier สูงสุด (LATERAL JOIN) จาก panda_ev_system
4. Mobile API สร้าง ChargingSession (ACTIVE) + snapshot billing → Redis charging:session:{id} (8h)
5. Mobile API publish session.start → PANDA_EV_CSMS_COMMANDS (signed x-service-token)
6. OCPP CSMS รับ → เก็บ pending session ใน Redis → ส่ง RemoteStartTransaction ให้ charger (timeout 15s)
7. Charger ตอบ Accepted → OCPP รับ StartTransaction CALL
8. OCPP สร้าง Transaction record → publish transaction.started → PANDA_EV_QUEUE
9. Mobile API รับ → อัปเดต session.ocppTransactionId + meterStart ใน Redis
10. ขณะชาร์จ: charger ส่ง MeterValues → OCPP update Redis charging:live:{identity}:{connectorId}
11. ผู้ใช้กด "หยุดชาร์จ" หรือ charger stops:
12. Mobile API publish session.stop → OCPP ส่ง RemoteStopTransaction
13. Charger ส่ง StopTransaction CALL → OCPP update Transaction → publish transaction.stopped
14. Mobile API รับ → คำนวณพลังงาน + deduct wallet (atomic transaction) → สร้าง Invoice
15. (ถ้ามี parking fee) ตั้ง parking timer ใน Redis → เก็บค่า overstay เมื่อ connector เป็น Available
16. Notification Service รับ notification.session → dedup → rate-limit → ส่ง FCM → log
```

---

## 2. คู่มือ API Reference Guide

### รูปแบบ Response มาตรฐาน

ทุก endpoint ในทั้ง 3 บริการ REST ส่งกลับรูปแบบเดียวกัน:

```json
{
  "success": true,
  "statusCode": 200,
  "data": { ... },
  "message": "สำเร็จ",
  "errorCode": null,
  "errors": null,
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 100,
    "totalPages": 5
  },
  "timestamp": "2026-03-24T10:00:00.000+07:00"
}
```

**Timezone:** ทุก timestamp แปลงเป็น Asia/Vientiane (UTC+7) ผ่าน `TimezoneInterceptor`

---

### 2.1 Admin CSMS API — Port 3001

**Base URL:** `http://localhost:3001/api/admin/v1`
**Swagger UI:** `GET http://localhost:3001/api/admin/docs` (เปิดเมื่อ `NODE_ENV=development` หรือ `SWAGGER_ENABLED=true`)

#### Authentication (Admin)

| Method | Endpoint | Auth | คำอธิบาย |
|--------|----------|------|---------|
| `POST` | `/auth/login` | Public | เข้าสู่ระบบด้วย email/password → ส่งคืน access_token + refresh_token |
| `POST` | `/auth/refresh` | Public | ต่ออายุ access token ด้วย refresh_token |
| `POST` | `/auth/logout` | JWT | ออกจากระบบ (revoke refresh token) |
| `PUT` | `/auth/change-password` | JWT | เปลี่ยนรหัสผ่าน + revoke ทุก session |

**Request: POST /auth/login**
```json
{ "email": "admin@pandaev.com", "password": "Admin@123456" }
```
**Response:**
```json
{
  "data": {
    "accessToken": "eyJhbGci...",
    "refreshToken": "eyJhbGci...",
    "user": { "id": "uuid", "email": "...", "firstName": "...", "roles": [...] }
  }
}
```

---

#### IAM — Users

| Method | Endpoint | Permission | คำอธิบาย |
|--------|----------|-----------|---------|
| `GET` | `/users` | `users:read` | รายการ admin users (pagination, search, filter status) |
| `POST` | `/users` | `users:create` | สร้าง admin user ใหม่ |
| `GET` | `/users/:id` | `users:read` | ดูรายละเอียด user รวม roles และ groups |
| `PUT` | `/users/:id` | `users:update` | แก้ไขข้อมูล user |
| `DELETE` | `/users/:id` | `users:delete` | Soft delete user |
| `POST` | `/users/:id/roles` | `users:manage` | กำหนด roles ให้ user |
| `DELETE` | `/users/:id/roles/:roleId` | `users:manage` | ลบ role จาก user |
| `POST` | `/users/:id/groups` | `users:manage` | เพิ่ม user เข้า group |
| `DELETE` | `/users/:id/groups/:groupId` | `users:manage` | ลบ user ออกจาก group |

**Query Params (GET /users):**
```
?page=1&limit=20&search=admin&status=ACTIVE
```

---

#### IAM — Roles

| Method | Endpoint | Permission | คำอธิบาย |
|--------|----------|-----------|---------|
| `GET` | `/roles` | `roles:read` | รายการ roles ทั้งหมด |
| `POST` | `/roles` | `roles:create` | สร้าง role ใหม่ |
| `GET` | `/roles/:id` | `roles:read` | ดูรายละเอียด role + permissions |
| `PUT` | `/roles/:id` | `roles:update` | แก้ไข role (system roles ไม่สามารถแก้ไขได้) |
| `DELETE` | `/roles/:id` | `roles:delete` | ลบ role (soft delete) |
| `POST` | `/roles/:id/permissions` | `roles:manage` | กำหนด permissions ให้ role |
| `DELETE` | `/roles/:id/permissions/:permissionId` | `roles:manage` | ลบ permission จาก role |

---

#### IAM — Groups & Permissions

| Method | Endpoint | Permission | คำอธิบาย |
|--------|----------|-----------|---------|
| `GET` | `/groups` | `groups:read` | รายการ groups |
| `POST` | `/groups` | `groups:create` | สร้าง group |
| `GET` | `/groups/:id` | `groups:read` | รายละเอียด group |
| `PUT` | `/groups/:id` | `groups:update` | แก้ไข group |
| `DELETE` | `/groups/:id` | `groups:delete` | ลบ group |
| `GET` | `/permissions` | `permissions:read` | รายการ permissions ทั้งหมด (90 รายการ) |

---

#### CMS — Banners

| Method | Endpoint | Permission | คำอธิบาย |
|--------|----------|-----------|---------|
| `GET` | `/banners` | `banners:read` | รายการ banners (filter position, isActive) |
| `POST` | `/banners` | `banners:create` | สร้าง banner (ต้องมี imageUrl จาก GCS) |
| `GET` | `/banners/:id` | `banners:read` | ดู banner รายละเอียด |
| `PUT` | `/banners/:id` | `banners:update` | แก้ไข banner |
| `DELETE` | `/banners/:id` | `banners:delete` | Soft delete banner |

**Banner Positions:** `HOME_TOP`, `HOME_MIDDLE`, `HOME_BOTTOM`, `SIDEBAR`, `SPLASH_SCREEN`, `POPUP`

---

#### CMS — News Articles

| Method | Endpoint | Permission | คำอธิบาย |
|--------|----------|-----------|---------|
| `GET` | `/news` | `news:read` | รายการข่าว (filter status, search) |
| `POST` | `/news` | `news:create` | สร้างบทความ (status: DRAFT) |
| `GET` | `/news/:id` | `news:read` | ดูบทความรายละเอียด |
| `PUT` | `/news/:id` | `news:update` | แก้ไขบทความ |
| `DELETE` | `/news/:id` | `news:delete` | Soft delete บทความ |
| `POST` | `/news/:id/publish` | `news:manage` | เผยแพร่บทความ (DRAFT → PUBLISHED) |

**News Status Flow:** `DRAFT` → `SCHEDULED` → `PUBLISHED` → `ARCHIVED`

---

#### FCM Notifications (Admin Broadcast)

| Method | Endpoint | Permission | คำอธิบาย |
|--------|----------|-----------|---------|
| `GET` | `/notifications` | `notifications:read` | ประวัติการส่ง notification |
| `POST` | `/notifications` | `notifications:create` | สร้างและส่ง notification (FCM topic/multicast/single) |
| `GET` | `/notifications/:id` | `notifications:read` | รายละเอียด notification + delivery stats |
| `POST` | `/notifications/:id/send` | `notifications:manage` | ส่งซ้ำ notification ที่ FAILED |

**Request: POST /notifications**
```json
{
  "title": "อัปเดตระบบ",
  "body": "ระบบจะปิดปรับปรุงชั่วคราว",
  "channel": "FCM_TOPIC",
  "topic": "all_users",
  "data": { "type": "system_alert" },
  "scheduledAt": null
}
```

---

#### Station Management

| Method | Endpoint | Permission | คำอธิบาย |
|--------|----------|-----------|---------|
| `GET` | `/stations` | `stations:read` | รายการสถานีชาร์จ (filter status, search, province, city) |
| `POST` | `/stations` | `stations:create` | สร้างสถานีชาร์จ |
| `GET` | `/stations/:id` | `stations:read` | รายละเอียดสถานี + chargers + amenities |
| `PUT` | `/stations/:id` | `stations:update` | แก้ไขสถานี |
| `DELETE` | `/stations/:id` | `stations:delete` | Soft delete สถานี |
| `POST` | `/stations/:id/images` | `stations:update` | เพิ่มรูปภาพสถานี |
| `DELETE` | `/stations/:id/images/:imageId` | `stations:update` | ลบรูปภาพ |
| `POST` | `/stations/:id/amenities` | `stations:update` | เพิ่ม amenity ให้สถานี |
| `DELETE` | `/stations/:id/amenities/:amenityId` | `stations:update` | ลบ amenity |

**Station Status:** `ACTIVE`, `INACTIVE`, `MAINTENANCE`, `COMING_SOON`

---

#### Charger Management

| Method | Endpoint | Permission | คำอธิบาย |
|--------|----------|-----------|---------|
| `GET` | `/chargers/dashboard` | `chargers:read` | Dashboard chargers ทั้งหมด + live Redis status |
| `POST` | `/stations/:stationId/chargers` | `chargers:create` | เพิ่ม charger ใหม่ |
| `GET` | `/chargers/:id` | `chargers:read` | รายละเอียด charger + connectors |
| `PUT` | `/chargers/:id` | `chargers:update` | แก้ไข charger |
| `DELETE` | `/chargers/:id` | `chargers:delete` | Soft delete charger |
| `POST` | `/chargers/:id/connectors` | `chargers:create` | เพิ่ม connector |
| `PUT` | `/chargers/:id/connectors/:connectorId` | `chargers:update` | แก้ไข connector |
| `DELETE` | `/chargers/:id/connectors/:connectorId` | `chargers:delete` | Soft delete connector |

**ChargePointStatus:** `ONLINE`, `OFFLINE`, `BOOTING`, `MAINTENANCE`, `COMING_SOON`
**ConnectorStatus:** `AVAILABLE`, `PREPARING`, `CHARGING`, `SUSPENDED_EV`, `SUSPENDED_EVSE`, `FINISHING`, `RESERVED`, `UNAVAILABLE`, `FAULTED`

---

#### OCPP Commands (Admin → Charger)

ทุก endpoint ต้องการ Permission `chargers:manage` (ยกเว้น read-only commands ใช้ `chargers:read`)

| Method | Endpoint | คำอธิบาย |
|--------|----------|---------|
| `POST` | `/chargers/:id/commands/remote-start` | สั่งเริ่มชาร์จ (มี idTag, connectorId) |
| `POST` | `/chargers/:id/commands/remote-stop` | สั่งหยุดชาร์จ (มี transactionId) |
| `POST` | `/chargers/:id/commands/reset` | Reboot charger (Hard/Soft) |
| `POST` | `/chargers/:id/commands/clear-cache` | ล้าง Authorization Cache |
| `POST` | `/chargers/:id/commands/unlock-connector` | Unlock connector ที่ติดอยู่ |
| `POST` | `/chargers/:id/commands/change-availability` | เปลี่ยน availability (Operative/Inoperative) |
| `POST` | `/chargers/:id/commands/get-configuration` | อ่านค่า config (permission: `chargers:read`) |
| `POST` | `/chargers/:id/commands/change-configuration` | แก้ไขค่า config (key-value) |
| `POST` | `/chargers/:id/commands/trigger-message` | สั่ง charger ส่ง message (BootNotification, Heartbeat, ฯลฯ) |
| `POST` | `/chargers/:id/commands/reserve-now` | จอง connector ล่วงหน้า |
| `POST` | `/chargers/:id/commands/cancel-reservation` | ยกเลิกการจอง |
| `POST` | `/chargers/:id/commands/get-local-list-version` | อ่าน version ของ local list (permission: `chargers:read`) |
| `POST` | `/chargers/:id/commands/send-local-list` | ส่ง local authorization list |
| `POST` | `/chargers/:id/commands/set-charging-profile` | กำหนด charging profile |
| `POST` | `/chargers/:id/commands/clear-charging-profile` | ลบ charging profile |
| `POST` | `/chargers/:id/commands/get-composite-schedule` | อ่าน composite schedule (permission: `chargers:read`) |
| `POST` | `/chargers/:id/commands/get-diagnostics` | ดึง diagnostics file |
| `POST` | `/chargers/:id/commands/update-firmware` | อัปเดต firmware |
| `GET` | `/chargers/:id/commands/:commandId/result` | ดูผลลัพธ์คำสั่ง (polling, TTL 90s) |

**Command Flow:**
```
Admin Portal → POST /commands/reset → Admin publishes commandId to PANDA_EV_ADMIN_COMMANDS
→ OCPP รับ → ส่ง Reset CALL ไปยัง Charger → เก็บผล @ ocpp:cmd:result:{commandId} (Redis 90s)
→ Admin GET /commands/:commandId/result → Admin อ่านผลจาก Redis
```

---

#### Pricing Management

| Method | Endpoint | Permission | คำอธิบาย |
|--------|----------|-----------|---------|
| `GET` | `/pricing/tiers` | `pricing-tiers:read` | รายการ Pricing Tiers (filter type, isActive) |
| `POST` | `/pricing/tiers` | `pricing-tiers:create` | สร้าง Pricing Tier ใหม่ |
| `GET` | `/pricing/tiers/:id` | `pricing-tiers:read` | รายละเอียด Pricing Tier |
| `PUT` | `/pricing/tiers/:id` | `pricing-tiers:update` | แก้ไข Pricing Tier |
| `DELETE` | `/pricing/tiers/:id` | `pricing-tiers:delete` | Soft delete |
| `GET` | `/pricing/station-pricings` | `pricing-tiers:read` | การเชื่อมโยง Tier ↔ Station |
| `POST` | `/pricing/station-pricings` | `pricing-tiers:manage` | เชื่อม Tier กับสถานี |
| `DELETE` | `/pricing/station-pricings/:id` | `pricing-tiers:manage` | ยกเลิกการเชื่อม |
| `GET` | `/pricing/promotions` | `promotions:read` | รายการ Promotions |
| `POST` | `/pricing/promotions` | `promotions:create` | สร้าง Promotion |
| `PUT` | `/pricing/promotions/:id` | `promotions:update` | แก้ไข Promotion |
| `DELETE` | `/pricing/promotions/:id` | `promotions:delete` | ลบ Promotion |

**PricingTier Types:** `PER_KWH`, `PER_MINUTE`, `HYBRID`, `FLAT`
**DiscountTypes:** `PERCENTAGE`, `FIXED_AMOUNT`, `FREE_KWH`

**หมายเหตุสำคัญ:** ราคาทั้งหมดเป็นหน่วย LAK (กีบ) เป็น Integer ไม่มีทศนิยม

---

#### Mobile Users (Read-Only Mirror)

| Method | Endpoint | Permission | คำอธิบาย |
|--------|----------|-----------|---------|
| `GET` | `/mobile-users` | `mobile-users:read` | รายการผู้ใช้ mobile (synced via RabbitMQ) |
| `GET` | `/mobile-users/:id` | `mobile-users:read` | รายละเอียดผู้ใช้ mobile |

> ข้อมูลเหล่านี้เป็น read-only — sync มาจาก Mobile API ผ่าน `PANDA_EV_USER_EVENTS` queue

---

#### Legal Content, System Settings & Location

| Method | Endpoint | Permission | คำอธิบาย |
|--------|----------|-----------|---------|
| `GET` | `/legal-contents` | `legal-content:read` | รายการ นโยบาย/คู่มือ/FAQ |
| `POST` | `/legal-contents` | `legal-content:create` | สร้างเนื้อหากฎหมาย |
| `GET` | `/legal-contents/:id` | `legal-content:read` | รายละเอียด |
| `PUT` | `/legal-contents/:id` | `legal-content:update` | แก้ไข |
| `DELETE` | `/legal-contents/:id` | `legal-content:delete` | ลบ |
| `GET` | `/system-settings` | `system-settings:read` | ค่าตั้งระบบทั้งหมด (grouped) |
| `PUT` | `/system-settings/:key` | `system-settings:manage` | แก้ไขค่าตั้งระบบ |
| `GET` | `/locations/regions` | Public | รายการภาค |
| `GET` | `/locations/provinces` | Public | รายการจังหวัด (filter regionId) |
| `GET` | `/locations/cities` | Public | รายการเมือง (filter provinceId) |
| `GET` | `/audit-logs` | `audit-logs:read` | ประวัติการกระทำ admin (filter user, resource, action) |
| `GET` | `/amenities` | Public | รายการ amenities ทั้งหมด |
| `POST` | `/amenities` | `stations:manage` | สร้าง amenity ใหม่ |
| `GET` | `/enums` | Public | รายการ enum values สำหรับ frontend |
| `DELETE` | `/cache/:key` | `cache:manage` | ล้าง cache ตาม key |
| `GET` | `/health` | Public | Liveness probe |

**LegalContentType:** `POLICY`, `MANUAL`, `FAQ`

---

### 2.2 Mobile API — Port 4001

**Base URL:** `http://localhost:4001/api/mobile/v1`
**Swagger UI:** `GET http://localhost:4001/api/mobile/docs`

#### Authentication (Mobile Users)

| Method | Endpoint | Auth | คำอธิบาย |
|--------|----------|------|---------|
| `POST` | `/auth/register` | Public | ลงทะเบียน (email/phone + password) → ส่ง OTP |
| `POST` | `/auth/verify-otp` | Public | ยืนยัน OTP → activate บัญชี |
| `POST` | `/auth/resend-otp` | Public | ส่ง OTP ใหม่ |
| `POST` | `/auth/login` | Public | เข้าสู่ระบบ → access_token + refresh_token |
| `POST` | `/auth/refresh` | Public | ต่ออายุ access token |
| `POST` | `/auth/logout` | JWT | ออกจากระบบ |
| `POST` | `/auth/forgot-password` | Public | ขอรีเซ็ตรหัสผ่าน → ส่ง OTP |
| `POST` | `/auth/reset-password` | Public | รีเซ็ตรหัสผ่านด้วย OTP |

**Request: POST /auth/register**
```json
{
  "email": "user@example.com",
  "phoneNumber": "+85620XXXXXXXX",
  "password": "Password@123",
  "firstName": "ສົມໄຊ",
  "lastName": "ສີທອນ",
  "acceptedTerms": true
}
```

---

#### User Profile

| Method | Endpoint | Auth | คำอธิบาย |
|--------|----------|------|---------|
| `GET` | `/profile` | JWT | ดูโปรไฟล์ตัวเอง |
| `PUT` | `/profile` | JWT | แก้ไขโปรไฟล์ (firstName, lastName, avatarUrl) |
| `DELETE` | `/profile` | JWT | ลบบัญชี (soft delete) |

---

#### Vehicles

| Method | Endpoint | Auth | คำอธิบาย |
|--------|----------|------|---------|
| `GET` | `/vehicles` | JWT | รายการยานยนต์ของฉัน |
| `POST` | `/vehicles` | JWT | เพิ่มยานยนต์ (brand, model, plugType, plateNumber) |
| `GET` | `/vehicles/:id` | JWT | รายละเอียดยานยนต์ |
| `PUT` | `/vehicles/:id` | JWT | แก้ไขยานยนต์ |
| `DELETE` | `/vehicles/:id` | JWT | ลบยานยนต์ |

**PlugType:** `GBT`, `CCS2`, `TYPE2`

---

#### Wallet

| Method | Endpoint | Auth | คำอธิบาย |
|--------|----------|------|---------|
| `GET` | `/wallet` | JWT | ดูยอดเงินและข้อมูล wallet (lazy-create ถ้ายังไม่มี) |
| `POST` | `/wallet/topup` | JWT | เติมเงิน (amount, description, referenceId) |
| `GET` | `/wallet/transactions` | JWT | ประวัติ transaction (pagination, filter type) |

**Response: GET /wallet**
```json
{
  "data": {
    "id": "uuid",
    "memberId": "PV-8429",
    "balance": 50000,
    "cardHolder": "ສົມໄຊ ສີທອນ",
    "readyForCharging": true
  }
}
```

---

#### Charging Sessions

| Method | Endpoint | Auth | คำอธิบาย |
|--------|----------|------|---------|
| `GET` | `/charging-sessions` | JWT | ประวัติ charging sessions (pagination, filter status) |
| `POST` | `/charging-sessions/start` | JWT | เริ่มชาร์จ (stationId, chargerId, connectorId, vehicleId) |
| `POST` | `/charging-sessions/:id/stop` | JWT | หยุดชาร์จ |
| `GET` | `/charging-sessions/:id` | JWT | รายละเอียด session |
| `GET` | `/charging-sessions/:id/live` | JWT | **สถานะ Live** (อ่านจาก Redis: meter, cost, online status) |
| `GET` | `/charging-sessions/stats` | JWT | สถิติการชาร์จ (7d/30d/90d) |

**Response: GET /charging-sessions/:id/live**
```json
{
  "data": {
    "sessionId": "uuid",
    "status": "ACTIVE",
    "chargerIdentity": "PANDA-01",
    "connectorId": 1,
    "startedAt": "2026-03-24T10:00:00+07:00",
    "durationMinutes": 25,
    "meterStartWh": 1000,
    "currentMeterWh": 8500,
    "energyKwh": 7.5,
    "pricePerKwh": 1000,
    "estimatedCost": 7500,
    "meterUpdatedAt": "2026-03-24T10:25:00+07:00",
    "chargerOnline": true
  }
}
```

**Request: POST /charging-sessions/start**
```json
{
  "stationId": "station-uuid",
  "chargerId": "charger-uuid",
  "connectorId": 1,
  "vehicleId": "vehicle-uuid"
}
```

---

#### Stations (Mobile — Read-Only จาก Admin DB)

| Method | Endpoint | Auth | คำอธิบาย |
|--------|----------|------|---------|
| `GET` | `/stations` | Public | รายการสถานี (pagination, filter) |
| `GET` | `/stations/map` | Public | สถานีสำหรับแผนที่ (lat/lon/radius) |
| `GET` | `/stations/nearby` | Public | สถานีใกล้เคียง (lat, lon, radius km) |
| `GET` | `/stations/:id` | Public | รายละเอียดสถานี + ราคา |
| `GET` | `/stations/:id/chargers/status` | Public | **สถานะ Live ของ chargers** ในสถานี (Redis) |

**Response: GET /stations/:id/chargers/status**
```json
{
  "data": [
    {
      "id": "uuid",
      "displayName": "Panda-01",
      "ocppIdentity": "PANDA-01",
      "status": "ONLINE",
      "connectorCount": 2,
      "liveStatus": "CHARGING",
      "liveUpdatedAt": "2026-03-24T10:25:00+07:00",
      "isOnline": true
    }
  ]
}
```

---

#### Favorites, Payment Methods & Invoices

| Method | Endpoint | Auth | คำอธิบาย |
|--------|----------|------|---------|
| `GET` | `/favorites` | JWT | รายการสถานีโปรด |
| `POST` | `/favorites` | JWT | เพิ่มสถานีโปรด (stationId, stationName) |
| `DELETE` | `/favorites/:id` | JWT | ลบสถานีโปรด |
| `GET` | `/payment-methods` | JWT | วิธีการชำระเงินที่บันทึกไว้ |
| `POST` | `/payment-methods` | JWT | เพิ่มวิธีชำระเงิน |
| `PUT` | `/payment-methods/:id` | JWT | แก้ไข (isDefault) |
| `DELETE` | `/payment-methods/:id` | JWT | ลบ |
| `GET` | `/invoices` | JWT | รายการใบแจ้งหนี้ |
| `GET` | `/invoices/:id` | JWT | รายละเอียดใบแจ้งหนี้ |

**PaymentMethodType:** `BCEL_ONLINE`, `JDB_ONLINE`, `UNITEL_MONEY`, `MMONEY`, `ONEPAY`, `BANK_TRANSFER`

---

#### Financial, Content & Misc

| Method | Endpoint | Auth | คำอธิบาย |
|--------|----------|------|---------|
| `GET` | `/financial/history` | JWT | ประวัติรายรับรายจ่ายรวม (wallet + charging) |
| `GET` | `/financial/stats` | JWT | สถิติรายเดือน (กราฟ) |
| `GET` | `/financial/export` | JWT | Export CSV |
| `POST` | `/notifications/fcm-token` | JWT | ลงทะเบียน FCM Token ของ device |
| `GET` | `/notifications` | JWT | รายการ notification ที่ได้รับ |
| `GET` | `/content/banners` | Public | ดึง banners จาก Admin DB (cached 30 min) |
| `GET` | `/content/:slug` | Public | เนื้อหา CMS (policy, manual, FAQ) |
| `GET` | `/app-config` | JWT | ค่าตั้ง runtime (public configs) |
| `GET` | `/enums` | Public | รายการ enums สำหรับ dropdown |
| `GET` | `/health` | Public | Liveness probe |

---

### 2.3 OCPP CSMS — Port 4002

**ไม่มี REST API** — ทำงานเฉพาะผ่าน WebSocket เท่านั้น

**WebSocket URL:** `ws://localhost:4002/ocpp/{chargeBoxIdentity}`
**Subprotocol:** `ocpp1.6`
**HTTP API สำหรับ Virtual Charger:** `POST http://localhost:9999/execute` (VCP simulator เท่านั้น)

#### OCPP 1.6J Actions ที่รองรับ (27 actions ครบ 100%)

**Inbound (Charger → CSMS):**

| Action | Handler | ผลลัพธ์ DB | Redis | RabbitMQ Event |
|--------|---------|-----------|-------|----------------|
| `BootNotification` | `handleBootNotification` | Charger.status=ONLINE | `charger_status:{id}` | `charger.booted` |
| `StatusNotification` | `handleStatusNotification` | Charger/Connector.status | `charger_status`, `connector_status` | `charger.status_changed`, `connector.status_changed` |
| `Heartbeat` | `handleHeartbeat` | Charger.lastHeartbeat | — | `charger.heartbeat` |
| `Authorize` | `handleAuthorize` | — (validate idTag) | — | — |
| `StartTransaction` | `handleStartTransaction` | Transaction ACTIVE | ลบ session:pending | `transaction.started` |
| `StopTransaction` | `handleStopTransaction` | Transaction COMPLETED | — | `transaction.stopped` |
| `MeterValues` | `handleMeterValues` | — | `charging:live:{id}:{cid}` | — |
| `DataTransfer` | `handleDataTransfer` | Log | — | — |
| `DiagnosticsStatusNotification` | `handleDiagnosticsStatus` | Log | — | — |
| `FirmwareStatusNotification` | `handleFirmwareStatus` | Charger.firmwareVersion (ถ้า Installed) | — | — |

**Outbound (CSMS → Charger):**

| Command | Trigger | ความสำคัญ |
|---------|---------|----------|
| `RemoteStartTransaction` | `session.start` จาก Mobile | await response (15s timeout) |
| `RemoteStopTransaction` | `session.stop` จาก Mobile | fire-and-forget |
| `Reset` | Admin Command | Hard/Soft reboot |
| `ClearCache` | Admin Command | ล้าง Authorization Cache |
| `UnlockConnector` | Admin Command | Unlock connector ที่ติด |
| `ChangeAvailability` | Admin Command | Operative/Inoperative |
| `GetConfiguration` | Admin Command | อ่าน config key list |
| `ChangeConfiguration` | Admin Command | set config key=value |
| `TriggerMessage` | Admin Command | สั่ง charger ส่ง message |
| `ReserveNow` | Admin Command | จอง connector |
| `CancelReservation` | Admin Command | ยกเลิกจอง |
| `GetLocalListVersion` | Admin Command | version ของ local list |
| `SendLocalList` | Admin Command | ส่ง authorization list |
| `SetChargingProfile` | Admin Command | กำหนด charging profile |
| `ClearChargingProfile` | Admin Command | ลบ charging profile |
| `GetCompositeSchedule` | Admin Command | อ่าน schedule |
| `GetDiagnostics` | Admin Command | ดึง diagnostics file |
| `UpdateFirmware` | Admin Command | อัปเดต firmware |

#### OCPP Energy Unit Standard

- ค่าพลังงานทั้งหมดเก็บในหน่วย **Wh (Watt-hour, integer)**
- การแปลงเข้า: `kWh × 1000 → Wh` (normalise ตอน handleMeterValues)
- การคิดเงิน: `energyKwh = (meterStop − meterStart) / 1000`

---

### 2.4 Notification Service — Port 5001

**Base URL:** `http://localhost:5001/api/notification/v1`
**Swagger UI:** `GET http://localhost:5001/api/notification/docs`
**WebSocket:** `ws://localhost:5001` path `/socket.io`, namespace `/admin-stats`

#### REST Endpoints

| Method | Endpoint | Auth | คำอธิบาย |
|--------|----------|------|---------|
| `GET` | `/templates` | Service JWT | รายการ Notification Templates |
| `POST` | `/templates` | Service JWT | สร้าง Template ใหม่ (3 ภาษา) |
| `GET` | `/templates/:id` | Service JWT | รายละเอียด Template |
| `PUT` | `/templates/:id` | Service JWT | แก้ไข Template |
| `DELETE` | `/templates/:id` | Service JWT | ลบ Template |
| `GET` | `/logs` | Service JWT | ประวัติ notification (filter userId, status) |
| `GET` | `/stats/daily` | Service JWT | สถิติรายวัน (type, channel) |
| `GET` | `/stats/station-hourly` | Service JWT | สถิติ hourly ต่อสถานี |
| `GET` | `/stats/station-daily` | Service JWT | สถิติ daily ต่อสถานี |
| `GET` | `/health` | Public | Liveness probe |

#### Notification Processing Pipeline

เมื่อ Mobile/Admin publish ไปที่ `PANDA_EV_NOTIFICATIONS` queue:

```
รับ Message → ตรวจสอบ routingKey
  ↓
[notification.targeted]   → ข้าม dedup
[notification.session]    → Dedup check (Redis NX key)
[notification.broadcast]  → ข้าม dedup
[notification.overstay_reminder] → ตรวจสอบ notifyAt delay
  ↓
Rate Limit check (sliding window)
  ↓
FCM send (multicast ไปทุก fcmTokens[])
  ↓
DB log (NotificationLog record) — soft fail
  ↓
Aggregation UPSERT (notification_daily_stats) — soft fail
  ↓
WebSocket emit → /admin-stats → event: notification:sent
```

#### WebSocket Events (/admin-stats)

| Event | Trigger | Payload |
|-------|---------|---------|
| `notification:sent` | หลัง FCM delivery attempt | `{ type, userId, stationId, chargerIdentity, status, sentAt }` |
| `session:live_update` | OCPP `transaction.started/stopped` | OCPP event payload + `event` field |
| `stats:hourly_updated` | หลัง aggregation UPSERT | `{ stationId, stationName, hour, sessionsStarted, totalEnergyKwh, ... }` |
| `system:alert` | Errors / DLQ overflow | `{ level, message, data }` |

#### RabbitMQ Message Format

**notification.session:**
```json
{
  "routingKey": "notification.session",
  "userId": "uuid",
  "sessionId": "uuid",
  "type": "charging_started",
  "fcmTokens": ["token1", "token2"],
  "title": "เริ่มชาร์จแล้ว",
  "body": "กำลังชาร์จที่สถานี Panda Central",
  "priority": "HIGH",
  "chargerIdentity": "PANDA-01",
  "stationId": "uuid"
}
```

> **สำคัญ:** FCM tokens ส่งมาใน message payload — Notification Service ไม่ lookup tokens จาก DB เอง

---

## 3. โครงสร้างฐานข้อมูลและโมเดลข้อมูล

### 3.1 panda_ev_system (Admin DB)

**ตาราง: 20+ ตาราง | Enum: 14 ประเภท**

#### กลุ่ม IAM

| ตาราง | คำอธิบาย | Primary Key | ความสัมพันธ์หลัก |
|-------|---------|-------------|----------------|
| `users` | Admin/Staff accounts | UUID | UserRole[], UserGroup[] |
| `roles` | Role definitions | UUID | RolePermission[], UserRole[] |
| `permissions` | Atomic permission slugs | UUID | RolePermission[], GroupPermission[] |
| `groups` | Organizational units | UUID | GroupRole[], UserGroup[] |
| `user_roles` | User ↔ Role junction | (userId, roleId) | — |
| `user_groups` | User ↔ Group junction | (userId, groupId) | — |
| `group_roles` | Group ↔ Role junction | (groupId, roleId) | — |
| `role_permissions` | Role ↔ Permission junction | (roleId, permId) | — |
| `group_permissions` | Group ↔ Permission junction | (groupId, permId) | — |

**Permission Format:** `{resource}:{action}` เช่น `stations:create`, `pricing-tiers:manage`
**90 Permissions** ใน 9 modules: iam, cms, news, notifications, stations, pricing, audit, system, mobile-users

#### กลุ่ม CMS

| ตาราง | คำอธิบาย | Fields หลัก |
|-------|---------|------------|
| `banners` | โฆษณา/แบนเนอร์ | title, imageUrl(GCS), position, sortOrder, isActive, startsAt, endsAt |
| `news_articles` | บทความข่าว | title, slug(unique), content(HTML), status(DRAFT/PUBLISHED), viewCount, isPinned, tags[] |
| `notifications` | FCM broadcast history | title, body, channel, topic, status, successCount, failureCount, fcmMessageId |
| `notification_users` | FCM recipient tracking | (notificationId, userId), fcmToken, isRead, readAt |

#### กลุ่ม Station

| ตาราง | คำอธิบาย | Fields หลัก |
|-------|---------|------------|
| `stations` | สถานีชาร์จ | name, address, lat/lon, openTime/closeTime, status, provinceId, cityId |
| `station_images` | รูปภาพสถานี | imageUrl(GCS), caption, sortOrder, isPrimary |
| `amenities` | สิ่งอำนวยความสะดวก | name, slug, icon |
| `station_amenities` | Station ↔ Amenity junction | (stationId, amenityId) |
| `station_promotions` | โปรโมชันของสถานี | title, description, imageUrl, startsAt, endsAt |
| `chargers` | ตู้ชาร์จ | ocppIdentity(unique), displayName, status, firmwareVersion, hardware specs (7 fields) |
| `connectors` | หัวเสียบชาร์จ | connectorId(int), plugType, connectorType, powerOutputKw, status |

**Charger Hardware Specs:** model, serialNumber, inputVoltageRange, outputVoltageRange, maxCurrentA, efficiencyPct, ipRating

#### กลุ่ม Pricing

| ตาราง | คำอธิบาย | Fields หลัก |
|-------|---------|------------|
| `pricing_tiers` | แผนราคาชาร์จ | type, ratePerKwh, ratePerMin, plugType, enableUnplugFee, unplugFeeAmount, enableParkingFee, parkingFeePerMinute, parkingFreeMinutes, startTime, endTime, daysOfWeek[] |
| `station_pricings` | Station ↔ Tier link | stationId, pricingId, priority, effectiveAt, expiresAt |
| `promotions` | ส่วนลด | discountType, discountValue, validFrom, validTo, userSegment, maxUsesPerUser |

#### กลุ่มอื่น

| ตาราง | คำอธิบาย |
|-------|---------|
| `audit_logs` | Immutable trail (action, resource, old/newValues, ipAddress, userAgent) |
| `system_settings` | Key-value config (isPublic controls mobile exposure) |
| `regions` / `provinces` / `cities` | ลำดับชั้นภูมิศาสตร์ลาว |
| `mobile_user_profiles` | Mirror ผู้ใช้ mobile (sync via RabbitMQ, conflict on mobile_user_id) |
| `legal_contents` | นโยบาย/คู่มือ/FAQ (type: POLICY/MANUAL/FAQ) |

---

### 3.2 panda_ev_core (Mobile DB)

**ตาราง: 12 ตาราง | Enum: 8 ประเภท**

| ตาราง | คำอธิบาย | Fields หลัก |
|-------|---------|------------|
| `mobile_users` | บัญชีผู้ใช้ mobile | phoneNumber, email(unique), passwordHash, status(default: PENDING_VERIFICATION), acceptedTermsAt |
| `vehicles` | ยานยนต์ EV | brand, model, plugType, plateNumber, isDefault |
| `audit_logs` | Audit trail ของ mobile user | action(enum), resource, metadata |
| `user_devices` | FCM tokens หลายอุปกรณ์ | fcmToken(unique), platform |
| `wallets` | กระเป๋าเงิน | balance(Decimal 14.2), memberId(PV-XXXX) |
| `wallet_transactions` | รายการเดบิต/เครดิต | type(TOPUP/CHARGE/REFUND/ADJUSTMENT), amount, balanceAfter, referenceId |
| `charging_sessions` | Session การชาร์จ | ocppTransactionId(unique), pricePerKwh, energyKwh, amount, startedAt, endedAt |
| `favorite_stations` | สถานีโปรด | stationId(VarChar ไม่ใช่ UUID), stationName |
| `payment_methods` | วิธีชำระเงิน | type(BCEL/JDB/UNITEL/MMONEY/ONEPAY/BANK_TRANSFER), label, accountNumber(masked) |
| `payments` | การชำระเงินจาก gateway | referenceId(gateway ref), gatewayResponse(JSON), walletTxnId |
| `app_configs` | Runtime configs | key(PK), value, description |
| `invoices` | ใบแจ้งหนี้ | invoiceNumber(INV-YYYYMMDD-XXXX), subtotal, taxRate, taxAmount, total, status |

**หมายเหตุ:** `ChargingSession.stationId` และ `FavoriteStation.stationId` เป็น `VarChar(150)` ไม่ใช่ UUID FK — เพราะ cross-DB reference

---

### 3.3 panda_ev_ocpp (OCPP DB)

**ตาราง: 4 ตาราง | Enum: 6 ประเภท**

| ตาราง | คำอธิบาย | Fields หลัก |
|-------|---------|------------|
| `chargers` | ตู้ชาร์จ (mirror จาก admin) | ocppIdentity(unique), status, lastHeartbeat, firmwareVersion |
| `connectors` | หัวเสียบ | connectorId(int), plugType, status, lastMeterValue, currentTransactionId |
| `transactions` | OCPP Transaction | ocppTransactionId(autoincrement=OCPP txId), idTag, meterStart, meterStop, stopReason, mobileUserId |
| `ocpp_logs` | OCPP message log | identity, direction(INCOMING/OUTGOING), action, messageId, payload(JSON) |

**สำคัญ:** `Transaction.ocppTransactionId` ใช้ `@default(autoincrement())` — integer นี้คือค่าที่ส่งกลับให้ charger เป็น OCPP `transactionId`

---

### 3.4 panda_ev_notifications (Notification DB)

**ตาราง: 6 ตาราง | Enum: 3 ประเภท**

| ตาราง | คำอธิบาย | Fields หลัก |
|-------|---------|------------|
| `notification_templates` | Template 3 ภาษา | slug(unique), channel, titleLo/titleEn/titleZh, bodyLo/bodyEn/bodyZh, deepLinkPath, actionButtons(JSON) |
| `notification_logs` | บันทึกการส่งทุกครั้ง | userId, sessionId, type, status, fcmMessageId, retryCount, sentAt, deliveredAt, readAt, clickedAt |
| `user_notification_preferences` | การตั้งค่า notification ต่อ user | fcmTokens[], language, batteryAlerts, sessionAlerts, overstayAlerts, quietHoursStart/End |
| `station_hourly_stats` | สถิติ hourly ต่อสถานี | (stationId, hour) unique, sessionsStarted, energyKwh, revenueLak |
| `station_daily_stats` | สถิติ daily ต่อสถานี | (stationId, date) unique, completedSessions, avgSessionMinutes, peakConcurrent, avgOverstayMinutes |
| `notification_daily_stats` | สถิติ daily ต่อ type+channel | (date, type, channel) unique, totalSent, delivered, read, clicked, failed |

**NotificationStatus flow:** `PENDING` → `SENT` → `DELIVERED` → `READ` → `CLICKED` (หรือ `FAILED`/`SUPPRESSED`)

---

### 3.5 Entity Relationship Diagram (ภาพรวม Cross-Service)

```
panda_ev_system                    panda_ev_core
─────────────────                  ─────────────
stations ─────────────────────────► charging_sessions (stationId: VarChar)
pricing_tiers                         │
  └─ station_pricings                 │ (Mobile API อ่าน tier ผ่าน SystemDbService)
                                      │
panda_ev_ocpp                         │
─────────────                      wallet_transactions
chargers ──────────────────────────► (chargerIdentity: VarChar in Redis)
transactions
  └─ (ocppTransactionId) ──────────► charging_sessions.ocppTransactionId

panda_ev_notifications (standalone)
─────────────────────────
notification_logs ←─ (userId: VarChar, ไม่มี FK ข้าม DB)
station_hourly/daily_stats ←─ (stationId: VarChar)
```

---

## 4. การตรวจสอบความปลอดภัยและประสิทธิภาพ

### 4.1 การตรวจสอบความปลอดภัย (Security Audit)

#### ✅ จุดแข็งด้านความปลอดภัยที่มีอยู่แล้ว

| ด้าน | สิ่งที่ทำได้ดี |
|------|--------------|
| JWT | RS256 asymmetric signing แทน HS256 symmetric — key rotation ทำได้โดยไม่ต้องแชร์ secret |
| Service Auth | RS256 inter-service tokens (30s TTL) + Redis jti blacklist ป้องกัน replay attack |
| Permission | RBAC granular ระดับ resource:action (90 permissions), permissions ตรวจสอบจาก DB ทุก request |
| Soft Delete | ไม่มี hard delete — ข้อมูลสามารถ recover ได้ |
| Audit Trail | Immutable audit log ทั้ง Admin และ Mobile บันทึก old/newValues, ip, userAgent |
| Input Validation | ValidationPipe พร้อม whitelist + transform ทุก endpoint |
| OCPP Auth | Support Security Profile 1 (HTTP Basic Auth) ผ่าน Redis หรือ API Key service |
| Password | bcrypt hashing (implied จาก `passwordHash` field) |

#### ⚠️ จุดที่ควรปรับปรุง

**1. ไม่มี Rate Limiting บน REST Endpoints**
- **ความเสี่ยง:** Brute force attack บน `/auth/login`, `/auth/verify-otp`, `/auth/forgot-password`
- **แนวทางแก้ไข:** เพิ่ม `@nestjs/throttler` หรือ Redis sliding window rate limiter สำหรับ auth endpoints
- **ความสำคัญ:** สูง 🔴

```typescript
// ตัวอย่างการเพิ่ม rate limit
@Throttle({ default: { limit: 5, ttl: 60000 } })
@Post('auth/login')
async login() { ... }
```

**2. Wallet Top-up ไม่มี Payment Gateway Integration จริง**
- **ความเสี่ยง:** ปัจจุบัน `POST /wallet/topup` เพิ่มเงินได้ทันทีโดยไม่ผ่าน payment gateway — ถ้า endpoint นี้เรียกได้โดยตรง จะเป็น critical vulnerability
- **แนวทางแก้ไข:** Wallet topup ควรผ่าน Payment module (BCEL, JDB ฯลฯ) และ verify callback จาก gateway ก่อน
- **ความสำคัญ:** สูงมาก 🔴🔴

**3. OCPP WebSocket ไม่มี TLS บน Production**
- **ความเสี่ยง:** OCPP messages ส่งผ่าน plain WebSocket `ws://` — ข้อมูลถูก intercept ได้
- **แนวทางแก้ไข:** ใช้ `wss://` (TLS) ใน production — environment variables `TLS_CERT_PATH`/`TLS_KEY_PATH` มีไว้แล้ว แต่ต้องเปิดใช้งาน
- **ความสำคัญ:** สูง 🔴

**4. Cross-Service Authorization ไม่สมบูรณ์ใน Notification Service**
- **ความเสี่ยง:** ใครก็ได้ที่มี service JWT สามารถ publish notification ได้ — ไม่มี validation ว่า userId ที่ระบุมีอยู่จริง
- **แนวทางแก้ไข:** ตรวจสอบ userId ใน message payload ก่อนส่ง FCM (หรือ document ชัดเจนว่า Mobile service รับผิดชอบ validation)
- **ความสำคัญ:** ปานกลาง 🟡

**5. Private Keys ใน `keys/` Directory**
- **ความเสี่ยง:** ถ้า `.gitignore` ไม่ครอบคลุม หรือ Docker image build รวม `keys/` เข้าไป
- **แนวทางแก้ไข:** ใช้ Option B (base64 K8s Secrets) ใน production — ไม่ mount directory
- **ความสำคัญ:** สูง 🔴 (สำหรับ production)

**6. `SystemDbService` Write แบบ Fire-and-Forget**
- **ความเสี่ยง:** User sync failures ไปยัง Admin DB ไม่มี retry mechanism — ข้อมูลอาจไม่ sync
- **แนวทางแก้ไข:** ส่ง sync events ผ่าน `PANDA_EV_USER_EVENTS` queue (ซึ่งมี durability ของ RabbitMQ) แทนที่จะ write ตรง
- **ความสำคัญ:** ปานกลาง 🟡

**7. OCPP idTag Validation ไม่เข้มงวด**
- **ความเสี่ยง:** `handleAuthorize` อาจ accept idTag ใด ๆ โดยไม่ตรวจสอบ blacklist
- **แนวทางแก้ไข:** ใช้ Local Authorization List + ตรวจสอบกับ Redis/DB
- **ความสำคัญ:** ปานกลาง 🟡

---

### 4.2 การตรวจสอบประสิทธิภาพ (Performance Audit)

#### ✅ จุดแข็งด้านประสิทธิภาพ

| กลไก | ประสิทธิภาพ |
|------|------------|
| Redis Cache | Station data (TTL 2-5 min), App Config (5 min), Content (30 min) ลด DB queries |
| Pre-aggregated Stats | `$executeRaw` UPSERT — ไม่ scan table ทั้งหมดเพื่อคำนวณ |
| Redis State | Billing snapshot อ่านจาก Redis เท่านั้น — ไม่ query DB ขณะชาร์จ |
| Prisma Indexes | ทุก model มี composite indexes ที่เหมาะสม (status+deletedAt, userId+createdAt ฯลฯ) |
| Dedup/RateLimit | Redis NX guard ป้องกัน duplicate FCM — ลด Firebase API calls |

#### ⚠️ จุดที่ควรปรับปรุง

**1. Permissions ถูก Query ทุก Request ใน Admin**
- **ปัญหา:** `JwtStrategy.validate()` โหลด permissions จาก DB ทุกครั้ง (JOIN roles → role_permissions → permissions)
- **แนวทางแก้ไข:** Cache permissions ใน Redis `user:perms:{userId}` (TTL 5 min), invalidate เมื่อ role/permission เปลี่ยน
- **ผลกระทบ:** ลด DB queries ได้ ~60% สำหรับ admin requests

**2. ไม่มี Database Connection Pooling Configuration ชัดเจน**
- **ปัญหา:** Default Prisma pool size อาจไม่เพียงพอภายใต้ load สูง
- **แนวทางแก้ไข:** กำหนด `connection_limit` และ `pool_timeout` ใน `DATABASE_URL` หรือ `prisma.config.ts`

**3. `SystemDbService` ใช้ raw pg Pool — ไม่มี Connection Limit**
- **ปัญหา:** Raw `new Pool()` ใน Mobile API ไม่มี max connections ที่ชัดเจน
- **แนวทางแก้ไข:** กำหนด `max: 5, idleTimeoutMillis: 30000` ใน Pool config

**4. OCPP OcppLog เติบโตไม่จำกัด**
- **ปัญหา:** ทุก OCPP message ถูก log ไว้ใน `ocpp_logs` table — ในระยะยาวจะใหญ่มาก
- **แนวทางแก้ไข:** เพิ่ม partition by date หรือ retention policy (ลบ logs เก่ากว่า 30 วัน)

**5. Notification Aggregation ไม่มี Batch Processing**
- **ปัญหา:** แต่ละ notification ทำ `$executeRaw` UPSERT แยก — ถ้าส่ง 1000 notifications พร้อมกันจะเป็น 1000 DB writes
- **แนวทางแก้ไข:** Buffer events ใน Redis แล้ว batch write ทุก 1 วินาที

---

## 5. คู่มือการทดสอบระบบ

### 5.1 เตรียม Environment สำหรับทดสอบ

```bash
# 1. ตรวจสอบ Infrastructure
docker ps | grep -E "postgres|redis|rabbitmq"

# 2. ตรวจสอบ Health ของแต่ละบริการ
curl http://localhost:3001/health    # Admin
curl http://localhost:4001/health    # Mobile
curl http://localhost:4002           # OCPP (ไม่มี HTTP endpoint)
curl http://localhost:5001/health    # Notification

# 3. ตรวจสอบ Swagger ว่าโหลดได้
open http://localhost:3001/api/admin/docs
open http://localhost:4001/api/mobile/docs
open http://localhost:5001/api/notification/docs
```

---

### 5.2 ทดสอบ Admin Authentication

```bash
# Step 1: Login ด้วย default admin
curl -s -X POST http://localhost:3001/api/admin/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@pandaev.com","password":"Admin@123456"}' | jq .

# Step 2: เก็บ access token
ADMIN_TOKEN=$(curl -s -X POST http://localhost:3001/api/admin/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@pandaev.com","password":"Admin@123456"}' | jq -r .data.accessToken)

# Step 3: ดึงรายการ users
curl -s -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3001/api/admin/v1/users | jq .data.data[0]

# Step 4: ดึง permissions ทั้งหมด
curl -s -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3001/api/admin/v1/permissions | jq '.data.meta'
# Expected: total: 90
```

---

### 5.3 ทดสอบ Mobile Authentication Flow

```bash
# Step 1: Register
curl -s -X POST http://localhost:4001/api/mobile/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@pandaev.com",
    "phoneNumber": "+85620123456",
    "password": "Test@123456",
    "firstName": "ທົດສອບ",
    "lastName": "ລະບົບ",
    "acceptedTerms": true
  }' | jq .

# Step 2: ดึง OTP จาก Redis (local dev)
docker exec redis redis-cli get "otp:test@pandaev.com"

# Step 3: Verify OTP
curl -s -X POST http://localhost:4001/api/mobile/v1/auth/verify-otp \
  -H "Content-Type: application/json" \
  -d '{"email":"test@pandaev.com","otp":"123456"}' | jq .

# Step 4: Login
MOBILE_TOKEN=$(curl -s -X POST http://localhost:4001/api/mobile/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@pandaev.com","password":"Test@123456"}' | jq -r .data.accessToken)

# Step 5: ดู Profile
curl -s -H "Authorization: Bearer $MOBILE_TOKEN" \
  http://localhost:4001/api/mobile/v1/profile | jq .data
```

---

### 5.4 ทดสอบ Wallet Flow

```bash
# Step 1: ดู wallet (lazy-create ครั้งแรก)
curl -s -H "Authorization: Bearer $MOBILE_TOKEN" \
  http://localhost:4001/api/mobile/v1/wallet | jq .data
# Expected: balance: 0, memberId: "PV-XXXX"

# Step 2: เติมเงิน 50,000 LAK
curl -s -X POST http://localhost:4001/api/mobile/v1/wallet/topup \
  -H "Authorization: Bearer $MOBILE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"amount":50000,"description":"ทดสอบเติมเงิน"}' | jq .

# Step 3: ตรวจสอบยอดเงิน
curl -s -H "Authorization: Bearer $MOBILE_TOKEN" \
  http://localhost:4001/api/mobile/v1/wallet | jq .data.balance
# Expected: 50000

# Step 4: ดูประวัติ transaction
curl -s -H "Authorization: Bearer $MOBILE_TOKEN" \
  http://localhost:4001/api/mobile/v1/wallet/transactions | jq '.data.data[0]'
```

---

### 5.5 ทดสอบ OCPP Connection กับ Virtual Charger

```bash
# ต้องรัน Virtual Charge Point (VCP) simulator
cd ocpp-virtual-charge-point
npm start index_16.ts  # port 9999 (admin HTTP) + WS connects to 4002

# Step 1: ดูสถานะ charger ใน Redis
docker exec redis redis-cli get "charger_status:PANDA-01"
# Expected: {"status":"ONLINE","identity":"PANDA-01","updatedAt":"..."}

# Step 2: ตรวจสอบว่า Charger อยู่ใน Admin DB
curl -s -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3001/api/admin/v1/chargers/dashboard | jq '.data.data[0]'

# Step 3: ดูสถานะ Live ของ chargers ในสถานี (Mobile API)
STATION_ID="your-station-uuid-here"
curl -s http://localhost:4001/api/mobile/v1/stations/$STATION_ID/chargers/status | jq .
```

---

### 5.6 ทดสอบ Full Charging Session Flow

```bash
# ต้องมี: wallet > 0, charger ONLINE, VCP simulator running

# Step 1: เพิ่ม vehicle
VEHICLE_ID=$(curl -s -X POST http://localhost:4001/api/mobile/v1/vehicles \
  -H "Authorization: Bearer $MOBILE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"brand":"BYD","model":"Atto 3","plugType":"CCS2","plateNumber":"1-KH-1234"}' \
  | jq -r .data.id)

# Step 2: เริ่มชาร์จ
SESSION_ID=$(curl -s -X POST http://localhost:4001/api/mobile/v1/charging-sessions/start \
  -H "Authorization: Bearer $MOBILE_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"stationId\":\"$STATION_ID\",\"chargerId\":\"$CHARGER_ID\",\"connectorId\":1,\"vehicleId\":\"$VEHICLE_ID\"}" \
  | jq -r .data.sessionId)

echo "Session ID: $SESSION_ID"

# Step 3: ดูสถานะ Live (อัปเดตทุก 30 วินาที ตาม MeterValues interval)
curl -s -H "Authorization: Bearer $MOBILE_TOKEN" \
  http://localhost:4001/api/mobile/v1/charging-sessions/$SESSION_ID/live | jq .data

# Step 4: VCP จะส่ง MeterValues อัตโนมัติ — รอ 30 วินาทีแล้วตรวจสอบ Redis
docker exec redis redis-cli get "charging:live:PANDA-01:1"

# Step 5: หยุดชาร์จ
curl -s -X POST http://localhost:4001/api/mobile/v1/charging-sessions/$SESSION_ID/stop \
  -H "Authorization: Bearer $MOBILE_TOKEN" | jq .

# Step 6: ตรวจสอบ invoice
curl -s -H "Authorization: Bearer $MOBILE_TOKEN" \
  "http://localhost:4001/api/mobile/v1/invoices?limit=1" | jq '.data.data[0]'
```

---

### 5.7 ทดสอบ OCPP Admin Commands

```bash
# Step 1: Soft Reset charger
CHARGER_DB_ID="charger-uuid-in-admin-db"
curl -s -X POST "http://localhost:3001/api/admin/v1/chargers/$CHARGER_DB_ID/commands/reset" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"type":"Soft"}' | jq .

# เก็บ commandId
COMMAND_ID=$(curl -s -X POST "http://localhost:3001/api/admin/v1/chargers/$CHARGER_DB_ID/commands/reset" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"type":"Soft"}' | jq -r .data.commandId)

# Step 2: Poll ผลลัพธ์ (TTL 90 วินาที)
curl -s -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3001/api/admin/v1/chargers/$CHARGER_DB_ID/commands/$COMMAND_ID/result" | jq .

# Step 3: ดู Configuration ของ charger
curl -s -X POST "http://localhost:3001/api/admin/v1/chargers/$CHARGER_DB_ID/commands/get-configuration" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"keys":[]}' | jq .
```

---

### 5.8 ทดสอบ Notification Service

```bash
# Step 1: ดูสถานะ notification service
curl http://localhost:5001/health | jq .

# Step 2: ดู templates ที่ seed ไว้
curl -s http://localhost:5001/api/notification/v1/templates | jq '.data.data | length'
# Expected: 11 templates

# Step 3: Connect WebSocket admin-stats (ใช้ wscat หรือ socket.io-client)
# npm install -g wscat
# wscat -c "ws://localhost:5001/socket.io/?EIO=4&transport=websocket" --namespace /admin-stats

# Step 4: ตรวจสอบ daily stats
curl -s http://localhost:5001/api/notification/v1/stats/daily | jq .
```

---

### 5.9 ทดสอบ Unit Tests

```bash
# Admin service
cd panda-ev-csms-system-admin
npm test                    # ทุก unit tests
npx jest --testPathPattern=iam    # เฉพาะ IAM module
npx jest --coverage         # พร้อม coverage report

# Mobile service
cd panda-ev-client-mobile
npm test
npx jest src/modules/charging-session/ocpp-consumer.integration.spec.ts
# Expected: 151 tests pass

# OCPP service
cd panda-ev-ocpp
npm test

# Notification service
cd panda-ev-notification
npm test
npx jest src/modules/notification/notification.processor.spec.ts
```

---

### 5.10 สถานการณ์ทดสอบกรณีพิเศษ (Edge Cases)

**กรณี: Charger Offline ระหว่างชาร์จ**
```
1. เริ่ม charging session
2. ปิด VCP simulator (simulate charger disconnect)
3. ตรวจสอบ Redis: charger_status:PANDA-01 → OFFLINE
4. Mobile API ควรส่ง FCM "Charger Offline" notification
5. Session ยังคง ACTIVE ใน DB รอ charger กลับมา online
```

**กรณี: Wallet ไม่พอ**
```
1. ตั้ง wallet balance = 0
2. พยายามเริ่มชาร์จ
3. Expected: HTTP 402 Payment Required + i18n error message
```

**กรณี: Double Start (race condition)**
```
1. เริ่ม session จาก device A
2. พยายามเริ่ม session จาก device B (same user, same charger)
3. Expected: Conflict error — charging:charger:{identity} Redis key ป้องกัน
```

**กรณี: OCPP Command Timeout**
```
1. ปิด VCP simulator
2. ส่ง Admin Command (reset)
3. รอ 90 วินาที
4. GET /commands/:commandId/result
5. Expected: 404 (key หมดอายุ) หรือ timeout error
```

---

## 6. ฟีเจอร์ที่ยังขาดและแผนพัฒนา

### 6.1 Critical — ต้องทำก่อน Production

| รายการ | ความสำคัญ | หมายเหตุ |
|--------|----------|---------|
| **Payment Gateway Integration** (BCEL, JDB) | 🔴 Critical | ปัจจุบัน topup ไม่ผ่าน gateway จริง — เสี่ยง fraud |
| **Rate Limiting บน Auth Endpoints** | 🔴 Critical | Brute force protection |
| **TLS สำหรับ OCPP WebSocket** | 🔴 Critical | `wss://` ใน production |
| **Apply Notification DB Migration** | 🔴 Critical | Migration SQL ยังไม่ถูก apply |
| **Wire Mobile → PANDA_EV_NOTIFICATIONS** | 🔴 Critical | FCM ยังส่งตรงจาก Mobile ไม่ผ่าน Notification service |

### 6.2 High Priority — ควรทำใน Sprint ถัดไป

| รายการ | ความสำคัญ | หมายเหตุ |
|--------|----------|---------|
| **Permission Caching** ใน Admin | 🟠 High | ลด DB queries ต่อ request |
| **OCPP Log Retention Policy** | 🟠 High | Purge logs เก่ากว่า 30 วัน |
| **Notification Templates Seed** | 🟠 High | `npx ts-node prisma/seed/seed-templates.ts` |
| **Mobile Push Notification History** | 🟠 High | ผู้ใช้ดูประวัติ notification ใน app |
| **Station Search by Location (Mobile)** | 🟠 High | ค้นหาสถานีใกล้เคียงด้วย GPS |
| **Invoice PDF Generation** | 🟠 High | ออก PDF ใบเสร็จ |

### 6.3 Medium Priority

| รายการ | คำอธิบาย |
|--------|---------|
| **Admin Dashboard Real-time Statistics** | เชื่อม WebSocket `/admin-stats` กับ Admin Portal frontend |
| **Charging Session Statistics for Admin** | สรุปรายได้/พลังงาน ต่อสถานี ต่อวัน |
| **Overstay Notification** | ส่ง push แจ้งผู้ใช้ก่อน parking fee เริ่มคิด |
| **Vehicle Brand/Model Database** | Dropdown แบรนด์รถ EV สำหรับ Laos market |
| **Multi-language Station Description** | เพิ่ม field สำหรับ lo/en/zh ใน Station model |
| **OCPP 2.0.1 Support** | VCP simulator รองรับแล้ว — ต้องอัปเกรด CSMS |
| **User Tier / Loyalty Points** | ระบบสะสมคะแนนสำหรับ EV community |
| **Admin Mobile App** | App สำหรับดูสถานี + real-time status บน mobile |

### 6.4 Technical Debt

| รายการ | คำอธิบาย |
|--------|---------|
| **Regenerate Migration SQL** | Migration SQL ของ Notification service ใช้ camelCase column ขณะที่ Prisma schema อัปเดตเป็น snake_case แล้ว — ต้อง regenerate |
| **SystemDbService Sync via Queue** | ย้าย user/vehicle sync จาก fire-and-forget direct DB write ไปใช้ RabbitMQ queue |
| **OCPP Error Handling Standardization** | บาง handler ส่งคืน `{status: "Accepted"}` โดยไม่ validate payload ก่อน |
| **Prisma Client Regeneration** | หลัง apply notification migration ต้อง `npx prisma generate` ใน `panda-ev-notification/` |
| **Docker Image for Notification Service** | ยังไม่มี Dockerfile |

### 6.5 Migration Checklist (Pending Actions)

```bash
# 1. Apply notification database migration
cd panda-ev-notification
psql "$DATABASE_URL" < prisma/migrations/20260322000001_init_notifications/migration.sql
npx prisma migrate resolve --applied 20260322000001_init_notifications
npx prisma generate

# 2. Seed notification templates
npx ts-node prisma/seed/seed-templates.ts

# 3. Wire Mobile → PANDA_EV_NOTIFICATIONS queue
# แก้ไขใน: panda-ev-client-mobile/src/modules/charging-session/ocpp-consumer.service.ts
# เปลี่ยน: this.fcm.sendToUser(userId, {...})
# เป็น: this.rabbitMQ.publish('PANDA_EV_NOTIFICATIONS', notificationPayload)
```

---

## ภาคผนวก

### A. Environment Variables Checklist (ต้องตั้งค่าก่อน Deploy)

**Admin CSMS:**
```env
DATABASE_URL=postgresql://...?schema=panda_ev_system
REDIS_URL=redis://...
RABBITMQ_URL=amqp://...
PORT=3001
JWT_SECRET=<strong-random-64-chars>
JWT_PRIVATE_KEY=<base64-rs256-private-key>
JWT_PUBLIC_KEY=<base64-rs256-public-key>
SERVICE_NAME=admin-api
SERVICE_JWT_PRIVATE_KEY=<base64-service-key>
TRUSTED_SERVICE_PUBLIC_KEYS=[{"iss":"mobile-api","key":"..."},{"iss":"ocpp-csms","key":"..."}]
```

**Mobile API:**
```env
DATABASE_URL=postgresql://...?schema=panda_ev_core
SYSTEM_DATABASE_URL=postgresql://...?schema=panda_ev_system
REDIS_URL=redis://...
RABBITMQ_URL=amqp://...
PORT=4001
JWT_SECRET=<same-as-admin>
JWT_PRIVATE_KEY=<base64-rs256-private-key>
JWT_PUBLIC_KEY=<base64-rs256-public-key>
SERVICE_NAME=mobile-api
FIREBASE_PROJECT_ID=panda-ev-firebase
FIREBASE_CLIENT_EMAIL=firebase-adminsdk@...
FIREBASE_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----
```

**OCPP CSMS:**
```env
DATABASE_URL=postgresql://...?schema=panda_ev_ocpp
REDIS_URL=redis://...
RABBITMQ_URL=amqp://...
PORT=4002
SERVICE_NAME=ocpp-csms
OCPP_AUTH_ENABLED=true
```

**Notification Service:**
```env
DATABASE_URL=postgresql://...?schema=panda_ev_notifications
REDIS_URL=redis://...
RABBITMQ_URL=amqp://...
PORT=5001
SERVICE_NAME=notification-service
FIREBASE_PROJECT_ID=...
FIREBASE_CLIENT_EMAIL=...
FIREBASE_PRIVATE_KEY=...
```

---

### B. Seeded Data Summary

| รายการ | จำนวน | Command |
|--------|-------|---------|
| Admin permissions | 90 | `npx prisma db seed` (ใน admin) |
| Admin roles | 3 (super-admin, admin, viewer) | ใน seed |
| Default admin account | `admin@pandaev.com` / `Admin@123456` | ใน seed |
| Vientiane EV Stations | 6 stations (5 ACTIVE + 1 COMING_SOON) | `npx ts-node prisma/seed/seed-stations.ts` |
| PricingTiers | 2 (GBT_STANDARD, CCS2_STANDARD @ 1000 LAK/kWh) | ใน seed-stations |
| Notification templates | 11 trilingual (lo/en/zh) | `npx ts-node prisma/seed/seed-templates.ts` |

---

### C. Key File Locations (Quick Reference)

| วัตถุประสงค์ | Path |
|-------------|------|
| Admin Prisma Schema | `panda-ev-csms-system-admin/prisma/schema.prisma` |
| Mobile Prisma Schema | `panda-ev-client-mobile/prisma/schema.prisma` |
| OCPP Prisma Schema | `panda-ev-ocpp/prisma/schema.prisma` |
| Notification Prisma Schema | `panda-ev-notification/prisma/schema.prisma` |
| Architecture Diagram | `docs/ev-charging-architecture.md` |
| Key Generation Script | `generate-service-keys-local.sh` |
| Admin Notification Migration | `panda-ev-notification/prisma/migrations/20260322000001_init_notifications/migration.sql` |
| Billing Logic (Mobile) | `panda-ev-client-mobile/src/modules/charging-session/ocpp-consumer.service.ts` |
| Session Start + Pricing Snapshot | `panda-ev-client-mobile/src/modules/charging-session/charging-session.service.ts` |
| OCPP Gateway | `panda-ev-ocpp/src/modules/ocpp/ocpp.gateway.ts` |
| Admin Command Controller | `panda-ev-csms-system-admin/src/modules/station/controllers/charger-command.controller.ts` |
| Notification Processor | `panda-ev-notification/src/modules/notification/notification.processor.ts` |

---

*เอกสารนี้จัดทำโดย Claude Code Analysis — อ้างอิงจากโค้ดต้นฉบับและ CLAUDE.md ทุกบริการ ณ วันที่ 2026-03-24*
