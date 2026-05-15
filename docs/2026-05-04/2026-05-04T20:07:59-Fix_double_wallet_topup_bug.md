# ແກ້ໄຂບັນຫາເງິນໂດນເຕີມ 2 ຄັ້ງໃນການຈ່າຍຄັ້ງດຽວ (Double Wallet Top-up)

**ວັນທີ:** 2026-05-04  
**ໂຄງການ:** panda-ev-client-mobile  
**ໄຟລ໌ທີ່ແກ້ໄຂ:** `src/modules/payment/payment-event.consumer.ts`

---

## ອາການຂອງບັນຫາ

ເມື່ອຜູ້ໃຊ້ຈ່າຍເງິນເພື່ອເຕີມ Wallet ຄັ້ງດຽວ ແຕ່ບາງເທື່ອເງິນຖືກໂອນໃສ່ Wallet 2 ຄັ້ງ ທຳໃຫ້ຍອດເງິນຜິດພາດ.

---

## ສາເຫດຂອງບັນຫາ (Root Cause)

ບັນຫານີ້ເກີດຈາກ **TOCTOU Race Condition** (Time-Of-Check-Time-Of-Use) ໃນ `onCompleted()` ຂອງ `PaymentEventConsumer`.

### ລຳດັບຂັ້ນຕອນທີ່ມີບັນຫາ (ກ່ອນແກ້ໄຂ)

```
1. ອ່ານ payment ຈາກ DB → status = PENDING ✓ (ຜ່ານການກວດ)
2. walletService.creditFromPayment() → ເຕີມເງິນໃສ່ Wallet ແລ້ວ ← ຈຸດອັນຕະລາຍ
3. prisma.payment.update({ status: COMPLETED }) ← ຖ້າຂັ້ນຕອນນີ້ລົ້ມເຫຼວ...
```

**ສະຖານະການທີ່ເຮັດໃຫ້ເກີດ Double Credit:**

- ຂັ້ນຕອນ 2 ສຳເລັດ (ເງິນຖືກເຕີມແລ້ວ) ແຕ່ຂັ້ນຕອນ 3 ລົ້ມເຫຼວ (network ຂັດຂ້ອງ, pod restart ຯລຯ)
- RabbitMQ ບໍ່ໄດ້ຮັບ `ack` → ສົ່ງ message ໃໝ່ (DLQ retry)
- ຄັ້ງໂທ retry ອ່ານ `status = PENDING` (ຍ້ອນຂັ້ນຕອນ 3 ບໍ່ສຳເລັດ) → ຜ່ານການກວດ
- ເຕີມເງິນໄດ້ອີກຄັ້ງ → **ຍອດເງິນຜິດ**

ນອກຈາກນີ້, `WalletTransaction.referenceId` ບໍ່ມີ `@unique` constraint ໃນ schema ດັ່ງນັ້ນ DB ກໍ່ບໍ່ສາມາດກັ້ນ duplicate ໄດ້.

---

## ວິທີແກ້ໄຂ (Solution)

ໃຊ້ **Atomic Compare-and-Swap (CAS)** ໂດຍໃຫ້ທັງ 3 ຂັ້ນຕອນ (ປ່ຽນ status, ເຕີມເງິນ, ສ້າງ wallet transaction) ເຮັດວຽກໃນ **PostgreSQL Transaction ດຽວກັນ** ໂດຍໃຊ້ `updateMany` ທີ່ມີເງື່ອນໄຂ `status = PENDING` ເປັນ guard:

```typescript
const credited = await this.prisma.$transaction(async (tx) => {
  // CAS: ຜູ້ consume ດຽວເທົ່ານັ້ນທີ່ຈະໄດ້ count = 1
  const claim = await tx.payment.updateMany({
    where: { id: payment.id, status: PaymentStatus.PENDING },
    data: { status: PaymentStatus.COMPLETED },
  });
  if (claim.count === 0) return null; // ຄົນອື່ນ process ໄປກ່ອນແລ້ວ

  // ເຕີມເງິນ + ສ້າງ wallet transaction ຢູ່ໃນ transaction ດຽວກັນ
  const updatedWallet = await tx.wallet.update({ ... });
  const walletTxn = await tx.walletTransaction.create({ ... });
  await tx.payment.update({ walletTxnId: walletTxn.id, ... });

  return { balance: ..., walletTxnId: walletTxn.id };
});

if (credited === null) return; // ຢຸດ ບໍ່ດຳເນີນການຕໍ່
```

### ເປັນຫຍັງວິທີນີ້ຈຶ່ງປອດໄພ

| ສະຖານະການ | ພຶດຕິກຳ |
|---|---|
| Transaction ສຳເລັດ | `status = COMPLETED`, ເງິນຖືກເຕີມ 1 ຄັ້ງ — DLQ retry ເຫັນ `count = 0` ແລ້ວຢຸດ |
| Transaction rollback | `status = PENDING`, ເງິນບໍ່ຖືກແຕະ — DLQ retry ສາມາດລອງໃໝ່ໄດ້ຢ່າງປອດໄພ |
| 2 consumer ແຂ່ງກັນພ້ອມກັນ | PostgreSQL row-level lock ໃຫ້ຜ່ານໄດ້ຄົນດຽວ (`count = 1`), ອີກຄົນໄດ້ `count = 0` ແລ້ວຢຸດ |

---

## ໄຟລ໌ທີ່ແກ້ໄຂ

### `panda-ev-client-mobile/src/modules/payment/payment-event.consumer.ts`

- ເພີ່ມ `TransactionType` ໃນ import
- ຂຽນ `onCompleted()` ໃໝ່ໃຫ້ໃຊ້ `prisma.$transaction` ທີ່ມີ CAS guard ແທນການໂທ `walletService.creditFromPayment()` ແລ້ວ `payment.update()` ແຍກກັນ

---

## ຫັກໝາຍເຫດ

- `walletService.creditFromPayment()` ຍັງຄົງຢູ່ ແຕ່ບໍ່ຖືກໃຊ້ໃນ path ນີ້ອີກຕໍ່ໄປ
- Logic ການເຕີມເງິນຖືກ inline ໂດຍກົງໃນ transaction ຂອງ consumer
- ການ notify FCM ແລະ Redis publish ຍັງຄົງຢູ່ນອກ transaction (ບໍ່ critical ຕໍ່ຄວາມຖືກຕ້ອງຂອງເງິນ)
