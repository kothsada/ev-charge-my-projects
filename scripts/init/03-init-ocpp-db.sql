-- =============================================================
-- ocpp-db-a2 — OCPP CSMS (panda-ev-ocpp)
-- Master: port 5432 (DATABASE_URL)
-- Replica: port 5433 (DATABASE_REPLICA_URL) — READ ONLY
--
-- Run on the MASTER instance only.
--   psql "host=127.0.0.1 port=5432 user=postgres" -f 03-init-ocpp-db.sql
-- if run script not work below is a command is work
-- # gcloud sql users set-password panda_ocpp_user \
--     --instance=panda-ev-instance-ocpp-db-a2 \
--     --project=pandaev \
--     --prompt-for-password

-- # gcloud sql users set-password panda_ocpp_reader \
--     --instance=panda-ev-instance-ocpp-db-a2 \
--     --project=pandaev \
--     --prompt-for-password
-- =============================================================

-- 1. Application user (write)
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'panda_ocpp_user') THEN
        CREATE ROLE panda_ocpp_user WITH LOGIN PASSWORD 'Panda>2026>WriteOcpp1234567890>';
    END IF;
    GRANT panda_ocpp_user TO postgres;
END
$$;

-- 2. Read-only role (replica pool)
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'panda_ocpp_reader') THEN
        CREATE ROLE panda_ocpp_reader WITH LOGIN PASSWORD 'Panda>2026>ReadOcpp1234567890>';
    END IF;
    GRANT panda_ocpp_reader TO postgres;
END
$$;

-- 3. Database
SELECT 'CREATE DATABASE panda_ev_ocpp OWNER panda_ocpp_user'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'panda_ev_ocpp')
\gexec

\c panda_ev_ocpp

-- 4. Schema
CREATE SCHEMA IF NOT EXISTS panda_ev_ocpp AUTHORIZATION panda_ocpp_user;

-- 5. Write grants
GRANT USAGE  ON SCHEMA panda_ev_ocpp TO panda_ocpp_user;
GRANT CREATE ON SCHEMA panda_ev_ocpp TO panda_ocpp_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA panda_ev_ocpp
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO panda_ocpp_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA panda_ev_ocpp
    GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO panda_ocpp_user;

-- 6. Read-only grants (replica)
GRANT USAGE ON SCHEMA panda_ev_ocpp TO panda_ocpp_reader;
ALTER DEFAULT PRIVILEGES IN SCHEMA panda_ev_ocpp
    GRANT SELECT ON TABLES TO panda_ocpp_reader;
ALTER DEFAULT PRIVILEGES IN SCHEMA panda_ev_ocpp
    GRANT USAGE, SELECT ON SEQUENCES TO panda_ocpp_reader;

-- 7. Extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";   -- gen_random_uuid() for meter_values

-- 8. Verify pg_partman is available (optional — needed only if using pg_partman instead
--    of the built-in create_meter_values_partition() function)
-- SELECT * FROM pg_extension WHERE extname = 'pg_partman';

SELECT current_database(), current_user, now() AS initialized_at;

-- =============================================================
-- DATABASE_URL and DATABASE_REPLICA_URL for K8s secret:
--
--   DATABASE_URL=postgresql://panda_ocpp_user:PASSWORD@localhost:5432/panda_ev_ocpp?schema=panda_ev_ocpp
--   DATABASE_REPLICA_URL=postgresql://panda_ocpp_reader:PASSWORD@localhost:5433/panda_ev_ocpp?schema=panda_ev_ocpp
-- =============================================================
