# Fix: panda_mobile_reader missing SELECT grants on panda_ev_mobile schema

**Date:** 2026-05-10  
**Service:** panda-ev-csms-system-admin (admin service)  
**Database:** panda-ev-instance-mobile-db-a2 (`panda_ev_mobile` schema)

## Problem

Admin service was returning 503 on `GET /api/admin/v1/mobile-users/:id/wallet`:

```
[CoreDbService] Core DB operation failed
permission denied for table wallets
```

The `CoreDbService` in `panda-ev-csms-system-admin` connects to the mobile database via `MOBILE_DATABASE_URL` (port 5434 → Cloud SQL proxy → `pandaev:asia-southeast1:panda-ev-instance-mobile-db-a2`) using the read-only user `panda_mobile_reader`. That user had never been granted `SELECT` on the tables in the `panda_ev_mobile` schema.

## Root cause

The tables were owned by `panda_mobile_user` and `panda_mobile_reader` was never explicitly granted access. `DEFAULT PRIVILEGES` also wasn't set, so any new tables created after the initial DB setup would have the same issue.

## Fix

Connected via the Cloud SQL proxy sidecar already running in the admin pod (`panda-system-api-594c6c977f-tgj9g`, port 5434), using Node.js `pg` module (no `psql` in the image).

**Step 1 — Grant SELECT on all 7 tables queried by CoreDbService:**

```sql
GRANT SELECT ON
  "panda_ev_mobile"."wallets",
  "panda_ev_mobile"."wallet_transactions",
  "panda_ev_mobile"."charging_sessions",
  "panda_ev_mobile"."vehicles",
  "panda_ev_mobile"."favorite_stations",
  "panda_ev_mobile"."payments",
  "panda_ev_mobile"."invoices"
TO panda_mobile_reader;
```

Run as: `panda_mobile_user` (table owner), connecting to `127.0.0.1:5434` inside the admin pod.

**Step 2 — Set default privileges for future tables:**

```sql
ALTER DEFAULT PRIVILEGES IN SCHEMA "panda_ev_mobile"
  GRANT SELECT ON TABLES TO panda_mobile_reader;
```

## Verification

Verified by running `SELECT 1 FROM "panda_ev_mobile"."<table>" LIMIT 0` as `panda_mobile_reader` against all 7 tables — all returned OK.

## Credentials used

| User | Password source | Purpose |
|---|---|---|
| `panda_mobile_reader` | `panda-system-api-secrets` → `MOBILE_DATABASE_URL` | Reader (the broken user) |
| `panda_mobile_user` | `panda-mobile-api-secrets` → `DATABASE_URL` | Table owner — used to run the GRANT |

## How the GRANT was executed (no psql in pods)

```bash
# 1. Write script to admin pod
kubectl exec -n panda-ev-prod panda-system-api-594c6c977f-tgj9g \
  -- sh -c 'cat > /tmp/grant.js' < grant.js

# 2. Run it (uses /app/node_modules/pg, proxy on 127.0.0.1:5434)
kubectl exec -n panda-ev-prod panda-system-api-594c6c977f-tgj9g \
  -- sh -c 'cd /app && node /tmp/grant.js'
```

No pod restart needed — `CoreDbService` acquires a fresh pg connection per request via `withClient()`.
