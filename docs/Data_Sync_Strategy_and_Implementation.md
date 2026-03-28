# Data_Sync_Strategy_and_Implementation.md

> **Panda EV Hub Platform — กลยุทธ์และแผนการ Implement Data Synchronization**
> ระหว่าง CSMS Admin, OCPP Service และ Mobile App
>
> วันที่: 2026-03-24 | เวอร์ชัน: 1.0.0

---

## สารบัญ

1. [การวิเคราะห์ปัญหา (Problem Analysis)](#1-การวิเคราะห์ปัญหา)
2. [การออกแบบสถาปัตยกรรม (Architecture Design)](#2-การออกแบบสถาปัตยกรรม)
3. [API & Event Specification](#3-api--event-specification)
4. [คู่มือการ Implement (Implementation Guide)](#4-คู่มือการ-implement)
5. [กลยุทธ์การทดสอบ (Testing Strategy)](#5-กลยุทธ์การทดสอบ)
6. [คำแนะนำสำหรับ Production (Recommendations)](#6-คำแนะนำสำหรับ-production)

---

## 1. การวิเคราะห์ปัญหา

### 1.1 สาเหตุหลักของปัญหา (Root Cause)

ปัญหา **Charger data ที่สร้างใน CSMS Admin ไม่ปรากฏใน OCPP Service** เกิดจากสถาปัตยกรรมที่มีฐานข้อมูลแยกกัน 2 ชุดสำหรับ Charger data โดยไม่มีกลไก synchronization ใดๆ

```
Admin CSMS                              OCPP Service
─────────────────────────────           ────────────────────────────
panda_ev_system.chargers    ✗ ──────► panda_ev_ocpp.chargers
panda_ev_system.connectors  ✗ ──────► panda_ev_ocpp.connectors
                              (ไม่มีการส่งข้อมูลไป)
```

### 1.2 การวิเคราะห์โค้ดต้นเหตุ

**จุดที่ 1: Admin ChargerService.create() — ไม่มี event publish**

```typescript
// panda-ev-csms-system-admin/src/modules/station/services/charger.service.ts
// บรรทัด 178-216

async create(stationId: string, dto: CreateChargerDto, userId?: string) {
  // ... validation ...

  const result = await this.prisma.charger.create({
    data: { stationId, displayName: dto.displayName, ocppIdentity: dto.ocppIdentity, ... },
  });

  await this.cache.invalidate('chargers');  // ← ล้างแค่ Redis cache ของ Admin
  await this.cache.invalidate('connectors');
  await this.cache.invalidate('stations');
  return result;

  // ❌ ไม่มี rabbitMQ.publish() หรือ HTTP call ไปยัง OCPP Service เลย
}
```

**จุดที่ 2: OcppService.handleBootNotification() — Reject ถ้าไม่รู้จัก identity**

```typescript
// panda-ev-ocpp/src/modules/ocpp/ocpp.service.ts
// บรรทัด 68-129

async handleBootNotification(identity: string, payload: BootNotificationRequest) {
  const charger = await this.prisma.charger.findUnique({
    where: { ocppIdentity: identity },  // ← Query จาก panda_ev_ocpp.chargers
  });

  if (!charger) {
    this.logger.warn(`BootNotification rejected – unknown identity: ${identity}`);
    return {
      status: BootNotificationStatus.REJECTED,  // ❌ ตู้ชาร์จถูก REJECT
      currentTime: nowBangkokIso(),
      interval: this.HEARTBEAT_INTERVAL,
    };
  }
  // ...
}
```

**จุดที่ 3: ConnectorService.create() — เช่นเดียวกัน ไม่มี sync**

```typescript
// panda-ev-csms-system-admin/src/modules/station/services/connector.service.ts
// บรรทัด 49-86

async create(stationId: string, chargerId: string, dto: CreateConnectorDto) {
  const result = await this.prisma.connector.create({ data: { ... } });

  await this.cache.invalidate('connectors');  // ← แค่ Admin cache
  // ❌ ไม่แจ้ง OCPP ว่ามี connector ใหม่
  return result;
}
```

### 1.3 ผลกระทบทั้งหมด (Impact Analysis)

| สถานการณ์ | ผลกระทบ | ความรุนแรง |
|-----------|---------|-----------|
| สร้าง Charger ใหม่ใน Admin | ตู้ชาร์จ OCPP REJECTED ทุกครั้งที่ BootNotification | 🔴 Critical |
| อัปเดต ocppIdentity | OCPP ยังคงรู้จักชื่อเดิม ไม่รู้จักชื่อใหม่ | 🔴 Critical |
| เพิ่ม Connector ใหม่ | OCPP บันทึก StatusNotification ไม่ได้ | 🟠 High |
| Soft delete Charger | OCPP ยังคง accept connection จากตู้ที่ถูกลบ | 🟠 High |
| อัปเดต displayName/hardware specs | OCPP ไม่อัปเดต — เป็นแค่ cosmetic ไม่กระทบ operation | 🟡 Low |

### 1.4 Mobile App — ไม่มีปัญหา Sync

Mobile API ใช้ `SystemDbService` (raw pg Pool) อ่านข้อมูลสถานี/charger โดยตรงจาก `panda_ev_system` ของ Admin — **ฐานข้อมูลเดียวกัน** ดังนั้น Mobile จึงเห็นข้อมูลใหม่ทันที ไม่ต้องมีการ sync

```typescript
// Mobile ใช้วิธีนี้ — อ่านจาก Admin DB โดยตรง
const chargers = await this.systemDb.withClient(async (client) => {
  return client.query('SELECT * FROM panda_ev_system.chargers WHERE station_id = $1', [stationId]);
});
```

---

## 2. การออกแบบสถาปัตยกรรม

### 2.1 ภาพรวมของทั้งสองแนวทาง

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Sync Strategy Overview                           │
│                                                                     │
│  Admin CSMS ─────────────────────────────────► OCPP Service        │
│                                                                     │
│  ┌─── Approach A: Manual Sync ───────────────────────────────┐     │
│  │  Admin Panel                                              │     │
│  │  [Sync OCPP] ──POST /sync-ocpp──► Admin ──publish──► OCPP│     │
│  │  Button                                                   │     │
│  └───────────────────────────────────────────────────────────┘     │
│                                                                     │
│  ┌─── Approach B: Auto Sync (Event-Driven) ──────────────────┐     │
│  │  Charger CRUD                                             │     │
│  │  create/update/delete ──────────────publish──────────► OCPP│    │
│  │  (ChargerService)    RabbitMQ Event                       │     │
│  └───────────────────────────────────────────────────────────┘     │
└─────────────────────────────────────────────────────────────────────┘
```

### 2.2 Approach A — Manual Sync (On-Demand)

**กรณีใช้งาน:** Recovery หลังจาก OCPP service restart, initial setup, debugging, force resync

```
Admin Portal
    │
    │ 1. Admin กด [Sync OCPP Data]
    ▼
Admin API (POST /stations/:id/sync-ocpp หรือ /chargers/:id/sync-ocpp)
    │
    │ 2. ChargerService.syncToOcpp() — ดึงข้อมูล charger+connectors จาก panda_ev_system
    ▼
RabbitMQ: PANDA_EV_CHARGER_SYNC Queue
    │ Routing Key: charger.sync_requested
    │ Payload: { charger, connectors[], requestedBy, requestId }
    ▼
OCPP Service (ChargerSyncService)
    │
    │ 3. upsert charger ใน panda_ev_ocpp.chargers
    │ 4. upsert connectors ใน panda_ev_ocpp.connectors
    ▼
Admin API (GET /chargers/:id/sync-ocpp/:requestId/status)
    │ 5. Poll ผลลัพธ์ผ่าน Redis (TTL 60s)
    ▼
Admin Portal แสดงผล "Synced ✓" หรือ "Failed ✗"
```

### 2.3 Approach B — Auto Sync (Event-Driven)

**กรณีใช้งาน:** Production reliability — ทุกครั้งที่ข้อมูลเปลี่ยน OCPP จะรู้อัตโนมัติ

```
Admin ChargerService / ConnectorService
    │
    │ 1. create() / update() / softDelete() เสร็จสิ้น
    ▼
RabbitMQ: PANDA_EV_CHARGER_SYNC Queue
    │ Routing Keys:
    │   charger.provisioned  ← สร้างใหม่
    │   charger.updated      ← แก้ไข ocppIdentity, isActive
    │   charger.decommissioned ← soft delete
    │   connector.provisioned ← connector ใหม่
    │   connector.updated     ← แก้ไข connector
    │   connector.decommissioned ← soft delete connector
    ▼
OCPP Service (ChargerSyncService)
    │
    │ 2. upsert หรือ soft-delete ใน panda_ev_ocpp
    │ 3. ถ้า charger กำลัง ONLINE → อัปเดต Redis cache ด้วย
    ▼
OCPP Service พร้อมรับ BootNotification จากตู้ชาร์จ ✓
```

### 2.4 แผนภาพ Data Flow รวม (Combined Architecture)

```
┌──────────────────────────────────────────────────────────────────────────┐
│                                                                          │
│  Admin CSMS (3001)              OCPP CSMS (4002)                        │
│  ─────────────────              ─────────────────                        │
│  panda_ev_system                panda_ev_ocpp                            │
│  ┌─────────────┐                ┌─────────────┐                          │
│  │ chargers    │◄──UPSERT───────│ chargers    │◄──BootNotification       │
│  │ connectors  │   (Auto/Manual)│ connectors  │◄──StatusNotification     │
│  └─────────────┘                └─────────────┘                          │
│        │                               ▲                                 │
│        │ publish                       │ consume                         │
│        ▼                               │                                 │
│  ┌──────────────────────────────────── ┤                                 │
│  │    RabbitMQ: PANDA_EV_CHARGER_SYNC  │                                 │
│  │    (New dedicated queue)            │                                 │
│  └─────────────────────────────────────┘                                │
│                                                                          │
│  Mobile API (4001)  ← ไม่ต้องการ sync — อ่านจาก panda_ev_system โดยตรง │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

### 2.5 การตัดสินใจเลือก Queue

เพิ่ม queue ใหม่ `PANDA_EV_CHARGER_SYNC` แทนที่จะใช้ `PANDA_EV_ADMIN_COMMANDS` ที่มีอยู่แล้ว เพราะ:

| เหตุผล | คำอธิบาย |
|--------|---------|
| **Separation of Concerns** | `PANDA_EV_ADMIN_COMMANDS` ใช้สำหรับ OCPP protocol commands (Reset, GetConfig ฯลฯ) ที่ต้องการ response ภายใน 15 วินาที — sync events ไม่ต้องการ response |
| **DLQ แยกกัน** | Sync events ควรมี retry policy ของตัวเอง (backoff นานกว่า OCPP commands) |
| **Message Volume** | Auto sync จะมีปริมาณ messages มากกว่า — ไม่ควร compete กับ OCPP commands |
| **Consumer Logic** | AdminCommandService ส่ง reply กลับผ่าน Redis — Sync Service ไม่ต้องการ pattern นี้ |

---

## 3. API & Event Specification

### 3.1 RabbitMQ Queue Definition

| Queue | DLQ | Retry | TTL | วัตถุประสงค์ |
|-------|-----|-------|-----|------------|
| `PANDA_EV_CHARGER_SYNC` | `PANDA_EV_CHARGER_SYNC_DLQ` | 3 ครั้ง (10s/60s/300s) | — | Auto sync events |
| `PANDA_EV_CHARGER_SYNC_DLQ` | — | — | 7 วัน | Dead letters ของ sync |

### 3.2 Event Payloads (Auto Sync)

#### charger.provisioned — สร้าง Charger ใหม่

```typescript
interface ChargerProvisionedEvent {
  routingKey: 'charger.provisioned';
  eventId: string;           // uuid4 — ใช้ dedup
  ocppIdentity: string;      // "PANDA-01" — Primary key ของ OCPP
  stationId: string;         // UUID ใน panda_ev_system
  displayName: string;
  isActive: boolean;
  connectors: Array<{
    connectorId: number;     // OCPP connector number (1, 2, ...)
    plugType: 'GBT' | 'CCS2';
    connectorType: string;
    powerOutputKw: number;
    isActive: boolean;
  }>;
  provisionedAt: string;     // ISO 8601 +07:00
  provisionedBy: string;     // admin userId
}
```

**ตัวอย่าง:**
```json
{
  "routingKey": "charger.provisioned",
  "eventId": "550e8400-e29b-41d4-a716-446655440000",
  "ocppIdentity": "PANDA-01",
  "stationId": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
  "displayName": "Panda Charger 01",
  "isActive": true,
  "connectors": [
    { "connectorId": 1, "plugType": "CCS2", "connectorType": "DC_FAST", "powerOutputKw": 120, "isActive": true },
    { "connectorId": 2, "plugType": "GBT", "connectorType": "DC_FAST", "powerOutputKw": 120, "isActive": true }
  ],
  "provisionedAt": "2026-03-24T10:00:00+07:00",
  "provisionedBy": "admin-uuid"
}
```

#### charger.updated — แก้ไข Charger

```typescript
interface ChargerUpdatedEvent {
  routingKey: 'charger.updated';
  eventId: string;
  ocppIdentity: string;      // identity เดิม (ใช้เป็น key lookup)
  newOcppIdentity?: string;  // ถ้าเปลี่ยน identity
  isActive?: boolean;
  updatedAt: string;
  updatedBy: string;
}
```

#### charger.decommissioned — ลบ Charger (Soft Delete)

```typescript
interface ChargerDecommissionedEvent {
  routingKey: 'charger.decommissioned';
  eventId: string;
  ocppIdentity: string;
  decommissionedAt: string;
  decommissionedBy: string;
}
```

#### connector.provisioned — สร้าง Connector ใหม่

```typescript
interface ConnectorProvisionedEvent {
  routingKey: 'connector.provisioned';
  eventId: string;
  ocppIdentity: string;      // ของ charger parent
  connectorId: number;
  plugType: 'GBT' | 'CCS2';
  connectorType: string;
  powerOutputKw: number;
  isActive: boolean;
  provisionedAt: string;
}
```

#### connector.updated

```typescript
interface ConnectorUpdatedEvent {
  routingKey: 'connector.updated';
  eventId: string;
  ocppIdentity: string;
  connectorId: number;
  isActive?: boolean;
  plugType?: string;
  powerOutputKw?: number;
  updatedAt: string;
}
```

#### connector.decommissioned

```typescript
interface ConnectorDecommissionedEvent {
  routingKey: 'connector.decommissioned';
  eventId: string;
  ocppIdentity: string;
  connectorId: number;
  decommissionedAt: string;
}
```

### 3.3 Manual Sync API Endpoints (Admin)

| Method | Endpoint | Permission | คำอธิบาย |
|--------|----------|-----------|---------|
| `POST` | `/stations/:stationId/sync-ocpp` | `stations:manage` | Sync chargers ทั้งสถานีไปยัง OCPP |
| `POST` | `/chargers/:chargerId/sync-ocpp` | `chargers:manage` | Sync charger เดียว |
| `GET` | `/chargers/:chargerId/sync-ocpp/:requestId` | `chargers:read` | ดูสถานะ sync (poll, TTL 60s) |

**Request: POST /chargers/:chargerId/sync-ocpp**
```json
{ }
```
*(ไม่ต้องการ body — ดึงข้อมูลจาก DB เอง)*

**Response:**
```json
{
  "success": true,
  "data": {
    "requestId": "sync-uuid-here",
    "ocppIdentity": "PANDA-01",
    "status": "PENDING",
    "message": "Sync request published to OCPP service"
  }
}
```

**Sync Status Response (GET /sync/:requestId):**
```json
{
  "success": true,
  "data": {
    "requestId": "sync-uuid-here",
    "status": "COMPLETED",
    "ocppIdentity": "PANDA-01",
    "connectorsUpserted": 2,
    "completedAt": "2026-03-24T10:00:05+07:00"
  }
}
```

*(status: `PENDING` | `COMPLETED` | `FAILED` | `EXPIRED`)*

### 3.4 Environment Variables ที่ต้องเพิ่ม

**Admin CSMS (.env):**
```env
RABBITMQ_CHARGER_SYNC_QUEUE=PANDA_EV_CHARGER_SYNC
```

**OCPP Service (.env):**
```env
RABBITMQ_CHARGER_SYNC_QUEUE=PANDA_EV_CHARGER_SYNC
RABBITMQ_CHARGER_SYNC_DLQ=PANDA_EV_CHARGER_SYNC_DLQ
RABBITMQ_CHARGER_SYNC_DLX=PANDA_EV_CHARGER_SYNC_DLX
```

---

## 4. คู่มือการ Implement

### 4.1 Admin CSMS — เพิ่ม Auto Sync ใน ChargerService

**ขั้นตอนที่ 1: Inject RabbitMQService ใน ChargerService**

แก้ไขไฟล์: `panda-ev-csms-system-admin/src/modules/station/services/charger.service.ts`

```typescript
import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../../configs/prisma/prisma.service';
import { CacheService } from '../../../configs/redis/cache.service';
import { RabbitMQService } from '../../../configs/rabbitmq/rabbitmq.service';
import { v4 as uuidv4 } from 'uuid'; // เพิ่ม import
// ... imports อื่น ๆ

const CHARGER_SYNC_QUEUE =
  process.env.RABBITMQ_CHARGER_SYNC_QUEUE ?? 'PANDA_EV_CHARGER_SYNC';

@Injectable()
export class ChargerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly rabbitMQ: RabbitMQService, // ← เพิ่ม
  ) {}

  // ---- create() — เพิ่ม publish หลัง create ----

  async create(stationId: string, dto: CreateChargerDto, userId?: string) {
    await this.verifyStation(stationId);
    // ... validation เดิม ...

    const result = await this.prisma.charger.create({
      data: { stationId, displayName: dto.displayName, ocppIdentity: dto.ocppIdentity, ... },
      include: { connectors: { where: { deletedAt: null } } },
    });

    await this.cache.invalidate('chargers');
    await this.cache.invalidate('connectors');
    await this.cache.invalidate('stations');

    // ✅ Publish charger.provisioned event
    this.rabbitMQ
      .publish(CHARGER_SYNC_QUEUE, {
        routingKey: 'charger.provisioned',
        eventId: uuidv4(),
        ocppIdentity: result.ocppIdentity,
        stationId: result.stationId,
        displayName: result.displayName,
        isActive: result.isActive,
        connectors: (result.connectors ?? []).map((c) => ({
          connectorId: c.connectorId,
          plugType: c.plugType,
          connectorType: c.connectorType,
          powerOutputKw: c.powerOutputKw,
          isActive: c.isActive,
        })),
        provisionedAt: new Date().toISOString(),
        provisionedBy: userId ?? 'system',
      })
      .catch((err: Error) =>
        this.logger.warn(`charger.provisioned publish failed: ${err.message}`),
      ); // soft-fail — ไม่ block response

    return result;
  }

  // ---- update() — publish charger.updated ----

  async update(stationId: string, chargerId: string, dto: UpdateChargerDto, userId?: string) {
    const existing = await this.findOne(stationId, chargerId);
    // ... validation เดิม ...

    const result = await this.prisma.charger.update({
      where: { id: chargerId },
      data: { ...updateData, ...(userId && { updatedBy: { connect: { id: userId } } }) },
      include: defaultInclude,
    });

    await this.cache.invalidate('chargers');
    await this.cache.invalidate('connectors');
    await this.cache.invalidate('stations');

    // ✅ Publish charger.updated — เฉพาะ fields ที่กระทบ OCPP
    const ocppRelevantChanged =
      dto.ocppIdentity !== undefined || dto.isActive !== undefined;

    if (ocppRelevantChanged) {
      this.rabbitMQ
        .publish(CHARGER_SYNC_QUEUE, {
          routingKey: 'charger.updated',
          eventId: uuidv4(),
          ocppIdentity: existing.ocppIdentity, // identity เดิม
          newOcppIdentity: dto.ocppIdentity !== existing.ocppIdentity
            ? dto.ocppIdentity
            : undefined,
          isActive: dto.isActive,
          updatedAt: new Date().toISOString(),
          updatedBy: userId ?? 'system',
        })
        .catch((err: Error) =>
          this.logger.warn(`charger.updated publish failed: ${err.message}`),
        );
    }

    return result;
  }

  // ---- softDelete() — publish charger.decommissioned ----

  async softDelete(stationId: string, chargerId: string, userId?: string) {
    const existing = await this.findOne(stationId, chargerId);

    const result = await this.prisma.charger.update({
      where: { id: chargerId },
      data: { deletedAt: new Date(), updatedById: userId },
    });

    await this.cache.invalidate('chargers');
    await this.cache.invalidate('connectors');
    await this.cache.invalidate('stations');

    // ✅ Publish charger.decommissioned
    this.rabbitMQ
      .publish(CHARGER_SYNC_QUEUE, {
        routingKey: 'charger.decommissioned',
        eventId: uuidv4(),
        ocppIdentity: existing.ocppIdentity,
        decommissionedAt: new Date().toISOString(),
        decommissionedBy: userId ?? 'system',
      })
      .catch((err: Error) =>
        this.logger.warn(`charger.decommissioned publish failed: ${err.message}`),
      );

    return result;
  }

  // ---- syncToOcpp() — Manual Sync (On-Demand) ----

  async syncToOcpp(stationId: string, chargerId: string, userId?: string) {
    const charger = await this.prisma.charger.findFirst({
      where: { id: chargerId, stationId, deletedAt: null },
      include: { connectors: { where: { deletedAt: null } } },
    });

    if (!charger) {
      throw new NotFoundException(i18nMessage('charger.not_found', { id: chargerId }));
    }

    const requestId = `sync:${charger.ocppIdentity}:${uuidv4().slice(0, 8)}`;

    await this.rabbitMQ.publish(CHARGER_SYNC_QUEUE, {
      routingKey: 'charger.sync_requested',
      eventId: uuidv4(),
      requestId,                          // ← ใช้ poll result
      ocppIdentity: charger.ocppIdentity,
      stationId: charger.stationId,
      displayName: charger.displayName,
      isActive: charger.isActive,
      connectors: charger.connectors.map((c) => ({
        connectorId: c.connectorId,
        plugType: c.plugType,
        connectorType: c.connectorType,
        powerOutputKw: c.powerOutputKw,
        isActive: c.isActive,
      })),
      requestedAt: new Date().toISOString(),
      requestedBy: userId ?? 'system',
    });

    return {
      requestId,
      ocppIdentity: charger.ocppIdentity,
      status: 'PENDING',
      message: 'Sync request published to OCPP service',
    };
  }

  // ---- getSyncStatus() — Poll ผลลัพธ์จาก Redis ----

  async getSyncStatus(requestId: string) {
    const key = `ocpp:sync:result:${requestId}`;
    const raw = await this.cache.get<string>('__raw', key);

    if (!raw) {
      return { requestId, status: 'PENDING', message: 'Waiting for OCPP service response' };
    }

    return JSON.parse(raw as unknown as string);
  }
}
```

---

### 4.2 Admin CSMS — เพิ่ม Auto Sync ใน ConnectorService

แก้ไขไฟล์: `panda-ev-csms-system-admin/src/modules/station/services/connector.service.ts`

```typescript
// เพิ่ม dependency injection
constructor(
  private readonly prisma: PrismaService,
  private readonly cache: CacheService,
  private readonly rabbitMQ: RabbitMQService, // ← เพิ่ม
) {}

// ---- create() — เพิ่ม publish ----

async create(stationId: string, chargerId: string, dto: CreateConnectorDto, userId?: string) {
  const charger = await this.verifyCharger(stationId, chargerId);
  // ... validation เดิม ...

  const result = await this.prisma.connector.create({ data: { ... } });

  await this.cache.invalidate('connectors');
  await this.cache.invalidate('chargers');
  await this.cache.invalidate('stations');

  // ✅ Publish connector.provisioned
  this.rabbitMQ
    .publish(CHARGER_SYNC_QUEUE, {
      routingKey: 'connector.provisioned',
      eventId: uuidv4(),
      ocppIdentity: charger.ocppIdentity,  // ← charger parent's identity
      connectorId: result.connectorId,
      plugType: result.plugType,
      connectorType: result.connectorType,
      powerOutputKw: result.powerOutputKw,
      isActive: result.isActive,
      provisionedAt: new Date().toISOString(),
    })
    .catch(() => {}); // soft-fail

  return result;
}

// ---- update() ----
async update(...) {
  // ... เดิม ...
  // ✅ Publish connector.updated (เฉพาะ fields ที่เปลี่ยน)
  this.rabbitMQ.publish(CHARGER_SYNC_QUEUE, {
    routingKey: 'connector.updated',
    eventId: uuidv4(),
    ocppIdentity: charger.ocppIdentity,
    connectorId: existing.connectorId,
    isActive: dto.isActive,
    plugType: dto.plugType,
    powerOutputKw: dto.powerOutputKw,
    updatedAt: new Date().toISOString(),
  }).catch(() => {});
}

// ---- softDelete() ----
async softDelete(...) {
  // ... เดิม ...
  this.rabbitMQ.publish(CHARGER_SYNC_QUEUE, {
    routingKey: 'connector.decommissioned',
    eventId: uuidv4(),
    ocppIdentity: charger.ocppIdentity,
    connectorId: connector.connectorId,
    decommissionedAt: new Date().toISOString(),
  }).catch(() => {});
}
```

---

### 4.3 Admin CSMS — เพิ่ม Sync Endpoints ใน ChargerCommand Controller

แก้ไขไฟล์: `panda-ev-csms-system-admin/src/modules/station/controllers/charger-command.controller.ts`

```typescript
@Post(':chargerId/sync-ocpp')
@RequirePermissions('chargers:manage')
async syncToOcpp(
  @Param('stationId') stationId: string,
  @Param('chargerId') chargerId: string,
  @CurrentUser('id') userId: string,
) {
  return this.chargerService.syncToOcpp(stationId, chargerId, userId);
}

@Get(':chargerId/sync-ocpp/:requestId')
@RequirePermissions('chargers:read')
async getSyncStatus(@Param('requestId') requestId: string) {
  return this.chargerService.getSyncStatus(requestId);
}
```

---

### 4.4 Admin CSMS — Station.module.ts (ตรวจสอบ RabbitMQModule)

ตรวจสอบ (หรืออัปเดต) `panda-ev-csms-system-admin/src/modules/station/station.module.ts`:

```typescript
@Module({
  imports: [RabbitMQModule],   // ← ต้องมีบรรทัดนี้ (เพิ่มไว้แล้วในเซสชันก่อน)
  controllers: [StationController, ChargerCommandController, ChargerDashboardController, AmenityController],
  providers: [StationService, ChargerService, ConnectorService, AmenityService, StationPromotionService, ChargerLiveStatusService, OcppCommandService],
  exports: [StationService, ChargerService],
})
export class StationModule {}
```

---

### 4.5 OCPP Service — สร้าง ChargerSyncService ใหม่

สร้างไฟล์ใหม่: `panda-ev-ocpp/src/modules/ocpp/services/charger-sync.service.ts`

```typescript
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../../configs/prisma/prisma.service';
import { RabbitMQService } from '../../../configs/rabbitmq/rabbitmq.service';
import { RedisService } from '../../../configs/redis/redis.service';
import { ConnectorStatus } from '../../../../generated/prisma/client';
import { v4 as uuidv4 } from 'uuid';

const SYNC_QUEUE =
  process.env.RABBITMQ_CHARGER_SYNC_QUEUE ?? 'PANDA_EV_CHARGER_SYNC';

@Injectable()
export class ChargerSyncService implements OnModuleInit {
  private readonly logger = new Logger(ChargerSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly rabbitMQ: RabbitMQService,
    private readonly redis: RedisService,
  ) {}

  async onModuleInit() {
    await this.rabbitMQ.consume(SYNC_QUEUE, this.handleSyncMessage.bind(this));
    this.logger.log(`Listening on ${SYNC_QUEUE} for charger sync events`);
  }

  // ── Message Router ──────────────────────────────────────────────────────────

  private async handleSyncMessage(message: Record<string, unknown>): Promise<void> {
    const routingKey = message.routingKey as string;

    this.logger.log(`ChargerSync received: ${routingKey}`);

    switch (routingKey) {
      case 'charger.provisioned':
      case 'charger.sync_requested':
        await this.upsertCharger(message);
        break;

      case 'charger.updated':
        await this.updateCharger(message);
        break;

      case 'charger.decommissioned':
        await this.decommissionCharger(message);
        break;

      case 'connector.provisioned':
        await this.upsertConnector(message);
        break;

      case 'connector.updated':
        await this.updateConnector(message);
        break;

      case 'connector.decommissioned':
        await this.decommissionConnector(message);
        break;

      default:
        this.logger.warn(`ChargerSync: unknown routingKey ${routingKey}`);
    }
  }

  // ── Handlers ─────────────────────────────────────────────────────────────────

  private async upsertCharger(message: Record<string, unknown>): Promise<void> {
    const {
      ocppIdentity,
      stationId,
      displayName,
      isActive,
      connectors = [],
      requestId,
    } = message as {
      ocppIdentity: string;
      stationId: string;
      displayName: string;
      isActive: boolean;
      connectors: Array<{
        connectorId: number;
        plugType: string;
        connectorType: string;
        powerOutputKw: number;
        isActive: boolean;
      }>;
      requestId?: string;
    };

    try {
      // Upsert charger — ใช้ ocppIdentity เป็น unique key
      const charger = await this.prisma.charger.upsert({
        where: { ocppIdentity },
        update: {
          stationId,
          displayName,
          isActive,
          updatedAt: new Date(),
        },
        create: {
          id: uuidv4(),
          stationId,
          ocppIdentity,
          displayName,
          isActive,
          status: 'OFFLINE', // ค่าเริ่มต้น — จะเปลี่ยนเมื่อ BootNotification มาถึง
        },
      });

      this.logger.log(`Charger upserted: ${ocppIdentity} (id=${charger.id})`);

      // Upsert connectors
      let connectorsUpserted = 0;
      for (const c of connectors as typeof connectors) {
        await this.prisma.connector.upsert({
          where: {
            chargerId_connectorId: {
              chargerId: charger.id,
              connectorId: c.connectorId,
            },
          },
          update: {
            plugType: c.plugType as 'GBT' | 'CCS2',
            connectorType: c.connectorType as any,
            powerOutputKw: c.powerOutputKw,
            isActive: c.isActive,
            updatedAt: new Date(),
          },
          create: {
            id: uuidv4(),
            chargerId: charger.id,
            connectorId: c.connectorId,
            plugType: c.plugType as 'GBT' | 'CCS2',
            connectorType: c.connectorType as any,
            powerOutputKw: c.powerOutputKw,
            isActive: c.isActive,
            status: ConnectorStatus.AVAILABLE,
          },
        });
        connectorsUpserted++;
      }

      this.logger.log(
        `Sync complete: ${ocppIdentity} — ${connectorsUpserted} connectors upserted`,
      );

      // ถ้าเป็น Manual sync → เก็บผลลัพธ์ใน Redis (TTL 60s)
      if (requestId) {
        await this.redis.set(
          `ocpp:sync:result:${requestId}`,
          JSON.stringify({
            requestId,
            status: 'COMPLETED',
            ocppIdentity,
            connectorsUpserted,
            completedAt: new Date().toISOString(),
          }),
          60, // TTL 60 วินาที
        );
      }
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.logger.error(`upsertCharger failed for ${ocppIdentity}: ${errorMsg}`);

      if (requestId) {
        await this.redis.set(
          `ocpp:sync:result:${requestId}`,
          JSON.stringify({
            requestId,
            status: 'FAILED',
            ocppIdentity,
            error: errorMsg,
            completedAt: new Date().toISOString(),
          }),
          60,
        );
      }

      throw err; // ให้ RabbitMQ retry
    }
  }

  private async updateCharger(message: Record<string, unknown>): Promise<void> {
    const { ocppIdentity, newOcppIdentity, isActive } = message as {
      ocppIdentity: string;
      newOcppIdentity?: string;
      isActive?: boolean;
    };

    await this.prisma.charger.updateMany({
      where: { ocppIdentity },
      data: {
        ...(newOcppIdentity && { ocppIdentity: newOcppIdentity }),
        ...(isActive !== undefined && { isActive }),
        updatedAt: new Date(),
      },
    });

    this.logger.log(`Charger updated: ${ocppIdentity}${newOcppIdentity ? ` → ${newOcppIdentity}` : ''}`);
  }

  private async decommissionCharger(message: Record<string, unknown>): Promise<void> {
    const { ocppIdentity } = message as { ocppIdentity: string };

    await this.prisma.charger.updateMany({
      where: { ocppIdentity },
      data: { deletedAt: new Date(), isActive: false },
    });

    this.logger.log(`Charger decommissioned: ${ocppIdentity}`);
  }

  private async upsertConnector(message: Record<string, unknown>): Promise<void> {
    const { ocppIdentity, connectorId, plugType, connectorType, powerOutputKw, isActive } =
      message as {
        ocppIdentity: string;
        connectorId: number;
        plugType: string;
        connectorType: string;
        powerOutputKw: number;
        isActive: boolean;
      };

    const charger = await this.prisma.charger.findUnique({
      where: { ocppIdentity },
    });

    if (!charger) {
      this.logger.warn(`connector.provisioned — charger not found: ${ocppIdentity}`);
      return; // charger ยังไม่ sync — connector event จะมาทีหลัง หรือใช้ retry
    }

    await this.prisma.connector.upsert({
      where: { chargerId_connectorId: { chargerId: charger.id, connectorId } },
      update: { plugType: plugType as any, connectorType: connectorType as any, powerOutputKw, isActive },
      create: {
        id: uuidv4(),
        chargerId: charger.id,
        connectorId,
        plugType: plugType as any,
        connectorType: connectorType as any,
        powerOutputKw,
        isActive,
        status: ConnectorStatus.AVAILABLE,
      },
    });

    this.logger.log(`Connector upserted: ${ocppIdentity}:${connectorId}`);
  }

  private async updateConnector(message: Record<string, unknown>): Promise<void> {
    const { ocppIdentity, connectorId, isActive, plugType, powerOutputKw } = message as {
      ocppIdentity: string;
      connectorId: number;
      isActive?: boolean;
      plugType?: string;
      powerOutputKw?: number;
    };

    const charger = await this.prisma.charger.findUnique({ where: { ocppIdentity } });
    if (!charger) return;

    await this.prisma.connector.updateMany({
      where: { chargerId: charger.id, connectorId },
      data: {
        ...(isActive !== undefined && { isActive }),
        ...(plugType && { plugType: plugType as any }),
        ...(powerOutputKw && { powerOutputKw }),
      },
    });
  }

  private async decommissionConnector(message: Record<string, unknown>): Promise<void> {
    const { ocppIdentity, connectorId } = message as {
      ocppIdentity: string;
      connectorId: number;
    };

    const charger = await this.prisma.charger.findUnique({ where: { ocppIdentity } });
    if (!charger) return;

    await this.prisma.connector.updateMany({
      where: { chargerId: charger.id, connectorId },
      data: { deletedAt: new Date(), isActive: false },
    });

    this.logger.log(`Connector decommissioned: ${ocppIdentity}:${connectorId}`);
  }
}
```

---

### 4.6 OCPP Service — ลงทะเบียน ChargerSyncService ใน OcppModule

แก้ไขไฟล์: `panda-ev-ocpp/src/modules/ocpp/ocpp.module.ts`

```typescript
import { Module } from '@nestjs/common';
import { OcppGateway } from './ocpp.gateway';
import { OcppService } from './ocpp.service';
import { AdminCommandService } from './services/admin-command.service';
import { SessionService } from './services/session.service';
import { ChargerSyncService } from './services/charger-sync.service'; // ← เพิ่ม

@Module({
  providers: [
    OcppGateway,
    OcppService,
    SessionService,
    AdminCommandService,
    ChargerSyncService, // ← เพิ่ม
  ],
})
export class OcppModule {}
```

---

### 4.7 OCPP Service — เพิ่ม DLX/DLQ Setup ใน RabbitMQService

เพิ่มการตั้งค่า queue ใน `panda-ev-ocpp/src/configs/rabbitmq/rabbitmq.service.ts`:

```typescript
// ใน setupQueues() หรือ onModuleInit() ของ OCPP RabbitMQService

const SYNC_QUEUE = process.env.RABBITMQ_CHARGER_SYNC_QUEUE ?? 'PANDA_EV_CHARGER_SYNC';
const SYNC_DLQ = process.env.RABBITMQ_CHARGER_SYNC_DLQ ?? 'PANDA_EV_CHARGER_SYNC_DLQ';
const SYNC_DLX = process.env.RABBITMQ_CHARGER_SYNC_DLX ?? 'PANDA_EV_CHARGER_SYNC_DLX';

// Dead-letter exchange
await channel.assertExchange(SYNC_DLX, 'fanout', { durable: true });

// Dead-letter queue
await channel.assertQueue(SYNC_DLQ, {
  durable: true,
  arguments: { 'x-message-ttl': 7 * 24 * 60 * 60 * 1000 }, // 7 วัน
});
await channel.bindQueue(SYNC_DLQ, SYNC_DLX, '');

// Main sync queue — retry backoff 10s/60s/300s
await channel.assertQueue(SYNC_QUEUE, {
  durable: true,
  arguments: {
    'x-dead-letter-exchange': SYNC_DLX,
    'x-message-ttl': 300_000, // max wait 5 นาที
  },
});
```

---

### 4.8 Mobile App — ไม่ต้องเปลี่ยนแปลง + Cache Strategy

Mobile ไม่ต้องการ sync mechanism สำหรับ charger configuration แต่ควรทำ **Cache Invalidation** ให้ครบถ้วน:

#### Cache Invalidation ปัจจุบัน (ตรวจสอบแล้ว ✅)

ในฝั่ง Admin เมื่อ charger เปลี่ยน:
```typescript
await this.cache.invalidate('chargers');   // ✅ ทำอยู่แล้ว
await this.cache.invalidate('connectors'); // ✅ ทำอยู่แล้ว
await this.cache.invalidate('stations');   // ✅ ทำอยู่แล้ว
```

แต่ cache เหล่านี้เป็น **Admin's Redis cache** — Mobile ใช้ `SystemDbService` ซึ่ง query ตรงจาก `panda_ev_system` ผ่าน raw Pool และ cache ใน **Mobile's Redis**

#### เพิ่ม Event Invalidation ใน Mobile

เมื่อ Admin เปลี่ยน Charger data ควร publish `PANDA_EV_SYSTEM_EVENTS` ด้วย:

```typescript
// ใน Admin ChargerService.create() / update() / softDelete()
// เพิ่มหลัง publish charger sync event

this.rabbitMQ
  .publish('PANDA_EV_SYSTEM_EVENTS', {
    routingKey: 'charger.invalidate',
    stationId: result.stationId, // ← Mobile จะ invalidate cache ของสถานีนี้
    ocppIdentity: result.ocppIdentity,
    timestamp: new Date().toISOString(),
  })
  .catch(() => {}); // soft-fail
```

จากนั้นใน **Mobile API** `OcppConsumerService` (หรือ `ContentService`):

```typescript
// ใน Mobile: รับ charger.invalidate event → ล้าง station cache
case 'charger.invalidate': {
  const { stationId } = message as { stationId: string };
  await this.redis.del(`station:detail:${stationId}`);
  await this.cache.invalidate('station:list');
  break;
}
```

#### Best Practices สำหรับ Mobile Data Freshness

| กลไก | TTL | เมื่อไหร่ |
|------|-----|---------|
| Station list cache | 2 นาที | ทุก request (auto-expire) |
| Station detail cache | 5 นาที | ทุก request (auto-expire) |
| Charger live status (Redis) | 600 วินาที | เขียนโดย OCPP ทุก StatusNotification |
| Pull-to-refresh (Mobile App) | — | User action → invalidate + refetch |
| Cache invalidation via RabbitMQ | — | Admin เปลี่ยนข้อมูล |

---

## 5. กลยุทธ์การทดสอบ

### 5.1 Unit Tests

#### ทดสอบ ChargerService (Admin) — ต้อง mock RabbitMQService

```typescript
// panda-ev-csms-system-admin/src/modules/station/services/charger.service.spec.ts

describe('ChargerService', () => {
  let service: ChargerService;
  let mockRabbitMQ: { publish: jest.Mock };
  let mockPrisma: DeepMockProxy<PrismaClient>;

  beforeEach(async () => {
    mockRabbitMQ = { publish: jest.fn().mockResolvedValue(undefined) };

    const module = await Test.createTestingModule({
      providers: [
        ChargerService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: CacheService, useValue: { invalidate: jest.fn(), get: jest.fn(), set: jest.fn() } },
        { provide: RabbitMQService, useValue: mockRabbitMQ },
      ],
    }).compile();

    service = module.get<ChargerService>(ChargerService);
  });

  it('should publish charger.provisioned after create', async () => {
    mockPrisma.charger.create.mockResolvedValue({
      id: 'uuid', ocppIdentity: 'PANDA-01', stationId: 'station-uuid',
      displayName: 'Test', isActive: true, connectors: [],
    } as any);

    await service.create('station-uuid', {
      displayName: 'Test', ocppIdentity: 'PANDA-01',
    } as any, 'admin-uuid');

    expect(mockRabbitMQ.publish).toHaveBeenCalledWith(
      'PANDA_EV_CHARGER_SYNC',
      expect.objectContaining({
        routingKey: 'charger.provisioned',
        ocppIdentity: 'PANDA-01',
      }),
    );
  });

  it('should publish charger.decommissioned on softDelete', async () => {
    // ... mock findOne ...
    await service.softDelete('station-uuid', 'charger-uuid', 'admin-uuid');

    expect(mockRabbitMQ.publish).toHaveBeenCalledWith(
      'PANDA_EV_CHARGER_SYNC',
      expect.objectContaining({ routingKey: 'charger.decommissioned' }),
    );
  });

  it('should soft-fail if RabbitMQ publish throws', async () => {
    mockRabbitMQ.publish.mockRejectedValue(new Error('Connection refused'));
    mockPrisma.charger.create.mockResolvedValue({ connectors: [] } as any);

    // ไม่ควร throw — soft-fail ด้วย .catch()
    await expect(
      service.create('station-uuid', { ocppIdentity: 'PANDA-01' } as any),
    ).resolves.not.toThrow();
  });
});
```

#### ทดสอบ ChargerSyncService (OCPP)

```typescript
// panda-ev-ocpp/src/modules/ocpp/services/charger-sync.service.spec.ts

describe('ChargerSyncService', () => {
  let service: ChargerSyncService;
  let mockPrisma: { charger: { upsert: jest.Mock }; connector: { upsert: jest.Mock } };

  it('should upsert charger and connectors on charger.provisioned', async () => {
    mockPrisma.charger.upsert.mockResolvedValue({ id: 'ocpp-charger-uuid' });
    mockPrisma.connector.upsert.mockResolvedValue({});

    await service['upsertCharger']({
      routingKey: 'charger.provisioned',
      ocppIdentity: 'PANDA-01',
      stationId: 'uuid',
      displayName: 'Test',
      isActive: true,
      connectors: [
        { connectorId: 1, plugType: 'CCS2', connectorType: 'DC_FAST', powerOutputKw: 120, isActive: true },
      ],
    });

    expect(mockPrisma.charger.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { ocppIdentity: 'PANDA-01' },
        create: expect.objectContaining({ ocppIdentity: 'PANDA-01', status: 'OFFLINE' }),
      }),
    );
    expect(mockPrisma.connector.upsert).toHaveBeenCalledTimes(1);
  });

  it('should set sync result in Redis when requestId provided', async () => {
    const mockRedis = { set: jest.fn() };
    // ... setup ...

    await service['upsertCharger']({
      routingKey: 'charger.sync_requested',
      requestId: 'sync-PANDA-01-abc123',
      ocppIdentity: 'PANDA-01',
      connectors: [],
      // ...
    });

    expect(mockRedis.set).toHaveBeenCalledWith(
      'ocpp:sync:result:sync-PANDA-01-abc123',
      expect.stringContaining('"status":"COMPLETED"'),
      60,
    );
  });
});
```

---

### 5.2 Integration Test — Full Sync Flow

```bash
#!/bin/bash
# scripts/test-charger-sync.sh

echo "=== ทดสอบ Data Sync Flow ==="

ADMIN_TOKEN=$(curl -s -X POST http://localhost:3001/api/admin/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@pandaev.com","password":"Admin@123456"}' | jq -r .data.accessToken)

# 1. ตรวจสอบว่า charger identity ยังไม่อยู่ใน OCPP DB
echo "1. ตรวจสอบ OCPP DB ก่อน sync..."
docker exec pandaev_postgres psql -U postgres -d panda_ev_ocpp_db \
  -c "SELECT ocpp_identity, status FROM panda_ev_ocpp.chargers WHERE ocpp_identity = 'TEST-SYNC-01';"
# Expected: 0 rows

# 2. สร้าง Charger ใน Admin
echo "2. สร้าง Charger ใน Admin..."
STATION_ID="your-station-uuid-here"
RESPONSE=$(curl -s -X POST "http://localhost:3001/api/admin/v1/stations/$STATION_ID/chargers" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "displayName": "Test Sync 01",
    "ocppIdentity": "TEST-SYNC-01",
    "isActive": true
  }')
echo "Admin response: $(echo $RESPONSE | jq .success)"

# 3. รอ 2 วินาที ให้ event ส่งผ่าน RabbitMQ
echo "3. รอ event propagation..."
sleep 2

# 4. ตรวจสอบว่า charger ปรากฏใน OCPP DB แล้ว
echo "4. ตรวจสอบ OCPP DB หลัง auto sync..."
docker exec pandaev_postgres psql -U postgres -d panda_ev_ocpp_db \
  -c "SELECT ocpp_identity, status, is_active FROM panda_ev_ocpp.chargers WHERE ocpp_identity = 'TEST-SYNC-01';"
# Expected: 1 row, status=OFFLINE, is_active=true

# 5. ทดสอบ VCP connection
echo "5. ทดสอบ BootNotification จาก VCP..."
curl -s -X POST http://localhost:9999/execute \
  -H "Content-Type: application/json" \
  -d '{"action":"BootNotification","payload":{"chargePointModel":"SGIC-DC-120","chargePointVendor":"SGIC"}}'
# Expected: ACCEPTED (ไม่ใช่ REJECTED)

echo "=== ทดสอบเสร็จสิ้น ==="
```

---

### 5.3 ตรวจสอบ Data Consistency ด้วย SQL

```sql
-- ตรวจสอบ chargers ที่อยู่ใน Admin แต่ไม่อยู่ใน OCPP (ยังไม่ sync)
SELECT
  a.ocpp_identity,
  a.display_name,
  a.created_at,
  a.deleted_at
FROM panda_ev_system.chargers a
LEFT JOIN panda_ev_ocpp.chargers o ON a.ocpp_identity = o.ocpp_identity
WHERE o.ocpp_identity IS NULL
  AND a.deleted_at IS NULL;

-- ตรวจสอบ connectors ที่ไม่ match ระหว่างสอง DB
SELECT
  a_c.charger_id AS admin_charger,
  a.ocpp_identity,
  a_c.connector_id,
  o_c.connector_id AS ocpp_connector
FROM panda_ev_system.connectors a_c
JOIN panda_ev_system.chargers a ON a_c.charger_id = a.id
LEFT JOIN panda_ev_ocpp.chargers o ON a.ocpp_identity = o.ocpp_identity
LEFT JOIN panda_ev_ocpp.connectors o_c
  ON o.id = o_c.charger_id AND a_c.connector_id = o_c.connector_id
WHERE a_c.deleted_at IS NULL
  AND (o.id IS NULL OR o_c.connector_id IS NULL);
```

---

### 5.4 ตรวจสอบ RabbitMQ Queue Health

```bash
# ตรวจสอบจำนวน messages ใน PANDA_EV_CHARGER_SYNC queue
curl -s -u guest:guest http://localhost:15672/api/queues/%2F/PANDA_EV_CHARGER_SYNC | jq '{
  messages: .messages,
  messages_ready: .messages_ready,
  messages_unacknowledged: .messages_unacknowledged,
  consumers: .consumers
}'

# ดู DLQ ว่ามี failed messages หรือไม่
curl -s -u guest:guest http://localhost:15672/api/queues/%2F/PANDA_EV_CHARGER_SYNC_DLQ \
  | jq '.messages'
# Expected: 0 (ไม่มี failed messages)
```

---

## 6. คำแนะนำสำหรับ Production

### 6.1 ลำดับความสำคัญในการ Implement

| Phase | งาน | เวลาโดยประมาณ |
|-------|-----|-------------|
| **Phase 1 — Critical Fix** | Implement Auto Sync (Approach B) ทั้ง ChargerService + ConnectorService + ChargerSyncService | ~1 วัน |
| **Phase 2 — Recovery Tool** | เพิ่ม Manual Sync endpoint + Poll result | ~0.5 วัน |
| **Phase 3 — Full Coverage** | Migration script sync chargers ที่มีอยู่แล้ว + Unit tests | ~0.5 วัน |
| **Phase 4 — Monitoring** | DLQ alert + metrics | ต่อไป |

### 6.2 Migration Script — Sync Chargers ที่มีอยู่แล้ว

หลัง deploy code ใหม่แล้ว ต้อง sync chargers ที่สร้างไว้ก่อนหน้านี้ด้วย:

```typescript
// scripts/migrate-sync-existing-chargers.ts
// รันครั้งเดียวหลัง deploy: npx ts-node scripts/migrate-sync-existing-chargers.ts

import { PrismaClient } from '../panda-ev-csms-system-admin/generated/prisma/client';
import amqp from 'amqplib';
import { v4 as uuidv4 } from 'uuid';

async function main() {
  const prisma = new PrismaClient();
  const conn = await amqp.connect(process.env.RABBITMQ_URL!);
  const ch = await conn.createChannel();

  const chargers = await prisma.charger.findMany({
    where: { deletedAt: null, isActive: true },
    include: { connectors: { where: { deletedAt: null } } },
  });

  console.log(`Found ${chargers.length} chargers to sync`);

  for (const charger of chargers) {
    const payload = {
      routingKey: 'charger.provisioned',
      eventId: uuidv4(),
      ocppIdentity: charger.ocppIdentity,
      stationId: charger.stationId,
      displayName: charger.displayName,
      isActive: charger.isActive,
      connectors: charger.connectors.map((c) => ({
        connectorId: c.connectorId,
        plugType: c.plugType,
        connectorType: c.connectorType,
        powerOutputKw: c.powerOutputKw,
        isActive: c.isActive,
      })),
      provisionedAt: new Date().toISOString(),
      provisionedBy: 'migration-script',
    };

    ch.sendToQueue(
      'PANDA_EV_CHARGER_SYNC',
      Buffer.from(JSON.stringify(payload)),
      { persistent: true },
    );

    console.log(`Queued: ${charger.ocppIdentity}`);
    await new Promise((r) => setTimeout(r, 100)); // ชะลอ 100ms ระหว่าง message
  }

  await ch.close();
  await conn.close();
  await prisma.$disconnect();
  console.log('Migration complete');
}

main().catch(console.error);
```

### 6.3 Idempotency — ป้องกัน Duplicate Events

`ChargerSyncService` ใช้ Prisma `upsert()` ซึ่ง idempotent โดยธรรมชาติ แต่ถ้าต้องการป้องกัน event ซ้ำแบบ strict:

```typescript
// เพิ่ม dedup check ใน upsertCharger()
const dedupKey = `sync:dedup:${message.eventId}`;
const alreadyProcessed = await this.redis.get(dedupKey);
if (alreadyProcessed) {
  this.logger.debug(`Duplicate event ignored: ${message.eventId}`);
  return;
}
await this.redis.set(dedupKey, '1', 3600); // TTL 1 ชั่วโมง
// ... ดำเนินการต่อ
```

### 6.4 Observability — Metrics ที่ควรติดตาม

| Metric | เกณฑ์เตือน | วิธีตรวจสอบ |
|--------|-----------|------------|
| `PANDA_EV_CHARGER_SYNC` queue depth | > 10 messages รอ > 30 วินาที | RabbitMQ Management API |
| `PANDA_EV_CHARGER_SYNC_DLQ` message count | > 0 | RabbitMQ Management API |
| Charger sync failure rate | > 1% | Log: `ChargerSync failed:` |
| Admin/OCPP identity mismatch | > 0 chargers | SQL consistency check ทุกชั่วโมง |

### 6.5 Best Practices สรุป

```
✅ ใช้ upsert() ไม่ใช่ insert() — ป้องกัน race condition
✅ Soft-fail RabbitMQ publish ใน Admin — ไม่ block response ของผู้ใช้
✅ DLQ + retry สำหรับ failed sync — ไม่ทำให้ data หาย
✅ eventId ใน payload — ช่วย dedup และ debug
✅ ocppIdentity เป็น primary lookup key ระหว่าง Admin ↔ OCPP (ไม่ใช่ UUID)
✅ Migration script สำหรับ backfill chargers เก่า
✅ Redis TTL สำหรับ sync result (ไม่ใช่ DB) — ลด overhead

❌ อย่า call OCPP service โดยตรงผ่าน HTTP — tight coupling + sync ล้มเหลวถ้า OCPP down
❌ อย่า block response รอผล sync — user experience แย่ลง
❌ อย่าใช้ PANDA_EV_ADMIN_COMMANDS queue สำหรับ sync — mix concerns
❌ อย่า sync ทุก field — เฉพาะ fields ที่ OCPP ต้องการ (ocppIdentity, isActive, connectors)
```

---

## สรุป (Executive Summary)

| ปัญหา | สาเหตุ | วิธีแก้ไข |
|-------|--------|---------|
| Charger ถูก REJECTED ใน OCPP | `panda_ev_ocpp.chargers` ว่างเปล่า | Auto Sync ด้วย `charger.provisioned` event |
| Connector ไม่อัปเดต | ไม่มี event เมื่อเพิ่ม connector | Auto Sync ด้วย `connector.provisioned` event |
| Recovery หลัง outage | ไม่มี manual sync | `POST /chargers/:id/sync-ocpp` endpoint |
| Chargers เก่าก่อน deploy | ยังไม่เคย sync | Migration script |
| Mobile cache stale | ไม่มี invalidation | RabbitMQ `charger.invalidate` event |

**ขนาดการเปลี่ยนแปลง:** 2 services, 4 files แก้ไข, 1 file ใหม่ (ChargerSyncService) — **ไม่กระทบ existing functionality**

---

*เอกสารนี้จัดทำโดยการวิเคราะห์ source code โดยตรงจาก `ocpp.service.ts`, `charger.service.ts`, และ `connector.service.ts` — อ้างอิงบรรทัดที่แน่นอนในโค้ดต้นฉบับ*
