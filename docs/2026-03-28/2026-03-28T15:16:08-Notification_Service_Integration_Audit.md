# รายงานการตรวจสอบการผสานรวม Notification Service
**ระบบ:** Panda EV Charging Platform
**วันที่ตรวจสอบ:** 2026-03-28
**ผู้ตรวจสอบ:** Senior System Integration Architect
**เวอร์ชัน:** 1.0

---

## สารบัญ
1. [รายงานสถานะการผสานรวม (Integration Status Report)](#1)
2. [เหตุการณ์ที่ขาดหายและช่องโหว่ (Missing Events & Gaps)](#2)
3. [การตรวจสอบความปลอดภัยและความเสถียร (Security & Reliability Audit)](#3)
4. [มาตรฐานการผสานรวม (Standard Integration Pattern)](#4)
5. [แผนการดำเนินงาน (Action Plan)](#5)
6. [คู่มือการนำ Service ใหม่เข้าระบบ (New Service Onboarding Guide)](#6)

---

## 1. รายงานสถานะการผสานรวม {#1}

### 1.1 ภาพรวมสถาปัตยกรรมปัจจุบัน

```
┌──────────────────────────────────────────────────────────────────┐
│                        Current Architecture                        │
│                                                                    │
│  Mobile API ──FCM direct──► Firebase (bypass Notification Svc)    │
│      │                                                             │
│      └──► PANDA_EV_CSMS_COMMANDS ──► OCPP Service                │
│                                           │                        │
│  OCPP Service ──────────► PANDA_EV_QUEUE ─┼──► Mobile (consume)  │
│                                           └──► Notification (consume aggregate) │
│                                                                    │
│  Admin (CSMS) ──► message.created ──► Admin Notification Module   │
│                   (isolated, chat-only)                            │
│                                                                    │
│  Notification Service ◄── PANDA_EV_NOTIFICATIONS (ไม่มี publisher!)│
│                       ◄── PANDA_EV_QUEUE (consume จาก OCPP)      │
└──────────────────────────────────────────────────────────────────┘
```

### 1.2 ตารางสถานะการเชื่อมต่อ

| Service | ส่งไปยัง NOTIFICATIONS Queue | รับจาก NOTIFICATIONS Queue | FCM Integration | HTTP ตรงไปยัง Notif Svc | สถานะโดยรวม |
|---|---|---|---|---|---|
| **Notification Service** | — (เป็น consumer) | ✅ consume เอง | ✅ FCM Service ภายใน | — | ✅ ทำงานได้ |
| **OCPP Service** | ❌ ไม่ publish | ❌ ไม่ consume | ❌ ไม่มี | ❌ ไม่มี | ⚠️ เชื่อมต่อบางส่วน |
| **Admin (CSMS)** | ❌ ไม่ publish | ❌ ไม่ consume | ❌ ไม่มี | ❌ ไม่มี | ❌ ไม่ได้เชื่อมต่อ |
| **Mobile API** | ❌ ไม่ publish | ❌ ไม่ consume | ✅ เรียกตรง (bypass) | ❌ ไม่มี | ⚠️ Bypass Svc |

### 1.3 การไหลของข้อมูลปัจจุบัน (As-Is Flow)

```
[OCPP Service]
  charger.booted          ──► PANDA_EV_QUEUE ──► Notification Svc (aggregate only)
  transaction.started     ──► PANDA_EV_QUEUE ──► Mobile API (consumer → FCM direct)
  transaction.stopped     ──► PANDA_EV_QUEUE ──► Mobile API (consumer → FCM direct)
  connector.status_changed──► PANDA_EV_QUEUE ──► Mobile API (consumer → FCM direct)
  remote_start.failed     ──► PANDA_EV_QUEUE ──► Mobile API (consumer → FCM direct)

[Admin (CSMS)]
  message.created         ──► Admin Notification Module (WebSocket emit เท่านั้น)
  ── ไม่มีการส่งไปยัง PANDA_EV_NOTIFICATIONS เลย ──

[Mobile API]
  FCM sendToUser()        ──► Firebase (เรียกตรงจาก OcppConsumerService)
  ── ไม่ผ่าน Notification Service ──
```

**ปัญหาหลัก:** `PANDA_EV_NOTIFICATIONS` queue ถูกสร้างขึ้นและ Notification Service พร้อม consume แล้ว แต่ไม่มี service ใดส่งข้อความเข้ามาในขณะนี้

---

## 2. เหตุการณ์ที่ขาดหายและช่องโหว่ {#2}

### 2.1 เหตุการณ์สำคัญที่ควรแจ้งเตือนแต่ยังไม่มี

#### จาก OCPP Service → Notification Service

| เหตุการณ์ | Routing Key (ปัจจุบัน) | ควรส่ง Push หรือไม่ | ผู้รับ | Priority |
|---|---|---|---|---|
| Charger เปลี่ยนเป็น Offline | `charger.offline` | ✅ ใช่ | Admin | 🔴 Critical |
| Charger ตรวจพบ Fault | `connector.status_changed` (status=Faulted) | ✅ ใช่ | Admin + User (ถ้ากำลังชาร์จ) | 🔴 Critical |
| BootNotification จาก Charger ไม่รู้จัก | ไม่มี | ✅ ใช่ | Admin | 🟠 High |
| Authorize ล้มเหลว (idTag ไม่ถูกต้อง) | ไม่มี | ✅ ใช่ | Admin (security audit) | 🟠 High |
| FirmwareStatusNotification (Downloaded/Failed) | `charger.firmware_status` | ✅ ใช่ | Admin | 🟡 Medium |
| DiagnosticsStatusNotification | `charger.diagnostics_status` | ✅ ใช่ | Admin | 🟡 Medium |
| Transaction หยุดกะทันหัน (stopReason: EVDisconnected/Emergency) | `transaction.stopped` | ✅ ใช่ | User | 🟠 High |
| Charger ไม่ส่ง Heartbeat เกิน threshold | (ยังไม่มี logic) | ✅ ใช่ | Admin | 🔴 Critical |

#### จาก Admin (CSMS) → Notification Service

| เหตุการณ์ | ควรส่ง Push หรือไม่ | ผู้รับ | Priority |
|---|---|---|---|
| ผู้ใช้ใหม่ลงทะเบียน (จาก `PANDA_EV_USER_EVENTS`) | ✅ Welcome notification | User | 🟡 Medium |
| Admin อนุมัติ/ปฏิเสธ KYC | ✅ ใช่ | User | 🟠 High |
| Station/Charger ปิดปรับปรุง (Admin ตั้งค่า) | ✅ ใช่ | Users ที่ Favorite | 🟡 Medium |
| Pricing Tier เปลี่ยนแปลง | ✅ ใช่ | Users ที่ใช้ Station นั้น | 🟡 Medium |
| Promotion/Banner ใหม่ (CMS) | ✅ Broadcast | All Users | 🟢 Low |
| Transaction refund/คืนเงิน | ✅ ใช่ | User | 🔴 Critical |

#### จาก Mobile API → Notification Service (แทนการเรียก FCM ตรง)

| เหตุการณ์ปัจจุบัน | วิธีปัจจุบัน | ควรเปลี่ยนเป็น | Priority |
|---|---|---|---|
| Charging started | `FcmService.sendToUser()` โดยตรง | Publish `notification.session` ไปยัง Notification Svc | 🟠 High |
| Charging stopped | `FcmService.sendToUser()` โดยตรง | Publish `notification.session` | 🟠 High |
| Remote start failed | `FcmService.sendToUser()` โดยตรง | Publish `notification.targeted` | 🟠 High |
| Overstay warning | ยังไม่มี (มี routing key ใน Notification Svc แต่ไม่มีผู้ส่ง) | Publish `notification.overstay_reminder` | 🟠 High |
| Wallet ยอดต่ำ (Low balance) | ไม่มี | Publish `notification.targeted` | 🟡 Medium |
| Payment สำเร็จ/ล้มเหลว | ไม่มี | Publish `notification.targeted` | 🟠 High |

### 2.2 ช่องโหว่ด้านสถาปัตยกรรม

#### ช่องโหว่ที่ 1: Mobile API เรียก FCM โดยตรง (ความเสี่ยงสูง)

```
ปัจจุบัน:
OcppConsumerService → FcmService.sendToUser() → Firebase
                      (ภายใน Mobile API process เดียวกัน)

ปัญหา:
- ไม่มี retry หาก Firebase ส่งล้มเหลว
- ไม่มีการบันทึก notification history
- ไม่มี deduplication
- ไม่มี rate limiting
- หาก Mobile API ล่ม ระหว่าง transaction.stopped → notification หาย
- ไม่มี dead-letter queue สำหรับ FCM failures
```

#### ช่องโหว่ที่ 2: Admin ไม่มีช่องทางส่ง Push เลย

Admin สามารถดูสถานะผ่าน WebSocket dashboard ได้ แต่ไม่มีการส่ง Push notification ไปยัง admin user หรือ user ทั่วไปจาก Admin system เลย

#### ช่องโหว่ที่ 3: `notification.overstay_reminder` ไม่มีผู้ส่ง

Notification Service มี routing key `notification.overstay_reminder` รองรับอยู่แล้ว แต่ไม่มี service ใด publish เข้ามา ระบบ overstay fee มีอยู่แต่ไม่มีการแจ้งเตือน user ล่วงหน้า

---

## 3. การตรวจสอบความปลอดภัยและความเสถียร {#3}

### 3.1 การตรวจสอบความปลอดภัย (Security Audit)

#### ✅ สิ่งที่ทำได้ดีแล้ว

| จุด | รายละเอียด |
|---|---|
| RS256 JWT บน RabbitMQ | ทุก message มี `x-service-token` header ที่ signed ด้วย RS256 (30s TTL) |
| JTI Blacklist | ป้องกัน replay attack ด้วย Redis blacklist (60s TTL) |
| Verify ก่อน process | Notification Service ตรวจสอบ `x-service-token` ก่อน process ทุก message |
| DLQ protection | Message ที่ verify ไม่ผ่าน → NACKed โดยไม่ requeue |

#### ❌ ช่องโหว่ที่พบ

**[CRITICAL] Admin Dashboard WebSocket ไม่มี Authentication**

```typescript
// panda-ev-notification/src/modules/websocket/admin-stats.gateway.ts
// Namespace: /admin-stats
// ไม่มี guard ใดๆ — ใครก็ connect ได้
@WebSocketGateway({ namespace: '/admin-stats', cors: { origin: '*' } })
export class AdminStatsGateway {
  // handleConnection() ไม่มี JWT verification
}
```

ข้อมูลที่รั่วไหลได้: transaction stats, station revenue, user session data, system alerts

**[HIGH] HTTP Endpoint `/api/notification/v1/notifications/send` ไม่ชัดเจนว่ามี Auth**

Direct send endpoint อาจถูกเรียกโดยไม่มีการตรวจสอบตัวตน ต้องตรวจสอบว่ามี `JwtAuthGuard` หรือ Service-auth guard หรือไม่

**[MEDIUM] FCM Token ไม่มีการ Revoke เมื่อ Charger เปลี่ยน State**

Stale token detection มีอยู่ใน `FcmService` (คืน `staleTokens[]`) แต่ Mobile API ไม่ได้ใช้ผลลัพธ์นี้เพื่อลบ token จากฐานข้อมูลโดยอัตโนมัติ

### 3.2 การตรวจสอบความเสถียร (Reliability Audit)

#### ✅ Notification Service มีกลไกที่แข็งแกร่ง

| กลไก | รายละเอียด |
|---|---|
| **DLQ + Retry** | 3 attempts, delays: [5s, 30s, 120s], dead-letter ไปยัง `PANDA_EV_NOTIFICATIONS_DLX` |
| **Rate Limiting** | Sliding window ด้วย Lua script (atomic Redis) |
| **Deduplication** | Redis-based, 24h TTL ป้องกัน duplicate push |
| **Auto-reconnect** | Exponential backoff `min(2^n * 1000ms, 30s)` พร้อม `isDestroyed` flag |
| **Prefetch** | `prefetch(10)` ป้องกัน consumer overwhelm |
| **Timeout Interceptor** | Global interceptor ป้องกัน HTTP request ค้าง |

#### ❌ ความเสี่ยงที่พบ

| ความเสี่ยง | รายละเอียด | ผลกระทบ |
|---|---|---|
| Mobile API FCM ไม่มี retry | หาก Firebase timeout → notification หาย | 🔴 High |
| ไม่มี Circuit Breaker สำหรับ FCM | Firebase rate limit → Mobile API ส่ง error ไม่ controlled | 🟡 Medium |
| OCPP ไม่มี Heartbeat monitoring | Charger ที่ silent-offline ไม่ถูกตรวจจับ | 🔴 High |
| Admin WebSocket ไม่มี reconnect | Browser refresh → ต้อง reconnect เอง | 🟡 Medium |
| `PANDA_EV_QUEUE` consumer ใน Notification Svc | consume สำหรับ aggregate เท่านั้น ถ้า push ต้องการ → ไม่มีทาง | 🟠 Medium |

---

## 4. มาตรฐานการผสานรวม {#4}

### 4.1 สถาปัตยกรรมเป้าหมาย (To-Be Architecture)

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Target Architecture                            │
│                                                                       │
│  [OCPP Service]                                                       │
│    charger.offline/fault ──────────────────────────────────────────► │
│    transaction.stopped (reason) ──────────────────────────────────► │
│                          PANDA_EV_NOTIFICATIONS                      │
│  [Admin (CSMS)]                                    │                  │
│    user.registered ──────────────────────────────► │                  │
│    kyc.approved/rejected ─────────────────────────►│                  │
│    pricing.changed ────────────────────────────────►                 │
│                                                     ▼                 │
│  [Mobile API]                            [Notification Service]      │
│    notification.session ───────────────►   ├─ JWT verify             │
│    notification.overstay_reminder ─────►   ├─ Dedup (Redis 24h)     │
│    notification.targeted ──────────────►   ├─ Rate Limit (Lua)      │
│                                            ├─ DLQ Retry (3x)        │
│                                            └─► FCM → Firebase        │
│                                                └─► Admin WebSocket    │
└─────────────────────────────────────────────────────────────────────┘
```

### 4.2 มาตรฐาน Payload (Standard Payload Specification)

Service ทุกตัวที่ต้องการส่ง notification **ต้อง** publish message ไปยัง `PANDA_EV_NOTIFICATIONS` queue ด้วย format นี้เท่านั้น:

```typescript
// Standard Notification Payload — ใช้สำหรับทุก service
interface NotificationPayload {
  // ─── Required ───────────────────────────────────────────
  routingKey: NotificationRoutingKey;   // ดูตารางด้านล่าง
  title: string;                        // หัวข้อ (ภาษาที่เหมาะสม)
  body: string;                         // เนื้อหา

  // ─── Targeting (อย่างน้อย 1 อย่าง) ─────────────────────
  fcmTokens?: string[];                 // ส่งหา device โดยตรง
  userId?: string;                      // ส่งหา user (ระบบหา token เอง)
  // broadcast: ใช้ routingKey: 'notification.broadcast' (ไม่ต้องระบุ target)

  // ─── Context (Optional แต่แนะนำ) ────────────────────────
  type: string;                         // e.g. 'charging_started', 'charger_fault'
  data?: Record<string, string>;        // FCM data payload (string values only)
  stationId?: string;
  chargerIdentity?: string;
  sessionId?: string;

  // ─── Behaviour Overrides (Optional) ─────────────────────
  skipDedup?: boolean;                  // default: false
  priority?: 'high' | 'normal';        // default: 'high'
  imageUrl?: string;

  // ─── Internal (เพิ่มโดย RabbitMQService อัตโนมัติ) ──────
  // x-service-token header (RS256 JWT, 30s TTL) — ห้าม set เอง
}

type NotificationRoutingKey =
  | 'notification.targeted'          // ส่งหา user/device เฉพาะ
  | 'notification.session'           // charging session events (dedup enabled)
  | 'notification.broadcast'         // ส่งหาทุก user (skipDedup: true อัตโนมัติ)
  | 'notification.overstay_reminder';// parking fee warning
```

**ตัวอย่าง Payload จริง:**

```typescript
// OCPP → Notification: Charger Fault
const payload: NotificationPayload = {
  routingKey: 'notification.targeted',
  type: 'charger_fault',
  title: 'Charger Fault Detected',
  body: `Charger ${identity} reported fault: ${errorCode}`,
  data: {
    chargerIdentity: identity,
    errorCode,
    connectorId: String(connectorId),
  },
  chargerIdentity: identity,
  priority: 'high',
};

// Mobile → Notification: Overstay Warning
const payload: NotificationPayload = {
  routingKey: 'notification.overstay_reminder',
  type: 'overstay_reminder',
  userId,
  title: 'กรุณาถอดปลั๊กชาร์จ',
  body: `คุณจะถูกเก็บค่าจอดรถ ${parkingFeePerMin} LAK/นาที ใน 5 นาที`,
  data: { sessionId, parkingFeePerMin: String(parkingFeePerMin) },
  sessionId,
  skipDedup: false,
};
```

### 4.3 วิธีการ Publish (Publishing Pattern)

```typescript
// ทุก service ใช้ RabbitMQService ที่มีอยู่แล้ว — ไม่ต้องเพิ่ม dependency ใหม่
// Service จะ sign x-service-token อัตโนมัติ

await this.rabbitMQ.publish(
  process.env.RABBITMQ_NOTIFICATIONS_QUEUE ?? 'PANDA_EV_NOTIFICATIONS',
  payload  // NotificationPayload ด้านบน
);
```

**ข้อกำหนดสำคัญ:**
- ห้าม publish ไปยัง Firebase / FCM โดยตรงจาก service อื่น (นอกจาก Notification Service)
- ห้าม import `FcmService` ข้าม service boundary
- ทุก notification **ต้องผ่าน** `PANDA_EV_NOTIFICATIONS` queue เท่านั้น

---

## 5. แผนการดำเนินงาน {#5}

### 5.1 การแก้ไขเร่งด่วน (Immediate Fixes — Sprint 1)

#### ✅ Checklist งานที่ต้องทำทันที

**[P0] รักษาความปลอดภัย Admin Dashboard WebSocket**
- [ ] เพิ่ม `JwtAuthGuard` หรือ `ServiceJwtGuard` ใน `AdminStatsGateway.handleConnection()`
- [ ] เพิ่ม `cors.origin` whitelist แทน `*`
- [ ] ทดสอบว่า unauthorized client ถูก disconnect พร้อม `auth_error`

**[P0] ย้าย Mobile FCM ไปผ่าน Notification Service**
- [ ] ใน `panda-ev-client-mobile/src/modules/charging-session/ocpp-consumer.service.ts`:
  - [ ] Replace `this.fcm.sendToUser(...)` ทุก call → `this.rabbitMQ.publish('PANDA_EV_NOTIFICATIONS', payload)`
  - [ ] ลบ `FcmService` injection ออกจาก `OcppConsumerService`
- [ ] เพิ่ม routing key `notification.overstay_reminder` publisher ใน overstay timer logic

**[P1] OCPP เพิ่ม Critical Alert Notifications**
- [ ] ใน `ocpp.service.ts` handler `handleStatusNotification()`:
  - [ ] ตรวจสอบ `status === 'Faulted'` → publish `notification.targeted` ไปยัง Admin
- [ ] เพิ่ม `handleChargerOffline()` ใน heartbeat monitor:
  - [ ] หาก heartbeat timeout → publish `notification.targeted` ไปยัง Admin
- [ ] ใน `handleBootNotification()`:
  - [ ] หาก charger ไม่รู้จัก → publish `notification.targeted` (security alert) ไปยัง Admin

**[P1] Admin เพิ่ม Notification Publishing**
- [ ] ใน `notification-rabbitmq.service.ts` (consumer ของ `message.created`):
  - [ ] หลัง WebSocket emit → เพิ่ม publish ไปยัง `PANDA_EV_NOTIFICATIONS` ด้วย `notification.targeted`
- [ ] ใน `mobile-user` module (consume `PANDA_EV_USER_EVENTS`):
  - [ ] หลัง upsert user → publish welcome notification ไปยัง `PANDA_EV_NOTIFICATIONS`

### 5.2 การปรับปรุงระยะกลาง (Mid-term Improvements — Sprint 2-3)

**[P2] Stale FCM Token Auto-Cleanup**
- [ ] ใน Notification Service `fcm.service.ts` หลัง batch send:
  - [ ] ส่ง `staleTokens[]` กลับไปยัง `PANDA_EV_USER_EVENTS` (new routing key `device.token_stale`)
  - [ ] Mobile API consume event นี้เพื่อลบ token ออกจาก `userDevice` table

**[P2] Heartbeat Monitor ใน OCPP**
- [ ] สร้าง `HeartbeatMonitorService` ใน `panda-ev-ocpp`:
  - [ ] ทุก N นาที scan Redis keys `charger_status:*`
  - [ ] เปรียบเทียบ `lastHeartbeat` กับ `Date.now()` — threshold configurable
  - [ ] หาก silent → publish `charger.offline` + `notification.targeted` ไปยัง Admin

**[P2] Admin เพิ่ม Pricing/Station Change Notifications**
- [ ] ใน `pricing.service.ts` mutation methods:
  - [ ] publish `notification.broadcast` หาก pricing tier เปลี่ยนแปลง
- [ ] ใน `station.service.ts`:
  - [ ] publish `notification.targeted` ไปยัง user ที่ favorite station ที่ปิดปรับปรุง

**[P3] Circuit Breaker สำหรับ Firebase**
- [ ] เพิ่ม circuit breaker library (`opossum`) ใน Notification Service `fcm.service.ts`
- [ ] เพิ่ม fallback: บันทึก notification ใน DB ด้วย status `PENDING_RETRY`
- [ ] Background job retry `PENDING_RETRY` ทุก 5 นาที

### 5.3 การปรับปรุงระยะยาว (Long-term — Backlog)

| รายการ | เหตุผล |
|---|---|
| เพิ่ม Kafka แทน RabbitMQ สำหรับ event stream | Persistent log, replay capability, multi-consumer |
| Notification Preferences ต่อ user | ให้ user เลือกปิด/เปิด notification type |
| In-app notification center (Mobile API) | Endpoint ดู notification history ใน Mobile |
| Multi-language template engine | ปัจจุบัน title/body เป็น hardcoded string |
| A/B Testing สำหรับ notification content | เพิ่ม conversion rate |

---

## 6. คู่มือการนำ Service ใหม่เข้าระบบ {#6}

### 6.1 ขั้นตอนการเชื่อมต่อ Service ใหม่ (เช่น Billing Service, Loyalty Service)

#### Phase 1: Key Setup (วันที่ 1)

```bash
# 1. สร้าง RS256 key pair สำหรับ service ใหม่
cd pandaEV/
./generate-service-keys-local.sh
# → สร้าง keys/billing-service.pem + billing-service.pub

# 2. คัดลอก public key ไปยัง services ที่ต้อง verify
cp keys/billing-service.pub panda-ev-notification/keys/
cp keys/billing-service.pub panda-ev-csms-system-admin/keys/

# 3. อัปเดต TRUSTED_SERVICE_ISSUERS ใน .env ของ services ที่รับข้อความ
# panda-ev-notification/.env:
TRUSTED_SERVICE_ISSUERS=mobile-api:mobile,ocpp-csms:ocpp,billing-service:billing
```

#### Phase 2: Module Setup ใน Service ใหม่ (วันที่ 1-2)

```typescript
// billing-service/src/app.module.ts
// ⚠️ ServiceAuthModule ต้อง import ก่อน RabbitMQModule เสมอ
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ServiceAuthModule,    // ← ต้องมาก่อน
    RabbitMQModule,       // ← ต้องมาหลัง ServiceAuthModule
    BillingModule,
  ],
})
export class AppModule {}
```

#### Phase 3: สร้าง Notification Helper (วันที่ 2)

```typescript
// billing-service/src/common/notification.helper.ts
// ไม่ต้อง install library ใหม่ — ใช้ RabbitMQService ที่มีอยู่

@Injectable()
export class NotificationHelper {
  private readonly NOTIF_QUEUE =
    this.config.get('RABBITMQ_NOTIFICATIONS_QUEUE') ?? 'PANDA_EV_NOTIFICATIONS';

  constructor(
    private readonly rabbitMQ: RabbitMQService,
    private readonly config: ConfigService,
  ) {}

  async sendToUser(
    userId: string,
    type: string,
    title: string,
    body: string,
    data?: Record<string, string>,
  ): Promise<void> {
    await this.rabbitMQ.publish(this.NOTIF_QUEUE, {
      routingKey: 'notification.targeted',
      type,
      userId,
      title,
      body,
      data,
      priority: 'high',
    });
  }

  async broadcast(
    type: string,
    title: string,
    body: string,
  ): Promise<void> {
    await this.rabbitMQ.publish(this.NOTIF_QUEUE, {
      routingKey: 'notification.broadcast',
      type,
      title,
      body,
      skipDedup: true,
    });
  }
}
```

#### Phase 4: ใช้งานใน Business Logic (วันที่ 2-3)

```typescript
// billing-service/src/modules/payment/payment.service.ts
@Injectable()
export class PaymentService {
  constructor(private readonly notification: NotificationHelper) {}

  async processPayment(userId: string, amount: number) {
    // ... payment logic ...

    // ✅ ส่ง notification ผ่าน Notification Service
    await this.notification.sendToUser(
      userId,
      'payment_success',
      'ชำระเงินสำเร็จ',
      `ชำระเงิน ${amount.toLocaleString()} LAK เรียบร้อย`,
      { amount: String(amount), currency: 'LAK' },
    );
  }
}
```

#### Phase 5: ทดสอบ Integration (วันที่ 3)

```bash
# Checklist การทดสอบ
# [ ] ส่ง message ไปยัง PANDA_EV_NOTIFICATIONS แล้ว Notification Service รับได้
# [ ] x-service-token verify ผ่าน (ไม่มี "invalid token" error ใน logs)
# [ ] FCM push ส่งถึง device ที่ทดสอบ
# [ ] ตรวจสอบ DLQ ว่าไม่มี message ค้าง
# [ ] ตรวจสอบ rate limit ว่าทำงาน (ส่ง bulk → เห็น throttle)
# [ ] ทดสอบ service down scenario: Notification Svc ปิด → message อยู่ใน Queue ไม่หาย
```

#### Phase 6: เพิ่ม ENV ใน K8s Secret (Production)

```bash
# สร้าง secret สำหรับ service ใหม่
cd billing-service/
./create-secret.sh

# อัปเดต Notification Service secret เพื่อเพิ่ม trusted key ใหม่
# ใน panda-ev-notification/create-secret.sh:
# เพิ่ม billing-service.pub ใน TRUSTED_SERVICE_PUBLIC_KEYS array
```

### 6.2 Checklist สำหรับ Service ใหม่ (Quick Reference)

```
Infrastructure:
  [ ] สร้าง RS256 key pair และคัดลอก public key ไปยัง Notification Service
  [ ] อัปเดต TRUSTED_SERVICE_ISSUERS ใน Notification Service .env
  [ ] Import ServiceAuthModule ก่อน RabbitMQModule ใน AppModule

Code:
  [ ] ใช้ RabbitMQService.publish() ไปยัง PANDA_EV_NOTIFICATIONS เท่านั้น
  [ ] ห้าม import FcmService หรือ Firebase SDK โดยตรง
  [ ] Payload ต้องมี routingKey, title, body, type และ target (userId หรือ fcmTokens)
  [ ] fire-and-forget ด้วย .catch(() => null) เพื่อป้องกัน cascade failure:
      await this.rabbitMQ.publish(NOTIF_QUEUE, payload).catch(() => null);

Testing:
  [ ] ทดสอบ happy path: notification ส่งถึง device
  [ ] ทดสอบ Notification Service down: ข้อความต้องคง queue อยู่
  [ ] ตรวจสอบ DLQ ว่าว่าง

Security:
  [ ] ยืนยันว่า x-service-token verify ผ่านใน Notification Service logs
  [ ] อย่า log fcmTokens หรือ userId ในระดับ INFO

Production:
  [ ] อัปเดต K8s Secret สำหรับ Notification Service (trusted keys)
  [ ] อัปเดต K8s Secret สำหรับ Service ใหม่ (private key)
  [ ] ทดสอบ end-to-end ใน staging ก่อน production
```

---

## สรุปสถานะโดยรวม

| ด้าน | สถานะ | คะแนน |
|---|---|---|
| Notification Service Infrastructure | แข็งแกร่ง (DLQ, retry, rate-limit, dedup) | 9/10 |
| OCPP Integration | บางส่วน (aggregate เท่านั้น, ขาด critical alerts) | 4/10 |
| Admin Integration | แยกตัว (chat เท่านั้น, ไม่เชื่อมต่อ main pipeline) | 2/10 |
| Mobile Integration | Bypass (FCM ตรง, ไม่ผ่าน Notification Service) | 3/10 |
| Security | มีช่องโหว่ (Admin WebSocket ไม่มี auth) | 6/10 |
| **โดยรวม** | **ต้องการปรับปรุงเร่งด่วน** | **5/10** |

**ประเด็นเร่งด่วนที่สุด 3 ข้อ:**
1. 🔴 เพิ่ม auth บน Admin Stats WebSocket
2. 🔴 ย้าย Mobile FCM calls ให้ผ่าน `PANDA_EV_NOTIFICATIONS` queue
3. 🔴 OCPP ต้องส่ง critical alerts (Fault, Offline) ไปยัง Notification Service
