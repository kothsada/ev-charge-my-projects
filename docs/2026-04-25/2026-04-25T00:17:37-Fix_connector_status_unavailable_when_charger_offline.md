# ແກ້ໄຂ: ສະຖານະ Connector ບໍ່ອັບເດດເປັນ UNAVAILABLE ເມື່ອ Charger ອອບໄລນ໌

**ວັນທີ:** 2026-04-25  
**ຜູ້ດຳເນີນການ:** kothsada  

---

## ສະຫຼຸບບັນຫາ

ເມື່ອ Charger ຕັດການເຊື່ອມຕໍ່ (offline), ສະຖານະຂອງ Charger ຖືກອັບເດດເປັນ `OFFLINE` ຢ່າງຖືກຕ້ອງ, ແຕ່ **Connector ທຸກໂຕຂອງ Charger ນັ້ນຍັງຄົງສະຖານະເກົ່າ** (ເຊັ່ນ: `AVAILABLE`) ບໍ່ໄດ້ປ່ຽນເປັນ `UNAVAILABLE` ທັງໃນ OCPP service ແລະ Admin DB.

---

## ສາເຫດ

ມີ 2 ຈຸດທີ່ຂາດຫາຍ:

### 1. OCPP Service — `ocpp.service.ts`

ຟັງຊັນ `updateChargerOffline()` ເຮັດແຕ່:
- ອັບເດດ `Charger.status → OFFLINE` ໃນ DB
- ອັບເດດ Redis cache `charger_status:{identity}`
- Publish event `charger.offline` ໄປ RabbitMQ
- Force-stop transactions ທີ່ຄ້າງຢູ່

**ແຕ່ບໍ່ໄດ້:**
- ອັບເດດ `Connector.status → UNAVAILABLE` ໃນ DB
- ອັບເດດ Redis cache `connector_status:{identity}:{connectorId}`
- Publish `connector.status_changed` ໄປ RabbitMQ

### 2. Admin Service — `ocpp-status-consumer.service.ts`

ຟັງຊັນ `handleChargerOffline()` ເຮັດແຕ່:
- ອັບເດດ `charger.status → OFFLINE` ໃນ `panda_ev_system`
- Emit WebSocket event `charger status` ໄປ dashboard

**ແຕ່ບໍ່ໄດ້:**
- ອັບເດດ `connector.status → UNAVAILABLE` ໃນ `panda_ev_system`
- Emit WebSocket event `connector status` ໄປ dashboard

---

## ການແກ້ໄຂ

### ໄຟລ໌ທີ 1: `panda-ev-ocpp/src/modules/ocpp/ocpp.service.ts`

ເພີ່ມໂຄດໃນ `updateChargerOffline()` ຫຼັງຈາກ publish `charger.offline`:

```typescript
// ດຶງ connector ທຸກໂຕທີ່ active ຂອງ charger ນີ້
const connectors = await this.prisma.connector.findMany({
  where: { chargerId: charger.id, isActive: true },
});

// ອັບເດດ DB — ທຸກ connector → UNAVAILABLE
await this.prisma.connector.updateMany({
  where: { chargerId: charger.id, isActive: true },
  data: { status: ConnectorStatus.UNAVAILABLE },
});

// ອັບເດດ Redis cache + publish event ສຳລັບແຕ່ລະ connector
for (const connector of connectors) {
  this.cache.setConnectorStatus(identity, connector.connectorId, {
    status: 'Unavailable',
    identity,
    connectorId: connector.connectorId,
    updatedAt,
  });

  this.rabbitmq.publish('connector.status_changed', { ... });
  this.rabbitmq.publishStatus('connector.status_changed', { ... });
}
```

### ໄຟລ໌ທີ 2: `panda-ev-csms-system-admin/src/modules/station/services/ocpp-status-consumer.service.ts`

ເພີ່ມໂຄດໃນ `handleChargerOffline()` ຫຼັງຈາກ emit charger status:

```typescript
// ດຶງ connector ທຸກໂຕຂອງ charger ນີ້
const connectors = await this.prisma.connector.findMany({
  where: { chargerId: charger.id, deletedAt: null },
  select: { connectorId: true },
});

// ອັບເດດ DB — ທຸກ connector → UNAVAILABLE
await this.prisma.connector.updateMany({
  where: { chargerId: charger.id, deletedAt: null },
  data: { status: 'UNAVAILABLE' as never },
});

// Emit WebSocket event ສຳລັບແຕ່ລະ connector
for (const connector of connectors) {
  this.chargerStatusGateway.emitConnectorStatus(charger.stationId, {
    chargerId: charger.id,
    ocppIdentity: identity,
    connectorId: connector.connectorId,
    stationId: charger.stationId,
    status: 'UNAVAILABLE',
  });
}
```

---

## ເຫດຜົນທີ່ຕ້ອງແກ້ 2 ຈຸດ

| ຊັ້ນ | ເຫດຜົນ |
|---|---|
| OCPP fix | Publish `connector.status_changed` ອອກໄປ queue ເພື່ອໃຫ້ທຸກ service ຮັບຮູ້ |
| Admin fix | ເປັນ safety net — ຖ້າ message ໃນ queue ສູນຫາຍ, `charger.offline` event ດຽວກໍສາມາດ update connector ໃນ Admin DB ໄດ້ |

ທັງ 2 ຈຸດເຮັດວຽກຮ່ວມກັນ: OCPP ສົ່ງ event ຜ່ານ `PANDA_EV_CHARGER_STATUS` queue → Admin ຮັບໃນ `handleConnectorStatusChanged()`, ແລະ `handleChargerOffline()` ກໍ update connector ໂດຍກົງໃນ Admin DB ດ້ວຍ.

---

## ໄຟລ໌ທີ່ຖືກແກ້ໄຂ

- `panda-ev-ocpp/src/modules/ocpp/ocpp.service.ts`
- `panda-ev-csms-system-admin/src/modules/station/services/ocpp-status-consumer.service.ts`
