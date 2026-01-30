import { createClient, type RedisClientType } from 'redis';
import type { Env } from '../config/env.js';
import { requestContext } from '../observability/request-context.js';

let redisClient: RedisClientType | null = null;

export function getRedisClient(env: Env): RedisClientType {
  if (!redisClient) {
    redisClient = createClient({
      url: env.REDIS_URL || 'redis://localhost:6379',
      socket: {
        reconnectStrategy: (retries) => {
          const log = requestContext.getLog();
          log?.warn({ retries }, 'Redis reconnecting');
          return Math.min(retries * 100, 3000);
        },
      },
    });
    redisClient.on('error', (err) => {
      const log = requestContext.getLog();
      log?.error({ err }, 'Redis error');
    });
    redisClient.on('connect', () => {
      const log = requestContext.getLog();
      log?.info('Redis connected');
    });
  }
  return redisClient;
}

export async function connectRedis(env: Env): Promise<void> {
  const client = getRedisClient(env);
  await client.connect();
}

export async function disconnectRedis(): Promise<void> {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
  }
}
