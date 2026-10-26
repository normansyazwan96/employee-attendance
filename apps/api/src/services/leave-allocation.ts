export type EffectiveShift = {
  effectiveFrom: string;
  effectiveTo: string | null;
  workDays: number[];
  startTime: string;
  endTime: string;
  breakMinutes: number;
  isActive: boolean;
};

export type LegacySchedule = {
  workDays: number[];
  startTime: string;
  endTime: string;
  isActive: boolean;
};

export type HolidayDay = { date: string; isWorkingDayOverride: boolean };
export type LeaveDayAllocation = { workDate: string; scheduledMinutes: number; minutes: number };

function timeMinutes(value: string): number {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

function shiftDuration(startTime: string, endTime: string, breakMinutes: number): number {
  const start = timeMinutes(startTime);
  let end = timeMinutes(endTime);
  if (end <= start) end += 24 * 60;
  return Math.max(end - start - breakMinutes, 1);
}

function dateRange(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  const cursor = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);
  while (cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

export function planLeaveAllocations(input: {
  startDate: string;
  endDate: string;
  requestedMinutes: number;
  assignments: EffectiveShift[];
  legacySchedule: LegacySchedule | null;
  holidays: HolidayDay[];
  defaultDayMinutes: number;
  defaultBreakMinutes: number;
}): LeaveDayAllocation[] {
  const holidayDates = new Map<string, HolidayDay[]>();
  for (const holiday of input.holidays) holidayDates.set(holiday.date, [...(holidayDates.get(holiday.date) ?? []), holiday]);
  const capacities = dateRange(input.startDate, input.endDate).flatMap((workDate) => {
    const holidays = holidayDates.get(workDate) ?? [];
    if (holidays.some((holiday) => !holiday.isWorkingDayOverride) && !holidays.some((holiday) => holiday.isWorkingDayOverride)) return [];
    const weekday = new Date(`${workDate}T00:00:00.000Z`).getUTCDay();
    const assignment = input.assignments
      .filter((item) => item.isActive && item.effectiveFrom <= workDate && (!item.effectiveTo || item.effectiveTo >= workDate))
      .sort((first, second) => second.effectiveFrom.localeCompare(first.effectiveFrom))[0];
    if (assignment) {
      return assignment.workDays.includes(weekday) ? [{ workDate, scheduledMinutes: shiftDuration(assignment.startTime, assignment.endTime, assignment.breakMinutes) }] : [];
    }
    if (input.legacySchedule?.isActive) {
      return input.legacySchedule.workDays.includes(weekday) ? [{ workDate, scheduledMinutes: shiftDuration(input.legacySchedule.startTime, input.legacySchedule.endTime, input.defaultBreakMinutes) }] : [];
    }
    return weekday >= 1 && weekday <= 5 ? [{ workDate, scheduledMinutes: input.defaultDayMinutes }] : [];
  });

  let remaining = input.requestedMinutes;
  const allocations: LeaveDayAllocation[] = [];
  for (const day of capacities) {
    if (remaining <= 0) break;
    const minutes = Math.min(day.scheduledMinutes, remaining);
    allocations.push({ ...day, minutes });
    remaining -= minutes;
  }
  if (remaining > 0) throw new Error("INSUFFICIENT_SCHEDULED_MINUTES");
  return allocations;
}
