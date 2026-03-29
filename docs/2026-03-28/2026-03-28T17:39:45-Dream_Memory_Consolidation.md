# Dream — Memory Consolidation
**Date:** 2026-03-28T17:39:45
**Scope:** Panda EV Platform — full memory pass, prune stale facts, verify current state

---

## Changes Made

| File | Action |
|---|---|
| `project_notification_service.md` | Removed commit hash `ac77374` — not useful in memory |
| `project_seeded_data.md` | Removed dropped migration `20260313000000_add_station_fee_config` — historical noise |
| `project_audit_and_roadmap.md` | Tightened P1.6 description to include dedup + retry context |
| `project_sse_realtime.md` | Updated "NOT yet implemented" → SseManagerService is done; only HTTP endpoint + OCPP publish pending |
| `MEMORY.md` | Compacted SSE entry; updated doc format reference to new `yyyy-mm-dd/yyyy-mm-ddTHH:mm:ss-Name.md` |
| `feedback_save_implementation_docs.md` | Updated to new docs directory structure format |

---

## Already Accurate — No Change Needed

- `feedback_gotchas.md` — all entries still valid
- `project_data_sync.md` — current
- `project_ocpp_implementation.md` — current
- `project_seeded_data.md` — cleaned, now current

---

## Current Memory Index (as of this dream)

```
MEMORY.md (8 entries)
├── project_audit_and_roadmap.md     — P1.1 + P1.5 still open; P1.2–P1.6 fixed
├── project_notification_service.md  — FCM fully decoupled; all events → PANDA_EV_NOTIFICATIONS
├── project_ocpp_implementation.md   — 19 OCPP actions; Admin↔OCPP command bridge
├── project_data_sync.md             — Mobile→Admin (USER_EVENTS); Admin→OCPP (CHARGER_SYNC)
├── project_sse_realtime.md          — SseManagerService done; endpoint + OCPP publish pending
├── project_seeded_data.md           — 6 stations, 1000 LAK/kWh, admin credentials
├── feedback_gotchas.md              — Prisma uuid, OCPP status case, Lua atomics, module order
└── feedback_save_implementation_docs.md — docs/yyyy-mm-dd/yyyy-mm-ddTHH:mm:ss-Name.md
```

---

## Critical Open Items

| Priority | Item | Status |
|---|---|---|
| 🔴 P1.1 | Charger lock race condition — `GET + SET` not atomic; needs `SET NX` | **Open** |
| 🔴 P1.5 | JWT HS256 fallback still in `JwtStrategy` — weak secret risk | **Open** |
| ⏳ SSE | `SseManagerService` ready; `@Sse()` HTTP endpoint + OCPP Redis Pub/Sub publish not wired | **Pending** |

---

## Completed Since Last Audit (2026-03-25)

| Date | Item |
|---|---|
| 2026-03-28 | P1.2 — OCPP status case comparison fixed (`.toUpperCase()`) |
| 2026-03-28 | P1.3 — `meterStart` fallback added to billing path |
| 2026-03-28 | P1.4 — Wallet atomic debit via `$executeRaw WHERE balance >= amount` |
| 2026-03-28 | P1.6 — FCM decoupled from `OcppConsumerService`; push via `PANDA_EV_NOTIFICATIONS` |
| 2026-03-28 | Fault notification — `connector.status_changed (Faulted)` → user alert |
| 2026-03-28 | Stale token cleanup loop — `PANDA_EV_FCM_CLEANUP` queue wired |
| 2026-03-28 | Notification Service hardened — JWT verify, Lua rate-limit, auto-reconnect, prefetch |
| 2026-03-28 | E2E tests — 36 tests across 3 files (Scenarios 1–4) all pass |
| 2026-03-28 | docs/ restructured — `yyyy-mm-dd/yyyy-mm-ddTHH:mm:ss-Name.md` format |
