import { describe, expect, it } from "vitest";
import { recoveryChecksPass, type DatabaseControlTotals } from "../src/services/database-recovery.js";

const healthy: DatabaseControlTotals = {
  organizations: 2,
  liveOrganizations: 0,
  testOrganizations: 2,
  users: 7,
  employees: 4,
  attendanceEvents: 100,
  timesheetDays: 50,
  auditLogs: 20,
  latestAttendanceEventAt: "2026-10-26T00:00:00.000Z",
  ownerCount: 1,
  foreignKeyViolations: 0,
  integrity: "ok",
};

describe("database recovery checks", () => {
  it("passes only when integrity, foreign keys, and owner count are valid", () => {
    expect(recoveryChecksPass(healthy)).toBe(true);
    expect(recoveryChecksPass({ ...healthy, integrity: "corrupt" })).toBe(false);
    expect(recoveryChecksPass({ ...healthy, foreignKeyViolations: 1 })).toBe(false);
    expect(recoveryChecksPass({ ...healthy, ownerCount: 2 })).toBe(false);
  });
});
