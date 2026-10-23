import { ExportFormat, ExportJobStatus, PayPeriodStatus } from "@prisma/client";
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

export function configurePayrollExport(queue: ExportQueueProducer | undefined, bucket: PrivateBucket | undefined): void {
  exportQueue = queue;
  exportBucket = bucket;
}

export async function enqueuePayrollExport(jobId: string): Promise<void> {
  if (!exportQueue) throw new Error("Payroll export queue is not configured");
  await exportQueue.send({ jobId });
}

function exportRows(job: Awaited<ReturnType<typeof loadExportJob>>): ExportCell[][] {
  if (!job) return [];
  const defaults = ["employeeNumber", "username", "employeeName", "workDate", "regularMinutes", "overtimeMinutes", "paidLeaveMinutes", "unpaidLeaveMinutes", "leaveMinutes", "breakMinutes", "lateMinutes", "earlyDepartureMinutes", "isAbsent", "exceptions", "adjustmentMinutes"] as const;
  const standardHeaders: Record<(typeof defaults)[number], string> = { employeeNumber: "Employee number", username: "Username", employeeName: "Employee name", workDate: "Work date", regularMinutes: "Regular minutes", overtimeMinutes: "Overtime minutes", paidLeaveMinutes: "Paid leave minutes", unpaidLeaveMinutes: "Unpaid leave minutes", leaveMinutes: "Leave minutes", breakMinutes: "Break minutes", lateMinutes: "Late minutes", earlyDepartureMinutes: "Early departure minutes", isAbsent: "Absent", exceptions: "Exceptions", adjustmentMinutes: "Adjustment minutes" };
  const template = job.template && typeof job.template === "object" && !Array.isArray(job.template) ? job.template as { columns?: unknown; headers?: unknown } : null;
  const allowed = new Set<string>(defaults);
  const configured = Array.isArray(template?.columns) ? template.columns.filter((column): column is (typeof defaults)[number] => typeof column === "string" && allowed.has(column)) : [];
  const columns = configured.length > 0 ? configured : [...defaults];
  const customHeaders = template?.headers && typeof template.headers === "object" && !Array.isArray(template.headers) ? template.headers as Record<string, unknown> : {};
  const headers = columns.map((column) => typeof customHeaders[column] === "string" ? customHeaders[column] as string : standardHeaders[column]);
  const rows = job.payPeriod.timesheetDays.map((day) => {
    const adjustmentMinutes = day.payrollAdjustments.reduce((sum, item) => sum + item.minutes, 0);
    const values: Record<(typeof defaults)[number], ExportCell> = { employeeNumber: day.employee.employeeNumber, username: day.employee.user.username, employeeName: `${day.employee.firstName} ${day.employee.lastName}`, workDate: day.workDate, regularMinutes: day.regularMinutes, overtimeMinutes: day.overtimeMinutes, paidLeaveMinutes: day.paidLeaveMinutes, unpaidLeaveMinutes: day.unpaidLeaveMinutes, leaveMinutes: day.leaveMinutes, breakMinutes: day.breakMinutes, lateMinutes: day.lateMinutes, earlyDepartureMinutes: day.earlyDepartureMinutes, isAbsent: day.isAbsent, exceptions: day.exceptionCodes.join("; "), adjustmentMinutes };
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
          timesheetDays: {
            include: { employee: { include: { user: { select: { username: true } } } }, payrollAdjustments: true },
            orderBy: [{ workDate: "asc" }, { employeeId: "asc" }],
          },
        },
      },
    },
  });
}

export async function processPayrollExport(jobId: string): Promise<void> {
  if (!exportBucket) throw new Error("Private export storage is not configured");
  const claimed = await prisma.exportJob.updateMany({ where: { id: jobId, status: { in: [ExportJobStatus.PENDING, ExportJobStatus.FAILED] } }, data: { status: ExportJobStatus.PROCESSING, lastError: null } });
  if (claimed.count === 0) return;
  try {
    const job = await loadExportJob(jobId);
    if (!job) return;
    const rows = exportRows(job);
    const extension = job.format === ExportFormat.XLSX ? "xlsx" : "csv";
    const contentType = job.format === ExportFormat.XLSX ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "text/csv; charset=utf-8";
    const data = job.format === ExportFormat.XLSX ? createXlsx(rows) : createCsv(rows);
    const safePeriod = job.payPeriod.name.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "pay-period";
    const fileName = `${safePeriod}.${extension}`;
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
