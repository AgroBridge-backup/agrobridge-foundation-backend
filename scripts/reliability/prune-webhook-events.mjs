#!/usr/bin/env node

/**
 * prune-webhook-events.mjs
 * ========================
 *
 * PURPOSE
 * -------
 * Routine retention prune for the `WebhookEvent` table. Each Stripe webhook
 * persists its full event JSON in `rawPayload` so replays/audits are possible.
 * Even after PII redaction at write time (see src/lib/webhook-pii-redactor.ts),
 * the table grows unbounded and legacy rows predate the redactor. This script
 * deletes processed events older than N days to bound storage and shrink the
 * blast radius of any future data leak.
 *
 * WHY THIS EXISTS
 * ---------------
 * `WebhookEvent` rows are only needed while a Stripe event might still be
 * replayed or reconciled. Once `processed = true` and the event is older than
 * the retention window, the row has no operational value — the source of truth
 * for the donation lives in the `Donation` table. Keeping millions of raw
 * payloads forever is an unnecessary retention liability for a nonprofit that
 * processes donor PII.
 *
 * EXACT SQL RUN
 * -------------
 * Cutoff is computed in JS and bound as a timestamptz parameter:
 *
 *   const cutoff = new Date(Date.now() - retentionDays * 86_400_000);
 *
 * Count (always):
 *   SELECT COUNT(*)::int AS count
 *   FROM "WebhookEvent"
 *   WHERE "processed" = true AND "createdAt" < $1;
 *
 * Delete (only when APPLY=1):
 *   DELETE FROM "WebhookEvent"
 *   WHERE "processed" = true AND "createdAt" < $1;
 *
 * Both statements are tight, single-statement, atomic operations. No rows are
 * loaded into memory; only COUNT(*) and affected-row counts come back.
 *
 * IDEMPOTENCY GUARANTEE
 * ---------------------
 * The WHERE clause targets exactly the expired, fully-processed set. A row that
 * is still unprocessed, or newer than the retention window, is never matched.
 * Re-running the script after a successful APPLY therefore deletes 0 rows and
 * is safe to run any number of times.
 *
 * HOW TO RUN
 * ----------
 *   # 1. Preview (no writes) — default mode:
 *   DATABASE_URL='postgres://...' node scripts/reliability/prune-webhook-events.mjs
 *
 *   # 2. Apply for real against production:
 *   APPLY=1 DATABASE_URL='postgres://...' node scripts/reliability/prune-webhook-events.mjs
 *
 *   # 3. Apply with a custom retention window (default 30 days):
 *   APPLY=1 WEBHOOK_RETENTION_DAYS=60 DATABASE_URL='postgres://...' node scripts/reliability/prune-webhook-events.mjs
 *
 *   # 4. Apply against a localhost/dev DB (extra guard; see ALLOW_LOCAL note):
 *   APPLY=1 ALLOW_LOCAL=1 DATABASE_URL='postgres://...' node scripts/reliability/prune-webhook-events.mjs
 *
 * WHEN TO RUN
 * -----------
 * Run as a scheduled job (e.g. daily) in production. Safe to run any time;
 * pair with a monitoring alert on row count if desired.
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`ERROR: ${name} is required.`);
    console.error('Set DATABASE_URL to the target Postgres connection string.');
    process.exit(1);
  }
  return value;
}

function isLocalhost(databaseUrl) {
  try {
    const host = new URL(databaseUrl).hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '::1';
  } catch {
    return false;
  }
}

function resolveRetentionDays() {
  const raw = process.env.WEBHOOK_RETENTION_DAYS;
  if (raw === undefined || raw === '') return 30;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    console.error(
      `ERROR: WEBHOOK_RETENTION_DAYS must be a positive integer (got "${raw}").`,
    );
    process.exit(1);
  }
  return parsed;
}

async function main() {
  const databaseUrl = requireEnv('DATABASE_URL');
  const apply = process.env.APPLY === '1';
  const allowLocal = process.env.ALLOW_LOCAL === '1';
  const retentionDays = resolveRetentionDays();

  if (apply && isLocalhost(databaseUrl) && !allowLocal) {
    console.error(
      'ERROR: APPLY=1 against a localhost DATABASE_URL is blocked by default.',
    );
    console.error('Set ALLOW_LOCAL=1 to explicitly permit writes to a local DB.');
    process.exit(1);
  }

  // Compute the cutoff in JS and bind it as a parameter (avoids injecting the
  // retention value into the SQL string).
  const cutoff = new Date(Date.now() - retentionDays * 86_400_000);

  console.info('==========================================================');
  console.info(' prune-webhook-events');
  console.info(` mode: ${apply ? 'APPLY (writes enabled)' : 'DRY-RUN (no writes)'}`);
  console.info(` retention: processed events older than ${retentionDays} day(s)`);
  console.info(` cutoff: ${cutoff.toISOString()}`);
  console.info('==========================================================');

  const toBeDeleted = await prisma.$queryRaw`
    SELECT COUNT(*)::int AS count
    FROM "WebhookEvent"
    WHERE "processed" = true AND "createdAt" < ${cutoff}
  `;

  const matched = Number(toBeDeleted?.[0]?.count ?? 0);

  if (!apply) {
    console.info(`DRY-RUN: rows that WOULD be deleted: ${matched}`);
    if (matched === 0) {
      console.info('Nothing to prune. Table is within retention policy.');
    }
    console.info('Re-run with APPLY=1 to perform the delete.');
    return;
  }

  if (matched === 0) {
    console.info('Nothing to prune. Table is within retention policy.');
    return;
  }

  const affected = await prisma.$executeRaw`
    DELETE FROM "WebhookEvent"
    WHERE "processed" = true AND "createdAt" < ${cutoff}
  `;

  console.info(`APPLY: rows deleted: ${affected}`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error('Prune failed.');
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
