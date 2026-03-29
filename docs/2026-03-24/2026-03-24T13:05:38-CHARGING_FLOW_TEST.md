# Charging Flow Integration Test
**Date:** 2026-03-24
**Services:** Admin (4000) · Mobile API (4001) · OCPP CSMS (4002) · VCP Simulator

---

## Test Environment

| Service | Port | Status |
|---|---|---|
| `panda-ev-csms-system-admin` | 4000 | ✅ Running |
| `panda-ev-client-mobile` | 4001 | ✅ Running |
| `panda-ev-ocpp` | 4002 | ✅ Running |
| `ocpp-virtual-charge-point` | WS + admin:9999 | ✅ Running |

**VCP config** (`.env`):
```
WS_URL=ws://localhost:4002/ocpp
CP_ID=PANDA-DONGNASOK-08
ADMIN_PORT=9999
```

---

## Bugs Fixed This Session

### 1. Admin / Mobile Login — RS256 + Refresh Token Conflict
**Error:** `secretOrPrivateKey must be an asymmetric key when using RS256`

**Root cause:** `JwtModule` is registered with `algorithm: 'RS256'` (RSA keypair for access tokens).
Calling `jwtService.sign(payload, { secret: plainString })` for refresh tokens inherits the global RS256 algorithm — `jsonwebtoken` rejects a plain string as the private key.

**Fix** — add explicit algorithm override on every refresh token call:

```ts
// auth.service.ts (admin + mobile)

// sign
this.jwtService.sign(payload, {
  secret: this.refreshSecret,
  algorithm: 'HS256',        // ← added
  expiresIn: this.refreshExpiresIn,
});

// verify (refresh + logout)
this.jwtService.verify(token, {
  secret: this.refreshSecret,
  algorithms: ['HS256'],     // ← added
});
```

Files changed:
- `panda-ev-csms-system-admin/src/modules/auth/auth.service.ts`
- `panda-ev-client-mobile/src/modules/auth/auth.service.ts`

---

### 2. `chargerOnline: null` After 10 Minutes
**Root cause:** `charger_status:{identity}` Redis key (TTL 600 s) was only written on `BootNotification`. After 10 min the key expired and `getLiveStatus` returned `chargerOnline: null`.

**Fix** — refresh the Redis key on every `Heartbeat`:

```ts
// panda-ev-ocpp/src/modules/ocpp/ocpp.service.ts

async handleHeartbeat(identity: string): Promise<void> {
  await this.prisma.charger.updateMany({ ... });

  // refresh charger_status so mobile getLiveStatus stays accurate
  await this.cache.setChargerStatus(identity, {
    status: 'ONLINE',
    identity,
    updatedAt: nowBangkokIso(),
  });

  this.rabbitmq.publish('charger.heartbeat', { identity, timestamp: nowBangkokIso() });
}
```

---

## Data Sync Endpoints (Admin)

### Charger → OCPP Sync (manual trigger)

| Method | URL | Permission | Description |
|---|---|---|---|
| `POST` | `/api/admin/v1/stations/:stationId/chargers/:chargerId/sync-ocpp` | `chargers:manage` | Sync one charger + all its connectors to OCPP DB |
| `POST` | `/api/admin/v1/stations/:stationId/sync-ocpp` | `chargers:manage` | Sync all chargers at a station to OCPP DB |

**Response example:**
```json
{ "data": { "ocppIdentity": "PANDA-DONGNASOK-08", "connectorsCount": 2 } }
{ "data": { "synced": 12, "total": 12 } }
```

Sync also fires automatically on charger/connector create, update, and soft-delete.

---

## Mobile App — Charging Endpoints

### Start Session
```
POST /api/mobile/v1/charging-sessions/start
Authorization: Bearer <access_token>
```
```json
{
  "chargerIdentity": "PANDA-DONGNASOK-08",
  "connectorId": 1,
  "stationId": "79735198-8ba1-4c11-b918-fe45e8131c85",
  "stationName": "Panda EV — Dongnasok",
  "pricePerKwh": 1000
}
```

**Response:**
```json
{
  "id": "e05a0af8-ba19-4351-98de-7138fbabc7d9",
  "chargerIdentity": "PANDA-DONGNASOK-08",
  "stationName": "Panda EV — Dongnasok",
  "status": "ACTIVE",
  "pricePerKwh": 1000,
  "startedAt": "2026-03-24T09:58:31+07:00",
  "ocppTransactionId": null
}
```

---

### Live Status (poll every 5–10 s while ACTIVE)
```
GET /api/mobile/v1/charging-sessions/:id/live
Authorization: Bearer <access_token>
```

**Response — what to show on the charging screen:**
```json
{
  "sessionId": "e05a0af8-ba19-4351-98de-7138fbabc7d9",
  "status": "ACTIVE",
  "chargerIdentity": "PANDA-DONGNASOK-08",
  "connectorId": 1,
  "startedAt": "2026-03-24T09:58:31+07:00",
  "durationMinutes": 1,
  "meterStartWh": 0,
  "currentMeterWh": 600,
  "energyKwh": 0.6,
  "pricePerKwh": 1000,
  "estimatedCost": 600,
  "meterUpdatedAt": "2026-03-24T02:59:31.228Z",
  "chargerOnline": true
}
```

| Field | Source | Notes |
|---|---|---|
| `status` | DB | `ACTIVE` while charging |
| `chargerOnline` | Redis `charger_status:{id}` | Refreshed every 5 min by Heartbeat |
| `durationMinutes` | Computed | `(now - startedAt) / 60000` |
| `currentMeterWh` | Redis `charging:live:{id}:{conn}` | Updated every 15 s from MeterValues |
| `energyKwh` | Computed | `(currentMeterWh - meterStartWh) / 1000` |
| `estimatedCost` | Computed | `energyKwh × pricePerKwh` (LAK) |

---

### Stop Session
```
DELETE /api/mobile/v1/charging-sessions/:id
Authorization: Bearer <access_token>
```

Sends `RemoteStopTransaction` via RabbitMQ → OCPP CSMS → charger.
Session is finalized when the charger confirms `StopTransaction`.

---

### Session History
```
GET /api/mobile/v1/charging-sessions?page=1&limit=10
Authorization: Bearer <access_token>
```

**Completed session receipt fields:**
```json
{
  "id": "e05a0af8-...",
  "stationName": "Panda EV — Dongnasok",
  "chargerIdentity": "PANDA-DONGNASOK-08",
  "ocppTransactionId": 3,
  "status": "COMPLETED",
  "startedAt": "2026-03-24T09:58:31+07:00",
  "endedAt": "2026-03-24T10:00:42+07:00",
  "durationMinutes": 2,
  "energyKwh": 1.31,
  "pricePerKwh": 1000,
  "amount": 1310
}
```

---

## Full Flow Test Results

```
Mobile App ──POST /start──► Mobile API ──RabbitMQ──► OCPP CSMS ──WS──► VCP
                                                         ◄── StartTransaction ──
                                         ◄── RabbitMQ transaction.started ──
                                ◄── session.ocppTransactionId linked ──

Mobile App ──DELETE /:id──► Mobile API ──RabbitMQ──► OCPP CSMS ──WS──► VCP
                                                         ◄── StopTransaction ──
                                         ◄── RabbitMQ transaction.stopped ──
                                ◄── wallet deducted, session COMPLETED ──
```

### Test Run Summary

| Step | Action | Result |
|---|---|---|
| 1 | VCP `BootNotification` | Charger ONLINE in DB + Redis |
| 2 | `POST /charging-sessions/start` | Session created, `RemoteStartTransaction` sent |
| 3 | VCP responds `Accepted` + sends `StartTransaction` | `ocppTransactionId: 3` linked to session |
| 4 | VCP sends `MeterValues` every 15 s | Redis `charging:live` updated, live API returns real values |
| 5 | `DELETE /charging-sessions/:id` | `RemoteStopTransaction` sent |
| 6 | VCP sends `StopTransaction` (`meterStop: 1310 Wh`) | Session COMPLETED, wallet deducted |

### Final Numbers

| Metric | Value |
|---|---|
| Energy | **1.31 kWh** |
| Duration | **2 min** |
| Rate | 1,000 LAK/kWh |
| Cost | **1,310 LAK** |
| Wallet before | 98,280 LAK |
| Wallet after | **96,970 LAK** |

---

## Redis Keys During a Session

| Key | TTL | Contents |
|---|---|---|
| `charging:session:{sessionId}` | 8 h | Full billing snapshot: userId, walletId, pricePerKwh, meterStart, fee config |
| `charging:charger:{identity}` | 8 h | Active `sessionId` — prevents double-starts |
| `charging:live:{identity}:{connectorId}` | 8 h | `{ meterWh, transactionId, updatedAt }` — from MeterValues |
| `charger_status:{identity}` | 600 s | `{ status, identity, updatedAt }` — from Boot + Heartbeat |

---

## Notes

- **VCP disconnects on OCPP hot-reload** — restart VCP after `npm run start:dev` reloads. In production this is not an issue.
- **Stale charger lock after crash** — if OCPP restarts mid-session, manually delete `charging:charger:{identity}` from Redis to unblock new sessions.
- **MeterValues interval** — VCP simulator fires every 15 s. Real chargers vary (configured via `ChangeConfiguration` `MeterValueSampleInterval`).
