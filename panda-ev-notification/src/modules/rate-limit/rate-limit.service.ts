import { Injectable } from '@nestjs/common';
import { RedisService } from '../../configs/redis/redis.service';

@Injectable()
export class RateLimitService {
  private readonly LIMITS = {
    global:           { max: 20,  windowSec: 3600  },
    overstay_warning: { max: 4,   windowSec: 86400 },
    soc_80:           { max: 1,   windowSec: 86400 },
    promo:            { max: 2,   windowSec: 86400 },
  } as const;

  constructor(private readonly redis: RedisService) {}

  // Returns true if allowed, false if rate-limited
  async isAllowed(userId: string, type: string): Promise<boolean> {
    const now = Date.now();
    const typeLimit = this.LIMITS[type as keyof typeof this.LIMITS] ?? this.LIMITS.global;

    const allowed = await Promise.all([
      this.checkWindow(`rl:global:${userId}`, this.LIMITS.global.max, this.LIMITS.global.windowSec, now),
      this.checkWindow(`rl:${type}:${userId}`, typeLimit.max, typeLimit.windowSec, now),
    ]);
    return allowed.every(Boolean);
  }

  private async checkWindow(key: string, max: number, windowSec: number, now: number): Promise<boolean> {
    const windowMs = windowSec * 1000;
    const pipe = this.redis.pipeline();
    pipe.zremrangebyscore(key, 0, now - windowMs);
    pipe.zcard(key);
    pipe.zadd(key, now, `${now}:${Math.random()}`);
    pipe.expire(key, windowSec);
    const results = await pipe.exec() as [Error | null, unknown][];
    const count = results[1][1] as number;
    return count < max;
  }
}
