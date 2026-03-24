import Redis from 'ioredis';
import { redisConfig } from '../config/index.js';
import { createLogger } from '../utils/index.js';

const logger = createLogger('Redis');

let redis: Redis | null = null;
let redisDisabled = false;

export function getRedis(): Redis | null {
  if (redisDisabled) return null;
  if (!redis) {
    redis = new Redis(redisConfig.url, {
      maxRetriesPerRequest: redisConfig.maxRetries,
      lazyConnect: true,
      retryStrategy(times) {
        if (times >= 3) {
          logger.warn('Redis unavailable — disabling (app will run without caching)');
          redisDisabled = true;
          return null; // stop retrying
        }
        return Math.min(times * 300, 2000);
      },
    });

    redis.on('connect', () => logger.info('Redis connected'));
    redis.on('error', () => {}); // silenced — retryStrategy handles logging
  }
  return redis;
}

export async function connectRedis(): Promise<boolean> {
  try {
    const r = getRedis();
    if (!r) return false;

    // Give Redis 3 seconds to connect; if it can't, skip it silently
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('timeout')), 3000)
    );

    await Promise.race([r.connect(), timeout]);
    await Promise.race([r.ping(), timeout]);
    logger.info('Redis connection verified');
    return true;
  } catch (error: any) {
    if (error.message?.includes('Already')) {
      logger.info('Redis already connected');
      return true;
    }
    // Silence further connection attempts
    redisDisabled = true;
    if (redis) {
      redis.disconnect(); // stop the retry loop immediately
      redis = null;
    }
    logger.warn('Redis not available \u2014 running without cache/rate-limiting');
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
    const r = getRedis();
    if (!r) return null;
    return await r.get(key);
  } catch { return null; }
}

export async function cacheSet(key: string, value: string, ttlSeconds?: number): Promise<void> {
  try {
    const r = getRedis();
    if (!r) return;
    if (ttlSeconds) await r.setex(key, ttlSeconds, value);
    else await r.set(key, value);
  } catch {}
}

export async function cacheDelete(key: string): Promise<void> {
  try {
    const r = getRedis();
    if (!r) return;
    await r.del(key);
  } catch {}
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
    if (!r) return { allowed: true, remaining: maxRequests, resetAt: Date.now() };
    const now = Date.now();
    const windowStart = now - windowMs;

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
