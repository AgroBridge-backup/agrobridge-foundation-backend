import { PrismaClient } from '@prisma/client';

export function createPrismaClient(): PrismaClient {
  const baseUrl = process.env.DATABASE_URL ?? '';
  const hasQuery = baseUrl.includes('?');
  const pooledUrl = baseUrl
    ? `${baseUrl}${hasQuery ? '&' : '?'}connection_limit=20&pool_timeout=20`
    : '';

  // Prisma 7 requires datasourceUrl to be passed to constructor
  const options: ConstructorParameters<typeof PrismaClient>[0] = {
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  };

  if (pooledUrl) {
    (options as any).datasourceUrl = pooledUrl;
  }

  return new PrismaClient(options);
}
