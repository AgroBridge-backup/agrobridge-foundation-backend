#!/usr/bin/env node

/**
 * backfill-recurring-donation-type.mjs
 * ====================================
 *
 * PURPOSE
 * -------
 * One-time, idempotent backfill that corrects historical `Donation` rows whose
 * `type` was persisted incorrectly as `ONE_TIME` even though they are recurring
 * (monthly) gifts backed by a Stripe subscription.
 *
 * WHY THIS EXISTS
 * ---------------
 * Before PR #11 shipped, the donation-creation code never wrote the `type`
 * field, so every donation fell back to the schema default (`ONE_TIME`). As a
 * result, recurring gifts created pre-#11 are stored with `type = 'ONE_TIME'`
 * while still carrying a populated `stripeSubscriptionId`. After #11 deployed,
 * new recurring donations are written correctly; this script repairs the legacy
 * rows so reporting, receipts, and aggregates stop misclassifying monthly gifts
 * as one-time.
 *
 * EXACT SQL RUN
 * -------------
 * Count (always):
 *   SELECT COUNT(*) FROM "Donation"
 *   WHERE "stripeSubscriptionId" IS NOT NULL AND "type" = 'ONE_TIME';
 *
 * Update (only when APPLY=1):
 *   UPDATE "Donation"
 *   SET "type" = 'RECURRING'
 *   WHERE "stripeSubscriptionId" IS NOT NULL AND "type" = 'ONE_TIME';
 *
 * Both statements are tight, single-statement, atomic operations. No rows are
 * loaded into memory; only COUNT(*) and affected-row counts come back.
 *
 * IDEMPOTENCY GUARANTEE
 * ---------------------
 * The WHERE clause targets exactly the inconsistent set: a row that already has
 * `type = 'RECURRING'` (or a NULL subscription id) is never matched. Re-running
 * the script after a successful APPLY therefore affects 0 rows and is safe to
 * run any number of times.
 *
 * HOW TO RUN
 * ----------
 *   # 1. Preview (no writes) — default mode:
 *   DATABASE_URL='postgres://...' node scripts/reliability/backfill-recurring-donation-type.mjs
 *
 *   # 2. Apply for real against production:
 *   APPLY=1 DATABASE_URL='postgres://...' node scripts/reliability/backfill-recurring-donation-type.mjs
 *
 *   # 3. Apply against a localhost/dev DB (extra guard; see ALLOW_LOCAL note):
 *   APPLY=1 ALLOW_LOCAL=1 DATABASE_URL='postgres://...' node scripts/reliability/backfill-recurring-donation-type.mjs
 *
 * WHEN TO RUN
 * -----------
 * Run ONCE, against production, AFTER PR #11 is fully live and serving traffic
 * (so no new rows are being written with the bad default). Part of the
 * post-deploy runbook for #11.
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

async function main() {
  const databaseUrl = requireEnv('DATABASE_URL');
  const apply = process.env.APPLY === '1';
  const allowLocal = process.env.ALLOW_LOCAL === '1';

  if (apply && isLocalhost(databaseUrl) && !allowLocal) {
    console.error(
      'ERROR: APPLY=1 against a localhost DATABASE_URL is blocked by default.',
    );
    console.error('Set ALLOW_LOCAL=1 to explicitly permit writes to a local DB.');
    process.exit(1);
  }

  console.info('==========================================================');
  console.info(' backfill-recurring-donation-type');
  console.info(` mode: ${apply ? 'APPLY (writes enabled)' : 'DRY-RUN (no writes)'}`);
  console.info('==========================================================');

  const toBeCorrected = await prisma.$queryRaw`
    SELECT COUNT(*)::int AS count
    FROM "Donation"
    WHERE "stripeSubscriptionId" IS NOT NULL AND "type" = 'ONE_TIME'
  `;

  const matched = Number(toBeCorrected?.[0]?.count ?? 0);

  if (!apply) {
    console.info(`DRY-RUN: rows that WOULD be corrected: ${matched}`);
    if (matched === 0) {
      console.info('Nothing to backfill. Database is already consistent.');
    }
    console.info('Re-run with APPLY=1 to perform the update.');
    return;
  }

  if (matched === 0) {
    console.info('Nothing to backfill. Database is already consistent.');
    return;
  }

  const affected = await prisma.$executeRaw`
    UPDATE "Donation"
    SET "type" = 'RECURRING'
    WHERE "stripeSubscriptionId" IS NOT NULL AND "type" = 'ONE_TIME'
  `;

  console.info(`APPLY: rows updated: ${affected}`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error('Backfill failed.');
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
