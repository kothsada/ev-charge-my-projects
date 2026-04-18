# Cloud SQL Initialization

Run these scripts once against each Cloud SQL instance via Cloud SQL Auth Proxy before running `prisma migrate deploy`.

## Instance → Script mapping

| Cloud SQL Instance | Script | Services |
|---|---|---|
| `system-db-a2` | `01-init-system-db.sql` | panda-ev-csms-system-admin |
| `mobile-db-a2` | `02-init-mobile-db.sql` | panda-ev-client-mobile |
| `ocpp-db-a2` | `03-init-ocpp-db.sql` | panda-ev-ocpp |
| `core-db-a2` | `04-init-core-db.sql` | panda-ev-gateway-services + panda-ev-notification |

## How to run (Cloud Shell)

```bash
# Start Cloud SQL Auth Proxy for the target instance
cloud_sql_proxy -instances=PROJECT:REGION:INSTANCE_NAME=tcp:5432 &

# Apply the init script
psql "host=127.0.0.1 port=5432 user=postgres" -f scripts/init/01-init-system-db.sql
```

## DATABASE_URL format per service

Replace passwords with values from your secret manager before creating K8s secrets.

| Service | `DATABASE_URL` | `DATABASE_REPLICA_URL` |
|---|---|---|
| system-admin | `postgresql://panda_admin_user:PW@localhost:5432/panda_ev_system?schema=panda_ev_system` | _(not set — master only)_ |
| mobile | `postgresql://panda_mobile_user:PW@localhost:5432/panda_ev_mobile?schema=panda_ev_core` | `postgresql://panda_mobile_reader:PW@localhost:5433/panda_ev_mobile?schema=panda_ev_core` |
| ocpp | `postgresql://panda_ocpp_user:PW@localhost:5432/panda_ev_ocpp?schema=panda_ev_ocpp` | `postgresql://panda_ocpp_reader:PW@localhost:5433/panda_ev_ocpp?schema=panda_ev_ocpp` |
| gateway | `postgresql://panda_gateway_user:PW@localhost:5432/panda_ev_core?schema=panda_ev_gateway` | _(not set — master only)_ |
| notification | `postgresql://panda_noti_user:PW@localhost:5432/panda_ev_core?schema=panda_ev_noti` | _(not set — master only)_ |

The Cloud SQL Auth Proxy sidecar in GKE exposes:
- `localhost:5432` → master (read/write)
- `localhost:5433` → read replica (read only, where configured)
