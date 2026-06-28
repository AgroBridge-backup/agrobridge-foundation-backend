-- Add DISPUTED and FAILED donation statuses.
--
-- Why: the webhook handler now reacts to charge.refunded (→ REFUNDED, already
-- present), charge.dispute.created (→ DISPUTED), and records failed renewals
-- (→ FAILED). Previously these events were silently marked processed, so a
-- refunded/disputed donation stayed SUCCEEDED forever — overstating totals and
-- allowing disbursement of refunded gifts.
--
-- ALTER TYPE ... ADD VALUE cannot run inside a transaction block on Postgres
-- versions older than 12; Prisma runs migrations transactionally, so guard each
-- value with IF NOT EXISTS (idempotent) and rely on PG12+ transactional DDL.

ALTER TYPE "DonationStatus" ADD VALUE IF NOT EXISTS 'DISPUTED';
ALTER TYPE "DonationStatus" ADD VALUE IF NOT EXISTS 'FAILED';
