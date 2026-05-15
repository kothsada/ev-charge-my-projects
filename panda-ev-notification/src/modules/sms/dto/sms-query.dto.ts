import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { Type } from 'class-transformer';

enum SmsStatusFilter {
  PENDING = 'PENDING',
  SENT = 'SENT',
  DELIVERED = 'DELIVERED',
  FAILED = 'FAILED',
}

enum SmsNetworkFilter {
  ONNET = 'ONNET',
  OFFNET = 'OFFNET',
}

enum SmsTypeFilter {
  OTP = 'OTP',
  TEXT = 'TEXT',
}

export class SmsHistoryQueryDto {
  @ApiPropertyOptional({ description: 'Page number', default: 1, example: 1 })
  @IsOptional()
  @Type(() => Number)
  page?: number = 1;

  @ApiPropertyOptional({ description: 'Items per page', default: 20, example: 20 })
  @IsOptional()
  @Type(() => Number)
  limit?: number = 20;

  @ApiPropertyOptional({ enum: SmsStatusFilter })
  @IsOptional()
  @IsEnum(SmsStatusFilter)
  status?: SmsStatusFilter;

  @ApiPropertyOptional({ enum: SmsNetworkFilter })
  @IsOptional()
  @IsEnum(SmsNetworkFilter)
  networkType?: SmsNetworkFilter;

  @ApiPropertyOptional({ enum: SmsTypeFilter })
  @IsOptional()
  @IsEnum(SmsTypeFilter)
  smsType?: SmsTypeFilter;

  @ApiPropertyOptional({ description: 'Filter by user ID' })
  @IsOptional()
  @IsString()
  userId?: string;

  @ApiPropertyOptional({ description: 'Filter from this date (Asia/Vientiane). Format: YYYY-MM-DD', example: '2026-01-01' })
  @IsOptional()
  @IsString()
  startDate?: string;

  @ApiPropertyOptional({ description: 'Filter until this date (Asia/Vientiane). Format: YYYY-MM-DD', example: '2026-12-31' })
  @IsOptional()
  @IsString()
  endDate?: string;
}

export class SmsStatsQueryDto {
  @ApiPropertyOptional({ description: 'Filter from this date (Asia/Vientiane). Format: YYYY-MM-DD', example: '2026-01-01' })
  @IsOptional()
  @IsString()
  startDate?: string;

  @ApiPropertyOptional({ description: 'Filter until this date (Asia/Vientiane). Format: YYYY-MM-DD', example: '2026-12-31' })
  @IsOptional()
  @IsString()
  endDate?: string;
}
