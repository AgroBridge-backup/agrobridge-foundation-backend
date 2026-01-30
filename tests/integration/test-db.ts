import { execSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { PostgreSqlContainer } from '@testcontainers/postgresql';

let container: PostgreSqlContainer | undefined;
let prisma: PrismaClient | undefined;

export async function startTestDb() {
  try {
    container = await new PostgreSqlContainer('postgres:15')
      .withDatabase('agrobridge')
      .withUsername('postgres')
      .withPassword('postgres')
      .start();
  } catch (e) {
    // In CI/prod we want a hard failure, but locally we prefer a clear hint.
    const msg = (e as Error).message || String(e);
    throw new Error(
      `Testcontainers could not start Postgres. Ensure Docker Desktop is running. Underlying error: ${msg}`,
    );
  }

  process.env.DATABASE_URL = container.getConnectionUri();

  // Keep tests migration-independent: apply schema directly.
  execSync('npx prisma db push --skip-generate', {
    stdio: 'inherit',
    env: process.env,
  });

  prisma = new PrismaClient();
  await prisma.$connect();

  return { container, prisma };
}

export async function stopTestDb() {
  if (prisma) await prisma.$disconnect();
  if (container) await container.stop();
  prisma = undefined;
  container = undefined;
}
