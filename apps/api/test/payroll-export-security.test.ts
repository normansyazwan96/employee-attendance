import { describe, expect, it } from "vitest";
import { isPayrollExportObjectKeyOwned } from "../src/services/payroll-export.js";

describe("payroll export object ownership", () => {
  const job = { id: "job-1", clientId: "client-1", payPeriodId: "period-1" };

  it("accepts an object stored under its organization, pay period, and job", () => {
    expect(isPayrollExportObjectKeyOwned({ ...job, r2Key: "client-1/period-1/job-1/payroll.csv" })).toBe(true);
  });

  it("rejects an object key belonging to another organization or export job", () => {
    expect(isPayrollExportObjectKeyOwned({ ...job, r2Key: "client-2/period-1/job-1/payroll.csv" })).toBe(false);
    expect(isPayrollExportObjectKeyOwned({ ...job, r2Key: "client-1/period-1/job-2/payroll.csv" })).toBe(false);
  });
});
