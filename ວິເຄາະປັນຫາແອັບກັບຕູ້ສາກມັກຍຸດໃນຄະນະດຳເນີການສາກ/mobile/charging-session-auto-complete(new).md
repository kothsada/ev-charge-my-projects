# Branch: features/handle-state-in-ui-live-charging

เอกสารนี้อธิบายว่า branch นี้เปลี่ยนแปลงอะไรบ้าง และ app handle การชาร์จ live state อย่างไรใน branch นี้

---

## Metadata

| | |
|---|---|
| **Branch** | `features/handle-state-in-ui-live-charging` |
| **Latest Commit** | `9b39457` — `fix: show billing after force kill and when billing API is slow` |
| **App Version** | `1.1.6+36` |
| **Based On** | `develop` @ `ae7021b` (`chore: bump version to 1.1.1+35`) |

---

## สรุปสิ่งที่เพิ่มใน Branch นี้

Branch นี้แก้ปัญหา 3 เรื่องหลัก:

1. **Charger Offline Grace Period** — app รู้ว่า charger offline และไม่นับ heartbeat ระหว่างรอ
2. **Force-Kill Recovery** — app ถูกปิดระหว่างชาร์จ เปิดใหม่แล้วยังเห็นหน้า billing
3. **Billing Fallback ที่ดีขึ้น** — ถ้าดึง billing receipt ไม่ได้ แสดง partial data แทนกลับไป idle

---

## การเปลี่ยนแปลงหลัก

---

### 1. Charger Offline Grace Period (ใหม่ทั้งหมด)

**ไฟล์ที่เปลี่ยน:**
- `lib/features/status/presentation/cubit/status_cubit.dart`
- `lib/features/status/presentation/status_state.dart`
- `lib/features/status/presentation/status_screen.dart`
- `lib/features/charging_session/data/model/fcm_charger_event_model.dart` *(ไฟล์ใหม่)*

#### ปัญหาเดิม
เมื่อ charger offline ระหว่างชาร์จ → backend หยุดส่ง meter data → ส่งแต่ heartbeat → app นับ heartbeat 3 ครั้ง → **navigate ไปหน้า billing ก่อนเวลา** ทั้งที่ charger อาจ reconnect ได้ภายใน 3 นาที

#### วิธีแก้
Backend ส่ง FCM notification `charger_offline` มาที่ app → app set flag `_isChargerInGracePeriod = true` → **suspend heartbeat counter** ไว้ก่อน → รอให้ backend ส่ง `ended: true` เมื่อ grace period จบจริงๆ

**FCM Model ใหม่:**
```dart
// lib/features/charging_session/data/model/fcm_charger_event_model.dart

class FcmChargerEventModel {
  final String type;       // 'charger_offline'
  final String sessionId;
  final String connectorId;
}
```

**FCM payload ที่ backend ต้องส่ง:**
```json
{
  "type": "charger_offline",
  "sessionId": "abc123",
  "connectorId": "1"
}
```

**StatusCubit รับ FCM:**
```dart
// status_cubit.dart — _handleFcmMessage() / _onChargerOffline()

void _onChargerOffline(String sessionId) {
  _isChargerInGracePeriod = true;
  _consecutiveHeartbeats = 0;         // reset counter
  emit(curr.copyWith(isChargerOfflineGrace: true, isReconnecting: false));
}
```

**Heartbeat counter ถูก suspend:**
```dart
// status_cubit.dart — _handleSseEvent()

if (event.heartbeat) {
  if (_isChargerInGracePeriod) {
    return; // ← ไม่นับ heartbeat ระหว่าง grace period
  }
  _consecutiveHeartbeats++;
  ...
}
```

**Grace period ถูกยกเลิกเมื่อ meter data กลับมา:**
```dart
if (_isChargerInGracePeriod && !event.ended && !event.balanceWarning) {
  _isChargerInGracePeriod = false;
  emit(curr.copyWith(isChargerOfflineGrace: false));
}
```

**State ใหม่:**
```dart
// status_state.dart — StatusCharging

@Default(false) bool isChargerOfflineGrace,  // ← field ใหม่
```

**UI Banner ใหม่ (`_ChargerOfflineGraceBanner`):**
```dart
// status_screen.dart

if (isChargerOfflineGrace)
  _ChargerOfflineGraceBanner(onRetry: () => context.read<StatusCubit>().manualRefresh()),
```
แสดง banner สีเหลืองพร้อม spinner และปุ่ม Retry ระหว่างรอ charger reconnect

---

### 2. Restore Grace Period หลัง App Restart

**ไฟล์:** `lib/features/status/presentation/cubit/status_cubit.dart`

#### ปัญหาเดิม
ถ้า app ถูก force-kill ระหว่าง charger offline grace period → `_isChargerInGracePeriod` reset เป็น `false` → เปิด app ใหม่ → heartbeat 3 ครั้ง → navigate billing โดยไม่รอ

#### วิธีแก้
เพิ่ม `_connectSseWithLiveCheck()` — ก่อน connect SSE จะเรียก `GET /live` ก่อน 1 ครั้ง เพื่อตรวจ `chargerOnline` field:

```dart
// status_cubit.dart — _connectSseWithLiveCheck()

final live = await _getLiveSession(sessionId);

if (live != null && !live.chargerOnline) {
  // charger ยังออฟไลน์อยู่ → restore grace period
  _isChargerInGracePeriod = true;
  _consecutiveHeartbeats = 0;
  emit(StatusState.charging(..., isChargerOfflineGrace: true));
} else if (live != null) {
  _emitChargingFromLive(live); // charger online → แสดงข้อมูลปกติ
}

_connectSse(sessionId); // ต่อ SSE หลังตรวจเสร็จ
```

---

### 3. Force-Kill Recovery — แสดง Billing หลัง App Reopen

**ไฟล์:** `lib/features/status/presentation/cubit/status_cubit.dart`

#### ปัญหาเดิม
ถ้า app ถูก force-kill ระหว่างชาร์จ แล้ว session จบในระหว่างที่ app ปิดอยู่ → เปิด app ใหม่ → `loadSessions()` ไม่เจอ session ACTIVE → emit `idle` → **user ไม่เห็นหน้า billing เลย**

#### วิธีแก้
เพิ่ม `_checkAndEmitRecentCompleted()` — เมื่อไม่เจอ session ACTIVE จะไปดู session COMPLETED ล่าสุด:

```dart
// status_cubit.dart — _checkAndEmitRecentCompleted()

static const _recentSessionThresholdMinutes = 30;

// 1. ดึง session COMPLETED ล่าสุด
final result = await _getSessions(page: 1, limit: 1, status: 'COMPLETED');

// 2. ตรวจว่าจบภายใน 30 นาทีที่ผ่านมาหรือไม่
final minutesSinceEnd = DateTime.now().difference(endedAt).inMinutes;
if (minutesSinceEnd > _recentSessionThresholdMinutes) {
  emit(const StatusState.idle()); // เก่าเกินไป → idle
  return;
}

// 3. session จบภายใน 30 นาที → ดึง billing แสดง
await _fetchAndEmitCompleted();
```

---

### 4. Billing Fallback ที่ดีขึ้น

**ไฟล์:** `lib/features/status/presentation/cubit/status_cubit.dart`

#### เปลี่ยนอะไร

**เดิม:**
```dart
// ถ้า billing receipt ไม่ได้และ isDataUncertain == false → กลับไป idle (user ไม่เห็นอะไร)
if (isDataUncertain) {
  emit(StatusState.sessionCompleted(receipt: partial, ...));
} else {
  emit(const StatusState.idle()); // ← ทิ้ง user ไว้
}
```

**ใหม่:**
```dart
// ทุกกรณี — ถ้า billing ไม่ได้ → แสดง partial data เสมอ
_log.w('[STATUS] Billing receipt unavailable after retries — emitting partial receipt');
emit(StatusState.sessionCompleted(receipt: partial, showNamePrompt: showNamePrompt, isDataUncertain: true));
```

ผลคือ user จะเห็นหน้า billing เสมอ แม้ข้อมูลจะไม่ครบ

---

### 5. Charging History Card — UI Redesign

**ไฟล์:**
- `lib/features/charging_session/presentation/widget/charging_session_card.dart`
- `lib/features/charging_session/presentation/state/charging_session_display_item.dart`
- `lib/features/charging_session/presentation/cubit/charging_history_cubit.dart`

**เปลี่ยนอะไร:**

| ก่อน | หลัง |
|---|---|
| แสดง progress bar + % | ลบออก ใช้ stats row แทน |
| icon สีตาม status | icon สีเทาเสมอ |
| vehicle row แยก | รวมใน header |
| `displayAmount` แสดงตัวเลขปกติ | เพิ่ม `-` นำหน้า (เช่น `-50,000 ₭`) |

```dart
// charging_history_cubit.dart
displayAmount: '-${CurrencyUtil.formatKip(s.amount.toDouble())}',
```

```dart
// charging_session_display_item.dart — ลบ fields ออก
// ลบ: progressValue, progressPct
```

Stats row ใหม่ใน card แสดง 3 ค่า:
- ⚡ Energy (kWh)
- ⏱ Duration
- 💳 Cost

---

## Flow ภาพรวมของ Branch นี้

```
App เปิด
  └─→ loadSessions()
        ├─→ มี ACTIVE session
        │     └─→ _connectSseWithLiveCheck()
        │           ├─→ GET /live → chargerOnline == false
        │           │     └─→ restore grace period → connect SSE
        │           └─→ GET /live → chargerOnline == true
        │                 └─→ emit meter data → connect SSE
        │
        └─→ ไม่มี ACTIVE session (app ถูกปิดระหว่างชาร์จ)
              └─→ _checkAndEmitRecentCompleted()
                    ├─→ COMPLETED session จบ < 30 นาที → billing
                    └─→ ไม่มี หรือ > 30 นาที → idle

ระหว่างชาร์จ
  └─→ FCM charger_offline มา
        └─→ _isChargerInGracePeriod = true
              ├─→ Heartbeat → ไม่นับ (suppress)
              ├─→ Meter data กลับมา → clear grace period
              └─→ SSE ended:true → ไปหน้า billing
```

---

## ไฟล์ที่เปลี่ยนในฝั่ง Status Feature

| ไฟล์ | เปลี่ยนอะไร |
|---|---|
| `status_cubit.dart` | เพิ่ม FCM listener, grace period logic, force-kill recovery, billing fallback |
| `status_state.dart` | เพิ่ม `isChargerOfflineGrace` field ใน `StatusCharging` |
| `status_screen.dart` | เพิ่ม `_ChargerOfflineGraceBanner`, `_WaitingForDataBanner` widget |
| `fcm_charger_event_model.dart` | ไฟล์ใหม่ — model รับ FCM event จาก backend |
