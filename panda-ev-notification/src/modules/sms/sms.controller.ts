import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SmsService } from './sms.service';
import { SendSmsDto, VerifySmsDto } from './dto/send-sms.dto';
import { SmsHistoryQueryDto, SmsStatsQueryDto } from './dto/sms-query.dto';
import {
  ApiSuccessResponse,
  ApiValidationResponse,
  ApiInternalErrorResponse,
} from '../../common/decorators';

@ApiTags('SMS')
@Controller('v1/sms')
export class SmsController {
  constructor(private readonly smsService: SmsService) {}

  @Post('send')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Send an SMS via LTC API (direct — for testing)',
    description:
      'Parses the phone number, detects onnet/offnet, sends through LTC API, ' +
      'and persists a transaction log. Onnet (LTC→LTC): 200 LAK. Offnet: 300 LAK. ' +
      'When `LTC_SMS_API_KEY` is unset, runs in dry-run mode (no real SMS sent).',
  })
  @ApiSuccessResponse(200, 'SMS sent', {
    smid: 'SMID-20260616-001',
    transactionId: 'PEV-20260616-001',
    networkType: 'onnet',
    costLak: 200,
    isDryRun: false,
  })
  @ApiValidationResponse()
  @ApiInternalErrorResponse()
  async send(@Body() dto: SendSmsDto) {
    return this.smsService.send(dto, 'api');
  }

  @Post('verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Check delivery status of a sent SMS (SMID from submit response)',
    description:
      'Calls the LTC `verify_sms` endpoint. Check 5–10 minutes after sending for accurate status. ' +
      'LTC API success: `resultCode === "20000"`.',
  })
  @ApiSuccessResponse(200, 'SMS delivery status checked', {
    smid: 'SMID-20260616-001',
    status: 'DELIVERED',
    deliveredAt: '2026-06-16T10:00:30+07:00',
  })
  @ApiValidationResponse()
  @ApiInternalErrorResponse()
  async verify(@Body() dto: VerifySmsDto) {
    return this.smsService.verify(dto.smid);
  }

  @Get('history')
  @ApiOperation({
    summary: 'Paginated SMS transaction log',
    description: 'Filter by status, network type, SMS type, user ID, or date range.',
  })
  @ApiSuccessResponse(200, 'SMS history retrieved', [
    {
      id: 'uuid',
      transactionId: 'PEV-20260616-001',
      smid: 'SMID-20260616-001',
      phoneNumber: '8562078559999',
      networkType: 'onnet',
      smsType: 'OTP',
      costLak: 200,
      status: 'SENT',
      sourceService: 'mobile',
      userId: 'uuid',
      sentAt: '2026-06-16T10:00:00+07:00',
    },
  ])
  @ApiInternalErrorResponse()
  async history(@Query() query: SmsHistoryQueryDto) {
    return this.smsService.getHistory(query);
  }

  @Get('stats/daily')
  @ApiOperation({
    summary: 'SMS daily aggregated stats',
    description:
      'Returns per-day SMS statistics auto-incremented on each send. ' +
      'Fields: onnet/offnet counts & amounts, combined totals, success/fail counts, OTP vs TEXT split, unique recipients.',
  })
  @ApiSuccessResponse(200, 'SMS daily stats retrieved', [
    {
      id: 'uuid',
      date: '2026-06-16T00:00:00.000Z',
      onnetCount: 45,
      onnetAmountLak: 9000,
      offnetCount: 12,
      offnetAmountLak: 3600,
      totalCount: 57,
      totalAmountLak: 12600,
      successCount: 55,
      failCount: 2,
      otpCount: 38,
      textCount: 19,
      uniqueRecipients: 52,
    },
  ])
  @ApiInternalErrorResponse()
  async dailyStats(@Query() query: SmsStatsQueryDto) {
    return this.smsService.getDailyStats(query);
  }
}
