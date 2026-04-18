-- =============================================================
-- core-db-a2 — Shared instance for Gateway + Notification services
-- One PostgreSQL database, two isolated schemas:
--   panda_ev_gateway  (panda-ev-gateway-services)
--   panda_ev_noti     (panda-ev-notification)
--
-- Master only — no read replica on this instance.
--
-- Run as postgres:
--   psql "host=127.0.0.1 port=5432 user=postgres" -f 04-init-core-db.sql
-- if run script not work below is a command is work
# gcloud sql users set-password panda_gateway_user \
    --instance=panda-ev-instance-core-db-a2 \
    --project=pandaev \
    --prompt-for-password
# gcloud sql users set-password panda_noti_user \
    --instance=panda-ev-instance-core-db-a2 \
    --project=pandaev \
    --prompt-for-password
-- =============================================================

-- ─── Application users ────────────────────────────────────────
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'panda_gateway_user') THEN
        CREATE ROLE panda_gateway_user WITH LOGIN PASSWORD 'Panda>2026>WriteGateway1234567890>';
    END IF;
    GRANT panda_gateway_user TO postgres;
    
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'panda_noti_user') THEN
        CREATE ROLE panda_noti_user WITH LOGIN PASSWORD 'Panda>2026>ReadNotification1234567890>';
    END IF;
    GRANT panda_noti_user TO postgres;
END
$$;

-- ─── Shared database ──────────────────────────────────────────
SELECT 'CREATE DATABASE panda_ev_core OWNER postgres'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'panda_ev_core')
\gexec

\c panda_ev_core

-- ─── Extensions (once per database) ──────────────────────────
CREATE EXTENSION IF NOT EXISTS "pgcrypto";   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- =============================================================
-- SCHEMA: panda_ev_gateway  (Gateway Service)
-- =============================================================
CREATE SCHEMA IF NOT EXISTS panda_ev_gateway AUTHORIZATION panda_gateway_user;

GRANT USAGE  ON SCHEMA panda_ev_gateway TO panda_gateway_user;
GRANT CREATE ON SCHEMA panda_ev_gateway TO panda_gateway_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA panda_ev_gateway
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO panda_gateway_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA panda_ev_gateway
    GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO panda_gateway_user;

-- Ensure the gateway user cannot see/touch the notification schema
REVOKE ALL ON SCHEMA panda_ev_noti FROM panda_gateway_user;

-- =============================================================
-- SCHEMA: panda_ev_noti  (Notification Service)
-- =============================================================
CREATE SCHEMA IF NOT EXISTS panda_ev_noti AUTHORIZATION panda_noti_user;

GRANT USAGE  ON SCHEMA panda_ev_noti TO panda_noti_user;
GRANT CREATE ON SCHEMA panda_ev_noti TO panda_noti_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA panda_ev_noti
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO panda_noti_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA panda_ev_noti
    GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO panda_noti_user;

-- Ensure the notification user cannot see/touch the gateway schema
REVOKE ALL ON SCHEMA panda_ev_gateway FROM panda_noti_user;

SELECT current_database(), current_user, now() AS initialized_at;

-- =============================================================
-- DATABASE_URL values for K8s secrets (core-db-a2 is master-only):
--
-- Gateway service (panda-system-gateway-secrets):
--   DATABASE_URL=postgresql://panda_gateway_user:PASSWORD@localhost:5432/panda_ev_core?schema=panda_ev_gateway
--
-- Notification service (panda-notification-secrets):
--   DATABASE_URL=postgresql://panda_noti_user:PASSWORD@localhost:5432/panda_ev_core?schema=panda_ev_noti
--
-- The ?schema= parameter sets the PostgreSQL search_path so each service
-- only sees its own schema. The two schemas are completely isolated at the
-- DB role level — a misconfigured query cannot accidentally read the other schema.
-- =============================================================
