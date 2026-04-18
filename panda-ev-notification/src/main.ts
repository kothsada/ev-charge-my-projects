import 'dotenv/config';
// Must be set before any Date construction so Node.js local-time methods reflect Vientiane (UTC+7)
process.env.TZ = 'Asia/Vientiane';

// BigInt fields (e.g. revenue/amount LAK columns from Prisma BigInt) are not JSON-serializable
// by default. Serialize them as strings so Express res.json() never throws.
(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function () {
  return this.toString();
};

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { RedisService } from './configs/redis/redis.service';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { TimeoutInterceptor } from './common/interceptors/timeout.interceptor';
import { GlobalExceptionFilter } from './common/filters/http-exception.filter';
import { IoAdapter } from '@nestjs/platform-socket.io';

async function bootstrap() {
  const logger = new Logger('bootstrap');
  try {
    const app = await NestFactory.create(AppModule);

    app.useWebSocketAdapter(new IoAdapter(app));
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    app.useGlobalInterceptors(new TimeoutInterceptor(), new ResponseInterceptor());
    app.useGlobalFilters(new GlobalExceptionFilter());
    app.setGlobalPrefix('api/notification', { exclude: ['/', 'health'] });
    app.enableCors({ origin: '*', methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS', credentials: true });

    if (process.env.NODE_ENV === 'development' || process.env.SWAGGER_ENABLED === 'true') {
      const config = new DocumentBuilder()
        .setTitle('Panda EV Notification Service')
        .setDescription(
          'Push notification, delivery tracking, and real-time stats aggregation',
        )
        .setVersion('1.0')
        .addBearerAuth()
        .build();
      const doc = SwaggerModule.createDocument(app, config);
      SwaggerModule.setup('api/notification/docs', app, doc);
      logger.log(
        `Swagger: http://localhost:${process.env.PORT ?? 5001}/api/notification/docs`,
      );
    }

    const redisService = app.get(RedisService);
    const isRedisConnected = await redisService.testConnection();
    if (!isRedisConnected) {
      logger.error('Failed to connect to Redis. Application startup aborted.');
      process.exit(1);
    }

    const port = process.env.PORT ?? 5001;
    await app.listen(port, '0.0.0.0');
    logger.log(`Notification service running on port ${port}`);
  } catch (error) {
    logger.error('Failed to start notification service', error);
    process.exit(1);
  }
}

void bootstrap();
