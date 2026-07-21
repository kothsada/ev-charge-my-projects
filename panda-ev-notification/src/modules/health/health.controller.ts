import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { ApiSuccessResponse } from '../../common/decorators';

@ApiTags('Health')
@Controller()
export class HealthController {
  @Get('/health')
  @ApiOperation({ summary: 'Liveness probe' })
  @ApiSuccessResponse(200, 'Service is healthy', {
    status: 'ok',
    service: 'notification-api',
    timestamp: '2026-06-16T10:00:00.000Z',
  })
  check() {
    return {
      status: 'ok',
      service: 'notification-api',
      timestamp: new Date().toISOString(),
    };
  }
}
