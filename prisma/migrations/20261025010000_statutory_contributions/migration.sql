-- Statutory contribution categories and payroll line classifications.
ALTER TYPE "PayrollLineDirection" ADD VALUE 'EMPLOYER_CONTRIBUTION';
ALTER TYPE "PayrollLineCategory" ADD VALUE 'EPF';
ALTER TYPE "PayrollLineCategory" ADD VALUE 'SOCSO';
ALTER TYPE "PayrollLineCategory" ADD VALUE 'EIS';

CREATE TYPE "EpfContributionCategory" AS ENUM (
  'STANDARD_UNDER_60',
  'PR_OR_PRE_1998_60_PLUS',
  'MALAYSIAN_60_PLUS',
  'NON_MALAYSIAN',
  'EXEMPT'
);

CREATE TYPE "SocsoContributionCategory" AS ENUM ('FIRST', 'SECOND', 'EXEMPT');

ALTER TABLE "PayrollSettings"
  ADD COLUMN "statutoryContributionsEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "statutoryRuleVersion" TEXT NOT NULL DEFAULT 'MY-STAT-2025-10-01';

ALTER TABLE "PayrollComponent"
  ADD COLUMN "epfEligible" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "socsoEligible" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "eisEligible" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "PayrollCalculationResult"
  ADD COLUMN "epfWagesSen" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "socsoWagesSen" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "eisWagesSen" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "epfEmployeeSen" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "epfEmployerSen" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "socsoEmployeeSen" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "socsoEmployerSen" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "eisEmployeeSen" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "eisEmployerSen" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "employerContributionsSen" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "EmployeeStatutoryProfile" (
  "id" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "epfCategory" "EpfContributionCategory" NOT NULL,
  "socsoCategory" "SocsoContributionCategory" NOT NULL,
  "eisEligible" BOOLEAN NOT NULL DEFAULT true,
  "effectiveFrom" TEXT NOT NULL,
  "effectiveTo" TEXT,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EmployeeStatutoryProfile_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EmployeeStatutoryProfile_employeeId_effectiveFrom_key"
  ON "EmployeeStatutoryProfile"("employeeId", "effectiveFrom");
CREATE INDEX "EmployeeStatutoryProfile_employeeId_effectiveFrom_effectiveTo_idx"
  ON "EmployeeStatutoryProfile"("employeeId", "effectiveFrom", "effectiveTo");

ALTER TABLE "EmployeeStatutoryProfile"
  ADD CONSTRAINT "EmployeeStatutoryProfile_employeeId_fkey"
  FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
