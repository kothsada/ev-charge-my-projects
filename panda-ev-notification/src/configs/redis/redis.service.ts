import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: Redis;

  constructor() {
    const url = process.env.REDIS_URL || 'redis://localhost:6379';
    this.client = new Redis(url, { maxRetriesPerRequest: 3, lazyConnect: false });
    this.client.on('error', (err) => this.logger.error(`Redis connection error: ${err.message}`));
  }

  async onModuleDestroy() {
    await this.client?.quit();
  }

  getClient(): Redis {
    return this.client;
  }

  async testConnection(): Promise<boolean> {
    try {
      const pong = await this.client.ping();
      this.logger.log(`Redis connected: ${pong}`);
      return true;
    } catch (error) {
      this.logger.error('Redis connection test failed', error);
      return false;
    }
  }

  async set(key: string, value: string, ttl?: number, mode?: 'NX'): Promise<string | null> {
    if (mode === 'NX') return this.client.set(key, value, 'EX', ttl ?? 3600, 'NX');
    if (ttl) {
      await this.client.set(key, value, 'EX', ttl);
      return 'OK';
    }
    await this.client.set(key, value);
    return 'OK';
  }

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async del(key: string): Promise<void> {
    await this.client.del(key);
  }

  async setJSON(key: string, value: unknown, ttl?: number): Promise<void> {
    await this.set(key, JSON.stringify(value), ttl);
  }

  async getJSON<T>(key: string): Promise<T | null> {
    const raw = await this.get(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch (err) {
      this.logger.error(`Redis getJSON: failed to parse key "${key}": ${(err as Error).message}`);
      return null;
    }
  }

  async evalLua(script: string, keys: string[], args: string[]): Promise<number> {
    const result = await this.client.eval(script, keys.length, ...keys, ...args);
    return result as number;
  }

  async incr(key: string): Promise<number> {
    return this.client.incr(key);
  }

  async expire(key: string, ttl: number): Promise<void> {
    await this.client.expire(key, ttl);
  }

  async delByPattern(pattern: string): Promise<number> {
    let deleted = 0;
    let cursor = '0';
    do {
      const [nextCursor, keys] = await this.client.scan(
        cursor,
        'MATCH',
        pattern,
        'COUNT',
        100,
      );
      cursor = nextCursor;
      if (keys.length > 0) {
        deleted += await this.client.del(...keys);
      }
    } while (cursor !== '0');
    return deleted;
  }

  async getKeysByPattern(pattern: string): Promise<string[]> {
    const allKeys: string[] = [];
    let cursor = '0';
    do {
      const [nextCursor, keys] = await this.client.scan(
        cursor,
        'MATCH',
        pattern,
        'COUNT',
        100,
      );
      cursor = nextCursor;
      allKeys.push(...keys);
    } while (cursor !== '0');
    return allKeys;
  }

  async getTtl(key: string): Promise<number> {
    return this.client.ttl(key);
  }

  pipeline() {
    return this.client.pipeline();
  }
}
