import { ExportFormat, ExportJobStatus, PayPeriodStatus, PayrollAdjustmentDecisionOutcome, PayrollAdjustmentDirection, Prisma } from "@prisma/client";
import { createCsv, createXlsx, type ExportCell } from "./spreadsheet-export.js";
import { logger } from "./logger.js";
import { prisma } from "./prisma.js";

export type ExportQueueProducer = { send(body: { jobId: string }): Promise<void> };
export type PrivateObject = { body: ReadableStream<Uint8Array>; size?: number };
export type PrivateBucket = {
  put(key: string, value: ArrayBuffer | ArrayBufferView, options?: { httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string> }): Promise<unknown>;
  get(key: string): Promise<PrivateObject | null>;
  delete(key: string): Promise<void>;
};

let exportQueue: ExportQueueProducer | undefined;
let exportBucket: PrivateBucket | undefined;
const exportColumns = ["employeeNumber", "username", "employeeName", "calculationVersion", "basePay", "regularPay", "overtimePay", "restDayPay", "publicHolidayPay", "paidLeavePay", "additionalEarnings", "grossPay", "unpaidLeaveDeduction", "otherDeductions", "advanceDeduction", "epfEmployee", "epfEmployer", "socsoEmployee", "socsoEmployer", "eisEmployee", "eisEmployer", "employerContributions", "totalDeductions", "calculatedPay", "adjustmentEarnings", "adjustmentDeductions", "finalCalculatedPay", "warnings"] as const;
const exportHeaders: Record<(typeof exportColumns)[number], string> = { employeeNumber: "Employee number", username: "Username", employeeName: "Employee name", calculationVersion: "Calculation version", basePay: "Base pay (MYR)", regularPay: "Regular pay (MYR)", overtimePay: "Overtime pay (MYR)", restDayPay: "Rest day pay (MYR)", publicHolidayPay: "Public holiday pay (MYR)", paidLeavePay: "Paid leave pay (MYR)", additionalEarnings: "Additional earnings (MYR)", grossPay: "Gross pay (MYR)", unpaidLeaveDeduction: "Unpaid leave deduction (MYR)", otherDeductions: "Other deductions (MYR)", advanceDeduction: "Advance deduction (MYR)", epfEmployee: "EPF employee (MYR)", epfEmployer: "EPF employer (MYR)", socsoEmployee: "SOCSO employee (MYR)", socsoEmployer: "SOCSO employer (MYR)", eisEmployee: "EIS employee (MYR)", eisEmployer: "EIS employer (MYR)", employerContributions: "Total employer contributions (MYR)", totalDeductions: "Total deductions (MYR)", calculatedPay: "Locked calculated pay (MYR)", adjustmentEarnings: "Approved adjustment earnings (MYR)", adjustmentDeductions: "Approved adjustment deductions (MYR)", finalCalculatedPay: "Final calculated pay (MYR)", warnings: "Warnings" };
type ExportTemplate = { columns?: unknown; headers?: unknown } | null;
const lockedCalculationInclude = {
  results: {
    include: { employee: { include: { user: { select: { username: true } } } }, monetaryAdjustments: { include: { decision: true } } },
    orderBy: [{ employee: { firstName: "asc" as const } }, { employee: { lastName: "asc" as const } }],
  },
} satisfies Prisma.PayrollCalculationRunInclude;
type LoadedCalculation = Prisma.PayrollCalculationRunGetPayload<{ include: typeof lockedCalculationInclude }>;

export function configurePayrollExport(queue: ExportQueueProducer | undefined, bucket: PrivateBucket | undefined): void {
  exportQueue = queue;
  exportBucket = bucket;
}

export function isPayrollExportObjectKeyOwned(input: { id: string; clientId: string; payPeriodId: string; r2Key: string }): boolean {
  return input.r2Key.startsWith(`${input.clientId}/${input.payPeriodId}/${input.id}/`);
}

export async function enqueuePayrollExport(jobId: string): Promise<void> {
  if (!exportQueue) throw new Error("Payroll export queue is not configured");
  await exportQueue.send({ jobId });
}

export function payrollExportRows(job: Awaited<ReturnType<typeof loadExportJob>>): ExportCell[][] {
  if (!job) return [];
  if (job.clientId !== job.payPeriod.clientId) throw new Error("Payroll export organization mismatch");
  const template = job.template && typeof job.template === "object" && !Array.isArray(job.template) ? job.template as { columns?: unknown; headers?: unknown } : null;
  const calculation = job.payPeriod.calculationRuns.find((candidate) => candidate.id === job.payPeriod.approvedCalculationRunId && candidate.clientId === job.clientId);
  if (!calculation) throw new Error("Approved locked payroll calculation not found");
  return calculationExportRows(calculation, template);
}

function calculationExportRows(calculation: LoadedCalculation, template: ExportTemplate): ExportCell[][] {
  const allowed = new Set<string>(exportColumns);
  const configured = Array.isArray(template?.columns) ? template.columns.filter((column): column is (typeof exportColumns)[number] => typeof column === "string" && allowed.has(column)) : [];
  const columns = configured.length > 0 ? configured : [...exportColumns];
  const customHeaders = template?.headers && typeof template.headers === "object" && !Array.isArray(template.headers) ? template.headers as Record<string, unknown> : {};
  const headers = columns.map((column) => typeof customHeaders[column] === "string" ? customHeaders[column] as string : exportHeaders[column]);
  const ringgit = (sen: number): number => sen / 100;
  const rows = calculation.results.map((result) => {
    const approved = result.monetaryAdjustments.filter((item) => item.decision?.outcome === PayrollAdjustmentDecisionOutcome.APPROVED);
    const adjustmentEarningsSen = approved.filter((item) => item.direction === PayrollAdjustmentDirection.EARNING).reduce((total, item) => total + item.amountSen, 0);
    const adjustmentDeductionsSen = approved.filter((item) => item.direction === PayrollAdjustmentDirection.DEDUCTION).reduce((total, item) => total + item.amountSen, 0);
    const values: Record<(typeof exportColumns)[number], ExportCell> = { employeeNumber: result.employee.employeeNumber, username: result.employee.user.username, employeeName: `${result.employee.firstName} ${result.employee.lastName}`, calculationVersion: calculation.version, basePay: ringgit(result.basePaySen), regularPay: ringgit(result.regularPaySen), overtimePay: ringgit(result.overtimePaySen), restDayPay: ringgit(result.restDayPaySen), publicHolidayPay: ringgit(result.publicHolidayPaySen), paidLeavePay: ringgit(result.paidLeavePaySen), additionalEarnings: ringgit(result.additionalEarningsSen), grossPay: ringgit(result.grossPaySen), unpaidLeaveDeduction: ringgit(result.unpaidLeaveDeductionSen), otherDeductions: ringgit(result.otherDeductionsSen), advanceDeduction: ringgit(result.advanceDeductionSen), epfEmployee: ringgit(result.epfEmployeeSen), epfEmployer: ringgit(result.epfEmployerSen), socsoEmployee: ringgit(result.socsoEmployeeSen), socsoEmployer: ringgit(result.socsoEmployerSen), eisEmployee: ringgit(result.eisEmployeeSen), eisEmployer: ringgit(result.eisEmployerSen), employerContributions: ringgit(result.employerContributionsSen), totalDeductions: ringgit(result.totalDeductionsSen), calculatedPay: ringgit(result.calculatedPaySen), adjustmentEarnings: ringgit(adjustmentEarningsSen), adjustmentDeductions: ringgit(adjustmentDeductionsSen), finalCalculatedPay: ringgit(Math.max(result.calculatedPaySen + adjustmentEarningsSen - adjustmentDeductionsSen, 0)), warnings: [...result.blockingWarnings, ...result.warnings].join("; ") };
    return columns.map((column) => values[column]);
  });
  return [headers, ...rows];
}

async function loadExportJob(jobId: string) {
  return prisma.exportJob.findUnique({
    where: { id: jobId },
    include: {
      payPeriod: {
        include: {
          calculationRuns: {
            where: { status: "LOCKED" },
            include: lockedCalculationInclude,
            orderBy: { version: "desc" },
          },
        },
      },
    },
  });
}

export async function generateDirectPayrollExport(input: { clientId: string; payPeriodId: string; format: ExportFormat; template: ExportTemplate }) {
  const period = await prisma.payPeriod.findFirst({
    where: { id: input.payPeriodId, clientId: input.clientId, status: { in: [PayPeriodStatus.LOCKED, PayPeriodStatus.EXPORTED] } },
    select: { id: true, name: true, approvedCalculationRunId: true },
  });
  if (!period) throw new Error("PAY_PERIOD_NOT_LOCKED");
  const calculation = period.approvedCalculationRunId
    ? await prisma.payrollCalculationRun.findFirst({ where: { id: period.approvedCalculationRunId, clientId: input.clientId, payPeriodId: period.id, status: "LOCKED" }, include: lockedCalculationInclude })
    : null;
  if (!calculation) throw new Error("PAYROLL_CALCULATION_REQUIRED");
  const rows = calculationExportRows(calculation, input.template);
  const extension = input.format === ExportFormat.XLSX ? "xlsx" : "csv";
  const contentType = input.format === ExportFormat.XLSX ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "text/csv; charset=utf-8";
  const data = input.format === ExportFormat.XLSX ? createXlsx(rows) : createCsv(rows);
  const safePeriod = period.name.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "pay-period";
  return { data, contentType, fileName: `${safePeriod}-payroll.${extension}`, calculationId: calculation.id, calculationVersion: calculation.version };
}

export async function processPayrollExport(jobId: string): Promise<void> {
  if (!exportBucket) throw new Error("Private export storage is not configured");
  const claimed = await prisma.exportJob.updateMany({ where: { id: jobId, status: { in: [ExportJobStatus.PENDING, ExportJobStatus.FAILED] } }, data: { status: ExportJobStatus.PROCESSING, lastError: null } });
  if (claimed.count === 0) return;
  try {
    const job = await loadExportJob(jobId);
    if (!job) return;
    const rows = payrollExportRows(job);
    const extension = job.format === ExportFormat.XLSX ? "xlsx" : "csv";
    const contentType = job.format === ExportFormat.XLSX ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "text/csv; charset=utf-8";
    const data = job.format === ExportFormat.XLSX ? createXlsx(rows) : createCsv(rows);
    const safePeriod = job.payPeriod.name.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "pay-period";
    const fileName = `${safePeriod}-payroll.${extension}`;
    const key = `${job.clientId}/${job.payPeriodId}/${job.id}/${fileName}`;
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await exportBucket.put(key, data, { httpMetadata: { contentType }, customMetadata: { exportJobId: job.id, expiresAt: expiresAt.toISOString() } });
    await prisma.$transaction([
      prisma.exportJob.update({ where: { id: job.id }, data: { status: ExportJobStatus.COMPLETED, r2Key: key, fileName, contentType, fileSizeBytes: data.byteLength, expiresAt, completedAt: new Date() } }),
      prisma.payPeriod.update({ where: { id: job.payPeriodId }, data: { status: PayPeriodStatus.EXPORTED } }),
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 1000) : "Unknown export error";
    await prisma.exportJob.updateMany({ where: { id: jobId }, data: { status: ExportJobStatus.FAILED, lastError: message } });
    logger.error("payroll_export_failed", { jobId, message });
    throw error;
  }
}

export async function enqueuePendingPayrollExports(): Promise<void> {
  if (!exportQueue) return;
  const jobs = await prisma.exportJob.findMany({ where: { status: ExportJobStatus.PENDING }, select: { id: true }, take: 100, orderBy: { createdAt: "asc" } });
  await Promise.all(jobs.map((job) => enqueuePayrollExport(job.id)));
}

export async function markPayrollExportDeadLetter(jobId: string): Promise<void> {
  await prisma.exportJob.updateMany({ where: { id: jobId, status: { in: [ExportJobStatus.PENDING, ExportJobStatus.PROCESSING, ExportJobStatus.FAILED] } }, data: { status: ExportJobStatus.FAILED, lastError: "Export retries were exhausted" } });
}

export async function expirePayrollExports(): Promise<void> {
  if (!exportBucket) return;
  const bucket = exportBucket;
  const expired = await prisma.exportJob.findMany({ where: { status: ExportJobStatus.COMPLETED, expiresAt: { lte: new Date() }, r2Key: { not: null } }, select: { id: true, r2Key: true }, take: 100 });
  await Promise.all(expired.map(async (job) => {
    await bucket.delete(job.r2Key!);
    await prisma.exportJob.update({ where: { id: job.id }, data: { status: ExportJobStatus.EXPIRED, r2Key: null } });
  }));
}

export async function getPayrollExportObject(key: string): Promise<PrivateObject | null> {
  if (!exportBucket) return null;
  return exportBucket.get(key);
}
