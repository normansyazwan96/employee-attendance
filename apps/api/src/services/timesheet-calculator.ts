import { AttendanceEventType, TimesheetState } from "@prisma/client";

export type TimesheetEvent = { type: AttendanceEventType; occurredAt: Date };

export type TimesheetCalculation = {
  state: TimesheetState;
  firstClockInAt: Date | null;
  lastClockOutAt: Date | null;
  regularMinutes: number;
  overtimeMinutes: number;
  breakMinutes: number;
  exceptionCodes: string[];
};

export type TimesheetPolicy = { regularDayMinutes?: number; roundingIncrement?: number; maximumShiftMinutes?: number };

function roundedMinutes(milliseconds: number, increment: number): number {
  const minutes = milliseconds / 60_000;
  return Math.round(minutes / increment) * increment;
}

export function calculateTimesheet(events: TimesheetEvent[], policy: number | TimesheetPolicy = 8 * 60): TimesheetCalculation {
  const options = typeof policy === "number" ? { regularDayMinutes: policy } : policy;
  const regularDayMinutes = options.regularDayMinutes ?? 8 * 60;
  const roundingIncrement = options.roundingIncrement ?? 1;
  const ordered = [...events].sort((first, second) => first.occurredAt.getTime() - second.occurredAt.getTime());
  const exceptions = new Set<string>();
  let workStartedAt: Date | null = null;
  let breakStartedAt: Date | null = null;
  let firstClockInAt: Date | null = null;
  let lastClockOutAt: Date | null = null;
  let workedMilliseconds = 0;
  let breakMilliseconds = 0;

  for (const event of ordered) {
    switch (event.type) {
      case AttendanceEventType.CLOCK_IN:
        if (workStartedAt || breakStartedAt) exceptions.add("DUPLICATE_CLOCK_IN");
        else {
          workStartedAt = event.occurredAt;
          firstClockInAt ??= event.occurredAt;
        }
        break;
      case AttendanceEventType.BREAK_START:
        if (!workStartedAt || breakStartedAt) exceptions.add("UNPAIRED_BREAK_START");
        else {
          workedMilliseconds += Math.max(event.occurredAt.getTime() - workStartedAt.getTime(), 0);
          workStartedAt = null;
          breakStartedAt = event.occurredAt;
        }
        break;
      case AttendanceEventType.BREAK_END:
        if (!breakStartedAt || workStartedAt) exceptions.add("UNPAIRED_BREAK_END");
        else {
          breakMilliseconds += Math.max(event.occurredAt.getTime() - breakStartedAt.getTime(), 0);
          breakStartedAt = null;
          workStartedAt = event.occurredAt;
        }
        break;
      case AttendanceEventType.CLOCK_OUT:
        if (breakStartedAt) {
          breakMilliseconds += Math.max(event.occurredAt.getTime() - breakStartedAt.getTime(), 0);
          breakStartedAt = null;
          exceptions.add("BREAK_NOT_ENDED");
        } else if (workStartedAt) {
          workedMilliseconds += Math.max(event.occurredAt.getTime() - workStartedAt.getTime(), 0);
          workStartedAt = null;
        } else {
          exceptions.add("UNPAIRED_CLOCK_OUT");
        }
        lastClockOutAt = event.occurredAt;
        break;
    }
  }

  const open = workStartedAt !== null || breakStartedAt !== null;
  if (open) exceptions.add("MISSING_CLOCK_OUT");
  const workedMinutes = roundedMinutes(workedMilliseconds, roundingIncrement);
  if (options.maximumShiftMinutes && workedMinutes > options.maximumShiftMinutes) exceptions.add("EXCESSIVE_HOURS");
  const state = open
    ? TimesheetState.OPEN
    : exceptions.size > 0 ? TimesheetState.EXCEPTION : TimesheetState.COMPLETE;

  return {
    state,
    firstClockInAt,
    lastClockOutAt,
    regularMinutes: Math.min(workedMinutes, regularDayMinutes),
    overtimeMinutes: Math.max(workedMinutes - regularDayMinutes, 0),
    breakMinutes: roundedMinutes(breakMilliseconds, roundingIncrement),
    exceptionCodes: [...exceptions].sort(),
  };
}
