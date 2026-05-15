# Mobile: Billing Receipt Endpoint

## Summary

Added `GET /api/mobile/v1/charging-sessions/:id/billing` — a dedicated post-charge receipt endpoint that returns the full billing breakdown, wallet debit transaction, and auto-generated invoice in a single response.

---

## Endpoint

```
GET /api/mobile/v1/charging-sessions/:id/billing
Authorization: Bearer <access_token>
```

Returns **422 Unprocessable Entity** if the session is not yet `COMPLETED`.

---

## Response Shape

```json
{
  "sessionId": "uuid",
  "stationId": "uuid",
  "stationName": "Panda EV — Phonsay",
  "chargerIdentity": "PANDA-PHONSAY-01",
  "connectorId": 1,
  "status": "COMPLETED",
  "startedAt": "2026-05-15T09:00:00+07:00",
  "endedAt": "2026-05-15T11:09:00+07:00",
  "durationMinutes": 129,
  "energyKwh": 32.5,
  "pricePerKwh": 1000,
  "vehicle": { "brand": "BYD", "model": "Atto 3", "plateNumber": "PV-8429" },

  "billing": {
    "energyCost": 32500,
    "chargingParkingFee": 19350,
    "unplugFee": 0,
    "subtotal": 51850,
    "vatPct": 10,
    "vatAmount": 5185,
    "total": 57035,
    "lineItems": [
      { "label": "Energy",               "amount": 32500, "detail": "32.500 kWh × 1,000 LAK/kWh" },
      { "label": "Charging Parking Fee", "amount": 19350, "detail": "129 min" },
      { "label": "VAT 10%",              "amount": 5185,  "detail": null }
    ]
  },

  "walletTransaction": {
    "id": "uuid",
    "amountDeducted": 57035,
    "balanceAfter": 42965,
    "description": "Parking 19,350 LAK (129 min × 150 LAK); VAT 10% 5,185 LAK",
    "createdAt": "2026-05-15T11:09:05+07:00"
  },

  "invoice": {
    "id": "uuid",
    "invoiceNumber": "INV-20260515-0001",
    "subtotal": 51850,
    "taxRate": 0.1,
    "taxAmount": 5185,
    "total": 57035,
    "status": "ISSUED",
    "issuedAt": "2026-05-15T11:09:05+07:00"
  }
}
```

### `billing.lineItems` rules

Only non-zero fee entries appear. A session with no parking fee and no VAT returns a single Energy line. The app can render `lineItems` directly without filtering.

| Entry appears when | Label |
|---|---|
| Always (if breakdown columns populated) | `Energy` |
| `chargingParkingFee > 0` | `Charging Parking Fee` |
| `unplugFee > 0` | `Unplug Fee` |
| `vatAmount > 0` | `VAT {vatPct}%` |

### Nullable fields

| Field | Null when |
|---|---|
| `billing.energyCost` (and all breakdown) | Session predates billing breakdown columns (old data) |
| `walletTransaction` | Session had zero balance at billing time, or billing failed |
| `invoice` | Auto-invoice generation failed (fire-and-forget, rare) |
| `vehicle` | No vehicle was associated with the session |

---

## Files Changed

### Mobile service (`panda-ev-client-mobile/`)

| File | Change |
|---|---|
| `src/modules/charging-session/charging-session.service.ts` | Added `getBillingReceipt(userId, sessionId)` method |
| `src/modules/charging-session/charging-session.controller.ts` | Added `GET :id/billing` route with full Swagger example |

---

## Notes

- Route is declared **before** `GET :id` in the controller to avoid NestJS route conflict.
- `walletTransaction` is fetched by `referenceId = sessionId, type = CHARGE` — the same `referenceId` written by `OcppConsumerService.handleSessionCompleted()`.
- `billing.total` reflects `actualDebit` (what was actually charged from the wallet), which may be less than `subtotal + vatAmount` if the user's balance was insufficient at billing time (partial debit).
