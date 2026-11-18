-- PR 14: Expand-only migration (§20.5) — new enum + a new column with a
-- default (safe: existing rows backfill to 'READ_WRITE', preserving
-- pre-PR-14 behavior where every key could do everything the
-- API_ACCESS-gated routes expose). Nothing renamed or dropped, safe to
-- run while the app is live.

-- CreateEnum
CREATE TYPE "ApiKeyScope" AS ENUM ('READ_ONLY', 'READ_WRITE');

-- AlterTable
ALTER TABLE "ApiKey" ADD COLUMN "scope" "ApiKeyScope" NOT NULL DEFAULT 'READ_WRITE';
