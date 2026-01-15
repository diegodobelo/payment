import Redis from 'ioredis';
import { config } from '../config/index.js';
import { logger } from './logger.js';

// Create Redis connection for general use
export const redis = new Redis(config.redis.url, {
  maxRetriesPerRequest: null, // Required for BullMQ
  enableReadyCheck: false,
});

redis.on('connect', () => {
  logger.info('Redis connected');
});

redis.on('error', (error) => {
  logger.error({ error }, 'Redis connection error');
});

redis.on('close', () => {
  logger.info('Redis connection closed');
});

/**
 * Close Redis connection gracefully.
 */
export async function closeRedis(): Promise<void> {
  await redis.quit();
}

/**
 * Test Redis connection.
 */
export async function testRedisConnection(): Promise<boolean> {
  try {
    const result = await redis.ping();
    return result === 'PONG';
  } catch {
    return false;
  }
}
