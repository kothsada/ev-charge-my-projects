-- =============================================================
-- mobile-db-a2 — Mobile API (panda-ev-client-mobile)
-- Master: port 5432 (DATABASE_URL)
-- Replica: port 5433 (DATABASE_REPLICA_URL) — READ ONLY
--
-- Run on the MASTER instance only. The replica is a managed
-- Cloud SQL Read Replica and replicates automatically.
--
--   psql "host=127.0.0.1 port=5432 user=postgres" -f 02-init-mobile-db.sql
-- if run script not work below is a command is work
-- # gcloud sql users set-password panda_mobile_user \
--     --instance=panda-ev-instance-mobile-db-a2 \
--     --project=pandaev \
--     --prompt-for-password

-- # gcloud sql users set-password panda_mobile_reader \
--     --instance=panda-ev-instance-mobile-db-a2 \
--     --project=pandaev \
--     --prompt-for-password
-- =============================================================

-- 1. Application user
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'panda_mobile_user') THEN
        CREATE ROLE panda_mobile_user WITH LOGIN PASSWORD 'Panda>2026>WriteMobile1234567890>';
    END IF;
    GRANT panda_mobile_user TO postgres;
END
$$;

-- 2. Read-only role for the replica connection pool (used by DATABASE_REPLICA_URL)
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'panda_mobile_reader') THEN
        CREATE ROLE panda_mobile_reader WITH LOGIN PASSWORD 'Panda>2026>ReadMobile1234567890>';
    END IF;
    GRANT panda_mobile_reader TO postgres;
END
$$;

-- 3. Database
SELECT 'CREATE DATABASE panda_ev_mobile OWNER panda_mobile_user'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'panda_ev_mobile')
\gexec

\c panda_ev_mobile

-- 4. Schema (panda_ev_mobile lives in the mobile database)
CREATE SCHEMA IF NOT EXISTS panda_ev_mobile AUTHORIZATION panda_mobile_user;

-- 5. Write grants (master)
GRANT USAGE  ON SCHEMA panda_ev_mobile TO panda_mobile_user;
GRANT CREATE ON SCHEMA panda_ev_mobile TO panda_mobile_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA panda_ev_mobile
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO panda_mobile_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA panda_ev_mobile
    GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO panda_mobile_user;

-- 6. Read-only grants (replica connection pool)
GRANT USAGE ON SCHEMA panda_ev_mobile TO panda_mobile_reader;
ALTER DEFAULT PRIVILEGES IN SCHEMA panda_ev_mobile
    GRANT SELECT ON TABLES TO panda_mobile_reader;
ALTER DEFAULT PRIVILEGES IN SCHEMA panda_ev_mobile
    GRANT USAGE, SELECT ON SEQUENCES TO panda_mobile_reader;

-- 7. Extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "btree_gin";   -- GIN indexes on composite columns

SELECT current_database(), current_user, now() AS initialized_at;

-- =============================================================
-- After setup, use these DATABASE_URL values in the Mobile API K8s secret:
--
--   DATABASE_URL=postgresql://panda_mobile_user:PASSWORD@localhost:5432/panda_ev_mobile?schema=panda_ev_mobile
--   DATABASE_REPLICA_URL=postgresql://panda_mobile_reader:PASSWORD@localhost:5433/panda_ev_mobile?schema=panda_ev_mobile
--
-- The Cloud SQL Auth Proxy sidecar exposes:
--   localhost:5432 → master (read/write)
--   localhost:5433 → read replica (read only)
-- =============================================================
