import { Injectable } from '@nestjs/common';
import { RedisService } from '../../configs/redis/redis.service';

@Injectable()
export class DedupService {
  constructor(private readonly redis: RedisService) {}

  // Returns true if this is NEW (not a duplicate), false if already seen
  async checkAndMark(key: string, ttlSeconds = 86400): Promise<boolean> {
    const result = await this.redis.set(`dedup:${key}`, '1', ttlSeconds, 'NX');
    return result === 'OK'; // NX returns null if key exists
  }

  // Notification-specific: dedup key for a session+type
  async isNewNotification(sessionId: string, type: string): Promise<boolean> {
    return this.checkAndMark(`notif:${sessionId}:${type}`);
  }
}
