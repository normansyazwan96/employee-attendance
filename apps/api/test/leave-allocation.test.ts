import { describe, expect, it } from "vitest";
import { planLeaveAllocations } from "../src/services/leave-allocation.js";

describe("leave allocation", () => {
  it("allocates leave only to scheduled non-holiday days", () => {
    const allocations = planLeaveAllocations({
      startDate: "2026-08-31",
      endDate: "2026-09-02",
      requestedMinutes: 960,
      assignments: [],
      legacySchedule: null,
      holidays: [{ date: "2026-08-31", isWorkingDayOverride: false }],
      defaultDayMinutes: 480,
      defaultBreakMinutes: 60,
    });
    expect(allocations).toEqual([
      { workDate: "2026-09-01", scheduledMinutes: 480, minutes: 480 },
      { workDate: "2026-09-02", scheduledMinutes: 480, minutes: 480 },
    ]);
  });

  it("supports partial leave and overnight shifts", () => {
    const allocations = planLeaveAllocations({
      startDate: "2026-10-23",
      endDate: "2026-10-23",
      requestedMinutes: 240,
      assignments: [{ effectiveFrom: "2026-01-01", effectiveTo: null, workDays: [5], startTime: "22:00", endTime: "06:00", breakMinutes: 60, isActive: true }],
      legacySchedule: null,
      holidays: [],
      defaultDayMinutes: 480,
      defaultBreakMinutes: 60,
    });
    expect(allocations).toEqual([{ workDate: "2026-10-23", scheduledMinutes: 420, minutes: 240 }]);
  });

  it("rejects requests larger than the scheduled capacity", () => {
    expect(() => planLeaveAllocations({ startDate: "2026-10-24", endDate: "2026-10-25", requestedMinutes: 60, assignments: [], legacySchedule: null, holidays: [], defaultDayMinutes: 480, defaultBreakMinutes: 60 })).toThrow("INSUFFICIENT_SCHEDULED_MINUTES");
  });
});
