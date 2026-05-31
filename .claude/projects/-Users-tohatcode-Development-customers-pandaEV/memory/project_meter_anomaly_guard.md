---
name: project_meter_anomaly_guard
description: Charger firmware bug — meterStop=lifetime cumulative odometer instead of session reading; fixed with sanity check in handleStopTransaction
metadata:
  type: project
---

## MeterStop Anomaly Guard (2026-05-26)

**Bug**: Charger sends `meterStart=0` on StartTransaction but `meterStop` = charger's lifetime cumulative energy (e.g. 425 kWh in 90 seconds). Caused instant wallet depletion.

**Fix**: `panda-ev-ocpp/src/modules/ocpp/ocpp.service.ts` → `handleStopTransaction()`

Logic added before any DB write:
```
maxReasonableEnergyWh = ceil(350_000 W × sessionDurationHours × 1.2)
if (meterStop - meterStart) > max:
  effectiveMeterStop = Redis live reading  OR  meterStart (fallback)
  log [METER_ANOMALY]
```

`effectiveMeterStop` replaces `payload.meterStop` in DB update + RabbitMQ `transaction.stopped` publish.

**Log tag**: `[METER_ANOMALY]` — search in production logs to find affected sessions.

Related: [[project_ocpp_timestamp_fix]] — similar charger firmware bug pattern.
