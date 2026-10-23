import { ExportFormat, ExportJobStatus, PayPeriodStatus, Prisma, RequestStatus, TimesheetState } from "@prisma/client";
import type { Request, Response } from "express";
import { z } from "zod";
import { getAdminContext } from "../services/admin-scope.js";
import { enqueuePayrollExport, getPayrollExportObject } from "../services/payroll-export.js";
import { prisma } from "../services/prisma.js";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const createPeriodSchema = z.object({ name: z.string().trim().min(1).max(120), startDate: isoDate, endDate: isoDate });
const transitionSchema = z.object({ action: z.enum(["REVIEW", "APPROVE", "LOCK"]) });
const exportColumn = z.enum(["employeeNumber", "username", "employeeName", "workDate", "regularMinutes", "overtimeMinutes", "paidLeaveMinutes", "unpaidLeaveMinutes", "leaveMinutes", "breakMinutes", "lateMinutes", "earlyDepartureMinutes", "isAbsent", "exceptions", "adjustmentMinutes"]);
const exportSchema = z.object({
  format: z.nativeEnum(ExportFormat),
  template: z.object({
    columns: z.array(exportColumn).min(1).max(15).refine((columns) => new Set(columns).size === columns.length, "Columns must be unique"),
    headers: z.record(z.string(), z.string().trim().min(1).max(80)).optional(),
  }).optional(),
});

function error(response: Response, status: number, code: string, message: string, details?: unknown): void {
  response.status(status).json({ error: { code, message, ...(details === undefined ? {} : { details }) }, requestId: response.locals.requestId });
}

async function organizationId(request: Request, response: Response): Promise<string | null> {
  const context = await getAdminContext(response);
  if (!context) return null;
  const clientId = context.clientId ?? request.header("x-organization-id")?.trim();
  if (!clientId) return null;
  if (!context.clientId) {
    const exists = await prisma.client.findUnique({ where: { id: clientId }, select: { id: true } });
    if (!exists) return null;
  }
  return clientId;
}

export async function listPayPeriodsV2(request: Request, response: Response): Promise<void> {
  const clientId = await organizationId(request, response);
  if (!clientId) { error(response, 403, "ORGANIZATION_ACCESS_REQUIRED", "Choose an organization you can administer"); return; }
  const cursor = typeof request.query.cursor === "string" ? request.query.cursor : undefined;
  const periods = await prisma.payPeriod.findMany({
    where: { clientId },
    include: { _count: { select: { timesheetDays: true, adjustments: true, exportJobs: true } } },
    orderBy: [{ startDate: "desc" }, { id: "desc" }],
    take: 51,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });
  const hasMore = periods.length > 50;
  if (hasMore) periods.pop();
  response.json({ data: periods, nextCursor: hasMore ? periods.at(-1)?.id ?? null : null });
}

export async function createPayPeriodV2(request: Request, response: Response): Promise<void> {
  const clientId = await organizationId(request, response);
  if (!clientId) { error(response, 403, "ORGANIZATION_ACCESS_REQUIRED", "Choose an organization you can administer"); return; }
  const parsed = createPeriodSchema.safeParse(request.body);
  if (!parsed.success || parsed.data.startDate > parsed.data.endDate) { error(response, 400, "INVALID_PAY_PERIOD", "Enter a valid name and date range"); return; }
  const overlap = await prisma.payPeriod.findFirst({ where: { clientId, startDate: { lte: parsed.data.endDate }, endDate: { gte: parsed.data.startDate } }, select: { id: true, name: true } });
  if (overlap) { error(response, 409, "PAY_PERIOD_OVERLAP", "The date range overlaps an existing pay period", overlap); return; }
  const period = await prisma.payPeriod.create({ data: { clientId, ...parsed.data } });
  await prisma.auditLog.create({ data: { actorUserId: response.locals.auth.sub, clientId, action: "PAY_PERIOD_CREATED", entityType: "PayPeriod", entityId: period.id, details: parsed.data, requestId: response.locals.requestId, ipAddress: request.ip } });
  response.status(201).json({ data: period });
}

type TransitionAction = z.infer<typeof transitionSchema>["action"];

const expectedStatus: Record<TransitionAction, PayPeriodStatus> = {
  REVIEW: PayPeriodStatus.DRAFT,
  APPROVE: PayPeriodStatus.REVIEWED,
  LOCK: PayPeriodStatus.APPROVED,
};

export async function transitionPayPeriodV2(request: Request, response: Response): Promise<void> {
  const clientId = await organizationId(request, response);
  if (!clientId) { error(response, 403, "ORGANIZATION_ACCESS_REQUIRED", "Choose an organization you can administer"); return; }
  const parsed = transitionSchema.safeParse(request.body);
  if (!parsed.success) { error(response, 400, "INVALID_PAY_PERIOD_ACTION", "Choose review, approve, or lock"); return; }
  const periodId = String(request.params.id);
  try {
    const period = await prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${periodId}))::text`;
      const current = await transaction.payPeriod.findFirst({ where: { id: periodId, clientId } });
      if (!current) throw new Error("PAY_PERIOD_NOT_FOUND");
      if (current.status !== expectedStatus[parsed.data.action]) throw new Error("INVALID_PAY_PERIOD_TRANSITION");

      const periodTimesheets = { clientId, workDate: { gte: current.startDate, lte: current.endDate } } as const;
      if (parsed.data.action === "REVIEW" || parsed.data.action === "LOCK") {
        const [unresolvedTimesheets, pendingCorrections, pendingLeave] = await Promise.all([
          transaction.timesheetDay.count({ where: { ...periodTimesheets, state: { in: [TimesheetState.OPEN, TimesheetState.EXCEPTION] } } }),
          transaction.attendanceCorrection.count({ where: { status: RequestStatus.PENDING, timesheetDay: periodTimesheets } }),
          transaction.leaveRequest.count({ where: { clientId, status: RequestStatus.PENDING, startDate: { lte: current.endDate }, endDate: { gte: current.startDate } } }),
        ]);
        if (unresolvedTimesheets || pendingCorrections || pendingLeave) throw new Error(`UNRESOLVED:${unresolvedTimesheets}:${pendingCorrections}:${pendingLeave}`);
      }

      const now = new Date();
      if (parsed.data.action === "REVIEW") return transaction.payPeriod.update({ where: { id: current.id }, data: { status: PayPeriodStatus.REVIEWED, reviewedAt: now, reviewedByUserId: response.locals.auth.sub } });
      if (parsed.data.action === "APPROVE") {
        await transaction.timesheetDay.updateMany({ where: { ...periodTimesheets, state: TimesheetState.COMPLETE }, data: { state: TimesheetState.APPROVED, approvedAt: now } });
        return transaction.payPeriod.update({ where: { id: current.id }, data: { status: PayPeriodStatus.APPROVED, approvedAt: now, approvedByUserId: response.locals.auth.sub } });
      }
      await transaction.timesheetDay.updateMany({ where: periodTimesheets, data: { state: TimesheetState.LOCKED, lockedAt: now, payPeriodId: current.id } });
      return transaction.payPeriod.update({ where: { id: current.id }, data: { status: PayPeriodStatus.LOCKED, lockedAt: now, lockedByUserId: response.locals.auth.sub } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    await prisma.auditLog.create({ data: { actorUserId: response.locals.auth.sub, clientId, action: `PAY_PERIOD_${parsed.data.action}`, entityType: "PayPeriod", entityId: period.id, requestId: response.locals.requestId, ipAddress: request.ip } });
    response.json({ data: period });
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : "";
    if (message === "PAY_PERIOD_NOT_FOUND") { error(response, 404, "PAY_PERIOD_NOT_FOUND", "Pay period not found"); return; }
    if (message === "INVALID_PAY_PERIOD_TRANSITION") { error(response, 409, "INVALID_PAY_PERIOD_TRANSITION", "This action is not valid for the current pay period state"); return; }
    if (message.startsWith("UNRESOLVED:")) {
      const [, timesheets, corrections, leave] = message.split(":");
      error(response, 409, "UNRESOLVED_PAYROLL_ITEMS", "Resolve attendance exceptions and pending requests before continuing", { timesheets: Number(timesheets), corrections: Number(corrections), leave: Number(leave) });
      return;
    }
    throw caught;
  }
}

export async function listPayrollExportsV2(request: Request, response: Response): Promise<void> {
  const clientId = await organizationId(request, response);
  if (!clientId) { error(response, 403, "ORGANIZATION_ACCESS_REQUIRED", "Choose an organization you can administer"); return; }
  const jobs = await prisma.exportJob.findMany({ where: { clientId, ...(typeof request.query.payPeriodId === "string" ? { payPeriodId: request.query.payPeriodId } : {}) }, orderBy: { createdAt: "desc" }, take: 100 });
  response.json({ data: jobs });
}

export async function createPayrollExportV2(request: Request, response: Response): Promise<void> {
  const clientId = await organizationId(request, response);
  if (!clientId) { error(response, 403, "ORGANIZATION_ACCESS_REQUIRED", "Choose an organization you can administer"); return; }
  const parsed = exportSchema.safeParse(request.body);
  if (!parsed.success) { error(response, 400, "INVALID_EXPORT", "Choose CSV or XLSX export format"); return; }
  const payPeriodId = String(request.params.id);
  const period = await prisma.payPeriod.findFirst({ where: { id: payPeriodId, clientId, status: { in: [PayPeriodStatus.LOCKED, PayPeriodStatus.EXPORTED] } } });
  if (!period) { error(response, 409, "PAY_PERIOD_NOT_LOCKED", "Lock the pay period before exporting it"); return; }
  const job = await prisma.exportJob.create({ data: { clientId, payPeriodId, format: parsed.data.format, template: parsed.data.template, requestedByUserId: response.locals.auth.sub } });
  await enqueuePayrollExport(job.id).catch(() => undefined);
  await prisma.auditLog.create({ data: { actorUserId: response.locals.auth.sub, clientId, action: "PAYROLL_EXPORT_REQUESTED", entityType: "ExportJob", entityId: job.id, details: { format: job.format, payPeriodId }, requestId: response.locals.requestId, ipAddress: request.ip } });
  response.status(202).json({ data: job });
}

export async function downloadPayrollExportV2(request: Request, response: Response): Promise<void> {
  const clientId = await organizationId(request, response);
  if (!clientId) { error(response, 403, "ORGANIZATION_ACCESS_REQUIRED", "Choose an organization you can administer"); return; }
  const job = await prisma.exportJob.findFirst({ where: { id: String(request.params.id), clientId, status: ExportJobStatus.COMPLETED, expiresAt: { gt: new Date() }, r2Key: { not: null } } });
  if (!job?.r2Key) { error(response, 404, "EXPORT_NOT_AVAILABLE", "This export is not ready or has expired"); return; }
  const object = await getPayrollExportObject(job.r2Key);
  if (!object) { error(response, 404, "EXPORT_NOT_AVAILABLE", "The export file could not be found"); return; }
  response.setHeader("content-type", job.contentType ?? "application/octet-stream");
  response.setHeader("content-disposition", `attachment; filename="${(job.fileName ?? "attendance-export").replace(/["\\\r\n]/g, "_")}"`);
  response.setHeader("cache-control", "private, no-store");
  const reader = object.body.getReader();
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      response.write(Buffer.from(chunk.value));
    }
    response.end();
  } finally {
    reader.releaseLock();
  }
}
