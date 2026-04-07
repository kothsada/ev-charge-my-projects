import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../configs/prisma/prisma.service';
import { startOfDay, startOfHour } from '../../common/helpers/date.helper';
import { NotificationChannel } from '../../../generated/prisma/client';

interface SessionCompletedEvent {
  stationId: string;
  stationName: string;
  sessionId: string;
  userId: string;
  energyKwh: number;
  amountLak: number;
  durationMinutes: number;
  completedAt: Date;
  overstayFee?: number;
  wasOverstay?: boolean;
}

interface SessionStartedEvent {
  stationId: string;
  stationName: string;
  startedAt: Date;
}

interface OverstayChargedEvent {
  stationId: string;
  stationName: string;
  overstayLak: number;
  completedAt: Date;
}

@Injectable()
export class AggregationService {
  private readonly logger = new Logger(AggregationService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onSessionCompleted(event: SessionCompletedEvent): Promise<void> {
    try {
      const hour = startOfHour(event.completedAt);
      const day = startOfDay(event.completedAt);
      const energyDecimal = event.energyKwh.toFixed(3);
      const overstayLak = BigInt(Math.round(event.overstayFee ?? 0));
      const wasOverstay = event.wasOverstay ? 1 : 0;

      // Upsert hourly stat
      await this.prisma.$executeRaw`
        INSERT INTO panda_ev_noti.station_hourly_stats
          (id, station_id, station_name, hour, sessions_completed, total_energy_kwh, total_revenue_lak, total_overstay_lak, overstay_incidents)
        VALUES
          (gen_random_uuid(), ${event.stationId}, ${event.stationName}, ${hour}, 1, ${energyDecimal}::decimal, ${BigInt(Math.round(event.amountLak))}, ${overstayLak}, ${wasOverstay})
        ON CONFLICT (station_id, hour) DO UPDATE SET
          sessions_completed = station_hourly_stats.sessions_completed + 1,
          total_energy_kwh = station_hourly_stats.total_energy_kwh + ${energyDecimal}::decimal,
          total_revenue_lak = station_hourly_stats.total_revenue_lak + ${BigInt(Math.round(event.amountLak))},
          total_overstay_lak = station_hourly_stats.total_overstay_lak + ${overstayLak},
          overstay_incidents = station_hourly_stats.overstay_incidents + ${wasOverstay}
      `;

      // Upsert daily stat
      await this.prisma.$executeRaw`
        INSERT INTO panda_ev_noti.station_daily_stats
          (id, station_id, station_name, date, total_sessions, completed_sessions, total_energy_kwh, total_revenue_lak, avg_session_minutes, total_overstay_lak, overstay_incidents)
        VALUES
          (gen_random_uuid(), ${event.stationId}, ${event.stationName}, ${day}::date, 1, 1, ${energyDecimal}::decimal, ${BigInt(Math.round(event.amountLak))}, ${event.durationMinutes.toFixed(2)}::decimal, ${overstayLak}, ${wasOverstay})
        ON CONFLICT (station_id, date) DO UPDATE SET
          total_sessions = station_daily_stats.total_sessions + 1,
          completed_sessions = station_daily_stats.completed_sessions + 1,
          total_energy_kwh = station_daily_stats.total_energy_kwh + ${energyDecimal}::decimal,
          total_revenue_lak = station_daily_stats.total_revenue_lak + ${BigInt(Math.round(event.amountLak))},
          avg_session_minutes = (station_daily_stats.avg_session_minutes * station_daily_stats.completed_sessions + ${event.durationMinutes.toFixed(2)}::decimal) / (station_daily_stats.completed_sessions + 1),
          total_overstay_lak = station_daily_stats.total_overstay_lak + ${overstayLak},
          overstay_incidents = station_daily_stats.overstay_incidents + ${wasOverstay}
      `;
    } catch (error) {
      this.logger.error(`onSessionCompleted aggregation failed: ${(error as Error).message}`);
    }
  }

  async onSessionStarted(event: SessionStartedEvent): Promise<void> {
    try {
      const hour = startOfHour(event.startedAt);

      await this.prisma.$executeRaw`
        INSERT INTO panda_ev_noti.station_hourly_stats
          (id, station_id, station_name, hour, sessions_started)
        VALUES
          (gen_random_uuid(), ${event.stationId}, ${event.stationName}, ${hour}, 1)
        ON CONFLICT (station_id, hour) DO UPDATE SET
          sessions_started = station_hourly_stats.sessions_started + 1
      `;
    } catch (error) {
      this.logger.error(`onSessionStarted aggregation failed: ${(error as Error).message}`);
    }
  }

  async onNotificationSent(
    type: string,
    channel: string,
    status: 'SENT' | 'FAILED' | 'SUPPRESSED',
  ): Promise<void> {
    try {
      const today = startOfDay(new Date());
      const channelEnum = channel as NotificationChannel;

      const sentIncr = status === 'SENT' ? 1 : 0;
      const failedIncr = status === 'FAILED' ? 1 : 0;
      const suppressedIncr = status === 'SUPPRESSED' ? 1 : 0;

      await this.prisma.$executeRaw`
        INSERT INTO panda_ev_noti.notification_daily_stats
          (id, date, type, channel, total_sent, total_failed, total_suppressed)
        VALUES
          (gen_random_uuid(), ${today}::date, ${type}, ${channelEnum}::"panda_ev_noti"."NotificationChannel", ${sentIncr}, ${failedIncr}, ${suppressedIncr})
        ON CONFLICT (date, type, channel) DO UPDATE SET
          total_sent = notification_daily_stats.total_sent + ${sentIncr},
          total_failed = notification_daily_stats.total_failed + ${failedIncr},
          total_suppressed = notification_daily_stats.total_suppressed + ${suppressedIncr}
      `;
    } catch (error) {
      this.logger.error(`onNotificationSent aggregation failed: ${(error as Error).message}`);
    }
  }

  async onOverstayCharged(event: OverstayChargedEvent): Promise<void> {
    try {
      const day = startOfDay(event.completedAt);
      const overstayLak = BigInt(Math.round(event.overstayLak));

      await this.prisma.$executeRaw`
        INSERT INTO panda_ev_noti.station_daily_stats
          (id, station_id, station_name, date, total_overstay_lak, overstay_incidents)
        VALUES
          (gen_random_uuid(), ${event.stationId}, ${event.stationName}, ${day}::date, ${overstayLak}, 1)
        ON CONFLICT (station_id, date) DO UPDATE SET
          total_overstay_lak = station_daily_stats.total_overstay_lak + ${overstayLak},
          overstay_incidents = station_daily_stats.overstay_incidents + 1
      `;
    } catch (error) {
      this.logger.error(`onOverstayCharged aggregation failed: ${(error as Error).message}`);
    }
  }
}
