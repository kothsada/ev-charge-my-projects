# คู่มือ Notification Service Backend — Panda EV Platform

**วันที่:** 2026-03-24
**บริการหลัก:** `panda-ev-notification` (port 5001) · `panda-ev-client-mobile` (port 4001)

---

## สารบัญ

1. [ภาพรวม Architecture](#1-ภาพรวม-architecture)
2. [Notification Microservice ที่มีอยู่แล้ว](#2-notification-microservice-ที่มีอยู่แล้ว)
3. [FCM Integration — Mobile API](#3-fcm-integration--mobile-api)
4. [การส่ง Notification จาก Mobile API ไปยัง Notification Service](#4-การส่ง-notification-จาก-mobile-api-ไปยัง-notification-service)
5. [SSE (Server-Sent Events) สำหรับ Live Charging Status](#5-sse-server-sent-events-สำหรับ-live-charging-status)
6. [Event-Driven Notification — จุดเรียกใช้งานทั้งหมด](#6-event-driven-notification--จุดเรียกใช้งานทั้งหมด)
7. [Device Token Registration API](#7-device-token-registration-api)
8. [Security](#8-security)
9. [Testing Guide](#9-testing-guide)
10. [Troubleshooting](#10-troubleshooting)

---

## 1. ภาพรวม Architecture

```
┌─────────────┐     FCM direct      ┌──────────────┐
│ Mobile App  │ ◄──────────────────  │ Mobile API   │
│             │                      │  (port 4001) │
│  [Active]   │  SSE Stream          │              │
│  Charging   │ ◄────────────────── │ GET /live    │
│  Screen     │                      └──────┬───────┘
└─────────────┘                             │
                                     RabbitMQ PANDA_EV_NOTIFICATIONS
                                            │ (notification.targeted /
                                            │  notification.session /
                                            │  notification.broadcast /
                                            │  notification.overstay_reminder)
                                            ▼
                                   ┌────────────────────┐
                                   │  Notification       │
                                   │  Microservice       │
                                   │  (port 5001)        │
                                   │                     │
                                   │  Dedup → RateLimit  │
                                   │  → FCM.send()       │
                                   │  → DB Log           │
                                   │  → Stats UPSERT     │
                                   │  → WS Admin Dashboard│
                                   └────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  FCM Delivery Strategy                                       │
│                                                             │
│  Foreground (app open)  → SSE stream (real-time meter data) │
│  Background (app closed)→ FCM push notification             │
│  Critical events        → FCM push (ทั้ง foreground + background)│
└─────────────────────────────────────────────────────────────┘
```

### ทำไมต้องแยก Notification Service?

| ข้อดี | รายละเอียด |
|---|---|
| **Deduplication** | Redis NX guard — ป้องกัน notification เดิมส่งซ้ำในช่วง 24 ชั่วโมง |
| **Rate Limiting** | Sliding window per user — ป้องกัน spam |
| **Dead Letter Queue** | retry 3 ครั้ง (5s / 30s / 120s) ก่อนส่งไป DLQ |
| **Audit Log** | `notification_logs` table บันทึกทุก notification ที่ส่ง |
| **Admin Dashboard** | WebSocket `/admin-stats` แสดง real-time notification stats |
| **Scalability** | Scale notification delivery โดยไม่กระทบ Mobile API |

---

## 2. Notification Microservice ที่มีอยู่แล้ว

### 2.1 โครงสร้าง Module

```
panda-ev-notification/src/modules/
├── notification/
│   ├── notification.router.ts      ← RabbitMQ consumer (entry point)
│   ├── notification.processor.ts   ← Pipeline: Dedup→RateLimit→FCM→DB→Stats
│   └── notification.controller.ts  ← REST endpoints
├── fcm/
│   └── fcm.service.ts              ← Firebase Admin SDK wrapper
├── dedup/
│   └── dedup.service.ts            ← Redis NX check
├── rate-limit/
│   └── rate-limit.service.ts       ← Sliding window per user
├── aggregation/
│   └── aggregation.service.ts      ← UPSERT hourly/daily stats
├── websocket/
│   └── admin-stats.gateway.ts      ← Socket.IO /admin-stats
└── template/
    └── template.service.ts         ← CRUD notification templates
```

### 2.2 Processing Pipeline

```
RabbitMQ Message
      │
      ▼
NotificationRouter.handleNotificationMessage()
      │
      ▼
NotificationProcessor.process()
      │
      ├─ 1. Dedup check  (Redis SET NX — key: notif:{sessionId}:{type}, TTL 24h)
      │      └─ ถ้า key ซ้ำ → return { status: 'SUPPRESSED' }
      │
      ├─ 2. Rate limit   (Redis sorted-set sliding window per userId+type)
      │      └─ ถ้าเกิน limit → return { status: 'SUPPRESSED' }
      │
      ├─ 3. FCM.send()   (multicast ไปยัง fcmTokens[] ที่ส่งมาใน message)
      │
      ├─ 4. DB Log       (INSERT notification_logs — soft-fail)
      │
      ├─ 5. Aggregation  (UPSERT notification_daily_stats)
      │
      └─ 6. WebSocket    (emit notification:sent ไปยัง /admin-stats)
```

### 2.3 RabbitMQ Message Format

```typescript
// ส่งจาก Mobile API → PANDA_EV_NOTIFICATIONS queue
interface NotificationMessage {
  routingKey:
    | 'notification.targeted'      // single user, direct push
    | 'notification.session'       // session event, dedup ด้วย sessionId+type
    | 'notification.broadcast'     // bulk push, skipDedup: true
    | 'notification.overstay_reminder'; // delayed push

  // Required fields
  userId: string;
  fcmTokens: string[];            // ⚠️ Mobile API ต้องดึง tokens ก่อนส่ง
  type: string;                   // e.g. 'charging_started', 'parking_warning'
  title: string;
  body: string;

  // Optional fields
  sessionId?: string;             // required สำหรับ notification.session (ใช้ dedup)
  stationId?: string;
  chargerIdentity?: string;
  data?: Record<string, string>;  // extra data สำหรับ deep link
  imageUrl?: string;
  priority?: 'high' | 'normal';
  skipDedup?: boolean;
  skipRateLimit?: boolean;

  // สำหรับ overstay_reminder เท่านั้น
  notifyAt?: string;              // ISO timestamp ที่ต้องส่ง
}
```

### 2.4 WebSocket Admin Dashboard

```javascript
// เชื่อมต่อ Admin Dashboard
const socket = io('http://localhost:5001', { path: '/socket.io' });
const adminStats = socket.of('/admin-stats');

// Events ที่ได้รับ
adminStats.on('notification:sent', (data) => {
  // { type, userId, stationId, chargerIdentity, status, sentAt }
});

adminStats.on('session:live_update', (data) => {
  // OCPP transaction event + event field
});

adminStats.on('stats:hourly_updated', (data) => {
  // { stationId, stationName, hour, ... }
});

adminStats.on('system:alert', (data) => {
  // { level, message, data }
});
```

---

## 3. FCM Integration — Mobile API

### 3.1 FCM Service ที่มีอยู่แล้ว

`panda-ev-client-mobile/src/modules/fcm/fcm.service.ts` มีฟังก์ชันครบ:

```typescript
// Device registration
await this.fcm.registerDevice(userId, fcmToken, platform);   // upsert
await this.fcm.unregisterDevice(fcmToken);                    // logout
await this.fcm.unregisterAllDevices(userId);                  // deactivate

// Push notification
await this.fcm.sendToUser(userId, { title, body, data });     // ดึง tokens จาก DB เอง
await this.fcm.sendToUsers(userIds[], { ... });               // bulk

// Topics
await this.fcm.sendToTopic('all_users', { ... });
```

### 3.2 Firebase Credentials Setup

**Option A — JSON file (local dev / Docker):**
```bash
# ดาวน์โหลด Service Account JSON จาก Firebase Console
# Project Settings → Service accounts → Generate new private key

# ตั้ง environment variable
FIREBASE_SERVICE_ACCOUNT_PATH=./keys/firebase-service-account.json
```

**Option B — Individual env vars (K8s / Docker Compose):**
```bash
FIREBASE_PROJECT_ID=panda-ev-xxxxx
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@panda-ev-xxxxx.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\nMIIEo...\n-----END RSA PRIVATE KEY-----\n"
# ⚠️ FIREBASE_PRIVATE_KEY: ใช้ \n สำหรับ newline ใน .env file
```

**ใน panda-ev-notification ใช้ environment variables เดียวกัน:**
```bash
# notification microservice ก็อ่าน FIREBASE_SERVICE_ACCOUNT_PATH หรือ
# FIREBASE_PROJECT_ID + FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY เช่นกัน
```

### 3.3 Android Notification Channel Setup

Mobile app (Flutter/React Native) ต้องสร้าง channel ก่อนรับ notification:

```kotlin
// Android: สร้าง notification channel ที่ตรงกับ channelId ที่ backend ส่ง
val channel = NotificationChannel(
    "panda_ev_default",              // ← ต้องตรงกับ backend
    "Panda EV Notifications",
    NotificationManager.IMPORTANCE_HIGH
)
notificationManager.createNotificationChannel(channel)
```

Backend ส่ง `channelId: 'panda_ev_default'` ทุก notification (default ใน `buildPlatformConfig()`).

---

## 4. การส่ง Notification จาก Mobile API ไปยัง Notification Service

### 4.1 วิธีที่ Mobile API ควรส่ง (Best Practice)

แทนที่จะเรียก `this.fcm.sendToUser()` โดยตรง ควรใช้ RabbitMQ publish ไปยัง Notification Service เพื่อได้ประโยชน์จาก dedup + rate-limit + audit log:

```typescript
// src/modules/charging-session/ocpp-consumer.service.ts

// ❌ วิธีเดิม — FCM direct call (ยังใช้งานได้แต่ไม่มี dedup/rate-limit)
await this.fcm.sendToUser(state.userId, {
  title: 'Charging Complete',
  body: 'Please unplug to avoid parking fees.',
  data: { type: 'parking_warning', sessionId: session.id },
});

// ✅ วิธีใหม่ — ผ่าน Notification Microservice
const devices = await this.prisma.userDevice.findMany({
  where: { userId: state.userId },
  select: { fcmToken: true },
});

await this.rabbitMQ.publish(
  process.env.RABBITMQ_NOTIFICATIONS_QUEUE ?? 'PANDA_EV_NOTIFICATIONS',
  {
    routingKey: 'notification.session',
    userId: state.userId,
    sessionId: session.id,
    stationId: state.stationId,
    chargerIdentity: state.chargerIdentity,
    fcmTokens: devices.map((d) => d.fcmToken),
    type: 'parking_warning',
    title: 'Charging Complete',
    body: 'Your car is fully charged. Please unplug to avoid parking fees.',
    data: { type: 'parking_warning', sessionId: session.id },
    priority: 'high',
  },
);
```

### 4.2 Notification Types ที่ควรส่งผ่าน Microservice

| Event | routingKey | type | Dedup? |
|---|---|---|---|
| Charging started | `notification.session` | `charging_started` | ✅ (sessionId+type) |
| Parking warning | `notification.session` | `parking_warning` | ✅ |
| Overstay reminder | `notification.overstay_reminder` | `overstay_reminder` | ✅ |
| Session completed | `notification.session` | `session_completed` | ✅ |
| Low balance warning | `notification.targeted` | `low_balance` | ❌ (skipDedup) |
| Charger offline | `notification.targeted` | `charger_offline` | ❌ |
| Remote start failed | `notification.targeted` | `remote_start_failed` | ❌ |
| Charger rebooted | `notification.targeted` | `charger_rebooted` | ❌ |
| Broadcast (admin) | `notification.broadcast` | `system_announcement` | ❌ (skipDedup: true) |

### 4.3 RabbitMQService.publishNotification() Helper

ใน `panda-ev-notification` มี helper method ที่ช่วยให้ส่ง notification ง่ายขึ้น ตรวจสอบว่า `RabbitMQService` ของ Mobile API มีฟังก์ชัน `publishNotification()` หรือไม่ ถ้าไม่มีให้เพิ่ม:

```typescript
// src/configs/rabbitmq/rabbitmq.service.ts (mobile api)

async publishNotification(payload: Record<string, unknown>): Promise<void> {
  const queue = process.env.RABBITMQ_NOTIFICATIONS_QUEUE ?? 'PANDA_EV_NOTIFICATIONS';
  await this.publish(queue, payload);
}
```

---

## 5. SSE (Server-Sent Events) สำหรับ Live Charging Status

SSE ใช้สำหรับ push real-time meter data (kWh, ค่าไฟ, เวลาชาร์จ) ไปยัง mobile app ในขณะที่ app อยู่ใน foreground ต่างจาก FCM ที่ใช้สำหรับ background notifications.

### 5.1 Architecture — Redis Pub/Sub + SSE

```
OCPP CSMS
  │ MeterValues (15s interval)
  ▼
ocpp.service.ts: handleMeterValues()
  │ PUBLISH meter:{identity}:{connectorId}
  ▼
Redis Pub/Sub
  │ SUBSCRIBE
  ▼
Mobile API: GET /charging-sessions/:id/stream
  │ SSE stream (text/event-stream)
  ▼
Mobile App (Foreground)
```

### 5.2 Step 1 — เพิ่ม Redis Pub/Sub ใน OCPP Service

แก้ไข `panda-ev-ocpp/src/modules/ocpp/ocpp.service.ts` ใน `handleMeterValues()`:

```typescript
// เพิ่ม Redis publish หลังจาก setJSON
async handleMeterValues(
  identity: string,
  connectorId: number,
  transactionId: number | undefined,
  meterValues: OcppMeterValue[],
): Promise<void> {
  // ... existing logic: extract energyWh, store in Redis ...

  // เพิ่ม: Publish to Redis Pub/Sub สำหรับ SSE clients
  const liveData = {
    meterWh: energyWh,
    transactionId,
    updatedAt: new Date().toISOString(),
    // เพิ่ม measurands อื่นถ้ามีใน meterValues
    powerW: extractMeasurand(meterValues, 'Power.Active.Import'),
    voltageV: extractMeasurand(meterValues, 'Voltage'),
    currentA: extractMeasurand(meterValues, 'Current.Import'),
    socPercent: extractMeasurand(meterValues, 'SoC'),
  };

  // Publish ไปยัง channel
  await this.redis.publish(
    `meter:${identity}:${connectorId}`,
    JSON.stringify(liveData),
  );
}
```

**RedisService ต้องมี publish method:**
```typescript
// src/configs/redis/redis.service.ts (ocpp)
async publish(channel: string, message: string): Promise<void> {
  await this.client.publish(channel, message);
}
```

### 5.3 Step 2 — SSE Endpoint ใน Mobile API

```typescript
// src/modules/charging-session/charging-session.controller.ts

@Get(':id/stream')
@Sse()
@ApiBearerAuth()
async streamChargingStatus(
  @Param('id') sessionId: string,
  @CurrentUser('id') userId: string,
): Promise<Observable<MessageEvent>> {
  return this.chargingSessionService.createChargingStream(sessionId, userId);
}
```

```typescript
// src/modules/charging-session/charging-session.service.ts

async createChargingStream(
  sessionId: string,
  userId: string,
): Promise<Observable<MessageEvent>> {
  // 1. ตรวจสอบว่า session เป็นของ user นี้
  const session = await this.prisma.chargingSession.findFirst({
    where: { id: sessionId, userId },
    select: { id: true, status: true, chargerIdentity: true, connectorId: true },
  });

  if (!session) {
    throw new NotFoundException('Session not found');
  }

  // 2. ดึง chargerIdentity + connectorId
  const { chargerIdentity, connectorId } = session;
  const channel = `meter:${chargerIdentity}:${connectorId ?? 1}`;

  // 3. สร้าง Observable ที่ subscribe Redis channel
  return new Observable<MessageEvent>((subscriber) => {
    const redisSubscriber = this.redis.createSubscriber();

    redisSubscriber.subscribe(channel, (message) => {
      try {
        const data = JSON.parse(message);
        subscriber.next({ data } as MessageEvent);
      } catch {
        // ignore parse errors
      }
    });

    // Heartbeat ทุก 30s เพื่อป้องกัน connection timeout
    const heartbeat = setInterval(() => {
      subscriber.next({ data: { heartbeat: true } } as MessageEvent);
    }, 30_000);

    // Cleanup เมื่อ client disconnect
    return () => {
      clearInterval(heartbeat);
      redisSubscriber.unsubscribe(channel).catch(() => null);
      redisSubscriber.quit().catch(() => null);
    };
  });
}
```

**RedisService ต้องมี createSubscriber method:**
```typescript
// สร้าง subscriber instance แยกจาก main Redis connection
// (Redis subscribe mode ไม่สามารถส่ง command อื่นได้)
createSubscriber(): Redis {
  return new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
}
```

### 5.4 Step 3 — Mobile App (Flutter) รับ SSE Stream

```dart
// lib/services/charging_stream_service.dart

import 'package:eventsource/eventsource.dart';

class ChargingStreamService {
  EventSource? _eventSource;

  Stream<ChargingLiveData> streamSession(String sessionId, String accessToken) async* {
    final url = Uri.parse(
      'https://api.pandaev.com/api/mobile/v1/charging-sessions/$sessionId/stream',
    );

    _eventSource = await EventSource.connect(
      url,
      headers: {'Authorization': 'Bearer $accessToken'},
    );

    await for (final event in _eventSource!) {
      if (event.data == null) continue;

      try {
        final json = jsonDecode(event.data!);
        if (json['heartbeat'] == true) continue;

        yield ChargingLiveData.fromJson(json);
      } catch (_) {
        continue;
      }
    }
  }

  void dispose() {
    _eventSource?.client?.close();
  }
}
```

```dart
// lib/models/charging_live_data.dart

class ChargingLiveData {
  final int meterWh;
  final String updatedAt;
  final double? powerW;
  final double? voltageV;
  final double? currentA;
  final double? socPercent;

  ChargingLiveData.fromJson(Map<String, dynamic> json)
      : meterWh = json['meterWh'] ?? 0,
        updatedAt = json['updatedAt'] ?? '',
        powerW = (json['powerW'] as num?)?.toDouble(),
        voltageV = (json['voltageV'] as num?)?.toDouble(),
        currentA = (json['currentA'] as num?)?.toDouble(),
        socPercent = (json['socPercent'] as num?)?.toDouble();
}
```

### 5.5 SSE vs Polling — เปรียบเทียบ

| | SSE Stream | Polling (ปัจจุบัน) |
|---|---|---|
| **Latency** | Real-time (~1s) | 5-10s delay |
| **Battery** | ดีกว่า (push-based) | แย่กว่า (pull ทุก 5s) |
| **Server load** | ต่ำกว่า | สูงกว่า (N requests/5s) |
| **Implementation** | ซับซ้อนกว่า | ง่าย |
| **Background** | ไม่ได้ (ต้องใช้ FCM) | ยังทำงานได้ |
| **Best for** | Foreground charging screen | Fallback / simple use |

**แนะนำ Hybrid:**
- App เปิดอยู่ (foreground) → ใช้ SSE stream
- App ปิด/background → ใช้ FCM notification

---

## 6. Event-Driven Notification — จุดเรียกใช้งานทั้งหมด

### 6.1 Notifications ที่ส่งจาก Mobile API (OcppConsumerService)

ไฟล์: `panda-ev-client-mobile/src/modules/charging-session/ocpp-consumer.service.ts`

| Event (routingKey) | FCM Type | Title | Trigger |
|---|---|---|---|
| `transaction.stopped` | `parking_warning` | "Charging Complete" | หลัง session เสร็จ ถ้า parking fee เปิดอยู่ |
| `remote_start.failed` | `remote_start_failed` | "Charger Not Responding" / "Charging Start Failed" | เมื่อ charger reject หรือ timeout |
| `charger.offline` | `charger_offline` | "Charger Offline" | เมื่อ charger disconnect มี active session |
| `charger.booted` | `charger_rebooted` | "Charger Restarted" | เมื่อ charger reboot มี active session |
| `connector.status_changed` (Available) | `overstay_parking` | "Overstay Parking Fee" | คิดค่า parking แล้วแจ้ง |

### 6.2 Notifications ที่ยังไม่มี (ควรเพิ่ม)

| Event | FCM Type | เมื่อไหร่ | Priority |
|---|---|---|---|
| Session เริ่มสำเร็จ | `charging_started` | `handleSessionStarted()` — หลัง link OCPP txId | สูง |
| Session เสร็จสมบูรณ์ | `session_completed` | `handleSessionCompleted()` — ส่ง receipt | สูง |
| Balance ต่ำ (< min_charging_balance) | `low_balance` | ก่อน start session | กลาง |
| Session ใกล้จะ timeout | `session_timeout_warning` | Timer check ทุก 1 ชั่วโมง | ต่ำ |

#### เพิ่ม charging_started notification:

```typescript
// ocpp-consumer.service.ts — handleSessionStarted()

private async handleSessionStarted(msg: Record<string, unknown>) {
  // ... existing logic: link ocppTransactionId ...

  // เพิ่ม: FCM notification
  const sessionId = msg.sessionId as string;
  const session = await this.prisma.chargingSession.findUnique({
    where: { id: sessionId },
    select: { userId: true, stationName: true, chargerIdentity: true },
  });

  if (session) {
    await this.fcm
      .sendToUser(session.userId, {
        title: 'Charging Started',
        body: `Charging has started at ${session.stationName}.`,
        data: { type: 'charging_started', sessionId },
      })
      .catch(() => null);
  }
}
```

#### เพิ่ม session_completed notification:

```typescript
// ocpp-consumer.service.ts — handleSessionCompleted() หลัง wallet deduction

await this.fcm
  .sendToUser(state.userId, {
    title: 'Charging Complete',
    body: `Energy: ${energyKwh} kWh · Cost: ${totalCost.toLocaleString()} LAK`,
    data: {
      type: 'session_completed',
      sessionId: session.id,
      energyKwh: String(energyKwh),
      totalCost: String(totalCost),
    },
  })
  .catch(() => null);
```

### 6.3 Overstay Reminder Flow

```
transaction.stopped received
      │
      ├─ enableParkingFee = true
      │
      ├─ set parking:timer:{identity}:{connectorId} ใน Redis
      │
      ├─ คำนวณ notifyAt = now + parkingFreeMinutes
      │
      ▼
Mobile API publish → PANDA_EV_NOTIFICATIONS
{
  routingKey: 'notification.overstay_reminder',
  notifyAt: '2026-03-24T11:30:00+07:00',
  userId, fcmTokens, sessionId,
  type: 'overstay_reminder',
  title: 'Parking Fee Starting',
  body: 'You will be charged for parking in 5 minutes.',
  data: { type: 'overstay_reminder', sessionId }
}
      │
      ▼
NotificationRouter.handleOverstayReminder()
  ├─ ถ้า delay > 3s → setTimeout แล้ว re-publish
  └─ ถ้าถึงเวลาแล้ว → processor.process()
```

---

## 7. Device Token Registration API

### 7.1 Endpoints (ที่มีอยู่แล้วใน Mobile API)

```
POST   /api/mobile/v1/fcm/devices
DELETE /api/mobile/v1/fcm/devices/:token
GET    /api/mobile/v1/fcm/devices
```

### 7.2 Register Device Token

```bash
# เรียกหลัง login สำเร็จและได้ FCM token จาก Firebase SDK
curl -X POST http://localhost:4001/api/mobile/v1/fcm/devices \
  -H "Authorization: Bearer <access_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "fcmToken": "fXxkP3...",
    "platform": "android"
  }'
```

**Response:**
```json
{
  "success": true,
  "statusCode": 201,
  "data": null,
  "message": "Device registered",
  "timestamp": "2026-03-24T10:00:00+07:00"
}
```

### 7.3 Unregister (Logout)

```bash
curl -X DELETE http://localhost:4001/api/mobile/v1/fcm/devices/fXxkP3... \
  -H "Authorization: Bearer <access_token>"
```

### 7.4 Database Schema

```prisma
// panda_ev_core schema
model UserDevice {
  id        String   @id @default(uuid())
  userId    String
  fcmToken  String   @unique
  platform  String?  // 'android' | 'ios' | null
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  user User @relation(fields: [userId], references: [id])

  @@schema("panda_ev_core")
}
```

### 7.5 Token Pruning (Automatic)

`FcmService` ลบ stale tokens อัตโนมัติหลังส่ง multicast:

```typescript
// Error codes ที่ trigger การลบ token
'messaging/invalid-registration-token'
'messaging/registration-token-not-registered'
```

Token ที่ได้รับ error เหล่านี้จะถูกลบจาก `user_devices` table ทันที ไม่ต้องทำ batch cleanup.

---

## 8. Security

### 8.1 Service-to-Service Authentication

ทุก RabbitMQ message ระหว่าง services ต้องมี `x-service-token` header:

```typescript
// RabbitMQService.publish() ใน Mobile API จัดการ signing อัตโนมัติ
// ไม่ต้อง sign manually

await this.rabbitMQ.publish('PANDA_EV_NOTIFICATIONS', {
  routingKey: 'notification.targeted',
  // ...payload
});
// ↑ RabbitMQService attach x-service-token header โดยอัตโนมัติ
```

Notification Service verify token ก่อน process ทุก message:
- RS256 signature check ด้วย trusted peer public key
- Redis jti blacklist check (anti-replay, 60s TTL)

### 8.2 FCM Token Security

```typescript
// ❌ อย่า log FCM token แบบ full
this.logger.log(`Token: ${fcmToken}`);

// ✅ ใช้ masked version
this.logger.log(`Token: ${fcmToken.slice(0, 20)}…`);
```

FCM tokens ควรถูกจัดการเป็น sensitive data:
- ไม่เก็บใน application logs
- ไม่ส่งใน API response (เก็บ preview เท่านั้น ดู `listDevices()`)
- ลบทันทีเมื่อ invalid (token pruning)

### 8.3 SSE Authentication

SSE endpoint ใช้ `JwtAuthGuard` global guard เหมือน endpoints อื่น:

```typescript
@Get(':id/stream')
@Sse()
// JwtAuthGuard ทำงานอัตโนมัติ — ต้องมี Bearer token ใน Authorization header
// ตรวจสอบ sessionId เป็นของ userId นั้นจริงก่อน stream
async streamChargingStatus(...)
```

**Mobile app ต้องส่ง token ใน EventSource:**
```dart
// Flutter — ต้องใช้ library ที่รองรับ custom headers
final eventSource = await EventSource.connect(
  url,
  headers: {'Authorization': 'Bearer $accessToken'},
);
```

### 8.4 Rate Limiting ใน Notification Service

ค่า default ใน `rate-limit.service.ts`:

```typescript
// Sliding window per userId + type
const WINDOW_MS = 60_000;     // 1 นาที
const MAX_PER_WINDOW = 5;     // ส่งได้ไม่เกิน 5 ครั้ง/นาที/type
```

ปรับแต่งได้ผ่าน environment variables หรือ notification template config.

---

## 9. Testing Guide

### 9.1 Test FCM Token Registration

```bash
# 1. Login ก่อน
curl -X POST http://localhost:4001/api/mobile/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "test@pandaev.com", "password": "Test@123456"}'
# → เก็บ access_token

# 2. Register FCM token (ใช้ test token)
curl -X POST http://localhost:4001/api/mobile/v1/fcm/devices \
  -H "Authorization: Bearer <access_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "fcmToken": "test_token_1234567890abcdef",
    "platform": "android"
  }'

# 3. ดู devices ที่ลงทะเบียน
curl http://localhost:4001/api/mobile/v1/fcm/devices \
  -H "Authorization: Bearer <access_token>"
```

### 9.2 Test FCM Notification ด้วย Firebase Console

```
Firebase Console → Cloud Messaging → Send your first message
  → Target: Device token (ใส่ token จาก step 2.1)
  → Notification title: "Test"
  → Notification text: "Hello from Panda EV"
  → Send message
```

### 9.3 Test Notification ผ่าน RabbitMQ (Direct)

```bash
# ส่ง message โดยตรงผ่าน RabbitMQ Management UI
# http://localhost:15672 (guest/guest)
# Exchange: default, Queue: PANDA_EV_NOTIFICATIONS

# หรือใช้ curl ผ่าน Management API
curl -X POST http://localhost:15672/api/exchanges/%2F/amq.default/publish \
  -H "Content-Type: application/json" \
  -u guest:guest \
  -d '{
    "properties": {},
    "routing_key": "PANDA_EV_NOTIFICATIONS",
    "payload": "{\"routingKey\":\"notification.targeted\",\"userId\":\"<user-id>\",\"fcmTokens\":[\"<fcm-token>\"],\"type\":\"test\",\"title\":\"Test Notification\",\"body\":\"Hello from Panda EV\",\"skipDedup\":true,\"skipRateLimit\":true}",
    "payload_encoding": "string"
  }'
```

### 9.4 Test SSE Stream

```bash
# ต้องมี active session และ OCPP VCP กำลัง MeterValues
curl -N \
  -H "Authorization: Bearer <access_token>" \
  -H "Accept: text/event-stream" \
  http://localhost:4001/api/mobile/v1/charging-sessions/<session-id>/stream

# ควรเห็น output ทุก 15 วินาที (ตาม VCP simulator)
# data: {"meterWh":600,"updatedAt":"2026-03-24T10:01:15.000Z"}
# data: {"meterWh":750,"updatedAt":"2026-03-24T10:01:30.000Z"}
```

### 9.5 Test Deduplication

```bash
# ส่ง notification.session สองครั้งด้วย sessionId+type เดิม
# ครั้งที่ 2 ควรได้ status: 'SUPPRESSED'

# ตรวจสอบใน Redis
docker exec redis redis-cli keys "notif:*"
# → "notif:<sessionId>:parking_warning"

# ดู notification logs ใน DB
docker exec -it postgres psql -U postgres \
  -c "SELECT type, status, created_at FROM panda_ev_notifications.notification_logs ORDER BY created_at DESC LIMIT 10;"
```

### 9.6 Test Dead Letter Queue

```bash
# ส่ง malformed message เพื่อทดสอบ DLQ
# หลังจาก 3 retries ควรไปอยู่ที่ PANDA_EV_NOTIFICATIONS_DLQ

# ตรวจสอบ DLQ ใน RabbitMQ Management UI
# Queues → PANDA_EV_NOTIFICATIONS_DLQ → Get messages
```

### 9.7 Smoke Test — End to End

```bash
# 1. Register FCM token
# 2. Start charging session
# 3. VCP ส่ง StartTransaction → ดู charging_started notification ใน FCM
# 4. VCP ส่ง MeterValues → ดู SSE stream อัพเดต
# 5. Stop session → ดู session_completed notification ใน FCM
# 6. ตรวจสอบ notification_logs ใน DB
docker exec -it postgres psql -U postgres \
  -c "SELECT type, status, channel, created_at FROM panda_ev_notifications.notification_logs WHERE user_id = '<user-id>' ORDER BY created_at DESC;"
```

---

## 10. Troubleshooting

### 10.1 FCM Token Invalid

**อาการ:** `messaging/registration-token-not-registered` ใน logs

**สาเหตุ:** Token หมดอายุหรือ app ถูกถอนการติดตั้ง

**แก้ไข:**
- Token จะถูกลบอัตโนมัติจาก `user_devices` table โดย `FcmService.multicast()`
- ไม่ต้องทำอะไรเพิ่มเติม — system self-heals

### 10.2 Notification ไม่ถูกส่ง (SUPPRESSED)

**ตรวจสอบ:**
```bash
# ตรวจสอบ dedup key ใน Redis
docker exec redis redis-cli keys "notif:<sessionId>:*"

# ลบ dedup key เพื่อทดสอบใหม่
docker exec redis redis-cli del "notif:<sessionId>:<type>"
```

### 10.3 RabbitMQ Connection Failed

**อาการ:** Notification Service startup log: `RabbitMQ connection failed`

**ตรวจสอบ:**
```bash
# ตรวจสอบ RABBITMQ_URL
echo $RABBITMQ_URL

# ทดสอบ connection
curl -s http://guest:guest@localhost:15672/api/overview | jq .node
```

Notification Service soft-fails เมื่อ RabbitMQ ไม่พร้อม — service จะยังทำงานได้แต่ไม่รับ notifications.

### 10.4 SSE Stream ไม่อัพเดต

**ตรวจสอบตามลำดับ:**
1. VCP ส่ง MeterValues อยู่ไหม? → ดู OCPP logs: `Received MeterValues from PANDA-DONGNASOK-08`
2. Redis Pub/Sub ทำงานไหม?
   ```bash
   # Terminal 1: Subscribe
   docker exec redis redis-cli subscribe "meter:PANDA-DONGNASOK-08:1"

   # Terminal 2: Publish test
   docker exec redis redis-cli publish "meter:PANDA-DONGNASOK-08:1" '{"meterWh":1000,"test":true}'
   # Terminal 1 ควรเห็น message
   ```
3. OCPP Service publish ไปยัง Redis channel ไหม? → ตรวจสอบว่าเพิ่ม `redis.publish()` ใน `handleMeterValues()` แล้ว
4. SSE endpoint ทำงานไหม? → `curl -N -H "Authorization: Bearer ..." http://localhost:4001/.../stream`

### 10.5 Notification Service ไม่รับ x-service-token

**อาการ:** `[RabbitMQ] Service token verification failed` ใน logs

**แก้ไข:**
1. ตรวจสอบว่า `mobile-api.pub` อยู่ใน `panda-ev-notification/keys/` directory
2. ตรวจสอบ `TRUSTED_SERVICE_ISSUERS=mobile-api:mobile` ใน `.env`
3. Regenerate keys ถ้าจำเป็น:
   ```bash
   # ที่ monorepo root
   ./generate-service-keys-local.sh
   ```

---

## สรุป — Checklist การ Implement

### Phase 1 — FCM (มีอยู่แล้ว ✅)
- [x] `FcmService` ใน Mobile API
- [x] Device registration API
- [x] Token pruning อัตโนมัติ
- [x] `parking_warning`, `remote_start_failed`, `charger_offline` notifications

### Phase 2 — Notification Microservice Integration
- [ ] ย้าย FCM calls ใน `OcppConsumerService` ไปใช้ RabbitMQ publish
- [ ] เพิ่ม `charging_started` notification ใน `handleSessionStarted()`
- [ ] เพิ่ม `session_completed` notification ใน `handleSessionCompleted()`
- [ ] เพิ่ม `low_balance` check ใน `startSession()`

### Phase 3 — SSE Stream (ยังไม่มี)
- [ ] เพิ่ม `redis.publish()` ใน `handleMeterValues()` (OCPP Service)
- [ ] เพิ่ม `createSubscriber()` ใน RedisService (Mobile API)
- [ ] เพิ่ม SSE endpoint `GET /charging-sessions/:id/stream`
- [ ] Implement `createChargingStream()` ด้วย Redis Pub/Sub Observable
- [ ] Mobile app: implement `ChargingStreamService` ด้วย EventSource

### Phase 4 — Advanced
- [ ] Notification templates ผ่าน `template.service.ts` ใน Notification Service
- [ ] FCM Topics สำหรับ broadcast notifications
- [ ] Push notification analytics ผ่าน Admin Dashboard WebSocket
