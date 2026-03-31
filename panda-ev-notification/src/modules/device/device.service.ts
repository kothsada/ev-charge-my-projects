import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../configs/prisma/prisma.service';

@Injectable()
export class DeviceService {
  private readonly logger = new Logger(DeviceService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Register or re-claim an FCM token.
   * If the token already exists for another user (device wipe / re-install),
   * it is moved to the new user and reactivated.
   */
  async registerToken(
    userId: string,
    fcmToken: string,
    platform?: string,
    appVersion?: string,
  ): Promise<void> {
    await this.prisma.userFcmDevice.upsert({
      where: { fcmToken },
      create: { userId, fcmToken, platform, appVersion, isActive: true },
      update: { userId, platform, appVersion, isActive: true },
    });
  }

  /** Soft-delete a single FCM token (call on logout). */
  async unregisterToken(fcmToken: string): Promise<void> {
    await this.prisma.userFcmDevice.updateMany({
      where: { fcmToken },
      data: { isActive: false },
    });
  }

  /** Soft-delete all tokens for a user (account deletion / deactivation). */
  async unregisterAllForUser(userId: string): Promise<void> {
    await this.prisma.userFcmDevice.updateMany({
      where: { userId },
      data: { isActive: false },
    });
  }

  /**
   * Return all active FCM tokens for a user.
   * Used by NotificationProcessor when the inbound message omits fcmTokens.
   */
  async getActiveTokens(userId: string): Promise<string[]> {
    const devices = await this.prisma.userFcmDevice.findMany({
      where: { userId, isActive: true },
      select: { fcmToken: true },
    });
    return devices.map((d) => d.fcmToken);
  }

  /**
   * Soft-delete tokens that FCM reported as invalid/unregistered.
   * Called by NotificationProcessor after each multicast send.
   */
  async markTokensStale(tokens: string[]): Promise<void> {
    if (!tokens.length) return;

    const result = await this.prisma.userFcmDevice.updateMany({
      where: { fcmToken: { in: tokens } },
      data: { isActive: false },
    });

    if (result.count > 0) {
      this.logger.log(`Marked ${result.count} stale FCM token(s) as inactive`);
    }
  }

  /** Refresh lastUsedAt for tokens that just received a successful delivery. */
  async updateLastUsed(tokens: string[]): Promise<void> {
    if (!tokens.length) return;
    await this.prisma.userFcmDevice.updateMany({
      where: { fcmToken: { in: tokens }, isActive: true },
      data: { lastUsedAt: new Date() },
    });
  }

  /** List devices for a user (used by admin/internal tooling). */
  async listDevices(userId: string) {
    return this.prisma.userFcmDevice.findMany({
      where: { userId },
      select: {
        id: true,
        platform: true,
        appVersion: true,
        isActive: true,
        lastUsedAt: true,
        createdAt: true,
        fcmToken: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }
}
