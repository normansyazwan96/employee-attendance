import { describe, expect, it } from "vitest";
import { comparePayrollEmployeeCoverage } from "../src/services/payroll-calculation-run.js";

describe("payroll employee coverage", () => {
  it("accepts the same organization employee set regardless of result order", () => {
    expect(comparePayrollEmployeeCoverage(["employee-a", "employee-b"], ["employee-b", "employee-a"])).toMatchObject({
      complete: true,
      expectedEmployeeCount: 2,
      resultEmployeeCount: 2,
      missingEmployeeIds: [],
      unexpectedEmployeeIds: [],
      duplicateResultCount: 0,
    });
  });

  it("reports employees added or removed after calculation", () => {
    expect(comparePayrollEmployeeCoverage(["employee-a", "employee-b"], ["employee-a", "employee-c"])).toMatchObject({
      complete: false,
      missingEmployeeIds: ["employee-b"],
      unexpectedEmployeeIds: ["employee-c"],
    });
  });

  it("rejects duplicate result rows", () => {
    expect(comparePayrollEmployeeCoverage(["employee-a"], ["employee-a", "employee-a"])).toMatchObject({
      complete: false,
      duplicateResultCount: 1,
    });
  });
});
