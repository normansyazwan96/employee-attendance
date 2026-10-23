CREATE TYPE "PayPeriodStatus" AS ENUM ('DRAFT', 'REVIEWED', 'APPROVED', 'LOCKED', 'EXPORTED');
CREATE TYPE "ExportJobStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'EXPIRED');
CREATE TYPE "ExportFormat" AS ENUM ('CSV', 'XLSX');

CREATE TABLE "PayPeriod" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startDate" TEXT NOT NULL,
    "endDate" TEXT NOT NULL,
    "status" "PayPeriodStatus" NOT NULL DEFAULT 'DRAFT',
    "reviewedByUserId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "lockedByUserId" TEXT,
    "lockedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayPeriod_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PayPeriod_date_order" CHECK ("startDate" <= "endDate")
);

CREATE TABLE "PayrollAdjustment" (
    "id" TEXT NOT NULL,
    "payPeriodId" TEXT NOT NULL,
    "timesheetDayId" TEXT NOT NULL,
    "correctionId" TEXT,
    "adjustmentType" TEXT NOT NULL,
    "minutes" INTEGER NOT NULL DEFAULT 0,
    "reason" TEXT NOT NULL,
    "beforeValues" JSONB NOT NULL,
    "afterValues" JSONB NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayrollAdjustment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ExportJob" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "payPeriodId" TEXT NOT NULL,
    "format" "ExportFormat" NOT NULL,
    "status" "ExportJobStatus" NOT NULL DEFAULT 'PENDING',
    "template" JSONB,
    "r2Key" TEXT,
    "fileName" TEXT,
    "contentType" TEXT,
    "fileSizeBytes" INTEGER,
    "expiresAt" TIMESTAMP(3),
    "lastError" TEXT,
    "requestedByUserId" TEXT NOT NULL,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExportJob_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "TimesheetDay" ADD COLUMN "payPeriodId" TEXT;

CREATE UNIQUE INDEX "PayPeriod_clientId_startDate_endDate_key" ON "PayPeriod"("clientId", "startDate", "endDate");
CREATE INDEX "PayPeriod_clientId_status_startDate_idx" ON "PayPeriod"("clientId", "status", "startDate");
CREATE UNIQUE INDEX "PayrollAdjustment_correctionId_key" ON "PayrollAdjustment"("correctionId");
CREATE INDEX "PayrollAdjustment_payPeriodId_createdAt_idx" ON "PayrollAdjustment"("payPeriodId", "createdAt");
CREATE INDEX "PayrollAdjustment_timesheetDayId_idx" ON "PayrollAdjustment"("timesheetDayId");
CREATE INDEX "ExportJob_clientId_status_createdAt_idx" ON "ExportJob"("clientId", "status", "createdAt");
CREATE INDEX "ExportJob_payPeriodId_createdAt_idx" ON "ExportJob"("payPeriodId", "createdAt");
CREATE INDEX "TimesheetDay_payPeriodId_idx" ON "TimesheetDay"("payPeriodId");

ALTER TABLE "PayPeriod" ADD CONSTRAINT "PayPeriod_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PayrollAdjustment" ADD CONSTRAINT "PayrollAdjustment_payPeriodId_fkey" FOREIGN KEY ("payPeriodId") REFERENCES "PayPeriod"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PayrollAdjustment" ADD CONSTRAINT "PayrollAdjustment_timesheetDayId_fkey" FOREIGN KEY ("timesheetDayId") REFERENCES "TimesheetDay"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PayrollAdjustment" ADD CONSTRAINT "PayrollAdjustment_correctionId_fkey" FOREIGN KEY ("correctionId") REFERENCES "AttendanceCorrection"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ExportJob" ADD CONSTRAINT "ExportJob_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExportJob" ADD CONSTRAINT "ExportJob_payPeriodId_fkey" FOREIGN KEY ("payPeriodId") REFERENCES "PayPeriod"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TimesheetDay" ADD CONSTRAINT "TimesheetDay_payPeriodId_fkey" FOREIGN KEY ("payPeriodId") REFERENCES "PayPeriod"("id") ON DELETE SET NULL ON UPDATE CASCADE;
