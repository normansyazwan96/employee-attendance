import { AttendanceEventType, TimesheetState } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { calculateTimesheet } from "../src/services/timesheet-calculator.js";

const event = (type: AttendanceEventType, value: string) => ({ type, occurredAt: new Date(value) });

describe("timesheet calculation", () => {
  it("calculates an overnight shift using elapsed server time", () => {
    const result = calculateTimesheet([
      event(AttendanceEventType.CLOCK_IN, "2026-10-23T14:00:00Z"),
      event(AttendanceEventType.CLOCK_OUT, "2026-10-24T00:30:00Z"),
    ]);
    expect(result).toMatchObject({ state: TimesheetState.COMPLETE, regularMinutes: 480, overtimeMinutes: 150, breakMinutes: 0, exceptionCodes: [] });
  });

  it("excludes explicit breaks from worked time", () => {
    const result = calculateTimesheet([
      event(AttendanceEventType.CLOCK_IN, "2026-10-23T01:00:00Z"),
      event(AttendanceEventType.BREAK_START, "2026-10-23T05:00:00Z"),
      event(AttendanceEventType.BREAK_END, "2026-10-23T06:00:00Z"),
      event(AttendanceEventType.CLOCK_OUT, "2026-10-23T10:00:00Z"),
    ]);
    expect(result).toMatchObject({ state: TimesheetState.COMPLETE, regularMinutes: 480, overtimeMinutes: 0, breakMinutes: 60 });
  });

  it("keeps an incomplete shift open and reports the exception", () => {
    const result = calculateTimesheet([event(AttendanceEventType.CLOCK_IN, "2026-10-23T01:00:00Z")]);
    expect(result.state).toBe(TimesheetState.OPEN);
    expect(result.exceptionCodes).toContain("MISSING_CLOCK_OUT");
  });

  it("marks invalid event sequences for review", () => {
    const result = calculateTimesheet([event(AttendanceEventType.CLOCK_OUT, "2026-10-23T10:00:00Z")]);
    expect(result.state).toBe(TimesheetState.EXCEPTION);
    expect(result.exceptionCodes).toContain("UNPAIRED_CLOCK_OUT");
  });

  it("applies configured rounding and flags excessive shifts", () => {
    const result = calculateTimesheet([
      event(AttendanceEventType.CLOCK_IN, "2026-10-23T01:00:00Z"),
      event(AttendanceEventType.CLOCK_OUT, "2026-10-23T11:07:00Z"),
    ], { regularDayMinutes: 480, roundingIncrement: 15, maximumShiftMinutes: 599 });
    expect(result.regularMinutes).toBe(480);
    expect(result.overtimeMinutes).toBe(120);
    expect(result.exceptionCodes).toContain("EXCESSIVE_HOURS");
  });
});
