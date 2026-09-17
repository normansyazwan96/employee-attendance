import { describe, expect, it } from "vitest";
import { attendanceDate } from "../src/utils/attendance-date.js";

describe("attendanceDate", () => {
  it("uses the configured business timezone at a UTC date boundary", () => {
    expect(attendanceDate(new Date("2026-08-19T17:00:00.000Z"))).toBe("2026-08-20");
  });
});