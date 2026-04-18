import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../configs/prisma/prisma.service';
import { SmsType, SmsNetworkType } from '../../../generated/prisma/client';
import { startOfDay } from '../../common/helpers/date.helper';

interface SmsSentEvent {
  date: Date;
  networkType: 'ONNET' | 'OFFNET';
  costLak: number;
  smsType: SmsType;
  isSuccess: boolean;
  isNewRecipient: boolean;
}

@Injectable()
export class SmsAggregationService {
  private readonly logger = new Logger(SmsAggregationService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Auto-increment SMS daily stats on every send.
   * Uses ON CONFLICT DO UPDATE (atomic UPSERT) — no read-then-write pattern.
   */
  async onSmsSent(event: SmsSentEvent): Promise<void> {
    try {
      const day = startOfDay(event.date);
      const isOnnet = event.networkType === ('ONNET' as SmsNetworkType);
      const onnetCount = isOnnet ? 1 : 0;
      const onnetAmt = BigInt(isOnnet ? event.costLak : 0);
      const offnetCount = isOnnet ? 0 : 1;
      const offnetAmt = BigInt(isOnnet ? 0 : event.costLak);
      const successCount = event.isSuccess ? 1 : 0;
      const failCount = event.isSuccess ? 0 : 1;
      const otpCount = event.smsType === SmsType.OTP ? 1 : 0;
      const textCount = event.smsType === SmsType.TEXT ? 1 : 0;
      const newRecip = event.isNewRecipient ? 1 : 0;
      const totalAmt = BigInt(event.costLak);

      await this.prisma.$executeRaw`
        INSERT INTO panda_ev_noti.sms_daily_stats
          (id, date,
           onnet_count, onnet_amount_lak,
           offnet_count, offnet_amount_lak,
           total_count, total_amount_lak,
           success_count, fail_count,
           otp_count, text_count,
           unique_recipients)
        VALUES
          (gen_random_uuid(), ${day}::date,
           ${onnetCount}, ${onnetAmt},
           ${offnetCount}, ${offnetAmt},
           1, ${totalAmt},
           ${successCount}, ${failCount},
           ${otpCount}, ${textCount},
           ${newRecip})
        ON CONFLICT (date) DO UPDATE SET
          onnet_count       = sms_daily_stats.onnet_count       + ${onnetCount},
          onnet_amount_lak  = sms_daily_stats.onnet_amount_lak  + ${onnetAmt},
          offnet_count      = sms_daily_stats.offnet_count      + ${offnetCount},
          offnet_amount_lak = sms_daily_stats.offnet_amount_lak + ${offnetAmt},
          total_count       = sms_daily_stats.total_count       + 1,
          total_amount_lak  = sms_daily_stats.total_amount_lak  + ${totalAmt},
          success_count     = sms_daily_stats.success_count     + ${successCount},
          fail_count        = sms_daily_stats.fail_count        + ${failCount},
          otp_count         = sms_daily_stats.otp_count         + ${otpCount},
          text_count        = sms_daily_stats.text_count        + ${textCount},
          unique_recipients = sms_daily_stats.unique_recipients + ${newRecip}
      `;
    } catch (error) {
      this.logger.error(`SMS aggregation failed: ${(error as Error).message}`);
    }
  }
}
