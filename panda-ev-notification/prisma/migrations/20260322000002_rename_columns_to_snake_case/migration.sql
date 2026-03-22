-- Rename all camelCase columns to snake_case to align with Prisma @map directives
-- PostgreSQL automatically updates indexes and FK constraints on RENAME COLUMN

-- ============================================================
-- notification_templates
-- ============================================================
ALTER TABLE "panda_ev_notifications"."notification_templates"
  RENAME COLUMN "titleLo"       TO "title_lo";
ALTER TABLE "panda_ev_notifications"."notification_templates"
  RENAME COLUMN "titleEn"       TO "title_en";
ALTER TABLE "panda_ev_notifications"."notification_templates"
  RENAME COLUMN "titleZh"       TO "title_zh";
ALTER TABLE "panda_ev_notifications"."notification_templates"
  RENAME COLUMN "bodyLo"        TO "body_lo";
ALTER TABLE "panda_ev_notifications"."notification_templates"
  RENAME COLUMN "bodyEn"        TO "body_en";
ALTER TABLE "panda_ev_notifications"."notification_templates"
  RENAME COLUMN "bodyZh"        TO "body_zh";
ALTER TABLE "panda_ev_notifications"."notification_templates"
  RENAME COLUMN "imageUrl"      TO "image_url";
ALTER TABLE "panda_ev_notifications"."notification_templates"
  RENAME COLUMN "deepLinkPath"  TO "deep_link_path";
ALTER TABLE "panda_ev_notifications"."notification_templates"
  RENAME COLUMN "actionButtons" TO "action_buttons";
ALTER TABLE "panda_ev_notifications"."notification_templates"
  RENAME COLUMN "isActive"      TO "is_active";
ALTER TABLE "panda_ev_notifications"."notification_templates"
  RENAME COLUMN "createdAt"     TO "created_at";
ALTER TABLE "panda_ev_notifications"."notification_templates"
  RENAME COLUMN "updatedAt"     TO "updated_at";

-- ============================================================
-- notification_logs
-- ============================================================
ALTER TABLE "panda_ev_notifications"."notification_logs"
  RENAME COLUMN "templateId"      TO "template_id";
ALTER TABLE "panda_ev_notifications"."notification_logs"
  RENAME COLUMN "userId"          TO "user_id";
ALTER TABLE "panda_ev_notifications"."notification_logs"
  RENAME COLUMN "sessionId"       TO "session_id";
ALTER TABLE "panda_ev_notifications"."notification_logs"
  RENAME COLUMN "chargerIdentity" TO "charger_identity";
ALTER TABLE "panda_ev_notifications"."notification_logs"
  RENAME COLUMN "stationId"       TO "station_id";
ALTER TABLE "panda_ev_notifications"."notification_logs"
  RENAME COLUMN "fcmMessageId"    TO "fcm_message_id";
ALTER TABLE "panda_ev_notifications"."notification_logs"
  RENAME COLUMN "errorMessage"    TO "error_message";
ALTER TABLE "panda_ev_notifications"."notification_logs"
  RENAME COLUMN "retryCount"      TO "retry_count";
ALTER TABLE "panda_ev_notifications"."notification_logs"
  RENAME COLUMN "sentAt"          TO "sent_at";
ALTER TABLE "panda_ev_notifications"."notification_logs"
  RENAME COLUMN "deliveredAt"     TO "delivered_at";
ALTER TABLE "panda_ev_notifications"."notification_logs"
  RENAME COLUMN "readAt"          TO "read_at";
ALTER TABLE "panda_ev_notifications"."notification_logs"
  RENAME COLUMN "clickedAt"       TO "clicked_at";

-- ============================================================
-- user_notification_preferences
-- ============================================================
ALTER TABLE "panda_ev_notifications"."user_notification_preferences"
  RENAME COLUMN "userId"          TO "user_id";
ALTER TABLE "panda_ev_notifications"."user_notification_preferences"
  RENAME COLUMN "fcmTokens"       TO "fcm_tokens";
ALTER TABLE "panda_ev_notifications"."user_notification_preferences"
  RENAME COLUMN "apnsTokens"      TO "apns_tokens";
ALTER TABLE "panda_ev_notifications"."user_notification_preferences"
  RENAME COLUMN "devicePlatforms" TO "device_platforms";
ALTER TABLE "panda_ev_notifications"."user_notification_preferences"
  RENAME COLUMN "batteryAlerts"   TO "battery_alerts";
ALTER TABLE "panda_ev_notifications"."user_notification_preferences"
  RENAME COLUMN "sessionAlerts"   TO "session_alerts";
ALTER TABLE "panda_ev_notifications"."user_notification_preferences"
  RENAME COLUMN "overstayAlerts"  TO "overstay_alerts";
ALTER TABLE "panda_ev_notifications"."user_notification_preferences"
  RENAME COLUMN "promoAlerts"     TO "promo_alerts";
ALTER TABLE "panda_ev_notifications"."user_notification_preferences"
  RENAME COLUMN "quietHoursStart" TO "quiet_hours_start";
ALTER TABLE "panda_ev_notifications"."user_notification_preferences"
  RENAME COLUMN "quietHoursEnd"   TO "quiet_hours_end";
ALTER TABLE "panda_ev_notifications"."user_notification_preferences"
  RENAME COLUMN "createdAt"       TO "created_at";
ALTER TABLE "panda_ev_notifications"."user_notification_preferences"
  RENAME COLUMN "updatedAt"       TO "updated_at";

-- ============================================================
-- station_hourly_stats
-- ============================================================
ALTER TABLE "panda_ev_notifications"."station_hourly_stats"
  RENAME COLUMN "stationId"         TO "station_id";
ALTER TABLE "panda_ev_notifications"."station_hourly_stats"
  RENAME COLUMN "stationName"       TO "station_name";
ALTER TABLE "panda_ev_notifications"."station_hourly_stats"
  RENAME COLUMN "sessionsStarted"   TO "sessions_started";
ALTER TABLE "panda_ev_notifications"."station_hourly_stats"
  RENAME COLUMN "sessionsCompleted" TO "sessions_completed";
ALTER TABLE "panda_ev_notifications"."station_hourly_stats"
  RENAME COLUMN "sessionsFailed"    TO "sessions_failed";
ALTER TABLE "panda_ev_notifications"."station_hourly_stats"
  RENAME COLUMN "activeSessions"    TO "active_sessions";
ALTER TABLE "panda_ev_notifications"."station_hourly_stats"
  RENAME COLUMN "totalEnergyKwh"    TO "total_energy_kwh";
ALTER TABLE "panda_ev_notifications"."station_hourly_stats"
  RENAME COLUMN "totalRevenueLak"   TO "total_revenue_lak";
ALTER TABLE "panda_ev_notifications"."station_hourly_stats"
  RENAME COLUMN "totalOverstayLak"  TO "total_overstay_lak";
ALTER TABLE "panda_ev_notifications"."station_hourly_stats"
  RENAME COLUMN "overstayIncidents" TO "overstay_incidents";
ALTER TABLE "panda_ev_notifications"."station_hourly_stats"
  RENAME COLUMN "notificationsSent" TO "notifications_sent";

-- ============================================================
-- station_daily_stats
-- ============================================================
ALTER TABLE "panda_ev_notifications"."station_daily_stats"
  RENAME COLUMN "stationId"              TO "station_id";
ALTER TABLE "panda_ev_notifications"."station_daily_stats"
  RENAME COLUMN "stationName"            TO "station_name";
ALTER TABLE "panda_ev_notifications"."station_daily_stats"
  RENAME COLUMN "totalSessions"          TO "total_sessions";
ALTER TABLE "panda_ev_notifications"."station_daily_stats"
  RENAME COLUMN "completedSessions"      TO "completed_sessions";
ALTER TABLE "panda_ev_notifications"."station_daily_stats"
  RENAME COLUMN "failedSessions"         TO "failed_sessions";
ALTER TABLE "panda_ev_notifications"."station_daily_stats"
  RENAME COLUMN "totalEnergyKwh"         TO "total_energy_kwh";
ALTER TABLE "panda_ev_notifications"."station_daily_stats"
  RENAME COLUMN "totalRevenueLak"        TO "total_revenue_lak";
ALTER TABLE "panda_ev_notifications"."station_daily_stats"
  RENAME COLUMN "avgSessionMinutes"      TO "avg_session_minutes";
ALTER TABLE "panda_ev_notifications"."station_daily_stats"
  RENAME COLUMN "peakConcurrentSessions" TO "peak_concurrent_sessions";
ALTER TABLE "panda_ev_notifications"."station_daily_stats"
  RENAME COLUMN "totalOverstayLak"       TO "total_overstay_lak";
ALTER TABLE "panda_ev_notifications"."station_daily_stats"
  RENAME COLUMN "overstayIncidents"      TO "overstay_incidents";
ALTER TABLE "panda_ev_notifications"."station_daily_stats"
  RENAME COLUMN "avgOverstayMinutes"     TO "avg_overstay_minutes";
ALTER TABLE "panda_ev_notifications"."station_daily_stats"
  RENAME COLUMN "uniqueUsers"            TO "unique_users";
ALTER TABLE "panda_ev_notifications"."station_daily_stats"
  RENAME COLUMN "notificationsSent"      TO "notifications_sent";
ALTER TABLE "panda_ev_notifications"."station_daily_stats"
  RENAME COLUMN "notificationsFailed"    TO "notifications_failed";

-- ============================================================
-- notification_daily_stats
-- ============================================================
ALTER TABLE "panda_ev_notifications"."notification_daily_stats"
  RENAME COLUMN "totalSent"       TO "total_sent";
ALTER TABLE "panda_ev_notifications"."notification_daily_stats"
  RENAME COLUMN "totalDelivered"  TO "total_delivered";
ALTER TABLE "panda_ev_notifications"."notification_daily_stats"
  RENAME COLUMN "totalRead"       TO "total_read";
ALTER TABLE "panda_ev_notifications"."notification_daily_stats"
  RENAME COLUMN "totalClicked"    TO "total_clicked";
ALTER TABLE "panda_ev_notifications"."notification_daily_stats"
  RENAME COLUMN "totalFailed"     TO "total_failed";
ALTER TABLE "panda_ev_notifications"."notification_daily_stats"
  RENAME COLUMN "totalRetried"    TO "total_retried";
ALTER TABLE "panda_ev_notifications"."notification_daily_stats"
  RENAME COLUMN "totalSuppressed" TO "total_suppressed";
