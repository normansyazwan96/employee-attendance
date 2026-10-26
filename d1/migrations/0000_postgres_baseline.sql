-- Generated from prisma/schema.prisma by scripts/d1/generate-baseline.mjs.

-- DateTime values use Unix epoch milliseconds; JSON and scalar lists use JSON text.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS "Client" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "name" TEXT NOT NULL,
  "stateCode" TEXT,
  "createdAt" INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  "updatedAt" INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS "User" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "username" TEXT NOT NULL UNIQUE,
  "email" TEXT UNIQUE,
  "passwordHash" TEXT NOT NULL,
  "passwordVersion" INTEGER NOT NULL DEFAULT 0,
  "mustChangePassword" INTEGER NOT NULL DEFAULT 0 CHECK ("mustChangePassword" IN (0, 1)),
  "role" TEXT NOT NULL DEFAULT 'EMPLOYEE' CHECK ("role" IN ('EMPLOYEE', 'ADMIN', 'MANAGER', 'DEV_ADMIN')),
  "platformRole" TEXT NOT NULL DEFAULT 'USER' CHECK ("platformRole" IN ('USER', 'DEV_ADMIN')),
  "isActive" INTEGER NOT NULL DEFAULT 1 CHECK ("isActive" IN (0, 1)),
  "failedLoginAttempts" INTEGER NOT NULL DEFAULT 0,
  "lockedUntil" INTEGER,
  "lastLoginAt" INTEGER,
  "displayName" TEXT,
  "clientId" TEXT,
  "createdByUserId" TEXT,
  "createdAt" INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  "updatedAt" INTEGER NOT NULL,
  FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE SET NULL,
  FOREIGN KEY ("createdByUserId") REFERENCES "User" ("id") ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS "OrganizationMembership" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "userId" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "role" TEXT NOT NULL CHECK ("role" IN ('ADMIN', 'MANAGER', 'EMPLOYEE')),
  "status" TEXT NOT NULL DEFAULT 'ACTIVE' CHECK ("status" IN ('ACTIVE', 'INACTIVE')),
  "managerMembershipId" TEXT,
  "canManagePayroll" INTEGER NOT NULL DEFAULT 0 CHECK ("canManagePayroll" IN (0, 1)),
  "createdAt" INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  "updatedAt" INTEGER NOT NULL,
  UNIQUE ("userId", "clientId"),
  FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE,
  FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE CASCADE,
  FOREIGN KEY ("managerMembershipId") REFERENCES "OrganizationMembership" ("id") ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS "AuthSession" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "userId" TEXT NOT NULL,
  "refreshTokenHash" TEXT NOT NULL UNIQUE,
  "familyId" TEXT NOT NULL,
  "expiresAt" INTEGER NOT NULL,
  "lastUsedAt" INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  "revokedAt" INTEGER,
  "rotatedFromId" TEXT,
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "createdAt" INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  "updatedAt" INTEGER NOT NULL,
  FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "PasswordResetToken" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "userId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL UNIQUE,
  "expiresAt" INTEGER NOT NULL,
  "usedAt" INTEGER,
  "createdAt" INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "MfaCredential" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "userId" TEXT NOT NULL UNIQUE,
  "encryptedSecret" TEXT NOT NULL,
  "enabled" INTEGER NOT NULL DEFAULT 0 CHECK ("enabled" IN (0, 1)),
  "verifiedAt" INTEGER,
  "createdAt" INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  "updatedAt" INTEGER NOT NULL,
  FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "MfaRecoveryCode" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "mfaCredentialId" TEXT NOT NULL,
  "codeHash" TEXT NOT NULL UNIQUE,
  "usedAt" INTEGER,
  "createdAt" INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  FOREIGN KEY ("mfaCredentialId") REFERENCES "MfaCredential" ("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "Employee" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "firstName" TEXT NOT NULL,
  "lastName" TEXT NOT NULL,
  "userId" TEXT NOT NULL UNIQUE,
  "employeeNumber" TEXT,
  "employmentStatus" TEXT NOT NULL DEFAULT 'ACTIVE' CHECK ("employmentStatus" IN ('ACTIVE', 'ON_LEAVE', 'TERMINATED')),
  "joinDate" INTEGER,
  "terminationDate" INTEGER,
  "departmentId" TEXT,
  "managerEmployeeId" TEXT,
  "createdAt" INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  "updatedAt" INTEGER NOT NULL,
  FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE,
  FOREIGN KEY ("departmentId") REFERENCES "Department" ("id") ON DELETE SET NULL,
  FOREIGN KEY ("managerEmployeeId") REFERENCES "Employee" ("id") ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS "Department" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "clientId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "code" TEXT,
  "isActive" INTEGER NOT NULL DEFAULT 1 CHECK ("isActive" IN (0, 1)),
  "createdAt" INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  "updatedAt" INTEGER NOT NULL,
  UNIQUE ("clientId", "name"),
  UNIQUE ("clientId", "code"),
  FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "WorkPolicy" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "clientId" TEXT NOT NULL UNIQUE,
  "gracePeriodMinutes" INTEGER NOT NULL DEFAULT 10,
  "defaultBreakMinutes" INTEGER NOT NULL DEFAULT 60,
  "roundingIncrement" INTEGER NOT NULL DEFAULT 1,
  "overtimeThreshold" INTEGER NOT NULL DEFAULT 480,
  "maximumShiftMinutes" INTEGER NOT NULL DEFAULT 960,
  "missedClockOutMinutes" INTEGER NOT NULL DEFAULT 960,
  "maximumGpsAccuracy" INTEGER NOT NULL DEFAULT 100,
  "exactGpsRetentionDays" INTEGER NOT NULL DEFAULT 90,
  "createdAt" INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  "updatedAt" INTEGER NOT NULL,
  FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "ShiftTemplate" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "clientId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "workDays" TEXT NOT NULL CHECK ("workDays" IS NULL OR json_valid("workDays")),
  "startTime" TEXT NOT NULL,
  "endTime" TEXT NOT NULL,
  "breakMinutes" INTEGER NOT NULL DEFAULT 60,
  "gracePeriodMinutes" INTEGER NOT NULL DEFAULT 10,
  "isOvernight" INTEGER NOT NULL DEFAULT 0 CHECK ("isOvernight" IN (0, 1)),
  "isActive" INTEGER NOT NULL DEFAULT 1 CHECK ("isActive" IN (0, 1)),
  "createdAt" INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  "updatedAt" INTEGER NOT NULL,
  UNIQUE ("clientId", "name"),
  FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "ScheduleAssignment" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "employeeId" TEXT NOT NULL,
  "shiftTemplateId" TEXT NOT NULL,
  "effectiveFrom" TEXT NOT NULL,
  "effectiveTo" TEXT,
  "createdAt" INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  "updatedAt" INTEGER NOT NULL,
  UNIQUE ("employeeId", "effectiveFrom"),
  FOREIGN KEY ("employeeId") REFERENCES "Employee" ("id") ON DELETE CASCADE,
  FOREIGN KEY ("shiftTemplateId") REFERENCES "ShiftTemplate" ("id") ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS "Holiday" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "clientId" TEXT NOT NULL,
  "date" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "stateCode" TEXT,
  "isWorkingDayOverride" INTEGER NOT NULL DEFAULT 0 CHECK ("isWorkingDayOverride" IN (0, 1)),
  "source" TEXT NOT NULL DEFAULT 'ORGANIZATION',
  "createdAt" INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  "updatedAt" INTEGER NOT NULL,
  UNIQUE ("clientId", "date", "name"),
  FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "EmployeeSchedule" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "employeeId" TEXT NOT NULL UNIQUE,
  "workDays" TEXT NOT NULL CHECK ("workDays" IS NULL OR json_valid("workDays")),
  "startTime" TEXT NOT NULL,
  "endTime" TEXT NOT NULL,
  "gracePeriodMinutes" INTEGER NOT NULL DEFAULT 10,
  "isActive" INTEGER NOT NULL DEFAULT 1 CHECK ("isActive" IN (0, 1)),
  "createdAt" INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  "updatedAt" INTEGER NOT NULL,
  FOREIGN KEY ("employeeId") REFERENCES "Employee" ("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "AttendanceRecord" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "employeeId" TEXT NOT NULL,
  "workDate" TEXT NOT NULL,
  "clockInAt" INTEGER NOT NULL,
  "clockOutAt" INTEGER,
  "clockInLatitude" REAL,
  "clockInLongitude" REAL,
  "clockInAccuracy" REAL,
  "clockOutLatitude" REAL,
  "clockOutLongitude" REAL,
  "clockOutAccuracy" REAL,
  "status" TEXT NOT NULL DEFAULT 'CLOCKED_IN' CHECK ("status" IN ('CLOCKED_IN', 'CLOCKED_OUT')),
  "createdAt" INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  "updatedAt" INTEGER NOT NULL,
  UNIQUE ("employeeId", "workDate"),
  FOREIGN KEY ("employeeId") REFERENCES "Employee" ("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "AttendanceEvent" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "employeeId" TEXT NOT NULL,
  "clientId" TEXT,
  "workDate" TEXT NOT NULL,
  "type" TEXT NOT NULL CHECK ("type" IN ('CLOCK_IN', 'CLOCK_OUT', 'BREAK_START', 'BREAK_END')),
  "source" TEXT NOT NULL DEFAULT 'MOBILE_GPS' CHECK ("source" IN ('MOBILE_GPS', 'ADMIN_ADJUSTMENT', 'MIGRATION')),
  "occurredAt" INTEGER NOT NULL,
  "worksiteId" TEXT,
  "latitude" REAL,
  "longitude" REAL,
  "accuracyMeters" REAL,
  "distanceMeters" REAL,
  "acceptedRadiusMeters" INTEGER,
  "idempotencyKey" TEXT NOT NULL,
  "createdByUserId" TEXT,
  "deviceDetails" TEXT CHECK ("deviceDetails" IS NULL OR json_valid("deviceDetails")),
  "createdAt" INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  UNIQUE ("employeeId", "idempotencyKey"),
  FOREIGN KEY ("employeeId") REFERENCES "Employee" ("id") ON DELETE CASCADE,
  FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE CASCADE,
  FOREIGN KEY ("worksiteId") REFERENCES "Worksite" ("id") ON DELETE SET NULL,
  FOREIGN KEY ("createdByUserId") REFERENCES "User" ("id") ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS "WebhookDelivery" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "clientId" TEXT NOT NULL,
  "attendanceEventId" TEXT NOT NULL UNIQUE,
  "eventType" TEXT NOT NULL,
  "payload" TEXT NOT NULL CHECK ("payload" IS NULL OR json_valid("payload")),
  "status" TEXT NOT NULL DEFAULT 'PENDING' CHECK ("status" IN ('PENDING', 'RETRYING', 'DELIVERED', 'DEAD_LETTER')),
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "lastAttemptAt" INTEGER,
  "responseStatus" INTEGER,
  "lastError" TEXT,
  "deliveredAt" INTEGER,
  "createdAt" INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  "updatedAt" INTEGER NOT NULL,
  FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE CASCADE,
  FOREIGN KEY ("attendanceEventId") REFERENCES "AttendanceEvent" ("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "TimesheetDay" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "employeeId" TEXT NOT NULL,
  "clientId" TEXT,
  "workDate" TEXT NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'OPEN' CHECK ("state" IN ('OPEN', 'COMPLETE', 'EXCEPTION', 'APPROVED', 'LOCKED')),
  "firstClockInAt" INTEGER,
  "lastClockOutAt" INTEGER,
  "regularMinutes" INTEGER NOT NULL DEFAULT 0,
  "overtimeMinutes" INTEGER NOT NULL DEFAULT 0,
  "breakMinutes" INTEGER NOT NULL DEFAULT 0,
  "lateMinutes" INTEGER NOT NULL DEFAULT 0,
  "earlyDepartureMinutes" INTEGER NOT NULL DEFAULT 0,
  "leaveMinutes" INTEGER NOT NULL DEFAULT 0,
  "paidLeaveMinutes" INTEGER NOT NULL DEFAULT 0,
  "unpaidLeaveMinutes" INTEGER NOT NULL DEFAULT 0,
  "isAbsent" INTEGER NOT NULL DEFAULT 0 CHECK ("isAbsent" IN (0, 1)),
  "exceptionCodes" TEXT NOT NULL DEFAULT '[]' CHECK ("exceptionCodes" IS NULL OR json_valid("exceptionCodes")),
  "version" INTEGER NOT NULL DEFAULT 1,
  "approvedAt" INTEGER,
  "lockedAt" INTEGER,
  "createdAt" INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  "updatedAt" INTEGER NOT NULL,
  "payPeriodId" TEXT,
  UNIQUE ("employeeId", "workDate"),
  FOREIGN KEY ("employeeId") REFERENCES "Employee" ("id") ON DELETE CASCADE,
  FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE CASCADE,
  FOREIGN KEY ("payPeriodId") REFERENCES "PayPeriod" ("id") ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS "AttendanceCorrection" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "employeeId" TEXT NOT NULL,
  "timesheetDayId" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "note" TEXT,
  "originalValues" TEXT NOT NULL CHECK ("originalValues" IS NULL OR json_valid("originalValues")),
  "requestedValues" TEXT NOT NULL CHECK ("requestedValues" IS NULL OR json_valid("requestedValues")),
  "status" TEXT NOT NULL DEFAULT 'PENDING' CHECK ("status" IN ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED')),
  "reviewedByUserId" TEXT,
  "reviewNote" TEXT,
  "reviewedAt" INTEGER,
  "createdAt" INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  "updatedAt" INTEGER NOT NULL,
  FOREIGN KEY ("employeeId") REFERENCES "Employee" ("id") ON DELETE CASCADE,
  FOREIGN KEY ("timesheetDayId") REFERENCES "TimesheetDay" ("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "PayPeriod" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "clientId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "startDate" TEXT NOT NULL,
  "endDate" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT' CHECK ("status" IN ('DRAFT', 'REVIEWED', 'APPROVED', 'LOCKED', 'EXPORTED')),
  "reviewedByUserId" TEXT,
  "reviewedAt" INTEGER,
  "reviewedCalculationRunId" TEXT,
  "approvedByUserId" TEXT,
  "approvedAt" INTEGER,
  "approvedCalculationRunId" TEXT,
  "lockedByUserId" TEXT,
  "lockedAt" INTEGER,
  "createdAt" INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  "updatedAt" INTEGER NOT NULL,
  UNIQUE ("clientId", "startDate", "endDate"),
  FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "PayrollSettings" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "clientId" TEXT NOT NULL UNIQUE,
  "jurisdiction" TEXT NOT NULL DEFAULT 'PENINSULAR_LABUAN' CHECK ("jurisdiction" IN ('PENINSULAR_LABUAN', 'SABAH', 'SARAWAK')),
  "currency" TEXT NOT NULL DEFAULT 'MYR',
  "payFrequency" TEXT NOT NULL DEFAULT 'MONTHLY' CHECK ("payFrequency" IN ('MONTHLY', 'SEMI_MONTHLY', 'WEEKLY')),
  "normalDailyMinutes" INTEGER NOT NULL DEFAULT 480,
  "normalWeeklyMinutes" INTEGER NOT NULL DEFAULT 2700,
  "salaryDivisor" INTEGER NOT NULL DEFAULT 26,
  "rulePackVersion" TEXT NOT NULL DEFAULT 'MY-PEN-2023-01',
  "statutoryContributionsEnabled" INTEGER NOT NULL DEFAULT 0 CHECK ("statutoryContributionsEnabled" IN (0, 1)),
  "statutoryRuleVersion" TEXT NOT NULL DEFAULT 'MY-STAT-2025-10-01',
  "createdAt" INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  "updatedAt" INTEGER NOT NULL,
  FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "PayProfile" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "employeeId" TEXT NOT NULL,
  "payType" TEXT NOT NULL CHECK ("payType" IN ('MONTHLY', 'DAILY', 'HOURLY')),
  "baseRateSen" INTEGER NOT NULL,
  "normalDailyMinutes" INTEGER NOT NULL,
  "normalWeeklyMinutes" INTEGER NOT NULL,
  "overtimeEligible" INTEGER NOT NULL DEFAULT 1 CHECK ("overtimeEligible" IN (0, 1)),
  "effectiveFrom" TEXT NOT NULL,
  "effectiveTo" TEXT,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  "updatedAt" INTEGER NOT NULL,
  UNIQUE ("employeeId", "effectiveFrom"),
  FOREIGN KEY ("employeeId") REFERENCES "Employee" ("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "EmployeeStatutoryProfile" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "employeeId" TEXT NOT NULL,
  "epfCategory" TEXT NOT NULL CHECK ("epfCategory" IN ('STANDARD_UNDER_60', 'PR_OR_PRE_1998_60_PLUS', 'MALAYSIAN_60_PLUS', 'NON_MALAYSIAN', 'EXEMPT')),
  "socsoCategory" TEXT NOT NULL CHECK ("socsoCategory" IN ('FIRST', 'SECOND', 'EXEMPT')),
  "eisEligible" INTEGER NOT NULL DEFAULT 1 CHECK ("eisEligible" IN (0, 1)),
  "effectiveFrom" TEXT NOT NULL,
  "effectiveTo" TEXT,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  "updatedAt" INTEGER NOT NULL,
  UNIQUE ("employeeId", "effectiveFrom"),
  FOREIGN KEY ("employeeId") REFERENCES "Employee" ("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "PayrollComponent" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "clientId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "type" TEXT NOT NULL CHECK ("type" IN ('EARNING', 'DEDUCTION', 'ADVANCE_REPAYMENT')),
  "calculationBasis" TEXT NOT NULL CHECK ("calculationBasis" IN ('FIXED_AMOUNT', 'PER_DAY', 'PER_HOUR', 'PERCENTAGE')),
  "defaultAmountSen" INTEGER NOT NULL DEFAULT 0,
  "defaultPercentageBps" INTEGER,
  "epfEligible" INTEGER NOT NULL DEFAULT 1 CHECK ("epfEligible" IN (0, 1)),
  "socsoEligible" INTEGER NOT NULL DEFAULT 1 CHECK ("socsoEligible" IN (0, 1)),
  "eisEligible" INTEGER NOT NULL DEFAULT 1 CHECK ("eisEligible" IN (0, 1)),
  "isActive" INTEGER NOT NULL DEFAULT 1 CHECK ("isActive" IN (0, 1)),
  "createdAt" INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  "updatedAt" INTEGER NOT NULL,
  UNIQUE ("clientId", "code"),
  FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "EmployeePayComponent" (
  "id" TEXT PRIMARY KEY NOT NULL,
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
  "isActive" INTEGER NOT NULL DEFAULT 1 CHECK ("isActive" IN (0, 1)),
  "createdByUserId" TEXT NOT NULL,
  "createdAt" INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  "updatedAt" INTEGER NOT NULL,
  UNIQUE ("employeeId", "payrollComponentId", "effectiveFrom"),
  FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE CASCADE,
  FOREIGN KEY ("employeeId") REFERENCES "Employee" ("id") ON DELETE CASCADE,
  FOREIGN KEY ("payrollComponentId") REFERENCES "PayrollComponent" ("id") ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS "PayrollCalculationRun" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "clientId" TEXT NOT NULL,
  "payPeriodId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT' CHECK ("status" IN ('DRAFT', 'LOCKED')),
  "rulePackVersion" TEXT NOT NULL,
  "inputHash" TEXT NOT NULL,
  "totalGrossSen" INTEGER NOT NULL DEFAULT 0,
  "totalDeductionsSen" INTEGER NOT NULL DEFAULT 0,
  "totalCalculatedPaySen" INTEGER NOT NULL DEFAULT 0,
  "warningCount" INTEGER NOT NULL DEFAULT 0,
  "blockingWarningCount" INTEGER NOT NULL DEFAULT 0,
  "calculatedByUserId" TEXT NOT NULL,
  "lockedAt" INTEGER,
  "createdAt" INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  UNIQUE ("payPeriodId", "version"),
  FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE CASCADE,
  FOREIGN KEY ("payPeriodId") REFERENCES "PayPeriod" ("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "PayrollCalculationResult" (
  "id" TEXT PRIMARY KEY NOT NULL,
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
  "epfWagesSen" INTEGER NOT NULL DEFAULT 0,
  "socsoWagesSen" INTEGER NOT NULL DEFAULT 0,
  "eisWagesSen" INTEGER NOT NULL DEFAULT 0,
  "epfEmployeeSen" INTEGER NOT NULL DEFAULT 0,
  "epfEmployerSen" INTEGER NOT NULL DEFAULT 0,
  "socsoEmployeeSen" INTEGER NOT NULL DEFAULT 0,
  "socsoEmployerSen" INTEGER NOT NULL DEFAULT 0,
  "eisEmployeeSen" INTEGER NOT NULL DEFAULT 0,
  "eisEmployerSen" INTEGER NOT NULL DEFAULT 0,
  "employerContributionsSen" INTEGER NOT NULL DEFAULT 0,
  "grossPaySen" INTEGER NOT NULL DEFAULT 0,
  "totalDeductionsSen" INTEGER NOT NULL DEFAULT 0,
  "calculatedPaySen" INTEGER NOT NULL DEFAULT 0,
  "warnings" TEXT NOT NULL DEFAULT '[]' CHECK ("warnings" IS NULL OR json_valid("warnings")),
  "blockingWarnings" TEXT NOT NULL DEFAULT '[]' CHECK ("blockingWarnings" IS NULL OR json_valid("blockingWarnings")),
  "payProfileSnapshot" TEXT CHECK ("payProfileSnapshot" IS NULL OR json_valid("payProfileSnapshot")),
  "inputSummary" TEXT NOT NULL CHECK ("inputSummary" IS NULL OR json_valid("inputSummary")),
  "createdAt" INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  UNIQUE ("runId", "employeeId"),
  FOREIGN KEY ("runId") REFERENCES "PayrollCalculationRun" ("id") ON DELETE CASCADE,
  FOREIGN KEY ("employeeId") REFERENCES "Employee" ("id") ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS "PayrollWarningAcknowledgement" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "clientId" TEXT NOT NULL,
  "calculationResultId" TEXT NOT NULL,
  "warningCode" TEXT NOT NULL,
  "note" TEXT NOT NULL,
  "acknowledgedByUserId" TEXT NOT NULL,
  "acknowledgedByUsername" TEXT NOT NULL,
  "createdAt" INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  UNIQUE ("calculationResultId", "warningCode"),
  FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE CASCADE,
  FOREIGN KEY ("calculationResultId") REFERENCES "PayrollCalculationResult" ("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "PayrollCalculationLine" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "resultId" TEXT NOT NULL,
  "direction" TEXT NOT NULL CHECK ("direction" IN ('EARNING', 'DEDUCTION', 'EMPLOYER_CONTRIBUTION')),
  "category" TEXT NOT NULL CHECK ("category" IN ('BASE_PAY', 'REGULAR_PAY', 'OVERTIME', 'REST_DAY', 'PUBLIC_HOLIDAY', 'PAID_LEAVE', 'UNPAID_LEAVE', 'ALLOWANCE', 'DEDUCTION', 'ADVANCE_REPAYMENT', 'EPF', 'SOCSO', 'EIS')),
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "amountSen" INTEGER NOT NULL,
  "basis" TEXT NOT NULL,
  "sourceComponentAssignmentId" TEXT,
  "metadata" TEXT CHECK ("metadata" IS NULL OR json_valid("metadata")),
  "displayOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  FOREIGN KEY ("resultId") REFERENCES "PayrollCalculationResult" ("id") ON DELETE CASCADE,
  FOREIGN KEY ("sourceComponentAssignmentId") REFERENCES "EmployeePayComponent" ("id") ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS "PayrollMonetaryAdjustment" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "clientId" TEXT NOT NULL,
  "payPeriodId" TEXT NOT NULL,
  "calculationResultId" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "direction" TEXT NOT NULL CHECK ("direction" IN ('EARNING', 'DEDUCTION')),
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "amountSen" INTEGER NOT NULL,
  "reason" TEXT NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE CASCADE,
  FOREIGN KEY ("payPeriodId") REFERENCES "PayPeriod" ("id") ON DELETE CASCADE,
  FOREIGN KEY ("calculationResultId") REFERENCES "PayrollCalculationResult" ("id") ON DELETE RESTRICT,
  FOREIGN KEY ("employeeId") REFERENCES "Employee" ("id") ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS "PayrollMonetaryAdjustmentDecision" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "clientId" TEXT NOT NULL,
  "adjustmentId" TEXT NOT NULL UNIQUE,
  "outcome" TEXT NOT NULL CHECK ("outcome" IN ('APPROVED', 'REJECTED')),
  "note" TEXT NOT NULL,
  "decidedByUserId" TEXT NOT NULL,
  "createdAt" INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE RESTRICT,
  FOREIGN KEY ("adjustmentId") REFERENCES "PayrollMonetaryAdjustment" ("id") ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS "PayrollStatementDelivery" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "clientId" TEXT NOT NULL,
  "payPeriodId" TEXT NOT NULL,
  "calculationResultId" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "recipientEmail" TEXT NOT NULL,
  "language" TEXT NOT NULL DEFAULT 'en',
  "fileName" TEXT NOT NULL,
  "status" TEXT NOT NULL CHECK ("status" IN ('SENT', 'FAILED')),
  "providerMessageId" TEXT,
  "failureReason" TEXT,
  "requestedByUserId" TEXT NOT NULL,
  "createdAt" INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE RESTRICT,
  FOREIGN KEY ("payPeriodId") REFERENCES "PayPeriod" ("id") ON DELETE RESTRICT,
  FOREIGN KEY ("calculationResultId") REFERENCES "PayrollCalculationResult" ("id") ON DELETE RESTRICT,
  FOREIGN KEY ("employeeId") REFERENCES "Employee" ("id") ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS "PayrollAdjustment" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "payPeriodId" TEXT NOT NULL,
  "timesheetDayId" TEXT NOT NULL,
  "correctionId" TEXT UNIQUE,
  "adjustmentType" TEXT NOT NULL,
  "minutes" INTEGER NOT NULL DEFAULT 0,
  "reason" TEXT NOT NULL,
  "beforeValues" TEXT NOT NULL CHECK ("beforeValues" IS NULL OR json_valid("beforeValues")),
  "afterValues" TEXT NOT NULL CHECK ("afterValues" IS NULL OR json_valid("afterValues")),
  "createdByUserId" TEXT NOT NULL,
  "createdAt" INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  FOREIGN KEY ("payPeriodId") REFERENCES "PayPeriod" ("id") ON DELETE CASCADE,
  FOREIGN KEY ("timesheetDayId") REFERENCES "TimesheetDay" ("id") ON DELETE RESTRICT,
  FOREIGN KEY ("correctionId") REFERENCES "AttendanceCorrection" ("id") ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS "ExportJob" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "clientId" TEXT NOT NULL,
  "payPeriodId" TEXT NOT NULL,
  "format" TEXT NOT NULL CHECK ("format" IN ('CSV', 'XLSX')),
  "status" TEXT NOT NULL DEFAULT 'PENDING' CHECK ("status" IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'EXPIRED')),
  "template" TEXT CHECK ("template" IS NULL OR json_valid("template")),
  "r2Key" TEXT,
  "fileName" TEXT,
  "contentType" TEXT,
  "fileSizeBytes" INTEGER,
  "expiresAt" INTEGER,
  "lastError" TEXT,
  "requestedByUserId" TEXT NOT NULL,
  "completedAt" INTEGER,
  "createdAt" INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  "updatedAt" INTEGER NOT NULL,
  FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE CASCADE,
  FOREIGN KEY ("payPeriodId") REFERENCES "PayPeriod" ("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "Notification" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "userId" TEXT NOT NULL,
  "clientId" TEXT,
  "type" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "entityType" TEXT,
  "entityId" TEXT,
  "readAt" INTEGER,
  "createdAt" INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE,
  FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "LeaveType" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "clientId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "isPaid" INTEGER NOT NULL DEFAULT 1 CHECK ("isPaid" IN (0, 1)),
  "defaultEntitlementMinutes" INTEGER NOT NULL DEFAULT 0,
  "isActive" INTEGER NOT NULL DEFAULT 1 CHECK ("isActive" IN (0, 1)),
  "createdAt" INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  "updatedAt" INTEGER NOT NULL,
  UNIQUE ("clientId", "code"),
  FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "LeaveBalance" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "employeeId" TEXT NOT NULL,
  "leaveTypeId" TEXT NOT NULL,
  "year" INTEGER NOT NULL,
  "entitledMinutes" INTEGER NOT NULL DEFAULT 0,
  "usedMinutes" INTEGER NOT NULL DEFAULT 0,
  "pendingMinutes" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" INTEGER NOT NULL,
  UNIQUE ("employeeId", "leaveTypeId", "year"),
  FOREIGN KEY ("employeeId") REFERENCES "Employee" ("id") ON DELETE CASCADE,
  FOREIGN KEY ("leaveTypeId") REFERENCES "LeaveType" ("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "LeaveRequest" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "clientId" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "leaveTypeId" TEXT NOT NULL,
  "startDate" TEXT NOT NULL,
  "endDate" TEXT NOT NULL,
  "requestedMinutes" INTEGER NOT NULL,
  "reason" TEXT,
  "status" TEXT NOT NULL DEFAULT 'PENDING' CHECK ("status" IN ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED')),
  "reviewedByUserId" TEXT,
  "reviewNote" TEXT,
  "reviewedAt" INTEGER,
  "cancelledAt" INTEGER,
  "createdAt" INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  "updatedAt" INTEGER NOT NULL,
  FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE CASCADE,
  FOREIGN KEY ("employeeId") REFERENCES "Employee" ("id") ON DELETE CASCADE,
  FOREIGN KEY ("leaveTypeId") REFERENCES "LeaveType" ("id") ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS "LeaveAllocation" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "leaveRequestId" TEXT NOT NULL,
  "timesheetDayId" TEXT NOT NULL,
  "workDate" TEXT NOT NULL,
  "scheduledMinutes" INTEGER NOT NULL,
  "minutes" INTEGER NOT NULL,
  "paidMinutes" INTEGER NOT NULL DEFAULT 0,
  "unpaidMinutes" INTEGER NOT NULL DEFAULT 0,
  "createdAt" INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  UNIQUE ("leaveRequestId", "workDate"),
  FOREIGN KEY ("leaveRequestId") REFERENCES "LeaveRequest" ("id") ON DELETE CASCADE,
  FOREIGN KEY ("timesheetDayId") REFERENCES "TimesheetDay" ("id") ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS "Worksite" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "clientId" TEXT NOT NULL,
  "ownerAdminId" TEXT,
  "name" TEXT NOT NULL,
  "latitude" REAL NOT NULL,
  "longitude" REAL NOT NULL,
  "radiusMeters" INTEGER NOT NULL DEFAULT 150,
  "isActive" INTEGER NOT NULL DEFAULT 1 CHECK ("isActive" IN (0, 1)),
  "createdAt" INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  "updatedAt" INTEGER NOT NULL,
  FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE CASCADE,
  FOREIGN KEY ("ownerAdminId") REFERENCES "User" ("id") ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS "AuditLog" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "clientId" TEXT,
  "action" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "details" TEXT CHECK ("details" IS NULL OR json_valid("details")),
  "requestId" TEXT,
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "createdAt" INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE INDEX IF NOT EXISTS "idx_User_createdByUserId" ON "User" ("createdByUserId");

CREATE INDEX IF NOT EXISTS "idx_OrganizationMembership_clientId_role_status" ON "OrganizationMembership" ("clientId", "role", "status");

CREATE INDEX IF NOT EXISTS "idx_OrganizationMembership_managerMembershipId" ON "OrganizationMembership" ("managerMembershipId");

CREATE INDEX IF NOT EXISTS "idx_AuthSession_userId_revokedAt_expiresAt" ON "AuthSession" ("userId", "revokedAt", "expiresAt");

CREATE INDEX IF NOT EXISTS "idx_AuthSession_familyId" ON "AuthSession" ("familyId");

CREATE INDEX IF NOT EXISTS "idx_PasswordResetToken_userId_expiresAt" ON "PasswordResetToken" ("userId", "expiresAt");

CREATE INDEX IF NOT EXISTS "idx_MfaRecoveryCode_mfaCredentialId_usedAt" ON "MfaRecoveryCode" ("mfaCredentialId", "usedAt");

CREATE INDEX IF NOT EXISTS "idx_Employee_departmentId" ON "Employee" ("departmentId");

CREATE INDEX IF NOT EXISTS "idx_Employee_managerEmployeeId" ON "Employee" ("managerEmployeeId");

CREATE INDEX IF NOT EXISTS "idx_Employee_employmentStatus" ON "Employee" ("employmentStatus");

CREATE INDEX IF NOT EXISTS "idx_ShiftTemplate_clientId_isActive" ON "ShiftTemplate" ("clientId", "isActive");

CREATE INDEX IF NOT EXISTS "idx_ScheduleAssignment_shiftTemplateId_effectiveFrom_effectiveTo" ON "ScheduleAssignment" ("shiftTemplateId", "effectiveFrom", "effectiveTo");

CREATE INDEX IF NOT EXISTS "idx_Holiday_clientId_date" ON "Holiday" ("clientId", "date");

CREATE INDEX IF NOT EXISTS "idx_AttendanceRecord_workDate" ON "AttendanceRecord" ("workDate");

CREATE INDEX IF NOT EXISTS "idx_AttendanceEvent_employeeId_workDate_occurredAt" ON "AttendanceEvent" ("employeeId", "workDate", "occurredAt");

CREATE INDEX IF NOT EXISTS "idx_AttendanceEvent_clientId_workDate_occurredAt" ON "AttendanceEvent" ("clientId", "workDate", "occurredAt");

CREATE INDEX IF NOT EXISTS "idx_AttendanceEvent_worksiteId" ON "AttendanceEvent" ("worksiteId");

CREATE INDEX IF NOT EXISTS "idx_AttendanceEvent_createdByUserId" ON "AttendanceEvent" ("createdByUserId");

CREATE INDEX IF NOT EXISTS "idx_WebhookDelivery_clientId_status_createdAt" ON "WebhookDelivery" ("clientId", "status", "createdAt");

CREATE INDEX IF NOT EXISTS "idx_WebhookDelivery_status_createdAt" ON "WebhookDelivery" ("status", "createdAt");

CREATE INDEX IF NOT EXISTS "idx_TimesheetDay_clientId_workDate_state" ON "TimesheetDay" ("clientId", "workDate", "state");

CREATE INDEX IF NOT EXISTS "idx_TimesheetDay_payPeriodId" ON "TimesheetDay" ("payPeriodId");

CREATE INDEX IF NOT EXISTS "idx_AttendanceCorrection_employeeId_status_createdAt" ON "AttendanceCorrection" ("employeeId", "status", "createdAt");

CREATE INDEX IF NOT EXISTS "idx_AttendanceCorrection_timesheetDayId_status" ON "AttendanceCorrection" ("timesheetDayId", "status");

CREATE INDEX IF NOT EXISTS "idx_PayPeriod_clientId_status_startDate" ON "PayPeriod" ("clientId", "status", "startDate");

CREATE INDEX IF NOT EXISTS "idx_PayProfile_employeeId_effectiveFrom_effectiveTo" ON "PayProfile" ("employeeId", "effectiveFrom", "effectiveTo");

CREATE INDEX IF NOT EXISTS "idx_EmployeeStatutoryProfile_employeeId_effectiveFrom_effectiveTo" ON "EmployeeStatutoryProfile" ("employeeId", "effectiveFrom", "effectiveTo");

CREATE INDEX IF NOT EXISTS "idx_PayrollComponent_clientId_type_isActive" ON "PayrollComponent" ("clientId", "type", "isActive");

CREATE INDEX IF NOT EXISTS "idx_EmployeePayComponent_clientId_employeeId_isActive" ON "EmployeePayComponent" ("clientId", "employeeId", "isActive");

CREATE INDEX IF NOT EXISTS "idx_EmployeePayComponent_payrollComponentId_effectiveFrom_effectiveTo" ON "EmployeePayComponent" ("payrollComponentId", "effectiveFrom", "effectiveTo");

CREATE INDEX IF NOT EXISTS "idx_PayrollCalculationRun_clientId_createdAt" ON "PayrollCalculationRun" ("clientId", "createdAt");

CREATE INDEX IF NOT EXISTS "idx_PayrollCalculationRun_payPeriodId_status_version" ON "PayrollCalculationRun" ("payPeriodId", "status", "version");

CREATE INDEX IF NOT EXISTS "idx_PayrollCalculationResult_employeeId_createdAt" ON "PayrollCalculationResult" ("employeeId", "createdAt");

CREATE INDEX IF NOT EXISTS "idx_PayrollWarningAcknowledgement_clientId_createdAt" ON "PayrollWarningAcknowledgement" ("clientId", "createdAt");

CREATE INDEX IF NOT EXISTS "idx_PayrollWarningAcknowledgement_acknowledgedByUserId_createdAt" ON "PayrollWarningAcknowledgement" ("acknowledgedByUserId", "createdAt");

CREATE INDEX IF NOT EXISTS "idx_PayrollCalculationLine_resultId_displayOrder" ON "PayrollCalculationLine" ("resultId", "displayOrder");

CREATE INDEX IF NOT EXISTS "idx_PayrollCalculationLine_sourceComponentAssignmentId" ON "PayrollCalculationLine" ("sourceComponentAssignmentId");

CREATE INDEX IF NOT EXISTS "idx_PayrollMonetaryAdjustment_clientId_payPeriodId_createdAt" ON "PayrollMonetaryAdjustment" ("clientId", "payPeriodId", "createdAt");

CREATE INDEX IF NOT EXISTS "idx_PayrollMonetaryAdjustment_employeeId_payPeriodId_createdAt" ON "PayrollMonetaryAdjustment" ("employeeId", "payPeriodId", "createdAt");

CREATE INDEX IF NOT EXISTS "idx_PayrollMonetaryAdjustment_calculationResultId_createdAt" ON "PayrollMonetaryAdjustment" ("calculationResultId", "createdAt");

CREATE INDEX IF NOT EXISTS "idx_PayrollMonetaryAdjustmentDecision_clientId_outcome_createdAt" ON "PayrollMonetaryAdjustmentDecision" ("clientId", "outcome", "createdAt");

CREATE INDEX IF NOT EXISTS "idx_PayrollMonetaryAdjustmentDecision_decidedByUserId_createdAt" ON "PayrollMonetaryAdjustmentDecision" ("decidedByUserId", "createdAt");

CREATE INDEX IF NOT EXISTS "idx_PayrollStatementDelivery_clientId_payPeriodId_createdAt" ON "PayrollStatementDelivery" ("clientId", "payPeriodId", "createdAt");

CREATE INDEX IF NOT EXISTS "idx_PayrollStatementDelivery_employeeId_payPeriodId_createdAt" ON "PayrollStatementDelivery" ("employeeId", "payPeriodId", "createdAt");

CREATE INDEX IF NOT EXISTS "idx_PayrollStatementDelivery_requestedByUserId_createdAt" ON "PayrollStatementDelivery" ("requestedByUserId", "createdAt");

CREATE INDEX IF NOT EXISTS "idx_PayrollAdjustment_payPeriodId_createdAt" ON "PayrollAdjustment" ("payPeriodId", "createdAt");

CREATE INDEX IF NOT EXISTS "idx_PayrollAdjustment_timesheetDayId" ON "PayrollAdjustment" ("timesheetDayId");

CREATE INDEX IF NOT EXISTS "idx_ExportJob_clientId_status_createdAt" ON "ExportJob" ("clientId", "status", "createdAt");

CREATE INDEX IF NOT EXISTS "idx_ExportJob_payPeriodId_createdAt" ON "ExportJob" ("payPeriodId", "createdAt");

CREATE INDEX IF NOT EXISTS "idx_Notification_userId_readAt_createdAt" ON "Notification" ("userId", "readAt", "createdAt");

CREATE INDEX IF NOT EXISTS "idx_Notification_clientId_createdAt" ON "Notification" ("clientId", "createdAt");

CREATE INDEX IF NOT EXISTS "idx_LeaveRequest_clientId_status_startDate" ON "LeaveRequest" ("clientId", "status", "startDate");

CREATE INDEX IF NOT EXISTS "idx_LeaveRequest_employeeId_status_startDate" ON "LeaveRequest" ("employeeId", "status", "startDate");

CREATE INDEX IF NOT EXISTS "idx_LeaveAllocation_timesheetDayId" ON "LeaveAllocation" ("timesheetDayId");

CREATE INDEX IF NOT EXISTS "idx_LeaveAllocation_workDate" ON "LeaveAllocation" ("workDate");

CREATE INDEX IF NOT EXISTS "idx_Worksite_clientId_ownerAdminId_isActive" ON "Worksite" ("clientId", "ownerAdminId", "isActive");

CREATE INDEX IF NOT EXISTS "idx_AuditLog_entityType_entityId_createdAt" ON "AuditLog" ("entityType", "entityId", "createdAt");

CREATE INDEX IF NOT EXISTS "idx_AuditLog_actorUserId_createdAt" ON "AuditLog" ("actorUserId", "createdAt");

CREATE INDEX IF NOT EXISTS "idx_AuditLog_clientId_createdAt" ON "AuditLog" ("clientId", "createdAt");
