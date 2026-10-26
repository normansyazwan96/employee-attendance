import { describe, expect, it } from "vitest";
import { TimesheetState } from "@prisma/client";
import { applyScheduleExceptions, calculateScheduleMetrics } from "../src/services/schedule-metrics.js";

describe("schedule metrics", () => {
  it("applies the grace period when calculating lateness", () => {
    const result = calculateScheduleMetrics("2026-10-23", new Date("2026-10-23T01:16:00Z"), new Date("2026-10-23T09:00:00Z"), { startTime: "09:00", endTime: "17:00", gracePeriodMinutes: 10, isOvernight: false });
    expect(result).toEqual({ lateMinutes: 6, earlyDepartureMinutes: 0 });
  });

  it("calculates an overnight shift against the following day", () => {
    const result = calculateScheduleMetrics("2026-10-23", new Date("2026-10-23T14:00:00Z"), new Date("2026-10-23T21:40:00Z"), { startTime: "22:00", endTime: "06:00", gracePeriodMinutes: 0, isOvernight: true });
    expect(result).toEqual({ lateMinutes: 0, earlyDepartureMinutes: 20 });
  });

  it("promotes schedule deviations into timesheet exceptions", () => {
    expect(applyScheduleExceptions(
      { state: TimesheetState.COMPLETE, exceptionCodes: [] },
      { lateMinutes: 6, earlyDepartureMinutes: 20 },
    )).toEqual({ state: TimesheetState.EXCEPTION, exceptionCodes: ["EARLY_DEPARTURE", "LATE_ARRIVAL"] });
  });

  it("keeps an active shift open while retaining its late-arrival exception", () => {
    expect(applyScheduleExceptions(
      { state: TimesheetState.OPEN, exceptionCodes: ["MISSING_CLOCK_OUT"] },
      { lateMinutes: 6, earlyDepartureMinutes: 0 },
    )).toEqual({ state: TimesheetState.OPEN, exceptionCodes: ["LATE_ARRIVAL", "MISSING_CLOCK_OUT"] });
  });
});
