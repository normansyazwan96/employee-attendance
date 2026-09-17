import { describe, expect, it } from "vitest";
import { calculateAttendanceHours, classifyAttendance } from "../src/services/attendance-rules.js";

const schedule = { workDays: [1, 2, 3, 4, 5], startTime: "09:00", gracePeriodMinutes: 10, isActive: true };
const clockedOut = new Date("2026-08-21T10:00:00.000Z");

describe("calculateAttendanceHours", () => {
  it("deducts a one-hour break and keeps overtime at zero for an 8-hour day", () => {
    expect(calculateAttendanceHours({ workDate: "2026-08-21", clockInAt: new Date("2026-08-21T08:00:00.000Z"), clockOutAt: new Date("2026-08-21T17:00:00.000Z") })).toEqual({ totalWorkingHours: 8, overtimeHours: 0 });
  });

  it("adds overtime when the workday exceeds 8 hours after the break", () => {
    expect(calculateAttendanceHours({ workDate: "2026-08-21", clockInAt: new Date("2026-08-21T08:00:00.000Z"), clockOutAt: new Date("2026-08-21T20:00:00.000Z") })).toEqual({ totalWorkingHours: 11, overtimeHours: 3 });
  });
});

describe("classifyAttendance", () => {
  it("marks a clock-in within the grace period on time", () => {
    expect(classifyAttendance({ workDate: "2026-08-21", clockInAt: new Date("2026-08-21T01:10:00.000Z"), clockOutAt: clockedOut }, schedule)).toBe("ON_TIME");
  });

  it("marks a clock-in after the grace period late", () => {
    expect(classifyAttendance({ workDate: "2026-08-21", clockInAt: new Date("2026-08-21T01:11:00.000Z"), clockOutAt: clockedOut }, schedule)).toBe("LATE");
  });

  it("marks a day outside the schedule as not scheduled", () => {
    expect(classifyAttendance({ workDate: "2026-08-23", clockInAt: new Date("2026-08-23T01:00:00.000Z"), clockOutAt: new Date("2026-08-23T10:00:00.000Z") }, schedule)).toBe("NOT_SCHEDULED");
  });

  it("distinguishes missing schedules", () => {
    expect(classifyAttendance({ workDate: "2026-08-21", clockInAt: new Date("2026-08-21T01:00:00.000Z"), clockOutAt: clockedOut }, null)).toBe("NO_SCHEDULE");
  });

  it("flags a past open attendance record as missed clock-out", () => {
    expect(classifyAttendance({ workDate: "2020-01-03", clockInAt: new Date("2020-01-03T01:00:00.000Z"), clockOutAt: null }, schedule)).toBe("MISSED_CLOCK_OUT");
  });
});
