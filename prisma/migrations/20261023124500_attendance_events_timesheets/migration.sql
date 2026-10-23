CREATE TYPE "AttendanceEventType" AS ENUM ('CLOCK_IN', 'CLOCK_OUT', 'BREAK_START', 'BREAK_END');
CREATE TYPE "AttendanceEventSource" AS ENUM ('MOBILE_GPS', 'ADMIN_ADJUSTMENT', 'MIGRATION');
CREATE TYPE "TimesheetState" AS ENUM ('OPEN', 'COMPLETE', 'EXCEPTION', 'APPROVED', 'LOCKED');

CREATE TABLE "AttendanceEvent" (
  "id" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "clientId" TEXT,
  "workDate" TEXT NOT NULL,
  "type" "AttendanceEventType" NOT NULL,
  "source" "AttendanceEventSource" NOT NULL DEFAULT 'MOBILE_GPS',
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "worksiteId" TEXT,
  "latitude" DOUBLE PRECISION,
  "longitude" DOUBLE PRECISION,
  "accuracyMeters" DOUBLE PRECISION,
  "distanceMeters" DOUBLE PRECISION,
  "acceptedRadiusMeters" INTEGER,
  "idempotencyKey" TEXT NOT NULL,
  "createdByUserId" TEXT,
  "deviceDetails" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AttendanceEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AttendanceEvent_employeeId_idempotencyKey_key" ON "AttendanceEvent"("employeeId", "idempotencyKey");
CREATE INDEX "AttendanceEvent_employeeId_workDate_occurredAt_idx" ON "AttendanceEvent"("employeeId", "workDate", "occurredAt");
CREATE INDEX "AttendanceEvent_clientId_workDate_occurredAt_idx" ON "AttendanceEvent"("clientId", "workDate", "occurredAt");
CREATE INDEX "AttendanceEvent_worksiteId_idx" ON "AttendanceEvent"("worksiteId");
CREATE INDEX "AttendanceEvent_createdByUserId_idx" ON "AttendanceEvent"("createdByUserId");

ALTER TABLE "AttendanceEvent" ADD CONSTRAINT "AttendanceEvent_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AttendanceEvent" ADD CONSTRAINT "AttendanceEvent_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AttendanceEvent" ADD CONSTRAINT "AttendanceEvent_worksiteId_fkey" FOREIGN KEY ("worksiteId") REFERENCES "Worksite"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AttendanceEvent" ADD CONSTRAINT "AttendanceEvent_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "TimesheetDay" (
  "id" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "clientId" TEXT,
  "workDate" TEXT NOT NULL,
  "state" "TimesheetState" NOT NULL DEFAULT 'OPEN',
  "firstClockInAt" TIMESTAMP(3),
  "lastClockOutAt" TIMESTAMP(3),
  "regularMinutes" INTEGER NOT NULL DEFAULT 0,
  "overtimeMinutes" INTEGER NOT NULL DEFAULT 0,
  "breakMinutes" INTEGER NOT NULL DEFAULT 0,
  "lateMinutes" INTEGER NOT NULL DEFAULT 0,
  "earlyDepartureMinutes" INTEGER NOT NULL DEFAULT 0,
  "leaveMinutes" INTEGER NOT NULL DEFAULT 0,
  "isAbsent" BOOLEAN NOT NULL DEFAULT false,
  "exceptionCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "version" INTEGER NOT NULL DEFAULT 1,
  "approvedAt" TIMESTAMP(3),
  "lockedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TimesheetDay_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TimesheetDay_employeeId_workDate_key" ON "TimesheetDay"("employeeId", "workDate");
CREATE INDEX "TimesheetDay_clientId_workDate_state_idx" ON "TimesheetDay"("clientId", "workDate", "state");
ALTER TABLE "TimesheetDay" ADD CONSTRAINT "TimesheetDay_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TimesheetDay" ADD CONSTRAINT "TimesheetDay_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "AttendanceEvent" (
  "id", "employeeId", "clientId", "workDate", "type", "source", "occurredAt",
  "latitude", "longitude", "accuracyMeters", "idempotencyKey", "createdAt"
)
SELECT
  'event_in_' || attendance."id",
  attendance."employeeId",
  users."clientId",
  attendance."workDate",
  'CLOCK_IN'::"AttendanceEventType",
  'MIGRATION'::"AttendanceEventSource",
  attendance."clockInAt",
  attendance."clockInLatitude",
  attendance."clockInLongitude",
  attendance."clockInAccuracy",
  'migration:clock-in:' || attendance."id",
  attendance."createdAt"
FROM "AttendanceRecord" attendance
JOIN "Employee" employee ON employee."id" = attendance."employeeId"
JOIN "User" users ON users."id" = employee."userId";

INSERT INTO "AttendanceEvent" (
  "id", "employeeId", "clientId", "workDate", "type", "source", "occurredAt",
  "latitude", "longitude", "accuracyMeters", "idempotencyKey", "createdAt"
)
SELECT
  'event_out_' || attendance."id",
  attendance."employeeId",
  users."clientId",
  attendance."workDate",
  'CLOCK_OUT'::"AttendanceEventType",
  'MIGRATION'::"AttendanceEventSource",
  attendance."clockOutAt",
  attendance."clockOutLatitude",
  attendance."clockOutLongitude",
  attendance."clockOutAccuracy",
  'migration:clock-out:' || attendance."id",
  attendance."updatedAt"
FROM "AttendanceRecord" attendance
JOIN "Employee" employee ON employee."id" = attendance."employeeId"
JOIN "User" users ON users."id" = employee."userId"
WHERE attendance."clockOutAt" IS NOT NULL;

INSERT INTO "TimesheetDay" (
  "id", "employeeId", "clientId", "workDate", "state", "firstClockInAt", "lastClockOutAt",
  "regularMinutes", "overtimeMinutes", "breakMinutes", "exceptionCodes", "createdAt", "updatedAt"
)
SELECT
  'timesheet_' || attendance."id",
  attendance."employeeId",
  users."clientId",
  attendance."workDate",
  CASE WHEN attendance."clockOutAt" IS NULL THEN 'OPEN'::"TimesheetState" ELSE 'COMPLETE'::"TimesheetState" END,
  attendance."clockInAt",
  attendance."clockOutAt",
  CASE WHEN attendance."clockOutAt" IS NULL THEN 0 ELSE LEAST(GREATEST(FLOOR(EXTRACT(EPOCH FROM (attendance."clockOutAt" - attendance."clockInAt")) / 60) - 60, 0), 480)::INTEGER END,
  CASE WHEN attendance."clockOutAt" IS NULL THEN 0 ELSE GREATEST(FLOOR(EXTRACT(EPOCH FROM (attendance."clockOutAt" - attendance."clockInAt")) / 60) - 540, 0)::INTEGER END,
  CASE WHEN attendance."clockOutAt" IS NULL THEN 0 ELSE 60 END,
  CASE WHEN attendance."clockOutAt" IS NULL THEN ARRAY['MISSING_CLOCK_OUT']::TEXT[] ELSE ARRAY[]::TEXT[] END,
  attendance."createdAt",
  attendance."updatedAt"
FROM "AttendanceRecord" attendance
JOIN "Employee" employee ON employee."id" = attendance."employeeId"
JOIN "User" users ON users."id" = employee."userId"
ON CONFLICT ("employeeId", "workDate") DO NOTHING;
