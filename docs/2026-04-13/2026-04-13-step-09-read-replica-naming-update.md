# Step 09: Master-Slave Read Replica Pattern and Naming Convention Update

Update the `overlays/prod/kustomization.yaml` for 5 services to support the Master-Slave (Read Replica) pattern and the new Cloud SQL instance naming convention.

## Changes for Each Service

### 1. Cloud SQL Proxy Containers
Replaced the single `cloud-sql-proxy` with two containers:
- `cloud-sql-proxy-master`: Listens on port 5432, connecting to `pandaev:asia-southeast1:panda-ev-prod-<service>-master`.
- `cloud-sql-proxy-replica`: Listens on port 5433, connecting to `pandaev:asia-southeast1:panda-ev-prod-<service>-replica`.
- The replica proxy uses `--http-port=9091` for its health check to avoid conflict with the master's default port 9090.

### 2. ConfigMap Literals
Updated `configMapGenerator` to include:
- `NODE_ENV="production"`
- `DATABASE_URL`: `postgresql://USER:PASS@127.0.0.1:5432/<db_name>`
- `DATABASE_REPLICA_URL`: `postgresql://USER:PASS@127.0.0.1:5433/<db_name>`

## Service Naming Mapping
The `<service>` suffix in instance names and `<db_name>` in connection strings follow this mapping:
- **panda-ev-client-mobile**: `core`
- **panda-ev-csms-system-admin**: `core`
- **panda-ocpp-api**: `ocpp`
- **panda-ev-gateway-services**: `gateway`
- **panda-ev-notification**: `notification`

## Implementation Steps
1.  **panda-ev-client-mobile**: Updated `overlays/prod/kustomization.yaml` with `core` mapping and new instance names.
2.  **panda-ev-csms-system-admin**: Updated `overlays/prod/kustomization.yaml` with `core` mapping and new instance names.
3.  **panda-ocpp-api**: Updated `overlays/prod/kustomization.yaml` with `ocpp` mapping and new instance names.
4.  **panda-ev-gateway-services**: Updated `overlays/prod/kustomization.yaml` with `gateway` mapping and new instance names.
5.  **panda-ev-notification**: Updated `overlays/prod/kustomization.yaml` with `notification` mapping and new instance names.

## Verification
- JSON patches were reviewed for correct syntax (RFC 6902 compatible YAML list).
- Port mappings (5432 for master, 5433 for replica) and health check port (9091 for replica) were verified.
- Instance connection strings follow the requested `panda-ev-prod-<service>-master/replica` pattern.
