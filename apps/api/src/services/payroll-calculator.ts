import {
  EpfContributionCategory,
  PayType,
  PayrollCalculationBasis,
  PayrollComponentType,
  PayrollJurisdiction,
  PayrollLineCategory,
  PayrollLineDirection,
  SocsoContributionCategory,
  TimesheetState,
} from "@prisma/client";
import { calculateMalaysiaStatutoryContributions, MALAYSIA_STATUTORY_RULE_VERSION } from "./malaysia-statutory-contributions.js";

export type PayrollDayInput = {
  workDate: string;
  state: TimesheetState;
  regularMinutes: number;
  overtimeMinutes: number;
  paidLeaveMinutes: number;
  unpaidLeaveMinutes: number;
  isAbsent: boolean;
  isRestDay: boolean;
  isPublicHoliday: boolean;
};

export type PayProfileInput = {
  id: string;
  payType: PayType;
  baseRateSen: number;
  normalDailyMinutes: number;
  normalWeeklyMinutes: number;
  overtimeEligible: boolean;
  effectiveFrom: string;
  effectiveTo: string | null;
};

export type PayComponentInput = {
  id: string;
  amountSen: number;
  percentageBasisPoints: number | null;
  outstandingAmountSen: number | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  payrollComponent: {
    code: string;
    name: string;
    type: PayrollComponentType;
    calculationBasis: PayrollCalculationBasis;
    epfEligible?: boolean;
    socsoEligible?: boolean;
    eisEligible?: boolean;
  };
};

export type StatutoryProfileInput = {
  id: string;
  epfCategory: EpfContributionCategory;
  socsoCategory: SocsoContributionCategory;
  eisEligible: boolean;
  effectiveFrom: string;
  effectiveTo: string | null;
};

export type PayrollLineOutput = {
  direction: PayrollLineDirection;
  category: PayrollLineCategory;
  code: string;
  name: string;
  amountSen: number;
  basis: string;
  sourceComponentAssignmentId?: string;
  metadata?: Record<string, string | number | boolean>;
  displayOrder: number;
};

export type PayrollEmployeeCalculation = {
  basePaySen: number;
  regularPaySen: number;
  overtimePaySen: number;
  restDayPaySen: number;
  publicHolidayPaySen: number;
  paidLeavePaySen: number;
  unpaidLeaveDeductionSen: number;
  additionalEarningsSen: number;
  otherDeductionsSen: number;
  advanceDeductionSen: number;
  epfWagesSen: number;
  socsoWagesSen: number;
  eisWagesSen: number;
  epfEmployeeSen: number;
  epfEmployerSen: number;
  socsoEmployeeSen: number;
  socsoEmployerSen: number;
  eisEmployeeSen: number;
  eisEmployerSen: number;
  employerContributionsSen: number;
  grossPaySen: number;
  totalDeductionsSen: number;
  calculatedPaySen: number;
  warnings: string[];
  blockingWarnings: string[];
  payProfileSnapshot: PayProfileInput | null;
  inputSummary: Record<string, number | string | boolean>;
  lines: PayrollLineOutput[];
};

export type PayrollCalculationInput = {
  periodStart: string;
  periodEnd: string;
  employmentStart: string | null;
  employmentEnd: string | null;
  jurisdiction: PayrollJurisdiction;
  salaryDivisor: number;
  profile: PayProfileInput | null;
  days: PayrollDayInput[];
  components: PayComponentInput[];
  hasSchedule: boolean;
  statutoryContributionsEnabled?: boolean;
  statutoryRuleVersion?: string;
  statutoryProfile?: StatutoryProfileInput | null;
};

const isoDate = (date: Date): string => date.toISOString().slice(0, 10);

function enumerateDates(start: string, end: string): string[] {
  const dates: string[] = [];
  const cursor = new Date(`${start}T00:00:00.000Z`);
  const last = new Date(`${end}T00:00:00.000Z`);
  while (cursor <= last) {
    dates.push(isoDate(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

function daysInMonth(value: string): number {
  const [year, month] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function rounded(value: number): number {
  return Math.max(0, Math.round(value));
}

function activeOn(date: string, start: string | null, end: string | null): boolean {
  return (!start || start <= date) && (!end || end >= date);
}

function amountForMinutes(rateSen: number, minutes: number, dailyMinutes: number, multiplier = 1): number {
  return rounded(rateSen * minutes * multiplier / dailyMinutes);
}

function pushLine(lines: PayrollLineOutput[], line: Omit<PayrollLineOutput, "displayOrder">): void {
  if (line.amountSen <= 0) return;
  lines.push({ ...line, displayOrder: lines.length + 1 });
}

function differsSignificantlyFromGross(wagesSen: number, grossPaySen: number): boolean {
  if (grossPaySen <= 0) return false;
  return Math.abs(wagesSen - grossPaySen) >= Math.max(10_000, Math.round(grossPaySen * 0.1));
}

export function calculateEmployeePayroll(input: PayrollCalculationInput): PayrollEmployeeCalculation {
  const warnings = new Set<string>();
  const blockingWarnings = new Set<string>();
  const lines: PayrollLineOutput[] = [];
  const periodDates = enumerateDates(input.periodStart, input.periodEnd);
  const activeDates = periodDates.filter((date) => activeOn(date, input.employmentStart, input.employmentEnd));

  if (input.jurisdiction !== PayrollJurisdiction.PENINSULAR_LABUAN) blockingWarnings.add("UNSUPPORTED_JURISDICTION");
  if (!input.profile) blockingWarnings.add("MISSING_PAY_PROFILE");
  if (!input.hasSchedule) warnings.add("MISSING_SCHEDULE");
  if (input.days.some((day) => day.state === TimesheetState.OPEN || day.state === TimesheetState.EXCEPTION)) blockingWarnings.add("UNRESOLVED_TIMESHEET");
  if (input.statutoryContributionsEnabled && !input.statutoryProfile) blockingWarnings.add("MISSING_STATUTORY_PROFILE");
  if (input.statutoryContributionsEnabled && input.statutoryRuleVersion !== MALAYSIA_STATUTORY_RULE_VERSION) blockingWarnings.add("UNSUPPORTED_STATUTORY_RULE_VERSION");

  const empty = {
    basePaySen: 0,
    regularPaySen: 0,
    overtimePaySen: 0,
    restDayPaySen: 0,
    publicHolidayPaySen: 0,
    paidLeavePaySen: 0,
    unpaidLeaveDeductionSen: 0,
    additionalEarningsSen: 0,
    otherDeductionsSen: 0,
    advanceDeductionSen: 0,
    epfWagesSen: 0,
    socsoWagesSen: 0,
    eisWagesSen: 0,
    epfEmployeeSen: 0,
    epfEmployerSen: 0,
    socsoEmployeeSen: 0,
    socsoEmployerSen: 0,
    eisEmployeeSen: 0,
    eisEmployerSen: 0,
    employerContributionsSen: 0,
    grossPaySen: 0,
    totalDeductionsSen: 0,
    calculatedPaySen: 0,
  };

  const profile = input.profile;
  if (!profile || blockingWarnings.has("UNSUPPORTED_JURISDICTION")) {
    return {
      ...empty,
      warnings: [...warnings],
      blockingWarnings: [...blockingWarnings],
      payProfileSnapshot: profile,
      inputSummary: { periodDays: periodDates.length, activeDays: activeDates.length, timesheetDays: input.days.length },
      lines,
    };
  }

  const normalMinutes = profile.normalDailyMinutes;
  const ordinaryDaySen = profile.payType === PayType.MONTHLY
    ? profile.baseRateSen / input.salaryDivisor
    : profile.payType === PayType.DAILY ? profile.baseRateSen : profile.baseRateSen * normalMinutes / 60;
  let basePaySen = 0;
  let regularPaySen = 0;
  let overtimePaySen = 0;
  let restDayPaySen = 0;
  let publicHolidayPaySen = 0;
  let paidLeavePaySen = 0;
  let unpaidLeaveDeductionSen = 0;

  if (profile.payType === PayType.MONTHLY) {
    basePaySen = rounded(activeDates.reduce((total, date) => total + profile.baseRateSen / daysInMonth(date), 0));
    pushLine(lines, { direction: PayrollLineDirection.EARNING, category: PayrollLineCategory.BASE_PAY, code: "BASE_PAY", name: "Base pay", amountSen: basePaySen, basis: "monthly_calendar_day_proration", metadata: { activeDays: activeDates.length, periodDays: periodDates.length } });
  }

  let regularMinutes = 0;
  let paidLeaveMinutes = 0;
  let overtimeMinutes = 0;
  let restDayMinutes = 0;
  let publicHolidayMinutes = 0;

  for (const day of input.days.filter((entry) => activeDates.includes(entry.workDate))) {
    const workedMinutes = day.regularMinutes + day.overtimeMinutes;
    if (day.isPublicHoliday) {
      publicHolidayMinutes += workedMinutes;
      if (workedMinutes > 0) {
        const entitlementDays = profile.payType === PayType.MONTHLY ? 2 : 3;
        publicHolidayPaySen += rounded(ordinaryDaySen * entitlementDays);
        publicHolidayPaySen += amountForMinutes(ordinaryDaySen, Math.max(workedMinutes - normalMinutes, 0), normalMinutes, 3);
      }
      continue;
    }
    if (day.isRestDay) {
      restDayMinutes += workedMinutes;
      if (workedMinutes > 0) {
        const shortDayMultiplier = profile.payType === PayType.MONTHLY ? 0.5 : 1;
        const fullDayMultiplier = profile.payType === PayType.MONTHLY ? 1 : 2;
        restDayPaySen += rounded(ordinaryDaySen * (workedMinutes <= normalMinutes / 2 ? shortDayMultiplier : fullDayMultiplier));
        restDayPaySen += amountForMinutes(ordinaryDaySen, Math.max(workedMinutes - normalMinutes, 0), normalMinutes, 2);
      }
      continue;
    }
    regularMinutes += day.regularMinutes;
    paidLeaveMinutes += day.paidLeaveMinutes;
    overtimeMinutes += day.overtimeMinutes;
    if (profile.payType === PayType.MONTHLY && day.unpaidLeaveMinutes > 0) {
      const calendarDayRate = profile.baseRateSen / daysInMonth(day.workDate);
      unpaidLeaveDeductionSen += amountForMinutes(calendarDayRate, day.unpaidLeaveMinutes, normalMinutes);
    }
  }

  if (profile.payType === PayType.DAILY) {
    regularPaySen = amountForMinutes(profile.baseRateSen, regularMinutes, normalMinutes);
    paidLeavePaySen = amountForMinutes(profile.baseRateSen, paidLeaveMinutes, normalMinutes);
  } else if (profile.payType === PayType.HOURLY) {
    regularPaySen = rounded(profile.baseRateSen * regularMinutes / 60);
    paidLeavePaySen = rounded(profile.baseRateSen * paidLeaveMinutes / 60);
  }
  if (profile.overtimeEligible) overtimePaySen = amountForMinutes(ordinaryDaySen, overtimeMinutes, normalMinutes, 1.5);
  else if (overtimeMinutes > 0) warnings.add("OVERTIME_NOT_ELIGIBLE");

  pushLine(lines, { direction: PayrollLineDirection.EARNING, category: PayrollLineCategory.REGULAR_PAY, code: "REGULAR_PAY", name: "Regular pay", amountSen: regularPaySen, basis: "worked_minutes", metadata: { minutes: regularMinutes } });
  pushLine(lines, { direction: PayrollLineDirection.EARNING, category: PayrollLineCategory.PAID_LEAVE, code: "PAID_LEAVE", name: "Paid leave", amountSen: paidLeavePaySen, basis: "paid_leave_minutes", metadata: { minutes: paidLeaveMinutes } });
  pushLine(lines, { direction: PayrollLineDirection.EARNING, category: PayrollLineCategory.OVERTIME, code: "OVERTIME", name: "Overtime", amountSen: overtimePaySen, basis: "ordinary_hourly_rate_x_1_5", metadata: { minutes: overtimeMinutes } });
  pushLine(lines, { direction: PayrollLineDirection.EARNING, category: PayrollLineCategory.REST_DAY, code: "REST_DAY", name: "Rest day work", amountSen: restDayPaySen, basis: "rest_day_tiered_rate", metadata: { minutes: restDayMinutes } });
  pushLine(lines, { direction: PayrollLineDirection.EARNING, category: PayrollLineCategory.PUBLIC_HOLIDAY, code: "PUBLIC_HOLIDAY", name: "Public holiday work", amountSen: publicHolidayPaySen, basis: "public_holiday_rate", metadata: { minutes: publicHolidayMinutes } });
  pushLine(lines, { direction: PayrollLineDirection.DEDUCTION, category: PayrollLineCategory.UNPAID_LEAVE, code: "UNPAID_LEAVE", name: "Unpaid leave", amountSen: unpaidLeaveDeductionSen, basis: "calendar_day_proration", metadata: { minutes: input.days.reduce((total, day) => total + day.unpaidLeaveMinutes, 0) } });

  const payableMinutes = regularMinutes + paidLeaveMinutes;
  const payableDays = payableMinutes / normalMinutes;
  const baseEarningsSen = basePaySen + regularPaySen + paidLeavePaySen;
  let additionalEarningsSen = 0;
  let otherDeductionsSen = 0;
  let advanceDeductionSen = 0;
  let epfEligibleAdditionalEarningsSen = 0;
  let socsoEligibleAdditionalEarningsSen = 0;
  let eisEligibleAdditionalEarningsSen = 0;

  for (const assignment of input.components) {
    const componentDates = activeDates.filter((date) => activeOn(date, assignment.effectiveFrom, assignment.effectiveTo));
    if (componentDates.length === 0) continue;
    let amountSen = 0;
    switch (assignment.payrollComponent.calculationBasis) {
      case PayrollCalculationBasis.FIXED_AMOUNT:
        amountSen = rounded(assignment.amountSen * componentDates.length / periodDates.length);
        break;
      case PayrollCalculationBasis.PER_DAY:
        amountSen = rounded(assignment.amountSen * payableDays);
        break;
      case PayrollCalculationBasis.PER_HOUR:
        amountSen = rounded(assignment.amountSen * payableMinutes / 60);
        break;
      case PayrollCalculationBasis.PERCENTAGE:
        amountSen = rounded(baseEarningsSen * (assignment.percentageBasisPoints ?? 0) / 10_000);
        break;
    }
    if (assignment.payrollComponent.type === PayrollComponentType.ADVANCE_REPAYMENT) {
      amountSen = Math.min(amountSen, assignment.outstandingAmountSen ?? amountSen);
      advanceDeductionSen += amountSen;
    } else if (assignment.payrollComponent.type === PayrollComponentType.DEDUCTION) otherDeductionsSen += amountSen;
    else {
      additionalEarningsSen += amountSen;
      if (assignment.payrollComponent.epfEligible !== false) epfEligibleAdditionalEarningsSen += amountSen;
      if (assignment.payrollComponent.socsoEligible !== false) socsoEligibleAdditionalEarningsSen += amountSen;
      if (assignment.payrollComponent.eisEligible !== false) eisEligibleAdditionalEarningsSen += amountSen;
    }

    pushLine(lines, {
      direction: assignment.payrollComponent.type === PayrollComponentType.EARNING ? PayrollLineDirection.EARNING : PayrollLineDirection.DEDUCTION,
      category: assignment.payrollComponent.type === PayrollComponentType.EARNING ? PayrollLineCategory.ALLOWANCE : assignment.payrollComponent.type === PayrollComponentType.ADVANCE_REPAYMENT ? PayrollLineCategory.ADVANCE_REPAYMENT : PayrollLineCategory.DEDUCTION,
      code: assignment.payrollComponent.code,
      name: assignment.payrollComponent.name,
      amountSen,
      basis: assignment.payrollComponent.calculationBasis.toLowerCase(),
      sourceComponentAssignmentId: assignment.id,
      metadata: { activeDays: componentDates.length },
    });
  }

  const grossPaySen = baseEarningsSen + overtimePaySen + restDayPaySen + publicHolidayPaySen + additionalEarningsSen;
  const epfWagesSen = baseEarningsSen + restDayPaySen + publicHolidayPaySen + epfEligibleAdditionalEarningsSen;
  const socsoWagesSen = baseEarningsSen + overtimePaySen + restDayPaySen + publicHolidayPaySen + socsoEligibleAdditionalEarningsSen;
  const eisWagesSen = baseEarningsSen + overtimePaySen + restDayPaySen + publicHolidayPaySen + eisEligibleAdditionalEarningsSen;
  const statutory = input.statutoryContributionsEnabled && input.statutoryProfile && input.statutoryRuleVersion === MALAYSIA_STATUTORY_RULE_VERSION
    ? calculateMalaysiaStatutoryContributions({
      epfWagesSen,
      socsoWagesSen,
      eisWagesSen,
      epfCategory: input.statutoryProfile.epfCategory,
      socsoCategory: input.statutoryProfile.socsoCategory,
      eisEligible: input.statutoryProfile.eisEligible,
    })
    : null;
  if (statutory) {
    pushLine(lines, { direction: PayrollLineDirection.DEDUCTION, category: PayrollLineCategory.EPF, code: "EPF_EMPLOYEE", name: "EPF employee contribution", amountSen: statutory.epf.employeeSen, basis: input.statutoryRuleVersion!, metadata: { wagesSen: epfWagesSen, category: input.statutoryProfile!.epfCategory } });
    pushLine(lines, { direction: PayrollLineDirection.EMPLOYER_CONTRIBUTION, category: PayrollLineCategory.EPF, code: "EPF_EMPLOYER", name: "EPF employer contribution", amountSen: statutory.epf.employerSen, basis: input.statutoryRuleVersion!, metadata: { wagesSen: epfWagesSen, category: input.statutoryProfile!.epfCategory } });
    pushLine(lines, { direction: PayrollLineDirection.DEDUCTION, category: PayrollLineCategory.SOCSO, code: "SOCSO_EMPLOYEE", name: "SOCSO employee contribution", amountSen: statutory.socso.employeeSen, basis: input.statutoryRuleVersion!, metadata: { wagesSen: socsoWagesSen, category: input.statutoryProfile!.socsoCategory } });
    pushLine(lines, { direction: PayrollLineDirection.EMPLOYER_CONTRIBUTION, category: PayrollLineCategory.SOCSO, code: "SOCSO_EMPLOYER", name: "SOCSO employer contribution", amountSen: statutory.socso.employerSen, basis: input.statutoryRuleVersion!, metadata: { wagesSen: socsoWagesSen, category: input.statutoryProfile!.socsoCategory } });
    pushLine(lines, { direction: PayrollLineDirection.DEDUCTION, category: PayrollLineCategory.EIS, code: "EIS_EMPLOYEE", name: "EIS employee contribution", amountSen: statutory.eis.employeeSen, basis: input.statutoryRuleVersion!, metadata: { wagesSen: eisWagesSen } });
    pushLine(lines, { direction: PayrollLineDirection.EMPLOYER_CONTRIBUTION, category: PayrollLineCategory.EIS, code: "EIS_EMPLOYER", name: "EIS employer contribution", amountSen: statutory.eis.employerSen, basis: input.statutoryRuleVersion!, metadata: { wagesSen: eisWagesSen } });

    if (input.statutoryProfile!.epfCategory === EpfContributionCategory.EXEMPT) warnings.add("EPF_EXEMPT");
    if (input.statutoryProfile!.socsoCategory === SocsoContributionCategory.EXEMPT) warnings.add("SOCSO_EXEMPT");
    if (!input.statutoryProfile!.eisEligible) warnings.add("EIS_EXEMPT");
    if (input.statutoryProfile!.socsoCategory !== SocsoContributionCategory.EXEMPT && socsoWagesSen >= 600_000) warnings.add("SOCSO_WAGE_CEILING_REACHED");
    if (input.statutoryProfile!.eisEligible && eisWagesSen >= 600_000) warnings.add("EIS_WAGE_CEILING_REACHED");
    if ([epfWagesSen, socsoWagesSen, eisWagesSen].some((wagesSen) => differsSignificantlyFromGross(wagesSen, grossPaySen))) warnings.add("CONTRIBUTION_WAGES_DIFFER_SIGNIFICANTLY_FROM_GROSS");
  }
  const statutoryEmployeeDeductionsSen = statutory?.employeeTotalSen ?? 0;
  const employerContributionsSen = statutory?.employerTotalSen ?? 0;
  const totalDeductionsSen = unpaidLeaveDeductionSen + otherDeductionsSen + advanceDeductionSen + statutoryEmployeeDeductionsSen;
  if (totalDeductionsSen > grossPaySen / 2) warnings.add("DEDUCTIONS_EXCEED_HALF_GROSS");
  if (totalDeductionsSen > grossPaySen) blockingWarnings.add("DEDUCTIONS_EXCEED_GROSS");
  if (statutoryEmployeeDeductionsSen > grossPaySen) blockingWarnings.add("STATUTORY_DEDUCTIONS_EXCEED_GROSS");
  const calculatedPaySen = Math.max(grossPaySen - totalDeductionsSen, 0);

  return {
    basePaySen,
    regularPaySen,
    overtimePaySen,
    restDayPaySen,
    publicHolidayPaySen,
    paidLeavePaySen,
    unpaidLeaveDeductionSen,
    additionalEarningsSen,
    otherDeductionsSen,
    advanceDeductionSen,
    epfWagesSen: statutory ? epfWagesSen : 0,
    socsoWagesSen: statutory ? socsoWagesSen : 0,
    eisWagesSen: statutory ? eisWagesSen : 0,
    epfEmployeeSen: statutory?.epf.employeeSen ?? 0,
    epfEmployerSen: statutory?.epf.employerSen ?? 0,
    socsoEmployeeSen: statutory?.socso.employeeSen ?? 0,
    socsoEmployerSen: statutory?.socso.employerSen ?? 0,
    eisEmployeeSen: statutory?.eis.employeeSen ?? 0,
    eisEmployerSen: statutory?.eis.employerSen ?? 0,
    employerContributionsSen,
    grossPaySen,
    totalDeductionsSen,
    calculatedPaySen,
    warnings: [...warnings].sort(),
    blockingWarnings: [...blockingWarnings].sort(),
    payProfileSnapshot: profile,
    inputSummary: {
      periodDays: periodDates.length,
      activeDays: activeDates.length,
      timesheetDays: input.days.length,
      regularMinutes,
      paidLeaveMinutes,
      overtimeMinutes,
      restDayMinutes,
      publicHolidayMinutes,
      componentCount: input.components.length,
      hasSchedule: input.hasSchedule,
      statutoryContributionsEnabled: Boolean(input.statutoryContributionsEnabled),
      statutoryRuleVersion: input.statutoryRuleVersion ?? "disabled",
      statutoryProfileId: input.statutoryProfile?.id ?? "none",
      epfCategory: input.statutoryProfile?.epfCategory ?? "none",
      socsoCategory: input.statutoryProfile?.socsoCategory ?? "none",
      eisEligible: input.statutoryProfile?.eisEligible ?? false,
      statutoryEmployeeDeductionsSen,
      employerContributionsSen,
    },
    lines,
  };
}
