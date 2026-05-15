# ການກວດສອບ Log ຂອງ OCPP Service — ບັນຫາ Timezone ຂອງເຄື່ອງສາກ

**ວັນທີກວດສອບ:** 2026-05-06  
**ເຄື່ອງທີ່ກ່ຽວຂ້ອງ:** PANDA-DONGNASOK-01, PANDA-DONGNASOK-02  
**Service:** panda-ocpp-api (namespace: panda-ev-prod)

---

## ສະຫຼຸບບັນຫາ

ພົບ **2 ບັນຫາ** ຈາກການກວດສອບ log ຂອງ OCPP service ທີ່ເຊື່ອມຕໍ່ກັບເຄື່ອງສາກຈິງ (physical charger).

---

## ບັນຫາທີ 1 — Timezone ຂອງເຄື່ອງສາກຜິດ (ຕ່າງກັນ 8 ຊົ່ວໂມງ)

### ສາເຫດ

ເຄື່ອງສາກ (Steve-SGC, firmware V3.2) ສົ່ງ timestamp ໂດຍໃຊ້ **ເວລາ local ຂອງໂຕເອງ** ແຕ່ tag ວ່າ `Z` (UTC) ເຊິ່ງຜິດ. ເຄື່ອງຖືກຕັ້ງ timezone ເປັນ **UTC+8 (ເວລາຈີນ)** ແທນທີ່ຈະເປັນ **UTC+7 (ເວລາລາວ/ໄທ)**.

### ຫຼັກຖານຈາກ Log

```
# Server (OCPP pod) ສົ່ງໄປຫາເຄື່ອງ:
[OUT] PANDA-DONGNASOK-02 ← CALLRESULT {
  "currentTime": "2026-05-06T16:10:32.782+07:00"   ← ຖືກຕ້ອງ (UTC+7 ລາວ)
}

# ເຄື່ອງສາກສົ່ງກັບມາ:
[IN]  PANDA-DONGNASOK-02 → StatusNotification {
  "timestamp": "2026-05-06T17:17:19.000Z"           ← ຜິດ (ນຳ UTC+8 ມາ tag Z)
}
```

### ການວິເຄາະ

| ແຫຼ່ງຂໍ້ມູນ | ຄ່າ | UTC ຕົວຈິງ |
|---|---|---|
| Log prefix ຂອງ pod | `9:17:19 AM` | 09:17 UTC ✓ |
| `currentTime` ໃນ `[OUT]` (ຂອງ server) | `16:10:32+07:00` | 09:10 UTC ✓ |
| `timestamp` ໃນ `[IN]` (ຂອງເຄື່ອງສາກ) | `17:17:19.000Z` | 17:17 UTC ✗ (ຕ່າງ 8 ຊົ່ວໂມງ) |

### ໝາຍເຫດສຳຄັນ

- **Timestamp ທີ່ຢູ່ໃນ `[OUT]`** = ສ້າງໂດຍ OCPP service ຂອງພວກເຮົາ (`nowBangkokIso()`) → **ຖືກຕ້ອງ**
- **Timestamp ທີ່ຢູ່ໃນ `[IN]`** = ສ້າງໂດຍ **ເຄື່ອງສາກ** → **ຜິດ**
- OCPP service ຂອງພວກເຮົາສົ່ງ `currentTime` ທີ່ຖືກຕ້ອງໃນ BootNotification response ແລ້ວ ແຕ່ firmware ຂອງເຄື່ອງ **ບໍ່ sync ໂມງຕາມ** ຄ່າທີ່ server ສົ່ງໃຫ້

### ວິທີແກ້ໄຂ

**ຕ້ອງແກ້ທີ່ເຄື່ອງສາກ** (ບໍ່ແມ່ນ server):

```bash
# SSH ເຂົ້າເຄື່ອງ ຫຼື ໃຊ້ admin interface ຂອງ Steve-SGC:
timedatectl set-timezone Asia/Vientiane
# ຫຼື
timedatectl set-timezone Asia/Bangkok

# ຈາກນັ້ນ reboot ເຄື່ອງ
```

ຖ້າ SSH ບໍ່ໄດ້ → ຕິດຕໍ່ **Steve-SGC support** ໃຫ້ປ່ຽນ timezone ໃຫ້ເປັນ `UTC+7 (Asia/Vientiane)`.

---

## ບັນຫາທີ 2 — PANDA-DONGNASOK-02 ຕັດການເຊື່ອມຕໍ່ທຸກໆ ~30 ວິນາທີ

### ສາເຫດ

ເຄື່ອງ DONGNASOK-02 connect → BootNotification → StatusNotification → disconnect ຊໍ້າໆ ທຸກ 30 ວິນາທີ ບໍ່ຢຸດ.

### ຫຼັກຖານຈາກ Log

```
9:10:32 → Connected + BootNotification
9:11:03 → Connected + BootNotification   (31 ວິ)
9:11:33 → Connected + BootNotification   (30 ວິ)
9:12:51 → Connected + BootNotification   (78 ວິ)
9:13:21 → Connected + BootNotification   (30 ວິ)
...ຊໍ້າໆ ຕໍ່ເນື່ອງ
```

### ໝາຍເຫດ

- **DONGNASOK-01** ເຊື່ອມຕໍ່ໄດ້ປົກກະຕິ → ບັນຫານີ້ **ສະເພາະ DONGNASOK-02**
- OCPP service ຂອງພວກເຮົາ **ບໍ່ໄດ້ reject** ການເຊື່ອມຕໍ່ — ຮັບ BootNotification ຜ່ານທຸກຄັ້ງ
- ສາເຫດນ່າຈະເປັນ: firmware crash loop (watchdog), ສັນຍານ WiFi/LTE ອ່ອນ, ຫຼື hardware fault

### ວິທີກວດສອບ

1. ກວດ **ສັນຍານ network** ທີ່ສະຖານທີ່ຕິດຕັ້ງ DONGNASOK-02
2. ກວດ **ໜ້າຈໍ/ຕູ້ຄວບຄຸມ** ຂອງເຄື່ອງ — ເບິ່ງ error code ທີ່ສະແດງ
3. ສົ່ງ log pattern ນີ້ໃຫ້ **Steve-SGC support** — ດູຄ້າຍ firmware watchdog restart

---

## ສະຫຼຸບການແກ້ໄຂ

| ບັນຫາ | ທີ່ຕ້ອງແກ້ | ວິທີ |
|---|---|---|
| Timezone ຜິດ 8 ຊົ່ວໂມງ | ເຄື່ອງສາກ (ທັງ 01 ແລະ 02) | ຕັ້ງ `Asia/Vientiane` ທາງ admin/SSH |
| DONGNASOK-02 ຕັດທຸກ 30 ວິ | Hardware/Network ທີ່ site | ກວດ network + ຕິດຕໍ່ Steve-SGC |

**OCPP service ຂອງພວກເຮົາບໍ່ຈຳເປັນຕ້ອງແກ້ໄຂ** — server ສົ່ງ `currentTime` ຖືກຕ້ອງຢູ່ແລ້ວ.
