/**
 * SmsRouter — consumes the PANDA_EV_SMS queue.
 *
 * Published by: Mobile API (panda-ev-client-mobile) and OCPP CSMS (panda-ev-csms-system-admin).
 *
 * Message shape:
 * {
 *   routingKey: 'sms.otp' | 'sms.text',
 *   phoneNumber: string,      // e.g. "8562078559999" or "2078559999"
 *   message: string,
 *   header?: string,          // sender name override
 *   userId?: string,
 *   sessionId?: string,
 *   sourceService: string,    // 'mobile' | 'csms'
 * }
 */
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { RabbitMQService } from '../../configs/rabbitmq/rabbitmq.service';
import { SmsService } from './sms.service';
import { SmsTypeInput } from './dto/send-sms.dto';

@Injectable()
export class SmsRouter implements OnModuleInit {
  private readonly logger = new Logger(SmsRouter.name);

  private readonly SMS_QUEUE = process.env.RABBITMQ_SMS_QUEUE ?? 'PANDA_EV_SMS';
  private readonly SMS_DLQ = process.env.RABBITMQ_SMS_DLQ ?? 'PANDA_EV_SMS_DLQ';
  private readonly SMS_DLX = process.env.RABBITMQ_SMS_DLX ?? 'PANDA_EV_SMS_DLX';

  constructor(
    private readonly rabbitMQ: RabbitMQService,
    private readonly smsService: SmsService,
  ) {}

  async onModuleInit() {
    await this.rabbitMQ.consumeWithDlq(
      this.SMS_QUEUE,
      this.SMS_DLQ,
      this.SMS_DLX,
      (msg) => this.handleSmsMessage(msg),
    );
  }

  private async handleSmsMessage(msg: Record<string, unknown>): Promise<void> {
    const routingKey = msg.routingKey as string;

    if (routingKey === 'sms.otp' || routingKey === 'sms.text') {
      const phoneNumber = msg.phoneNumber as string;
      const message = msg.message as string;

      if (!phoneNumber || !message) {
        this.logger.warn(`Dropping SMS message — missing phoneNumber or message (key=${routingKey})`);
        return;
      }

      const smsType: SmsTypeInput =
        routingKey === 'sms.otp' ? SmsTypeInput.OTP : SmsTypeInput.TEXT;
      const sourceService = (msg.sourceService as string) ?? 'rabbitmq';

      await this.smsService.send(
        {
          phoneNumber,
          message,
          smsType,
          header: msg.header as string | undefined,
          userId: msg.userId as string | undefined,
          sessionId: msg.sessionId as string | undefined,
        },
        sourceService,
      );
    } else {
      this.logger.warn(`Unknown SMS routingKey: ${routingKey}`);
    }
  }
}
