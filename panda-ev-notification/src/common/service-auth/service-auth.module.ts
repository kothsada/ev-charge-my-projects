import { Global, Module } from '@nestjs/common';
import { ServiceJwtService } from './service-jwt.service';
import { RedisModule } from '../../configs/redis/redis.module';

@Global()
@Module({
  imports: [RedisModule],
  providers: [ServiceJwtService],
  exports: [ServiceJwtService],
})
export class ServiceAuthModule {}
