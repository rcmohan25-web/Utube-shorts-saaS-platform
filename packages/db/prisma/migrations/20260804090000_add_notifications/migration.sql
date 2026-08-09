-- Expand-only migration (§20.5) — new enum + table, nothing renamed or
-- dropped, safe to run while the app is live.

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM (
  'SHORTS_READY', 'SHORT_PUBLISHED', 'PIPELINE_FAILURE',
  'QUOTA_WARNING', 'QUOTA_EXCEEDED', 'TEAM_INVITE',
  'PAYMENT_FAILED', 'WEEKLY_DIGEST'
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "actionUrl" TEXT,
    "metadata" JSONB,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Notification_organizationId_readAt_idx" ON "Notification"("organizationId", "readAt");

-- CreateIndex
CREATE INDEX "Notification_organizationId_createdAt_idx" ON "Notification"("organizationId", "createdAt");

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
