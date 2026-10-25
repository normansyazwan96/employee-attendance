import { describe, expect, it } from "vitest";
import { malaysiaCalendar } from "../src/controllers/workforce-v2.controller.js";
import { allMalaysiaHolidays, holidayImportReminderYear, isPublicHolidayForState, malaysiaStates } from "../src/services/malaysia-holidays.js";

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

  it("loads the Selangor calendar used by the import workflow", () => {
    const selangor = malaysiaCalendar(2026, "10");
    expect(selangor?.states["10"]).toBe("Selangor");
    expect(selangor?.holidays.length).toBeGreaterThan(0);
    expect(selangor?.holidays.some((holiday) => holiday.date === "2026-08-31")).toBe(true);
    expect(selangor?.holidays.some((holiday) => holiday.date === "2026-12-11")).toBe(true);
    expect(new Set(selangor?.holidays.map(({ date, name }) => `${date}:${name}`)).size).toBe(selangor?.holidays.length);
  });

  it("builds one import catalogue containing every Malaysian state and territory", () => {
    const catalogue = allMalaysiaHolidays(2027);
    expect(new Set(catalogue.map((holiday) => holiday.stateCode))).toEqual(new Set(Object.keys(malaysiaStates())));
    expect(catalogue.length).toBeGreaterThan(200);
    expect(new Set(catalogue.map((holiday) => `${holiday.stateCode}:${holiday.date}:${holiday.name}`)).size).toBe(catalogue.length);
  });

  it("uses the worksite state and respects organization working-day overrides", () => {
    const malaysiaHolidays = [{ date: "2027-12-11", stateCode: "10" }];
    expect(isPublicHolidayForState({ workDate: "2027-12-11", stateCode: "10", organizationHolidays: [], malaysiaHolidays })).toBe(true);
    expect(isPublicHolidayForState({ workDate: "2027-12-11", stateCode: "14", organizationHolidays: [], malaysiaHolidays })).toBe(false);
    expect(isPublicHolidayForState({ workDate: "2027-12-11", stateCode: "10", organizationHolidays: [{ date: "2027-12-11", stateCode: "10", isWorkingDayOverride: true }], malaysiaHolidays })).toBe(false);
  });

  it("starts the next-year reminder seven days before 1 January in Malaysia", () => {
    expect(holidayImportReminderYear(new Date("2026-12-24T15:59:59.000Z"))).toBeNull();
    expect(holidayImportReminderYear(new Date("2026-12-24T16:00:00.000Z"))).toBe(2027);
    expect(holidayImportReminderYear(new Date("2027-01-01T00:00:00.000Z"))).toBeNull();
  });
});
