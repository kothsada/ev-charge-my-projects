# SSE Architecture and Performance Analysis
# สถาปัตยกรรม SSE และการวิเคราะห์ประสิทธิภาพ — Panda EV Platform

**วันที่:** 2026-03-25
**สถานะ:** Architectural Decision Record (ADR)
**ผู้เขียน:** System Architecture Review

---

## สารบัญ

1. [Executive Summary — ข้อสรุปเชิงสถาปัตยกรรม](#1-executive-summary)
2. [Placement Comparison — เปรียบเทียบ Option A / B / C](#2-placement-comparison)
3. [OCPP Data Strategy — ข้อมูลจาก OCPP 1.6](#3-ocpp-data-strategy)
4. [Performance Impact Report — การประเมินผลกระทบ](#4-performance-impact-report)
5. [Scaling & Infrastructure — กลยุทธ์การขยายระบบ](#5-scaling--infrastructure)
6. [Risk Analysis — ความเสี่ยงและแนวทางแก้ไข](#6-risk-analysis)
7. [Implementation Roadmap — แผนการ Implement](#7-implementation-roadmap)

---

## 1. Executive Summary

### คำแนะนำสุดท้าย: **Option B — Mobile API (port 4001)**

```
┌─────────────────────────────────────────────────────────────────────┐
│  RECOMMENDED ARCHITECTURE                                            │
│                                                                     │
│  OCPP Service ──MeterValues──► Redis Pub/Sub ──SUBSCRIBE──►         │
│  (port 4002)    (publish)      Channel:                 Mobile API  │
│                               meter:{identity}:{conn}   (port 4001) │
│                                                         SSE Endpoint│
│                                                              │       │
│                                                              ▼       │
│                                                         Mobile App  │
│                                                         (Foreground) │
│                                                                     │
│  OCPP Service ──transaction events──► RabbitMQ ──► Mobile API      │
│                                       PANDA_EV_QUEUE  FCM.sendToUser│
│                                                              │       │
│                                                              ▼       │
│                                                         FCM (Background)│
└─────────────────────────────────────────────────────────────────────┘
```

### เหตุผลหลัก

| เกณฑ์ | Option A (OCPP) | Option B (Mobile API) ✅ | Option C (Notification) |
|---|---|---|---|
| ความปลอดภัย | ❌ ต้องเปิด public endpoint บนระบบ internal | ✅ JWT auth พร้อมอยู่แล้ว | ⚠️ ต้องสร้าง auth ใหม่ |
| Session Context | ❌ ไม่รู้จัก userId/sessionId | ✅ รู้จัก session และ ownership | ⚠️ ต้องรับข้อมูลมาจากที่อื่น |
| Coupling | ❌ OCPP protocol กับ mobile client | ✅ Loose coupling ผ่าน Redis | ✅ Decoupled |
| Latency | ✅ ต่ำสุด (direct) | ✅ ต่ำมาก (+Redis RTT ~1ms) | ⚠️ สูงกว่า (+RabbitMQ hop) |
| Effort | กลาง | ต่ำ | สูง |

Mobile API เป็น **natural owner** ของ SSE endpoint เพราะ:
1. เป็น HTTP service ที่ serve mobile clients อยู่แล้ว
2. มี JWT authentication พร้อมใช้งาน
3. รู้จัก session ownership (สามารถ verify `userId` กับ `sessionId`)
4. Redis ใช้ร่วมกับ OCPP Service ผ่าน network เดียวกัน
5. ไม่ต้องสร้าง connection ใหม่ระหว่าง services — ใช้ Redis Pub/Sub ที่มีอยู่

---

## 2. Placement Comparison

### Option A — OCPP Service (port 4002)

#### สถาปัตยกรรม
```
Mobile App ──SSE──► OCPP Service (port 4002)
Charge Point ──WS──► OCPP Service
```

OCPP Service ใช้ `WsAdapter` ของ NestJS เพื่อรับ WebSocket จาก charger โดยเฉพาะ การเพิ่ม HTTP SSE endpoint บน service นี้หมายถึงการผสม transport สองชนิดในระบบเดียว

#### ข้อดี
- **Latency ต่ำสุด** — MeterValues เข้ามาที่ service นี้โดยตรง ไม่ต้องผ่าน hop เพิ่ม
- **Single source of truth** — ข้อมูล raw ที่สุดโดยไม่ผ่านการแปลง

#### ข้อเสีย (Critical)

| ปัญหา | รายละเอียด |
|---|---|
| **Security boundary** | OCPP Service เป็น internal service ไม่ได้ออกแบบมาให้รับ mobile client โดยตรง ต้องเปิด public endpoint บน service ที่ควรอยู่ใน private network |
| **Authentication mismatch** | ไม่มี JWT user auth — ต้องสร้างใหม่ทั้งหมด หรือต้องเรียก Mobile API เพื่อ verify token ทุก connection |
| **Ownership verification** | OCPP Service ไม่รู้ว่า `sessionId` นี้เป็นของ user คนไหน ต้องออก DB query ไปยัง `panda_ev_core` ที่ service ไม่ควรเข้าถึง (cross-DB violation) |
| **Tight coupling** | Mobile client รับ raw OCPP data โดยตรง การเปลี่ยน OCPP protocol หรือ measurand format กระทบ mobile app ทันที |
| **WsAdapter conflict** | `main.ts` ใน OCPP Service ใช้ `WsAdapter` สำหรับ WebSocket; การเพิ่ม HTTP SSE อาจต้องแก้ไข adapter config หรือใช้ port แยก |
| **Scalability risk** | หาก OCPP Service scale out, SSE clients ที่ต่อกับ instance A จะไม่ได้รับข้อมูลจาก charger ที่ต่อกับ instance B |

**สรุป: ไม่แนะนำสำหรับ production**

---

### Option B — Mobile API (port 4001) ✅ แนะนำ

#### สถาปัตยกรรม
```
OCPP Service  ──redis.publish()──►  Redis Pub/Sub
                                    channel: meter:{identity}:{conn}
                                          │
Mobile API ◄──redis.subscribe()───────────┘
  GET /charging-sessions/:id/stream
         │
         └──► Observable<MessageEvent> ──► Mobile App (SSE)
```

#### ข้อดี

| ข้อดี | รายละเอียด |
|---|---|
| **Zero-friction auth** | `JwtAuthGuard` ทำงานอัตโนมัติ — Bearer token ใน Authorization header |
| **Session ownership** | ตรวจสอบ `session.userId === currentUser.id` ก่อน subscribe ได้ทันที |
| **Loose coupling** | Redis Pub/Sub เป็น intermediary — OCPP และ Mobile API แยกกัน deploy/scale ได้อิสระ |
| **Consistent API surface** | mobile clients ติดต่อ endpoint เดียว (port 4001) สำหรับทุกอย่าง |
| **Enriched data** | Mobile API สามารถ join กับ session data (stationName, pricePerKwh) ก่อนส่งให้ client |
| **Minimal code** | Redis Pub/Sub + NestJS `@Sse()` + `Observable` — ≈ 60 lines |

#### ข้อเสีย

| ข้อเสีย | ผลกระทบ | แนวทางลด |
|---|---|---|
| Redis hop (+~1ms) | น้อยมาก ไม่รู้สึกได้ | ยอมรับได้สมบูรณ์ |
| Redis subscriber connection เพิ่มขึ้น | ต้องสร้าง dedicated subscriber instance | สร้าง pool หรือใช้ single fan-out subscriber |
| Mobile API เป็น stateful | SSE connections ผูกกับ process instance | แก้ด้วย Redis Pub/Sub fan-out (ทุก instance รับ event) |

---

### Option C — Notification Service (port 5001)

#### สถาปัตยกรรม
```
OCPP Service ──RabbitMQ──► Notification Service
                            ├─ FCM delivery
                            ├─ Admin WebSocket (/admin-stats)
                            └─ Mobile SSE ???
```

#### ข้อดี
- Centralize ทุก real-time communication ในที่เดียว
- Notification Service มี Socket.IO อยู่แล้ว (admin dashboard)

#### ข้อเสีย (Critical)

| ปัญหา | รายละเอียด |
|---|---|
| **RabbitMQ latency** | MeterValues ต้องเดินทาง OCPP→RabbitMQ→Notification→SSE client (3 hops vs 2 hops ใน Option B) |
| **Authentication complexity** | ปัจจุบัน Notification Service ใช้ `ServiceJwtService` สำหรับ service-to-service auth ไม่มี user JWT auth สำหรับ mobile clients |
| **Scope creep** | Notification Service ออกแบบมาสำหรับ push delivery (FCM) การเพิ่ม SSE pull streaming เปลี่ยน responsibility ของ service |
| **Coupling กับ session logic** | ต้องส่ง sessionId + ownership info ไปด้วยทุก event เพื่อให้ service รู้ว่า user ไหนควรรับข้อมูลอะไร |
| **MQ overhead** | RabbitMQ ไม่ได้ออกแบบมาสำหรับ high-frequency ephemeral messages (MeterValues ทุก 15 วินาที × ทุก session) |

**สรุป: เหมาะถ้า Notification Service กลายเป็น "Real-time Gateway" โดยเฉพาะในอนาคต แต่ไม่คุ้มค่าสำหรับ phase นี้**

---

### ตารางสรุปการเปรียบเทียบ

| เกณฑ์ | Option A (OCPP) | Option B (Mobile API) | Option C (Notification) |
|---|:---:|:---:|:---:|
| Security | ❌ 1/5 | ✅ 5/5 | ⚠️ 3/5 |
| Latency | ✅ 5/5 | ✅ 4/5 | ⚠️ 3/5 |
| Implementation effort | ⚠️ 3/5 | ✅ 5/5 | ❌ 2/5 |
| Scalability | ❌ 2/5 | ✅ 4/5 | ✅ 4/5 |
| Session context | ❌ 1/5 | ✅ 5/5 | ⚠️ 3/5 |
| Coupling (ยิ่งน้อยยิ่งดี) | ❌ 1/5 | ✅ 5/5 | ✅ 4/5 |
| **รวม** | **13/30** | **28/30** | **19/30** |

---

## 3. OCPP Data Strategy

### 3.1 OCPP 1.6 Messages ที่ต้องใช้

#### MeterValues (Primary Source)

```
[2, "msg-id", "MeterValues", {
  "connectorId": 1,
  "transactionId": 42,
  "meterValue": [{
    "timestamp": "2026-03-25T10:00:00+07:00",
    "sampledValue": [
      { "measurand": "Energy.Active.Import.Register", "value": "1500", "unit": "Wh" },
      { "measurand": "Power.Active.Import", "value": "7200", "unit": "W" },
      { "measurand": "Voltage", "value": "230", "unit": "V", "phase": "L1" },
      { "measurand": "Current.Import", "value": "31.3", "unit": "A", "phase": "L1" },
      { "measurand": "SoC", "value": "65", "unit": "Percent" }
    ]
  }]
}]
```

**⚠️ ปัญหาปัจจุบัน:** `handleMeterValues()` ใน OCPP Service extract เฉพาะ `Energy.Active.Import.Register` เท่านั้น — Power, Voltage, Current, SoC ถูก discard

#### StatusNotification (Charger State)

```
[2, "msg-id", "StatusNotification", {
  "connectorId": 1,
  "status": "Charging",   ← สำคัญ: Charging / SuspendedEV / SuspendedEVSE
  "errorCode": "NoError"
}]
```

#### StartTransaction / StopTransaction (Session Boundary)

```
StartTransaction → meterStart (Wh) — baseline สำหรับคำนวณพลังงาน
StopTransaction  → meterStop (Wh)  — ค่าสุดท้าย
```

---

### 3.2 การคำนวณค่าที่ Mobile App ต้องการ

| ค่าที่ต้องการ | แหล่งข้อมูล | วิธีคำนวณ |
|---|---|---|
| **Energy (kWh)** | MeterValues: `Energy.Active.Import.Register` | `(currentWh - meterStartWh) / 1000` |
| **Power (kW)** | MeterValues: `Power.Active.Import` | `value / 1000` (ถ้า unit=W) |
| **Voltage (V)** | MeterValues: `Voltage` | ค่า raw |
| **Current (A)** | MeterValues: `Current.Import` | ค่า raw |
| **SoC (%)** | MeterValues: `SoC` | ค่า raw (ถ้า charger รองรับ) |
| **Duration (min)** | `startedAt` จาก DB | `(now - startedAt) / 60000` |
| **Estimated Cost** | `energyKwh × pricePerKwh` (Redis session state) | คำนวณใน Mobile API |
| **Charger Online** | Redis `charger_status:{identity}` | boolean |

#### Time Remaining — ข้อจำกัดใน OCPP 1.6

```
⚠️ OCPP 1.6 ไม่มี "Time Remaining" field โดยตรง
   OCPP 2.0.1+ มี session.remainingTime ผ่าน TransactionEventRequest

แนวทางประมาณการ (estimate เท่านั้น):
  ถ้ามี SoC:
    targetSoC = 80% (หรือ user กำหนด)
    remainingPercent = targetSoC - currentSoC
    avgKwh = energyKwh / durationHours         (charging rate ปัจจุบัน)
    timeRemaining ≈ (remainingPercent / 100 × batteryCapacity) / avgKwh × 60 (min)

  ถ้าไม่มี SoC (charger ไม่รองรับ):
    ไม่สามารถประมาณได้อย่างแม่นยำ
    แสดงเป็น "—" หรือ "Duration elapsed" แทน
```

**คำแนะนำ:** แสดง "Duration (เวลาที่ชาร์จผ่านไป)" แทน "Time Remaining" สำหรับ OCPP 1.6 เว้นแต่ charger ส่ง SoC มาด้วย

---

### 3.3 การตั้งค่า MeterValuesSampledData

#### ChangeConfiguration ที่ต้องส่งหลัง BootNotification

```typescript
// ส่งจาก OCPP Service หลังจาก charger boot
await gateway.sendChangeConfiguration(identity, {
  key: 'MeterValuesSampledData',
  value: [
    'Energy.Active.Import.Register',
    'Power.Active.Import',
    'Current.Import',
    'Voltage',
    'SoC',              // ← รวมถ้า charger รองรับ
  ].join(','),
});

await gateway.sendChangeConfiguration(identity, {
  key: 'MeterValueSampleInterval',
  value: '15',          // ← 15 วินาที
});
```

#### ตาราง MeterValueSampleInterval — Trade-off

| Interval | Latency (UX) | Network Overhead | DB Writes/hr | คำแนะนำ |
|---|---|---|---|---|
| **5s** | ดีมาก | สูง (720/hr/charger) | สูง | สำหรับ demo เท่านั้น |
| **10s** | ดี | กลาง (360/hr/charger) | กลาง | ✅ ถ้า charger รองรับ SoC |
| **15s** | ✅ ยอมรับได้ | ต่ำ (240/hr/charger) | ต่ำ | ✅ **แนะนำสำหรับ production** |
| **30s** | พอใช้ | ต่ำมาก (120/hr/charger) | ต่ำมาก | ถ้า battery level เป็น metric หลัก |
| **60s** | แย่ | ต่ำมาก | ต่ำมาก | ไม่แนะนำสำหรับ live screen |

**สรุป: ตั้ง 15 วินาที** — สมดุลระหว่าง UX (user เห็นการอัพเดตถี่พอ) และ resource usage

---

### 3.4 แก้ไข handleMeterValues() เพื่อ Extract ครบถ้วน

```typescript
// panda-ev-ocpp/src/modules/ocpp/ocpp.service.ts
// เพิ่มการ extract measurands เพิ่มเติม

async handleMeterValues(
  identity: string,
  connectorId: number,
  transactionId: number | undefined,
  meterValues: OcppMeterValue[],
): Promise<void> {
  if (!meterValues?.length) return;

  const latest = meterValues[meterValues.length - 1];
  const sampled = latest.sampledValue ?? [];

  const extract = (measurand: string, unit?: string): number | null => {
    const sv = sampled.find(
      (s) => s.measurand === measurand && (!unit || s.unit === unit),
    );
    if (!sv?.value) return null;
    const v = parseFloat(sv.value);
    return isNaN(v) ? null : v;
  };

  // Energy (ต้องมี) — normalise to Wh
  let energyWh: number | null = null;
  const energyRaw = sampled.find(
    (s) => s.measurand === 'Energy.Active.Import.Register',
  );
  if (energyRaw?.value) {
    const v = parseFloat(energyRaw.value);
    energyWh = energyRaw.unit === 'kWh' ? Math.round(v * 1000) : Math.round(v);
  }

  if (energyWh === null) return;

  // Power — normalise to W
  let powerW: number | null = extract('Power.Active.Import', 'W');
  if (powerW === null) {
    const pkw = extract('Power.Active.Import', 'kW');
    if (pkw !== null) powerW = pkw * 1000;
  }

  const voltageV = extract('Voltage');
  const currentA = extract('Current.Import');
  const socPercent = extract('SoC');

  const liveData = {
    meterWh: energyWh,
    transactionId,
    updatedAt: nowBangkokIso(),
    powerW,
    voltageV,
    currentA,
    socPercent,
  };

  // Store ใน Redis (existing — 8h TTL)
  await this.cache.setChargingLive(identity, connectorId, liveData);

  // NEW: Publish to Redis Pub/Sub สำหรับ SSE clients
  await this.redis.publish(
    `meter:${identity}:${connectorId}`,
    JSON.stringify(liveData),
  ).catch(() => null);
}
```

---

## 4. Performance Impact Report

### 4.1 Resource Estimation — 1,000 Concurrent SSE Connections

#### Memory ต่อ connection (Mobile API process)

```
Node.js SSE connection overhead:
  ├─ TCP socket (OS buffer)    :  ~8 KB (4KB send + 4KB receive buffer)
  ├─ TLS state (ถ้าใช้ HTTPS) :  ~20 KB
  ├─ HTTP/1.1 request object  :  ~2 KB
  ├─ NestJS Observable        :  ~1 KB
  ├─ Redis subscriber ref     :  ~0.5 KB (shared ถ้าใช้ fan-out pattern)
  └─ Application context      :  ~1 KB
                               ──────────
  Total (plain HTTP)          :  ~12 KB / connection
  Total (HTTPS/TLS)           :  ~33 KB / connection

1,000 connections × 33 KB = ~33 MB (HTTPS)
1,000 connections × 12 KB = ~12 MB (HTTP internal)
```

**สรุป:** 1,000 SSE connections ใช้ memory ประมาณ **30-50 MB** ขึ้นอยู่กับ TLS — ไม่ใช่ปัญหาสำหรับ Node.js ที่มี heap 512MB

#### File Descriptors

```
Default limit (Linux): 1,024 fd
Required for 1,000 SSE + overhead:
  ├─ SSE connections:        1,000
  ├─ Redis connections:         10
  ├─ RabbitMQ connections:       5
  ├─ DB connections (pool):     10
  ├─ Internal sockets:          50
  └─ System overhead:          100
                             ──────
  Total:                    ~1,175 fd  ← เกิน default!

แก้ไขใน production:
  ulimit -n 65536   (เพิ่มต่อ process)
  # หรือใน systemd service:
  LimitNOFILE=65536
```

**⚠️ ต้องเพิ่ม `nofile` limit ก่อน deploy**

#### CPU Load

```
SSE event processing (ต่อ event):
  ├─ JSON.parse() Redis message:    ~0.01 ms
  ├─ Observable.next() call:        ~0.001 ms
  ├─ HTTP chunk write (fan-out):    ~0.001 ms × N clients
  └─ Total per MeterValues event:   ~0.05 ms

ที่ 15s interval, 100 active sessions:
  Events/sec = 100 / 15 = ~7 events/sec
  CPU time/sec = 7 × (fan-out ~100 clients × 0.001ms) = ~0.7 ms/sec
  → CPU overhead < 0.1% (แทบไม่มีผล)
```

#### Network Bandwidth (SSE Stream)

```
Payload per MeterValues event:
{
  "meterWh": 1500,        // 6 bytes
  "powerW": 7200,         // 6 bytes
  "voltageV": 230,        // 5 bytes
  "currentA": 31.3,       // 5 bytes
  "socPercent": 65,       // 4 bytes
  "updatedAt": "2026-..."  // 30 bytes
}
JSON size: ~120 bytes
SSE framing ("data: ...\n\n"): +10 bytes
Total: ~130 bytes/event

Per connection/sec: 130 bytes / 15s = ~9 bytes/sec
1,000 connections: 9 KB/sec = 0.072 Mbps

Heartbeat (30s): 50 bytes × 1,000 / 30 = ~1.7 KB/sec

Total bandwidth: < 0.1 Mbps สำหรับ 1,000 connections
```

**ข้อสรุป: Bandwidth ไม่ใช่ปัญหาเลย**

---

### 4.2 Redis Pub/Sub Load Assessment

#### Pattern ปัจจุบัน (Naive — ไม่แนะนำ)

```typescript
// ❌ 1 Redis subscriber ต่อ 1 SSE connection
// 1,000 connections = 1,000 Redis subscriber connections
```

#### Pattern ที่แนะนำ — Single Shared Subscriber

```typescript
// ✅ 1 Redis subscriber ต่อ Mobile API instance (Fan-out ใน application layer)
// รับ message → distribute ไปยัง relevant clients ใน process

class SseManagerService {
  private subscriber: Redis;                                    // 1 connection เท่านั้น
  private channels = new Map<string, Set<Observer<MessageEvent>>>(); // channel → clients

  onModuleInit() {
    this.subscriber = new Redis(process.env.REDIS_URL);
    this.subscriber.on('message', (channel, message) => {
      const clients = this.channels.get(channel);
      if (!clients) return;
      const event = { data: JSON.parse(message) } as MessageEvent;
      clients.forEach((observer) => {
        try { observer.next(event); } catch { clients.delete(observer); }
      });
    });
  }

  subscribe(channel: string, observer: Observer<MessageEvent>): void {
    if (!this.channels.has(channel)) {
      this.channels.set(channel, new Set());
      this.subscriber.subscribe(channel);   // subscribe Redis เฉพาะ channel ใหม่
    }
    this.channels.get(channel)!.add(observer);
  }

  unsubscribe(channel: string, observer: Observer<MessageEvent>): void {
    const clients = this.channels.get(channel);
    if (!clients) return;
    clients.delete(observer);
    if (clients.size === 0) {
      this.channels.delete(channel);
      this.subscriber.unsubscribe(channel);  // unsubscribe Redis เมื่อไม่มี client
    }
  }
}
```

**ผล:** 1,000 SSE connections ใช้ **Redis subscriber เพียง 1 connection** ต่อ Mobile API instance

#### Redis Pub/Sub Throughput

```
MeterValues rate: 100 active sessions × (1 event/15s) = ~7 msg/sec
Redis Pub/Sub throughput limit: ~100,000 msg/sec (single thread)
Load: 7/100,000 = 0.007% — ไม่มีนัยสำคัญ
```

---

### 4.3 Database Load Assessment

#### MeterValues — ปัญหาและทางแก้

**ปัจจุบัน:** OCPP Service ไม่ได้เขียน MeterValues ลง DB (เขียนเฉพาะ Redis `charging:live:*`) — ถูกต้องแล้ว

```typescript
// ocpp.service.ts — handleMeterValues()
// ✅ Redis only — ไม่ write DB
await this.cache.setChargingLive(identity, connectorId, liveData);
// ❌ ไม่ INSERT ลง DB ทุก event
```

**คำแนะนำ:** อย่าเขียน DB ทุก MeterValues event เด็ดขาด — เขียนเฉพาะที่ `StopTransaction` (meterStop)

```
100 sessions × 240 MeterValues/hr = 24,000 events/hr
ถ้าเขียน DB ทุก event:
  24,000 INSERT/hr = ~6.7 INSERT/sec
  → PostgreSQL รับได้ (limit ~10,000 write/sec) แต่ฟุ่มเฟือย

ทางเลือกที่ดีกว่า (ถ้าต้องการ history):
  1. Buffer ใน Redis, flush ทุก 5 นาที (batch write)
  2. Time-series DB (TimescaleDB) สำหรับ analytics
  3. ไม่เก็บ history ของ MeterValues (เก็บแค่ final meterStop)
```

---

### 4.4 Load Balancer Requirements

#### ปัญหา Sticky Session

```
SSE ต้องการ long-lived HTTP connection:
  Client A → LB → Instance 1 (SSE stream เริ่มต้น)
  Client A → LB → Instance 2 (ถ้า LB route ใหม่ → SSE ขาด!)

ทางแก้ที่ดีกว่า Sticky Session:
  ใช้ Redis Pub/Sub Fan-out:
    ทุก instance subscribe Redis channel เดียวกัน
    ไม่ว่า client จะต่อกับ instance ไหน ก็รับ event ได้
    → Stateless SSE (ไม่ต้อง sticky session)
```

#### แนะนำ: Redis Fan-out แทน Sticky Session

```
Instance 1 ──subscribe──► Redis Channel: meter:PANDA-01:1
Instance 2 ──subscribe──► Redis Channel: meter:PANDA-01:1

OCPP Service ──publish──► meter:PANDA-01:1

ทั้ง Instance 1 และ 2 รับ event → forward ไปยัง SSE clients ของตัวเอง
Client ต่อกับ instance ไหนก็ได้ ไม่มีปัญหา
```

---

## 5. Scaling & Infrastructure

### 5.1 Horizontal Scaling Strategy

#### Phase 1 — Single Instance (0-200 concurrent)

```
Mobile App ──HTTPS──► Nginx ──► Mobile API (1 instance)
                                      │
                               Redis Pub/Sub
                                      │
                               OCPP Service (1 instance)
```

- ไม่ต้องทำอะไรพิเศษ
- Redis Fan-out pattern พร้อมรองรับ scale out ในอนาคต

#### Phase 2 — Horizontal Scale (200-2,000 concurrent)

```
Mobile App ──HTTPS──► Nginx (with upstream keepalive)
                          │
               ┌──────────┼──────────┐
               ▼          ▼          ▼
           Instance 1  Instance 2  Instance 3
               │          │          │
               └──────────┴──────────┘
                           │
                    Redis Pub/Sub
                    (ทุก instance subscribe ทุก channel ที่มี client)
```

**Nginx Config สำคัญสำหรับ SSE:**
```nginx
upstream mobile_api {
  server instance1:4001;
  server instance2:4001;
  server instance3:4001;
  keepalive 1000;          # SSE connections are long-lived
}

server {
  location /api/mobile/v1/charging-sessions/ {
    proxy_pass http://mobile_api;
    proxy_http_version 1.1;
    proxy_set_header Connection '';        # ← สำคัญ: ไม่ส่ง Connection: close
    proxy_buffering off;                   # ← สำคัญ: ไม่ buffer SSE chunks
    proxy_cache off;
    proxy_read_timeout 3600s;              # ← SSE connection อาจนาน 1 ชั่วโมง
    chunked_transfer_encoding on;
  }
}
```

#### Phase 3 — Dedicated SSE Service (2,000+ concurrent)

ถ้า SSE connections กลายเป็น bottleneck แยก SSE endpoint ออกเป็น service ใหม่:

```
Mobile App ──SSE──► SSE Gateway Service (Bun/Deno — higher concurrency)
                        │
                 Redis Pub/Sub
Mobile App ──REST──► Mobile API (NestJS — business logic)
```

Bun.js รองรับ 10,000+ concurrent connections ต่อ instance ด้วย memory ที่น้อยกว่า Node.js

---

### 5.2 Connection Pooling สำหรับ Redis Pub/Sub

```typescript
// src/modules/charging-session/sse-manager.service.ts

@Injectable()
export class SseManagerService implements OnModuleInit, OnModuleDestroy {
  private subscriber: Redis;
  private readonly channels = new Map<string, Set<Subscriber>>();

  onModuleInit() {
    this.subscriber = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
    this.subscriber.on('message', this.handleMessage.bind(this));
  }

  private handleMessage(channel: string, message: string): void {
    const clients = this.channels.get(channel);
    if (!clients?.size) return;

    let data: unknown;
    try { data = JSON.parse(message); } catch { return; }

    const event = { data } as MessageEvent;
    const dead: Subscriber[] = [];

    for (const sub of clients) {
      try {
        sub.observer.next(event);
      } catch {
        dead.push(sub);  // client ที่ disconnect แล้ว
      }
    }

    // Cleanup dead connections
    for (const sub of dead) {
      this.unsubscribe(channel, sub);
    }
  }

  subscribe(channel: string, observer: Observer<MessageEvent>): Subscriber {
    const sub: Subscriber = { observer };

    if (!this.channels.has(channel)) {
      this.channels.set(channel, new Set());
      this.subscriber.subscribe(channel);
    }
    this.channels.get(channel)!.add(sub);

    return sub;
  }

  unsubscribe(channel: string, sub: Subscriber): void {
    const clients = this.channels.get(channel);
    if (!clients) return;
    clients.delete(sub);

    if (clients.size === 0) {
      this.channels.delete(channel);
      this.subscriber.unsubscribe(channel);
    }
  }

  onModuleDestroy() {
    this.subscriber.quit();
  }
}
```

---

### 5.3 Database Optimization

#### เพิ่ม Index สำหรับ Live Query

```sql
-- ถ้า Mobile API ต้อง query session ที่ active บ่อย
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_charging_sessions_active
  ON panda_ev_core.charging_sessions (user_id, status)
  WHERE status = 'ACTIVE' AND deleted_at IS NULL;
```

#### Connection Pool Tuning

```typescript
// Mobile API prisma.service.ts — สำหรับ high concurrency
datasource db {
  url = env("DATABASE_URL")
  // เพิ่ม connection pool
  // ?connection_limit=20&pool_timeout=30
}
```

---

### 5.4 Infrastructure Overview สำหรับ Production

```
┌─────────────────────────────────────────────────────────┐
│  PRODUCTION STACK                                        │
│                                                         │
│  CloudFlare/CDN                                         │
│       │ HTTPS + HTTP/2                                  │
│       ▼                                                 │
│  Nginx Ingress Controller (K8s)                         │
│   ├─ /api/mobile/...    → Mobile API (3 replicas)       │
│   ├─ /ocpp/...          → OCPP Service (2 replicas)     │
│   └─ /admin/...         → Admin Service (2 replicas)    │
│                                                         │
│  Redis Cluster (3 nodes, Sentinel)                      │
│   ├─ Key-value (session state, live meter)              │
│   └─ Pub/Sub (meter events fan-out)                     │
│                                                         │
│  RabbitMQ (3-node cluster)                              │
│   ├─ PANDA_EV_QUEUE (OCPP→Mobile)                       │
│   └─ PANDA_EV_NOTIFICATIONS (Mobile→Notification)       │
│                                                         │
│  PostgreSQL (primary + read replica)                    │
│   ├─ panda_ev_core                                      │
│   ├─ panda_ev_system                                    │
│   └─ panda_ev_ocpp                                      │
└─────────────────────────────────────────────────────────┘
```

---

## 6. Risk Analysis

### 6.1 ความเสี่ยงและแนวทางแก้ไข

| ความเสี่ยง | ระดับ | ผลกระทบ | แนวทางแก้ไข |
|---|---|---|---|
| **Redis Pub/Sub message loss** | กลาง | Client เห็นข้อมูลค้าง | SSE client poll `/live` ทุก 60s เป็น fallback |
| **File descriptor exhaustion** | สูง | Service crash | ตั้ง `ulimit -n 65536` ใน container |
| **SSE connection leak** | กลาง | Memory leak | Implement cleanup ใน Observable teardown |
| **Nginx buffering SSE** | สูง | Client ไม่ได้รับ event | ตั้ง `proxy_buffering off` |
| **Mobile app background → SSE killed** | ต่ำ | ไม่ได้รับ live data | ใช้ FCM สำหรับ background events (ออกแบบแล้ว) |
| **OCPP charger ไม่ส่ง SoC** | กลาง | แสดง SoC ไม่ได้ | แสดง `—` และ fallback ไปใช้ energy/power |
| **Redis Pub/Sub overload** | ต่ำมาก | Fan-out ช้า | ใช้ sharded pub/sub ถ้า > 10,000 sessions |

### 6.2 SSE Connection Leak Prevention

```typescript
// SSE Observable ต้องมี cleanup ทุกครั้ง
return new Observable<MessageEvent>((subscriber) => {
  const sub = sseManager.subscribe(channel, subscriber);
  const heartbeat = setInterval(
    () => subscriber.next({ data: { heartbeat: true } } as MessageEvent),
    30_000,
  );

  // ← Teardown logic (เรียกเมื่อ client disconnect)
  return () => {
    clearInterval(heartbeat);
    sseManager.unsubscribe(channel, sub);
    // ถ้า channel ว่าง → sseManager จะ unsubscribe Redis channel อัตโนมัติ
  };
});
```

### 6.3 Graceful Degradation

```
ถ้า Redis Pub/Sub ล้มเหลว:
  → SSE clients ยังต่ออยู่ แต่ไม่ได้รับข้อมูล
  → Heartbeat ยังส่งทุก 30s (client รู้ว่า connection ยังดีอยู่)
  → Mobile app detect "no data update > 60s" → ใช้ polling /live แทน

ถ้า Mobile API instance restart:
  → SSE connection ขาด
  → Mobile app detect connection close → reconnect อัตโนมัติ
  → reconnect ไปยัง instance ใดก็ได้ (stateless ผ่าน Redis fan-out)
```

---

## 7. Implementation Roadmap

### Phase 1 — Redis Pub/Sub ใน OCPP Service (1-2 วัน)

```
1. เพิ่ม redis.publish() method ใน RedisService (OCPP)
   ไฟล์: panda-ev-ocpp/src/configs/redis/redis.service.ts

2. แก้ไข handleMeterValues() ให้ extract ครบ + publish
   ไฟล์: panda-ev-ocpp/src/modules/ocpp/ocpp.service.ts

3. ทดสอบด้วย redis-cli subscribe meter:PANDA-DONGNASOK-08:1
```

### Phase 2 — SSE Endpoint ใน Mobile API (2-3 วัน)

```
4. สร้าง SseManagerService (single Redis subscriber)
   ไฟล์: src/modules/charging-session/sse-manager.service.ts

5. เพิ่ม createChargingStream() ใน ChargingSessionService
   ไฟล์: src/modules/charging-session/charging-session.service.ts

6. เพิ่ม @Sse() endpoint ใน ChargingSessionController
   ไฟล์: src/modules/charging-session/charging-session.controller.ts

7. Register SseManagerService ใน ChargingSessionModule
```

### Phase 3 — Mobile App Integration (2-3 วัน)

```
8. Implement ChargingStreamService (Flutter EventSource)
9. Implement exponential backoff reconnect
10. AppState listener: pause stream on background, resume on foreground
11. Fallback: ถ้า SSE ไม่มา 60s → ใช้ polling /live
```

### Phase 4 — Production Hardening (1 วัน)

```
12. ตั้ง ulimit -n 65536 ใน Dockerfile/K8s
13. เพิ่ม Nginx config: proxy_buffering off, proxy_read_timeout 3600s
14. Monitor: Prometheus metric สำหรับ active SSE connections
15. Load test: k6 simulate 500 concurrent SSE connections
```

---

## สรุปสั้น

```
✅ คำตอบ: ใช้ Option B — Mobile API (port 4001) เป็น SSE host

ทำไม:
  - JWT auth พร้อมแล้ว
  - Session ownership verify ได้ทันที
  - Redis Pub/Sub = 1ms latency เพิ่ม (ไม่รู้สึก)
  - 1,000 connections = ~33MB memory + <0.1 Mbps bandwidth

Data path:
  OCPP ──publish──► Redis "meter:{id}:{conn}" ──subscribe──► Mobile API ──SSE──► App

Critical prerequisites:
  1. เพิ่ม extract Power/Voltage/Current/SoC ใน handleMeterValues()
  2. ใช้ SseManagerService (1 Redis sub ต่อ instance, ไม่ใช่ 1 ต่อ client)
  3. ตั้ง proxy_buffering off ใน Nginx
  4. ตั้ง ulimit -n 65536 ใน container

SoC และ Time Remaining:
  OCPP 1.6 ไม่รับประกัน SoC — charger บางรุ่นส่ง บางรุ่นไม่ส่ง
  Time Remaining = estimate เท่านั้น หรือไม่แสดงเลยถ้าไม่มี SoC
```
