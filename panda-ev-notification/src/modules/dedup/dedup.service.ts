import { Injectable } from '@nestjs/common';
import { RedisService } from '../../configs/redis/redis.service';

const DEDUP_TTL = 86400; // 24 h

@Injectable()
export class DedupService {
  constructor(private readonly redis: RedisService) {}

  // Returns true if this is NEW (not a duplicate), false if already seen.
  // Sets the dedup key atomically (use for non-retryable flows).
  async checkAndMark(key: string, ttlSeconds = DEDUP_TTL): Promise<boolean> {
    const result = await this.redis.set(`dedup:${key}`, '1', ttlSeconds, 'NX');
    return result === 'OK'; // NX returns null if key exists
  }

  /**
   * Check-only (no mark): returns true if this (sessionId, type) pair was
   * already successfully sent.  Use this for flows where the mark step must
   * be deferred until AFTER a successful FCM delivery.
   */
  async isDuplicate(sessionId: string, type: string): Promise<boolean> {
    const exists = await this.redis.get(`dedup:notif:${sessionId}:${type}`);
    return exists !== null;
  }

  /**
   * Mark (sessionId, type) as successfully sent.
   * Call this ONLY after a confirmed FCM delivery (sent > 0).
   * Using NX so a concurrent processor racing on the same message cannot
   * double-mark and accidentally suppress a legitimate retry.
   */
  async markSent(sessionId: string, type: string): Promise<void> {
    await this.redis.set(
      `dedup:notif:${sessionId}:${type}`,
      '1',
      DEDUP_TTL,
      'NX',
    );
  }

  // Notification-specific: dedup key for a session+type (legacy — check AND mark)
  async isNewNotification(sessionId: string, type: string): Promise<boolean> {
    return this.checkAndMark(`notif:${sessionId}:${type}`);
  }
}
