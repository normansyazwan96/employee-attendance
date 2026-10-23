import { describe, expect, it } from "vitest";
import { malaysiaCalendar } from "../src/controllers/workforce-v2.controller.js";

describe("Malaysian holiday calendars", () => {
  it("includes federal holidays and the selected state's holidays", () => {
    const johor = malaysiaCalendar(2026, "01");
    expect(johor?.states["01"]).toBe("Johor");
    expect(johor?.holidays.some((holiday) => holiday.date === "2026-08-31")).toBe(true);
    expect(johor?.holidays.some((holiday) => holiday.name.toLowerCase().includes("johor"))).toBe(true);
  });

  it("rejects unknown state codes", () => {
    expect(malaysiaCalendar(2026, "99")).toBeNull();
  });
});
