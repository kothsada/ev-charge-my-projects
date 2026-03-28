# Panda EV — System Performance & Data Consistency Audit Report

> **วันที่ออกรายงาน:** 2026-03-25
> **ผู้วิเคราะห์:** Senior System Architect & Performance Engineering Lead
> **เวอร์ชัน:** 1.0
> **ขอบเขต:** panda-ev-ocpp · panda-ev-csms-system-admin · panda-ev-client-mobile · panda-ev-notification

---

## สารบัญ

1. [Executive Summary — สรุปสถานะระบบ](#1-executive-summary)
2. [Performance Audit Report — รายงานประสิทธิภาพรายเซอร์วิส](#2-performance-audit-report)
3. [Data Sync & Consistency Analysis — การวิเคราะห์การไหลของข้อมูล](#3-data-sync--consistency-analysis)
4. [Critical Issues List — รายการปัญหาวิกฤต](#4-critical-issues-list)
5. [Prioritized Roadmap — แผนงานแก้ไขตามลำดับความสำคัญ](#5-prioritized-roadmap)
6. [Recommendations — คำแนะนำสำหรับความเสถียรและการ Scale](#6-recommendations)

---

## 1. Executive Summary

### สถานะสุขภาพระบบโดยรวม

```
┌─────────────────────────────────────────────────────────────────┐
│  OVERALL SYSTEM HEALTH: ⚠️  WARNING — NOT PRODUCTION READY      │
├─────────────────┬──────────────────┬───────────────────────────┤
│  Service        │  Health Score    │  Status                   │
├─────────────────┼──────────────────┼───────────────────────────┤
│  OCPP Service   │  6.5 / 10        │  ⚠️  Major Gaps            │
│  Admin (CSMS)   │  7.0 / 10        │  ⚠️  Minor Issues          │
│  Mobile API     │  5.0 / 10        │  🔴 Critical Bugs          │
│  Notification   │  6.0 / 10        │  ⚠️  Security Gap          │
└─────────────────┴──────────────────┴───────────────────────────┘
```

### ข้อสรุประดับผู้บริหาร

ระบบ Panda EV มีสถาปัตยกรรมที่ออกแบบมาอย่างดีในระดับ macro (Event-driven, CQRS-like, Redis caching) แต่มี **ช่องโหว่วิกฤต 6 จุด** ที่สามารถก่อให้เกิดความเสียหายทางการเงินและความปลอดภัยได้โดยตรงในสภาพแวดล้อม production:

| ระดับ | จำนวนปัญหา | ความเสี่ยง |
|------|-----------|---------|
| 🔴 Critical | 6 | เสียหายทางการเงิน / ช่องโหว่ด้านความปลอดภัย |
| 🟠 High | 5 | ข้อมูลไม่สอดคล้องกัน / session ค้าง |
| 🟡 Medium | 13 | ประสิทธิภาพต่ำ / risk ของ edge case |
| 🟢 Low | 6 | การปรับปรุงเพิ่มเติม |

**คำแนะนำเร่งด่วน:** ระงับการ deploy สู่ production จนกว่าจะแก้ไขปัญหาระดับ Critical ทั้ง 6 จุดเสร็จสิ้น

---

## 2. Performance Audit Report

### 2.1 Database — การวิเคราะห์ฐานข้อมูล

#### 2.1.1 Prisma Connection Pool (ทุกเซอร์วิส)

**ปัญหา:** ทุกเซอร์วิสใช้ `PrismaService` แบบ default โดยไม่มีการกำหนด pool configuration

```typescript
// ปัจจุบัน — ทุกเซอร์วิส (prisma.service.ts)
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  async onModuleInit() {
    await this.$connect(); // default pool = 10 connections
  }
}
```

ที่ขาดไป:
```typescript
// ควรเพิ่ม
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: `${process.env.DATABASE_URL}?connection_limit=25&pool_timeout=10`,
    },
  },
  log: process.env.NODE_ENV === 'development' ? ['query', 'warn', 'error'] : ['warn', 'error'],
});
```

**ผลกระทบ:** ภายใต้ load สูง (เช่น 100 concurrent users เริ่มชาร์จพร้อมกัน) connection pool จะตายกลึง ทำให้ query timeout

#### 2.1.2 Missing Indexes ที่วิกฤต

**Admin Schema (`panda_ev_system`)**

```sql
-- ขาดทั้งหมด — ควรเพิ่ม
CREATE INDEX CONCURRENTLY idx_chargers_station_id ON panda_ev_system.chargers(station_id) WHERE deleted_at IS NULL;
CREATE INDEX CONCURRENTLY idx_connectors_charger_id ON panda_ev_system.connectors(charger_id) WHERE deleted_at IS NULL;
CREATE INDEX CONCURRENTLY idx_station_pricing_station_id ON panda_ev_system.station_pricing(station_id, priority DESC);
CREATE INDEX CONCURRENTLY idx_pricing_tiers_active ON panda_ev_system.pricing_tiers(is_active, plug_type);
CREATE INDEX CONCURRENTLY idx_legal_content_type_active ON panda_ev_system.legal_content(type, is_active);
```

**Mobile Schema (`panda_ev_core`)**

```sql
-- ขาดทั้งหมด — ความเสี่ยงสูงสำหรับ query ที่ถูกเรียกบ่อยมาก
CREATE INDEX CONCURRENTLY idx_charging_sessions_user_status ON panda_ev_core.charging_sessions(user_id, status) WHERE deleted_at IS NULL;
CREATE INDEX CONCURRENTLY idx_charging_sessions_charger ON panda_ev_core.charging_sessions(charger_id, connector_id, status);
CREATE INDEX CONCURRENTLY idx_wallet_transactions_wallet ON panda_ev_core.wallet_transactions(wallet_id, created_at DESC);
CREATE INDEX CONCURRENTLY idx_invoices_session ON panda_ev_core.invoices(charging_session_id);
CREATE INDEX CONCURRENTLY idx_fcm_tokens_user ON panda_ev_core.fcm_tokens(user_id) WHERE deleted_at IS NULL;
```

**OCPP Schema (`panda_ev_ocpp`)**

```sql
-- OcppLog เป็น hot table — ขาด index ที่สำคัญมาก
CREATE INDEX CONCURRENTLY idx_ocpp_log_charger_time ON panda_ev_ocpp.ocpp_logs(charge_box_id, created_at DESC);
CREATE INDEX CONCURRENTLY idx_ocpp_log_action ON panda_ev_ocpp.ocpp_logs(action, created_at DESC);
CREATE INDEX CONCURRENTLY idx_transactions_ocpp_id ON panda_ev_ocpp.transactions(ocpp_transaction_id);
CREATE INDEX CONCURRENTLY idx_transactions_identity ON panda_ev_ocpp.transactions(identity, status);
```

#### 2.1.3 N+1 Query Risks

**Mobile: `station.service.ts`** — เมื่อ list stations แต่ละ station query connectors แยกต่างหาก:

```typescript
// ความเสี่ยง N+1: ถ้ามี 50 stations จะเกิด 51 queries
const stations = await this.systemDb.withClient(async (client) => {
  // query 1: get stations
  const stationsResult = await client.query('SELECT * FROM stations...');
  // query N: get connectors for each station (ถ้าไม่ใช้ JOIN)
});
```

**Admin: `station.service.ts`** — การ load `chargers` พร้อม `connectors` ควรใช้ `include` แบบ nested ครั้งเดียว

#### 2.1.4 OcppLog — ตารางที่โตไม่หยุด

ไม่มี retention policy:
- 20 chargers × 2 heartbeats/นาที × 60 นาที × 24 ชั่วโมง = **57,600 rows/วัน** เฉพาะ heartbeat
- MeterValues ทุก 60 วินาที × 10 sessions × 24 ชั่วโมง = **14,400 rows/วัน**
- ใน 1 ปี = **>26 ล้าน rows** ที่ไม่มีการ archive

---

### 2.2 Redis — การวิเคราะห์การใช้ Cache

#### 2.2.1 TTL ที่ไม่เหมาะสม

| Key Pattern | TTL ปัจจุบัน | ปัญหา |
|-------------|------------|-------|
| `charging:session:{id}` | 8 ชั่วโมง | เหมาะสม ✅ |
| `charging:charger:{id}` | 8 ชั่วโมง | อาจค้างถ้า session fail |
| `connector_status:{id}` | 60 วินาที | สั้นเกินไป — ทำให้ query DB บ่อยมาก |
| `ocpp:api_keys` | ไม่มี TTL | 🔴 ข้อมูลเก่าไม่ถูกล้างออก |
| `otp:{email}` | 5 นาที | เหมาะสม ✅ |

#### 2.2.2 Redis Key ที่ไม่มี TTL (ปัญหาหน่วยความจำ)

```typescript
// cache.service.ts (OCPP) — line ~121
await this.redis.set(`ocpp:api_keys`, JSON.stringify(keys));
// ❌ ไม่มี TTL — key นี้จะอยู่ตลอดไปจนกว่าจะถูกลบ manual
// ถ้า charger ถูกลบออกจาก Admin แต่ Redis ยังมีข้อมูลเก่า → ถูก reject ไม่ได้
```

#### 2.2.3 `JSON.parse` ไม่มี try/catch

```typescript
// redis.service.ts
async getJSON<T>(key: string): Promise<T | null> {
  const value = await this.client.get(key);
  if (!value) return null;
  return JSON.parse(value) as T; // ❌ ถ้า value เสียหาย (corrupt) จะ throw → crash consumer
}
```

---

### 2.3 RabbitMQ — การวิเคราะห์ Message Queue

#### 2.3.1 ไม่มีการ Reconnect อัตโนมัติ

ทุกเซอร์วิสใช้ pattern เดียวกัน: ถ้า RabbitMQ connection drop จะ log error และหยุดรับ message โดยไม่ reconnect:

```typescript
// ทุก rabbitmq.service.ts — onModuleDestroy เท่านั้น ไม่มี reconnect logic
connection.on('error', (err) => {
  this.logger.error('RabbitMQ connection error', err.message);
  // ❌ ไม่มี reconnect — service ตายเงียบ
});
```

#### 2.3.2 ไม่มี `prefetch` (Consumer QoS)

```typescript
// ทุก consumer — ไม่มีการกำหนด prefetch
await channel.consume(queue, handler);
// ❌ ถ้า queue มี backlog 10,000 messages, broker จะส่งทั้งหมดพร้อมกัน → OOM
```

ควรเพิ่ม:
```typescript
await channel.prefetch(10); // ประมวลผลทีละ 10 messages เท่านั้น
```

#### 2.3.3 `assertQueue` ถูกเรียกทุกครั้งที่ `publish()`

```typescript
// mobile rabbitmq.service.ts
async publish(queue: string, data: unknown) {
  await this.channel.assertQueue(queue, { durable: true }); // ❌ ทุก publish!
  // ...
}
```

`assertQueue` เป็น network roundtrip ที่ไม่จำเป็น ควรเรียกครั้งเดียวตอน init

---

### 2.4 OCPP WebSocket — การวิเคราะห์ประสิทธิภาพ

#### 2.4.1 ไม่มี Message Queue ต่อ Connection

```typescript
// ocpp.gateway.ts line ~172
void this.handleRawMessage(ws, data.toString(), ip);
// ❌ ทุก message ถูกประมวลผลแบบ concurrent ไม่มี serialization
// ถ้า charger ส่ง StartTransaction + MeterValues พร้อมกัน อาจเกิด race condition
```

#### 2.4.2 Connection Memory Leak Risk

`this.clients` Map ใน `OcppGateway` เก็บ `WebSocket` objects:

```typescript
private clients = new Map<string, WebSocket>();
```

ถ้า WebSocket close event ไม่ถูก trigger (network partition, TCP timeout ช้า) client เก่าจะอยู่ใน Map ตลอดไป ควรใช้ ping/pong heartbeat เพื่อ detect dead connections

---

### 2.5 API & Network

#### 2.5.1 ไม่มี Global Timeout

ทุกเซอร์วิสไม่มีการกำหนด request timeout ทั่วโลก ถ้า DB query ช้าผิดปกติ request จะ hang ตลอดไปจนกว่า client จะ disconnect

#### 2.5.2 SystemDB Cross-Service Call ไม่มี Timeout

```typescript
// system-db.service.ts (Mobile)
async withClient<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await this.pool.connect(); // ❌ ไม่มี timeout
  // ถ้า panda_ev_system DB ช้า → mobile session start ค้างตลอดไป
}
```

---

## 3. Data Sync & Consistency Analysis

### 3.1 Flow ของข้อมูลหลัก (Charging Session Lifecycle)

```
User App
  │
  ▼
Mobile API (4001)
  │  1. ตรวจสอบ wallet balance
  │  2. Query pricing tier จาก panda_ev_system (SystemDB)  ← [RISK-A]
  │  3. SET Redis charging:charger:{id} (lock)             ← [RISK-B]
  │  4. INSERT ChargingSession → panda_ev_core
  │  5. SET Redis charging:session:{id} (snapshot)
  │  6. PUBLISH PANDA_EV_CSMS_COMMANDS → session.start    ← [RISK-C]
  │
  ▼
OCPP Service (4002)
  │  7. รับ RemoteStartTransaction command
  │  8. ส่ง OCPP StartTransaction ไปยัง Charger
  │  9. รับ StartTransaction.req จาก Charger
  │  10. INSERT Transaction → panda_ev_ocpp               ← [RISK-D]
  │  11. UPDATE Connector status
  │  12. PUBLISH PANDA_EV_QUEUE → transaction.started
  │
  ▼
Mobile API (Consumer)
  │  13. รับ transaction.started
  │  14. UPDATE ChargingSession.ocppTransactionId
  │
  ▼ (เมื่อผู้ใช้หรือ charger หยุด)
OCPP Service
  │  15. รับ StopTransaction.req
  │  16. PUBLISH PANDA_EV_QUEUE → transaction.stopped
  │
  ▼
Mobile API (OcppConsumerService)
  │  17. GET Redis charging:session:{id}                   ← [RISK-E]
  │  18. คำนวณค่าพลังงาน
  │  19. DEBIT wallet (energy fee)                        ← [RISK-F]
  │  20. DEBIT wallet (unplug fee) [ถ้าเปิดใช้]           ← [RISK-G]
  │  21. UPDATE ChargingSession → COMPLETED
  │  22. DEL Redis locks
  │
  ▼ (ถ้ามี parking fee)
Mobile API (Consumer — connector.status_changed)
  │  23. ตรวจสอบ status === 'Available'                   ← [RISK-H] BUG
  │  24. DEBIT wallet (parking fee)
```

### 3.2 Risk Assessment ของแต่ละจุด

| Risk | จุดในกระบวนการ | ปัญหา | ผลกระทบ |
|------|--------------|-------|---------|
| **RISK-A** | ขั้นตอน 2 | Client ส่ง `pricePerKwh` เป็น fallback ถ้า admin DB ล่ม | ผู้ไม่หวังดีชาร์จฟรีได้ |
| **RISK-B** | ขั้นตอน 3 | `GET` + `SET` แยกกัน ไม่ใช้ `SET NX` | Race condition: เปิด 2 sessions บนตัวชาร์จเดียวกัน |
| **RISK-C** | ขั้นตอน 6 | Lock ถูก set ก่อน publish | RabbitMQ ล่ม → charger ล็อคตลอด 8 ชั่วโมง |
| **RISK-D** | ขั้นตอน 10 | INSERT + UPDATE Connector เป็น 2 operations แยกกัน | ถ้าล้มระหว่างกลาง Transaction ใน DB ไม่มี Connector |
| **RISK-E** | ขั้นตอน 17 | `meterStart ?? 0` fallback | Redis หาย → ผู้ใช้จ่ายค่าพลังงานทั้งหมดที่มิเตอร์อ่านได้ |
| **RISK-F** | ขั้นตอน 19 | Balance check + debit ไม่ atomic | Balance อาจเป็นลบได้ |
| **RISK-G** | ขั้นตอน 20 | Energy debit + unplug debit เป็น 2 transactions แยก | ถ้าล้มระหว่างกลาง: เก็บค่าพลังงานแต่ไม่เก็บ unplug fee |
| **RISK-H** | ขั้นตอน 23 | `=== 'Available'` แต่ enum ค่าจริงคือ `'AVAILABLE'` | **Parking fee ไม่ถูกเก็บเลย** |

### 3.3 Charger Data Sync (Admin → OCPP)

```
Admin API                          OCPP Service
     │                                  │
     │  charger.provisioned             │
     │─────────────────────────────────►│
     │                                  │  UPSERT panda_ev_ocpp.chargers
     │  charger.updated                 │
     │─────────────────────────────────►│
     │                                  │  UPDATE panda_ev_ocpp.chargers
     │  charger.decommissioned          │
     │─────────────────────────────────►│
     │                                  │  UPDATE deletedAt

[RISK] ถ้า RabbitMQ message หาย (ไม่มี saga หรือ reconciliation job):
       - Admin DB: charger มีอยู่, ราคาอัปเดตแล้ว
       - OCPP DB: charger ยังมีข้อมูลเก่าหรือไม่มีเลย
       - ผลลัพธ์: BootNotification ถูก REJECTED สำหรับ charger ที่ควรทำงานได้
```

### 3.4 Mobile User Sync (Mobile → Admin)

```
Mobile API                         Admin API
     │                                  │
     │  user.registered (RabbitMQ)      │
     │─────────────────────────────────►│
     │                                  │  UPSERT MobileUserProfile
     │  user.updated                    │
     │─────────────────────────────────►│

[ปัจจุบัน: ✅ ใช้งานได้ดี — event-driven, ไม่มี direct DB write]
[RISK] ถ้า message หาย: Admin ไม่มี MobileUserProfile → Admin ดูข้อมูลผู้ใช้ไม่ได้
[ยังขาด] Reconciliation job สำหรับ catch up กรณี message สูญหาย
```

### 3.5 Failure Scenarios & Recovery

| Scenario | พฤติกรรมปัจจุบัน | ที่ควรเป็น |
|---------|----------------|----------|
| RabbitMQ ล่มระหว่าง startSession | charger lock ค้าง 8h | Publish ก่อน lock, DLQ + retry |
| Redis ล่มระหว่าง billing | `meterStart = 0` → เก็บเงินเต็ม meter | Fetch meterStart จาก DB แทน |
| Admin DB ล่มระหว่าง startSession | ใช้ pricePerKwh จาก client | Reject session start ถ้า pricing unavailable |
| Process crash ระหว่าง unplug fee | Redis lock ค้าง | Saga pattern / compensation |

---

## 4. Critical Issues List

### 🔴 C1 — Race Condition: Double Session Start

**ไฟล์:** `panda-ev-client-mobile/src/modules/charging-session/charging-session.service.ts` บรรทัด ~189

**โค้ดที่มีปัญหา:**
```typescript
// GET แยก + SET แยก — ไม่ atomic
const existingSession = await this.redis.get(`charging:charger:${chargerId}`);
if (existingSession) throw new ConflictException(...);
await this.redis.set(`charging:charger:${chargerId}`, sessionId, 28800);
```

**ปัญหา:** ถ้าผู้ใช้ 2 คนกด "เริ่มชาร์จ" พร้อมกันบนตัวชาร์จเดียว ทั้งคู่จะผ่าน `GET` ก่อนที่อีกคนจะ `SET` — ได้ 2 sessions บน 1 connector

**วิธีแก้:**
```typescript
// ใช้ SET NX (atomic)
const locked = await this.redis.client.set(
  `charging:charger:${chargerId}`,
  sessionId,
  'EX', 28800,
  'NX' // Only set if NOT exists
);
if (!locked) throw new ConflictException('charger_already_in_use');
```

---

### 🔴 C2 — Parking Fee ไม่ถูกเก็บเลย (String Mismatch Bug)

**ไฟล์:** `panda-ev-client-mobile/src/modules/charging-session/ocpp-consumer.service.ts` บรรทัด ~392

**โค้ดที่มีปัญหา:**
```typescript
// Bug: เปรียบเทียบ string literal 'Available' กับ enum ที่ส่งมาเป็น 'AVAILABLE'
if (msg.status as string === 'Available') {
  // ❌ เงื่อนไขนี้จะ false เสมอ
  // parking fee จะไม่ถูกเก็บเลย
}
```

OCPP Service ส่ง status เป็น `ConnectorStatus.AVAILABLE` ซึ่ง map เป็น `"AVAILABLE"` (uppercase) แต่โค้ดเปรียบเทียบกับ `"Available"` (mixed case)

**วิธีแก้:**
```typescript
if ((msg.status as string).toUpperCase() === 'AVAILABLE') {
  // หรือใช้ enum โดยตรง
}
```

---

### 🔴 C3 — Incorrect Billing เมื่อ Redis State หาย

**ไฟล์:** `panda-ev-client-mobile/src/modules/charging-session/ocpp-consumer.service.ts` บรรทัด ~149

**โค้ดที่มีปัญหา:**
```typescript
const meterStart = sessionState?.meterStart ?? 0;
// ❌ ถ้า Redis ล่มและ sessionState = null
// meterStart = 0 → คิดค่าพลังงานตั้งแต่ meterStart ของมิเตอร์ทั้งชีวิต
// ผู้ใช้อาจถูกเรียกเก็บเงินหลาย kWh แทนที่จะเป็นค่าที่ชาร์จจริง
```

**วิธีแก้:**
```typescript
if (!sessionState) {
  // Fallback: query DB เพื่อหา meterStart จาก ChargingSession
  const session = await this.prisma.chargingSession.findFirst({
    where: { ocppTransactionId: msg.ocppTransactionId }
  });
  meterStart = session?.meterValueStart ?? null;
  if (meterStart === null) {
    this.logger.error(`Cannot bill: no meterStart for txn ${msg.ocppTransactionId}`);
    // Mark session as error, alert ops team
    return;
  }
}
```

---

### 🔴 C4 — Wallet Balance สามารถเป็นลบได้

**ไฟล์:** `panda-ev-client-mobile/src/modules/charging-session/ocpp-consumer.service.ts` บรรทัด ~203, ~418

**โค้ดที่มีปัญหา:**
```typescript
// Balance check แยกจาก debit — ไม่ใช่ atomic operation
const wallet = await this.prisma.wallet.findUnique({ where: { userId } });
if (wallet.balance < energyCost) { /* ... */ }

// ระหว่างนี้ wallet อาจถูก debit จาก transaction อื่น (unplug fee, parking fee)
await this.prisma.wallet.update({
  where: { userId },
  data: { balance: { decrement: energyCost } }, // ❌ balance อาจเป็นลบ
});
```

**วิธีแก้:**
```typescript
// ใช้ Prisma $transaction + WHERE balance >= cost
const result = await this.prisma.$transaction(async (tx) => {
  const updated = await tx.$executeRaw`
    UPDATE wallets SET balance = balance - ${cost}
    WHERE user_id = ${userId} AND balance >= ${cost}
    RETURNING balance
  `;
  if (updated === 0) throw new Error('INSUFFICIENT_BALANCE');
  return updated;
});
```

ควรเพิ่ม DB constraint:
```sql
ALTER TABLE panda_ev_core.wallets ADD CONSTRAINT wallet_balance_non_negative CHECK (balance >= 0);
```

---

### 🔴 C5 — Default JWT Refresh Secret ที่ Hardcode ไว้

**ไฟล์:** `panda-ev-client-mobile/src/modules/auth/auth.service.ts` บรรทัด ~56

**โค้ดที่มีปัญหา:**
```typescript
const refreshToken = this.jwtService.sign(payload, {
  secret: process.env.JWT_REFRESH_SECRET || 'default-refresh-secret', // 🔴 CRITICAL
  expiresIn: '30d',
});
```

**ปัญหา:** ถ้า `JWT_REFRESH_SECRET` ไม่ได้ถูก set ใน environment ผู้ไม่หวังดีสามารถ forge refresh token ที่ valid ได้โดยใช้ค่า `'default-refresh-secret'`

**วิธีแก้:**
```typescript
const secret = process.env.JWT_REFRESH_SECRET;
if (!secret) throw new Error('JWT_REFRESH_SECRET environment variable is required');
```

และเพิ่ม validation ใน `app.module.ts`:
```typescript
ConfigModule.forRoot({
  validate: (config) => {
    if (!config.JWT_REFRESH_SECRET) throw new Error('Missing JWT_REFRESH_SECRET');
    return config;
  }
})
```

---

### 🔴 C6 — Notification Service ไม่ Verify `x-service-token`

**ไฟล์:** `panda-ev-notification/src/common/rabbitmq/rabbitmq.service.ts`

**โค้ดที่มีปัญหา:**
```typescript
await this.consumerChannel.consume(queue, async (msg) => {
  if (!msg) return;
  const content = JSON.parse(msg.content.toString());
  await handler(content); // ❌ ไม่มีการตรวจสอบ x-service-token
});
```

**ปัญหา:** ใครก็ตามที่เข้าถึง RabbitMQ ได้ (ถ้า RabbitMQ ไม่ได้ป้องกันอย่างดี) สามารถส่ง message เพื่อ trigger FCM push notification ไปหาผู้ใช้ทุกคนได้

**วิธีแก้:** Import `ServiceAuthModule` เข้า `NotificationModule` และเพิ่มการ verify token ใน consumer:
```typescript
const token = msg.properties.headers['x-service-token'];
if (!this.serviceJwtService.verify(token)) {
  this.channel.nack(msg, false, false); // discard
  return;
}
```

---

### 🟠 H1 — Mobile Client ควบคุมราคาชาร์จได้

**ไฟล์:** `panda-ev-client-mobile/src/modules/charging-session/charging-session.service.ts` บรรทัด ~256

**โค้ดที่มีปัญหา:**
```typescript
const resolvedPricePerKwh = tierConfig
  ? this.calculateEffectivePrice(tierConfig)
  : dto.pricePerKwh; // ❌ ถ้า admin DB ล่ม ใช้ค่าจาก client!
```

**วิธีแก้:**
```typescript
if (!tierConfig) {
  this.logger.error(`Cannot start session: pricing unavailable for station ${dto.stationId}`);
  throw new ServiceUnavailableException('pricing_service_unavailable');
}
```

---

### 🟠 H2 — Energy + Unplug Fee ไม่ Atomic

**ไฟล์:** `panda-ev-client-mobile/src/modules/charging-session/ocpp-consumer.service.ts` บรรทัด ~165, ~210

```typescript
// Transaction 1: Energy fee
await this.prisma.walletTransaction.create({ data: { amount: energyCost } });
// ← Process crash ตรงนี้: energy ถูกหักแต่ unplug fee ไม่ถูกหัก

// Transaction 2: Unplug fee (แยกจาก Transaction 1)
if (sessionState.enableUnplugFee) {
  await this.prisma.walletTransaction.create({ data: { amount: unplugFee } });
}
```

**วิธีแก้:** รวมทั้งหมดใน `prisma.$transaction()`

---

### 🟠 H3 — Session Lock ค้างถาวรถ้า RabbitMQ Publish ล้มเหลว

**ไฟล์:** `panda-ev-client-mobile/src/modules/charging-session/charging-session.service.ts` บรรทัด ~277

```typescript
// Lock ถูก set ก่อน publish
await this.redis.set(`charging:charger:${chargerId}`, sessionId, 28800);
await this.redis.set(`charging:session:${sessionId}`, JSON.stringify(state), 28800);

// ถ้า publish ล้มเหลว:
await this.rabbitmq.publish(CSMS_COMMANDS_QUEUE, command); // ❌ ล้มเหลวได้ตรงนี้
// → charger lock ค้าง 8 ชั่วโมง, session ค้างสถานะ ACTIVE
```

**วิธีแก้:** ใช้ try/catch และ cleanup lock ถ้า publish ล้มเหลว:
```typescript
try {
  await this.rabbitmq.publish(CSMS_COMMANDS_QUEUE, command);
} catch (err) {
  // Compensate: ลบ lock และ session
  await this.redis.del(`charging:charger:${chargerId}`);
  await this.redis.del(`charging:session:${sessionId}`);
  await this.prisma.chargingSession.update({ where: { id: sessionId }, data: { status: 'FAILED' } });
  throw new ServiceUnavailableException('charging_command_failed');
}
```

---

### 🟠 H4 — StartTransaction ไม่ Atomic ใน OCPP Service

**ไฟล์:** `panda-ev-ocpp/src/modules/ocpp/ocpp.service.ts` บรรทัด ~284

```typescript
// 2 operations แยกกัน — ไม่มี $transaction
const transaction = await this.prisma.transaction.create({ ... });
await this.prisma.connector.update({ where: { id: connectorId }, data: { status: 'OCCUPIED' } });
// ถ้า update connector ล้มเหลว: transaction ใน DB แต่ connector ยังว่าง → charger รับ session ใหม่ได้
```

**วิธีแก้:**
```typescript
await this.prisma.$transaction([
  this.prisma.transaction.create({ ... }),
  this.prisma.connector.update({ ... }),
]);
```

---

### 🟠 H5 — Rate Limiter Amplification Bug

**ไฟล์:** `panda-ev-client-mobile/src/common/rate-limit/rate-limit.service.ts`

```typescript
// zadd เกิดขึ้นก่อนตรวจสอบ count
pipe.zremrangebyscore(key, 0, now - windowMs);
pipe.zcard(key);       // count BEFORE adding
pipe.zadd(key, now, `${now}:${Math.random()}`); // เพิ่มเสมอ แม้ rate limited
pipe.expire(key, windowSec);
const results = await pipe.exec();
const count = results[1][1] as number;
return count < max; // ตรวจสอบ count เก่า แต่ entry ใหม่ถูกเพิ่มไปแล้ว
```

**ปัญหา:** request ที่ถูก rate limit ยังคงเพิ่ม entry ใน sorted set → ยิ่ง reject ยิ่งทำให้ recover ช้า

**วิธีแก้:** ใช้ Lua script เพื่อ atomically check-then-add:
```lua
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local max = tonumber(ARGV[3])
redis.call('zremrangebyscore', key, 0, now - window)
local count = redis.call('zcard', key)
if count < max then
  redis.call('zadd', key, now, now .. ':' .. math.random())
  redis.call('expire', key, math.ceil(window/1000))
  return 1
end
return 0
```

---

## 5. Prioritized Roadmap

### Phase 1 — Critical (แก้ทันที ก่อน Production Launch)

> ประมาณ 3–5 วันทำการ

| # | งาน | เหตุผล | ไฟล์ที่แก้ไข |
|---|-----|--------|------------|
| P1.1 | แก้ race condition charger lock (C1) ด้วย `SET NX` | ป้องกัน double billing | `charging-session.service.ts` |
| P1.2 | แก้ parking fee bug (C2) — uppercase comparison | เก็บรายได้ที่หายไป | `ocpp-consumer.service.ts` |
| P1.3 | แก้ meterStart fallback (C3) — query DB แทน default 0 | ป้องกัน overbilling | `ocpp-consumer.service.ts` |
| P1.4 | แก้ wallet atomic debit (C4) — `executeRaw` + CHECK constraint | ป้องกัน negative balance | `ocpp-consumer.service.ts` |
| P1.5 | ลบ hardcoded JWT secret (C5) — throw ถ้าไม่มี env var | ป้องกัน token forgery | `auth.service.ts` |
| P1.6 | เพิ่ม `x-service-token` verify ใน notification service (C6) | ป้องกัน unauthorized push | `rabbitmq.service.ts` (notification) |
| P1.7 | แก้ admin DB fallback ให้ reject session (H1) | ป้องกัน free charging | `charging-session.service.ts` |
| P1.8 | รวม energy+unplug fee ใน `prisma.$transaction()` (H2) | ป้องกัน partial billing | `ocpp-consumer.service.ts` |
| P1.9 | เพิ่ม compensation สำหรับ RabbitMQ publish fail (H3) | ป้องกัน charger lock ค้าง | `charging-session.service.ts` |
| P1.10 | รวม StartTransaction+Connector update ใน `$transaction` (H4) | ป้องกัน inconsistent state | `ocpp.service.ts` |

---

### Phase 2 — High (แก้ภายใน 2 สัปดาห์)

> ประมาณ 5–7 วันทำการ

| # | งาน | เหตุผล | ผลกระทบ |
|---|-----|--------|--------|
| P2.1 | เพิ่ม RabbitMQ auto-reconnect (ทุกเซอร์วิส) | Service ไม่ตายเงียบๆ เมื่อ MQ ล่ม | Availability |
| P2.2 | เพิ่ม `channel.prefetch(N)` ทุก consumer | ป้องกัน OOM จาก message backlog | Stability |
| P2.3 | แก้ Rate Limiter Lua script (H5) | ป้องกัน thundering herd | Performance |
| P2.4 | เพิ่ม `JSON.parse` try/catch ใน `redis.service.ts` | ป้องกัน consumer crash จาก corrupt data | Reliability |
| P2.5 | กำหนด TTL สำหรับ `ocpp:api_keys` key ใน Redis | ป้องกัน stale API keys | Security |
| P2.6 | เพิ่ม `connection_limit` ใน Prisma URL ทุกเซอร์วิส | ป้องกัน connection pool exhaustion | Performance |
| P2.7 | แก้ `assertQueue` ให้เรียกครั้งเดียวตอน init (Mobile RabbitMQ) | ลด latency ทุก publish call | Performance |
| P2.8 | เพิ่ม indexes ที่ขาดหายไป (ดู 2.1.2) | ลด query time อย่างมีนัยสำคัญ | Performance |
| P2.9 | เพิ่ม SystemDB timeout | ป้องกัน session start ค้างตลอดไป | Reliability |

---

### Phase 3 — Medium (แผนระยะกลาง 1 เดือน)

| # | งาน | เหตุผล | ผลกระทบ |
|---|-----|--------|--------|
| P3.1 | Implement Saga pattern สำหรับ 3-phase billing | ป้องกัน partial charge scenarios | Data Integrity |
| P3.2 | สร้าง OcppLog retention job (cron DELETE / archive) | ป้องกัน table bloat | Storage |
| P3.3 | เพิ่ม WebSocket ping/pong เพื่อ detect dead connections | ป้องกัน memory leak ใน OCPP gateway | Stability |
| P3.4 | เพิ่ม message queue per WebSocket connection ใน OCPP | ป้องกัน concurrent message race | Correctness |
| P3.5 | แก้ Notification aggregation — enrich `transaction.stopped` payload | Stats ถูกต้อง | Analytics |
| P3.6 | Implement reconciliation job (Admin↔OCPP charger sync) | ป้องกัน data drift เมื่อ message สูญหาย | Data Integrity |
| P3.7 | เพิ่ม `connector_status` Redis TTL เป็น 5–10 นาที | ลด DB query ที่ไม่จำเป็น | Performance |
| P3.8 | เพิ่ม Global request timeout (NestJS `setTimeout` interceptor) | ป้องกัน hung requests | Reliability |

---

### Phase 4 — Low (Backlog / Future Improvements)

| # | งาน | ผลกระทบ |
|---|-----|--------|
| P4.1 | เพิ่ม OCPP auth rate limiting (brute force protection) | Security |
| P4.2 | เพิ่ม missing indexes สำหรับ `Group`, `MobileUserProfile`, `NotificationLog` tables | Performance |
| P4.3 | เพิ่ม `stopSession` duplicate stop protection | UX |
| P4.4 | เพิ่ม `delByPattern` atomic implementation (Lua script) | Correctness |
| P4.5 | เพิ่ม DB-level `CHECK (balance >= 0)` constraint | Defense in depth |
| P4.6 | Structured logging (correlation ID ทุก request) | Observability |

---

## 6. Recommendations

### 6.1 ความเสถียร (Stability)

1. **Circuit Breaker Pattern** — เพิ่ม circuit breaker สำหรับ cross-service calls (SystemDB, RabbitMQ) ใช้ library เช่น `opossum` เพื่อ fail fast แทนที่จะ hang
2. **Health Check Endpoints** — เพิ่ม Kubernetes-compatible health checks ที่ตรวจสอบ Redis, DB, RabbitMQ connectivity จริงๆ (ปัจจุบันมีแต่ HTTP 200)
3. **Graceful Shutdown** — ทุกเซอร์วิสต้องรอ in-flight requests ให้เสร็จก่อน shutdown (`onApplicationShutdown` hook)

### 6.2 ความปลอดภัย (Security)

1. **Environment Validation** — ใช้ `class-validator` หรือ `@nestjs/config` `validate` function เพื่อ fail fast ถ้า required env vars ขาดหายไป
2. **RabbitMQ Authentication** — เพิ่ม user/vhost isolation ใน RabbitMQ แทนที่จะใช้ default user เดียวสำหรับทุกเซอร์วิส
3. **Redis AUTH** — ตรวจสอบว่า Redis มี password และ TLS (ถ้า production)

### 6.3 การ Scale (Scalability)

1. **Database Read Replicas** — Mobile API อ่านข้อมูลเยอะมาก (station list, pricing) ควรเพิ่ม read replica สำหรับ query เหล่านี้
2. **OCPP Horizontal Scaling** — ปัจจุบัน charger-to-connection mapping ใช้ in-memory Map ถ้า scale เป็นหลาย instance จะทำงานไม่ได้ ต้องย้ายไปใช้ Redis Pub/Sub หรือ Sticky Sessions
3. **Session State Externalization** — ย้าย OCPP in-memory client state ไป Redis เพื่อรองรับ multi-instance deployment

### 6.4 Observability

1. **Distributed Tracing** — เพิ่ม correlation ID (`x-request-id`) ที่ส่งต่อระหว่าง services ผ่าน RabbitMQ headers และ HTTP headers
2. **Metrics** — เพิ่ม Prometheus metrics สำหรับ: active sessions, queue depth, billing failures, OCPP connection count
3. **Alerting** — ตั้ง alert สำหรับ: `BILLING_FAILED` events, wallet balance negative, charger lock ค้างเกิน 30 นาที

### 6.5 Testing

1. **Integration Tests** — เพิ่ม integration tests สำหรับ critical billing path โดยใช้ VCP simulator
2. **Chaos Testing** — ทดสอบ failure scenarios: Redis ล่ม, RabbitMQ ล่ม, Admin DB ล่ม ระหว่าง session active
3. **Load Testing** — ทดสอบ 100 concurrent session starts เพื่อยืนยันว่า `SET NX` แก้ race condition ได้จริง

---

## ภาคผนวก: สรุป Issues Matrix

| # | ปัญหา | Severity | Phase | ไฟล์ |
|---|-------|----------|-------|------|
| C1 | Race condition: double session start | 🔴 Critical | P1.1 | `charging-session.service.ts:189` |
| C2 | Parking fee never collected (case mismatch) | 🔴 Critical | P1.2 | `ocpp-consumer.service.ts:392` |
| C3 | Incorrect billing when Redis state missing | 🔴 Critical | P1.3 | `ocpp-consumer.service.ts:149` |
| C4 | Wallet balance can go negative | 🔴 Critical | P1.4 | `ocpp-consumer.service.ts:203,418` |
| C5 | Hardcoded JWT refresh secret | 🔴 Critical | P1.5 | `auth.service.ts:56` |
| C6 | Notification service: no x-service-token verify | 🔴 Critical | P1.6 | `rabbitmq.service.ts` (notification) |
| H1 | Client-controlled pricing on admin DB failure | 🟠 High | P1.7 | `charging-session.service.ts:256` |
| H2 | Energy + unplug fee non-atomic | 🟠 High | P1.8 | `ocpp-consumer.service.ts:165,210` |
| H3 | Charger lock stuck if RabbitMQ publish fails | 🟠 High | P1.9 | `charging-session.service.ts:277` |
| H4 | StartTransaction + Connector update non-atomic | 🟠 High | P1.10 | `ocpp.service.ts:284` |
| H5 | Rate limiter amplification bug | 🟠 High | P2.3 | `rate-limit.service.ts:32` |
| M1 | No RabbitMQ auto-reconnect | 🟡 Medium | P2.1 | All `rabbitmq.service.ts` |
| M2 | No prefetch on consumers (OOM risk) | 🟡 Medium | P2.2 | All `rabbitmq.service.ts` |
| M3 | JSON.parse no try/catch in Redis service | 🟡 Medium | P2.4 | `redis.service.ts` |
| M4 | `ocpp:api_keys` Redis key no TTL | 🟡 Medium | P2.5 | `cache.service.ts` (OCPP) |
| M5 | No Prisma connection pool config | 🟡 Medium | P2.6 | All `prisma.service.ts` |
| M6 | `assertQueue` called on every publish | 🟡 Medium | P2.7 | `rabbitmq.service.ts` (Mobile) |
| M7 | Missing critical DB indexes | 🟡 Medium | P2.8 | All `schema.prisma` |
| M8 | SystemDB cross-service call no timeout | 🟡 Medium | P2.9 | `system-db.service.ts` |
| M9 | No saga for 3-phase billing | 🟡 Medium | P3.1 | `ocpp-consumer.service.ts` |
| M10 | OcppLog table unbounded growth | 🟡 Medium | P3.2 | `ocpp.service.ts:659` |
| M11 | Dead WebSocket connections not detected | 🟡 Medium | P3.3 | `ocpp.gateway.ts` |
| M12 | No message queue per OCPP connection | 🟡 Medium | P3.4 | `ocpp.gateway.ts:172` |
| M13 | Notification stats empty (missing payload fields) | 🟡 Medium | P3.5 | `notification.router.ts:55` |
| L1 | No OCPP auth rate limiting | 🟢 Low | P4.1 | `ocpp.gateway.ts` |
| L2 | Missing secondary indexes | 🟢 Low | P4.2 | Various schemas |
| L3 | stopSession allows double-stop | 🟢 Low | P4.3 | `charging-session.service.ts:303` |
| L4 | `delByPattern` not atomic | 🟢 Low | P4.4 | `redis.service.ts:102` |
| L5 | No DB-level wallet balance constraint | 🟢 Low | P4.5 | `schema.prisma` (Mobile) |
| L6 | No correlation ID / distributed tracing | 🟢 Low | P4.6 | All services |

---

*รายงานนี้จัดทำโดยการวิเคราะห์โค้ดโดยตรงจาก repository (static analysis + architectural review)*
*ควรทำการทดสอบเพิ่มเติมใน staging environment เพื่อยืนยันปัญหาและผลของการแก้ไขก่อน deploy สู่ production*
