import {
  EpfContributionCategory,
  PayType,
  PayrollCalculationBasis,
  PayrollComponentType,
  PayrollJurisdiction,
  SocsoContributionCategory,
  TimesheetState,
} from "@prisma/client";
import { describe, expect, it } from "vitest";
import { calculateEmployeePayroll, type PayrollCalculationInput, type PayrollDayInput } from "../src/services/payroll-calculator.js";

const completeDay = (overrides: Partial<PayrollDayInput> = {}): PayrollDayInput => ({
  workDate: "2026-10-01",
  state: TimesheetState.COMPLETE,
  regularMinutes: 480,
  overtimeMinutes: 0,
  paidLeaveMinutes: 0,
  unpaidLeaveMinutes: 0,
  isAbsent: false,
  isRestDay: false,
  isPublicHoliday: false,
  ...overrides,
});

const monthly = (overrides: Partial<PayrollCalculationInput> = {}): PayrollCalculationInput => ({
  periodStart: "2026-10-01",
  periodEnd: "2026-10-31",
  employmentStart: null,
  employmentEnd: null,
  jurisdiction: PayrollJurisdiction.PENINSULAR_LABUAN,
  salaryDivisor: 26,
  profile: {
    id: "profile-1",
    payType: PayType.MONTHLY,
    baseRateSen: 310_000,
    normalDailyMinutes: 480,
    normalWeeklyMinutes: 2_700,
    overtimeEligible: true,
    effectiveFrom: "2026-01-01",
    effectiveTo: null,
  },
  days: [],
  components: [],
  hasSchedule: true,
  ...overrides,
});

describe("payroll calculator", () => {
  it("accrues full and partial monthly base pay by calendar days", () => {
    expect(calculateEmployeePayroll(monthly()).basePaySen).toBe(310_000);
    expect(calculateEmployeePayroll(monthly({ employmentStart: "2026-10-16" })).basePaySen).toBe(160_000);
  });

  it("calculates normal overtime, rest-day tiers, and public-holiday work", () => {
    const result = calculateEmployeePayroll(monthly({ days: [
      completeDay({ workDate: "2026-10-01", overtimeMinutes: 120 }),
      completeDay({ workDate: "2026-10-04", regularMinutes: 240, isRestDay: true }),
      completeDay({ workDate: "2026-10-10", overtimeMinutes: 120, isPublicHoliday: true }),
    ] }));
    expect(result.overtimePaySen).toBe(4_471);
    expect(result.restDayPaySen).toBe(5_962);
    expect(result.publicHolidayPaySen).toBe(32_788);
  });

  it("calculates daily regular pay, leave, rest days, and holidays", () => {
    const input = monthly({
      profile: { ...monthly().profile!, payType: PayType.DAILY, baseRateSen: 10_000 },
      days: [
        completeDay(),
        completeDay({ workDate: "2026-10-02", regularMinutes: 0, paidLeaveMinutes: 480 }),
        completeDay({ workDate: "2026-10-04", regularMinutes: 240, isRestDay: true }),
        completeDay({ workDate: "2026-10-10", isPublicHoliday: true }),
      ],
    });
    const result = calculateEmployeePayroll(input);
    expect(result.regularPaySen).toBe(10_000);
    expect(result.paidLeavePaySen).toBe(10_000);
    expect(result.restDayPaySen).toBe(10_000);
    expect(result.publicHolidayPaySen).toBe(30_000);
  });

  it("itemizes unpaid leave, percentage deductions, earnings, and capped advances", () => {
    const result = calculateEmployeePayroll(monthly({
      days: [completeDay({ regularMinutes: 0, unpaidLeaveMinutes: 480 })],
      components: [
        { id: "allowance", amountSen: 10_000, percentageBasisPoints: null, outstandingAmountSen: null, effectiveFrom: "2026-10-01", effectiveTo: null, payrollComponent: { code: "PHONE", name: "Phone allowance", type: PayrollComponentType.EARNING, calculationBasis: PayrollCalculationBasis.FIXED_AMOUNT } },
        { id: "deduction", amountSen: 0, percentageBasisPoints: 1_000, outstandingAmountSen: null, effectiveFrom: "2026-10-01", effectiveTo: null, payrollComponent: { code: "DEDUCT", name: "Authorized deduction", type: PayrollComponentType.DEDUCTION, calculationBasis: PayrollCalculationBasis.PERCENTAGE } },
        { id: "advance", amountSen: 25_000, percentageBasisPoints: null, outstandingAmountSen: 5_000, effectiveFrom: "2026-10-01", effectiveTo: null, payrollComponent: { code: "ADV", name: "Advance", type: PayrollComponentType.ADVANCE_REPAYMENT, calculationBasis: PayrollCalculationBasis.FIXED_AMOUNT } },
      ],
    }));
    expect(result.unpaidLeaveDeductionSen).toBe(10_000);
    expect(result.additionalEarningsSen).toBe(10_000);
    expect(result.otherDeductionsSen).toBe(31_000);
    expect(result.advanceDeductionSen).toBe(5_000);
    expect(result.calculatedPaySen).toBe(274_000);
    expect(result.lines.map((line) => line.code)).toEqual(expect.arrayContaining(["BASE_PAY", "UNPAID_LEAVE", "PHONE", "DEDUCT", "ADV"]));
  });

  it("blocks unsupported jurisdictions and unresolved timesheets", () => {
    const unsupported = calculateEmployeePayroll(monthly({ jurisdiction: PayrollJurisdiction.SABAH }));
    expect(unsupported.blockingWarnings).toContain("UNSUPPORTED_JURISDICTION");
    const unresolved = calculateEmployeePayroll(monthly({ days: [completeDay({ state: TimesheetState.EXCEPTION })] }));
    expect(unresolved.blockingWarnings).toContain("UNRESOLVED_TIMESHEET");
  });

  it("deducts employee statutory contributions without reducing pay by employer shares", () => {
    const result = calculateEmployeePayroll(monthly({
      days: [completeDay({ overtimeMinutes: 120 })],
      statutoryContributionsEnabled: true,
      statutoryRuleVersion: "MY-STAT-2025-10-01",
      statutoryProfile: {
        id: "statutory-1",
        epfCategory: EpfContributionCategory.STANDARD_UNDER_60,
        socsoCategory: SocsoContributionCategory.FIRST,
        eisEligible: true,
        effectiveFrom: "2026-01-01",
        effectiveTo: null,
      },
    }));
    expect(result.epfWagesSen).toBe(310_000);
    expect(result.socsoWagesSen).toBe(result.grossPaySen);
    expect(result.epfEmployeeSen).toBe(34_100);
    expect(result.employerContributionsSen).toBeGreaterThan(0);
    expect(result.calculatedPaySen).toBe(result.grossPaySen - result.totalDeductionsSen);
    expect(result.lines.some((line) => line.direction === "EMPLOYER_CONTRIBUTION")).toBe(true);
  });

  it("blocks statutory payroll until an employee profile is configured", () => {
    const result = calculateEmployeePayroll(monthly({ statutoryContributionsEnabled: true, statutoryRuleVersion: "MY-STAT-2025-10-01" }));
    expect(result.blockingWarnings).toContain("MISSING_STATUTORY_PROFILE");
  });

  it("flags statutory exemptions, contribution ceilings, and significant wage differences for review", () => {
    const exempt = calculateEmployeePayroll(monthly({
      statutoryContributionsEnabled: true,
      statutoryRuleVersion: "MY-STAT-2025-10-01",
      statutoryProfile: { id: "exempt", epfCategory: EpfContributionCategory.EXEMPT, socsoCategory: SocsoContributionCategory.EXEMPT, eisEligible: false, effectiveFrom: "2026-01-01", effectiveTo: null },
    }));
    expect(exempt.warnings).toEqual(expect.arrayContaining(["EPF_EXEMPT", "SOCSO_EXEMPT", "EIS_EXEMPT"]));

    const ceiling = calculateEmployeePayroll(monthly({
      profile: { ...monthly().profile!, baseRateSen: 700_000 },
      days: [completeDay({ overtimeMinutes: 1_000 })],
      statutoryContributionsEnabled: true,
      statutoryRuleVersion: "MY-STAT-2025-10-01",
      statutoryProfile: { id: "standard", epfCategory: EpfContributionCategory.STANDARD_UNDER_60, socsoCategory: SocsoContributionCategory.FIRST, eisEligible: true, effectiveFrom: "2026-01-01", effectiveTo: null },
    }));
    expect(ceiling.warnings).toEqual(expect.arrayContaining(["SOCSO_WAGE_CEILING_REACHED", "EIS_WAGE_CEILING_REACHED", "CONTRIBUTION_WAGES_DIFFER_SIGNIFICANTLY_FROM_GROSS"]));
  });
});
