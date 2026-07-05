-- Expand-only migration (§20.5) — two nullable columns, safe to run while
-- the app is live. No contract phase needed since nothing is being renamed
-- or dropped.

-- AlterTable
ALTER TABLE "Clip" ADD COLUMN "rejectionReason" TEXT;

-- AlterTable
ALTER TABLE "Short" ADD COLUMN "errorMessage" TEXT;
