-- Add append-only status history to Disbursement for auditing status rewrites.
--
-- Each status transition appends {from, to, at, by} to the JSONB array
-- (read-modify-write at the application layer; null is treated as []).
-- Nullable (no default) to match the existing nullable Json columns (metadata);
-- existing rows simply have NULL until their first transition.
ALTER TABLE "Disbursement" ADD COLUMN "statusHistory" JSONB;
