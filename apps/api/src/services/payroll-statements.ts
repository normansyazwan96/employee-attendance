import { PayPeriodStatus, PayrollAdjustmentDecisionOutcome, PayrollAdjustmentDirection, PayrollCalculationStatus, Prisma } from "@prisma/client";
import { prisma } from "./prisma.js";

const statementInclude = {
  run: { include: { payPeriod: true, client: { select: { name: true } } } },
  employee: { include: { user: { select: { id: true, username: true, email: true } } } },
  lines: { orderBy: [{ displayOrder: "asc" as const }, { id: "asc" as const }] },
  monetaryAdjustments: { include: { decision: true }, orderBy: [{ createdAt: "asc" as const }, { id: "asc" as const }] },
} satisfies Prisma.PayrollCalculationResultInclude;

type StatementResult = Prisma.PayrollCalculationResultGetPayload<{ include: typeof statementInclude }>;

function statementView(result: StatementResult, includeUnapproved: boolean) {
  const approvedAdjustments = result.monetaryAdjustments.filter((item) => item.decision?.outcome === PayrollAdjustmentDecisionOutcome.APPROVED);
  const visibleAdjustments = includeUnapproved ? result.monetaryAdjustments : approvedAdjustments;
  const adjustmentEarningsSen = approvedAdjustments.filter((item) => item.direction === PayrollAdjustmentDirection.EARNING).reduce((total, item) => total + item.amountSen, 0);
  const adjustmentDeductionsSen = approvedAdjustments.filter((item) => item.direction === PayrollAdjustmentDirection.DEDUCTION).reduce((total, item) => total + item.amountSen, 0);
  return {
    id: result.id,
    organizationName: result.run.client.name,
    period: { id: result.run.payPeriod.id, name: result.run.payPeriod.name, startDate: result.run.payPeriod.startDate, endDate: result.run.payPeriod.endDate, status: result.run.payPeriod.status },
    calculation: {
      version: result.run.version,
      rulePackVersion: result.run.rulePackVersion,
      lockedAt: result.run.lockedAt,
      grossPaySen: result.grossPaySen,
      totalDeductionsSen: result.totalDeductionsSen,
      calculatedPaySen: result.calculatedPaySen,
      employerContributionsSen: result.employerContributionsSen,
      lines: result.lines,
    },
    employee: { id: result.employee.id, userId: result.employee.user.id, firstName: result.employee.firstName, lastName: result.employee.lastName, employeeNumber: result.employee.employeeNumber, username: result.employee.user.username, contactEmail: result.employee.user.email },
    adjustments: visibleAdjustments.map((item) => ({ ...item, status: item.decision?.outcome ?? "PENDING" })),
    adjustmentEarningsSen,
    adjustmentDeductionsSen,
    finalCalculatedPaySen: Math.max(result.calculatedPaySen + adjustmentEarningsSen - adjustmentDeductionsSen, 0),
  };
}

export type PayrollStatementView = ReturnType<typeof statementView>;

export async function listEmployeePayrollStatements(userId: string) {
  const employee = await prisma.employee.findUnique({ where: { userId }, select: { id: true } });
  if (!employee) return [];
  const results = await prisma.payrollCalculationResult.findMany({
    where: {
      employeeId: employee.id,
      run: { status: PayrollCalculationStatus.LOCKED, payPeriod: { status: { in: [PayPeriodStatus.LOCKED, PayPeriodStatus.EXPORTED] } } },
    },
    include: statementInclude,
    orderBy: { createdAt: "desc" },
    take: 24,
  });
  return results.map((result) => statementView(result, false));
}

export async function getEmployeePayrollStatement(userId: string, payPeriodId: string) {
  const result = await prisma.payrollCalculationResult.findFirst({
    where: {
      employee: { userId },
      run: { payPeriodId, status: PayrollCalculationStatus.LOCKED, payPeriod: { status: { in: [PayPeriodStatus.LOCKED, PayPeriodStatus.EXPORTED] } } },
    },
    include: statementInclude,
    orderBy: { createdAt: "desc" },
  });
  return result ? statementView(result, false) : null;
}

export async function listAdminPayrollStatements(clientId: string, payPeriodId: string, employeeUserWhere: Prisma.UserWhereInput) {
  const results = await prisma.payrollCalculationResult.findMany({
    where: { employee: { user: employeeUserWhere }, run: { clientId, payPeriodId, status: PayrollCalculationStatus.LOCKED } },
    include: statementInclude,
    orderBy: [{ employee: { firstName: "asc" } }, { employee: { lastName: "asc" } }],
  });
  return results.map((result) => statementView(result, true));
}

export async function getAdminPayrollStatement(clientId: string, payPeriodId: string, resultId: string, employeeUserWhere: Prisma.UserWhereInput) {
  const result = await prisma.payrollCalculationResult.findFirst({
    where: { id: resultId, employee: { user: employeeUserWhere }, run: { clientId, payPeriodId, status: PayrollCalculationStatus.LOCKED } },
    include: statementInclude,
  });
  return result ? statementView(result, true) : null;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export function payrollStatementHtml(statement: NonNullable<Awaited<ReturnType<typeof getEmployeePayrollStatement>>>, language: "en" | "ms"): string {
  const ms = language === "ms";
  const money = (sen: number): string => `RM ${(sen / 100).toFixed(2)}`;
  const earningRows = statement.calculation.lines.filter((line) => line.direction === "EARNING").map((line) => `<tr><td>${escapeHtml(line.name)}</td><td>${money(line.amountSen)}</td></tr>`).join("");
  const deductionRows = statement.calculation.lines.filter((line) => line.direction === "DEDUCTION").map((line) => `<tr><td>${escapeHtml(line.name)}</td><td>-${money(line.amountSen)}</td></tr>`).join("");
  const employerRows = statement.calculation.lines.filter((line) => line.direction === "EMPLOYER_CONTRIBUTION").map((line) => `<tr><td>${escapeHtml(line.name)}</td><td>${money(line.amountSen)}</td></tr>`).join("");
  const adjustmentRows = statement.adjustments.map((item) => `<tr><td>${escapeHtml(item.name)}<small>${escapeHtml(item.reason)}</small></td><td>${item.direction === "DEDUCTION" ? "-" : "+"}${money(item.amountSen)}</td></tr>`).join("");
  const title = ms ? "Penyata pengiraan gaji" : "Payroll calculation statement";
  return `<!doctype html><html lang="${language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(title)}</title><style>body{font-family:Arial,sans-serif;color:#17151c;max-width:760px;margin:40px auto;padding:0 24px}header{border-bottom:2px solid #17151c;padding-bottom:18px;margin-bottom:24px}h1{font-size:24px;margin:0 0 8px}p{margin:4px 0;color:#52525b}table{width:100%;border-collapse:collapse;margin:18px 0}td{padding:9px 0;border-bottom:1px solid #ddd}td:last-child{text-align:right;font-variant-numeric:tabular-nums}small{display:block;color:#71717a;margin-top:3px}.total{font-size:18px;font-weight:700;border-top:2px solid #17151c;padding-top:14px}.note{font-size:12px;margin-top:30px}@media print{body{margin:0}}</style></head><body><header><h1>attend+</h1><p>${escapeHtml(title)}</p></header><h2>${escapeHtml(statement.employee.firstName)} ${escapeHtml(statement.employee.lastName)}</h2><p>${escapeHtml(statement.employee.employeeNumber ?? statement.employee.username)}</p><p>${escapeHtml(statement.period.name)} · ${statement.period.startDate} - ${statement.period.endDate}</p><table>${earningRows}${deductionRows}${employerRows}${adjustmentRows}</table><table><tr><td>${ms ? "Gaji kasar" : "Gross pay"}</td><td>${money(statement.calculation.grossPaySen)}</td></tr><tr><td>${ms ? "Potongan pengiraan" : "Calculated deductions"}</td><td>-${money(statement.calculation.totalDeductionsSen)}</td></tr><tr><td>${ms ? "Caruman majikan" : "Employer contributions"}</td><td>${money(statement.calculation.employerContributionsSen)}</td></tr><tr><td>${ms ? "Pelarasan selepas kunci" : "Post-lock adjustments"}</td><td>${money(statement.adjustmentEarningsSen - statement.adjustmentDeductionsSen)}</td></tr><tr class="total"><td>${ms ? "Jumlah dikira akhir" : "Final calculated amount"}</td><td>${money(statement.finalCalculatedPaySen)}</td></tr></table><p class="note">${ms ? "Penyata ini ialah rekod pengiraan dan bukan bukti pembayaran." : "This statement is a calculation record and is not proof of payment."}</p></body></html>`;
}
