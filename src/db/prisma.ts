import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

export function createPrismaClient(): PrismaClient {
  const poolMax = parseInt(process.env.DB_POOL_MAX || '20', 10);
  const poolIdleTimeout = parseInt(process.env.DB_POOL_IDLE_TIMEOUT || '20000', 10);

  const adapter = new PrismaPg({
    connectionString: process.env.DATABASE_URL,
    max: poolMax,
    idleTimeoutMillis: poolIdleTimeout,
  });

  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });
}
