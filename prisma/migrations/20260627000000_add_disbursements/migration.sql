-- Add manual disbursement tracking (money-out audit records).
--
-- Disbursements are MANUAL: a human transfers funds to a producer offline and
-- the software only RECORDS the transfer for audit + donor-facing reporting.
-- See prisma/schema.prisma (model Disbursement) for the full design rationale.

-- CreateEnum
CREATE TYPE "DisbursementMethod" AS ENUM ('BANK_TRANSFER', 'MANUAL_STRIPE', 'OTHER');

-- CreateEnum
CREATE TYPE "DisbursementStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED', 'REVERSED');

-- CreateTable
CREATE TABLE "Disbursement" (
    "id" UUID NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "recipientName" VARCHAR(200) NOT NULL,
    "recipientIdentifier" VARCHAR(255) NOT NULL,
    "method" "DisbursementMethod" NOT NULL DEFAULT 'BANK_TRANSFER',
    "externalReference" VARCHAR(255),
    "status" "DisbursementStatus" NOT NULL DEFAULT 'PENDING',
    "disbursedAt" TIMESTAMP(3),
    "notes" TEXT,
    "metadata" JSONB,
    "createdBy" UUID,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Disbursement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DisbursementLine" (
    "id" UUID NOT NULL,
    "disbursementId" UUID NOT NULL,
    "donationId" UUID NOT NULL,
    "appliedAmount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DisbursementLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Disbursement_status_createdAt_idx" ON "Disbursement"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Disbursement_recipientName_idx" ON "Disbursement"("recipientName");

-- CreateIndex
CREATE INDEX "Disbursement_createdBy_idx" ON "Disbursement"("createdBy");

-- CreateIndex
CREATE INDEX "Disbursement_deletedAt_idx" ON "Disbursement"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "DisbursementLine_donationId_key" ON "DisbursementLine"("donationId");

-- CreateIndex
CREATE INDEX "DisbursementLine_disbursementId_idx" ON "DisbursementLine"("disbursementId");

-- AddForeignKey
ALTER TABLE "DisbursementLine" ADD CONSTRAINT "DisbursementLine_disbursementId_fkey" FOREIGN KEY ("disbursementId") REFERENCES "Disbursement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DisbursementLine" ADD CONSTRAINT "DisbursementLine_donationId_fkey" FOREIGN KEY ("donationId") REFERENCES "Donation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
