import { Injectable, Logger } from '@nestjs/common';
import { FcmService } from '../fcm/fcm.service';
import { PrismaService } from '../../configs/prisma/prisma.service';
import { RabbitMQService } from '../../configs/rabbitmq/rabbitmq.service';
import { DedupService } from '../dedup/dedup.service';
import { RateLimitService } from '../rate-limit/rate-limit.service';
import { AggregationService } from '../aggregation/aggregation.service';
import { AdminStatsGateway } from '../websocket/admin-stats.gateway';
import { DeviceService } from '../device/device.service';
import { Prisma } from '../../../generated/prisma/client';

// Mobile API consumes this queue to clean up its own user_devices table
const FCM_CLEANUP_QUEUE =
  process.env.RABBITMQ_FCM_CLEANUP_QUEUE ?? 'PANDA_EV_FCM_CLEANUP';

export interface ProcessNotificationDto {
  userId: string;
  sessionId?: string;
  stationId?: string;
  chargerIdentity?: string;
  /** Optional: if omitted, tokens are resolved from user_fcm_devices by userId */
  fcmTokens?: string[];
  type: string;
  title: string;
  body: string;
  data?: Record<string, string>;
  imageUrl?: string;
  priority?: 'high' | 'normal';
  skipDedup?: boolean;
  skipRateLimit?: boolean;
}

export interface ProcessNotificationResult {
  status: 'SENT' | 'SUPPRESSED' | 'FAILED';
  notificationId?: string;
}

@Injectable()
export class NotificationProcessor {
  private readonly logger = new Logger(NotificationProcessor.name);

  constructor(
    private readonly fcm: FcmService,
    private readonly prisma: PrismaService,
    private readonly rabbitMQ: RabbitMQService,
    private readonly dedup: DedupService,
    private readonly rateLimit: RateLimitService,
    private readonly aggregation: AggregationService,
    private readonly statsGateway: AdminStatsGateway,
    private readonly deviceService: DeviceService,
  ) {}

  async process(msg: ProcessNotificationDto): Promise<ProcessNotificationResult> {
    // 1. Dedup check (per session+type)
    if (!msg.skipDedup && msg.sessionId) {
      const isNew = await this.dedup.isNewNotification(msg.sessionId, msg.type);
      if (!isNew) {
        this.logger.debug(`Duplicate suppressed: ${msg.sessionId}/${msg.type}`);
        await this.aggregation.onNotificationSent(msg.type, 'FCM', 'SUPPRESSED');
        return { status: 'SUPPRESSED' };
      }
    }

    // 2. Rate limit check
    if (!msg.skipRateLimit) {
      const allowed = await this.rateLimit.isAllowed(msg.userId, msg.type);
      if (!allowed) {
        this.logger.debug(`Rate limited for user ${msg.userId}`);
        await this.aggregation.onNotificationSent(msg.type, 'FCM', 'SUPPRESSED');
        return { status: 'SUPPRESSED' };
      }
    }

    // 3. Resolve FCM tokens — use provided tokens or look up from centralized device store
    let tokens = msg.fcmTokens ?? [];
    if (!tokens.length) {
      tokens = await this.deviceService.getActiveTokens(msg.userId);
    }
    if (!tokens.length) {
      this.logger.debug(`No active FCM tokens for user ${msg.userId} — skipping`);
      await this.aggregation.onNotificationSent(msg.type, 'FCM', 'SUPPRESSED');
      return { status: 'SUPPRESSED' };
    }

    // 4. Send FCM
    let status: 'SENT' | 'FAILED' = 'SENT';
    let fcmMessageId: string | undefined;
    let errorMessage: string | undefined;

    const result = await this.fcm
      .send(tokens, {
        title: msg.title,
        body: msg.body,
        data: msg.data,
        imageUrl: msg.imageUrl,
        priority: msg.priority ?? 'high',
      })
      .catch((err: Error) => {
        status = 'FAILED';
        errorMessage = err.message;
        return null;
      });

    if (result && result.sent > 0) {
      status = 'SENT';
    } else if (result?.sent === 0) {
      status = 'FAILED';
    }

    // 5. Handle stale tokens
    if (result?.staleTokens.length) {
      // Mark stale in Notification Service's own device store
      await this.deviceService.markTokensStale(result.staleTokens);

      // Notify Mobile API so it can clean up its user_devices table too
      await this.rabbitMQ
        .publish(FCM_CLEANUP_QUEUE, {
          routingKey: 'device.token_stale',
          fcmTokens: result.staleTokens,
        })
        .catch(() => null);
    }

    // Update lastUsedAt for successfully delivered tokens
    if (result?.sent && result.sent > 0) {
      const sentTokens = tokens.filter((t) => !result.staleTokens.includes(t));
      await this.deviceService.updateLastUsed(sentTokens).catch(() => null);
    }

    // 6. Log to DB
    const log = await this.prisma.notificationLog
      .create({
        data: {
          userId: msg.userId,
          sessionId: msg.sessionId,
          stationId: msg.stationId,
          chargerIdentity: msg.chargerIdentity,
          channel: 'FCM',
          type: msg.type,
          title: msg.title,
          body: msg.body,
          payload: msg as unknown as Prisma.InputJsonValue,
          status,
          fcmMessageId,
          errorMessage,
          retryCount: 0,
        },
      })
      .catch((err) => {
        this.logger.error(`Failed to log notification: ${err.message}`);
        return null;
      });

    // 7. Update aggregated stats
    await this.aggregation.onNotificationSent(msg.type, 'FCM', status);

    // 8. Emit to admin dashboard
    this.statsGateway.emitNotificationSent({
      type: msg.type,
      userId: msg.userId,
      stationId: msg.stationId,
      chargerIdentity: msg.chargerIdentity,
      status,
      sentAt: new Date().toISOString(),
    });

    return { status, notificationId: log?.id };
  }
}
