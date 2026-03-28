import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import * as amqp from 'amqplib';
import { ServiceJwtService } from '../../common/service-auth/service-jwt.service';

@Injectable()
export class RabbitMQService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RabbitMQService.name);
  private connection: amqp.ChannelModel | null = null;
  private channel: amqp.Channel | null = null;
  private consumerChannel: amqp.Channel | null = null;
  private isConnectedFlag = false;

  constructor(private readonly serviceJwt: ServiceJwtService) {}

  private readonly NOTIFICATIONS_QUEUE =
    process.env.RABBITMQ_NOTIFICATIONS_QUEUE ?? 'PANDA_EV_NOTIFICATIONS';
  private readonly NOTIFICATIONS_DLQ =
    process.env.RABBITMQ_NOTIFICATIONS_DLQ ?? 'PANDA_EV_NOTIFICATIONS_DLQ';
  private readonly NOTIFICATIONS_DLX =
    process.env.RABBITMQ_NOTIFICATIONS_DLX ?? 'PANDA_EV_NOTIFICATIONS_DLX';

  private reconnectAttempt = 0;
  private isDestroyed = false;

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
      this.connection = await amqp.connect(url);
      this.channel = await this.connection.createChannel();
      this.consumerChannel = await this.connection.createChannel();

      this.connection.on('error', (err: Error) => {
        this.logger.error(`RabbitMQ connection error: ${err.message}`);
        this.isConnectedFlag = false;
      });

      this.connection.on('close', () => {
        this.logger.warn('RabbitMQ connection closed');
        this.isConnectedFlag = false;
        this.connection = null;
        this.channel = null;
        this.consumerChannel = null;
        if (!this.isDestroyed) {
          void this.scheduleReconnect();
        }
      });

      await this.setupDlxAndQueues();

      this.isConnectedFlag = true;
      this.logger.log('RabbitMQ connected successfully');
    } catch (error) {
      this.logger.warn(`RabbitMQ connection failed (soft-fail): ${(error as Error).message}`);
      this.isConnectedFlag = false;
      if (!this.isDestroyed) {
        void this.scheduleReconnect();
      }
    }
  }

  private async scheduleReconnect(): Promise<void> {
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempt), 30_000);
    this.reconnectAttempt++;
    this.logger.warn(`RabbitMQ reconnecting in ${delay}ms (attempt ${this.reconnectAttempt})`);
    setTimeout(() => { void this.connect(); }, delay);
  }

  private async setupDlxAndQueues(): Promise<void> {
    if (!this.channel) return;

    // Assert DLX exchange (fanout)
    await this.channel.assertExchange(this.NOTIFICATIONS_DLX, 'fanout', { durable: true });

    // Assert DLQ and bind to DLX
    await this.channel.assertQueue(this.NOTIFICATIONS_DLQ, { durable: true });
    await this.channel.bindQueue(this.NOTIFICATIONS_DLQ, this.NOTIFICATIONS_DLX, '');

    // Assert main notifications queue with DLX args
    await this.channel.assertQueue(this.NOTIFICATIONS_QUEUE, {
      durable: true,
      arguments: {
        'x-dead-letter-exchange': this.NOTIFICATIONS_DLX,
      },
    });

    this.logger.log('RabbitMQ queues and DLX configured');
  }

  private async disconnect(): Promise<void> {
    try {
      await this.channel?.close();
      await this.consumerChannel?.close();
      await this.connection?.close();
    } catch {
      // ignore cleanup errors
    }
  }

  async publish(queue: string, message: object): Promise<void> {
    if (!this.channel) {
      this.logger.warn(`RabbitMQ not connected — dropping message to ${queue}`);
      return;
    }

    try {
      await this.channel.assertQueue(queue, { durable: true });
      const content = Buffer.from(JSON.stringify(message));
      this.channel.sendToQueue(queue, content, { persistent: true });
    } catch (error) {
      this.logger.error(`Failed to publish to ${queue}: ${(error as Error).message}`);
    }
  }

  async publishNotification(message: object): Promise<void> {
    await this.publish(this.NOTIFICATIONS_QUEUE, message);
  }

  async publishWithRetry(
    queue: string,
    message: object,
    retryCount: number,
    delayMs?: number,
  ): Promise<void> {
    if (!this.channel) {
      this.logger.warn(`RabbitMQ not connected — dropping retry message to ${queue}`);
      return;
    }

    if (delayMs && delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    try {
      await this.channel.assertQueue(queue, { durable: true });
      const content = Buffer.from(JSON.stringify(message));
      this.channel.sendToQueue(queue, content, {
        persistent: true,
        headers: { 'x-retry-count': retryCount },
      });
    } catch (error) {
      this.logger.error(`Failed to publish retry message to ${queue}: ${(error as Error).message}`);
    }
  }

  async publishToExchange(
    exchange: string,
    routingKey: string,
    message: object,
  ): Promise<void> {
    if (!this.channel) {
      this.logger.warn(`RabbitMQ not connected — dropping exchange message`);
      return;
    }

    try {
      const content = Buffer.from(JSON.stringify(message));
      this.channel.publish(exchange, routingKey, content, { persistent: true });
    } catch (error) {
      this.logger.error(
        `Failed to publish to exchange ${exchange}: ${(error as Error).message}`,
      );
    }
  }

  async consume(
    queue: string,
    handler: (msg: Record<string, unknown>) => Promise<void>,
  ): Promise<void> {
    if (!this.consumerChannel) {
      this.logger.warn(`RabbitMQ not connected — cannot consume from ${queue}`);
      return;
    }

    try {
      await this.consumerChannel.assertQueue(queue, { durable: true });
      await this.consumerChannel.prefetch(10);
      await this.consumerChannel.consume(queue, async (msg) => {
        if (!msg) return;

        // Verify service-to-service JWT
        const rawToken = msg.properties?.headers?.['x-service-token'] as string | undefined;
        const servicePayload = await this.serviceJwt.verify(rawToken);
        if (!servicePayload) {
          this.logger.warn(`Rejected unauthenticated message from queue "${queue}" — discarding`);
          this.consumerChannel?.nack(msg, false, false);
          return;
        }

        try {
          const content = JSON.parse(msg.content.toString()) as Record<string, unknown>;
          await handler(content);
          this.consumerChannel?.ack(msg);
        } catch (error) {
          this.logger.error(
            `Error processing message from ${queue}: ${(error as Error).message}`,
          );
          this.consumerChannel?.nack(msg, false, false);
        }
      });

      this.logger.log(`Consuming from queue (with service auth): ${queue}`);
    } catch (error) {
      this.logger.error(`Failed to set up consumer for ${queue}: ${(error as Error).message}`);
    }
  }

  async consumeWithDlq(
    queue: string,
    _dlq: string,
    dlx: string,
    handler: (msg: Record<string, unknown>) => Promise<void>,
    maxRetries = 3,
  ): Promise<void> {
    if (!this.consumerChannel) {
      this.logger.warn(`RabbitMQ not connected — cannot consume from ${queue} with DLQ`);
      return;
    }

    const RETRY_DELAYS = [5_000, 30_000, 120_000];

    try {
      await this.consumerChannel.consume(queue, async (msg) => {
        if (!msg) return;

        // Verify service-to-service JWT
        const rawToken = msg.properties?.headers?.['x-service-token'] as string | undefined;
        const servicePayload = await this.serviceJwt.verify(rawToken);
        if (!servicePayload) {
          this.logger.warn(`Rejected unauthenticated message from queue "${queue}" — discarding`);
          this.consumerChannel?.nack(msg, false, false);
          return;
        }

        let content: Record<string, unknown>;
        try {
          content = JSON.parse(msg.content.toString()) as Record<string, unknown>;
        } catch {
          this.logger.error(`Failed to parse message from ${queue} — acking to discard`);
          this.consumerChannel?.ack(msg);
          return;
        }

        try {
          await handler(content);
          this.consumerChannel?.ack(msg);
        } catch (error) {
          const retryCount = (msg.properties.headers?.['x-retry-count'] as number) ?? 0;

          if (retryCount < maxRetries) {
            const delayMs = RETRY_DELAYS[retryCount] ?? 120_000;
            this.logger.warn(
              `Message handler failed (retry ${retryCount + 1}/${maxRetries}), re-publishing with ${delayMs}ms delay: ${(error as Error).message}`,
            );

            this.consumerChannel?.ack(msg);
            await this.publishWithRetry(queue, content, retryCount + 1, delayMs);
          } else {
            this.logger.error(
              `Message failed after ${maxRetries} retries — dead lettering: ${(error as Error).message}`,
            );
            this.consumerChannel?.ack(msg);
            await this.publishToExchange(dlx, '', content);
          }
        }
      });

      this.logger.log(`Consuming from queue ${queue} with DLQ support (max retries: ${maxRetries})`);
    } catch (error) {
      this.logger.error(
        `Failed to set up DLQ consumer for ${queue}: ${(error as Error).message}`,
      );
    }
  }

  get connected(): boolean {
    return this.isConnectedFlag;
  }
}
