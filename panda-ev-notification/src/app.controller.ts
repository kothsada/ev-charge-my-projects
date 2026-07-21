import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { AppService } from './app.service';
import { ApiSuccessResponse } from './common/decorators';

@ApiTags('App')
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get('/')
  @ApiOperation({ summary: 'Service info' })
  @ApiSuccessResponse(200, 'Service info', {
    service: 'panda-ev-notification',
    version: '1.0.0',
    status: 'running',
  })
  getStatus() {
    return this.appService.getStatus();
  }
}
