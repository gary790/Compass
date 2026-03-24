import Redis from 'ioredis';
import { redisConfig } from '../config/index.js';
import { createLogger } from '../utils/index.js';

const logger = createLogger('Redis');

let redis: Redis | null = null;

export function getRedis(): Redis {
  if (!redis) {
    redis = new Redis(redisConfig.url, {
      maxRetriesPerRequest: redisConfig.maxRetries,
      lazyConnect: true,
      retryStrategy(times) {
        const delay = Math.min(times * 200, 5000);
        logger.warn(`Redis reconnecting... attempt ${times}`);
        return delay;
      },
    });

    redis.on('connect', () => logger.info('Redis connected'));
    redis.on('error', (err) => logger.error('Redis error', { error: err.message }));
  }
  return redis;
}

export async function connectRedis(): Promise<boolean> {
  try {
    const r = getRedis();
    await r.connect();
    await r.ping();
    logger.info('Redis connection verified');
    return true;
  } catch (error: any) {
    if (error.message?.includes('Already')) {
      logger.info('Redis already connected');
      return true;
    }
    logger.warn(`Redis connection failed: ${error.message}`);
    return false;
  }
}

export async function closeRedis(): Promise<void> {
  if (redis) {
    await redis.quit();
    redis = null;
    logger.info('Redis connection closed');
  }
}

// ============================================================
// CACHE HELPERS
// ============================================================
export async function cacheGet(key: string): Promise<string | null> {
  try {
    return await getRedis().get(key);
  } catch { return null; }
}

export async function cacheSet(key: string, value: string, ttlSeconds?: number): Promise<void> {
  try {
    if (ttlSeconds) {
      await getRedis().setex(key, ttlSeconds, value);
    } else {
      await getRedis().set(key, value);
    }
  } catch (error: any) {
    logger.warn(`Cache set failed: ${error.message}`);
  }
}

export async function cacheDelete(key: string): Promise<void> {
  try {
    await getRedis().del(key);
  } catch (error: any) {
    logger.warn(`Cache delete failed: ${error.message}`);
  }
}

// ============================================================
// RATE LIMITER
// ============================================================
export async function checkRateLimit(
  key: string,
  maxRequests: number,
  windowMs: number
): Promise<{ allowed: boolean; remaining: number; resetAt: number }> {
  try {
    const r = getRedis();
    const now = Date.now();
    const windowStart = now - windowMs;

    // Use sorted set for sliding window
    const multi = r.multi();
    multi.zremrangebyscore(key, 0, windowStart);
    multi.zadd(key, now, `${now}-${Math.random()}`);
    multi.zcard(key);
    multi.pexpire(key, windowMs);

    const results = await multi.exec();
    const count = (results?.[2]?.[1] as number) || 0;

    return {
      allowed: count <= maxRequests,
      remaining: Math.max(0, maxRequests - count),
      resetAt: now + windowMs,
    };
  } catch {
    // If Redis is down, allow the request
    return { allowed: true, remaining: maxRequests, resetAt: Date.now() };
  }
}
