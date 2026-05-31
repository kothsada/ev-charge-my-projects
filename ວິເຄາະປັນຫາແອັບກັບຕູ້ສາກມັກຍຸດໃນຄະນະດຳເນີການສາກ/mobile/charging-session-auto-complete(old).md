# Auto-Navigate to Billing/Summary Page (Without User Pressing Stop)

เอกสารนี้อธิบายว่า App บังคับพา user ไปหน้า Billing/Summary ได้อย่างไร **โดยที่ user ไม่ได้กดปุ่ม Stop เอง**

---

## Metadata

| | |
|---|---|
| **Branch** | `develop` |
| **Commit** | `ae7021b21847fb86eca2ba722ad4675b480fc0ca` |
| **Commit Message** | `chore: bump version to 1.1.1+35` |
| **Commit Date** | 2026-05-15 |
| **App Version** | `1.1.1+35` |

---

## 2 กลไกหลัก

---

### กลไกที่ 1 — SSE `ended: true` (Primary Path)

**ไฟล์:** `lib/features/status/presentation/cubit/status_cubit.dart`

Backend ต้อง push event นี้ผ่าน SSE stream เมื่อ session จบ (ไม่ว่าจะเกิดจากอะไรก็ตาม เช่น แบตเต็ม, balance หมด, charger ตัดการเชื่อมต่อ):

```
GET /api/mobile/v1/charging-sessions/{id}/stream
```

**รูปแบบ SSE payload ที่ backend ต้องส่ง:**
```
data: {"data": {"ended": true, "status": "COMPLETED"}}\n\n
```

**โค้ดที่รับ event และ navigate:**

```dart
// status_cubit.dart — _handleSseEvent()

if (event.ended) {
  _log.d('[STATUS][SSE] Session ended — status=${event.status}');
  _sseSubscription?.cancel();
  _sseSubscription = null;
  _cancelStoppingWatchdog();
  await _fetchAndEmitCompleted();   // ← ดึง billing receipt แล้วไปหน้า summary
  return;
}
```

---

### กลไกที่ 2 — Heartbeat 3 ครั้งติดกัน (Safety Net)

**ไฟล์:** `lib/features/status/presentation/cubit/status_cubit.dart`

ถ้า backend ส่ง heartbeat ติดกัน **3 ครั้ง** โดยไม่มี meter data → app ถือว่า session จบแล้ว → ไปหน้า billing เอง (พร้อม `isDataUncertain: true` เพื่อแสดง warning ว่าข้อมูลอาจไม่สมบูรณ์)

```dart
// status_cubit.dart — _handleSseEvent()

static const _maxConsecutiveHeartbeats = 3;

if (event.heartbeat) {
  if (_isChargerInGracePeriod) return; // suppress ระหว่าง grace period

  _consecutiveHeartbeats++;
  if (_consecutiveHeartbeats >= _maxConsecutiveHeartbeats) {
    // 3 heartbeats ติดกัน → ถือว่า session จบ
    _sseSubscription?.cancel();
    _sseSubscription = null;
    _consecutiveHeartbeats = 0;
    await _fetchAndEmitCompleted(isDataUncertain: true);
  }
  return;
}

// meter data มาแล้ว → reset counter
_consecutiveHeartbeats = 0;
```

> **หมายเหตุ:** ถ้า `_isChargerInGracePeriod == true` (ได้รับ FCM `charger_offline`) heartbeat counter จะถูก suspend ไว้ก่อน — app จะรอให้ backend ส่ง `ended: true` เอง ไม่นับ heartbeat

---

## Flow หลังจาก Trigger ทั้ง 2 → `_fetchAndEmitCompleted()`

```dart
// status_cubit.dart — _fetchAndEmitCompleted()

Future<void> _fetchAndEmitCompleted({bool isDataUncertain = false}) async {
  final sessionId = _activeSessionId;

  // 1. ดึง profile ตรวจว่าต้องแสดง name prompt หรือไม่
  final profileResult = await _getProfile(const NoParams());
  final showNamePrompt = profileResult.fold((_) => false, (p) => p.firstName.isEmpty);

  // 2. ดึง billing receipt (retry สูงสุด 3 ครั้ง × 2s)
  BillingReceiptModel? receipt;
  for (var attempt = 1; attempt <= 3; attempt++) {
    if (attempt > 1) await Future<void>.delayed(const Duration(seconds: 2));

    final result = await _getBillingReceipt(sessionId);
    result.fold(
      (failure) => null,
      (data) => receipt = data,
    );
    if (receipt != null) break;
  }

  // 3. emit state → UI navigate
  if (receipt != null) {
    emit(StatusState.sessionCompleted(receipt: receipt!, showNamePrompt: showNamePrompt, isDataUncertain: false));
  } else {
    // billing ยังไม่พร้อม → ใช้ข้อมูลล่าสุดที่มี
    final partial = BillingReceiptModel(
      sessionId: sessionId,
      stationName: _stationName,
      energyKwh: _lastEnergyKwh,
      billing: BillingModel(total: _lastEstimatedCost.toInt()),
    );
    emit(StatusState.sessionCompleted(receipt: partial, showNamePrompt: showNamePrompt, isDataUncertain: true));
  }
}
```

**Billing receipt endpoint ที่ App เรียก:**
```
GET /api/mobile/v1/charging-sessions/{id}/billing-receipt
```

> Backend ต้องพร้อม return ข้อมูลนี้ภายใน ~6 วินาที (3 retry × 2s) หลัง session จบ

---

## UI Navigate (status_screen.dart)

```dart
// status_screen.dart — BlocConsumer listener

BlocConsumer<StatusCubit, StatusState>(
  listenWhen: (_, curr) => curr is StatusSessionCompleted,
  listener: (context, state) {
    if (state is StatusSessionCompleted) {
      context.router.push(ChargingCompleteRoute(
        receipt: state.receipt,
        showNamePrompt: state.showNamePrompt,
        isDataUncertain: state.isDataUncertain,
      )).then((_) {
        if (context.mounted) context.read<StatusCubit>().resetToIdle();
      });
    }
  },
)
```

เมื่อ state กลายเป็น `StatusSessionCompleted` → push route ไปหน้า `ChargingCompleteRoute` ทันที

---

## สรุป — สิ่งที่ Backend ต้องทำ

| สิ่งที่ต้องทำ | รายละเอียด |
|---|---|
| **ส่ง `ended: true` ผ่าน SSE** | ทำเมื่อ session ไม่ active อีกต่อไป (COMPLETED / FAILED / หมด balance) |
| **ไม่ส่ง heartbeat ติดกัน 3 ครั้ง** ถ้า session ยังอยู่ | ถ้าส่ง → app จะ navigate ไปหน้า billing โดย `isDataUncertain: true` |
| **เตรียม billing-receipt ให้พร้อมภายใน ~6s หลัง session จบ** | App retry 3 ครั้ง × 2s — ถ้าไม่พร้อม → แสดง partial data แทน |

---

## SSE Event Model (ฝั่ง App)

```dart
// sse_event_model.dart

class SseEventModel {
  final String  sessionId;
  final bool    heartbeat;       // true = keep-alive ping เท่านั้น
  final bool    ended;           // true = session จบแล้ว → navigate to billing
  final String  status;          // COMPLETED / FAILED / ...
  final double  energyKwh;
  final double  estimatedCost;
  final double  powerW;
  final double  socPercent;
  final bool    balanceWarning;  // แจ้งเตือน balance ใกล้หมด (ไม่ใช่ ended)
}
```

**SSE payload wrapper ที่ backend ต้องใช้:**
```json
{
  "data": {
    "sessionId": "abc123",
    "ended": true,
    "status": "COMPLETED",
    "energyKwh": 12.5,
    "estimatedCost": 50000
  }
}
```
