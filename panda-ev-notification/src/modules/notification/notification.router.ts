import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { RabbitMQService } from '../../configs/rabbitmq/rabbitmq.service';
import { NotificationProcessor, ProcessNotificationDto } from './notification.processor';
import { AggregationService } from '../aggregation/aggregation.service';
import { AdminStatsGateway } from '../websocket/admin-stats.gateway';
import { DeviceService } from '../device/device.service';

@Injectable()
export class NotificationRouter implements OnModuleInit {
  private readonly logger = new Logger(NotificationRouter.name);

  constructor(
    private readonly rabbitMQ: RabbitMQService,
    private readonly processor: NotificationProcessor,
    private readonly aggregation: AggregationService,
    private readonly statsGateway: AdminStatsGateway,
    private readonly deviceService: DeviceService,
  ) {}

  async onModuleInit() {
    // 1. Main notifications queue (from Mobile/Admin)
    await this.rabbitMQ.consumeWithDlq(
      process.env.RABBITMQ_NOTIFICATIONS_QUEUE ?? 'PANDA_EV_NOTIFICATIONS',
      process.env.RABBITMQ_NOTIFICATIONS_DLQ ?? 'PANDA_EV_NOTIFICATIONS_DLQ',
      process.env.RABBITMQ_NOTIFICATIONS_DLX ?? 'PANDA_EV_NOTIFICATIONS_DLX',
      (msg) => this.handleNotificationMessage(msg),
    );

    // 2. OCPP events queue (for aggregation + live dashboard updates only)
    await this.rabbitMQ.consume(
      process.env.RABBITMQ_OCPP_EVENTS_QUEUE ?? 'PANDA_EV_QUEUE',
      (msg) => this.handleOcppEvent(msg),
    );
  }

  private async handleNotificationMessage(msg: Record<string, unknown>) {
    const routingKey = msg.routingKey as string;

    if (routingKey === 'notification.targeted' || routingKey === 'notification.session') {
      // Standard targeted notification — msg may include fcmTokens[] (backwards-compat)
      // or omit them to let the processor resolve tokens from user_fcm_devices by userId
      await this.processor.process(msg as unknown as ProcessNotificationDto);
    } else if (routingKey === 'notification.broadcast') {
      // Broadcast — skipDedup always true; fcmTokens provided by sender
      await this.processor.process({ ...(msg as unknown as ProcessNotificationDto), skipDedup: true });
    } else if (routingKey === 'notification.overstay_reminder') {
      await this.handleOverstayReminder(msg);
    } else if (routingKey === 'device.registered') {
      // Mobile API publishes this when a user registers a new FCM token
      await this.deviceService.registerToken(
        msg.userId as string,
        msg.fcmToken as string,
        msg.platform as string | undefined,
        msg.appVersion as string | undefined,
      );
    } else if (routingKey === 'device.unregistered') {
      // Mobile API publishes this when a user logs out / removes a device
      await this.deviceService.unregisterToken(msg.fcmToken as string);
    } else {
      this.logger.warn(`Unknown routingKey: ${routingKey}`);
    }
  }

  private async handleOcppEvent(msg: Record<string, unknown>) {
    const routingKey = msg.routingKey as string;

    if (routingKey === 'transaction.stopped') {
      const energyKwh = typeof msg.energyKwh === 'number' ? msg.energyKwh : 0;
      const amountLak = typeof msg.amountLak === 'number' ? msg.amountLak : 0;
      if (msg.stationId && msg.stationName) {
        await this.aggregation.onSessionCompleted({
          stationId: msg.stationId as string,
          stationName: msg.stationName as string,
          sessionId: msg.sessionId as string,
          userId: msg.userId as string,
          energyKwh,
          amountLak,
          durationMinutes: (msg.durationMinutes as number) ?? 0,
          completedAt: new Date((msg.stopTime as string) ?? Date.now()),
        });
        // Emit live update to admin dashboard
        this.statsGateway.emitSessionUpdate({ ...msg, event: 'session_completed' });
      }
    } else if (routingKey === 'transaction.started') {
      if (msg.stationId && msg.stationName) {
        await this.aggregation.onSessionStarted({
          stationId: msg.stationId as string,
          stationName: msg.stationName as string,
          startedAt: new Date((msg.startTime as string) ?? Date.now()),
        });
        this.statsGateway.emitSessionUpdate({ ...msg, event: 'session_started' });
      }
    }
    // Other events (charger.booted, connector.status_changed) are handled by Mobile service
  }

  private async handleOverstayReminder(msg: Record<string, unknown>) {
    const notifyAt = new Date(msg.notifyAt as string);
    const delay = notifyAt.getTime() - Date.now();

    // If not time yet, re-schedule
    if (delay > 3000) {
      await new Promise((r) => setTimeout(r, Math.min(delay, 30_000)));
      if (Date.now() < notifyAt.getTime() - 1000) {
        await this.rabbitMQ.publishNotification({ ...msg });
        return;
      }
    }

    // Check parking timer still active
    // (parking:timer key is in Mobile's Redis — we can't check it directly)
    // Trust Mobile to cancel if car moved. Just send if scheduled.
    await this.processor.process(msg as unknown as ProcessNotificationDto);
  }
}
