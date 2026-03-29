# FCM Notification Service Integration — Implementation Record
**วันที่และเวลา:** 2026-03-28 16:27:42 (UTC+7)
**ดำเนินการโดย:** Senior System Architect
**อ้างอิง Audit:** `docs/Notification_Service_Integration_Audit_2026-03-28.md`

---

## สารบัญ
1. [ภาพรวมการเปลี่ยนแปลง](#1-ภาพรวมการเปลี่ยนแปลง)
2. [FCM Decoupling — Mobile API](#2-fcm-decoupling--mobile-api)
3. [Stale Token Cleanup Loop](#3-stale-token-cleanup-loop)
4. [WebSocket Auth Fix — Notification Service](#4-websocket-auth-fix--notification-service)
5. [Schema & Migration](#5-schema--migration)
6. [Notification Templates Seed](#6-notification-templates-seed)
7. [Architecture Diagram (After)](#7-architecture-diagram-after)
8. [Environment Variables ใหม่](#8-environment-variables-ใหม่)
9. [ขั้นตอน Deploy](#9-ขั้นตอน-deploy)
10. [Checklist การทดสอบ](#10-checklist-การทดสอบ)

---

## 1. ภาพรวมการเปลี่ยนแปลง

| # | ไฟล์ที่แก้ไข | Service | ประเภทการเปลี่ยนแปลง |
|---|---|---|---|
| 1 | `charging-session/ocpp-consumer.service.ts` | Mobile API | FCM → RabbitMQ publish |
| 2 | `charging-session/charging-session.module.ts` | Mobile API | Remove FcmModule import |
| 3 | `fcm/fcm.service.ts` | Mobile API | Add stale token consumer |
| 4 | `notification/notification.processor.ts` | Notification Svc | Add stale token publisher |
| 5 | `websocket/admin-stats.gateway.ts` | Notification Svc | Add JWT auth |
| 6 | `prisma/schema.prisma` | Mobile API | UserDevice improvements |
| 7 | `prisma/migrations/20260328000001_...` | Mobile API | New migration SQL |
| 8 | `prisma/seed/seed-templates.ts` | Notification Svc | 7 new templates |

**Type-check status:** ✅ `panda-ev-client-mobile` — 0 errors | ✅ `panda-ev-notification` — 0 errors
**Prisma generate:** ✅ Both services regenerated

---

## 2. FCM Decoupling — Mobile API

### ปัญหาก่อนหน้า
`OcppConsumerService` เรียก `FcmService.sendToUser()` โดยตรง → Firebase SDK ถูกเรียกภายใน Mobile API process ทำให้:
- ไม่มี retry หาก Firebase ล้มเหลว
- ไม่มี deduplication / rate limiting
- ไม่มี notification history
- notification หายหาก Mobile API ล่มระหว่าง transaction

### การแก้ไข: `ocpp-consumer.service.ts`

**ลบออก:**
```typescript
// ลบ import นี้
import { FcmService } from '../fcm/fcm.service';

// ลบ constructor injection นี้
private readonly fcm: FcmService,
```

**เพิ่ม:**
```typescript
const NOTIFICATIONS_QUEUE =
  process.env.RABBITMQ_NOTIFICATIONS_QUEUE ?? 'PANDA_EV_NOTIFICATIONS';
```

**เพิ่ม `publishPush()` helper (private method):**
```typescript
private async publishPush(
  userId: string,
  notification: {
    type: string;
    title: string;
    body: string;
    data?: Record<string, string>;
    sessionId?: string;
    chargerIdentity?: string;
    skipDedup?: boolean;
  },
): Promise<void> {
  try {
    // Look up tokens from userDevice table (Mobile API owns this data)
    const devices = await this.prisma.userDevice.findMany({
      where: { userId },
      select: { fcmToken: true },
    });

    if (!devices.length) return;

    const fcmTokens = devices.map((d) => d.fcmToken);
    // session events → dedup enabled | device events (offline/reboot) → skipDedup
    const routingKey = notification.skipDedup
      ? 'notification.targeted'
      : 'notification.session';

    await this.rabbitMQ
      .publish(NOTIFICATIONS_QUEUE, {
        routingKey,
        userId,
        fcmTokens,
        type: notification.type,
        title: notification.title,
        body: notification.body,
        data: notification.data,
        sessionId: notification.sessionId,
        chargerIdentity: notification.chargerIdentity,
        skipDedup: notification.skipDedup ?? false,
        priority: 'high',
      })
      .catch(() => null); // soft-fail — billing logic must not be affected
  } catch {
    // Never let push failure cascade into billing errors
  }
}
```

**เหตุการณ์ที่เปลี่ยน (4 จุด):**

| เหตุการณ์ | routingKey | dedup | sessionId |
|---|---|---|---|
| `parking_warning` (charging complete) | `notification.session` | ✅ enabled | session.id |
| `remote_start_failed` | `notification.targeted` | ❌ skip | sessionId |
| `charger_offline` | `notification.targeted` | ❌ skip | sessionId |
| `charger_rebooted` | `notification.targeted` | ❌ skip | sessionId |

### การแก้ไข: `charging-session.module.ts`

```typescript
// ลบออก:
import { FcmModule } from '../fcm/fcm.module';

// ลบออกจาก imports array:
imports: [WalletModule, FcmModule],

// เปลี่ยนเป็น:
imports: [WalletModule],
```

> **Note:** `FcmModule` ยังคงอยู่ใน AppModule — ยังใช้สำหรับ device registration endpoints (`POST /devices/fcm` ฯลฯ)

---

## 3. Stale Token Cleanup Loop

### ปัญหาก่อนหน้า
เมื่อ Firebase ตรวจพบ token ที่ล้าสมัย (`messaging/invalid-registration-token` ฯลฯ) Notification Service จะตรวจพบแต่ไม่มีทางบอก Mobile API ให้ลบ token เหล่านั้นออกจาก `userDevice` table

### สถาปัตยกรรม Cleanup Loop

```
Notification Service NotificationProcessor
  ├─► Firebase FCM
  │     └─► response: { sent, failed, staleTokens: ['token1', 'token2'] }
  │
  └─► if staleTokens.length > 0:
        publish → PANDA_EV_FCM_CLEANUP
                  { routingKey: 'device.token_stale', fcmTokens: [...] }
                        │
                        └─► Mobile API FcmService (consumer)
                              └─► DELETE FROM user_devices
                                  WHERE fcm_token IN (stale tokens)
```

### การแก้ไข: `notification.processor.ts` (Notification Service)

**เพิ่ม import และ constant:**
```typescript
import { RabbitMQService } from '../../configs/rabbitmq/rabbitmq.service';

const FCM_CLEANUP_QUEUE =
  process.env.RABBITMQ_FCM_CLEANUP_QUEUE ?? 'PANDA_EV_FCM_CLEANUP';
```

**เพิ่ม injection:**
```typescript
constructor(
  private readonly fcm: FcmService,
  private readonly prisma: PrismaService,
  private readonly rabbitMQ: RabbitMQService,  // ← เพิ่ม
  // ...
```

**เพิ่มหลัง FCM send:**
```typescript
// Publish stale tokens back to Mobile API for cleanup from userDevice table
if (result && result.staleTokens.length > 0) {
  await this.rabbitMQ
    .publish(FCM_CLEANUP_QUEUE, {
      routingKey: 'device.token_stale',
      fcmTokens: result.staleTokens,
    })
    .catch(() => null);
}
```

### การแก้ไข: `fcm.service.ts` (Mobile API)

**เพิ่ม import:**
```typescript
import { RabbitMQService } from '../../configs/rabbitmq/rabbitmq.service';

const FCM_CLEANUP_QUEUE =
  process.env.RABBITMQ_FCM_CLEANUP_QUEUE ?? 'PANDA_EV_FCM_CLEANUP';
```

**เพิ่ม constructor injection** (RabbitMQModule เป็น @Global จึงไม่ต้อง import ใน FcmModule):
```typescript
constructor(
  private readonly prisma: PrismaService,
  private readonly rabbitMQ: RabbitMQService,  // ← เพิ่ม
) {}
```

**เพิ่มใน `onModuleInit()`:**
```typescript
async onModuleInit() {
  // Firebase init (เดิม)
  const credential = this.resolveCredential();
  // ...

  // เพิ่ม: consume stale token feedback
  await this.rabbitMQ
    .consume(FCM_CLEANUP_QUEUE, (msg) => this.handleStaleTokenCleanup(msg))
    .catch((err) =>
      this.logger.warn(`FCM cleanup queue not available: ${(err as Error).message}`),
    );
}
```

**เพิ่ม handler:**
```typescript
private async handleStaleTokenCleanup(msg: Record<string, unknown>): Promise<void> {
  if (msg.routingKey !== 'device.token_stale') return;

  const tokens = msg.fcmTokens as string[] | undefined;
  if (!tokens?.length) return;

  const result = await this.prisma.userDevice.deleteMany({
    where: { fcmToken: { in: tokens } },
  });

  if (result.count > 0) {
    this.logger.log(
      `Pruned ${result.count} stale FCM token(s) from Notification Service feedback`,
    );
  }
}
```

> **หมายเหตุ:** ใช้ `PANDA_EV_FCM_CLEANUP` queue แยกต่างหาก (ไม่ใช้ `PANDA_EV_USER_EVENTS`) เพื่อหลีกเลี่ยง circular dependency เนื่องจาก Mobile API ทั้ง publish และ consume จาก `PANDA_EV_USER_EVENTS`

---

## 4. WebSocket Auth Fix — Notification Service

### ปัญหาก่อนหน้า (Critical Security)
```typescript
// ก่อนหน้า: ไม่มี auth เลย
@WebSocketGateway({ namespace: '/admin-stats', cors: { origin: '*' } })
export class AdminStatsGateway implements OnGatewayInit {
  // ใครก็ connect ได้ — ข้อมูล transaction/revenue รั่วไหลได้
}
```

### การแก้ไข: `admin-stats.gateway.ts`

```typescript
import * as jwt from 'jsonwebtoken'; // transitive dep — ไม่ต้อง npm install

@WebSocketGateway({
  namespace: '/admin-stats',
  cors: { origin: process.env.ALLOWED_ORIGINS?.split(',') ?? '*' }
})
export class AdminStatsGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  handleConnection(client: Socket) {
    // รับ token จาก handshake.auth.token หรือ Authorization header
    const token =
      (client.handshake.auth as Record<string, string>)?.token ||
      client.handshake.headers?.authorization?.replace('Bearer ', '');

    if (!token) {
      client.emit('auth_error', 'Missing authentication token');
      client.disconnect(true);
      return;
    }

    const secret = process.env.JWT_SECRET ?? process.env.ADMIN_STATS_WS_SECRET;

    try {
      jwt.verify(token, secret);
      // ✅ authorized — connection allowed
    } catch {
      client.emit('auth_error', 'Invalid or expired token');
      client.disconnect(true);
    }
  }
}
```

### วิธี Connect จาก Admin SPA (ตัวอย่าง)

```javascript
// Admin SPA เชื่อมต่อ /admin-stats WebSocket
import { io } from 'socket.io-client';

const socket = io('http://notification-service:5001', {
  path: '/socket.io',
  namespace: '/admin-stats',
  auth: {
    token: 'Bearer <admin_user_jwt>',  // JWT จาก Admin Service login
  },
});

socket.on('auth_error', (msg) => {
  console.error('WebSocket auth failed:', msg);
  // redirect to login
});

socket.on('notification:sent', (data) => { /* ... */ });
socket.on('session:live_update', (data) => { /* ... */ });
```

### ENV ที่ต้องตั้งค่า
```bash
# panda-ev-notification/.env
JWT_SECRET=<ใช้ secret เดียวกับ Admin Service>
# หรือใช้ secret แยก:
ADMIN_STATS_WS_SECRET=<strong-random-secret>

# CORS whitelist แทน *
ALLOWED_ORIGINS=http://admin.pandaev.com,http://localhost:3000
```

---

## 5. Schema & Migration

### Mobile API — `UserDevice` model (เพิ่ม 2 fields)

```prisma
model UserDevice {
  id          String    @id @default(uuid()) @db.Uuid
  userId      String    @map("user_id") @db.Uuid
  fcmToken    String    @unique @map("fcm_token") @db.VarChar(500)
  platform    String?   @db.VarChar(20)     // 'android' | 'ios' | 'web'
  appVersion  String?   @map("app_version") @db.VarChar(30)   // ← ใหม่
  lastSeenAt  DateTime? @map("last_seen_at") @db.Timestamptz(6) // ← ใหม่
  createdAt   DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt   DateTime  @updatedAt @map("updated_at") @db.Timestamptz(6)

  @@index([userId])
  @@index([lastSeenAt])   // ← ใหม่ (สำหรับ cleanup query เก่า)
}
```

**ประโยชน์ที่เพิ่มมา:**
- `appVersion` — ช่วย debug ว่า version ใดมีปัญหา FCM token
- `lastSeenAt` — สามารถ query เพื่อลบ device ที่ไม่ active มากกว่า N เดือน

### Migration SQL

**ไฟล์:** `prisma/migrations/20260328000001_userdevice_add_appversion_lastseenat/migration.sql`

```sql
ALTER TABLE "panda_ev_core"."user_devices"
  ADD COLUMN IF NOT EXISTS "app_version"  VARCHAR(30),
  ADD COLUMN IF NOT EXISTS "last_seen_at" TIMESTAMPTZ(6);

CREATE INDEX IF NOT EXISTS "user_devices_last_seen_at_idx"
  ON "panda_ev_core"."user_devices" ("last_seen_at");
```

**วิธี Apply (เมื่อ reset DB):**
```bash
cd panda-ev-client-mobile

# Apply migration SQL
psql "$DATABASE_URL" < prisma/migrations/20260328000001_userdevice_add_appversion_lastseenat/migration.sql

# Mark as applied
npx prisma migrate resolve --applied 20260328000001_userdevice_add_appversion_lastseenat

# Regenerate client
npx prisma generate
```

---

## 6. Notification Templates Seed

**ไฟล์:** `panda-ev-notification/prisma/seed/seed-templates.ts`

Template ทั้งหมดที่มีในระบบ (หลัง seed):

| slug | channel | priority | publisher | ใช้สำหรับ |
|---|---|---|---|---|
| `session_started` | FCM | NORMAL | Mobile API | แจ้งเริ่มชาร์จ |
| `charging_complete` | BOTH | NORMAL | Mobile API | ชาร์จเสร็จ + คำเตือนค่าจอด |
| `soc_80` | FCM | NORMAL | — | แบตฯ 80% |
| `soc_100` | FCM | NORMAL | — | แบตฯ เต็ม |
| `overstay_warning_1` | FCM | HIGH | Mobile API | แจ้งก่อนคิดค่าจอด |
| `overstay_warning_2` | FCM | HIGH | Mobile API | ใกล้ถึงเวลาคิดค่าจอด |
| `overstay_warning_3` | FCM | HIGH | Mobile API | คิดค่าจอดแล้ว |
| `overstay_charged` | FCM | HIGH | Mobile API | หักค่าจอดแล้ว |
| `remote_start_failed` | FCM | HIGH | Mobile API | ชาร์จเริ่มไม่ได้ |
| `charger_offline` | FCM | HIGH | Mobile API | เครื่องสากออฟไลน์ |
| `charger_rebooted` | FCM | HIGH | Mobile API | เครื่องสากรีสตาร์ท |
| `charger_fault` ✨ | FCM | HIGH | OCPP Svc | ตรวจพบ Fault |
| `charger_unknown_boot` ✨ | FCM | HIGH | OCPP Svc | เครื่องสากไม่รู้จัก |
| `welcome` ✨ | FCM | NORMAL | Admin Svc | ต้อนรับผู้ใช้ใหม่ |
| `low_balance_warning` ✨ | FCM | HIGH | Mobile API | ยอดเงินต่ำ |
| `pricing_updated` ✨ | BOTH | NORMAL | Admin Svc | ราคาเปลี่ยนแปลง |
| `station_maintenance` ✨ | BOTH | NORMAL | Admin Svc | สถานีปิดซ่อม |
| `system_maintenance` | BOTH | LOW | Admin Svc | ระบบปิดบำรุง |

✨ = template ใหม่ที่เพิ่มในครั้งนี้

**วิธี Seed:**
```bash
cd panda-ev-notification
npx ts-node prisma/seed/seed-templates.ts
```

---

## 7. Architecture Diagram (After)

```
┌──────────────────────────────────────────────────────────────────────┐
│                     Target Architecture (Implemented)                  │
│                                                                        │
│  [Mobile API - OcppConsumerService]                                   │
│    1. Query userDevice → get fcmTokens[]                              │
│    2. Publish ─────────────────────────────────────────────────────► │
│                                                                        │
│  [OCPP Service] (future)                                              │
│    charger.fault / charger.offline ────────────────────────────────► │
│                                                                        │
│  [Admin (CSMS)] (future)                                              │
│    welcome / pricing_updated ──────────────────────────────────────► │
│                                                                        │
│                          PANDA_EV_NOTIFICATIONS                       │
│                          (DLQ: 3 retries 5s/30s/120s)                │
│                                  │                                     │
│                                  ▼                                     │
│                    [Notification Service]                              │
│                      ├─ JWT verify (x-service-token)                  │
│                      ├─ Dedup (Redis NX, 24h TTL)                     │
│                      ├─ Rate Limit (Lua sliding window)               │
│                      ├─ FCM multicast (batches of 500)               │
│                      ├─ DB log (NotificationLog)                      │
│                      ├─ Aggregation ($executeRaw UPSERT)              │
│                      └─ Admin WebSocket emit (/admin-stats) 🔒JWT    │
│                                  │                                     │
│              staleTokens[] ──────┘                                    │
│                  │                                                     │
│                  ▼ PANDA_EV_FCM_CLEANUP                               │
│    [Mobile API - FcmService]                                          │
│      └─ DELETE FROM user_devices WHERE fcm_token IN (stale tokens)   │
│                                                                        │
│  [Mobile API - SseManagerService] (SSE stays in Mobile API)          │
│    ◄── PANDA_EV_QUEUE (meter values) ◄── OCPP Service                │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 8. Environment Variables ใหม่

### `panda-ev-client-mobile/.env`

```bash
# เพิ่มใหม่
RABBITMQ_NOTIFICATIONS_QUEUE=PANDA_EV_NOTIFICATIONS
RABBITMQ_FCM_CLEANUP_QUEUE=PANDA_EV_FCM_CLEANUP
```

### `panda-ev-notification/.env`

```bash
# เพิ่มใหม่
RABBITMQ_FCM_CLEANUP_QUEUE=PANDA_EV_FCM_CLEANUP
JWT_SECRET=<ใช้ค่าเดียวกับ Admin Service>
# หรือ
ADMIN_STATS_WS_SECRET=<strong-random-secret>
ALLOWED_ORIGINS=http://admin.pandaev.com,http://localhost:3000
```

---

## 9. ขั้นตอน Deploy

### กรณี Reset Database (ตามที่แจ้ง)

```bash
# ─── Mobile API ───────────────────────────────────────────────
cd panda-ev-client-mobile

# 1. Apply all migrations
psql "$DATABASE_URL" < prisma/migrations/20260313000000_add_station_fee_config/migration.sql
psql "$DATABASE_URL" < prisma/migrations/20260314000001_add_charger_hardware_specs/migration.sql
psql "$DATABASE_URL" < prisma/migrations/20260314000002_refactor_pricing_to_tiers/migration.sql
psql "$DATABASE_URL" < prisma/migrations/20260328000001_userdevice_add_appversion_lastseenat/migration.sql

# 2. Mark all as applied
npx prisma migrate resolve --applied 20260313000000_add_station_fee_config
npx prisma migrate resolve --applied 20260314000001_add_charger_hardware_specs
npx prisma migrate resolve --applied 20260314000002_refactor_pricing_to_tiers
npx prisma migrate resolve --applied 20260328000001_userdevice_add_appversion_lastseenat

# 3. Regenerate Prisma client
npx prisma generate

# ─── Admin Service ────────────────────────────────────────────
cd ../panda-ev-csms-system-admin
npx prisma migrate deploy
npx prisma db seed
npx ts-node prisma/seed/seed-locations.ts
npx ts-node prisma/seed/seed-stations.ts

# ─── Notification Service ─────────────────────────────────────
cd ../panda-ev-notification
psql "$DATABASE_URL" < prisma/migrations/20260322000001_init_notifications/migration.sql
npx prisma migrate resolve --applied 20260322000001_init_notifications
npx prisma generate
npx ts-node prisma/seed/seed-templates.ts   # seeds 18 templates
```

---

## 10. Checklist การทดสอบ

### FCM Decoupling

- [ ] เริ่ม charging session → Mobile API publish ไปยัง `PANDA_EV_NOTIFICATIONS` (ตรวจ RabbitMQ management UI)
- [ ] Notification Service consume message และส่ง FCM ได้สำเร็จ
- [ ] ตรวจ `notification_logs` table ว่ามี record ใหม่ (status: SENT)
- [ ] Admin dashboard `/admin-stats` WebSocket emit `notification:sent` event
- [ ] หาก `userDevice` ว่าง (ไม่มี token) → ไม่มี error เกิดขึ้น

### Remote Start Failed

- [ ] จำลอง OCPP charger ปฏิเสธ RemoteStart → Mobile API publish `notification.targeted` ไปยัง `PANDA_EV_NOTIFICATIONS`
- [ ] User ได้รับ push notification: "Charging Start Failed"

### Charger Offline

- [ ] Disconnect VCP → Mobile API publish `notification.targeted`
- [ ] User ที่กำลังชาร์จได้รับ push: "Charger Offline"

### Stale Token Cleanup

- [ ] ใส่ token ปลอมใน `user_devices` table
- [ ] ส่ง notification ไปยัง user นั้น → Firebase คืน `messaging/invalid-registration-token`
- [ ] Notification Service publish ไปยัง `PANDA_EV_FCM_CLEANUP`
- [ ] Mobile API consumer ลบ token ปลอมออกจาก `user_devices`
- [ ] ตรวจ log: `"Pruned 1 stale FCM token(s) from Notification Service feedback"`

### WebSocket Auth

- [ ] Connect `/admin-stats` โดยไม่มี token → ได้รับ `auth_error` event + disconnect
- [ ] Connect ด้วย token หมดอายุ → ได้รับ `auth_error` + disconnect
- [ ] Connect ด้วย token ถูกต้อง → เชื่อมต่อสำเร็จ รับ events ได้
- [ ] ตรวจ log Notification Service: `"WS /admin-stats: client connected (id=...)"` เมื่อ auth ผ่าน

### Schema

- [ ] `user_devices` table มี column `app_version` และ `last_seen_at`
- [ ] Index `user_devices_last_seen_at_idx` ถูกสร้าง
- [ ] `npx prisma generate` สำเร็จใน Mobile API

---

## หมายเหตุสำคัญ

> **SSE Architecture:** ไม่มีการเปลี่ยนแปลง SSE ใน Mobile API — `SseManagerService` ยังคง consume จาก `PANDA_EV_QUEUE` (OCPP meter values) และ stream ไปยัง mobile app โดยตรง ตามสถาปัตยกรรมที่กำหนดไว้ใน `docs/SSE_Architecture_and_Performance_Analysis.md`

> **OCPP & Admin Publishers:** การให้ OCPP Service และ Admin Service publish ไปยัง `PANDA_EV_NOTIFICATIONS` สำหรับ charger faults, welcome notifications, pricing updates ฯลฯ **ยังไม่ได้ implement** — กำหนดไว้ใน audit เป็น Sprint 1 ถัดไป

> **`FcmModule` ใน Mobile API:** ยังคงอยู่ครบถ้วนสำหรับ device registration endpoints (`POST /devices/fcm`, `DELETE /devices/fcm`, etc.) เฉพาะ `OcppConsumerService` เท่านั้นที่ถูก decouple
