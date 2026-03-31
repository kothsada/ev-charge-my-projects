import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';

// Infrastructure (Global)
import { PrismaModule } from './configs/prisma/prisma.module';
import { RedisModule } from './configs/redis/redis.module';
import { ServiceAuthModule } from './common/service-auth/service-auth.module';
import { RabbitMQModule } from './configs/rabbitmq/rabbitmq.module';

// Features
import { HealthModule } from './modules/health/health.module';
import { FcmModule } from './modules/fcm/fcm.module';
import { DedupModule } from './modules/dedup/dedup.module';
import { RateLimitModule } from './modules/rate-limit/rate-limit.module';
import { TemplateModule } from './modules/template/template.module';
import { AggregationModule } from './modules/aggregation/aggregation.module';
import { AdminStatsModule } from './modules/websocket/admin-stats.module';
import { NotificationModule } from './modules/notification/notification.module';
import { DeviceModule } from './modules/device/device.module';

@Module({
  imports: [
    // Infrastructure (Global — order matters: ServiceAuthModule before RabbitMQModule)
    PrismaModule,
    RedisModule,
    ServiceAuthModule,
    RabbitMQModule,
    ScheduleModule.forRoot(),

    // Features
    HealthModule,
    FcmModule,
    DedupModule,
    RateLimitModule,
    TemplateModule,
    AggregationModule,
    AdminStatsModule,
    DeviceModule,
    NotificationModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
