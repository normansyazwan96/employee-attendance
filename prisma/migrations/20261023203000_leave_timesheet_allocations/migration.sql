ALTER TABLE "TimesheetDay"
ADD COLUMN "paidLeaveMinutes" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "unpaidLeaveMinutes" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "LeaveAllocation" (
    "id" TEXT NOT NULL,
    "leaveRequestId" TEXT NOT NULL,
    "timesheetDayId" TEXT NOT NULL,
    "workDate" TEXT NOT NULL,
    "scheduledMinutes" INTEGER NOT NULL,
    "minutes" INTEGER NOT NULL,
    "paidMinutes" INTEGER NOT NULL DEFAULT 0,
    "unpaidMinutes" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeaveAllocation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "LeaveAllocation_positive_minutes" CHECK ("minutes" > 0 AND "scheduledMinutes" > 0),
    CONSTRAINT "LeaveAllocation_classified_minutes" CHECK ("minutes" = "paidMinutes" + "unpaidMinutes")
);

CREATE UNIQUE INDEX "LeaveAllocation_leaveRequestId_workDate_key" ON "LeaveAllocation"("leaveRequestId", "workDate");
CREATE INDEX "LeaveAllocation_timesheetDayId_idx" ON "LeaveAllocation"("timesheetDayId");
CREATE INDEX "LeaveAllocation_workDate_idx" ON "LeaveAllocation"("workDate");

ALTER TABLE "LeaveAllocation" ADD CONSTRAINT "LeaveAllocation_leaveRequestId_fkey" FOREIGN KEY ("leaveRequestId") REFERENCES "LeaveRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeaveAllocation" ADD CONSTRAINT "LeaveAllocation_timesheetDayId_fkey" FOREIGN KEY ("timesheetDayId") REFERENCES "TimesheetDay"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
