import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, MaxLength, IsOptional, IsIn } from 'class-validator';

export class RegisterDeviceDto {
  @ApiProperty({ description: 'Mobile user ID (UUID or string)' })
  @IsString()
  @IsNotEmpty()
  userId: string;

  @ApiProperty({ description: 'FCM registration token from client SDK' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  fcmToken: string;

  @ApiPropertyOptional({ enum: ['android', 'ios', 'web'] })
  @IsOptional()
  @IsIn(['android', 'ios', 'web'])
  platform?: string;

  @ApiPropertyOptional({ example: '2.1.0' })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  appVersion?: string;
}

export class UnregisterDeviceDto {
  @ApiProperty({ description: 'FCM token to deactivate' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  fcmToken: string;
}
