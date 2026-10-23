import { TimesheetState, type ShiftTemplate } from "@prisma/client";
import { env } from "../config/env.js";

function localParts(date: Date): { date: string; minute: number } {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: env.ATTENDANCE_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "00";
  return { date: `${value("year")}-${value("month")}-${value("day")}`, minute: Number(value("hour")) * 60 + Number(value("minute")) };
}

function dateNumber(value: string): number { return Date.parse(`${value}T00:00:00Z`) / 60_000; }
function timeMinutes(value: string): number { const [hour = 0, minute = 0] = value.split(":").map(Number); return hour * 60 + minute; }

export function calculateScheduleMetrics(workDate: string, firstClockInAt: Date | null, lastClockOutAt: Date | null, shift: Pick<ShiftTemplate, "startTime" | "endTime" | "gracePeriodMinutes" | "isOvernight"> | null): { lateMinutes: number; earlyDepartureMinutes: number } {
  if (!shift) return { lateMinutes: 0, earlyDepartureMinutes: 0 };
  const start = dateNumber(workDate) + timeMinutes(shift.startTime);
  const endDate = shift.isOvernight ? new Date(Date.parse(`${workDate}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10) : workDate;
  const end = dateNumber(endDate) + timeMinutes(shift.endTime);
  const clockIn = firstClockInAt ? localParts(firstClockInAt) : null;
  const clockOut = lastClockOutAt ? localParts(lastClockOutAt) : null;
  const actualIn = clockIn ? dateNumber(clockIn.date) + clockIn.minute : null;
  const actualOut = clockOut ? dateNumber(clockOut.date) + clockOut.minute : null;
  return {
    lateMinutes: actualIn === null ? 0 : Math.max(actualIn - start - shift.gracePeriodMinutes, 0),
    earlyDepartureMinutes: actualOut === null ? 0 : Math.max(end - actualOut, 0),
  };
}

export function applyScheduleExceptions(
  calculation: { state: TimesheetState; exceptionCodes: string[] },
  metrics: { lateMinutes: number; earlyDepartureMinutes: number },
): { state: TimesheetState; exceptionCodes: string[] } {
  const exceptionCodes = new Set(calculation.exceptionCodes);
  if (metrics.lateMinutes > 0) exceptionCodes.add("LATE_ARRIVAL");
  if (metrics.earlyDepartureMinutes > 0) exceptionCodes.add("EARLY_DEPARTURE");
  return {
    state: calculation.state === TimesheetState.OPEN
      ? TimesheetState.OPEN
      : exceptionCodes.size > 0 ? TimesheetState.EXCEPTION : calculation.state,
    exceptionCodes: [...exceptionCodes].sort(),
  };
}
