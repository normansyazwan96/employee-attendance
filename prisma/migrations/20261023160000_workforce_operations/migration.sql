CREATE TYPE "EmploymentStatus" AS ENUM ('ACTIVE', 'ON_LEAVE', 'TERMINATED');
CREATE TYPE "RequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

ALTER TABLE "Employee"
  ADD COLUMN "employeeNumber" TEXT,
  ADD COLUMN "employmentStatus" "EmploymentStatus" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "joinDate" TIMESTAMP(3),
  ADD COLUMN "terminationDate" TIMESTAMP(3),
  ADD COLUMN "departmentId" TEXT,
  ADD COLUMN "managerEmployeeId" TEXT;
CREATE INDEX "Employee_departmentId_idx" ON "Employee"("departmentId");
CREATE INDEX "Employee_managerEmployeeId_idx" ON "Employee"("managerEmployeeId");
CREATE INDEX "Employee_employmentStatus_idx" ON "Employee"("employmentStatus");
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_managerEmployeeId_fkey" FOREIGN KEY ("managerEmployeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "Department" (
  "id" TEXT NOT NULL, "clientId" TEXT NOT NULL, "name" TEXT NOT NULL, "code" TEXT, "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Department_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Department_clientId_name_key" ON "Department"("clientId", "name");
CREATE UNIQUE INDEX "Department_clientId_code_key" ON "Department"("clientId", "code");
ALTER TABLE "Department" ADD CONSTRAINT "Department_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "WorkPolicy" (
  "id" TEXT NOT NULL, "clientId" TEXT NOT NULL, "gracePeriodMinutes" INTEGER NOT NULL DEFAULT 10,
  "defaultBreakMinutes" INTEGER NOT NULL DEFAULT 60, "roundingIncrement" INTEGER NOT NULL DEFAULT 1,
  "overtimeThreshold" INTEGER NOT NULL DEFAULT 480, "maximumShiftMinutes" INTEGER NOT NULL DEFAULT 960,
  "missedClockOutMinutes" INTEGER NOT NULL DEFAULT 960, "maximumGpsAccuracy" INTEGER NOT NULL DEFAULT 100,
  "exactGpsRetentionDays" INTEGER NOT NULL DEFAULT 90, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "WorkPolicy_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "WorkPolicy_clientId_key" ON "WorkPolicy"("clientId");
ALTER TABLE "WorkPolicy" ADD CONSTRAINT "WorkPolicy_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
INSERT INTO "WorkPolicy" ("id", "clientId", "updatedAt") SELECT 'policy_' || "id", "id", CURRENT_TIMESTAMP FROM "Client" ON CONFLICT ("clientId") DO NOTHING;

CREATE TABLE "ShiftTemplate" (
  "id" TEXT NOT NULL, "clientId" TEXT NOT NULL, "name" TEXT NOT NULL, "workDays" INTEGER[], "startTime" TEXT NOT NULL,
  "endTime" TEXT NOT NULL, "breakMinutes" INTEGER NOT NULL DEFAULT 60, "gracePeriodMinutes" INTEGER NOT NULL DEFAULT 10,
  "isOvernight" BOOLEAN NOT NULL DEFAULT false, "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ShiftTemplate_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ShiftTemplate_clientId_name_key" ON "ShiftTemplate"("clientId", "name");
CREATE INDEX "ShiftTemplate_clientId_isActive_idx" ON "ShiftTemplate"("clientId", "isActive");
ALTER TABLE "ShiftTemplate" ADD CONSTRAINT "ShiftTemplate_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ScheduleAssignment" (
  "id" TEXT NOT NULL, "employeeId" TEXT NOT NULL, "shiftTemplateId" TEXT NOT NULL, "effectiveFrom" TEXT NOT NULL,
  "effectiveTo" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ScheduleAssignment_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ScheduleAssignment_employeeId_effectiveFrom_key" ON "ScheduleAssignment"("employeeId", "effectiveFrom");
CREATE INDEX "ScheduleAssignment_shiftTemplateId_effectiveFrom_effectiveTo_idx" ON "ScheduleAssignment"("shiftTemplateId", "effectiveFrom", "effectiveTo");
ALTER TABLE "ScheduleAssignment" ADD CONSTRAINT "ScheduleAssignment_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ScheduleAssignment" ADD CONSTRAINT "ScheduleAssignment_shiftTemplateId_fkey" FOREIGN KEY ("shiftTemplateId") REFERENCES "ShiftTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "ShiftTemplate" ("id", "clientId", "name", "workDays", "startTime", "endTime", "gracePeriodMinutes", "isOvernight", "isActive", "createdAt", "updatedAt")
SELECT 'legacy_shift_' || schedule."id", users."clientId", 'Migrated schedule ' || schedule."id", schedule."workDays", schedule."startTime", schedule."endTime", schedule."gracePeriodMinutes", schedule."endTime" <= schedule."startTime", schedule."isActive", schedule."createdAt", schedule."updatedAt"
FROM "EmployeeSchedule" schedule JOIN "Employee" employee ON employee."id" = schedule."employeeId" JOIN "User" users ON users."id" = employee."userId" WHERE users."clientId" IS NOT NULL;
INSERT INTO "ScheduleAssignment" ("id", "employeeId", "shiftTemplateId", "effectiveFrom", "createdAt", "updatedAt")
SELECT 'legacy_assignment_' || schedule."id", schedule."employeeId", 'legacy_shift_' || schedule."id", '1970-01-01', schedule."createdAt", schedule."updatedAt"
FROM "EmployeeSchedule" schedule JOIN "Employee" employee ON employee."id" = schedule."employeeId" JOIN "User" users ON users."id" = employee."userId" WHERE users."clientId" IS NOT NULL;

CREATE TABLE "Holiday" (
  "id" TEXT NOT NULL, "clientId" TEXT NOT NULL, "date" TEXT NOT NULL, "name" TEXT NOT NULL, "stateCode" TEXT,
  "isWorkingDayOverride" BOOLEAN NOT NULL DEFAULT false, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "Holiday_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Holiday_clientId_date_name_key" ON "Holiday"("clientId", "date", "name");
CREATE INDEX "Holiday_clientId_date_idx" ON "Holiday"("clientId", "date");
ALTER TABLE "Holiday" ADD CONSTRAINT "Holiday_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "AttendanceCorrection" (
  "id" TEXT NOT NULL, "employeeId" TEXT NOT NULL, "timesheetDayId" TEXT NOT NULL, "reason" TEXT NOT NULL, "note" TEXT,
  "originalValues" JSONB NOT NULL, "requestedValues" JSONB NOT NULL, "status" "RequestStatus" NOT NULL DEFAULT 'PENDING',
  "reviewedByUserId" TEXT, "reviewNote" TEXT, "reviewedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "AttendanceCorrection_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AttendanceCorrection_employeeId_status_createdAt_idx" ON "AttendanceCorrection"("employeeId", "status", "createdAt");
CREATE INDEX "AttendanceCorrection_timesheetDayId_status_idx" ON "AttendanceCorrection"("timesheetDayId", "status");
ALTER TABLE "AttendanceCorrection" ADD CONSTRAINT "AttendanceCorrection_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AttendanceCorrection" ADD CONSTRAINT "AttendanceCorrection_timesheetDayId_fkey" FOREIGN KEY ("timesheetDayId") REFERENCES "TimesheetDay"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "LeaveType" (
  "id" TEXT NOT NULL, "clientId" TEXT NOT NULL, "code" TEXT NOT NULL, "name" TEXT NOT NULL, "isPaid" BOOLEAN NOT NULL DEFAULT true,
  "defaultEntitlementMinutes" INTEGER NOT NULL DEFAULT 0, "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LeaveType_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "LeaveType_clientId_code_key" ON "LeaveType"("clientId", "code");
ALTER TABLE "LeaveType" ADD CONSTRAINT "LeaveType_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "LeaveBalance" (
  "id" TEXT NOT NULL, "employeeId" TEXT NOT NULL, "leaveTypeId" TEXT NOT NULL, "year" INTEGER NOT NULL,
  "entitledMinutes" INTEGER NOT NULL DEFAULT 0, "usedMinutes" INTEGER NOT NULL DEFAULT 0, "pendingMinutes" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "LeaveBalance_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "LeaveBalance_employeeId_leaveTypeId_year_key" ON "LeaveBalance"("employeeId", "leaveTypeId", "year");
ALTER TABLE "LeaveBalance" ADD CONSTRAINT "LeaveBalance_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeaveBalance" ADD CONSTRAINT "LeaveBalance_leaveTypeId_fkey" FOREIGN KEY ("leaveTypeId") REFERENCES "LeaveType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "LeaveRequest" (
  "id" TEXT NOT NULL, "clientId" TEXT NOT NULL, "employeeId" TEXT NOT NULL, "leaveTypeId" TEXT NOT NULL,
  "startDate" TEXT NOT NULL, "endDate" TEXT NOT NULL, "requestedMinutes" INTEGER NOT NULL, "reason" TEXT,
  "status" "RequestStatus" NOT NULL DEFAULT 'PENDING', "reviewedByUserId" TEXT, "reviewNote" TEXT,
  "reviewedAt" TIMESTAMP(3), "cancelledAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "LeaveRequest_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "LeaveRequest_clientId_status_startDate_idx" ON "LeaveRequest"("clientId", "status", "startDate");
CREATE INDEX "LeaveRequest_employeeId_status_startDate_idx" ON "LeaveRequest"("employeeId", "status", "startDate");
ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_leaveTypeId_fkey" FOREIGN KEY ("leaveTypeId") REFERENCES "LeaveType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
