import { Module } from '@nestjs/common';
import { SmsService } from './sms.service';
import { SmsAggregationService } from './sms.aggregation.service';
import { SmsRouter } from './sms.router';
import { SmsController } from './sms.controller';

@Module({
  providers: [SmsService, SmsAggregationService, SmsRouter],
  controllers: [SmsController],
  exports: [SmsService],
})
export class SmsModule {}
