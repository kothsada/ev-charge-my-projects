import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import * as amqplib from 'amqplib';
import { ServiceJwtService } from '../../common/service-auth/service-jwt.service';

@Injectable()
export class RabbitMQService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RabbitMQService.name);
  private connection: amqplib.ChannelModel | null = null;
  private channel: amqplib.Channel | null = null;          // publisher channel
  private consumerChannel: amqplib.Channel | null = null;  // consumer channel
  private reconnectAttempt = 0;
  private isDestroyed = false;

  private readonly NOTIFICATIONS_QUEUE =
    process.env.RABBITMQ_NOTIFICATIONS_QUEUE ?? 'PANDA_EV_NOTIFICATIONS';
  private readonly NOTIFICATIONS_DLQ =
    process.env.RABBITMQ_NOTIFICATIONS_DLQ ?? 'PANDA_EV_NOTIFICATIONS_DLQ';
  private readonly NOTIFICATIONS_DLX =
    process.env.RABBITMQ_NOTIFICATIONS_DLX ?? 'PANDA_EV_NOTIFICATIONS_DLX';

  private readonly SMS_QUEUE = process.env.RABBITMQ_SMS_QUEUE ?? 'PANDA_EV_SMS';
  private readonly SMS_DLQ = process.env.RABBITMQ_SMS_DLQ ?? 'PANDA_EV_SMS_DLQ';
  private readonly SMS_DLX = process.env.RABBITMQ_SMS_DLX ?? 'PANDA_EV_SMS_DLX';

  /** Queues already asserted on the publish channel — cleared on reconnect. */
  private readonly assertedQueues = new Set<string>();

  /** Registered consumers tracked for reconnect replay. */
  private readonly consumers: Array<{
    queue: string;
    handler: (payload: Record<string, unknown>) => Promise<void>;
    withDlq?: { dlq: string; dlx: string; maxRetries: number };
  }> = [];

  constructor(private readonly serviceJwt: ServiceJwtService) {}

  async onModuleInit() {
    await this.connect();
  }

  async onModuleDestroy() {
    this.isDestroyed = true;
    await this.disconnect();
  }

  private async connect(): Promise<void> {
    const url = process.env.RABBITMQ_URL;
    if (!url) {
      this.logger.warn('RABBITMQ_URL not set — RabbitMQ integration disabled');
      return;
    }

    try {
      this.connection = await amqplib.connect(url);
      this.channel = await this.connection.createChannel();
      this.consumerChannel = await this.connection.createChannel();
      await this.consumerChannel.prefetch(10);
      this.reconnectAttempt = 0;

      this.logger.log(
        `RabbitMQ connected — ${url.replace(/:\/\/[^@]+@/, '://**:**@')}`,
      );

      this.connection.on('error', (err: Error) => {
        this.logger.error(`RabbitMQ connection error: ${err.message}`);
      });

      this.connection.on('close', () => {
        this.logger.warn('RabbitMQ connection closed');
        this.connection = null;
        this.channel = null;
        this.consumerChannel = null;
        this.assertedQueues.clear();
        if (!this.isDestroyed) {
          void this.scheduleReconnect();
        }
      });

      await this.setupDlxAndQueues();

      // Replay all registered consumers after reconnect
      for (const c of this.consumers) {
        if (c.withDlq) {
          await this.startDlqConsumer(
            c.queue,
            c.withDlq.dlq,
            c.withDlq.dlx,
            c.handler,
            c.withDlq.maxRetries,
          );
        } else {
          await this.startConsumer(c.queue, c.handler);
        }
      }

      this.logger.log('RabbitMQ queues and consumers ready');
    } catch (error) {
      this.logger.warn(
        `RabbitMQ connection failed (soft-fail): ${(error as Error).message}`,
      );
      this.connection = null;
      this.channel = null;
      this.consumerChannel = null;
      if (!this.isDestroyed) {
        void this.scheduleReconnect();
      }
    }
  }

  private scheduleReconnect(): void {
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempt), 30_000);
    this.reconnectAttempt++;
    this.logger.warn(
      `RabbitMQ reconnecting in ${delay}ms (attempt ${this.reconnectAttempt})`,
    );
    setTimeout(() => {
      void this.connect();
    }, delay);
  }

  private async setupDlxAndQueues(): Promise<void> {
    if (!this.channel) return;

    // Notifications DLX + DLQ + main queue
    await this.channel.assertExchange(this.NOTIFICATIONS_DLX, 'fanout', {
      durable: true,
    });
    await this.channel.assertQueue(this.NOTIFICATIONS_DLQ, { durable: true });
    await this.channel.bindQueue(
      this.NOTIFICATIONS_DLQ,
      this.NOTIFICATIONS_DLX,
      '',
    );
    await this.channel.assertQueue(this.NOTIFICATIONS_QUEUE, {
      durable: true,
      arguments: { 'x-dead-letter-exchange': this.NOTIFICATIONS_DLX },
    });
    this.assertedQueues.add(this.NOTIFICATIONS_QUEUE);

    // SMS DLX + DLQ + main queue
    await this.channel.assertExchange(this.SMS_DLX, 'fanout', {
      durable: true,
    });
    await this.channel.assertQueue(this.SMS_DLQ, { durable: true });
    await this.channel.bindQueue(this.SMS_DLQ, this.SMS_DLX, '');
    await this.channel.assertQueue(this.SMS_QUEUE, {
      durable: true,
      arguments: { 'x-dead-letter-exchange': this.SMS_DLX },
    });
    this.assertedQueues.add(this.SMS_QUEUE);

    this.logger.log('RabbitMQ DLX/DLQ topology configured');
  }

  private async disconnect(): Promise<void> {
    try {
      await this.channel?.close();
      await this.consumerChannel?.close();
      await this.connection?.close();
    } catch {
      // ignore cleanup errors on shutdown
    }
  }

  // ─── Publish ──────────────────────────────────────────────────────────────

  /**
   * Publish a JSON message to a queue with an RS256 service token header.
   * Silently skips when RabbitMQ is unavailable.
   */
  async publish(queue: string, message: object): Promise<void> {
    if (!this.channel) {
      this.logger.warn(
        `RabbitMQ not connected — dropping message to ${queue}`,
      );
      return;
    }

    try {
      if (!this.assertedQueues.has(queue)) {
        const queueOptions =
          queue === this.NOTIFICATIONS_QUEUE
            ? {
                durable: true,
                arguments: { 'x-dead-letter-exchange': this.NOTIFICATIONS_DLX },
              }
            : queue === this.SMS_QUEUE
              ? {
                  durable: true,
                  arguments: { 'x-dead-letter-exchange': this.SMS_DLX },
                }
              : { durable: true };
        await this.channel.assertQueue(queue, queueOptions);
        this.assertedQueues.add(queue);
      }

      const serviceToken = this.serviceJwt.sign(queue);
      const headers: Record<string, string> = {};
      if (serviceToken) {
        headers['x-service-token'] = serviceToken;
      } else {
        this.logger.warn(
          `Publishing to "${queue}" without a service token — SERVICE_JWT_PRIVATE_KEY not set`,
        );
      }

      this.channel.sendToQueue(queue, Buffer.from(JSON.stringify(message)), {
        persistent: true,
        contentType: 'application/json',
        headers,
      });
    } catch (error) {
      this.logger.error(
        `Failed to publish to ${queue}: ${(error as Error).message}`,
      );
    }
  }

  async publishNotification(message: object): Promise<void> {
    await this.publish(this.NOTIFICATIONS_QUEUE, message);
  }

  async publishToExchange(
    exchange: string,
    routingKey: string,
    message: object,
  ): Promise<void> {
    if (!this.channel) {
      this.logger.warn('RabbitMQ not connected — dropping exchange message');
      return;
    }

    try {
      this.channel.publish(
        exchange,
        routingKey,
        Buffer.from(JSON.stringify(message)),
        { persistent: true },
      );
    } catch (error) {
      this.logger.error(
        `Failed to publish to exchange ${exchange}: ${(error as Error).message}`,
      );
    }
  }

  // ─── Consume ──────────────────────────────────────────────────────────────

  /**
   * Subscribe to a queue with service-auth verification.
   * Registered consumers are stored and replayed after reconnect.
   * Safe to call before connection is established.
   */
  consume(
    queue: string,
    handler: (payload: Record<string, unknown>) => Promise<void>,
  ): void {
    if (!this.consumers.some((c) => c.queue === queue && !c.withDlq)) {
      this.consumers.push({ queue, handler });
    }
    if (this.consumerChannel) {
      void this.startConsumer(queue, handler);
    }
  }

  private async startConsumer(
    queue: string,
    handler: (payload: Record<string, unknown>) => Promise<void>,
  ): Promise<void> {
    if (!this.consumerChannel) return;

    try {
      await this.consumerChannel.assertQueue(queue, { durable: true });

      await this.consumerChannel.consume(queue, (msg) => {
        void (async () => {
          if (!msg) return;

          const rawToken = msg.properties?.headers?.['x-service-token'] as
            | string
            | undefined;
          const servicePayload = await this.serviceJwt.verify(rawToken);
          if (!servicePayload) {
            this.logger.warn(
              `Rejected unauthenticated message from queue "${queue}" — discarding`,
            );
            this.consumerChannel?.nack(msg, false, false);
            return;
          }

          try {
            const payload = JSON.parse(
              msg.content.toString(),
            ) as Record<string, unknown>;
            await handler(payload);
            this.consumerChannel?.ack(msg);
          } catch (error) {
            this.logger.error(
              `Error processing message from "${queue}": ${(error as Error).message}`,
            );
            this.consumerChannel?.nack(msg, false, false);
          }
        })();
      });

      this.logger.log(`Consuming queue (with service auth): ${queue}`);
    } catch (error) {
      this.logger.error(
        `Failed to set up consumer for "${queue}": ${(error as Error).message}`,
      );
    }
  }

  /**
   * Subscribe to a queue with DLQ retry support (3 retries: 5s / 30s / 120s).
   * Consumers are stored and replayed after reconnect.
   */
  consumeWithDlq(
    queue: string,
    dlq: string,
    dlx: string,
    handler: (payload: Record<string, unknown>) => Promise<void>,
    maxRetries = 3,
  ): void {
    if (!this.consumers.some((c) => c.queue === queue && c.withDlq)) {
      this.consumers.push({ queue, handler, withDlq: { dlq, dlx, maxRetries } });
    }
    if (this.consumerChannel) {
      void this.startDlqConsumer(queue, dlq, dlx, handler, maxRetries);
    }
  }

  private async startDlqConsumer(
    queue: string,
    _dlq: string,
    dlx: string,
    handler: (payload: Record<string, unknown>) => Promise<void>,
    maxRetries: number,
  ): Promise<void> {
    if (!this.consumerChannel) return;

    const RETRY_DELAYS = [5_000, 30_000, 120_000];

    try {
      await this.consumerChannel.consume(queue, (msg) => {
        void (async () => {
          if (!msg) return;

          const rawToken = msg.properties?.headers?.['x-service-token'] as
            | string
            | undefined;
          const servicePayload = await this.serviceJwt.verify(rawToken);
          if (!servicePayload) {
            this.logger.warn(
              `Rejected unauthenticated message from queue "${queue}" — discarding`,
            );
            this.consumerChannel?.nack(msg, false, false);
            return;
          }

          let content: Record<string, unknown>;
          try {
            content = JSON.parse(
              msg.content.toString(),
            ) as Record<string, unknown>;
          } catch {
            this.logger.error(
              `Failed to parse message from "${queue}" — acking to discard`,
            );
            this.consumerChannel?.ack(msg);
            return;
          }

          try {
            await handler(content);
            this.consumerChannel?.ack(msg);
          } catch (error) {
            const retryCount =
              (msg.properties.headers?.['x-retry-count'] as number) ?? 0;

            if (retryCount < maxRetries) {
              const delayMs = RETRY_DELAYS[retryCount] ?? 120_000;
              this.logger.warn(
                `Handler failed (retry ${retryCount + 1}/${maxRetries}), re-publishing in ${delayMs}ms: ${(error as Error).message}`,
              );
              this.consumerChannel?.ack(msg);
              setTimeout(() => {
                void this.publishWithRetryHeader(queue, content, retryCount + 1);
              }, delayMs);
            } else {
              this.logger.error(
                `Message failed after ${maxRetries} retries — dead-lettering: ${(error as Error).message}`,
              );
              this.consumerChannel?.ack(msg);
              await this.publishToExchange(dlx, '', content);
            }
          }
        })();
      });

      this.logger.log(
        `Consuming queue "${queue}" with DLQ support (max retries: ${maxRetries})`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to set up DLQ consumer for "${queue}": ${(error as Error).message}`,
      );
    }
  }

  private async publishWithRetryHeader(
    queue: string,
    message: object,
    retryCount: number,
  ): Promise<void> {
    if (!this.channel) return;

    try {
      const queueOptions =
        queue === this.NOTIFICATIONS_QUEUE
          ? {
              durable: true,
              arguments: { 'x-dead-letter-exchange': this.NOTIFICATIONS_DLX },
            }
          : queue === this.SMS_QUEUE
            ? {
                durable: true,
                arguments: { 'x-dead-letter-exchange': this.SMS_DLX },
              }
            : { durable: true };

      if (!this.assertedQueues.has(queue)) {
        await this.channel.assertQueue(queue, queueOptions);
        this.assertedQueues.add(queue);
      }

      const serviceToken = this.serviceJwt.sign(queue);
      this.channel.sendToQueue(
        queue,
        Buffer.from(JSON.stringify(message)),
        {
          persistent: true,
          contentType: 'application/json',
          headers: {
            'x-retry-count': retryCount,
            ...(serviceToken ? { 'x-service-token': serviceToken } : {}),
          },
        },
      );
    } catch (error) {
      this.logger.error(
        `Failed to re-publish retry message to "${queue}": ${(error as Error).message}`,
      );
    }
  }

  // ─── Status ───────────────────────────────────────────────────────────────

  /** Returns true when both publish and consumer channels are open. */
  get isConnected(): boolean {
    return this.channel !== null && this.consumerChannel !== null;
  }

  /** Alias used by health controller. */
  testConnection(): boolean {
    return this.isConnected;
  }
}
