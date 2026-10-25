import { EpfContributionCategory, SocsoContributionCategory } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  calculateEisContribution,
  calculateEpfContribution,
  calculateMalaysiaStatutoryContributions,
  calculateSocsoContribution,
} from "../src/services/malaysia-statutory-contributions.js";

describe("Malaysian statutory contribution schedules", () => {
  it("uses the October 2025 EPF wage-band table for a standard employee", () => {
    expect(calculateEpfContribution(325_000, EpfContributionCategory.STANDARD_UNDER_60)).toEqual({
      wagesSen: 325_000,
      employeeSen: 35_900,
      employerSen: 42_400,
    });
  });

  it("switches the EPF employer rate above RM5,000 and uses actual wages above RM20,000", () => {
    expect(calculateEpfContribution(500_001, EpfContributionCategory.STANDARD_UNDER_60)).toEqual({ wagesSen: 500_001, employeeSen: 56_100, employerSen: 61_200 });
    expect(calculateEpfContribution(2_125_000, EpfContributionCategory.STANDARD_UNDER_60)).toEqual({ wagesSen: 2_125_000, employeeSen: 233_750, employerSen: 255_000 });
  });

  it("supports EPF Parts C, E, F, and exempt employees", () => {
    expect(calculateEpfContribution(325_000, EpfContributionCategory.PR_OR_PRE_1998_60_PLUS)).toEqual({ wagesSen: 325_000, employeeSen: 18_000, employerSen: 21_200 });
    expect(calculateEpfContribution(325_000, EpfContributionCategory.MALAYSIAN_60_PLUS)).toEqual({ wagesSen: 325_000, employeeSen: 0, employerSen: 13_100 });
    expect(calculateEpfContribution(325_000, EpfContributionCategory.NON_MALAYSIAN)).toEqual({ wagesSen: 325_000, employeeSen: 6_600, employerSen: 6_600 });
    expect(calculateEpfContribution(325_000, EpfContributionCategory.EXEMPT).employeeSen).toBe(0);
  });

  it("uses the supplied SOCSO first and second category table including SKBBK", () => {
    expect(calculateSocsoContribution(325_000, SocsoContributionCategory.FIRST)).toEqual({ wagesSen: 325_000, employeeSen: 1_625, employerSen: 8_120 });
    expect(calculateSocsoContribution(325_000, SocsoContributionCategory.SECOND)).toEqual({ wagesSen: 325_000, employeeSen: 0, employerSen: 6_495 });
    expect(calculateSocsoContribution(900_000, SocsoContributionCategory.FIRST)).toEqual({ wagesSen: 900_000, employeeSen: 2_975, employerSen: 14_880 });
  });

  it("uses the Act 800 EIS table and RM6,000 ceiling", () => {
    expect(calculateEisContribution(325_000, true)).toEqual({ wagesSen: 325_000, employeeSen: 650, employerSen: 650 });
    expect(calculateEisContribution(900_000, true)).toEqual({ wagesSen: 900_000, employeeSen: 1_190, employerSen: 1_190 });
    expect(calculateEisContribution(325_000, false).employeeSen).toBe(0);
  });

  it("totals employee deductions separately from employer contributions", () => {
    const result = calculateMalaysiaStatutoryContributions({
      epfWagesSen: 325_000,
      socsoWagesSen: 325_000,
      eisWagesSen: 325_000,
      epfCategory: EpfContributionCategory.STANDARD_UNDER_60,
      socsoCategory: SocsoContributionCategory.FIRST,
      eisEligible: true,
    });
    expect(result.employeeTotalSen).toBe(38_175);
    expect(result.employerTotalSen).toBe(51_170);
  });
});
