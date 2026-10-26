BEGIN;

CREATE TYPE "PayrollJurisdiction" AS ENUM ('PENINSULAR_LABUAN', 'SABAH', 'SARAWAK');
CREATE TYPE "PayrollFrequency" AS ENUM ('MONTHLY', 'SEMI_MONTHLY', 'WEEKLY');
CREATE TYPE "PayType" AS ENUM ('MONTHLY', 'DAILY', 'HOURLY');
CREATE TYPE "PayrollComponentType" AS ENUM ('EARNING', 'DEDUCTION', 'ADVANCE_REPAYMENT');
CREATE TYPE "PayrollCalculationBasis" AS ENUM ('FIXED_AMOUNT', 'PER_DAY', 'PER_HOUR', 'PERCENTAGE');

ALTER TABLE "OrganizationMembership"
ADD COLUMN "canManagePayroll" BOOLEAN NOT NULL DEFAULT false;

UPDATE "OrganizationMembership"
SET "canManagePayroll" = true
WHERE "role" = 'ADMIN';

CREATE TABLE "PayrollSettings" (
  "id" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "jurisdiction" "PayrollJurisdiction" NOT NULL DEFAULT 'PENINSULAR_LABUAN',
  "currency" TEXT NOT NULL DEFAULT 'MYR',
  "payFrequency" "PayrollFrequency" NOT NULL DEFAULT 'MONTHLY',
  "normalDailyMinutes" INTEGER NOT NULL DEFAULT 480,
  "normalWeeklyMinutes" INTEGER NOT NULL DEFAULT 2700,
  "salaryDivisor" INTEGER NOT NULL DEFAULT 26,
  "rulePackVersion" TEXT NOT NULL DEFAULT 'MY-PEN-2023-01',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PayrollSettings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PayProfile" (
  "id" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "payType" "PayType" NOT NULL,
  "baseRateSen" INTEGER NOT NULL,
  "normalDailyMinutes" INTEGER NOT NULL,
  "normalWeeklyMinutes" INTEGER NOT NULL,
  "overtimeEligible" BOOLEAN NOT NULL DEFAULT true,
  "effectiveFrom" TEXT NOT NULL,
  "effectiveTo" TEXT,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PayProfile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PayrollComponent" (
  "id" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "type" "PayrollComponentType" NOT NULL,
  "calculationBasis" "PayrollCalculationBasis" NOT NULL,
  "defaultAmountSen" INTEGER NOT NULL DEFAULT 0,
  "defaultPercentageBps" INTEGER,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PayrollComponent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EmployeePayComponent" (
  "id" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "payrollComponentId" TEXT NOT NULL,
  "amountSen" INTEGER NOT NULL DEFAULT 0,
  "percentageBasisPoints" INTEGER,
  "totalAmountSen" INTEGER,
  "outstandingAmountSen" INTEGER,
  "effectiveFrom" TEXT NOT NULL,
  "effectiveTo" TEXT,
  "consentReference" TEXT,
  "notes" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EmployeePayComponent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PayrollSettings_clientId_key" ON "PayrollSettings"("clientId");
CREATE UNIQUE INDEX "PayProfile_employeeId_effectiveFrom_key" ON "PayProfile"("employeeId", "effectiveFrom");
CREATE INDEX "PayProfile_employeeId_effectiveFrom_effectiveTo_idx" ON "PayProfile"("employeeId", "effectiveFrom", "effectiveTo");
CREATE UNIQUE INDEX "PayrollComponent_clientId_code_key" ON "PayrollComponent"("clientId", "code");
CREATE INDEX "PayrollComponent_clientId_type_isActive_idx" ON "PayrollComponent"("clientId", "type", "isActive");
CREATE UNIQUE INDEX "EmployeePayComponent_employeeId_payrollComponentId_effectiveFrom_key" ON "EmployeePayComponent"("employeeId", "payrollComponentId", "effectiveFrom");
CREATE INDEX "EmployeePayComponent_clientId_employeeId_isActive_idx" ON "EmployeePayComponent"("clientId", "employeeId", "isActive");
CREATE INDEX "EmployeePayComponent_payrollComponentId_effectiveFrom_effectiveTo_idx" ON "EmployeePayComponent"("payrollComponentId", "effectiveFrom", "effectiveTo");

ALTER TABLE "PayrollSettings" ADD CONSTRAINT "PayrollSettings_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PayProfile" ADD CONSTRAINT "PayProfile_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PayrollComponent" ADD CONSTRAINT "PayrollComponent_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EmployeePayComponent" ADD CONSTRAINT "EmployeePayComponent_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EmployeePayComponent" ADD CONSTRAINT "EmployeePayComponent_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EmployeePayComponent" ADD CONSTRAINT "EmployeePayComponent_payrollComponentId_fkey" FOREIGN KEY ("payrollComponentId") REFERENCES "PayrollComponent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
