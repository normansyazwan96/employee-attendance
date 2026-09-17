-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN "clientId" TEXT;

-- CreateIndex
CREATE INDEX "AuditLog_clientId_createdAt_idx" ON "AuditLog"("clientId", "createdAt");
