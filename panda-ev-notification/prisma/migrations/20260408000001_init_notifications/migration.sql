-- Migration: init_notifications
-- Creates all tables for the panda_ev_noti schema

CREATE SCHEMA IF NOT EXISTS "panda_ev_noti";

-- Enums
CREATE TYPE "panda_ev_noti"."NotificationChannel" AS ENUM ('FCM', 'WEBSOCKET', 'BOTH');
CREATE TYPE "panda_ev_noti"."NotificationStatus"  AS ENUM ('PENDING', 'SENT', 'DELIVERED', 'READ', 'CLICKED', 'FAILED', 'SUPPRESSED');
CREATE TYPE "panda_ev_noti"."NotificationPriority" AS ENUM ('HIGH', 'NORMAL', 'LOW');

-- notification_templates
CREATE TABLE "panda_ev_noti"."notification_templates" (
  "id"             UUID         NOT NULL DEFAULT gen_random_uuid(),
  "slug"           VARCHAR(100) NOT NULL,
  "channel"        "panda_ev_noti"."NotificationChannel" NOT NULL,
  "priority"       "panda_ev_noti"."NotificationPriority" NOT NULL DEFAULT 'NORMAL',
  "title_lo"       VARCHAR(255) NOT NULL,
  "title_en"       VARCHAR(255) NOT NULL,
  "title_zh"       VARCHAR(255) NOT NULL,
  "body_lo"        TEXT         NOT NULL,
  "body_en"        TEXT         NOT NULL,
  "body_zh"        TEXT         NOT NULL,
  "image_url"      VARCHAR(1000),
  "deep_link_path" VARCHAR(500),
  "action_buttons" JSONB,
  "is_active"      BOOLEAN      NOT NULL DEFAULT true,
  "created_at"     TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at"     TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "notification_templates_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "notification_templates_slug_key" ON "panda_ev_noti"."notification_templates"("slug");

-- notification_logs
CREATE TABLE "panda_ev_noti"."notification_logs" (
  "id"               UUID         NOT NULL DEFAULT gen_random_uuid(),
  "template_id"      UUID,
  "user_id"          VARCHAR(150) NOT NULL,
  "session_id"       VARCHAR(150),
  "charger_identity" VARCHAR(100),
  "station_id"       VARCHAR(150),
  "channel"          "panda_ev_noti"."NotificationChannel" NOT NULL,
  "type"             VARCHAR(100) NOT NULL,
  "priority"         "panda_ev_noti"."NotificationPriority" NOT NULL DEFAULT 'NORMAL',
  "title"            VARCHAR(255) NOT NULL,
  "body"             VARCHAR(1000) NOT NULL,
  "payload"          JSONB,
  "status"           "panda_ev_noti"."NotificationStatus" NOT NULL DEFAULT 'PENDING',
  "fcm_message_id"   VARCHAR(500),
  "error_message"    TEXT,
  "retry_count"      INTEGER      NOT NULL DEFAULT 0,
  "sent_at"          TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "delivered_at"     TIMESTAMPTZ(6),
  "read_at"          TIMESTAMPTZ(6),
  "clicked_at"       TIMESTAMPTZ(6),
  CONSTRAINT "notification_logs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "notification_logs_session_id_type_key" UNIQUE ("session_id", "type"),
  CONSTRAINT "notification_logs_template_id_fkey" FOREIGN KEY ("template_id")
    REFERENCES "panda_ev_noti"."notification_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "notification_logs_user_id_sent_at_idx"       ON "panda_ev_noti"."notification_logs"("user_id", "sent_at");
CREATE INDEX "notification_logs_station_id_sent_at_idx"    ON "panda_ev_noti"."notification_logs"("station_id", "sent_at");
CREATE INDEX "notification_logs_status_sent_at_idx"        ON "panda_ev_noti"."notification_logs"("status", "sent_at");
CREATE INDEX "notification_logs_charger_identity_sent_at_idx" ON "panda_ev_noti"."notification_logs"("charger_identity", "sent_at");

-- user_fcm_devices
CREATE TABLE "panda_ev_noti"."user_fcm_devices" (
  "id"           UUID         NOT NULL DEFAULT gen_random_uuid(),
  "user_id"      VARCHAR(150) NOT NULL,
  "fcm_token"    VARCHAR(500) NOT NULL,
  "platform"     VARCHAR(20),
  "app_version"  VARCHAR(30),
  "is_active"    BOOLEAN      NOT NULL DEFAULT true,
  "last_used_at" TIMESTAMPTZ(6),
  "created_at"   TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at"   TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "user_fcm_devices_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "user_fcm_devices_fcm_token_key" UNIQUE ("fcm_token")
);
CREATE INDEX "user_fcm_devices_user_id_is_active_idx" ON "panda_ev_noti"."user_fcm_devices"("user_id", "is_active");
CREATE INDEX "user_fcm_devices_last_used_at_idx"       ON "panda_ev_noti"."user_fcm_devices"("last_used_at");

-- user_notification_preferences
CREATE TABLE "panda_ev_noti"."user_notification_preferences" (
  "id"                  UUID        NOT NULL DEFAULT gen_random_uuid(),
  "user_id"             VARCHAR(150) NOT NULL,
  "language"            VARCHAR(10)  NOT NULL DEFAULT 'lo',
  "battery_alerts"      BOOLEAN      NOT NULL DEFAULT true,
  "session_alerts"      BOOLEAN      NOT NULL DEFAULT true,
  "overstay_alerts"     BOOLEAN      NOT NULL DEFAULT true,
  "promo_alerts"        BOOLEAN      NOT NULL DEFAULT false,
  "quiet_hours_start"   INTEGER,
  "quiet_hours_end"     INTEGER,
  "created_at"          TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at"          TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "user_notification_preferences_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "user_notification_preferences_user_id_key" UNIQUE ("user_id")
);

-- station_hourly_stats
CREATE TABLE "panda_ev_noti"."station_hourly_stats" (
  "id"                  UUID         NOT NULL DEFAULT gen_random_uuid(),
  "station_id"          VARCHAR(150) NOT NULL,
  "station_name"        VARCHAR(255) NOT NULL,
  "hour"                TIMESTAMPTZ(6) NOT NULL,
  "sessions_started"    INTEGER      NOT NULL DEFAULT 0,
  "sessions_completed"  INTEGER      NOT NULL DEFAULT 0,
  "sessions_failed"     INTEGER      NOT NULL DEFAULT 0,
  "active_sessions"     INTEGER      NOT NULL DEFAULT 0,
  "total_energy_kwh"    DECIMAL(12,3) NOT NULL DEFAULT 0,
  "total_revenue_lak"   BIGINT       NOT NULL DEFAULT 0,
  "total_overstay_lak"  BIGINT       NOT NULL DEFAULT 0,
  "overstay_incidents"  INTEGER      NOT NULL DEFAULT 0,
  "notifications_sent"  INTEGER      NOT NULL DEFAULT 0,
  CONSTRAINT "station_hourly_stats_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "station_hourly_stats_station_id_hour_key" UNIQUE ("station_id", "hour")
);
CREATE INDEX "station_hourly_stats_hour_idx" ON "panda_ev_noti"."station_hourly_stats"("hour" DESC);

-- station_daily_stats
CREATE TABLE "panda_ev_noti"."station_daily_stats" (
  "id"                        UUID         NOT NULL DEFAULT gen_random_uuid(),
  "station_id"                VARCHAR(150) NOT NULL,
  "station_name"              VARCHAR(255) NOT NULL,
  "date"                      DATE         NOT NULL,
  "total_sessions"            INTEGER      NOT NULL DEFAULT 0,
  "completed_sessions"        INTEGER      NOT NULL DEFAULT 0,
  "failed_sessions"           INTEGER      NOT NULL DEFAULT 0,
  "total_energy_kwh"          DECIMAL(12,3) NOT NULL DEFAULT 0,
  "total_revenue_lak"         BIGINT       NOT NULL DEFAULT 0,
  "avg_session_minutes"       DECIMAL(8,2) NOT NULL DEFAULT 0,
  "peak_concurrent_sessions"  INTEGER      NOT NULL DEFAULT 0,
  "total_overstay_lak"        BIGINT       NOT NULL DEFAULT 0,
  "overstay_incidents"        INTEGER      NOT NULL DEFAULT 0,
  "avg_overstay_minutes"      DECIMAL(8,2) NOT NULL DEFAULT 0,
  "unique_users"              INTEGER      NOT NULL DEFAULT 0,
  "notifications_sent"        INTEGER      NOT NULL DEFAULT 0,
  "notifications_failed"      INTEGER      NOT NULL DEFAULT 0,
  CONSTRAINT "station_daily_stats_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "station_daily_stats_station_id_date_key" UNIQUE ("station_id", "date")
);
CREATE INDEX "station_daily_stats_date_idx" ON "panda_ev_noti"."station_daily_stats"("date" DESC);

-- notification_daily_stats
CREATE TABLE "panda_ev_noti"."notification_daily_stats" (
  "id"               UUID         NOT NULL DEFAULT gen_random_uuid(),
  "date"             DATE         NOT NULL,
  "type"             VARCHAR(100) NOT NULL,
  "channel"          "panda_ev_noti"."NotificationChannel" NOT NULL,
  "total_sent"       INTEGER      NOT NULL DEFAULT 0,
  "total_delivered"  INTEGER      NOT NULL DEFAULT 0,
  "total_read"       INTEGER      NOT NULL DEFAULT 0,
  "total_clicked"    INTEGER      NOT NULL DEFAULT 0,
  "total_failed"     INTEGER      NOT NULL DEFAULT 0,
  "total_retried"    INTEGER      NOT NULL DEFAULT 0,
  "total_suppressed" INTEGER      NOT NULL DEFAULT 0,
  CONSTRAINT "notification_daily_stats_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "notification_daily_stats_date_type_channel_key" UNIQUE ("date", "type", "channel")
);
CREATE INDEX "notification_daily_stats_date_idx" ON "panda_ev_noti"."notification_daily_stats"("date" DESC);
