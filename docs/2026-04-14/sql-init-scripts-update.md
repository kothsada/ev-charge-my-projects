# SQL Initialization Scripts Update - 2026-04-14

## Goal
Move the `GRANT <role> TO postgres;` commands outside the `IF NOT EXISTS` checks in all 4 SQL initialization scripts in `scripts/init/`.

## Progress
- [x] 01-init-system-db.sql
- [x] 02-init-mobile-db.sql
- [x] 03-init-ocpp-db.sql
- [x] 04-init-core-db.sql

## Steps Taken
### 1. 01-init-system-db.sql
- Moved `GRANT panda_admin_user TO postgres;` outside the `IF` block.

### 2. 02-init-mobile-db.sql
- Moved `GRANT panda_mobile_user TO postgres;` outside its `IF` block.
- Moved `GRANT panda_mobile_reader TO postgres;` outside its `IF` block.

### 3. 03-init-ocpp-db.sql
- Moved `GRANT panda_ocpp_user TO postgres;` outside its `IF` block.
- Moved `GRANT panda_ocpp_reader TO postgres;` outside its `IF` block.

### 4. 04-init-core-db.sql
- Moved `GRANT panda_gateway_user TO postgres;` outside its `IF` block.
- Moved `GRANT panda_noti_user TO postgres;` outside its `IF` block.
