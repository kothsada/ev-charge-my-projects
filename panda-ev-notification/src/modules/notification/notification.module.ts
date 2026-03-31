import { Module } from '@nestjs/common';
import { FcmModule } from '../fcm/fcm.module';
import { AdminStatsModule } from '../websocket/admin-stats.module';
import { AggregationModule } from '../aggregation/aggregation.module';
import { DeviceModule } from '../device/device.module';
import { NotificationProcessor } from './notification.processor';
import { NotificationRouter } from './notification.router';
import { NotificationController } from './notification.controller';

@Module({
  imports: [FcmModule, AdminStatsModule, AggregationModule, DeviceModule],
  providers: [NotificationProcessor, NotificationRouter],
  controllers: [NotificationController],
  exports: [NotificationProcessor],
})
export class NotificationModule {}
