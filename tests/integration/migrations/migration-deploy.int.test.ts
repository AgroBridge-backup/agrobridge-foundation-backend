import { execSync } from 'node:child_process';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { PostgreSqlContainer } from '@testcontainers/postgresql';

import { createPrismaClient } from '../../../src/db/prisma.js';

/**
 * Migration deploy gate.
 *
 * The rest of the integration suite provisions schema via `prisma db push`
 * (see tests/integration/test-db.ts), which never exercises the migration
 * history that production relies on (render-start.sh runs `prisma migrate
 * deploy`). This test closes that gap: it spins a FRESH Postgres and proves
 * `migrate deploy` creates every expected table and records the baseline
 * migration in `_prisma_migrations`.
 *
 * Requires Docker (Testcontainers). Gated by scripts/check-docker.mjs via
 * `npm run test:integration`.
 */
let container: PostgreSqlContainer | undefined;

const EXPECTED_TABLES = [
  'Campaign',
  'Donation',
  'ContactRequest',
  'WebhookEvent',
  'AdminUser',
];

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:15')
    .withDatabase('agrobridge')
    .withUsername('postgres')
    .withPassword('postgres')
    .start();

  process.env.DATABASE_URL = container.getConnectionUri();

  // The exact command render-start.sh runs in production.
  execSync('npx prisma migrate deploy', {
    stdio: 'inherit',
    env: process.env,
  });
}, 180_000);

afterAll(async () => {
  if (container) await container.stop();
  container = undefined;
});

test('migrate deploy creates all application tables', async () => {
  const prisma = createPrismaClient();
  try {
    const rows = await prisma.$queryRaw<Array<{ table_name: string }>>`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'
    `;
    const tables = rows.map((r) => r.table_name);
    for (const expected of EXPECTED_TABLES) {
      expect(tables).toContain(expected);
    }
  } finally {
    await prisma.$disconnect();
  }
});

test('baseline migration is recorded in _prisma_migrations', async () => {
  const prisma = createPrismaClient();
  try {
    const rows = await prisma.$queryRaw<
      Array<{ migration_name: string; finished_at: Date | null }>
    >`SELECT migration_name, finished_at FROM "_prisma_migrations"`;
    expect(rows.length).toBe(1);
    expect(rows[0]?.migration_name).toBe('20260220000000_init');
    expect(rows[0]?.finished_at).not.toBeNull();
  } finally {
    await prisma.$disconnect();
  }
});

test('migrate deploy is idempotent on an already-migrated database', async () => {
  // Running deploy again must be a no-op (exit 0) and not duplicate history.
  execSync('npx prisma migrate deploy', {
    stdio: 'inherit',
    env: process.env,
  });

  const prisma = createPrismaClient();
  try {
    const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count FROM "_prisma_migrations"
    `;
    expect(Number(rows[0]?.count ?? 0)).toBe(1);
  } finally {
    await prisma.$disconnect();
  }
});
