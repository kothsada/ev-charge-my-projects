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
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { DeviceService } from './device.service';
import { RegisterDeviceDto, UnregisterDeviceDto } from './dto/device.dto';
import { t } from '../../common/i18n';

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
  @ApiOperation({ summary: 'Register or update an FCM token for a user' })
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
  @ApiOperation({ summary: 'Deactivate an FCM token (logout)' })
  async unregister(@Body() dto: UnregisterDeviceDto) {
    await this.deviceService.unregisterToken(dto.fcmToken);
    return { unregistered: true, message: t('device.unregistered') };
  }

  @Get(':userId')
  @ApiOperation({ summary: 'List devices for a user (active + inactive)' })
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
