import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../configs/prisma/prisma.service';
import { RedisService } from '../../configs/redis/redis.service';
import { SmsAggregationService } from './sms.aggregation.service';
import { parsePhoneNumber, generateTransactionId } from './sms.helper';
import { SendSmsDto, SmsTypeInput } from './dto/send-sms.dto';
import { SmsHistoryQueryDto, SmsStatsQueryDto } from './dto/sms-query.dto';
import { SmsStatus, SmsType } from '../../../generated/prisma/client';

// Cache TTLs (seconds)
const CACHE_TTL_STATS = 3 * 60;    // 3 min — daily stats refresh quickly on each send
const CACHE_TTL_HISTORY = 60;       // 1 min — history pages stale quickly after new sends

// ---------- LTC API response shapes ----------

interface LtcSubmitResponse {
  transaction_id?: string;
  resultCode?: string;
  developerMessage?: string;
  SMID?: string;
  // Error response uses different casing
  ResultCode?: string;
  ResultDesc?: string;
}

interface LtcVerifyResponse {
  ResultCode: string;
  SM_Code?: string;
  PhoneNumber?: string;
  SubmitTime?: string;
  DeliveryTime?: string;
  SMID?: string;
}

// ---------- Service ----------

@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);

  private get baseUrl(): string {
    return (
      process.env.LTC_SMS_BASE_URL ??
      'https://apicenter.laotel.com:9443/api/sms_center/submit_sms'
    );
  }
  private get apiKey(): string {
    return process.env.LTC_SMS_API_KEY ?? '';
  }
  private get defaultHeader(): string {
    return process.env.LTC_SMS_HEADER ?? 'PANDAEV';
  }

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly aggregation: SmsAggregationService,
  ) {}

  // ----------------------------------------------------------------
  // Cache helpers
  // ----------------------------------------------------------------

  private cacheKey(prefix: string, params: Record<string, unknown>): string {
    return `sms:${prefix}:${JSON.stringify(params)}`;
  }

  private async fromCache<T>(key: string): Promise<T | null> {
    return this.redis.getJSON<T>(key);
  }

  private async toCache(key: string, value: unknown, ttl: number): Promise<void> {
    await this.redis.setJSON(key, value, ttl).catch(() => null);
  }

  /** Invalidate all sms:stats:* keys for today so the next request sees fresh data. */
  private invalidateStatsCache(): void {
    const today = new Date().toISOString().slice(0, 10);
    this.redis
      .getClient()
      .keys(`sms:stats:*${today}*`)
      .then((keys) => {
        if (keys.length) {
          void this.redis.getClient().del(...keys);
        }
      })
      .catch(() => null);
  }

  // ----------------------------------------------------------------
  // Public API
  // ----------------------------------------------------------------

  async send(
    dto: SendSmsDto,
    sourceService = 'api',
  ): Promise<{ transactionId: string; smid: string | null; status: string; message: string; networkType: string; costLak: number }> {
    const parsed = parsePhoneNumber(dto.phoneNumber);
    const transactionId = generateTransactionId();
    const smsType: SmsType = dto.smsType === SmsTypeInput.OTP ? SmsType.OTP : SmsType.TEXT;

    // Persist PENDING record before hitting LTC so we never lose a transaction
    const log = await this.prisma.smsLog.create({
      data: {
        transactionId,
        countryCode: parsed.countryCode,
        mobileNumber: parsed.mobileNumber,
        operator: parsed.operator,
        fullPhoneNumber: parsed.fullPhoneNumber,
        header: dto.header ?? this.defaultHeader,
        message: dto.message,
        smsType,
        networkType: parsed.networkType,
        costLak: parsed.costLak,
        status: SmsStatus.PENDING,
        sourceService,
        userId: dto.userId,
        sessionId: dto.sessionId,
      },
    });

    let smid: string | null = null;
    let finalStatus: SmsStatus = SmsStatus.FAILED;
    let resultMessage = 'SMS send failed';
    let errorMessage: string | null = null;
    let resultCode: string | null = null;

    try {
      const resp = await this.callLtcSubmit({
        transaction_id: transactionId,
        header: dto.header ?? this.defaultHeader,
        phoneNumber: parsed.fullPhoneNumber,
        message: dto.message,
      });

      const isSuccess =
        resp.resultCode === '20000' ||
        (resp.SMID != null && resp.SMID !== '');
      smid = resp.SMID ?? null;
      resultCode = resp.resultCode ?? resp.ResultCode ?? null;
      finalStatus = isSuccess ? SmsStatus.SENT : SmsStatus.FAILED;
      resultMessage = isSuccess
        ? 'SMS sent successfully'
        : (resp.ResultDesc ?? resp.developerMessage ?? 'LTC API returned failure');
      if (!isSuccess) errorMessage = resultMessage;
    } catch (err) {
      this.logger.error(
        `LTC submit_sms failed (tx=${transactionId}): ${(err as Error).message}`,
      );
      errorMessage = (err as Error).message;
      resultMessage = errorMessage;
    }

    await this.prisma.smsLog
      .update({
        where: { id: log.id },
        data: { smid, status: finalStatus, resultCode, errorMessage },
      })
      .catch(() => null);

    await this.aggregation.onSmsSent({
      date: new Date(),
      networkType: parsed.networkType,
      costLak: parsed.costLak,
      smsType,
      isSuccess: finalStatus === SmsStatus.SENT,
      isNewRecipient: false,
    });

    // Invalidate cached stats so next poll reflects the new send
    this.invalidateStatsCache();

    return {
      transactionId,
      smid,
      status: finalStatus,
      message: resultMessage,
      networkType: parsed.networkType,
      costLak: parsed.costLak,
    };
  }

  async verify(smid: string): Promise<{
    delivered: boolean;
    smCode?: string;
    phoneNumber?: string;
    submitTime?: string;
    deliveryTime?: string;
  }> {
    const resp = await this.callLtcVerify(smid);
    const delivered = resp.ResultCode === '0';

    if (delivered) {
      await this.prisma.smsLog
        .updateMany({
          where: { smid },
          data: {
            status: SmsStatus.DELIVERED,
            deliveredAt: resp.DeliveryTime ? new Date(resp.DeliveryTime) : new Date(),
          },
        })
        .catch(() => null);
    }

    return {
      delivered,
      smCode: resp.SM_Code,
      phoneNumber: resp.PhoneNumber,
      submitTime: resp.SubmitTime,
      deliveryTime: resp.DeliveryTime,
    };
  }

  async getHistory(query: SmsHistoryQueryDto) {
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 20, 100);
    const cacheKey = this.cacheKey('history', { ...query, page, limit });

    type HistoryResult = { items: unknown[]; meta: { total: number; page: number; limit: number; totalPages: number } };
    const cached = await this.fromCache<HistoryResult>(cacheKey);
    if (cached) return cached;

    const skip = (page - 1) * limit;
    const where: Record<string, unknown> = {};
    if (query.status) where.status = query.status;
    if (query.networkType) where.networkType = query.networkType;
    if (query.smsType) where.smsType = query.smsType;
    if (query.userId) where.userId = query.userId;

    if (query.startDate || query.endDate) {
      const sentAt: Record<string, unknown> = {};
      if (query.startDate) sentAt.gte = new Date(query.startDate);
      if (query.endDate) sentAt.lte = new Date(query.endDate);
      where.sentAt = sentAt;
    }

    const [items, total] = await Promise.all([
      this.prisma.smsLog.findMany({
        where,
        orderBy: { sentAt: 'desc' },
        skip,
        take: limit,
        select: {
          id: true,
          transactionId: true,
          countryCode: true,
          mobileNumber: true,
          operator: true,
          fullPhoneNumber: true,
          smsType: true,
          networkType: true,
          costLak: true,
          status: true,
          smid: true,
          resultCode: true,
          errorMessage: true,
          sourceService: true,
          userId: true,
          sessionId: true,
          sentAt: true,
          deliveredAt: true,
        },
      }),
      this.prisma.smsLog.count({ where }),
    ]);

    const result: HistoryResult = {
      items,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
    await this.toCache(cacheKey, result, CACHE_TTL_HISTORY);
    return result;
  }

  async getDailyStats(query: SmsStatsQueryDto) {
    const cacheKey = this.cacheKey('stats', query as unknown as Record<string, unknown>);
    const cached = await this.fromCache<unknown[]>(cacheKey);
    if (cached) return cached;

    const where: Record<string, unknown> = {};
    if (query.startDate || query.endDate) {
      const date: Record<string, unknown> = {};
      if (query.startDate) date.gte = new Date(query.startDate);
      if (query.endDate) date.lte = new Date(query.endDate);
      where.date = date;
    }

    const result = await this.prisma.smsDailyStat.findMany({
      where,
      orderBy: { date: 'desc' },
    });

    await this.toCache(cacheKey, result, CACHE_TTL_STATS);
    return result;
  }

  // ----------------------------------------------------------------
  // LTC API calls
  // ----------------------------------------------------------------

  private async callLtcSubmit(body: {
    transaction_id: string;
    header: string;
    phoneNumber: string;
    message: string;
  }): Promise<LtcSubmitResponse> {
    if (!this.apiKey) {
      // Dry-run mode when API key is not configured (dev/test)
      this.logger.warn(
        `LTC_SMS_API_KEY not set — dry-run mode (tx=${body.transaction_id})`,
      );
      return {
        transaction_id: body.transaction_id,
        resultCode: '20000',
        developerMessage: 'dry-run',
        SMID: `DRY${Date.now()}`,
      };
    }

    const res = await fetch(`${this.baseUrl}/submit_sms`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Apikey: this.apiKey,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '(no body)');
      throw new Error(`LTC submit_sms HTTP ${res.status}: ${text}`);
    }

    return res.json() as Promise<LtcSubmitResponse>;
  }

  private async callLtcVerify(smid: string): Promise<LtcVerifyResponse> {
    if (!this.apiKey) {
      return { ResultCode: '0', SM_Code: '0', SMID: smid };
    }

    const res = await fetch(`${this.baseUrl}/verify_sms`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Apikey: this.apiKey,
      },
      body: JSON.stringify({ SMID: smid }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '(no body)');
      throw new Error(`LTC verify_sms HTTP ${res.status}: ${text}`);
    }

    return res.json() as Promise<LtcVerifyResponse>;
  }
}
