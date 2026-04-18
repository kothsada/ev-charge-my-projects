# Multi-Environment Secret Refactor (2026-04-14)

## Overview
Refactored `create-secret.sh` for the remaining 4 services to support multiple environments by accepting a `$NAMESPACE` argument and updating database connection strings to follow a standardized format with placeholders for passwords.

## Changes

### 1. panda-ev-client-mobile/create-secret.sh
- Added `$NAMESPACE` argument support.
- Updated `DATABASE_URL` and `DATABASE_REPLICA_URL`.
- Database: `panda_ev_mobile`.
- Schema: `panda_ev_core`.
- Users: `panda_mobile_user` (Master), `panda_mobile_reader` (Replica).
- Updated `kubectl` to use the specified namespace.

### 2. panda-ev-csms-system-admin/create-secret.sh
- Added `$NAMESPACE` argument support.
- Updated `DATABASE_URL`.
- Database: `panda_ev_system`.
- Schema: `panda_ev_system`.
- User: `panda_admin_user`.
- Updated `kubectl` to use the specified namespace.

### 3. panda-ev-gateway-services/create-secret.sh
- Added `$NAMESPACE` argument support.
- Updated `DATABASE_URL`.
- Database: `panda_ev_core`.
- Schema: `panda_ev_gateway`.
- User: `panda_gateway_user`.
- Updated `kubectl` to use the specified namespace.

### 4. panda-ev-notification/create-secret.sh
- Added `$NAMESPACE` argument support.
- Updated `DATABASE_URL`.
- Database: `panda_ev_core`.
- Schema: `panda_ev_noti`.
- User: `panda_noti_user`.
- Updated `kubectl` to use the specified namespace.

## Verification
- Each script now requires a namespace argument (e.g., `./create-secret.sh panda-ev-prod`).
- Secret deletion and creation are scoped to the provided namespace.
- Database connection strings use the standardized format: `postgresql://USER:YOUR_DB_PASS@127.0.0.1:PORT/DB_NAME?schema=SCHEMA`.
