BEGIN;

CREATE TYPE "PayrollCalculationStatus" AS ENUM ('DRAFT', 'LOCKED');
CREATE TYPE "PayrollLineDirection" AS ENUM ('EARNING', 'DEDUCTION');
CREATE TYPE "PayrollLineCategory" AS ENUM ('BASE_PAY', 'REGULAR_PAY', 'OVERTIME', 'REST_DAY', 'PUBLIC_HOLIDAY', 'PAID_LEAVE', 'UNPAID_LEAVE', 'ALLOWANCE', 'DEDUCTION', 'ADVANCE_REPAYMENT');

CREATE TABLE "PayrollCalculationRun" (
  "id" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "payPeriodId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "status" "PayrollCalculationStatus" NOT NULL DEFAULT 'DRAFT',
  "rulePackVersion" TEXT NOT NULL,
  "inputHash" TEXT NOT NULL,
  "totalGrossSen" INTEGER NOT NULL DEFAULT 0,
  "totalDeductionsSen" INTEGER NOT NULL DEFAULT 0,
  "totalCalculatedPaySen" INTEGER NOT NULL DEFAULT 0,
  "warningCount" INTEGER NOT NULL DEFAULT 0,
  "blockingWarningCount" INTEGER NOT NULL DEFAULT 0,
  "calculatedByUserId" TEXT NOT NULL,
  "lockedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PayrollCalculationRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PayrollCalculationResult" (
  "id" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "basePaySen" INTEGER NOT NULL DEFAULT 0,
  "regularPaySen" INTEGER NOT NULL DEFAULT 0,
  "overtimePaySen" INTEGER NOT NULL DEFAULT 0,
  "restDayPaySen" INTEGER NOT NULL DEFAULT 0,
  "publicHolidayPaySen" INTEGER NOT NULL DEFAULT 0,
  "paidLeavePaySen" INTEGER NOT NULL DEFAULT 0,
  "unpaidLeaveDeductionSen" INTEGER NOT NULL DEFAULT 0,
  "additionalEarningsSen" INTEGER NOT NULL DEFAULT 0,
  "otherDeductionsSen" INTEGER NOT NULL DEFAULT 0,
  "advanceDeductionSen" INTEGER NOT NULL DEFAULT 0,
  "grossPaySen" INTEGER NOT NULL DEFAULT 0,
  "totalDeductionsSen" INTEGER NOT NULL DEFAULT 0,
  "calculatedPaySen" INTEGER NOT NULL DEFAULT 0,
  "warnings" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "blockingWarnings" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "payProfileSnapshot" JSONB,
  "inputSummary" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PayrollCalculationResult_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PayrollCalculationLine" (
  "id" TEXT NOT NULL,
  "resultId" TEXT NOT NULL,
  "direction" "PayrollLineDirection" NOT NULL,
  "category" "PayrollLineCategory" NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "amountSen" INTEGER NOT NULL,
  "basis" TEXT NOT NULL,
  "sourceComponentAssignmentId" TEXT,
  "metadata" JSONB,
  "displayOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PayrollCalculationLine_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PayrollCalculationRun_payPeriodId_version_key" ON "PayrollCalculationRun"("payPeriodId", "version");
CREATE INDEX "PayrollCalculationRun_clientId_createdAt_idx" ON "PayrollCalculationRun"("clientId", "createdAt");
CREATE INDEX "PayrollCalculationRun_payPeriodId_status_version_idx" ON "PayrollCalculationRun"("payPeriodId", "status", "version");
CREATE UNIQUE INDEX "PayrollCalculationResult_runId_employeeId_key" ON "PayrollCalculationResult"("runId", "employeeId");
CREATE INDEX "PayrollCalculationResult_employeeId_createdAt_idx" ON "PayrollCalculationResult"("employeeId", "createdAt");
CREATE INDEX "PayrollCalculationLine_resultId_displayOrder_idx" ON "PayrollCalculationLine"("resultId", "displayOrder");
CREATE INDEX "PayrollCalculationLine_sourceComponentAssignmentId_idx" ON "PayrollCalculationLine"("sourceComponentAssignmentId");

ALTER TABLE "PayrollCalculationRun" ADD CONSTRAINT "PayrollCalculationRun_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PayrollCalculationRun" ADD CONSTRAINT "PayrollCalculationRun_payPeriodId_fkey" FOREIGN KEY ("payPeriodId") REFERENCES "PayPeriod"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PayrollCalculationResult" ADD CONSTRAINT "PayrollCalculationResult_runId_fkey" FOREIGN KEY ("runId") REFERENCES "PayrollCalculationRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PayrollCalculationResult" ADD CONSTRAINT "PayrollCalculationResult_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PayrollCalculationLine" ADD CONSTRAINT "PayrollCalculationLine_resultId_fkey" FOREIGN KEY ("resultId") REFERENCES "PayrollCalculationResult"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PayrollCalculationLine" ADD CONSTRAINT "PayrollCalculationLine_sourceComponentAssignmentId_fkey" FOREIGN KEY ("sourceComponentAssignmentId") REFERENCES "EmployeePayComponent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

COMMIT;
