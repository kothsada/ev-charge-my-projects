# คู่มือการทดสอบ Integration แบบ Manual — Panda EV Platform

> **วันที่**: 2026-03-28
> **ผู้จัดทำ**: QA Lead / Release Manager
> **ขอบเขต**: OCPP Service (4002) · Mobile API (4001) · CSMS System Admin (4000) · Notification Service (4003)
> **เวอร์ชัน Protocol**: OCPP 1.6J

---

## สารบัญ

1. [บทนำ](#1-บทนำ)
2. [ความเข้าใจพื้นฐาน — OCPP Message Format, messageId, idTag, และ Auth](#2-ความเข้าใจพื้นฐาน)
3. [Prerequisites — ข้อมูลและเครื่องมือที่ต้องเตรียม](#3-prerequisites)
4. [Test Case 1 — BootNotification (Charger เชื่อมต่อ)](#4-test-case-1--bootnotification)
5. [Test Case 2 — Authorize (ตรวจสอบสิทธิ์)](#5-test-case-2--authorize)
6. [Test Case 3 — Charging Session (StartTransaction → MeterValues → StopTransaction)](#6-test-case-3--charging-session)
7. [Test Case 4 — Notification Trigger (FCM หลัง Session สิ้นสุด)](#7-test-case-4--notification-trigger)
8. [Test Case 5 — Data Sync (CSMS ↔ OCPP Cache)](#8-test-case-5--data-sync)
9. [Test Case 6 — Dashboard Analytics (notification_daily_stats)](#9-test-case-6--dashboard-analytics)
10. [ตาราง Verification Checklist](#10-ตาราง-verification-checklist)
11. [Troubleshooting — ปัญหาที่พบบ่อย](#11-troubleshooting)
12. [Safety Notes — ข้อควรระวัง](#12-safety-notes)

---

## 1. บทนำ

คู่มือนี้ครอบคลุมการทดสอบ Integration แบบ manual ของระบบ **Panda EV** ทั้งหมด โดยมีวัตถุประสงค์เพื่อ:

- ยืนยันว่า service ทั้ง 4 สื่อสารกันได้อย่างถูกต้องผ่าน **RabbitMQ** และ **WebSocket**
- ตรวจสอบว่า **Notification Service** ส่ง FCM push ได้ครบทุก event
- ยืนยันความถูกต้องของ **Billing** (การตัดเงิน, การคำนวณ kWh)
- ตรวจสอบว่า **Analytics / Stats** อัปเดตหลังจบ session

### แผนผัง Flow ที่จะทดสอบ

```
[VCP Simulator / WebSocket Client]
         │  OCPP 1.6J WebSocket (ws://localhost:4002/ocpp/<identity>)
         ▼
[panda-ev-ocpp :4002]
    │  publishes → PANDA_EV_QUEUE
    ▼
[RabbitMQ]
    ├──► [panda-ev-client-mobile :4001]  → Billing, Wallet deduction
    │         │ publishes → PANDA_EV_NOTIFICATIONS
    │         ▼
    └──► [panda-ev-notification :4003]  → FCM send, Stats UPSERT
                  │ emits → /admin-stats WebSocket
                  ▼
         [panda-ev-csms-system-admin :4000]  → Admin Dashboard
```

---

## 2. ความเข้าใจพื้นฐาน

> ส่วນນີ້ອະທິບາຍໂຄງສ້າງ OCPP 1.6J message format ແລະ 3 ເລື່ອງທີ່ມັກສັບສົນ: **messageId ແມ່ນຫຍັງ**, **idTag ມາຈາກໃສ**, ແລະ **OCPP_AUTH_ENABLED ເຮັດວຽກແນວໃດ**

---

### 2.0 ໂຄງສ້າງ OCPP 1.6J Message Format

OCPP 1.6J ໃຊ້ **JSON Array** ທີ່ມີ 4 ຕຳແໜ່ງ (Index) ໃນການສື່ສານລະຫວ່າງ Charge Point ແລະ CSMS:

```
[MessageTypeId,  UniqueId,  Action,  Payload]
      │              │          │        │
      │              │          │        └── JSON Object ທີ່ມີຂໍ້ມູນຕົວຈິງ
      │              │          └─────────── ຊື່ຄຳສັ່ງ (ເຊັ່ນ: BootNotification)
      │              └────────────────────── String ທີ່ unique ສຳລັບແຕ່ລະ Call
      └───────────────────────────────────── Integer ບອກປະເພດຂໍ້ຄວາມ
```

#### MessageTypeId — ປະເພດຂໍ້ຄວາມ

| ຄ່າ | ຊື່ | ຄວາມໝາຍ | ທິດທາງ |
|---|---|---|---|
| `2` | **Call** | ຄຳສັ່ງ / ຄຳຮ້ອງຂໍ | Charge Point → CSMS ຫຼື CSMS → Charge Point |
| `3` | **CallResult** | ຄຳຕອບຮັບທີ່ສຳເລັດ | ຝ່າຍຕອບ → ຝ່າຍສ່ງ |
| `4` | **CallError** | ຄຳຕອບຮັບທີ່ມີຂໍ້ຜິດພາດ | ຝ່າຍຕອບ → ຝ່າຍສ່ງ |

#### UniqueId — ຄ່າທີ່ unique ສຳລັບທຸກ Call

- ຕ້ອງ **unique** ຕໍ່ຄຳສັ່ງດ່ຽວ ພາຍໃນ session WebSocket ດຽວກັນ
- ຝ່າຍຮັບຈະ **echo ກັບຄືນ** ໃນ `CallResult` / `CallError` ເພື່ອໃຫ້ຈັບຄູ່ request-response ໄດ້
- **ຕ້ອງການ**: ໃຊ້ **UUID v4** ຫຼື `Timestamp + Random` ເພື່ອຄວາມ unique ໃນລະດັບ production

```bash
# ວິທີສ້າງ UniqueId ທີ່ unique ໃນ terminal
uuidgen                              # ຜົນ: A3F2-... (macOS/Linux)
date +%s%N | md5sum | head -c 8     # ຜົນ: a3f2b1c8 (timestamp-based)
python3 -c "import uuid; print(uuid.uuid4())"  # ຜົນ: UUID format
```

```
# ໃນ Test Guide ນີ້ໃຊ້ຄ່າທີ່ອ່ານງ່າຍ:
"boot-test-001"   ← ຮູ້ທັນທີວ່າກຳລັງ test ຫຍັງ
"auth-test-001"
"start-txn-001"

# ໃນ Production ໃຫ້ໃຊ້ UUID:
"f47ac10b-58cc-4372-a567-0e02b2c3d479"
```

#### Payload — JSON Object ຂໍ້ມູນຕົວຈິງ

- ສຳລັບ `Call` (MessageTypeId=2): Payload ແຕກຕ່າງກັນຕາມ Action
- ສຳລັບ `CallResult` (MessageTypeId=3): Payload ແຕກຕ່າງກັນຕາມ Action ທີ່ຕອບ
- ສຳລັບ `CallError` (MessageTypeId=4): `[4, UniqueId, ErrorCode, ErrorDescription, ErrorDetails]`

---

#### ຕົວຢ່າງ Flow ຄົບວົງຈອນ (Complete Example Flow)

ນີ້ແມ່ນຕົວຢ່າງ OCPP message ທີ່ຈະເກີດຂຶ້ນທັງໝົດໃນ 1 session ການສາກໄຟ ຈາກ Charger ເຊື່ອມຕໍ່ ຈົນສຳເລັດ:

```
══════════════════════════════════════════════════════════════════
 OCPP 1.6J — Complete Charging Session Flow
 Charger Identity: PANDA-THATLUANG-01
══════════════════════════════════════════════════════════════════

STEP 1: Charger ເຂົ້າລະບົບ (Boot)
────────────────────────────────────────────────────────────────
→ Charger sends:
  [2, "uid-boot-001", "BootNotification", {
    "chargePointVendor": "SGIC",
    "chargePointModel": "DC-120KW",
    "firmwareVersion": "1.0.5"
  }]

← CSMS replies:
  [3, "uid-boot-001", {
    "status": "Accepted",
    "currentTime": "2026-03-28T19:00:00.000+07:00",
    "interval": 300
  }]

STEP 2: Connector ແຈ້ງສະຖານະ (Status)
────────────────────────────────────────────────────────────────
→ Charger sends (connectorId=0 = charger-level):
  [2, "uid-status-001", "StatusNotification", {
    "connectorId": 0,
    "errorCode": "NoError",
    "status": "Available"
  }]
← CSMS replies: [3, "uid-status-001", {}]

→ Charger sends (connectorId=1 = plug 1):
  [2, "uid-status-002", "StatusNotification", {
    "connectorId": 1,
    "errorCode": "NoError",
    "status": "Available"
  }]
← CSMS replies: [3, "uid-status-002", {}]

STEP 3: CSMS ສັ່ງເລີ່ມສາກ (Remote Start) ← ມາຈາກ Mobile App
────────────────────────────────────────────────────────────────
← CSMS sends (initiated by Mobile API via RabbitMQ):
  [2, "f47ac10b-58cc-4372-a567-0e02b2c3d479", "RemoteStartTransaction", {
    "connectorId": 1,
    "idTag": "MOBILE_APP"
  }]

→ Charger replies (ຍອມຮັບ):
  [3, "f47ac10b-58cc-4372-a567-0e02b2c3d479", {
    "status": "Accepted"
  }]

STEP 4: Charger ເລີ່ມ Transaction
────────────────────────────────────────────────────────────────
→ Charger sends:
  [2, "uid-start-001", "StartTransaction", {
    "connectorId": 1,
    "idTag": "MOBILE_APP",
    "meterStart": 0,
    "timestamp": "2026-03-28T19:05:10.000+07:00"
  }]

← CSMS replies (ຕອບດ້ວຍ transactionId ທີ່ສ້າງຂຶ້ນ):
  [3, "uid-start-001", {
    "transactionId": 1001,
    "idTagInfo": { "status": "Accepted" }
  }]

STEP 5: Connector ອັບເດດສະຖານະເປັນ Charging
────────────────────────────────────────────────────────────────
→ Charger sends:
  [2, "uid-status-003", "StatusNotification", {
    "connectorId": 1,
    "errorCode": "NoError",
    "status": "Charging",
    "timestamp": "2026-03-28T19:05:12.000+07:00"
  }]
← CSMS replies: [3, "uid-status-003", {}]

STEP 6: Heartbeat (ທຸກ 300 ວິ)
────────────────────────────────────────────────────────────────
→ Charger sends:
  [2, "uid-hb-001", "Heartbeat", {}]
← CSMS replies:
  [3, "uid-hb-001", { "currentTime": "2026-03-28T19:10:00.000+07:00" }]

STEP 7: MeterValues (ລາຍງານໄຟຟ້າທີ່ສາກ)
────────────────────────────────────────────────────────────────
→ Charger sends (ທຸກ 5 ນາທີ ຫຼືຕາມ config):
  [2, "uid-meter-001", "MeterValues", {
    "connectorId": 1,
    "transactionId": 1001,
    "meterValue": [{
      "timestamp": "2026-03-28T19:10:00.000+07:00",
      "sampledValue": [{
        "value": "5000",
        "measurand": "Energy.Active.Import.Register",
        "unit": "Wh"
      }]
    }]
  }]
← CSMS replies: [3, "uid-meter-001", {}]

STEP 8: CSMS ສັ່ງຢຸດສາກ (Remote Stop) ← ມາຈາກ Mobile App
────────────────────────────────────────────────────────────────
← CSMS sends:
  [2, "d9b8c7a6-1234-5678-abcd-ef0123456789", "RemoteStopTransaction", {
    "transactionId": 1001
  }]

→ Charger replies:
  [3, "d9b8c7a6-1234-5678-abcd-ef0123456789", {
    "status": "Accepted"
  }]

STEP 9: Charger ສົ່ງ StopTransaction
────────────────────────────────────────────────────────────────
→ Charger sends:
  [2, "uid-stop-001", "StopTransaction", {
    "transactionId": 1001,
    "meterStop": 45000,
    "timestamp": "2026-03-28T19:20:00.000+07:00",
    "reason": "Remote"
  }]

← CSMS replies:
  [3, "uid-stop-001", {
    "idTagInfo": { "status": "Accepted" }
  }]

STEP 10: Connector ກັບມາ Available
────────────────────────────────────────────────────────────────
→ Charger sends:
  [2, "uid-status-004", "StatusNotification", {
    "connectorId": 1,
    "errorCode": "NoError",
    "status": "Available"
  }]
← CSMS replies: [3, "uid-status-004", {}]

══════════════════════════════════════════════════════════════════
 ສຳເລັດ: ສາກໄຟ 45 kWh ໃນ 15 ນາທີ → ຕັດເງິນ 45,000 LAK
══════════════════════════════════════════════════════════════════
```

#### ຕາຕະລາງ OCPP Actions ທີ່ Panda EV ຮອງຮັບ

| Action | ຜູ້ສ່ງ | ຄວາມໝາຍ |
|---|---|---|
| `BootNotification` | Charger → CSMS | Charger ເຂົ້າລະບົບ/restart |
| `StatusNotification` | Charger → CSMS | ແຈ້ງສະຖານະ connector ຫຼື charger |
| `Heartbeat` | Charger → CSMS | ສັນຍານ alive (ທຸກ 5 ນາທີ) |
| `Authorize` | Charger → CSMS | ຂໍອະນຸຍາດ idTag (RFID/App) |
| `StartTransaction` | Charger → CSMS | ເລີ່ມ transaction ຈິງ |
| `StopTransaction` | Charger → CSMS | ສິ້ນສຸດ transaction |
| `MeterValues` | Charger → CSMS | ລາຍງານຄ່າ meter (Wh) |
| `DataTransfer` | Charger → CSMS | ຂໍ້ມູນ vendor-specific |
| `DiagnosticsStatusNotification` | Charger → CSMS | ສະຖານະການອັບໂຫລດ diagnostics |
| `FirmwareStatusNotification` | Charger → CSMS | ສະຖານະການອັບເດດ firmware |
| `RemoteStartTransaction` | **CSMS → Charger** | ສັ່ງເລີ່ມສາກຈາກ app |
| `RemoteStopTransaction` | **CSMS → Charger** | ສັ່ງຢຸດສາກຈາກ app |
| `ChangeAvailability` | **CSMS → Charger** | ເປີດ/ປິດ connector |
| `Reset` | **CSMS → Charger** | Restart charger |
| `UnlockConnector` | **CSMS → Charger** | ປົດລ໋ອກ connector |
| `GetConfiguration` | **CSMS → Charger** | ອ່ານ config ຈາກ charger |
| `ChangeConfiguration` | **CSMS → Charger** | ຕັ້ງຄ່າ config ໃນ charger |
| `TriggerMessage` | **CSMS → Charger** | ສັ່ງ charger ສ່ງ message ສະເພາະ |

---

### 2.1 messageId (`auth-test-001`, `boot-test-001`, …) คืออะไร

```
OCPP Call format:  [2,  "messageId",  "Action",  { payload }]
                    │    │
                    │    └── คุณสร้างเองได้ทุก string ที่ unique ภายใน session
                    └── messageType 2 = CALL (จาก charger), 3 = CALLRESULT (จาก CSMS)
```

`messageId` คือ **correlation ID** ที่คุณกำหนดเอง — ใช้เพื่อจับคู่ CALL กับ CALLRESULT ที่ตอบกลับมา

**กฎ**: ต้อง unique ภายในการเชื่อมต่อ WebSocket ครั้งนั้น แต่ **ไม่มีรูปแบบบังคับ** ใช้อะไรก็ได้ที่อ่านแล้วรู้ว่ากำลังทดสอบอะไร:

```json
// ตัวอย่างที่ใช้ได้ทั้งหมด — เลือกสไตล์ที่ชอบ
[2, "boot-test-001",    "BootNotification", { ... }]   // ← สไตล์ในคู่มือนี้
[2, "abc123",           "BootNotification", { ... }]   // ← สั้น
[2, "my-boot-1",        "BootNotification", { ... }]   // ← อ่านง่าย
[2, "1711612800000",    "BootNotification", { ... }]   // ← ใช้ timestamp ก็ได้
```

CSMS จะตอบกลับด้วย messageId **เดิม**:
```json
[3, "boot-test-001", { "status": "Accepted", "currentTime": "...", "interval": 300 }]
//   ↑ ตรงกับที่ส่งไป
```

> **สรุป**: ในคู่มือนี้ใช้ `boot-test-001`, `auth-test-001` ฯลฯ เพื่อให้อ่านรู้ว่าทดสอบอะไร — **คุณเปลี่ยนเป็นอะไรก็ได้**

---

### 2.2 `idTag` คืออะไร และต้องใช้ค่าอะไร

`idTag` ใน OCPP คือ **ตัวระบุตัวตนของผู้ใช้** — ในระบบ charger จริงมาจาก RFID card แต่ใน Panda EV ที่ใช้ Mobile App จะมีค่าตายตัวดังนี้:

| สถานการณ์ | `idTag` ที่ต้องใช้ | ที่มา |
|---|---|---|
| Mobile App สั่งชาร์จ (`session.start`) | `"MOBILE_APP"` | hardcode ใน `charging-session.service.ts` |
| ทดสอบ `Authorize` — ผ่าน | `"MOBILE_APP"` | OCPP service accept ค่านี้เสมอ |
| ทดสอบ `Authorize` — ไม่ผ่าน | `"INVALID-TAG-XYZ"` | ค่าใดๆ ที่ไม่ใช่ที่ระบบรู้จัก |
| `StartTransaction` จาก VCP simulator | `"MOBILE_APP"` | ต้องตรงกับที่ session.start ส่งไป |

```json
// ตัวอย่าง: Authorize ที่ถูกต้อง
[2, "auth-001", "Authorize", { "idTag": "MOBILE_APP" }]
// Response: { "idTagInfo": { "status": "Accepted" } }

// ตัวอย่าง: StartTransaction ที่ถูกต้อง
[2, "start-001", "StartTransaction", {
  "connectorId": 1,
  "idTag": "MOBILE_APP",
  "meterStart": 0,
  "timestamp": "2026-03-28T19:05:10.000+07:00"
}]
```

> **หมายเหตุ**: ระบบ Panda EV ไม่ได้ตรวจสอบ `idTag` อย่างเข้มงวด (ไม่มี Local Auth List) ตรวจแค่ว่าชาร์จเจอร์รู้จัก identity หรือไม่

---

### 2.3 `x-forwarded-for` — ไม่ต้องกำหนดเองสำหรับการทดสอบ local

`x-forwarded-for` คือ **HTTP header ที่ proxy/load balancer เติมให้อัตโนมัติ** เพื่อบอก IP จริงของ client ก่อนผ่าน proxy

โค้ดใน `ocpp.gateway.ts` อ่าน header นี้ดังนี้:
```typescript
// ocpp.gateway.ts:149
const clientIp =
  (request.headers['x-forwarded-for'] as string)?.split(',')[0].trim()
  ?? request.socket.remoteAddress   // ← ถ้าไม่มี header ใช้ IP จาก socket โดยตรง
  ?? 'unknown';
```

**สิ่งที่เกิดขึ้นในแต่ละกรณี:**

| สถานการณ์ | IP ที่ระบบเห็น | ต้องทำอะไร |
|---|---|---|
| `wscat` บน localhost โดยตรง | `127.0.0.1` หรือ `::1` (จาก socket) | ไม่ต้องทำอะไร |
| ผ่าน nginx/Traefik (staging/prod) | IP จาก `x-forwarded-for` header | proxy เติมให้อัตโนมัติ |
| ต้องการ simulate IP อื่น (test rate limit) | กำหนด header เองใน wscat | ดูคำสั่งด้านล่าง |

```bash
# กรณีทั่วไป — ไม่ต้องระบุ header ใดๆ เลย
wscat -c "ws://localhost:4002/ocpp/PANDA-THATLUANG-01" --subprotocol "ocpp1.6"

# กรณีต้องการ simulate IP สำหรับทดสอบ rate limit เท่านั้น
wscat -c "ws://localhost:4002/ocpp/PANDA-THATLUANG-01" \
      --subprotocol "ocpp1.6" \
      -H "x-forwarded-for: 203.0.113.10"
```

> **สรุป**: สำหรับการทดสอบ local **ไม่ต้องสนใจ `x-forwarded-for` เลย** — ระบบใช้ IP จาก socket (`127.0.0.1`) แทนโดยอัตโนมัติ

---

### 2.4 `OCPP_AUTH_ENABLED=true` — วิธีเชื่อมต่อเมื่อเปิด Authentication

เมื่อ `OCPP_AUTH_ENABLED=true` charger ต้องส่ง **HTTP Basic Auth** พร้อมกับ WebSocket upgrade request ตาม OCPP Security Profile 1

```
Format: Authorization: Basic base64(<identity>:<apiKey>)
        username = ต้องตรงกับ identity ใน URL path (/ocpp/<identity>)
        password = API key ของ charger นั้น
```

#### ขั้นตอนที่ต้องทำก่อนเชื่อมต่อ

**ขั้นที่ 1** — ตั้ง API key ของ charger ใน Redis (ทำครั้งเดียว):

```bash
# สร้าง API key (ใช้อะไรก็ได้ที่คาดเดายาก)
# สำหรับทดสอบ local ใช้ค่าง่ายๆ ได้
redis-cli SET "charger:apikey:PANDA-THATLUANG-01" "test-key-abc123"

# ยืนยันว่าบันทึกแล้ว
redis-cli GET "charger:apikey:PANDA-THATLUANG-01"
# Expected: "test-key-abc123"
```

**ขั้นที่ 2** — เชื่อมต่อพร้อม Basic Auth header:

```bash
# สร้าง base64 ของ "PANDA-THATLUANG-01:test-key-abc123"
echo -n "PANDA-THATLUANG-01:test-key-abc123" | base64
# Output: UEFORA... (ค่า base64 ของคุณ)

# เชื่อมต่อพร้อม Authorization header
wscat -c "ws://localhost:4002/ocpp/PANDA-THATLUANG-01" \
      --subprotocol "ocpp1.6" \
      -H "Authorization: Basic UEFORA..."

# หรือสั้นกว่า — pipe base64 ตรงๆ
wscat -c "ws://localhost:4002/ocpp/PANDA-THATLUANG-01" \
      --subprotocol "ocpp1.6" \
      -H "Authorization: Basic $(echo -n 'PANDA-THATLUANG-01:test-key-abc123' | base64)"
```

#### กรณีที่ Auth จะล้มเหลว

| สาเหตุ | Log ที่เห็น | วิธีแก้ |
|---|---|---|
| ไม่มี Authorization header | `Auth rejected for identity: ...` | เพิ่ม `-H "Authorization: Basic ..."` |
| username ≠ identity ใน URL | `Auth rejected for identity: ...` | username ต้องเท่ากับ `PANDA-THATLUANG-01` |
| API key ผิด | `Auth rejected for identity: ...` | ตรวจ `redis-cli GET "charger:apikey:..."` |
| ไม่มี key ใน Redis | `Auth rejected for identity: ...` | `redis-cli SET "charger:apikey:..." "..."` |
| Rate limit เกิน (5 ครั้งใน 15 นาที) | `Auth rate limit exceeded for IP ...` | `redis-cli DEL "ocpp:auth:fail:127.0.0.1"` |

#### ตรวจสอบสถานะ Rate Limit

```bash
# ดูจำนวนครั้งที่ fail จาก IP นี้
redis-cli GET "ocpp:auth:fail:127.0.0.1"
# ถ้า >= 5 → connection จะถูกปฏิเสธทันที

# ล้าง rate limit counter (เพื่อทดสอบใหม่)
redis-cli DEL "ocpp:auth:fail:127.0.0.1"
```

> **สรุป**: ถ้า `OCPP_AUTH_ENABLED=false` (default สำหรับ local dev) — ไม่ต้องทำอะไรเพิ่ม เชื่อมต่อได้เลย
> ถ้า `true` — ต้อง set Redis key ก่อน แล้วส่ง Basic Auth header ทุกครั้งที่เชื่อมต่อ

---

## 3. Prerequisites

### 2.1 เครื่องมือที่ต้องติดตั้ง

| เครื่องมือ | วัตถุประสงค์ | URL / คำสั่ง |
|---|---|---|
| **Postman** | REST API calls | postman.com |
| **wscat** หรือ **Postman WebSocket** | OCPP WebSocket simulation | `npm install -g wscat` |
| **psql** หรือ DBeaver | SQL verification | ชี้ไปที่ PostgreSQL |
| **Redis CLI** หรือ RedisInsight | ตรวจสอบ Redis state | `redis-cli -u $REDIS_URL` |
| **RabbitMQ Management UI** | ตรวจสอบ queue / message | http://rabbitmq-host:15672 |
| **Docker logs** | ดู service logs | `docker logs -f <container>` |

### 2.2 Service Endpoints

```
Mobile API:        http://localhost:4001/api/mobile/v1
CSMS System Admin: http://localhost:4000/api/admin/v1
Notification API:  http://localhost:4003/api/notification/v1
OCPP WebSocket:    ws://localhost:4002/ocpp/<identity>
VCP Admin API:     http://localhost:9999/execute
```

### 2.3 ข้อมูล Test Data ที่ต้องเตรียม

#### ขั้นตอนที่ 1 — ตรวจสอบ Charger ที่ใช้ทดสอบ

```sql
-- ดูรายการ charger พร้อมสถานะในฐานข้อมูล OCPP
SELECT
    c.id,
    c.ocpp_identity,
    c.status,
    c.last_heartbeat,
    c.model,
    c.firmware_version,
    cn.id AS connector_id_uuid,
    cn.connector_id AS connector_number,
    cn.plug_type,
    cn.status AS connector_status,
    cn.last_meter_value
FROM panda_ev_ocpp.chargers c
LEFT JOIN panda_ev_ocpp.connectors cn ON cn.charger_id = c.id
WHERE c.deleted_at IS NULL
ORDER BY c.ocpp_identity, cn.connector_id;
```

> **บันทึกค่าเหล่านี้** (ใช้ในทุก test case):
> - `OCPP_IDENTITY` = ค่าในคอลัมน์ `ocpp_identity` เช่น `PANDA-THATLUANG-01`
> - `CONNECTOR_ID` = ค่าในคอลัมน์ `connector_id` เช่น `1`
> - `CHARGER_UUID` = ค่าในคอลัมน์ `c.id`

#### ขั้นตอนที่ 2 — ตรวจสอบ Mobile User และ Wallet

```sql
-- ดู user พร้อม wallet balance
SELECT
    u.id AS user_id,
    u.email,
    u.first_name,
    u.last_name,
    u.status,
    w.id AS wallet_id,
    w.balance,
    w.member_id
FROM panda_ev_core.mobile_users u
LEFT JOIN panda_ev_core.wallets w ON w.user_id = u.id
WHERE u.deleted_at IS NULL
  AND u.status = 'ACTIVE'
ORDER BY w.balance DESC
LIMIT 10;
```

> **บันทึกค่าเหล่านี้**:
> - `USER_ID` = UUID ของ user
> - `WALLET_BALANCE_BEFORE` = balance ก่อนทดสอบ (สำหรับ verify หลัง StopTransaction)

#### ขั้นตอนที่ 3 — ตรวจสอบ FCM Token

```sql
-- ดู FCM token ของ user ที่จะทดสอบ
SELECT
    ud.id,
    ud.user_id,
    ud.fcm_token,
    ud.platform,
    ud.app_version,
    ud.last_seen_at
FROM panda_ev_core.user_devices ud
WHERE ud.user_id = '<USER_ID>'
ORDER BY ud.last_seen_at DESC;
```

> หากไม่มี FCM token ให้ insert ค่าทดสอบ:
> ```sql
> INSERT INTO panda_ev_core.user_devices (id, user_id, fcm_token, platform, last_seen_at)
> VALUES (
>     gen_random_uuid(),
>     '<USER_ID>',
>     'test-fcm-token-for-manual-testing-do-not-use-in-prod',
>     'android',
>     NOW()
> );
> ```

#### ขั้นตอนที่ 4 — ตรวจสอบ Pricing Tier

```sql
-- ดู pricing tier ที่เชื่อมกับ station
SELECT
    pt.id AS tier_id,
    pt.name,
    pt.rate_per_kwh,
    pt.plug_type,
    pt.enable_unplug_fee,
    pt.unplug_fee_amount,
    pt.enable_parking_fee,
    pt.parking_fee_per_minute,
    pt.parking_free_minutes,
    sp.station_id,
    sp.priority,
    s.name AS station_name
FROM panda_ev_system.pricing_tiers pt
JOIN panda_ev_system.station_pricing sp ON sp.tier_id = pt.id
JOIN panda_ev_system.stations s ON s.id = sp.station_id
WHERE pt.deleted_at IS NULL
ORDER BY sp.priority DESC;
```

> **บันทึกค่าเหล่านี้**:
> - `RATE_PER_KWH` = ราคาต่อ kWh (เช่น 1000 LAK สำหรับ seed data)
> - `STATION_ID` = UUID ของ station

#### ขั้นตอนที่ 5 — ล้าง Active Session ที่ค้างอยู่ก่อนทดสอบ

```sql
-- ตรวจสอบ active session ที่อาจค้างอยู่
SELECT id, user_id, charger_identity, status, started_at
FROM panda_ev_core.charging_sessions
WHERE status = 'ACTIVE'
  AND charger_identity = '<OCPP_IDENTITY>';

-- ตรวจสอบ active transaction ใน OCPP schema
SELECT id, ocpp_transaction_id, status, charger_id, start_time
FROM panda_ev_ocpp.transactions
WHERE status = 'ACTIVE'
ORDER BY start_time DESC;
```

> หากพบ session ค้างอยู่ ให้ล้าง Redis lock ก่อน:
> ```bash
> redis-cli DEL "charging:charger:<OCPP_IDENTITY>"
> ```

#### ขั้นตอนที่ 6 — เตรียม Postman Headers

สร้าง Postman Environment ด้วยตัวแปรต่อไปนี้:

| Variable | Value |
|---|---|
| `MOBILE_BASE_URL` | `http://localhost:4001/api/mobile/v1` |
| `ADMIN_BASE_URL` | `http://localhost:4000/api/admin/v1` |
| `NOTIF_BASE_URL` | `http://localhost:4003/api/notification/v1` |
| `VCP_URL` | `http://localhost:9999/execute` |
| `ACCESS_TOKEN` | (จะได้หลัง login) |
| `ADMIN_TOKEN` | (จะได้หลัง admin login) |
| `OCPP_IDENTITY` | เช่น `PANDA-THATLUANG-01` |
| `CONNECTOR_ID` | เช่น `1` |
| `USER_ID` | UUID ของ user |
| `SESSION_ID` | (จะได้หลัง start session) |

---

## 3. Test Case 1 — BootNotification

**Objective**: ตรวจสอบว่า OCPP service รู้จัก charger และอัปเดต status ได้ถูกต้อง

### ขั้นตอนที่ 1.1 — เชื่อมต่อ WebSocket

เปิด wscat หรือ Postman WebSocket และเชื่อมต่อไปยัง OCPP endpoint:

```bash
wscat -c "ws://localhost:4002/ocpp/PANDA-THATLUANG-01" \
      --subprotocol "ocpp1.6"
```

> **Expected**: เชื่อมต่อสำเร็จ ไม่มี `401` หรือ `WebSocket closed`

### ขั้นตอนที่ 1.2 — ส่ง BootNotification

หลังเชื่อมต่อแล้ว ส่งข้อความต่อไปนี้ (OCPP Call format: `[2, messageId, action, payload]`):

```json
[2, "boot-test-001", "BootNotification", {
  "chargePointVendor": "SGIC",
  "chargePointModel": "DC-120KW",
  "chargePointSerialNumber": "SGIC-SN-TEST-001",
  "firmwareVersion": "1.0.5",
  "iccid": "",
  "imsi": "",
  "meterType": "AC",
  "meterSerialNumber": "MSN-001"
}]
```

### Expected Response

OCPP service ต้องตอบกลับภายใน **5 วินาที**:

```json
[3, "boot-test-001", {
  "status": "Accepted",
  "currentTime": "2026-03-28T19:00:00.000+07:00",
  "interval": 300
}]
```

> ถ้า `status = "Rejected"` → charger identity ไม่มีในฐานข้อมูล ดู [Troubleshooting 10.1](#101-bootnotification-rejected)

### ขั้นตอนที่ 1.3 — ตรวจสอบ Log (OCPP Service)

```bash
docker logs panda-ev-ocpp --tail=20
```

**Log ที่ต้องพบ**:
```
BootNotification accepted: PANDA-THATLUANG-01 (model=DC-120KW, fw=1.0.5)
```

**Log ที่ต้องไม่พบ**:
```
BootNotification rejected – unknown identity: PANDA-THATLUANG-01
```

### ขั้นตอนที่ 1.4 — ตรวจสอบฐานข้อมูล

```sql
-- สถานะ charger ต้องเปลี่ยนเป็น ONLINE
SELECT
    ocpp_identity,
    status,
    firmware_version,
    last_heartbeat,
    updated_at
FROM panda_ev_ocpp.chargers
WHERE ocpp_identity = 'PANDA-THATLUANG-01';
```

**ผลลัพธ์ที่คาดหวัง**:
- `status` = `BOOTING` หรือ `ONLINE`
- `firmware_version` = `1.0.5`
- `updated_at` = เวลาปัจจุบัน (ภายใน 1 นาที)

```sql
-- ตรวจสอบ OCPP Log บันทึก BootNotification
SELECT
    direction,
    action,
    payload,
    created_at
FROM panda_ev_ocpp.ocpp_logs
WHERE identity = 'PANDA-THATLUANG-01'
  AND action = 'BootNotification'
ORDER BY created_at DESC
LIMIT 5;
```

**ผลลัพธ์ที่คาดหวัง**: มี 2 rows — `INCOMING` (request) และ `OUTGOING` (response)

### ขั้นตอนที่ 1.5 — ส่ง StatusNotification (หลัง Boot)

ส่งทันทีหลัง BootNotification เพื่อแจ้งสถานะ connector:

```json
[2, "status-test-001", "StatusNotification", {
  "connectorId": 0,
  "errorCode": "NoError",
  "status": "Available",
  "timestamp": "2026-03-28T19:00:05.000+07:00"
}]
```

**Log ที่ต้องพบ**:
```
StatusNotification (charger): PANDA-THATLUANG-01 → Available
```

```json
[2, "status-test-002", "StatusNotification", {
  "connectorId": 1,
  "errorCode": "NoError",
  "status": "Available",
  "timestamp": "2026-03-28T19:00:06.000+07:00"
}]
```

**Log ที่ต้องพบ**:
```
StatusNotification (connector): PANDA-THATLUANG-01 connector 1 → Available
```

```sql
-- ยืนยัน connector status อัปเดต
SELECT connector_id, status, updated_at
FROM panda_ev_ocpp.connectors
WHERE charger_id = (
    SELECT id FROM panda_ev_ocpp.chargers
    WHERE ocpp_identity = 'PANDA-THATLUANG-01'
);
```

**ผลลัพธ์ที่คาดหวัง**: `status` = `AVAILABLE`

### ✅ Pass Criteria — Test Case 1

| รายการ | ผ่าน/ไม่ผ่าน |
|---|---|
| WebSocket เชื่อมต่อสำเร็จ | ☐ |
| BootNotification response `status=Accepted` | ☐ |
| Log: "BootNotification accepted: ..." | ☐ |
| DB: `chargers.status` = ONLINE/BOOTING | ☐ |
| DB: `ocpp_logs` มี INCOMING + OUTGOING record | ☐ |
| DB: `connectors.status` = AVAILABLE | ☐ |

---

## 4. Test Case 2 — Authorize

**Objective**: ตรวจสอบว่า OCPP service ตรวจสอบสิทธิ์ idTag ได้ถูกต้อง

### ขั้นตอนที่ 2.1 — Login ผ่าน Mobile API (รับ Access Token)

**Postman Request:**

```
POST {{MOBILE_BASE_URL}}/auth/login
Content-Type: application/json

{
  "email": "test-user@example.com",
  "password": "TestPassword@123"
}
```

**Expected Response** (HTTP 200):
```json
{
  "success": true,
  "statusCode": 200,
  "data": {
    "accessToken": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refreshToken": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...",
    "user": {
      "id": "<USER_ID>",
      "email": "test-user@example.com",
      "firstName": "...",
      "lastName": "..."
    }
  },
  "message": "Login successful"
}
```

> บันทึก `accessToken` ลงใน Postman Environment ตัวแปร `ACCESS_TOKEN`

### ขั้นตอนที่ 2.2 — ส่ง Authorize ผ่าน WebSocket (OCPP)

บนการเชื่อมต่อ WebSocket เดิม ส่ง:

```json
[2, "auth-test-001", "Authorize", {
  "idTag": "MOBILE_APP"
}]
```

**Expected Response**:
```json
[3, "auth-test-001", {
  "idTagInfo": {
    "status": "Accepted"
  }
}]
```

### ขั้นตอนที่ 2.3 — ทดสอบ idTag ที่ไม่ถูกต้อง

```json
[2, "auth-test-002", "Authorize", {
  "idTag": "INVALID-TAG-XYZ"
}]
```

**Expected Response**:
```json
[3, "auth-test-002", {
  "idTagInfo": {
    "status": "Invalid"
  }
}]
```

### ขั้นตอนที่ 2.4 — ตรวจสอบ Log

```bash
docker logs panda-ev-ocpp --tail=10
```

**Log ที่ต้องพบ** (ไม่มี error สำหรับ MOBILE_APP):
```
Authorize: PANDA-THATLUANG-01 idTag=MOBILE_APP → Accepted
```

### ✅ Pass Criteria — Test Case 2

| รายการ | ผ่าน/ไม่ผ่าน |
|---|---|
| Mobile API login สำเร็จ รับ JWT token | ☐ |
| Authorize ด้วย `MOBILE_APP` → `Accepted` | ☐ |
| Authorize ด้วย invalid tag → `Invalid` | ☐ |
| Log: แสดง Authorize result ถูกต้อง | ☐ |

---

## 5. Test Case 3 — Charging Session

**Objective**: ทดสอบ flow หลักทั้งหมด: Mobile API เริ่ม session → OCPP StartTransaction → MeterValues → StopTransaction → Billing คำนวณถูกต้อง

### ขั้นตอนที่ 3.1 — เริ่ม Session ผ่าน Mobile API

**Postman Request:**

```
POST {{MOBILE_BASE_URL}}/charging-sessions/start
Authorization: Bearer {{ACCESS_TOKEN}}
Content-Type: application/json

{
  "identity": "PANDA-THATLUANG-01",
  "connectorId": 1,
  "vehicleId": null
}
```

**Expected Response** (HTTP 201):
```json
{
  "success": true,
  "statusCode": 201,
  "data": {
    "sessionId": "<SESSION_UUID>",
    "status": "ACTIVE",
    "chargerIdentity": "PANDA-THATLUANG-01",
    "connectorId": 1,
    "startedAt": "2026-03-28T19:05:00.000+07:00",
    "pricePerKwh": 1000
  },
  "message": "Charging session started"
}
```

> บันทึก `sessionId` ลงใน Postman Environment ตัวแปร `SESSION_ID`

### ขั้นตอนที่ 3.2 — ตรวจสอบ RabbitMQ (session.start command ส่งแล้ว)

```bash
# ดู queue stats ผ่าน RabbitMQ Management API
curl -u user:password http://localhost:15672/api/queues/%2F/PANDA_EV_CSMS_COMMANDS \
  | jq '{messages, consumers}'
```

**Log ที่ต้องพบ** (Mobile API):
```
[ChargingSession] Publishing session.start → PANDA-THATLUANG-01 connector=1 session=<SESSION_ID>
```

**Log ที่ต้องพบ** (OCPP Service):
```
[OCPP Consumer] Received session.start for PANDA-THATLUANG-01
```

### ขั้นตอนที่ 3.3 — ส่ง StartTransaction (จาก Charger)

> ในสถานการณ์จริง charger จะส่ง StartTransaction ตอบสนองต่อ RemoteStartTransaction จาก OCPP service อัตโนมัติ
> สำหรับ manual test ให้ส่งเองผ่าน WebSocket:

```json
[2, "start-txn-001", "StartTransaction", {
  "connectorId": 1,
  "idTag": "MOBILE_APP",
  "meterStart": 0,
  "timestamp": "2026-03-28T19:05:10.000+07:00"
}]
```

**Expected Response**:
```json
[3, "start-txn-001", {
  "transactionId": 1001,
  "idTagInfo": {
    "status": "Accepted"
  }
}]
```

> บันทึก `transactionId` (= `OCPP_TRANSACTION_ID`) เช่น `1001`

**Log ที่ต้องพบ** (OCPP Service):
```
StartTransaction: PANDA-THATLUANG-01 connector 1, txId=1001
```

**Log ที่ต้องพบ** (Mobile API — หลังรับ event transaction.started):
```
Session <SESSION_ID> linked to OCPP txId 1001, meterStart=0 Wh
```

### ขั้นตอนที่ 3.4 — ตรวจสอบ Database หลัง StartTransaction

```sql
-- ตรวจสอบ Transaction ใน OCPP schema
SELECT
    id,
    ocpp_transaction_id,
    mobile_user_id,
    meter_start,
    start_time,
    status
FROM panda_ev_ocpp.transactions
WHERE ocpp_transaction_id = 1001;
```

**ผลลัพธ์ที่คาดหวัง**:
- `status` = `ACTIVE`
- `meter_start` = `0`
- `mobile_user_id` = `<USER_ID>`

```sql
-- ตรวจสอบ Charging Session ใน Core schema
SELECT
    id,
    ocpp_transaction_id,
    charger_identity,
    status,
    started_at,
    price_per_kwh
FROM panda_ev_core.charging_sessions
WHERE id = '<SESSION_ID>';
```

**ผลลัพธ์ที่คาดหวัง**:
- `status` = `ACTIVE`
- `ocpp_transaction_id` = `1001` (ลิงก์แล้ว)
- `price_per_kwh` = ราคาตาม pricing tier

### ขั้นตอนที่ 3.5 — ตรวจสอบ Redis Session State

```bash
redis-cli GET "charging:session:<SESSION_ID>"
```

**ผลลัพธ์ที่คาดหวัง** (JSON):
```json
{
  "userId": "<USER_ID>",
  "walletId": "<WALLET_ID>",
  "pricePerKwh": 1000,
  "chargerIdentity": "PANDA-THATLUANG-01",
  "connectorId": 1,
  "meterStart": 0,
  "enableParkingFee": false
}
```

```bash
# ตรวจสอบ charger lock (ป้องกัน double-start)
redis-cli GET "charging:charger:PANDA-THATLUANG-01"
# Expected: "<SESSION_ID>"
```

### ขั้นตอนที่ 3.6 — ส่ง MeterValues (ระหว่างชาร์จ)

ส่ง MeterValues 3 ครั้งเพื่อจำลอง meter ที่เพิ่มขึ้น:

**ครั้งที่ 1 (5 นาทีหลัง start):**
```json
[2, "meter-001", "MeterValues", {
  "connectorId": 1,
  "transactionId": 1001,
  "meterValue": [{
    "timestamp": "2026-03-28T19:10:00.000+07:00",
    "sampledValue": [{
      "value": "5000",
      "context": "Sample.Periodic",
      "measurand": "Energy.Active.Import.Register",
      "unit": "Wh"
    }]
  }]
}]
```

**ครั้งที่ 2 (10 นาทีหลัง start):**
```json
[2, "meter-002", "MeterValues", {
  "connectorId": 1,
  "transactionId": 1001,
  "meterValue": [{
    "timestamp": "2026-03-28T19:15:00.000+07:00",
    "sampledValue": [{
      "value": "20000",
      "context": "Sample.Periodic",
      "measurand": "Energy.Active.Import.Register",
      "unit": "Wh"
    }]
  }]
}]
```

**ครั้งที่ 3 (15 นาทีหลัง start — final meter):**
```json
[2, "meter-003", "MeterValues", {
  "connectorId": 1,
  "transactionId": 1001,
  "meterValue": [{
    "timestamp": "2026-03-28T19:20:00.000+07:00",
    "sampledValue": [{
      "value": "45000",
      "context": "Sample.Periodic",
      "measurand": "Energy.Active.Import.Register",
      "unit": "Wh"
    }]
  }]
}]
```

**Expected Response** (ทุกครั้ง):
```json
[3, "meter-001", {}]
```

**ตรวจสอบ Connector Meter Value:**
```sql
SELECT connector_id, last_meter_value, updated_at
FROM panda_ev_ocpp.connectors
WHERE charger_id = (
    SELECT id FROM panda_ev_ocpp.chargers
    WHERE ocpp_identity = 'PANDA-THATLUANG-01'
)
AND connector_id = 1;
```

**ผลลัพธ์ที่คาดหวัง**: `last_meter_value` = `45000` (Wh)

### ขั้นตอนที่ 3.7 — ตรวจสอบ Live Session ผ่าน API

```
GET {{MOBILE_BASE_URL}}/charging-sessions/{{SESSION_ID}}/live
Authorization: Bearer {{ACCESS_TOKEN}}
```

**Expected Response** (HTTP 200):
```json
{
  "success": true,
  "data": {
    "sessionId": "<SESSION_ID>",
    "status": "ACTIVE",
    "chargerIdentity": "PANDA-THATLUANG-01",
    "connectorId": 1,
    "meterStartWh": 0,
    "currentMeterWh": 45000,
    "energyKwh": 45.0,
    "pricePerKwh": 1000,
    "estimatedCost": 45000,
    "chargerOnline": true
  }
}
```

### ขั้นตอนที่ 3.8 — ส่ง StopTransaction

```json
[2, "stop-txn-001", "StopTransaction", {
  "transactionId": 1001,
  "meterStop": 45000,
  "timestamp": "2026-03-28T19:20:00.000+07:00",
  "reason": "Local"
}]
```

**Expected Response**:
```json
[3, "stop-txn-001", {
  "idTagInfo": {
    "status": "Accepted"
  }
}]
```

**Log ที่ต้องพบ** (OCPP Service):
```
StopTransaction: PANDA-THATLUANG-01 txId=1001
```

**Log ที่ต้องพบ** (Mobile API — Billing):
```
[OcppConsumer] transaction.stopped: txId=1001, meterStop=45000, meterStart=0, energy=45.000 kWh
[OcppConsumer] Billing complete: session=<SESSION_ID>, amount=45000 LAK, walletBalance=<NEW_BALANCE>
```

### ขั้นตอนที่ 3.9 — ตรวจสอบ Database หลัง StopTransaction

```sql
-- ตรวจสอบ Transaction status ใน OCPP schema
SELECT
    ocpp_transaction_id,
    meter_start,
    meter_stop,
    stop_reason,
    status,
    start_time,
    stop_time
FROM panda_ev_ocpp.transactions
WHERE ocpp_transaction_id = 1001;
```

**ผลลัพธ์ที่คาดหวัง**:
- `status` = `COMPLETED`
- `meter_stop` = `45000`
- `stop_reason` = `Local`

```sql
-- ตรวจสอบ Charging Session ใน Core schema
SELECT
    id,
    status,
    energy_kwh,
    duration_minutes,
    amount,
    ended_at
FROM panda_ev_core.charging_sessions
WHERE id = '<SESSION_ID>';
```

**ผลลัพธ์ที่คาดหวัง**:
- `status` = `COMPLETED`
- `energy_kwh` = `45.000` (meterStop - meterStart) / 1000
- `amount` = `45000` (energy_kwh × price_per_kwh = 45 × 1000)
- `ended_at` ≠ NULL

```sql
-- ยืนยัน Wallet ถูกหัก
SELECT
    w.balance AS current_balance,
    wt.amount,
    wt.type,
    wt.description,
    wt.created_at
FROM panda_ev_core.wallets w
JOIN panda_ev_core.wallet_transactions wt ON wt.wallet_id = w.id
WHERE w.user_id = '<USER_ID>'
  AND wt.type = 'CHARGE'
ORDER BY wt.created_at DESC
LIMIT 3;
```

**ผลลัพธ์ที่คาดหวัง**:
- `amount` = `45000`
- `current_balance` = `WALLET_BALANCE_BEFORE` - `45000`

```sql
-- ตรวจสอบ idempotency key ถูกลบแล้ว (TTL 60 วินาที)
-- (ตรวจสอบผ่าน Redis CLI แทน)
```

```bash
# Redis: ตรวจสอบ billing idempotency key (ควรหมดอายุแล้วหลัง 60s)
redis-cli EXISTS "billing:done:1001"
# Expected: 0 (หมดอายุแล้ว) หรือ 1 (ยังอยู่ภายใน 60s)

# Redis: charger lock ควรถูกลบแล้ว
redis-cli EXISTS "charging:charger:PANDA-THATLUANG-01"
# Expected: 0
```

### ✅ Pass Criteria — Test Case 3

| รายการ | ผ่าน/ไม่ผ่าน |
|---|---|
| Mobile API `/start` ตอบ 201 พร้อม sessionId | ☐ |
| StartTransaction response `transactionId` > 0 | ☐ |
| DB: `ocpp.transactions.status` = ACTIVE หลัง start | ☐ |
| DB: `core.charging_sessions.ocpp_transaction_id` ลิงก์แล้ว | ☐ |
| Redis: `charging:session:<id>` มีข้อมูล billing config | ☐ |
| Redis: `charging:charger:<identity>` = sessionId (lock active) | ☐ |
| MeterValues response `{}` (ไม่มี error) | ☐ |
| DB: `connectors.last_meter_value` อัปเดตเป็น 45000 | ☐ |
| StopTransaction response `Accepted` | ☐ |
| DB: `ocpp.transactions.status` = COMPLETED | ☐ |
| DB: `charging_sessions.energy_kwh` = 45.000 | ☐ |
| DB: `charging_sessions.amount` = 45000 | ☐ |
| DB: `wallets.balance` ลดลง 45000 LAK | ☐ |
| Redis: charger lock ถูกลบแล้ว | ☐ |

---

## 6. Test Case 4 — Notification Trigger

**Objective**: ตรวจสอบว่า Notification Service ส่ง FCM push notification หลัง session สิ้นสุด และ log ถูกบันทึก

### ขั้นตอนที่ 4.1 — ติดตาม Log ของ Notification Service

เปิด terminal แยกสำหรับติดตาม log:

```bash
docker logs -f panda-ev-notification | grep -E "FCM|sent|failed|dedup|rate|notification"
```

### ขั้นตอนที่ 4.2 — ตรวจสอบ RabbitMQ Queue

หลัง StopTransaction สำเร็จ Mobile API จะ publish ไปยัง `PANDA_EV_NOTIFICATIONS`:

```bash
# ตรวจสอบ message count ใน queue
curl -u user:password http://localhost:15672/api/queues/%2F/PANDA_EV_NOTIFICATIONS \
  | jq '{messages, messages_ready, messages_unacknowledged}'
```

**ผลลัพธ์ที่คาดหวัง**: `messages` > 0 (หรือ 0 หากถูก consume แล้วอย่างรวดเร็ว)

### ขั้นตอนที่ 4.3 — Log ที่ต้องพบในแต่ละขั้นตอน

**Log ที่ต้องพบ** (Notification Service — ตามลำดับ):

```
[NotificationRouter] Received: notification.session for userId=<USER_ID> type=charging_complete
[NotificationProcessor] Dedup check passed: session=<SESSION_ID> type=charging_complete
[NotificationProcessor] Rate limit check passed: userId=<USER_ID>
[FcmService] Sending multicast to 1 tokens
[NotificationProcessor] FCM sent: 1 success, 0 failed
[NotificationProcessor] Log saved: notifId=<NOTIF_UUID>
[AggregationService] onNotificationSent: type=charging_complete channel=FCM
```

**Log ที่ต้องไม่พบ**:
```
[NotificationProcessor] DEDUP: skipping notification  ← dedup ตัดออก (session ซ้ำ)
[NotificationProcessor] RATE LIMIT exceeded           ← rate limit เกิน
[FcmService] Error sending FCM: ...                   ← FCM error
[RabbitMQ] nack message                               ← x-service-token ไม่ผ่าน
```

### ขั้นตอนที่ 4.4 — ตรวจสอบ Database Notification Log

```sql
-- ดู notification log ล่าสุดของ session นี้
SELECT
    nl.id,
    nl.template_id,
    nl.user_id,
    nl.session_id,
    nl.type,
    nl.title,
    nl.body,
    nl.status,
    nl.fcm_message_id,
    nl.error_message,
    nl.retry_count,
    nl.sent_at,
    nl.channel
FROM panda_ev_notifications.notification_logs nl
WHERE nl.session_id = '<SESSION_ID>'
ORDER BY nl.sent_at DESC;
```

**ผลลัพธ์ที่คาดหวัง**:
- `status` = `SENT` หรือ `DELIVERED`
- `fcm_message_id` ≠ NULL (หมายความว่า FCM ตอบรับแล้ว)
- `error_message` = NULL
- `retry_count` = 0

### ขั้นตอนที่ 4.5 — ตรวจสอบ Dedup Guard ใน Redis

```bash
# Dedup key ป้องกันการส่งซ้ำภายใน 24 ชั่วโมง
redis-cli EXISTS "dedup:<SESSION_ID>:charging_complete"
# Expected: 1 (key มีอยู่ → session/type นี้ส่งแล้ว)
```

### ขั้นตอนที่ 4.6 — ทดสอบการส่ง Notification โดยตรง (Manual Trigger)

กรณีต้องการ test notification แยกจาก session flow:

```
POST {{NOTIF_BASE_URL}}/notifications/send
Content-Type: application/json

{
  "userId": "<USER_ID>",
  "fcmTokens": ["test-fcm-token-for-manual-testing-do-not-use-in-prod"],
  "type": "charging_complete",
  "title": "ชาร์จไฟสำเร็จ",
  "body": "รถของคุณชาร์จเสร็จแล้ว กรุณาถอดปลั๊ก",
  "skipDedup": true,
  "skipRateLimit": true,
  "data": {
    "sessionId": "<SESSION_ID>",
    "energyKwh": "45.0",
    "amount": "45000"
  }
}
```

**Expected Response** (HTTP 201):
```json
{
  "success": true,
  "data": {
    "sent": 1,
    "failed": 0,
    "staleTokens": []
  }
}
```

### ✅ Pass Criteria — Test Case 4

| รายการ | ผ่าน/ไม่ผ่าน |
|---|---|
| Log: "Received: notification.session" ปรากฏใน Notification Service | ☐ |
| Log: "Dedup check passed" | ☐ |
| Log: "FCM sent: 1 success, 0 failed" | ☐ |
| DB: `notification_logs.status` = SENT | ☐ |
| DB: `notification_logs.fcm_message_id` ≠ NULL | ☐ |
| Redis: dedup key มีอยู่หลังส่ง | ☐ |
| Manual trigger ผ่าน API → HTTP 201 + `sent=1` | ☐ |

---

## 7. Test Case 5 — Data Sync

**Objective**: ตรวจสอบว่า Admin DB มีข้อมูล charger สอดคล้องกับ OCPP Service และ Redis cache

### ขั้นตอนที่ 5.1 — ตรวจสอบ Charger Status Sync (Admin ↔ OCPP)

```sql
-- เปรียบเทียบสถานะ charger ระหว่าง Admin DB และ OCPP DB
SELECT
    s_c.id AS admin_charger_id,
    s_c.ocpp_identity,
    s_c.status AS admin_status,
    o_c.status AS ocpp_status,
    o_c.last_heartbeat AS ocpp_last_heartbeat,
    s_c.updated_at AS admin_updated_at,
    o_c.updated_at AS ocpp_updated_at
FROM panda_ev_system.chargers s_c
LEFT JOIN panda_ev_ocpp.chargers o_c ON o_c.ocpp_identity = s_c.ocpp_identity
WHERE s_c.deleted_at IS NULL
ORDER BY s_c.ocpp_identity;
```

**ผลลัพธ์ที่คาดหวัง**: `admin_status` สอดคล้องกับ `ocpp_status` (อาจมี delay ไม่เกิน 30 วินาที)

### ขั้นตอนที่ 5.2 — ตรวจสอบ Charger Dashboard ผ่าน Admin API

ก่อนอื่น Login Admin:

```
POST {{ADMIN_BASE_URL}}/auth/login
Content-Type: application/json

{
  "email": "admin@pandaev.com",
  "password": "Admin@123456"
}
```

> บันทึก token ลงใน `ADMIN_TOKEN`

จากนั้นดู dashboard:

```
GET {{ADMIN_BASE_URL}}/chargers/dashboard
Authorization: Bearer {{ADMIN_TOKEN}}
```

**Expected Response** (HTTP 200) — ควรมี charger ของเราพร้อมสถานะ live:
```json
{
  "data": [
    {
      "id": "<CHARGER_UUID>",
      "ocppIdentity": "PANDA-THATLUANG-01",
      "status": "ONLINE",
      "connectors": [
        {
          "connectorId": 1,
          "status": "AVAILABLE",
          "lastMeterValue": 45000
        }
      ],
      "lastHeartbeat": "2026-03-28T19:00:00+07:00"
    }
  ]
}
```

### ขั้นตอนที่ 5.3 — ตรวจสอบ User Sync (Mobile → Admin)

หลังจาก user ลงทะเบียนหรืออัปเดต profile Mobile API จะ publish event ไปยัง `PANDA_EV_USER_EVENTS`:

```sql
-- ตรวจสอบว่า user profile ใน Admin DB ตรงกับ Mobile DB
SELECT
    mu.id AS mobile_user_id,
    mu.email AS mobile_email,
    mu.first_name AS mobile_first_name,
    mu.updated_at AS mobile_updated_at
FROM panda_ev_core.mobile_users mu
WHERE mu.id = '<USER_ID>';
```

```sql
-- Admin DB ควรมี mirror ของ user
-- (ชื่อตาราง: panda_ev_system.mobile_users หรือ mirror table ตามที่ implement)
SELECT *
FROM panda_ev_system.mobile_users
WHERE source_user_id = '<USER_ID>';
```

### ขั้นตอนที่ 5.4 — ทดสอบ Admin → OCPP Charger Sync

ทดสอบโดยอัปเดต charger ผ่าน Admin API แล้วตรวจสอบว่า OCPP DB อัปเดตตาม:

```
PUT {{ADMIN_BASE_URL}}/chargers/<CHARGER_UUID>
Authorization: Bearer {{ADMIN_TOKEN}}
Content-Type: application/json

{
  "sortOrder": 2
}
```

**Log ที่ต้องพบ** (Admin API):
```
[ChargerSync] Publishing charger.updated → PANDA_EV_CHARGER_SYNC
```

**Log ที่ต้องพบ** (OCPP Service):
```
[ChargerSync Consumer] Received charger.updated for PANDA-THATLUANG-01
```

```sql
-- ยืนยันใน OCPP DB
SELECT sort_order, updated_at
FROM panda_ev_ocpp.chargers
WHERE ocpp_identity = 'PANDA-THATLUANG-01';
-- Expected: sort_order = 2
```

### ✅ Pass Criteria — Test Case 5

| รายการ | ผ่าน/ไม่ผ่าน |
|---|---|
| Admin DB charger status ตรงกับ OCPP DB | ☐ |
| Admin Dashboard API แสดง charger status ถูกต้อง | ☐ |
| Admin Dashboard แสดง `lastMeterValue` ถูกต้อง | ☐ |
| Charger update ผ่าน Admin API sync ไปยัง OCPP DB | ☐ |
| User event sync ทำงาน (ถ้า implement แล้ว) | ☐ |

---

## 8. Test Case 6 — Dashboard Analytics

**Objective**: ตรวจสอบว่า `station_daily_stats` และ `notification_daily_stats` อัปเดตถูกต้องหลัง session สิ้นสุด

### ขั้นตอนที่ 6.1 — บันทึกค่า Stats ก่อนทดสอบ (Baseline)

```sql
-- บันทึกค่า before
SELECT
    date,
    station_id,
    sessions_completed,
    total_energy_wh,
    total_revenue,
    overstay_count,
    updated_at
FROM panda_ev_notifications.station_daily_stats
WHERE date = CURRENT_DATE
  AND station_id = '<STATION_ID>';
```

> หากยังไม่มี row สำหรับวันนี้ ค่าเริ่มต้นถือว่าเป็น 0 ทั้งหมด

```sql
-- บันทึกค่า hourly stats ก่อน
SELECT
    DATE_TRUNC('hour', NOW()) AS current_hour,
    station_id,
    sessions_started,
    sessions_completed,
    total_energy_wh,
    total_revenue
FROM panda_ev_notifications.station_hourly_stats
WHERE hour_bucket = DATE_TRUNC('hour', NOW())
  AND station_id = '<STATION_ID>';
```

### ขั้นตอนที่ 6.2 — ตรวจสอบ Stats หลัง StopTransaction

รอ 5–10 วินาที หลัง StopTransaction แล้วรันคำสั่งต่อไปนี้:

```sql
-- ตรวจสอบ Daily Stats
SELECT
    date,
    station_id,
    sessions_completed,
    total_energy_wh,
    total_revenue,
    overstay_count,
    updated_at
FROM panda_ev_notifications.station_daily_stats
WHERE date = CURRENT_DATE
  AND station_id = '<STATION_ID>';
```

**ผลลัพธ์ที่คาดหวัง** (เปรียบเทียบกับ baseline):
- `sessions_completed` เพิ่มขึ้น **+1**
- `total_energy_wh` เพิ่มขึ้น **+45000** Wh
- `total_revenue` เพิ่มขึ้น **+45000** LAK
- `updated_at` = เวลาปัจจุบัน

```sql
-- ตรวจสอบ Hourly Stats
SELECT
    hour_bucket,
    sessions_completed,
    total_energy_wh,
    total_revenue
FROM panda_ev_notifications.station_hourly_stats
WHERE hour_bucket = DATE_TRUNC('hour', NOW())
  AND station_id = '<STATION_ID>';
```

### ขั้นตอนที่ 6.3 — ตรวจสอบ Notification Daily Stats

```sql
SELECT
    date,
    notification_type,
    channel,
    sent_count,
    failed_count,
    suppressed_count,
    updated_at
FROM panda_ev_notifications.notification_daily_stats
WHERE date = CURRENT_DATE
  AND notification_type = 'charging_complete'
ORDER BY sent_count DESC;
```

**ผลลัพธ์ที่คาดหวัง**:
- `sent_count` เพิ่มขึ้น +1
- `channel` = `FCM`
- `failed_count` = 0

### ขั้นตอนที่ 6.4 — ดึง Stats ผ่าน Notification API

```
GET {{NOTIF_BASE_URL}}/notifications/stats/daily?date=2026-03-28
Authorization: Bearer {{ADMIN_TOKEN}}
```

**Expected Response** (HTTP 200):
```json
{
  "data": {
    "date": "2026-03-28",
    "totalSent": 1,
    "totalFailed": 0,
    "totalSuppressed": 0,
    "byType": {
      "charging_complete": { "sent": 1, "failed": 0 }
    }
  }
}
```

```
GET {{NOTIF_BASE_URL}}/notifications/stats/stations?date=2026-03-28
Authorization: Bearer {{ADMIN_TOKEN}}
```

**Expected Response** (HTTP 200) — ควรมีข้อมูลของ station ที่ทดสอบ

### ขั้นตอนที่ 6.5 — ตรวจสอบ Admin WebSocket Dashboard (Real-time)

```bash
# ต้องติดตั้ง wscat
wscat -c "ws://localhost:4003/admin-stats" \
      -H "Authorization: Bearer <ADMIN_TOKEN>"
```

**Event ที่ควรได้รับ** หลัง notification ถูกส่ง:

```json
{
  "event": "notification:sent",
  "data": {
    "type": "charging_complete",
    "userId": "<USER_ID>",
    "sent": 1,
    "failed": 0,
    "timestamp": "2026-03-28T19:20:05+07:00"
  }
}
```

```json
{
  "event": "stats:hourly_updated",
  "data": {
    "stationId": "<STATION_ID>",
    "hourBucket": "2026-03-28T19:00:00+07:00",
    "sessionsCompleted": 1,
    "totalEnergyWh": 45000,
    "totalRevenue": 45000
  }
}
```

### ✅ Pass Criteria — Test Case 6

| รายการ | ผ่าน/ไม่ผ่าน |
|---|---|
| DB: `station_daily_stats.sessions_completed` +1 | ☐ |
| DB: `station_daily_stats.total_energy_wh` +45000 | ☐ |
| DB: `station_daily_stats.total_revenue` +45000 | ☐ |
| DB: `station_hourly_stats` อัปเดตแล้ว | ☐ |
| DB: `notification_daily_stats.sent_count` +1 | ☐ |
| API: `/stats/daily` ตอบ HTTP 200 พร้อมข้อมูลถูกต้อง | ☐ |
| WebSocket: `notification:sent` event รับได้ | ☐ |
| WebSocket: `stats:hourly_updated` event รับได้ | ☐ |

---

## 9. ตาราง Verification Checklist

สรุปผลการทดสอบทั้งหมด ใช้สำหรับ sign-off ก่อน deploy:

| Test Case | รายการ | ผ่าน | ไม่ผ่าน | หมายเหตุ |
|---|---|---|---|---|
| **TC1** | BootNotification → Accepted | ☐ | ☐ | |
| **TC1** | Charger status = ONLINE/BOOTING | ☐ | ☐ | |
| **TC1** | ocpp_logs มีทั้ง INCOMING/OUTGOING | ☐ | ☐ | |
| **TC1** | Connector status = AVAILABLE | ☐ | ☐ | |
| **TC2** | Mobile API login สำเร็จ | ☐ | ☐ | |
| **TC2** | Authorize MOBILE_APP → Accepted | ☐ | ☐ | |
| **TC2** | Authorize invalid → Invalid | ☐ | ☐ | |
| **TC3** | Start session API → 201 + sessionId | ☐ | ☐ | |
| **TC3** | StartTransaction → transactionId > 0 | ☐ | ☐ | |
| **TC3** | Session linked to ocppTransactionId | ☐ | ☐ | |
| **TC3** | Redis billing config มีอยู่ | ☐ | ☐ | |
| **TC3** | MeterValues อัปเดต connector | ☐ | ☐ | |
| **TC3** | StopTransaction → Accepted | ☐ | ☐ | |
| **TC3** | Session status = COMPLETED | ☐ | ☐ | |
| **TC3** | energy_kwh = 45.000 | ☐ | ☐ | |
| **TC3** | amount = 45000 LAK | ☐ | ☐ | |
| **TC3** | Wallet balance ลด 45000 | ☐ | ☐ | |
| **TC4** | Notification Service รับ event | ☐ | ☐ | |
| **TC4** | FCM sent = 1, failed = 0 | ☐ | ☐ | |
| **TC4** | notification_logs.status = SENT | ☐ | ☐ | |
| **TC4** | Dedup key อยู่ใน Redis | ☐ | ☐ | |
| **TC5** | Admin DB status ตรงกับ OCPP DB | ☐ | ☐ | |
| **TC5** | Charger dashboard API ถูกต้อง | ☐ | ☐ | |
| **TC5** | Charger sync Admin → OCPP ทำงาน | ☐ | ☐ | |
| **TC6** | station_daily_stats sessions_completed +1 | ☐ | ☐ | |
| **TC6** | station_daily_stats energy/revenue +45000 | ☐ | ☐ | |
| **TC6** | notification_daily_stats sent_count +1 | ☐ | ☐ | |
| **TC6** | WebSocket dashboard ได้รับ event | ☐ | ☐ | |

**ผู้ทดสอบ**: ___________________ **วันที่**: ___________________ **ผล**: PASS ☐ / FAIL ☐

---

## 10. Troubleshooting

### 10.1 BootNotification Rejected

**อาการ**: Response `"status": "Rejected"`

**สาเหตุและวิธีแก้ไข**:

```bash
# ตรวจสอบว่า identity มีในฐานข้อมูลหรือไม่
docker logs panda-ev-ocpp --tail=5
# Log: "BootNotification rejected – unknown identity: <identity>"
```

```sql
-- ตรวจสอบ charger ใน OCPP DB
SELECT id, ocpp_identity, is_active, deleted_at
FROM panda_ev_ocpp.chargers
WHERE ocpp_identity = 'PANDA-THATLUANG-01';
```

> ถ้าไม่มี row → charger ยังไม่ถูก provision ต้องสร้างผ่าน Admin API ก่อน แล้วรอ `charger.provisioned` event sync ไปยัง OCPP DB

---

### 10.2 WebSocket ถูกตัดทันทีหลังเชื่อมต่อ (401 / 1006)

**อาการ**: `wscat` แสดง `error: Unauthorized` หรือ connection ปิดทันที

**สาเหตุและวิธีแก้ไข**:
```bash
# ตรวจสอบ OCPP_AUTH_ENABLED
docker exec panda-ev-ocpp printenv OCPP_AUTH_ENABLED
# ถ้า true → ต้องใส่ password ใน URL: ws://user:password@localhost:4002/ocpp/<identity>

# ตรวจสอบ subprotocol ว่าส่งถูกต้อง
wscat -c "ws://localhost:4002/ocpp/PANDA-THATLUANG-01" --subprotocol "ocpp1.6"
#                                                        ↑ ต้องมีทุกครั้ง
```

---

### 10.3 StartTransaction transactionId = 0 (Rejected)

**อาการ**: Response `"transactionId": 0, "idTagInfo": {"status": "Rejected"}`

**สาเหตุและวิธีแก้ไข**:
```bash
docker logs panda-ev-ocpp --tail=10
# Log: "StartTransaction ignored – unknown identity: <identity>"
# หรือ: "Connector not found: identity=<identity> connectorId=<id>"
```

```sql
-- ตรวจสอบ connector มีอยู่และ active
SELECT id, connector_id, is_active, deleted_at, status
FROM panda_ev_ocpp.connectors
WHERE charger_id = (
    SELECT id FROM panda_ev_ocpp.chargers
    WHERE ocpp_identity = 'PANDA-THATLUANG-01'
)
AND connector_id = 1;
```

---

### 10.4 Billing ไม่ทำงาน (Wallet ไม่ถูกหัก)

**อาการ**: StopTransaction สำเร็จแต่ `wallet.balance` ไม่เปลี่ยน

**วิธีตรวจสอบ**:
```bash
docker logs panda-ev-mobile --tail=30 | grep -E "billing|wallet|transaction.stopped"
```

**สาเหตุที่พบบ่อย**:

1. **Redis billing config หายไป** — ตรวจสอบ:
   ```bash
   redis-cli EXISTS "charging:session:<SESSION_ID>"
   # ถ้า 0 → config หมดอายุ (TTL 8h) หรือไม่ถูกบันทึกตอน start
   ```

2. **Idempotency key ซ้ำ** — StopTransaction ถูกส่งซ้ำ:
   ```bash
   redis-cli EXISTS "billing:done:<OCPP_TRANSACTION_ID>"
   # ถ้า 1 → billing ถูกประมวลผลไปแล้วครั้งแรก (ปกติ)
   ```

3. **x-service-token ไม่ผ่าน** — OCPP event ถูก nack:
   ```bash
   docker logs panda-ev-mobile --tail=20 | grep -i "nack\|service-token\|invalid"
   ```
   > ถ้าพบ → ตรวจสอบ RS256 key pair ตามรายการใน Production Readiness Checklist

4. **Wallet balance ไม่พอ**:
   ```sql
   SELECT balance FROM panda_ev_core.wallets WHERE user_id = '<USER_ID>';
   -- ถ้า balance < 45000 → session อาจถูก FAILED ไม่ใช่ COMPLETED
   ```

---

### 10.5 Notification ไม่ถูกส่ง

**อาการ**: ไม่มี log ใน Notification Service หรือ `fcm_message_id` เป็น NULL

**วิธีตรวจสอบ**:

```bash
# 1. ตรวจสอบว่า message ถึง queue หรือไม่
curl -u user:password http://localhost:15672/api/queues/%2F/PANDA_EV_NOTIFICATIONS \
  | jq '{messages, consumers}'

# ถ้า consumers=0 → Notification Service ไม่ได้ subscribe

# 2. ตรวจสอบ DLQ ว่ามีข้อความค้างอยู่หรือไม่
curl -u user:password http://localhost:15672/api/queues/%2F/PANDA_EV_NOTIFICATIONS_DLQ \
  | jq '.messages'
# ถ้า > 0 → ดู log error ของ Notification Service

# 3. ตรวจสอบ Firebase credentials
docker logs panda-ev-notification --tail=20 | grep -i "firebase\|FCM\|error"
```

**กรณี Dedup ตัดข้อความออก**:
```bash
redis-cli EXISTS "dedup:<SESSION_ID>:charging_complete"
# ถ้า 1 → ส่งซ้ำภายใน 24h → ปกติ
# ใช้ skipDedup: true ใน manual trigger เพื่อ bypass
```

---

### 10.6 Analytics Stats ไม่อัปเดต

**อาการ**: `station_daily_stats` ไม่เพิ่มขึ้นหลัง session สิ้นสุด

**วิธีตรวจสอบ**:
```bash
docker logs panda-ev-notification --tail=30 | grep -i "aggregation\|stats\|UPSERT"
```

**สาเหตุที่พบบ่อย**:
1. `PANDA_EV_QUEUE` ไม่มี consumer จาก Notification Service
   ```bash
   curl -u user:password http://localhost:15672/api/queues/%2F/PANDA_EV_QUEUE \
     | jq '{consumers}'
   ```
2. `stationId` หรือ `sessionId` ที่ส่งมาใน event เป็น NULL
   ```sql
   SELECT session_id, station_id
   FROM panda_ev_notifications.notification_logs
   WHERE session_id = '<SESSION_ID>';
   ```

---

### 10.7 Health Check ทุก Service

ก่อนเริ่มทดสอบ ตรวจสอบสุขภาพทุก service:

```bash
# OCPP Service
curl http://localhost:4002/health

# Mobile API
curl http://localhost:4001/api/mobile/v1/health

# CSMS System Admin
curl http://localhost:4000/api/admin/v1/health

# Notification Service
curl http://localhost:4003/health
```

**Expected Response** (ทุก service):
```json
{
  "status": "ok",
  "services": {
    "database": "up",
    "redis": "up",
    "rabbitmq": "up"
  }
}
```

> ถ้า `redis: "down"` → service จะ hard-exit ในไม่ช้า ต้องแก้ไขก่อนทดสอบ
> ถ้า `rabbitmq: "down"` → service ยังทำงานได้บางส่วนแต่ event ทั้งหมดจะหายไป

---

### 10.8 ตาราง Error Codes ที่พบบ่อย

| HTTP Status | ข้อความ Error | สาเหตุที่พบบ่อย | วิธีแก้ไข |
|---|---|---|---|
| `401 Unauthorized` | Invalid or expired token | JWT หมดอายุ (default 15 min) | Refresh token หรือ login ใหม่ |
| `403 Forbidden` | Insufficient permissions | Admin token ไม่มี permission ที่ต้องการ | ตรวจสอบ role ของ user ใน DB |
| `404 Not Found` | Session not found | sessionId ผิดหรือ soft-deleted | ตรวจสอบด้วย SQL |
| `409 Conflict` | Charger already in session | Redis lock `charging:charger:<identity>` ยังอยู่ | `redis-cli DEL "charging:charger:<identity>"` |
| `422 Unprocessable` | Insufficient wallet balance | balance ต่ำกว่า MIN_CHARGING_BALANCE | เติม wallet ก่อน |
| `500 Internal Error` | Database connection error | Prisma ไม่สามารถเชื่อมต่อ DB | ตรวจสอบ DATABASE_URL และ container |
| `503 Service Unavailable` | RabbitMQ not connected | RabbitMQ soft-fail ยังไม่ reconnect | รอ 30s หรือ restart service |

---

## 11. Safety Notes

> ⚠️ **อ่านก่อนเริ่มทดสอบทุกครั้ง**

### 11.1 การทดสอบบน Production Database

- **ห้าม** รัน Test Case ที่มี `StopTransaction` บน session ของ user จริงโดยไม่ได้รับอนุญาต เพราะจะตัดเงินจาก wallet จริง
- ก่อนทดสอบทุกครั้ง ให้ **ตรวจสอบ `WALLET_BALANCE_BEFORE`** และ **บันทึกไว้** เพื่อ rollback ได้หากเกิดข้อผิดพลาด
- ใช้ user account ที่สร้างขึ้นเพื่อการทดสอบโดยเฉพาะ (**อย่าใช้ account ของ user จริง**)

### 11.2 การจัดการ FCM Token

- FCM token ที่ใช้ทดสอบควรเป็น token จาก **dev device** ที่ควบคุมได้ ไม่ใช่ device ของ user จริง
- **อย่าใส่ FCM token ปลอม** ลงใน production database ถาวร ให้ลบออกหลังทดสอบ:
  ```sql
  DELETE FROM panda_ev_core.user_devices
  WHERE fcm_token = 'test-fcm-token-for-manual-testing-do-not-use-in-prod';
  ```

### 11.3 การใช้ Staging Environment

- **แนะนำอย่างยิ่ง** ให้ทดสอบบน staging environment ก่อนเสมอ
- หากจำเป็นต้องทดสอบบน production ให้ทดสอบในช่วง **traffic ต่ำ** (เช่น 02:00–05:00 น. ตามเวลาเวียงจันทน์ UTC+7)
- เตรียม **rollback plan** ไว้ก่อน: ทราบขั้นตอนการคืน balance ด้วยตนเองหาก billing ผิดพลาด

### 11.4 ข้อควรระวังเรื่อง Charger จริง

- อย่า simulate `StopTransaction` สำหรับ **charger ที่มี user จริงกำลังชาร์จอยู่** เพราะจะตัดการชาร์จและคิดเงิน
- ก่อนทดสอบ OCPP บน charger จริง ให้ **ประสานงานกับทีม Ops** และยืนยันว่า charger ว่างอยู่
- ใช้ `ocpp-virtual-charge-point` (VCP Simulator) แทน charger จริงทุกครั้งที่ทำได้:
  ```bash
  cd ocpp-virtual-charge-point
  CP_ID=PANDA-TEST-VIRTUAL WS_URL=ws://localhost:4002 npm start index_16.ts
  ```

### 11.5 การจัดการ Redis State หลังทดสอบ

หลังทดสอบเสร็จ ให้ล้าง Redis keys ที่เกี่ยวข้อง:

```bash
# ล้าง keys ทดสอบ (ระวัง อย่ารัน FLUSHALL บน production!)
redis-cli DEL "charging:session:<SESSION_ID>"
redis-cli DEL "charging:charger:<OCPP_IDENTITY>"
redis-cli DEL "dedup:<SESSION_ID>:charging_complete"
redis-cli DEL "billing:done:<OCPP_TRANSACTION_ID>"
```

### 11.6 Log Retention

- Log จาก Docker containers อาจถูกหมุน (rotate) หากเต็ม ให้ save log ที่สำคัญออกมาก่อน:
  ```bash
  docker logs panda-ev-notification > /tmp/notification-test-$(date +%Y%m%d).log
  docker logs panda-ev-ocpp > /tmp/ocpp-test-$(date +%Y%m%d).log
  ```

---

*จัดทำโดย: Panda EV QA Team | อ้างอิงจาก: OCPP 1.6J Specification, Service Architecture v2026-03-28*
