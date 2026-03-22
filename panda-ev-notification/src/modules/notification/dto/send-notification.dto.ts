import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  ArrayMinSize,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SendNotificationDto {
  @ApiProperty({ description: 'Target user ID', format: 'uuid' })
  @IsUUID()
  userId: string;

  @ApiProperty({ description: 'Notification type / template slug' })
  @IsString()
  @IsNotEmpty()
  type: string;

  @ApiProperty({ description: 'FCM registration tokens', type: [String] })
  @IsArray()
  @IsString({ each: true })
  @ArrayMinSize(1)
  fcmTokens: string[];

  @ApiProperty({ description: 'Notification title' })
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiProperty({ description: 'Notification body' })
  @IsString()
  @IsNotEmpty()
  body: string;

  @ApiPropertyOptional({ description: 'Charging session ID', format: 'uuid' })
  @IsOptional()
  @IsUUID()
  sessionId?: string;

  @ApiPropertyOptional({ description: 'Station ID', format: 'uuid' })
  @IsOptional()
  @IsUUID()
  stationId?: string;

  @ApiPropertyOptional({ description: 'Charger identity (OCPP)' })
  @IsOptional()
  @IsString()
  chargerIdentity?: string;

  @ApiPropertyOptional({ description: 'Key-value data payload for FCM' })
  @IsOptional()
  @IsObject()
  data?: Record<string, string>;

  @ApiPropertyOptional({ description: 'Notification image URL' })
  @IsOptional()
  @IsString()
  imageUrl?: string;

  @ApiPropertyOptional({ enum: ['high', 'normal'], description: 'FCM priority' })
  @IsOptional()
  @IsEnum(['high', 'normal'])
  priority?: 'high' | 'normal';

  @ApiPropertyOptional({ description: 'Skip deduplication check' })
  @IsOptional()
  @IsBoolean()
  skipDedup?: boolean;
}
