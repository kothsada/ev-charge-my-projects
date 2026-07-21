-- Add broadcast notification tables to panda_ev_noti schema
-- notification_broadcasts: one row per admin topic/broadcast send
-- broadcast_read_status: per-user read tracking for broadcasts

CREATE TABLE "panda_ev_noti"."notification_broadcasts" (
  "id"             UUID NOT NULL DEFAULT gen_random_uuid(),
  "type"           VARCHAR(100) NOT NULL DEFAULT 'admin_broadcast',
  "title"          VARCHAR(255) NOT NULL,
  "body"           VARCHAR(1000) NOT NULL,
  "payload"        JSONB,
  "channel"        "panda_ev_noti"."NotificationChannel" NOT NULL DEFAULT 'FCM',
  "priority"       "panda_ev_noti"."NotificationPriority" NOT NULL DEFAULT 'HIGH',
  "fcm_message_id" VARCHAR(500),
  "status"         "panda_ev_noti"."NotificationStatus" NOT NULL DEFAULT 'SENT',
  "sent_at"        TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT "notification_broadcasts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "notification_broadcasts_sent_at_idx"
  ON "panda_ev_noti"."notification_broadcasts"("sent_at" DESC);

CREATE TABLE "panda_ev_noti"."broadcast_read_status" (
  "user_id"      VARCHAR(150) NOT NULL,
  "broadcast_id" UUID NOT NULL,
  "status"       "panda_ev_noti"."NotificationStatus" NOT NULL DEFAULT 'SENT',
  "read_at"      TIMESTAMPTZ(6),
  CONSTRAINT "broadcast_read_status_pkey" PRIMARY KEY ("user_id", "broadcast_id"),
  CONSTRAINT "broadcast_read_status_broadcast_id_fkey"
    FOREIGN KEY ("broadcast_id")
    REFERENCES "panda_ev_noti"."notification_broadcasts"("id")
    ON DELETE CASCADE
);

CREATE INDEX "broadcast_read_status_user_id_idx"
  ON "panda_ev_noti"."broadcast_read_status"("user_id");
