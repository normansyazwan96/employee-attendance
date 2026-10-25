import { createHash } from "node:crypto";
import { PayPeriodStatus, Prisma, Role } from "@prisma/client";
import { calculateEmployeePayroll, type PayProfileInput, type PayrollDayInput, type StatutoryProfileInput } from "./payroll-calculator.js";
import { acquireDatabaseLock, prisma } from "./prisma.js";
import { isPublicHolidayForState } from "./malaysia-holidays.js";

const calculationInclude = {
  results: {
    include: {
      employee: { select: { id: true, firstName: true, lastName: true, employeeNumber: true, user: { select: { username: true } } } },
      lines: { orderBy: [{ displayOrder: "asc" as const }, { id: "asc" as const }] },
      warningAcknowledgements: { orderBy: { createdAt: "asc" as const } },
    },
    orderBy: [{ employee: { firstName: "asc" as const } }, { employee: { lastName: "asc" as const } }],
  },
} satisfies Prisma.PayrollCalculationRunInclude;

function unacknowledgedWarningCount(results: Array<{ warnings: string[]; warningAcknowledgements: Array<{ warningCode: string }> }>): number {
  return results.reduce((count, result) => {
    const acknowledged = new Set(result.warningAcknowledgements.map((item) => item.warningCode));
    return count + result.warnings.filter((warning) => !acknowledged.has(warning)).length;
  }, 0);
}

function dateOnly(value: Date | null): string | null {
  return value?.toISOString().slice(0, 10) ?? null;
}

function weekday(value: string): number {
  return new Date(`${value}T00:00:00.000Z`).getUTCDay();
}

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function eligibleEmployeeWhere(clientId: string, startDate: string, endDate: string): Prisma.EmployeeWhereInput {
  return {
    user: { role: Role.EMPLOYEE, clientId },
    OR: [{ joinDate: null }, { joinDate: { lte: new Date(`${endDate}T23:59:59.999Z`) } }],
    AND: [{ OR: [{ terminationDate: null }, { terminationDate: { gte: new Date(`${startDate}T00:00:00.000Z`) } }] }],
  };
}

export function comparePayrollEmployeeCoverage(expectedEmployeeIds: string[], resultEmployeeIds: string[]) {
  const expected = new Set(expectedEmployeeIds);
  const actual = new Set(resultEmployeeIds);
  const missingEmployeeIds = [...expected].filter((id) => !actual.has(id)).sort();
  const unexpectedEmployeeIds = [...actual].filter((id) => !expected.has(id)).sort();
  const duplicateResultCount = resultEmployeeIds.length - actual.size;
  return {
    complete: missingEmployeeIds.length === 0 && unexpectedEmployeeIds.length === 0 && duplicateResultCount === 0,
    expectedEmployeeCount: expectedEmployeeIds.length,
    resultEmployeeCount: resultEmployeeIds.length,
    missingEmployeeIds,
    unexpectedEmployeeIds,
    duplicateResultCount,
  };
}

export async function latestPayrollCalculation(clientId: string, payPeriodId: string) {
  return prisma.payrollCalculationRun.findFirst({
    where: { clientId, payPeriodId },
    include: calculationInclude,
    orderBy: { version: "desc" },
  });
}

export async function calculatePayrollRun(input: {
  clientId: string;
  payPeriodId: string;
  calculatedByUserId: string;
}) {
  return prisma.$transaction(async (transaction) => {
    await acquireDatabaseLock(transaction, input.payPeriodId);
    const period = await transaction.payPeriod.findFirst({ where: { id: input.payPeriodId, clientId: input.clientId } });
    if (!period) throw new Error("PAY_PERIOD_NOT_FOUND");
    if (period.status !== PayPeriodStatus.DRAFT) throw new Error("PAY_PERIOD_NOT_DRAFT");

    const settings = await transaction.payrollSettings.upsert({
      where: { clientId: input.clientId },
      update: {},
      create: { clientId: input.clientId },
    });
    const [employees, organizationHolidays, malaysiaHolidays, client, latest] = await Promise.all([
      transaction.employee.findMany({
        where: eligibleEmployeeWhere(input.clientId, period.startDate, period.endDate),
        include: {
          user: { select: { username: true } },
          payProfiles: { where: { effectiveFrom: { lte: period.endDate }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: period.startDate } }] }, orderBy: { effectiveFrom: "desc" } },
          statutoryProfiles: { where: { effectiveFrom: { lte: period.endDate }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: period.startDate } }] }, orderBy: { effectiveFrom: "desc" } },
          payComponents: {
            where: { clientId: input.clientId, isActive: true, effectiveFrom: { lte: period.endDate }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: period.startDate } }] },
            include: { payrollComponent: true },
            orderBy: [{ effectiveFrom: "asc" }, { id: "asc" }],
          },
          timesheetDays: { where: { workDate: { gte: period.startDate, lte: period.endDate } }, orderBy: { workDate: "asc" } },
          scheduleAssignments: {
            where: { effectiveFrom: { lte: period.endDate }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: period.startDate } }] },
            include: { shiftTemplate: true },
            orderBy: { effectiveFrom: "desc" },
          },
          schedule: true,
          attendanceEvents: {
            where: { workDate: { gte: period.startDate, lte: period.endDate } },
            select: { workDate: true, worksite: { select: { stateCode: true } } },
            orderBy: [{ workDate: "asc" }, { occurredAt: "asc" }],
          },
        },
        orderBy: [{ firstName: "asc" }, { lastName: "asc" }, { id: "asc" }],
      }),
      transaction.holiday.findMany({ where: { clientId: input.clientId, date: { gte: period.startDate, lte: period.endDate } }, orderBy: { date: "asc" } }),
      transaction.malaysiaHoliday.findMany({ where: { year: { in: [...new Set([Number(period.startDate.slice(0, 4)), Number(period.endDate.slice(0, 4))])] }, date: { gte: period.startDate, lte: period.endDate } }, orderBy: [{ date: "asc" }, { stateCode: "asc" }] }),
      transaction.client.findUnique({ where: { id: input.clientId }, select: { stateCode: true } }),
      transaction.payrollCalculationRun.findFirst({ where: { payPeriodId: period.id }, select: { version: true }, orderBy: { version: "desc" } }),
    ]);
    if (employees.length === 0) throw new Error("NO_PAYROLL_EMPLOYEES");
    const sourceSnapshot = {
      period: { id: period.id, startDate: period.startDate, endDate: period.endDate },
      settings,
      organizationHolidays: organizationHolidays.map(({ date, name, stateCode, isWorkingDayOverride }) => ({ date, name, stateCode, isWorkingDayOverride })),
      malaysiaHolidays: malaysiaHolidays.map(({ date, name, stateCode }) => ({ date, name, stateCode })),
      employees,
    };
    const inputHash = createHash("sha256").update(JSON.stringify(sourceSnapshot)).digest("hex");

    const calculated = employees.map((employee) => {
      const profile = employee.payProfiles[0] as PayProfileInput | undefined;
      const statutoryProfile = employee.statutoryProfiles[0] as StatutoryProfileInput | undefined;
      const days: PayrollDayInput[] = employee.timesheetDays.map((timesheet) => {
        const assignment = employee.scheduleAssignments.find((candidate) => candidate.effectiveFrom <= timesheet.workDate && (!candidate.effectiveTo || candidate.effectiveTo >= timesheet.workDate) && candidate.shiftTemplate.isActive);
        const workDays = assignment?.shiftTemplate.workDays ?? (employee.schedule?.isActive ? employee.schedule.workDays : null);
        const stateCode = employee.attendanceEvents.find((event) => event.workDate === timesheet.workDate)?.worksite?.stateCode ?? client?.stateCode ?? "14";
        return {
          workDate: timesheet.workDate,
          state: timesheet.state,
          regularMinutes: timesheet.regularMinutes,
          overtimeMinutes: timesheet.overtimeMinutes,
          paidLeaveMinutes: timesheet.paidLeaveMinutes,
          unpaidLeaveMinutes: timesheet.unpaidLeaveMinutes,
          isAbsent: timesheet.isAbsent,
          isRestDay: Boolean(workDays && !workDays.includes(weekday(timesheet.workDate))),
          isPublicHoliday: isPublicHolidayForState({ workDate: timesheet.workDate, stateCode, organizationHolidays, malaysiaHolidays }),
        };
      });
      const result = calculateEmployeePayroll({
        periodStart: period.startDate,
        periodEnd: period.endDate,
        employmentStart: dateOnly(employee.joinDate),
        employmentEnd: dateOnly(employee.terminationDate),
        jurisdiction: settings.jurisdiction,
        salaryDivisor: settings.salaryDivisor,
        profile: profile ?? null,
        days,
        components: employee.payComponents,
        hasSchedule: employee.scheduleAssignments.some((assignment) => assignment.shiftTemplate.isActive) || Boolean(employee.schedule?.isActive),
        statutoryContributionsEnabled: settings.statutoryContributionsEnabled,
        statutoryRuleVersion: settings.statutoryRuleVersion,
        statutoryProfile: statutoryProfile ?? null,
      });
      if (employee.payProfiles.length > 1) result.blockingWarnings.push("MULTIPLE_PAY_PROFILES_IN_PERIOD");
      if (settings.statutoryContributionsEnabled && employee.statutoryProfiles.length > 1) result.blockingWarnings.push("MULTIPLE_STATUTORY_PROFILES_IN_PERIOD");
      return { employee, result };
    });

    const totalGrossSen = calculated.reduce((total, item) => total + item.result.grossPaySen, 0);
    const totalDeductionsSen = calculated.reduce((total, item) => total + item.result.totalDeductionsSen, 0);
    const totalCalculatedPaySen = calculated.reduce((total, item) => total + item.result.calculatedPaySen, 0);
    const warningCount = calculated.reduce((total, item) => total + item.result.warnings.length, 0);
    const blockingWarningCount = calculated.reduce((total, item) => total + item.result.blockingWarnings.length, 0);

    return transaction.payrollCalculationRun.create({
      data: {
        clientId: input.clientId,
        payPeriodId: period.id,
        version: (latest?.version ?? 0) + 1,
        rulePackVersion: settings.statutoryContributionsEnabled ? `${settings.rulePackVersion}+${settings.statutoryRuleVersion}` : settings.rulePackVersion,
        inputHash,
        totalGrossSen,
        totalDeductionsSen,
        totalCalculatedPaySen,
        expectedEmployeeCount: employees.length,
        warningCount,
        blockingWarningCount,
        calculatedByUserId: input.calculatedByUserId,
        results: {
          create: calculated.map(({ employee, result }) => ({
            employeeId: employee.id,
            basePaySen: result.basePaySen,
            regularPaySen: result.regularPaySen,
            overtimePaySen: result.overtimePaySen,
            restDayPaySen: result.restDayPaySen,
            publicHolidayPaySen: result.publicHolidayPaySen,
            paidLeavePaySen: result.paidLeavePaySen,
            unpaidLeaveDeductionSen: result.unpaidLeaveDeductionSen,
            additionalEarningsSen: result.additionalEarningsSen,
            otherDeductionsSen: result.otherDeductionsSen,
            advanceDeductionSen: result.advanceDeductionSen,
            epfWagesSen: result.epfWagesSen,
            socsoWagesSen: result.socsoWagesSen,
            eisWagesSen: result.eisWagesSen,
            epfEmployeeSen: result.epfEmployeeSen,
            epfEmployerSen: result.epfEmployerSen,
            socsoEmployeeSen: result.socsoEmployeeSen,
            socsoEmployerSen: result.socsoEmployerSen,
            eisEmployeeSen: result.eisEmployeeSen,
            eisEmployerSen: result.eisEmployerSen,
            employerContributionsSen: result.employerContributionsSen,
            grossPaySen: result.grossPaySen,
            totalDeductionsSen: result.totalDeductionsSen,
            calculatedPaySen: result.calculatedPaySen,
            warnings: [...new Set(result.warnings)].sort(),
            blockingWarnings: [...new Set(result.blockingWarnings)].sort(),
            payProfileSnapshot: result.payProfileSnapshot ? json(result.payProfileSnapshot) : Prisma.JsonNull,
            inputSummary: json(result.inputSummary),
            lines: { create: result.lines.map((line) => ({ ...line, metadata: line.metadata ? json(line.metadata) : Prisma.JsonNull })) },
          })),
        },
      },
      include: calculationInclude,
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function lockPayrollCalculation(transaction: Prisma.TransactionClient, input: { clientId: string; payPeriodId: string; calculationRunId: string }): Promise<void> {
  const calculation = await transaction.payrollCalculationRun.findFirst({
    where: { id: input.calculationRunId, clientId: input.clientId, payPeriodId: input.payPeriodId },
    include: { results: { include: { lines: { where: { category: "ADVANCE_REPAYMENT", sourceComponentAssignmentId: { not: null } } }, warningAcknowledgements: { select: { warningCode: true } } } } },
  });
  if (!calculation) throw new Error("PAYROLL_CALCULATION_REQUIRED");
  if (calculation.blockingWarningCount > 0) throw new Error(`PAYROLL_CALCULATION_BLOCKED:${calculation.blockingWarningCount}`);
  const unacknowledged = unacknowledgedWarningCount(calculation.results);
  if (unacknowledged > 0) throw new Error(`PAYROLL_WARNINGS_UNACKNOWLEDGED:${unacknowledged}`);
  if (calculation.status === "LOCKED") return;
  const repayments = new Map<string, number>();
  for (const result of calculation.results) {
    for (const line of result.lines) {
      if (!line.sourceComponentAssignmentId) continue;
      repayments.set(line.sourceComponentAssignmentId, (repayments.get(line.sourceComponentAssignmentId) ?? 0) + line.amountSen);
    }
  }
  for (const [assignmentId, amountSen] of repayments) {
    const updated = await transaction.employeePayComponent.updateMany({
      where: { id: assignmentId, outstandingAmountSen: { gte: amountSen } },
      data: { outstandingAmountSen: { decrement: amountSen } },
    });
    if (updated.count !== 1) throw new Error("ADVANCE_BALANCE_CHANGED");
  }
  await transaction.payrollCalculationRun.update({ where: { id: calculation.id }, data: { status: "LOCKED", lockedAt: new Date() } });
}

export async function assertReviewablePayrollCalculation(transaction: Prisma.TransactionClient, clientId: string, payPeriodId: string): Promise<{ id: string; inputHash: string; expectedEmployeeCount: number }> {
  const [period, latest] = await Promise.all([
    transaction.payPeriod.findFirst({ where: { id: payPeriodId, clientId }, select: { startDate: true, endDate: true } }),
    transaction.payrollCalculationRun.findFirst({
      where: { clientId, payPeriodId },
      select: { id: true, inputHash: true, expectedEmployeeCount: true, blockingWarningCount: true, results: { select: { employeeId: true, warnings: true, warningAcknowledgements: { select: { warningCode: true } } } } },
      orderBy: { version: "desc" },
    }),
  ]);
  if (!period) throw new Error("PAY_PERIOD_NOT_FOUND");
  if (!latest) throw new Error("PAYROLL_CALCULATION_REQUIRED");
  const eligibleEmployees = await transaction.employee.findMany({
    where: eligibleEmployeeWhere(clientId, period.startDate, period.endDate),
    select: { id: true },
    orderBy: { id: "asc" },
  });
  const coverage = comparePayrollEmployeeCoverage(eligibleEmployees.map((employee) => employee.id), latest.results.map((result) => result.employeeId));
  if (!coverage.complete || latest.expectedEmployeeCount !== coverage.expectedEmployeeCount) {
    throw new Error(`PAYROLL_CALCULATION_INCOMPLETE:${coverage.expectedEmployeeCount}:${coverage.resultEmployeeCount}:${coverage.missingEmployeeIds.length}:${coverage.unexpectedEmployeeIds.length}`);
  }
  if (latest.blockingWarningCount > 0) throw new Error(`PAYROLL_CALCULATION_BLOCKED:${latest.blockingWarningCount}`);
  const unacknowledged = unacknowledgedWarningCount(latest.results);
  if (unacknowledged > 0) throw new Error(`PAYROLL_WARNINGS_UNACKNOWLEDGED:${unacknowledged}`);
  return { id: latest.id, inputHash: latest.inputHash, expectedEmployeeCount: latest.expectedEmployeeCount };
}
