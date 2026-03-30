# E2E Testing Session & Bug Fixes — 2026-03-30

## สรุปสิ่งที่ทำในวันนี้

---

## Bugs ที่แก้ไข

### Bug 1 — `Argument 'id' must not be null` ใน Mobile API
**ไฟล์:** `panda-ev-client-mobile/src/modules/charging-session/ocpp-consumer.service.ts`

**สาเหตุ:** ส่ง `StartTransaction` โดยตรงผ่าน Postman WebSocket โดยไม่ผ่าน Mobile API ก่อน → OCPP ไม่เจอ pending session → publish `sessionId: null`

**วิธีแก้:** เพิ่ม null guard ใน `handleSessionStarted` — ถ้า `sessionId` เป็น null ให้ log warn แล้ว return

---

### Bug 2 — Notification service: `No trusted key for issuer "ocpp-csms"`
**ไฟล์:** `panda-ev-notification/.env`, `panda-ev-notification/keys/`

**สาเหตุ:** Notification service ขาด `ocpp.pub` และ `TRUSTED_SERVICE_ISSUERS` ไม่มี `ocpp-csms:ocpp`

**วิธีแก้:**
```bash
cp panda-ev-ocpp/keys/ocpp.pub panda-ev-notification/keys/ocpp.pub
```
และเปลี่ยน `.env`:
```
TRUSTED_SERVICE_ISSUERS=mobile-api:mobile,admin-api:admin,ocpp-csms:ocpp
```

---

### Bug 3 — RemoteStart TIMEOUT (15 วินาที)
**ไฟล์:** `panda-ev-ocpp/src/modules/ocpp/ocpp.gateway.ts`

**สาเหตุ:** Postman ต้องตอบ `RemoteStartTransaction` ภายใน 15 วินาที — ทำด้วยมือไม่ทัน

**วิธีแก้:** เปลี่ยน `REMOTE_CMD_TIMEOUT_MS` ให้ dev = 60 วินาที, production = 15 วินาที:
```ts
private readonly REMOTE_CMD_TIMEOUT_MS =
  process.env.NODE_ENV === 'production' ? 15_000 : 60_000;
```

**แนะนำ:** ใช้ VCP Simulator แทน Postman (auto-respond RemoteStart):
```bash
cd ocpp-virtual-charge-point
WS_URL=ws://localhost:4002/ocpp/PANDA-DONGNASOK-08 CP_ID=PANDA-DONGNASOK-08 npm start index_16.ts
```

---

### Bug 4 — 409 RESOURCE_CONFLICT หลัง charger offline
**ไฟล์:** `panda-ev-client-mobile/src/modules/charging-session/ocpp-consumer.service.ts`

**สาเหตุ:** `handleChargerOffline` แค่ส่ง push notification แต่ไม่ได้ mark session `FAILED` หรือล้าง Redis lock

**วิธีแก้:** เพิ่มใน `handleChargerOffline`:
1. `prisma.chargingSession.updateMany` → `status: FAILED, endedAt: now`
2. `redis.del(charging:session:{id})` + `redis.del(charging:charger:{identity})`

**Manual fix (ถ้า lock ค้าง):**
```bash
docker exec redis redis-cli DEL "charging:charger:PANDA-DONGNASOK-08"
docker exec redis redis-cli DEL "charging:session:<sessionId>"
psql "postgresql://postgresuser:postgrespassword@localhost:5432/panda-ev-core-db" \
  -c "UPDATE panda_ev_core.charging_sessions SET status='FAILED', ended_at=NOW() WHERE id='<sessionId>' AND status='ACTIVE';"
```

---

### Bug 5 — SSE ยังส่งข้อมูลหลัง session COMPLETED
**ไฟล์:** `panda-ev-client-mobile/src/modules/charging-session/charging-session.service.ts`

**สาเหตุ:** `createChargingStream` ไม่มีการเช็ค session status — stream เปิดค้างตลอด

**วิธีแก้:** เพิ่ม `statusPoller` ทุก 10 วินาที ถ้า status ไม่ใช่ `ACTIVE` → ส่ง `{ended: true}` แล้ว `subscriber.complete()`

**Mobile App ควรฟัง:**
```js
evtSource.onmessage = (e) => {
  const data = JSON.parse(e.data);
  if (data.ended) {
    evtSource.close();
    // navigate to summary screen
  }
};
```

---

### Bug 6 — powerW/voltageV/currentA เป็น null ใน SSE
**ไฟล์:** `ocpp-virtual-charge-point/src/v16/messages/startTransaction.ts`

**สาเหตุ:** VCP ส่งแค่ `Energy.Active.Import.Register` — ไม่มี Power/Voltage/Current

**วิธีแก้:** เพิ่ม sampledValues ใน `meterValuesCallback`:
```ts
{ value: "220.0", measurand: "Voltage", unit: "V" },
{ value: "16.0",  measurand: "Current.Import", unit: "A" },
{ value: "3520.0", measurand: "Power.Active.Import", unit: "W" },
```

---

### Bug 7 — `charger.heartbeat` Unknown routingKey WARN spam
**ไฟล์:** `panda-ev-client-mobile/src/modules/charging-session/ocpp-consumer.service.ts`

**วิธีแก้:** เพิ่ม silent ignore สำหรับ informational events:
```ts
} else if (routingKey === 'charger.heartbeat' || routingKey === 'charger.status_changed') {
  // Informational events — no action needed in mobile service
}
```

---

### Bug 8 — 503 `pricing_unavailable` เมื่อ start session
**ไฟล์:** `panda-ev-client-mobile/.env`

**สาเหตุ:** `SYSTEM_DATABASE_URL` ถูก comment out → Mobile ต่อ admin DB ไม่ได้ → query pricing ได้ null

**วิธีแก้:** Uncomment ใน `.env`:
```
SYSTEM_DATABASE_URL=postgresql://postgresuser:postgrespassword@localhost:5432/panda-ev-system-db?schema=panda_ev_system
```

---

### Bug 9 — `transaction.stopped` message หาย (billing ไม่ทำงาน)
**สาเหตุ:** Mobile service restart ระหว่าง process → message ถูก nack แบบ no-requeue → หายถาวร

**Manual fix billing:**
```sql
BEGIN;
UPDATE panda_ev_core.charging_sessions
SET status='COMPLETED', energy_kwh=11.401, duration_minutes=439, amount=11401, ended_at='2026-03-29T19:27:56.319Z'
WHERE id='10a5256e-646c-41e7-abe4-c0868277db50' AND status='ACTIVE';

UPDATE panda_ev_core.wallets
SET balance = balance - 11401
WHERE id='354965ac-888a-4f87-bbe0-d587e462a197' AND balance >= 11401;

INSERT INTO panda_ev_core.wallet_transactions (id, wallet_id, user_id, type, amount, balance_after, reference_id, created_at)
SELECT gen_random_uuid(), '354965ac-888a-4f87-bbe0-d587e462a197', '23b6cebf-168e-4d9b-af4d-549e7bbab567',
       'CHARGE', 11401, balance, '10a5256e-646c-41e7-abe4-c0868277db50', NOW()
FROM panda_ev_core.wallets WHERE id='354965ac-888a-4f87-bbe0-d587e462a197';
COMMIT;
```

---

## Feature — DLQ สำหรับ PANDA_EV_QUEUE

### ไฟล์ที่แก้ไข
- `panda-ev-client-mobile/src/configs/rabbitmq/rabbitmq.service.ts`
- `panda-ev-client-mobile/src/modules/charging-session/ocpp-consumer.service.ts`
- `panda-ev-client-mobile/.env`

### Architecture
```
PANDA_EV_QUEUE (OCPP → Mobile)
  ↓ handler fails
  retry 1 → รอ 5 วิ  → re-publish
  retry 2 → รอ 30 วิ → re-publish
  retry 3 → รอ 120 วิ → re-publish
  retry 4 (เกิน max) → publish to PANDA_EV_QUEUE_DLX (fanout exchange)
                              ↓
                       PANDA_EV_QUEUE_DLQ (durable queue — ตรวจสอบได้)
```

### Methods เพิ่มใน RabbitMQService
- `consumeWithDlq(queue, handler, maxRetries=3)` — public, ใช้แทน `consume`
- `setupOcppEventsDlxAndQueues()` — private, assert DLX + DLQ ตอน connect
- `registerDlqConsumer(...)` — private, register consumer พร้อม retry logic
- `publishWithRetry(queue, message, retryCount, delayMs)` — private

### Env vars ที่เพิ่ม
```
RABBITMQ_OCPP_EVENTS_DLQ=PANDA_EV_QUEUE_DLQ
RABBITMQ_OCPP_EVENTS_DLX=PANDA_EV_QUEUE_DLX
```

---

## E2E Testing Flow (สรุป)

### Tools
- **Postman WebSocket** → `ws://localhost:4002/ocpp/PANDA-DONGNASOK-08`
- **VCP Simulator** → `WS_URL=ws://localhost:4002/ocpp/PANDA-DONGNASOK-08 CP_ID=PANDA-DONGNASOK-08 npm start index_16.ts`
- **Postman HTTP** → Mobile API `http://localhost:4001`

### Flow ที่ถูกต้อง (ใช้ VCP)
```
1. Start VCP → auto BootNotification + StatusNotification
2. POST /api/mobile/v1/auth/login → ได้ accessToken
3. POST /api/mobile/v1/charging-sessions/start → VCP auto-respond RemoteStart + StartTransaction
4. GET  /api/mobile/v1/charging-sessions/:id/stream → SSE real-time meter data
5. DELETE /api/mobile/v1/charging-sessions/:id → Stop session
6. Mobile billing auto-deduct wallet
```

### API Routes สำหรับ Real-time Status บน Mobile

มี 2 routes ที่ต่างกัน — ต้องเลือกให้ถูกตามการใช้งาน:

| Route | วิธีทำงาน | เหมาะกับ |
|---|---|---|
| `GET /:id/live` | HTTP GET ปกติ ส่ง response ครั้งเดียว | Poll ทุก 5–10 วิ, snapshot ครั้งแรก |
| `GET /:id/stream` | SSE — server push ตลอด connection | Real-time บน mobile app |

**ใช้ `/stream` (SSE) เป็นหลัก** เพราะ:
- ไม่ต้อง poll เอง — ประหยัด battery และ bandwidth
- server push ทันทีที่ charger ส่ง MeterValues
- มี `ended: true` บอก client ชัดเจนเมื่อ session สิ้นสุด

**ใช้ `/live` เมื่อ**:
- HTTP library บน mobile ไม่รองรับ SSE
- ต้องการ snapshot ครั้งเดียวตอนเปิดหน้าจอ

```
# SSE endpoint
GET /api/mobile/v1/charging-sessions/:id/stream
Authorization: Bearer <accessToken>

# Polling endpoint (ทางเลือก)
GET /api/mobile/v1/charging-sessions/:id/live
Authorization: Bearer <accessToken>
```

### SSE Response Events

**Meter update** (ทุกครั้งที่ charger ส่ง MeterValues):
```json
{
  "sessionId": "...",
  "meterWh": 1500,
  "energyKwh": 1.5,
  "estimatedCost": 1500,
  "powerW": 3520,
  "voltageV": 220,
  "currentA": 16,
  "socPercent": null,
  "updatedAt": "..."
}
```

**Heartbeat** (ทุก 30 วินาที — keepalive):
```json
{ "heartbeat": true }
```

**Session ended** (เมื่อ status ไม่ใช่ ACTIVE):
```json
{ "ended": true, "status": "COMPLETED", "sessionId": "..." }
```

ให้ client ปิด EventSource ทันทีที่ได้ `ended: true`:
```js
evtSource.onmessage = (e) => {
  const data = JSON.parse(e.data);
  if (data.ended) {
    evtSource.close();
    // navigate to billing summary screen
  }
};
```

### Redis Debug Commands
```bash
docker exec redis redis-cli GET "charging:charger:PANDA-DONGNASOK-08"
docker exec redis redis-cli GET "charging:session:<sessionId>"
docker exec redis redis-cli GET "charging:live:PANDA-DONGNASOK-08:1"
docker exec redis redis-cli GET "billing:done:<txId>"
```

### ล้าง stuck session
```bash
docker exec redis redis-cli DEL "charging:charger:PANDA-DONGNASOK-08"
docker exec redis redis-cli DEL "charging:session:<sessionId>"
```

---

## สิ่งที่ยังต้องทำ (Pending)

- [ ] ทดสอบ DLQ end-to-end (simulate handler failure)
- [ ] ทดสอบ SSE `ended: true` event บน mobile app จริง
- [ ] ตรวจสอบว่า VCP ส่ง Power/Voltage/Current ถูกต้องหลัง restart
- [ ] ทดสอบ full billing flow ตั้งแต่ต้นจนจบ (start → meter → stop → wallet deducted)
