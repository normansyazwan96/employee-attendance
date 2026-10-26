import { describe, expect, it } from "vitest";
import { leaveDaysToMinutes, leaveMinutesToDays } from "./leave-duration";

describe("leave duration display", () => {
  it("converts half and full days using the organization workday", () => {
    expect(leaveDaysToMinutes(0.5, 480)).toBe(240);
    expect(leaveDaysToMinutes(1, 480)).toBe(480);
    expect(leaveMinutesToDays(240, 480)).toBe(0.5);
  });

  it("respects a non-eight-hour organization workday", () => {
    expect(leaveDaysToMinutes(0.5, 420)).toBe(210);
    expect(leaveMinutesToDays(420, 420)).toBe(1);
  });
});
