import { Module } from '@nestjs/common';
import { AdminStatsGateway } from './admin-stats.gateway';

@Module({
  providers: [AdminStatsGateway],
  exports: [AdminStatsGateway],
})
export class AdminStatsModule {}
