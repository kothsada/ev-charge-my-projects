-- Migration: add_notification_logs_user_id
-- Adds user_id (and other columns) that may be missing if notification_logs
-- was created by an earlier schema without the full column set.

ALTER TABLE "panda_ev_noti"."notification_logs"
  ADD COLUMN IF NOT EXISTS "user_id"          VARCHAR(150),
  ADD COLUMN IF NOT EXISTS "session_id"       VARCHAR(150),
  ADD COLUMN IF NOT EXISTS "charger_identity" VARCHAR(100),
  ADD COLUMN IF NOT EXISTS "station_id"       VARCHAR(150),
  ADD COLUMN IF NOT EXISTS "type"             VARCHAR(100),
  ADD COLUMN IF NOT EXISTS "priority"         "panda_ev_noti"."NotificationPriority" NOT NULL DEFAULT 'NORMAL',
  ADD COLUMN IF NOT EXISTS "title"            VARCHAR(255),
  ADD COLUMN IF NOT EXISTS "body"             VARCHAR(1000),
  ADD COLUMN IF NOT EXISTS "payload"          JSONB,
  ADD COLUMN IF NOT EXISTS "fcm_message_id"   VARCHAR(500),
  ADD COLUMN IF NOT EXISTS "error_message"    TEXT,
  ADD COLUMN IF NOT EXISTS "retry_count"      INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "delivered_at"     TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "read_at"          TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "clicked_at"       TIMESTAMPTZ(6);

-- Back-fill user_id to empty string for any existing rows (NOT NULL constraint)
UPDATE "panda_ev_noti"."notification_logs" SET "user_id" = '' WHERE "user_id" IS NULL;
ALTER TABLE "panda_ev_noti"."notification_logs" ALTER COLUMN "user_id" SET NOT NULL;

-- Add unique index on (session_id, type) if not already present
CREATE UNIQUE INDEX IF NOT EXISTS "notification_logs_session_id_type_key"
  ON "panda_ev_noti"."notification_logs"("session_id", "type");

-- Add indexes if not already present
CREATE INDEX IF NOT EXISTS "notification_logs_user_id_sent_at_idx"
  ON "panda_ev_noti"."notification_logs"("user_id", "sent_at");
CREATE INDEX IF NOT EXISTS "notification_logs_station_id_sent_at_idx"
  ON "panda_ev_noti"."notification_logs"("station_id", "sent_at");
CREATE INDEX IF NOT EXISTS "notification_logs_status_sent_at_idx"
  ON "panda_ev_noti"."notification_logs"("status", "sent_at");
CREATE INDEX IF NOT EXISTS "notification_logs_charger_identity_sent_at_idx"
  ON "panda_ev_noti"."notification_logs"("charger_identity", "sent_at");
