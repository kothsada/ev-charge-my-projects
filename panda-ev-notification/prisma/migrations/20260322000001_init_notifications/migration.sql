-- Create schema
CREATE SCHEMA IF NOT EXISTS "panda_ev_notifications";

-- Enums
CREATE TYPE "panda_ev_notifications"."NotificationChannel" AS ENUM ('FCM', 'WEBSOCKET', 'BOTH');
CREATE TYPE "panda_ev_notifications"."NotificationStatus" AS ENUM ('PENDING', 'SENT', 'DELIVERED', 'READ', 'CLICKED', 'FAILED', 'SUPPRESSED');
CREATE TYPE "panda_ev_notifications"."NotificationPriority" AS ENUM ('HIGH', 'NORMAL', 'LOW');

-- notification_templates
CREATE TABLE "panda_ev_notifications"."notification_templates" (
  "id"           UUID                                        NOT NULL DEFAULT gen_random_uuid(),
  "slug"         TEXT                                        NOT NULL,
  "channel"      "panda_ev_notifications"."NotificationChannel"  NOT NULL,
  "priority"     "panda_ev_notifications"."NotificationPriority" NOT NULL DEFAULT 'NORMAL',
  "titleLo"      TEXT                                        NOT NULL,
  "titleEn"      TEXT                                        NOT NULL,
  "titleZh"      TEXT                                        NOT NULL,
  "bodyLo"       TEXT                                        NOT NULL,
  "bodyEn"       TEXT                                        NOT NULL,
  "bodyZh"       TEXT                                        NOT NULL,
  "imageUrl"     TEXT,
  "deepLinkPath" TEXT,
  "actionButtons" JSONB,
  "isActive"     BOOLEAN                                     NOT NULL DEFAULT true,
  "createdAt"    TIMESTAMPTZ                                 NOT NULL DEFAULT NOW(),
  "updatedAt"    TIMESTAMPTZ                                 NOT NULL DEFAULT NOW(),

  CONSTRAINT "notification_templates_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "notification_templates_slug_key" ON "panda_ev_notifications"."notification_templates"("slug");

-- notification_logs
CREATE TABLE "panda_ev_notifications"."notification_logs" (
  "id"              UUID                                            NOT NULL DEFAULT gen_random_uuid(),
  "templateId"      UUID,
  "userId"          TEXT                                            NOT NULL,
  "sessionId"       TEXT,
  "chargerIdentity" TEXT,
  "stationId"       TEXT,
  "channel"         "panda_ev_notifications"."NotificationChannel"  NOT NULL,
  "type"            TEXT                                            NOT NULL,
  "priority"        "panda_ev_notifications"."NotificationPriority" NOT NULL DEFAULT 'NORMAL',
  "title"           TEXT                                            NOT NULL,
  "body"            TEXT                                            NOT NULL,
  "payload"         JSONB,
  "status"          "panda_ev_notifications"."NotificationStatus"   NOT NULL DEFAULT 'PENDING',
  "fcmMessageId"    TEXT,
  "errorMessage"    TEXT,
  "retryCount"      INTEGER                                         NOT NULL DEFAULT 0,
  "sentAt"          TIMESTAMPTZ                                     NOT NULL DEFAULT NOW(),
  "deliveredAt"     TIMESTAMPTZ,
  "readAt"          TIMESTAMPTZ,
  "clickedAt"       TIMESTAMPTZ,

  CONSTRAINT "notification_logs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "notification_logs_templateId_fkey"
    FOREIGN KEY ("templateId") REFERENCES "panda_ev_notifications"."notification_templates"("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "notification_logs_sessionId_type_key"
  ON "panda_ev_notifications"."notification_logs"("sessionId", "type")
  WHERE "sessionId" IS NOT NULL;

CREATE INDEX "notification_logs_userId_sentAt_idx"    ON "panda_ev_notifications"."notification_logs"("userId", "sentAt" DESC);
CREATE INDEX "notification_logs_stationId_sentAt_idx" ON "panda_ev_notifications"."notification_logs"("stationId", "sentAt" DESC);
CREATE INDEX "notification_logs_status_sentAt_idx"    ON "panda_ev_notifications"."notification_logs"("status", "sentAt" DESC);
CREATE INDEX "notification_logs_chargerIdentity_sentAt_idx" ON "panda_ev_notifications"."notification_logs"("chargerIdentity", "sentAt" DESC);

-- user_notification_preferences
CREATE TABLE "panda_ev_notifications"."user_notification_preferences" (
  "id"              UUID        NOT NULL DEFAULT gen_random_uuid(),
  "userId"          TEXT        NOT NULL,
  "fcmTokens"       TEXT[]      NOT NULL DEFAULT '{}',
  "apnsTokens"      TEXT[]      NOT NULL DEFAULT '{}',
  "devicePlatforms" TEXT[]      NOT NULL DEFAULT '{}',
  "language"        TEXT        NOT NULL DEFAULT 'lo',
  "batteryAlerts"   BOOLEAN     NOT NULL DEFAULT true,
  "sessionAlerts"   BOOLEAN     NOT NULL DEFAULT true,
  "overstayAlerts"  BOOLEAN     NOT NULL DEFAULT true,
  "promoAlerts"     BOOLEAN     NOT NULL DEFAULT false,
  "quietHoursStart" INTEGER,
  "quietHoursEnd"   INTEGER,
  "createdAt"       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt"       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT "user_notification_preferences_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "user_notification_preferences_userId_key"
  ON "panda_ev_notifications"."user_notification_preferences"("userId");

-- station_hourly_stats
CREATE TABLE "panda_ev_notifications"."station_hourly_stats" (
  "id"                UUID        NOT NULL DEFAULT gen_random_uuid(),
  "stationId"         TEXT        NOT NULL,
  "stationName"       TEXT        NOT NULL,
  "hour"              TIMESTAMPTZ NOT NULL,
  "sessionsStarted"   INTEGER     NOT NULL DEFAULT 0,
  "sessionsCompleted" INTEGER     NOT NULL DEFAULT 0,
  "sessionsFailed"    INTEGER     NOT NULL DEFAULT 0,
  "activeSessions"    INTEGER     NOT NULL DEFAULT 0,
  "totalEnergyKwh"    DECIMAL(12,3) NOT NULL DEFAULT 0,
  "totalRevenueLak"   BIGINT      NOT NULL DEFAULT 0,
  "totalOverstayLak"  BIGINT      NOT NULL DEFAULT 0,
  "overstayIncidents" INTEGER     NOT NULL DEFAULT 0,
  "notificationsSent" INTEGER     NOT NULL DEFAULT 0,

  CONSTRAINT "station_hourly_stats_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "station_hourly_stats_stationId_hour_key"
  ON "panda_ev_notifications"."station_hourly_stats"("stationId", "hour");

CREATE INDEX "station_hourly_stats_hour_idx"
  ON "panda_ev_notifications"."station_hourly_stats"("hour" DESC);

-- station_daily_stats
CREATE TABLE "panda_ev_notifications"."station_daily_stats" (
  "id"                     UUID    NOT NULL DEFAULT gen_random_uuid(),
  "stationId"              TEXT    NOT NULL,
  "stationName"            TEXT    NOT NULL,
  "date"                   DATE    NOT NULL,
  "totalSessions"          INTEGER NOT NULL DEFAULT 0,
  "completedSessions"      INTEGER NOT NULL DEFAULT 0,
  "failedSessions"         INTEGER NOT NULL DEFAULT 0,
  "totalEnergyKwh"         DECIMAL(12,3) NOT NULL DEFAULT 0,
  "totalRevenueLak"        BIGINT  NOT NULL DEFAULT 0,
  "avgSessionMinutes"      DECIMAL(8,2)  NOT NULL DEFAULT 0,
  "peakConcurrentSessions" INTEGER NOT NULL DEFAULT 0,
  "totalOverstayLak"       BIGINT  NOT NULL DEFAULT 0,
  "overstayIncidents"      INTEGER NOT NULL DEFAULT 0,
  "avgOverstayMinutes"     DECIMAL(8,2)  NOT NULL DEFAULT 0,
  "uniqueUsers"            INTEGER NOT NULL DEFAULT 0,
  "notificationsSent"      INTEGER NOT NULL DEFAULT 0,
  "notificationsFailed"    INTEGER NOT NULL DEFAULT 0,

  CONSTRAINT "station_daily_stats_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "station_daily_stats_stationId_date_key"
  ON "panda_ev_notifications"."station_daily_stats"("stationId", "date");

CREATE INDEX "station_daily_stats_date_idx"
  ON "panda_ev_notifications"."station_daily_stats"("date" DESC);

-- notification_daily_stats
CREATE TABLE "panda_ev_notifications"."notification_daily_stats" (
  "id"              UUID                                            NOT NULL DEFAULT gen_random_uuid(),
  "date"            DATE                                            NOT NULL,
  "type"            TEXT                                            NOT NULL,
  "channel"         "panda_ev_notifications"."NotificationChannel"  NOT NULL,
  "totalSent"       INTEGER NOT NULL DEFAULT 0,
  "totalDelivered"  INTEGER NOT NULL DEFAULT 0,
  "totalRead"       INTEGER NOT NULL DEFAULT 0,
  "totalClicked"    INTEGER NOT NULL DEFAULT 0,
  "totalFailed"     INTEGER NOT NULL DEFAULT 0,
  "totalRetried"    INTEGER NOT NULL DEFAULT 0,
  "totalSuppressed" INTEGER NOT NULL DEFAULT 0,

  CONSTRAINT "notification_daily_stats_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "notification_daily_stats_date_type_channel_key"
  ON "panda_ev_notifications"."notification_daily_stats"("date", "type", "channel");

CREATE INDEX "notification_daily_stats_date_idx"
  ON "panda_ev_notifications"."notification_daily_stats"("date" DESC);
