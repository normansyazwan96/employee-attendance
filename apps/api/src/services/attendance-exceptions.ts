import { EmploymentStatus, TimesheetState } from "@prisma/client";
import { attendanceDate } from "../utils/attendance-date.js";
import { logger } from "./logger.js";
import { notifyUsers } from "./notifications.js";
import { prisma } from "./prisma.js";

function previousDate(): string {
  const today = new Date(`${attendanceDate()}T00:00:00Z`);
  today.setUTCDate(today.getUTCDate() - 1);
  return today.toISOString().slice(0, 10);
}

export async function detectAttendanceExceptions(): Promise<void> {
  const workDate = previousDate();
  const weekday = new Date(`${workDate}T12:00:00Z`).getUTCDay();
  const employees = await prisma.employee.findMany({
    where: { employmentStatus: EmploymentStatus.ACTIVE, user: { isActive: true, clientId: { not: null } } },
    select: { id: true, user: { select: { clientId: true } }, scheduleAssignments: { where: { effectiveFrom: { lte: workDate }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: workDate } }] }, include: { shiftTemplate: true }, orderBy: { effectiveFrom: "desc" }, take: 1 } },
  });
  let absences = 0;
  for (const employee of employees) {
    const assignment = employee.scheduleAssignments[0];
    const clientId = employee.user.clientId;
    if (!assignment?.shiftTemplate.isActive || !clientId || !assignment.shiftTemplate.workDays.includes(weekday)) continue;
    const holidays = await prisma.holiday.findMany({ where: { clientId, date: workDate }, select: { isWorkingDayOverride: true } });
    if (holidays.some((holiday) => !holiday.isWorkingDayOverride) && !holidays.some((holiday) => holiday.isWorkingDayOverride)) continue;
    const existing = await prisma.timesheetDay.findUnique({ where: { employeeId_workDate: { employeeId: employee.id, workDate } }, select: { id: true } });
    if (!existing) {
      await prisma.timesheetDay.create({ data: { employeeId: employee.id, clientId, workDate, state: TimesheetState.EXCEPTION, isAbsent: true, exceptionCodes: ["ABSENT"] } });
      absences += 1;
    }
  }

  const open = await prisma.timesheetDay.findMany({ where: { state: TimesheetState.OPEN, firstClockInAt: { not: null } }, include: { client: { include: { workPolicy: true } }, employee: { include: { user: { select: { id: true } } } } }, take: 500 });
  let missedClockOuts = 0;
  for (const day of open) {
    const threshold = day.client?.workPolicy?.missedClockOutMinutes ?? 960;
    if (day.firstClockInAt && Date.now() - day.firstClockInAt.getTime() >= threshold * 60_000) {
      await prisma.timesheetDay.update({ where: { id: day.id }, data: { state: TimesheetState.EXCEPTION, exceptionCodes: [...new Set([...day.exceptionCodes, "MISSED_CLOCK_OUT"])] } });
      await notifyUsers({ userIds: [day.employee.user.id], clientId: day.clientId, type: "MISSED_CLOCK_OUT", title: "Missed clock-out", message: `Your attendance for ${day.workDate} is missing a clock-out. Submit a correction request for review.`, entityType: "TimesheetDay", entityId: day.id });
      missedClockOuts += 1;
    }
  }
  if (absences || missedClockOuts) logger.info("attendance_exceptions_detected", { workDate, absences, missedClockOuts });
}
