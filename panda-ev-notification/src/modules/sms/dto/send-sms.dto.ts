import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export enum SmsTypeInput {
  OTP = 'OTP',
  TEXT = 'TEXT',
}

export class SendSmsDto {
  @ApiProperty({
    description:
      'Recipient phone number. Supports full format (8562078559999) or local Laos (2078559999).',
    example: '8562078559999',
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  @MaxLength(20)
  phoneNumber: string;

  @ApiProperty({ description: 'SMS message content', example: 'Your OTP is 123456' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  message: string;

  @ApiProperty({ enum: SmsTypeInput, description: 'OTP or TEXT', example: 'OTP' })
  @IsEnum(SmsTypeInput)
  smsType: SmsTypeInput;

  @ApiPropertyOptional({
    description: 'Sender name shown on handset (overrides service default)',
    example: 'PANDAEV',
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  header?: string;

  @ApiPropertyOptional({ description: 'User ID for context', example: 'uuid-...' })
  @IsOptional()
  @IsString()
  userId?: string;

  @ApiPropertyOptional({ description: 'Charging session ID for context', example: 'uuid-...' })
  @IsOptional()
  @IsString()
  sessionId?: string;
}

export class VerifySmsDto {
  @ApiProperty({
    description: 'SMID returned by LTC submit_sms — used to check delivery status',
    example: '644192448',
  })
  @IsString()
  @IsNotEmpty()
  smid: string;
}
