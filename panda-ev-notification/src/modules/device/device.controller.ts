import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { DeviceService } from './device.service';
import { RegisterDeviceDto, UnregisterDeviceDto } from './dto/device.dto';
import { t } from '../../common/i18n';
import {
  ApiSuccessResponse,
  ApiMessageResponse,
  ApiInternalErrorResponse,
  ApiValidationResponse,
} from '../../common/decorators';

/**
 * Internal device management API — not exposed through public ingress.
 * Called by peer services (Mobile API) via service-to-service HTTP or
 * consumed automatically through RabbitMQ device.registered / device.unregistered events.
 */
@ApiTags('Devices (Internal)')
@Controller('v1/devices')
export class DeviceController {
  constructor(private readonly deviceService: DeviceService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Register or update an FCM token for a user',
    description: 'Upserts a `user_fcm_devices` record. Safe to call on every app open — idempotent.',
  })
  @ApiSuccessResponse(200, 'Device registered', { registered: true })
  @ApiValidationResponse()
  @ApiInternalErrorResponse()
  async register(@Body() dto: RegisterDeviceDto) {
    await this.deviceService.registerToken(
      dto.userId,
      dto.fcmToken,
      dto.platform,
      dto.appVersion,
    );
    return { registered: true, message: t('device.registered') };
  }

  @Delete()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Deactivate an FCM token (logout)',
    description: 'Sets `isActive=false` on the matching token record. Does not delete — allows audit trail.',
  })
  @ApiMessageResponse('Device unregistered')
  @ApiInternalErrorResponse()
  async unregister(@Body() dto: UnregisterDeviceDto) {
    await this.deviceService.unregisterToken(dto.fcmToken);
    return { unregistered: true, message: t('device.unregistered') };
  }

  @Get(':userId')
  @ApiOperation({ summary: 'List devices for a user (active + inactive)' })
  @ApiParam({ name: 'userId', description: 'User UUID' })
  @ApiSuccessResponse(200, 'Devices retrieved', [
    {
      id: 'uuid',
      platform: 'android',
      appVersion: '1.2.3',
      isActive: true,
      lastUsedAt: '2026-06-16T08:00:00+07:00',
      registeredAt: '2026-01-01T00:00:00+07:00',
      tokenPreview: 'dGhpcyBpcyBhIHNhb…',
    },
  ])
  @ApiInternalErrorResponse()
  async list(@Param('userId') userId: string) {
    const devices = await this.deviceService.listDevices(userId);
    return devices.map((d) => ({
      id: d.id,
      platform: d.platform,
      appVersion: d.appVersion,
      isActive: d.isActive,
      lastUsedAt: d.lastUsedAt,
      registeredAt: d.createdAt,
      tokenPreview: `${d.fcmToken.slice(0, 20)}…`,
    }));
  }
}
