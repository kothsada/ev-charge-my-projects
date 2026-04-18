-- =============================================================
-- system-db-a2 — Admin Service (panda-ev-csms-system-admin)
-- Run as the Cloud SQL superuser (postgres) via Cloud Shell or
-- Cloud SQL Auth Proxy:
--   psql "host=127.0.0.1 port=5432 user=postgres" -f 01-init-system-db.sql
-- if run script not work below is a command is work
-- # gcloud sql users set-password panda_mobile_user \
--     --instance=panda-ev-instance-mobile-db-a2 \
--     --project=pandaev \
--     --prompt-for-password
-- =============================================================

-- 1. Create the application user (idempotent)
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'panda_admin_user') THEN
        CREATE ROLE panda_admin_user WITH LOGIN PASSWORD 'Panda>2026>Admin1234567890>';
    END IF;
    GRANT panda_admin_user TO postgres;
END
$$;

-- 2. Create the database (run as superuser; skip if it exists)
SELECT 'CREATE DATABASE panda_ev_system OWNER panda_admin_user'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'panda_ev_system')
\gexec

-- 3. Connect to the new database to create the schema
\c panda_ev_system

-- 4. Schema
CREATE SCHEMA IF NOT EXISTS panda_ev_system AUTHORIZATION panda_admin_user;

-- 5. Grant
GRANT USAGE  ON SCHEMA panda_ev_system TO panda_admin_user;
GRANT CREATE ON SCHEMA panda_ev_system TO panda_admin_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA panda_ev_system
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO panda_admin_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA panda_ev_system
    GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO panda_admin_user;

-- 6. Required extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "pg_trgm";    -- trigram full-text indexes

-- Confirm
SELECT current_database(), current_user, now() AS initialized_at;
