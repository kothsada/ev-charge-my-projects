# Mobile Real-time Charging Status Guide
> **Panda EV Platform** · OCPP 1.6J · NestJS · Redis · RabbitMQ
> วันที่วิเคราะห์: 2026-03-24

---

## 1. Current State Analysis — ทำไมข้อมูล Real-time ถึงยังขาดหายอยู่

### 1.1 เส้นทางข้อมูลในปัจจุบัน (As-Is)

```
Charge Point
    │  WebSocket (OCPP 1.6J)
    ▼
OCPP CSMS (port 4002)
├── MeterValues        → Redis  charging:live:{identity}:{connectorId}  (TTL 8h)
├── StatusNotification → Redis  connector_status:{chargerId}:{conn}     (TTL 60s)
│                      → Redis  charger_status:{identity}               (TTL 600s)
│                      → RabbitMQ  PANDA_EV_QUEUE
└── Heartbeat          → DB     lastHeartbeat
                       → Redis  charger_status (refresh TTL)

Mobile API (port 4001)
├── GET /charging-sessions/:id/live  ← อ่าน Redis (polling)
└── OcppConsumerService              ← consume PANDA_EV_QUEUE (billing only)
```

### 1.2 ปัญหาที่พบ (Gap Analysis)

| ปัญหา | สาเหตุ | ผลกระทบ |
|---|---|---|
| **ไม่มี push ไปยัง Mobile** | `handleMeterValues()` เขียนแค่ Redis ไม่มีการส่งต่อไปยัง client | Mobile ต้อง poll ทุก request |
| **Polling เท่านั้น** | `GET /live` อ่าน Redis ทุกครั้งที่ mobile เรียก | Latency = polling interval (5–30s) |
| **MeterValues กรอง measurand** | เก็บแค่ `Energy.Active.Import.Register` ค่าอื่น (Power, Voltage, Current, SoC) ถูกทิ้ง | ข้อมูลสำหรับ UI ไม่ครบ |
| **`chargerOnline` null หลัง 10 นาที** | Heartbeat ไม่ refresh Redis (แก้แล้วในเซสชั่นนี้) | แสดงสถานะผิดพลาด |
| **ไม่มี SSE / WebSocket endpoint** | ไม่มีใน Mobile API | Push notification เดียวที่มีคือ FCM (one-time) |

### 1.3 โครงสร้าง Redis ปัจจุบัน

```
charging:live:{identity}:{connectorId}   TTL 8h
  { meterWh: 1350, transactionId: 3, updatedAt: "2026-03-24T..." }
  ↑ มีแค่ Energy — ไม่มี Power/Voltage/Current/SoC

charger_status:{identity}                TTL 600s
  { status: "ONLINE", identity: "PANDA-DONGNASOK-08", updatedAt: "..." }

connector_status:{chargerId}:{connId}    TTL 60s
  { status: "Charging", chargerId: "...", connectorId: 1, updatedAt: "..." }
```

**ข้อสรุป:** โครงสร้างรองรับแค่ Energy และ Status ไม่รองรับ multi-measurand real-time stream

---

## 2. Recommended Architecture — สถาปัตยกรรมที่แนะนำ

### 2.1 เปรียบเทียบเทคโนโลยี

| วิธี | Latency | Battery | Server Load | ความยากในการ implement | เหมาะกับ use case นี้ |
|---|---|---|---|---|---|
| **WebSocket (persistent)** | ~50ms | สูง (connection ค้างตลอด) | กลาง | สูง | ❌ overkill สำหรับ update 15s |
| **SSE (Server-Sent Events)** | ~100ms | กลาง (HTTP stream) | กลาง | ปานกลาง | ✅ เหมาะสม |
| **Short Polling (5s)** | 5s | สูง (request ซ้ำ) | สูง | ต่ำ | ⚠️ ทำได้แต่ไม่ efficient |
| **Long Polling** | ~1s | กลาง | สูง | สูง | ❌ ซับซ้อน ไม่คุ้ม |
| **Push Notification (FCM)** | วินาที–นาที | ต่ำมาก | ต่ำ | ต่ำ | ✅ สำหรับ event เท่านั้น |

### 2.2 คำแนะนำ — Hybrid 2-Layer

```
Layer A: SSE stream  →  live meter values ทุก 15s (ขณะ app อยู่ foreground)
Layer B: FCM push    →  event สำคัญ (charging started/stopped, status changed)
```

**เหตุผลที่เลือก SSE:**
- ใช้ HTTP เดิมได้เลย ไม่ต้องเปิด port ใหม่
- One-way (server → client) ตรงกับ use case: mobile แค่ "ดู" ไม่ได้ส่งกลับ
- NestJS รองรับ native ผ่าน `@Sse()` + `Observable`
- Reconnect อัตโนมัติในทุก HTTP client
- Battery ดีกว่า WebSocket เพราะไม่ต้อง keep-alive ping

### 2.3 สถาปัตยกรรมที่เสนอ (To-Be)

```
Charge Point  ──OCPP WS──►  OCPP CSMS (4002)
                                │
                    handleMeterValues()
                                │
                    ┌───────────┴────────────┐
                    │                        │
              Redis write              Redis Pub/Sub
         charging:live:*               channel: meter:{identity}:{connId}
              (เดิม)                   (ใหม่ — ephemeral)
                                        │
                              Mobile API (4001)
                              SseChargingService
                                │   subscribe Redis channel
                                │   filter by sessionId + userId
                                ▼
                    GET /charging-sessions/:id/stream  (SSE)
                                │
                          Mobile App
                    EventSource  ──  update UI ทุก 15s
                                │
                    Background → pause SSE, rely on FCM
```

---

## 3. OCPP Configuration — ตั้งค่า Charge Point

### 3.1 Configuration Keys ที่เกี่ยวข้อง (OCPP 1.6 Core Profile)

| Key | ค่าปัจจุบัน (VCP) | ค่าแนะนำ | คำอธิบาย |
|---|---|---|---|
| `MeterValueSampleInterval` | 15 (วินาที) | **10** | ส่ง MeterValues ทุกกี่วินาที |
| `MeterValuesSampledData` | `Energy.Active.Import.Register` | ดูด้านล่าง | measurand ที่ส่ง |
| `StopTxnSampledData` | ไม่ได้ตั้ง | `Energy.Active.Import.Register` | ส่งใน StopTransaction |
| `ClockAlignedDataInterval` | 0 | 0 (ปิด) | interval แบบ clock-aligned |

### 3.2 MeterValuesSampledData ที่แนะนำ

```
Energy.Active.Import.Register,Power.Active.Import,Current.Import,Voltage,SoC
```

> **หมายเหตุ:** ไม่ใช่ทุก charger รองรับครบ — ตรวจสอบ `GetConfiguration` ก่อน

### 3.3 Admin API — ตั้งค่าผ่าน ChangeConfiguration

ระบบมี endpoint อยู่แล้ว:

```
POST /api/admin/v1/chargers/{id}/commands/change-configuration
Authorization: Bearer <admin_token>

{
  "key": "MeterValueSampleInterval",
  "value": "10"
}
```

```
POST /api/admin/v1/chargers/{id}/commands/change-configuration
{
  "key": "MeterValuesSampledData",
  "value": "Energy.Active.Import.Register,Power.Active.Import,Current.Import,Voltage,SoC"
}
```

### 3.4 Dynamic Sampling Rate (Logic)

ปรับ interval ตามสถานะ:

```typescript
// ส่งใน onStartTransaction หรือ AdminCommandService
async adjustSamplingForChargingState(
  identity: string,
  state: 'charging' | 'idle',
): Promise<void> {
  const interval = state === 'charging' ? '10' : '300'; // 10s ขณะชาร์จ, 5min ขณะ idle
  await this.gateway.sendChangeConfiguration(
    identity,
    'MeterValueSampleInterval',
    interval,
  );
}
```

---

## 4. Backend Implementation — แผนการ implement ฝั่ง Server

### 4.1 ขยาย `handleMeterValues` — เก็บ measurand ครบทุกตัว

**ไฟล์:** `panda-ev-ocpp/src/modules/ocpp/ocpp.service.ts`

```typescript
// เพิ่ม interface สำหรับ multi-measurand
interface LiveMeterState {
  energyWh:       number | null;  // Energy.Active.Import.Register (Wh)
  powerW:         number | null;  // Power.Active.Import (W)
  currentA:       number | null;  // Current.Import (A)
  voltageV:       number | null;  // Voltage (V)
  socPercent:     number | null;  // SoC (%)
  transactionId:  number | null;
  updatedAt:      string;
}

async handleMeterValues(
  identity: string,
  connectorId: number,
  transactionId: number | undefined,
  meterValues: Array<{ timestamp: string; sampledValue: Array<{ value: string; measurand?: string; unit?: string; }> }>,
): Promise<void> {
  const state: LiveMeterState = {
    energyWh: null, powerW: null, currentA: null,
    voltageV: null, socPercent: null,
    transactionId: transactionId ?? null,
    updatedAt: nowBangkokIso(),
  };

  for (const mv of meterValues) {
    for (const sv of mv.sampledValue) {
      const measurand = sv.measurand ?? 'Energy.Active.Import.Register';
      const raw = parseFloat(sv.value);
      if (isNaN(raw)) continue;
      const unit = (sv.unit ?? '').trim();

      switch (measurand) {
        case 'Energy.Active.Import.Register':
          state.energyWh = unit.toLowerCase() === 'kwh'
            ? Math.round(raw * 1000) : Math.round(raw);
          state.updatedAt = mv.timestamp;
          break;
        case 'Power.Active.Import':
          state.powerW = unit.toLowerCase() === 'kw'
            ? Math.round(raw * 1000) : Math.round(raw);
          break;
        case 'Current.Import':
          state.currentA = Math.round(raw * 10) / 10; // 1 ทศนิยม
          break;
        case 'Voltage':
          state.voltageV = Math.round(raw);
          break;
        case 'SoC':
          state.socPercent = Math.round(raw);
          break;
      }
    }
  }

  if (state.energyWh === null) return;

  // 1. เขียน Redis (เดิม — polling fallback)
  const key = `charging:live:${identity}:${connectorId}`;
  await this.cache.set(key, state, 8 * 3600).catch(() => null);

  // 2. Publish ไป Redis Pub/Sub (ใหม่ — SSE push)
  await this.redis
    .publish(`meter:${identity}:${connectorId}`, JSON.stringify(state))
    .catch(() => null);

  this.logger.debug(
    `MeterValues: ${identity}:${connectorId} → ${state.energyWh} Wh, ${state.powerW ?? 'N/A'} W`,
  );
}
```

### 4.2 เพิ่ม Redis Pub/Sub ใน `RedisService`

**ไฟล์:** `panda-ev-ocpp/src/configs/redis/redis.service.ts`

```typescript
// เพิ่ม publisher method (ใช้ connection เดิม)
async publish(channel: string, message: string): Promise<void> {
  await this.client.publish(channel, message);
}
```

**ไฟล์:** `panda-ev-client-mobile/src/configs/redis/redis.service.ts`

```typescript
import Redis from 'ioredis';

// สร้าง subscriber connection แยก (ioredis บังคับ)
private subscriber: Redis | null = null;

async subscribe(
  channel: string,
  handler: (message: string) => void,
): Promise<() => void> {
  if (!this.subscriber) {
    this.subscriber = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
  }
  await this.subscriber.subscribe(channel);
  const listener = (ch: string, msg: string) => {
    if (ch === channel) handler(msg);
  };
  this.subscriber.on('message', listener);
  // คืน unsubscribe function
  return () => {
    void this.subscriber?.unsubscribe(channel);
    this.subscriber?.off('message', listener);
  };
}
```

### 4.3 SSE Endpoint ใน Mobile API

**ไฟล์:** `panda-ev-client-mobile/src/modules/charging-session/charging-session.controller.ts`

```typescript
import { Controller, Get, Param, Req, Res, Sse } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';
import { map } from 'rxjs/operators';

@Sse(':id/stream')
@ApiOperation({
  summary: 'Real-time charging stream (SSE)',
  description:
    'Server-Sent Events stream สำหรับข้อมูล live ขณะชาร์จ ' +
    'ส่ง event ทุกครั้งที่ OCPP CSMS ได้รับ MeterValues (~10–15s) ' +
    'Client ควร subscribe ขณะ session ACTIVE และ unsubscribe เมื่อ COMPLETED',
})
@ApiBearerAuth()
streamLiveStatus(
  @CurrentUser('id') userId: string,
  @Param('id') sessionId: string,
): Observable<MessageEvent> {
  return this.chargingSessionService.streamLiveStatus(userId, sessionId);
}
```

**ไฟล์:** `panda-ev-client-mobile/src/modules/charging-session/charging-session.service.ts`

```typescript
import { Observable, Subject, interval } from 'rxjs';
import { takeUntil, startWith, switchMap } from 'rxjs/operators';

streamLiveStatus(userId: string, sessionId: string): Observable<MessageEvent> {
  const stop$ = new Subject<void>();

  return new Observable((observer) => {
    void (async () => {
      // 1. ตรวจสิทธิ์: session ต้องเป็นของ userId
      const session = await this.prisma.chargingSession.findFirst({
        where: { id: sessionId, userId },
      });
      if (!session) {
        observer.error(new HttpException('Session not found', 404));
        return;
      }
      if (session.status !== 'ACTIVE') {
        observer.error(new HttpException('Session not active', 409));
        return;
      }

      const identity = session.chargerIdentity!;
      const connectorId = (await this.getConnectorIdFromSession(sessionId)) ?? 1;
      const channel = `meter:${identity}:${connectorId}`;

      // 2. Subscribe Redis Pub/Sub
      const unsubscribe = await this.redis.subscribe(channel, (raw) => {
        try {
          const data = JSON.parse(raw) as LiveMeterState;
          // คำนวณ energyKwh และ estimatedCost ก่อนส่ง
          const meterStart = session.meterStartWh ?? 0;
          const energyKwh = data.energyWh != null
            ? Math.round(((data.energyWh - meterStart) / 1000) * 1000) / 1000
            : null;
          const pricePerKwh = Number(session.pricePerKwh ?? 0);
          const estimatedCost = energyKwh != null
            ? Math.round(energyKwh * pricePerKwh) : null;

          observer.next({
            data: {
              sessionId,
              status: 'ACTIVE',
              chargerIdentity: identity,
              connectorId,
              durationMinutes: Math.floor(
                (Date.now() - session.startedAt.getTime()) / 60000,
              ),
              energyKwh,
              pricePerKwh,
              estimatedCost,
              powerKw:    data.powerW    != null ? data.powerW / 1000    : null,
              currentA:   data.currentA,
              voltageV:   data.voltageV,
              socPercent: data.socPercent,
              meterUpdatedAt: data.updatedAt,
              chargerOnline: true,
            },
          } as MessageEvent);
        } catch { /* ignore parse error */ }
      });

      // 3. ส่งข้อมูลปัจจุบันทันทีที่ subscribe (ไม่รอ meter event ถัดไป)
      const snapshot = await this.getLiveStatus(userId, sessionId).catch(() => null);
      if (snapshot) observer.next({ data: snapshot } as MessageEvent);

      // 4. ตรวจสอบ session หมดอายุ (polling ทุก 30s — ไม่บ่อยเพราะมี push แล้ว)
      const sessionCheck = setInterval(async () => {
        const current = await this.prisma.chargingSession.findUnique({
          where: { id: sessionId },
          select: { status: true },
        });
        if (current?.status !== 'ACTIVE') {
          observer.next({
            data: { sessionId, status: current?.status ?? 'COMPLETED', final: true },
          } as MessageEvent);
          observer.complete();
          stop$.next();
        }
      }, 30_000);

      // 5. Cleanup เมื่อ client disconnect
      return () => {
        unsubscribe();
        clearInterval(sessionCheck);
        stop$.next();
      };
    })();
  });
}
```

### 4.4 Security — ตรวจสิทธิ์ก่อน stream

ทุก SSE connection ผ่าน `JwtAuthGuard` (global) อยู่แล้ว และ `streamLiveStatus()` ตรวจ `userId` ก่อน subscribe Redis channel เสมอ

```typescript
// session ต้องเป็นของ userId → ป้องกัน user อื่น subscribe channel เดียวกัน
const session = await this.prisma.chargingSession.findFirst({
  where: { id: sessionId, userId }, // userId จาก JWT
});
if (!session) throw new HttpException('Not found', 404);
```

---

## 5. Mobile Implementation — การรับและแสดงข้อมูลฝั่ง App

### 5.1 SSE Client Pattern (TypeScript / React Native)

```typescript
// services/ChargingStreamService.ts

interface LiveChargingData {
  sessionId:      string;
  status:         'ACTIVE' | 'COMPLETED' | 'FAILED';
  chargerIdentity: string;
  connectorId:    number;
  durationMinutes: number;
  energyKwh:      number | null;
  pricePerKwh:    number;
  estimatedCost:  number | null;
  powerKw:        number | null;   // กิโลวัตต์
  currentA:       number | null;   // แอมแปร์
  voltageV:       number | null;   // โวลต์
  socPercent:     number | null;   // % แบตเตอรี่รถ
  meterUpdatedAt: string | null;
  chargerOnline:  boolean;
  final?:         boolean;         // true = session จบแล้ว ให้ close stream
}

export class ChargingStreamService {
  private eventSource: EventSource | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 3000; // ms — เพิ่มแบบ exponential
  private maxReconnectDelay = 30_000;

  subscribe(
    sessionId: string,
    accessToken: string,
    baseUrl: string,
    onUpdate: (data: LiveChargingData) => void,
    onError?: (err: Event) => void,
  ): () => void {
    const url = `${baseUrl}/api/mobile/v1/charging-sessions/${sessionId}/stream`;

    const connect = () => {
      // SSE ไม่รองรับ Authorization header โดยตรงใน EventSource standard
      // → ใช้ URL query param (short-lived token) หรือ fetch-based SSE
      this.eventSource = new EventSource(`${url}?token=${accessToken}`);

      this.eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data as string) as LiveChargingData;
          onUpdate(data);

          if (data.final || data.status !== 'ACTIVE') {
            this.close(); // session จบ — ปิด stream
          }
        } catch { /* ignore */ }
      };

      this.eventSource.onerror = (err) => {
        onError?.(err);
        this.close();
        // Reconnect พร้อม exponential backoff
        if (this.reconnectDelay <= this.maxReconnectDelay) {
          this.reconnectTimer = setTimeout(() => {
            this.reconnectDelay = Math.min(
              this.reconnectDelay * 2, this.maxReconnectDelay,
            );
            connect();
          }, this.reconnectDelay);
        }
      };

      this.eventSource.onopen = () => {
        this.reconnectDelay = 3000; // reset หลัง connect สำเร็จ
      };
    };

    connect();

    return () => this.close(); // คืน unsubscribe function
  }

  close(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.eventSource?.close();
    this.eventSource = null;
  }
}
```

> **หมายเหตุ EventSource + Auth Header:** `EventSource` มาตรฐานไม่รองรับ custom header
> ทางเลือก: (A) ส่ง token ผ่าน query param `?token=xxx` แล้ว middleware ตรวจ
> (B) ใช้ `fetch()` + `ReadableStream` ที่รองรับ header ได้เต็มที่ (React Native ≥ 0.72)

### 5.2 React Native — UI State Management

```typescript
// hooks/useChargingLive.ts
import { useState, useEffect, useRef } from 'react';

export function useChargingLive(sessionId: string, token: string) {
  const [data, setData] = useState<LiveChargingData | null>(null);
  const [connected, setConnected] = useState(false);
  const streamRef = useRef(new ChargingStreamService());
  const appState = useRef(AppState.currentState);

  useEffect(() => {
    // Subscribe เมื่อ component mount
    const unsub = streamRef.current.subscribe(
      sessionId, token, BASE_URL,
      (update) => { setData(update); setConnected(true); },
      () => setConnected(false),
    );

    // Pause SSE เมื่อ app เข้า background (ประหยัดแบตเตอรี่)
    const appStateListener = AppState.addEventListener('change', (state) => {
      if (state === 'background' || state === 'inactive') {
        streamRef.current.close();
        setConnected(false);
      } else if (state === 'active' && appState.current !== 'active') {
        // Resume เมื่อกลับมา foreground
        const newUnsub = streamRef.current.subscribe(
          sessionId, token, BASE_URL,
          (update) => { setData(update); setConnected(true); },
          () => setConnected(false),
        );
        return newUnsub;
      }
      appState.current = state;
    });

    return () => {
      unsub();
      appStateListener.remove();
    };
  }, [sessionId, token]);

  return { data, connected };
}
```

### 5.3 ข้อมูลที่แสดงบนหน้าจอ Charging Screen

```
┌─────────────────────────────────────────────┐
│  🔌 PANDA-DONGNASOK-08  ● ONLINE            │
│  Panda EV — Dongnasok   Connector #1        │
├─────────────────────────────────────────────┤
│                                             │
│   ⚡ พลังงานที่ได้รับ                         │
│        1.31 kWh                             │
│                                             │
│   ─────────────────────────────────────     │
│   ⏱ เวลา      │  💰 ต้นทุนโดยประมาณ        │
│   2 นาที      │  1,310 LAK                  │
│   ─────────────────────────────────────     │
│   ⚡ กำลัง    │  🔋 SoC รถ                   │
│   22 kW       │  67%                        │
│   ─────────────────────────────────────     │
│   🔌 กระแส    │  🔋 แรงดัน                   │
│   32 A        │  380 V                      │
│                                             │
│   อัปเดตล่าสุด: 10:00:42                    │
│                                             │
│        [  หยุดชาร์จ  ]                       │
└─────────────────────────────────────────────┘
```

### 5.4 Fallback — ถ้า SSE ไม่พร้อม

```typescript
// ถ้า EventSource ไม่รองรับ หรือ network ไม่เสถียร → fall back เป็น polling
async function pollFallback(sessionId: string, token: string) {
  const res = await fetch(
    `/api/mobile/v1/charging-sessions/${sessionId}/live`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  return res.json() as Promise<LiveChargingData>;
}
```

---

## 6. Testing & Validation — ตรวจสอบ Latency และ Accuracy

### 6.1 ทดสอบ End-to-End Latency

```bash
# 1. เปิด VCP (interval 10s)
cd ocpp-virtual-charge-point
npm start index_16.ts

# 2. ตั้งค่า MeterValueSampleInterval = 10
curl -X POST http://localhost:4000/api/admin/v1/chargers/{id}/commands/change-configuration \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"key":"MeterValueSampleInterval","value":"10"}'

# 3. เปิด session
SESSION_ID=$(curl -s -X POST .../charging-sessions/start ... | jq -r .data.id)

# 4. Subscribe SSE และจับเวลา
curl -N -H "Authorization: Bearer $TOKEN" \
  "http://localhost:4001/api/mobile/v1/charging-sessions/$SESSION_ID/stream"
# สังเกต timestamp ใน meterUpdatedAt vs เวลาจริง

# 5. วัด latency
# Expected: < 1s (Redis Pub/Sub latency ในเครื่อง < 5ms)
```

### 6.2 ตรวจสอบ measurand ครบ

```bash
# ดู Redis live key โดยตรง
docker exec redis redis-cli get "charging:live:PANDA-DONGNASOK-08:1"
# Expected: { energyWh, powerW, currentA, voltageV, socPercent, ... }
```

### 6.3 ทดสอบ Reconnect

```bash
# Simulate network drop: ปิด OCPP service แล้วเปิดใหม่
pkill -f "npm run start:dev"  # ในโฟลเดอร์ panda-ev-ocpp
npm run start:dev
# Mobile app ควร reconnect ภายใน 3s (exponential backoff: 3s, 6s, 12s, ...)
```

### 6.4 ทดสอบ Background Pause

```typescript
// ใน Jest / Detox
it('pauses SSE when app goes background', () => {
  const service = new ChargingStreamService();
  const unsub = service.subscribe(sessionId, token, BASE_URL, jest.fn());

  // Simulate background
  AppState.currentState = 'background';
  fireEvent(AppState, 'change', 'background');

  expect(service['eventSource']).toBeNull(); // stream ถูกปิด
  unsub();
});
```

### 6.5 ตรวจสอบ Billing Accuracy

```bash
# หลัง stop session: ตรวจ meterStop vs Redis live สุดท้าย
psql $DB -c "SELECT meter_stop, (meter_stop::float / 1000) as kwh FROM panda_ev_ocpp.transactions WHERE ocpp_transaction_id = 3;"
docker exec redis redis-cli get "charging:live:PANDA-DONGNASOK-08:1"
# energyWh ใน Redis ควรใกล้เคียง meter_stop (diff < interval × maxPower / 3600)
```

---

## 7. Troubleshooting — ปัญหาที่พบบ่อยและวิธีแก้

### 7.1 `chargerOnline: null` ปรากฏใน getLiveStatus

**สาเหตุ:** Redis key `charger_status:{identity}` หมดอายุ (TTL 600s)
**แก้ไขแล้ว (2026-03-24):** `handleHeartbeat()` ใน `ocpp.service.ts` refresh key ทุก Heartbeat (ทุก 5 นาที)

### 7.2 `energyKwh` ไม่อัปเดต แต่ session ยัง ACTIVE

**ตรวจสอบ:**
```bash
# ดู VCP log ว่าส่ง MeterValues อยู่ไหม
tail -f /tmp/vcp.log | grep MeterValues

# ดู Redis key
docker exec redis redis-cli get "charging:live:PANDA-DONGNASOK-08:1"
docker exec redis redis-cli ttl "charging:live:PANDA-DONGNASOK-08:1"
```
**สาเหตุบ่อย:** VCP ส่ง measurand ผิดชื่อ (เช่น `Energy.Active.Import` แทน `Energy.Active.Import.Register`)

### 7.3 Charger lock ค้าง หลัง OCPP hot-reload

**อาการ:** `POST /start` คืน `409 This charger already has an active session`
**แก้ไข:**
```bash
docker exec redis redis-cli del "charging:charger:PANDA-DONGNASOK-08"
psql $CORE_DB -c "UPDATE panda_ev_core.charging_sessions SET status='FAILED', ended_at=NOW() WHERE charger_identity='PANDA-DONGNASOK-08' AND status='ACTIVE';"
```

### 7.4 SSE connection ขาดบ่อยบน 4G

**สาเหตุ:** Mobile operator ตัด idle TCP connection ทุก 30–60s
**แก้ไข:**
- เพิ่ม SSE keep-alive comment จาก server ทุก 20s:
```typescript
// ใน streamLiveStatus Observable
const keepAlive = setInterval(() => {
  observer.next({ data: ':keep-alive' } as MessageEvent);
}, 20_000);
```
- ฝั่ง client: `EventSource` reconnect อัตโนมัติเมื่อได้ HTTP 200 พร้อม `retry: 3000` header

### 7.5 Battery drain สูงเกินไป

**ตรวจสอบ:** ดู network request ว่า poll บ่อยเกินไปหรือเปล่า
**แนวทาง:**
- ลด `MeterValueSampleInterval` เป็น 30s ถ้า Power < 3.7 kW (AC slow charge)
- ปิด SSE เมื่อ SoC > 95% (ชาร์จเกือบเต็ม) → เปลี่ยนเป็น FCM notification แทน
- ใช้ `AppState` pause SSE ขณะ background (implement ไว้แล้วใน section 5.2)

### 7.6 SoC ไม่แสดง

**สาเหตุ:** Charger ไม่รองรับ SoC measurand หรือไม่ได้ตั้ง `MeterValuesSampledData`
**ตรวจสอบ:**
```bash
# ดู supported measurands
curl -X POST .../commands/get-configuration \
  -d '{"keys":["MeterValuesSampledData","SupportedMeasurands"]}'
```

---

## Summary — สรุปขั้นตอน Implementation

| ลำดับ | งาน | ไฟล์ที่แก้ | ความยาก |
|---|---|---|---|
| 1 | ขยาย `handleMeterValues` ให้เก็บ multi-measurand | `ocpp/ocpp.service.ts` | ง่าย |
| 2 | เพิ่ม `redis.publish()` ใน OCPP service | `ocpp/redis.service.ts` | ง่าย |
| 3 | เพิ่ม `redis.subscribe()` ใน Mobile API | `mobile/redis.service.ts` | ปานกลาง |
| 4 | สร้าง `GET :id/stream` SSE endpoint | `mobile/charging-session.*` | ปานกลาง |
| 5 | แก้ auth สำหรับ SSE (token via query param) | `mobile/jwt.strategy.ts` | ปานกลาง |
| 6 | ตั้งค่า `MeterValuesSampledData` บน Charger | Admin API | ง่าย |
| 7 | Implement `ChargingStreamService` ใน mobile app | Mobile app code | ปานกลาง |
| 8 | Background pause + reconnect logic | Mobile app code | ปานกลาง |

> **Estimated latency หลัง implement:** OCPP → Redis Pub/Sub → SSE → Mobile UI ≈ **< 500ms**
> (เทียบกับ polling เดิมที่ 5–30s)
