import { attendanceDate } from "../utils/attendance-date.js";

export type AttendanceRuleStatus = "ON_TIME" | "LATE" | "NOT_SCHEDULED" | "NO_SCHEDULE" | "MISSED_CLOCK_OUT";
type Schedule = { workDays: number[]; startTime: string; gracePeriodMinutes: number; isActive: boolean };
type Attendance = { workDate: string; clockInAt: Date; clockOutAt: Date | null };
export type AttendanceHours = { totalWorkingHours: number; overtimeHours: number };

function weekday(workDate: string): number {
  const [year, month, day] = workDate.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function localParts(value: Date): number[] {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: process.env.ATTENDANCE_TIMEZONE ?? "UTC", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(value);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return [Number(values.year), Number(values.month), Number(values.day), Number(values.hour), Number(values.minute), Number(values.second)];
}

function scheduledStart(workDate: string, startTime: string): Date {
  const [year, month, day] = workDate.split("-").map(Number);
  const [hour, minute] = startTime.split(":").map(Number);
  const desiredLocal = Date.UTC(year, month - 1, day, hour, minute);
  let candidate = new Date(desiredLocal);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const [year, month, day, localHour, localMinute, localSecond] = localParts(candidate);
    const represented = Date.UTC(year, month - 1, day, localHour, localMinute, localSecond);
    candidate = new Date(candidate.getTime() + desiredLocal - represented);
  }
  return candidate;
}

export function calculateAttendanceHours(attendance: Attendance): AttendanceHours {
  if (!attendance.clockOutAt) {
    return { totalWorkingHours: 0, overtimeHours: 0 };
  }

  const totalMinutesWorked = Math.max((attendance.clockOutAt.getTime() - attendance.clockInAt.getTime()) / 60_000 - 60, 0);
  const totalWorkingHours = Number((totalMinutesWorked / 60).toFixed(2));
  const overtimeHours = Number(Math.max(totalWorkingHours - 8, 0).toFixed(2));

  return {
    totalWorkingHours,
    overtimeHours,
  };
}

export function classifyAttendance(attendance: Attendance, schedule: Schedule | null): AttendanceRuleStatus {
  if (!attendance.clockOutAt && attendance.workDate < attendanceDate()) return "MISSED_CLOCK_OUT";
  if (!schedule || !schedule.isActive) return "NO_SCHEDULE";
  if (!schedule.workDays.includes(weekday(attendance.workDate))) return "NOT_SCHEDULED";
  const deadline = scheduledStart(attendance.workDate, schedule.startTime).getTime() + schedule.gracePeriodMinutes * 60_000;
  return attendance.clockInAt.getTime() <= deadline ? "ON_TIME" : "LATE";
}
