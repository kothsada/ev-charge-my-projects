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

@ApiTags('SMS')
@Controller('v1/sms')
export class SmsController {
  constructor(private readonly smsService: SmsService) {}

  /**
   * Direct send — bypasses RabbitMQ.
   * Use this endpoint to test SMS delivery from Swagger.
   */
  @Post('send')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Send an SMS via LTC API (direct — for testing)',
    description:
      'Parses the phone number, detects onnet/offnet, sends through LTC API, ' +
      'and persists a transaction log. Onnet (LTC→LTC): 200 LAK. Offnet: 300 LAK.',
  })
  async send(@Body() dto: SendSmsDto) {
    return this.smsService.send(dto, 'api');
  }

  /**
   * Verify delivery status for a previously sent SMS.
   * LTC recommends checking 5-10 minutes after submission.
   */
  @Post('verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Check delivery status of a sent SMS (SMID from submit response)',
    description: 'Calls LTC verify_sms endpoint. Check 5-10 minutes after sending.',
  })
  async verify(@Body() dto: VerifySmsDto) {
    return this.smsService.verify(dto.smid);
  }

  /**
   * Paginated SMS transaction log with filtering.
   */
  @Get('history')
  @ApiOperation({
    summary: 'Paginated SMS transaction log',
    description: 'Filter by status, network type, SMS type, user ID, or date range.',
  })
  async history(@Query() query: SmsHistoryQueryDto) {
    return this.smsService.getHistory(query);
  }

  /**
   * Pre-aggregated daily stats.
   * All counters are auto-incremented on each SMS send — never recalculated.
   * Includes: onnet/offnet counts & amounts, totals, success/fail, OTP/TEXT split.
   */
  @Get('stats/daily')
  @ApiOperation({
    summary: 'SMS daily aggregated stats',
    description:
      'Returns per-day SMS statistics: onnet count+amount, offnet count+amount, ' +
      'combined totals, success/fail breakdown, OTP vs TEXT split, unique recipient count.',
  })
  async dailyStats(@Query() query: SmsStatsQueryDto) {
    return this.smsService.getDailyStats(query);
  }
}
