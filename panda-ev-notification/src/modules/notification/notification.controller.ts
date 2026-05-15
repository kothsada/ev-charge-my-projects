import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { NotificationProcessor } from './notification.processor';
import { PrismaService } from '../../configs/prisma/prisma.service';
import { SendNotificationDto } from './dto/send-notification.dto';
import { nowBangkokIso, parseVientianeDate } from '../../common/helpers/date.helper';
import { t } from '../../common/i18n';

class NotificationHistoryQuery {
  @ApiPropertyOptional({ description: 'Filter by user ID' })
  @IsOptional()
  @IsUUID()
  userId?: string;

  @ApiPropertyOptional({ description: 'Page number', default: 1 })
  @IsOptional()
  @Type(() => Number)
  page?: number = 1;

  @ApiPropertyOptional({ description: 'Items per page', default: 20 })
  @IsOptional()
  @Type(() => Number)
  limit?: number = 20;

  @ApiPropertyOptional({ description: 'Filter by status' })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ description: 'Filter by type' })
  @IsOptional()
  @IsString()
  type?: string;

  @ApiPropertyOptional({ description: 'Filter from this date (Asia/Vientiane). Format: YYYY-MM-DD', example: '2026-01-01' })
  @IsOptional()
  @IsString()
  from?: string;

  @ApiPropertyOptional({ description: 'Filter until this date (Asia/Vientiane). Format: YYYY-MM-DD', example: '2026-12-31' })
  @IsOptional()
  @IsString()
  to?: string;
}

class UpdateStatusDto {
  @ApiProperty({ enum: ['DELIVERED', 'READ', 'CLICKED'] })
  @IsEnum(['DELIVERED', 'READ', 'CLICKED'])
  status: 'DELIVERED' | 'READ' | 'CLICKED';
}

class DailyStatsQuery {
  @ApiPropertyOptional({ description: 'Filter from this date (Asia/Vientiane). Format: YYYY-MM-DD', example: '2026-01-01' })
  @IsOptional()
  @IsString()
  from?: string;

  @ApiPropertyOptional({ description: 'Filter until this date (Asia/Vientiane). Format: YYYY-MM-DD', example: '2026-12-31' })
  @IsOptional()
  @IsString()
  to?: string;

  @ApiPropertyOptional({ description: 'Filter by notification type' })
  @IsOptional()
  @IsString()
  type?: string;
}

class StationStatsQuery {
  @ApiPropertyOptional({ description: 'Filter by station ID' })
  @IsOptional()
  @IsUUID()
  stationId?: string;

  @ApiPropertyOptional({ description: 'Filter from this date (Asia/Vientiane). Format: YYYY-MM-DD', example: '2026-01-01' })
  @IsOptional()
  @IsString()
  from?: string;

  @ApiPropertyOptional({ description: 'Filter until this date (Asia/Vientiane). Format: YYYY-MM-DD', example: '2026-12-31' })
  @IsOptional()
  @IsString()
  to?: string;
}

@ApiTags('Notifications')
@ApiBearerAuth()
@Controller('v1/notifications')
export class NotificationController {
  constructor(
    private readonly processor: NotificationProcessor,
    private readonly prisma: PrismaService,
  ) {}

  @Post('send')
  @ApiOperation({ summary: 'Send a targeted notification' })
  async send(@Body() dto: SendNotificationDto) {
    const result = await this.processor.process(dto);
    return result;
  }

  @Get('history')
  @ApiOperation({ summary: 'Get notification history with pagination' })
  async getHistory(@Query() query: NotificationHistoryQuery) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {};
    if (query.userId) where.userId = query.userId;
    if (query.status) where.status = query.status;
    if (query.type) where.type = query.type;
    if (query.from || query.to) {
      where.sentAt = {};
      if (query.from) (where.sentAt as Record<string, Date>).gte = parseVientianeDate(query.from);
      if (query.to) (where.sentAt as Record<string, Date>).lte = parseVientianeDate(query.to, true);
    }

    const [data, total] = await Promise.all([
      this.prisma.notificationLog.findMany({
        where,
        orderBy: { sentAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.notificationLog.count({ where }),
    ]);

    return {
      success: true,
      statusCode: 200,
      data,
      message: t('notification.history_retrieved'),
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
      timestamp: nowBangkokIso(),
    };
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Update notification delivery status' })
  async updateStatus(@Param('id') id: string, @Body() dto: UpdateStatusDto) {
    const updateData: Record<string, unknown> = { status: dto.status };
    const ts = new Date();

    if (dto.status === 'DELIVERED') updateData.deliveredAt = ts;
    if (dto.status === 'READ') updateData.readAt = ts;
    if (dto.status === 'CLICKED') updateData.clickedAt = ts;

    const updated = await this.prisma.notificationLog.update({
      where: { id },
      data: updateData,
    });

    return updated;
  }

  @Get('stats/daily')
  @ApiOperation({ summary: 'Get pre-aggregated daily notification stats' })
  async getDailyStats(@Query() query: DailyStatsQuery) {
    const where: Record<string, unknown> = {};
    if (query.type) where.type = query.type;
    if (query.from || query.to) {
      where.date = {};
      if (query.from) (where.date as Record<string, Date>).gte = parseVientianeDate(query.from);
      if (query.to) (where.date as Record<string, Date>).lte = parseVientianeDate(query.to, true);
    }

    const stats = await this.prisma.notificationDailyStat.findMany({
      where,
      orderBy: { date: 'desc' },
    });

    return stats;
  }

  @Get('stats/stations')
  @ApiOperation({ summary: 'Get pre-aggregated daily station stats' })
  async getStationStats(@Query() query: StationStatsQuery) {
    const where: Record<string, unknown> = {};
    if (query.stationId) where.stationId = query.stationId;
    if (query.from || query.to) {
      where.date = {};
      if (query.from) (where.date as Record<string, Date>).gte = parseVientianeDate(query.from);
      if (query.to) (where.date as Record<string, Date>).lte = parseVientianeDate(query.to, true);
    }

    const stats = await this.prisma.stationDailyStat.findMany({
      where,
      orderBy: { date: 'desc' },
    });

    return stats;
  }
}
