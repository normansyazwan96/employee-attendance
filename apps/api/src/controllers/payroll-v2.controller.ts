import { ExportFormat, ExportJobStatus, PayPeriodStatus, Prisma, RequestStatus, TimesheetState } from "@prisma/client";
import type { Request, Response } from "express";
import { z } from "zod";
import { getAdminContext } from "../services/admin-scope.js";
import { enqueuePayrollExport, generateDirectPayrollExport, getPayrollExportObject, isPayrollExportObjectKeyOwned } from "../services/payroll-export.js";
import { assertReviewablePayrollCalculation, calculatePayrollRun, latestPayrollCalculation, lockPayrollCalculation } from "../services/payroll-calculation-run.js";
import { acquireDatabaseLock, prisma } from "../services/prisma.js";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const createPeriodSchema = z.object({ name: z.string().trim().min(1).max(120), startDate: isoDate, endDate: isoDate });
const transitionSchema = z.object({ action: z.enum(["REVIEW", "APPROVE", "LOCK", "REOPEN"]) });
const acknowledgementSchema = z.object({ note: z.string().trim().min(3).max(500) });
const warningCodeSchema = z.string().regex(/^[A-Z0-9_]+$/).max(120);
const exportColumn = z.enum(["employeeNumber", "username", "employeeName", "calculationVersion", "basePay", "regularPay", "overtimePay", "restDayPay", "publicHolidayPay", "paidLeavePay", "additionalEarnings", "grossPay", "unpaidLeaveDeduction", "otherDeductions", "advanceDeduction", "epfEmployee", "epfEmployer", "socsoEmployee", "socsoEmployer", "eisEmployee", "eisEmployer", "employerContributions", "totalDeductions", "calculatedPay", "adjustmentEarnings", "adjustmentDeductions", "finalCalculatedPay", "warnings"]);
const exportSchema = z.object({
  format: z.nativeEnum(ExportFormat),
  template: z.object({
    columns: z.array(exportColumn).min(1).max(28).refine((columns) => new Set(columns).size === columns.length, "Columns must be unique"),
    headers: z.record(z.string(), z.string().trim().min(1).max(80)).optional(),
  }).optional(),
});

function error(response: Response, status: number, code: string, message: string, details?: unknown): void {
  response.status(status).json({ error: { code, message, ...(details === undefined ? {} : { details }) }, requestId: response.locals.requestId });
}

async function organizationId(_request: Request, response: Response): Promise<string | null> {
  const context = await getAdminContext(response);
  if (!context) return null;
  if (!context.canManagePayroll) return null;
  const clientId = context.clientId;
  if (!clientId) return null;
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

export async function calculatePayPeriodV2(request: Request, response: Response): Promise<void> {
  const clientId = await organizationId(request, response);
  if (!clientId) { error(response, 403, "ORGANIZATION_ACCESS_REQUIRED", "Choose an organization you can administer"); return; }
  try {
    const calculation = await calculatePayrollRun({ clientId, payPeriodId: String(request.params.id), calculatedByUserId: response.locals.auth.sub });
    await prisma.auditLog.create({ data: { actorUserId: response.locals.auth.sub, clientId, action: "PAYROLL_CALCULATED", entityType: "PayrollCalculationRun", entityId: calculation.id, details: { payPeriodId: calculation.payPeriodId, version: calculation.version, inputHash: calculation.inputHash, expectedEmployeeCount: calculation.expectedEmployeeCount, blockingWarningCount: calculation.blockingWarningCount }, requestId: response.locals.requestId, ipAddress: request.ip } });
    response.status(201).json({ data: calculation });
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : "";
    if (message === "PAY_PERIOD_NOT_FOUND") { error(response, 404, "PAY_PERIOD_NOT_FOUND", "Pay period not found"); return; }
    if (message === "PAY_PERIOD_NOT_DRAFT") { error(response, 409, "PAY_PERIOD_NOT_DRAFT", "Only draft pay periods can be calculated"); return; }
    if (message === "NO_PAYROLL_EMPLOYEES") { error(response, 409, "NO_PAYROLL_EMPLOYEES", "No employees are available for this pay period"); return; }
    throw caught;
  }
}

export async function getLatestPayPeriodCalculationV2(request: Request, response: Response): Promise<void> {
  const clientId = await organizationId(request, response);
  if (!clientId) { error(response, 403, "ORGANIZATION_ACCESS_REQUIRED", "Choose an organization you can administer"); return; }
  const period = await prisma.payPeriod.findFirst({ where: { id: String(request.params.id), clientId }, select: { id: true } });
  if (!period) { error(response, 404, "PAY_PERIOD_NOT_FOUND", "Pay period not found"); return; }
  const calculation = await latestPayrollCalculation(clientId, period.id);
  response.setHeader("cache-control", "private, no-store");
  response.json({ data: calculation });
}

export async function acknowledgePayrollWarningV2(request: Request, response: Response): Promise<void> {
  const clientId = await organizationId(request, response);
  if (!clientId) { error(response, 403, "ORGANIZATION_ACCESS_REQUIRED", "Choose an organization you can administer"); return; }
  const parsed = acknowledgementSchema.safeParse(request.body);
  const warningCode = warningCodeSchema.safeParse(request.params.warningCode);
  if (!parsed.success || !warningCode.success) { error(response, 400, "INVALID_WARNING_ACKNOWLEDGEMENT", "Enter a review note between 3 and 500 characters"); return; }
  const payPeriodId = String(request.params.id);
  const resultId = String(request.params.resultId);
  const [period, latest, actor] = await Promise.all([
    prisma.payPeriod.findFirst({ where: { id: payPeriodId, clientId }, select: { status: true } }),
    prisma.payrollCalculationRun.findFirst({ where: { clientId, payPeriodId }, select: { id: true }, orderBy: { version: "desc" } }),
    prisma.user.findUnique({ where: { id: response.locals.auth.sub }, select: { username: true } }),
  ]);
  if (!period) { error(response, 404, "PAY_PERIOD_NOT_FOUND", "Pay period not found"); return; }
  if (period.status !== PayPeriodStatus.DRAFT) { error(response, 409, "PAY_PERIOD_NOT_DRAFT", "Warnings can only be acknowledged while the pay period is in draft"); return; }
  const result = await prisma.payrollCalculationResult.findFirst({ where: { id: resultId, run: { clientId, payPeriodId } }, select: { runId: true, warnings: true, blockingWarnings: true } });
  if (!result || !latest || result.runId !== latest.id) { error(response, 409, "PAYROLL_CALCULATION_NOT_LATEST", "Reopen the latest calculation before acknowledging warnings"); return; }
  if (result.blockingWarnings.includes(warningCode.data)) { error(response, 409, "BLOCKING_WARNING_NOT_ACKNOWLEDGEABLE", "Blocking warnings must be resolved and recalculated"); return; }
  if (!result.warnings.includes(warningCode.data)) { error(response, 404, "PAYROLL_WARNING_NOT_FOUND", "Warning not found on this calculation result"); return; }
  try {
    const acknowledgement = await prisma.payrollWarningAcknowledgement.create({
      data: {
        clientId,
        calculationResultId: resultId,
        warningCode: warningCode.data,
        note: parsed.data.note,
        acknowledgedByUserId: response.locals.auth.sub,
        acknowledgedByUsername: actor?.username ?? response.locals.auth.username,
      },
    });
    await prisma.auditLog.create({ data: { actorUserId: response.locals.auth.sub, clientId, action: "PAYROLL_WARNING_ACKNOWLEDGED", entityType: "PayrollCalculationResult", entityId: resultId, details: { payPeriodId, calculationRunId: latest.id, warningCode: warningCode.data, note: parsed.data.note }, requestId: response.locals.requestId, ipAddress: request.ip } });
    response.status(201).json({ data: acknowledgement });
  } catch (caught) {
    if (caught instanceof Prisma.PrismaClientKnownRequestError && caught.code === "P2002") { error(response, 409, "PAYROLL_WARNING_ALREADY_ACKNOWLEDGED", "This warning has already been acknowledged"); return; }
    throw caught;
  }
}

type TransitionAction = z.infer<typeof transitionSchema>["action"];

function validTransition(status: PayPeriodStatus, action: TransitionAction): boolean {
  if (action === "REVIEW") return status === PayPeriodStatus.DRAFT;
  if (action === "APPROVE") return status === PayPeriodStatus.REVIEWED;
  if (action === "LOCK") return status === PayPeriodStatus.APPROVED;
  return status === PayPeriodStatus.REVIEWED || status === PayPeriodStatus.APPROVED;
}

export async function transitionPayPeriodV2(request: Request, response: Response): Promise<void> {
  const clientId = await organizationId(request, response);
  if (!clientId) { error(response, 403, "ORGANIZATION_ACCESS_REQUIRED", "Choose an organization you can administer"); return; }
  const parsed = transitionSchema.safeParse(request.body);
  if (!parsed.success) { error(response, 400, "INVALID_PAY_PERIOD_ACTION", "Choose review, approve, or lock"); return; }
  const periodId = String(request.params.id);
  try {
    const period = await prisma.$transaction(async (transaction) => {
      await acquireDatabaseLock(transaction, periodId);
      const current = await transaction.payPeriod.findFirst({ where: { id: periodId, clientId } });
      if (!current) throw new Error("PAY_PERIOD_NOT_FOUND");
      if (!validTransition(current.status, parsed.data.action)) throw new Error("INVALID_PAY_PERIOD_TRANSITION");

      const periodTimesheets = { clientId, workDate: { gte: current.startDate, lte: current.endDate } } as const;
      if (parsed.data.action === "REVIEW" || parsed.data.action === "LOCK") {
        const [unresolvedTimesheets, pendingCorrections, pendingLeave] = await Promise.all([
          transaction.timesheetDay.count({ where: { ...periodTimesheets, state: { in: [TimesheetState.OPEN, TimesheetState.EXCEPTION] } } }),
          transaction.attendanceCorrection.count({ where: { status: RequestStatus.PENDING, timesheetDay: periodTimesheets } }),
          transaction.leaveRequest.count({ where: { clientId, status: RequestStatus.PENDING, startDate: { lte: current.endDate }, endDate: { gte: current.startDate } } }),
        ]);
        if (unresolvedTimesheets || pendingCorrections || pendingLeave) throw new Error(`UNRESOLVED:${unresolvedTimesheets}:${pendingCorrections}:${pendingLeave}`);
      }

      const validatedCalculation = parsed.data.action === "REOPEN" ? null : await assertReviewablePayrollCalculation(transaction, clientId, current.id);

      const now = new Date();
      if (parsed.data.action === "REOPEN") {
        await transaction.timesheetDay.updateMany({ where: { ...periodTimesheets, state: TimesheetState.APPROVED }, data: { state: TimesheetState.COMPLETE, approvedAt: null } });
        return transaction.payPeriod.update({ where: { id: current.id }, data: { status: PayPeriodStatus.DRAFT, reviewedAt: null, reviewedByUserId: null, reviewedCalculationRunId: null, approvedAt: null, approvedByUserId: null, approvedCalculationRunId: null } });
      }
      if (parsed.data.action === "REVIEW") return transaction.payPeriod.update({ where: { id: current.id }, data: { status: PayPeriodStatus.REVIEWED, reviewedAt: now, reviewedByUserId: response.locals.auth.sub, reviewedCalculationRunId: validatedCalculation!.id, approvedAt: null, approvedByUserId: null, approvedCalculationRunId: null } });
      if (parsed.data.action === "APPROVE") {
        if (current.reviewedCalculationRunId !== validatedCalculation!.id) throw new Error("PAYROLL_CALCULATION_CHANGED");
        await transaction.timesheetDay.updateMany({ where: { ...periodTimesheets, state: TimesheetState.COMPLETE }, data: { state: TimesheetState.APPROVED, approvedAt: now } });
        return transaction.payPeriod.update({ where: { id: current.id }, data: { status: PayPeriodStatus.APPROVED, approvedAt: now, approvedByUserId: response.locals.auth.sub, approvedCalculationRunId: validatedCalculation!.id } });
      }
      if (current.approvedCalculationRunId !== validatedCalculation!.id) throw new Error("PAYROLL_CALCULATION_CHANGED");
      await lockPayrollCalculation(transaction, { clientId, payPeriodId: current.id, calculationRunId: validatedCalculation!.id });
      await transaction.timesheetDay.updateMany({ where: periodTimesheets, data: { state: TimesheetState.LOCKED, lockedAt: now, payPeriodId: current.id } });
      return transaction.payPeriod.update({ where: { id: current.id }, data: { status: PayPeriodStatus.LOCKED, lockedAt: now, lockedByUserId: response.locals.auth.sub } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    await prisma.auditLog.create({ data: { actorUserId: response.locals.auth.sub, clientId, action: `PAY_PERIOD_${parsed.data.action}`, entityType: "PayPeriod", entityId: period.id, requestId: response.locals.requestId, ipAddress: request.ip } });
    response.json({ data: period });
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : "";
    if (message === "PAY_PERIOD_NOT_FOUND") { error(response, 404, "PAY_PERIOD_NOT_FOUND", "Pay period not found"); return; }
    if (message === "INVALID_PAY_PERIOD_TRANSITION") { error(response, 409, "INVALID_PAY_PERIOD_TRANSITION", "This action is not valid for the current pay period state"); return; }
    if (message === "PAYROLL_CALCULATION_REQUIRED") { error(response, 409, "PAYROLL_CALCULATION_REQUIRED", "Calculate this pay period before continuing"); return; }
    if (message.startsWith("PAYROLL_CALCULATION_BLOCKED:")) { error(response, 409, "PAYROLL_CALCULATION_BLOCKED", "Resolve the blocking payroll warnings and calculate again", { blockingWarnings: Number(message.split(":")[1]) }); return; }
    if (message.startsWith("PAYROLL_WARNINGS_UNACKNOWLEDGED:")) { error(response, 409, "PAYROLL_WARNINGS_UNACKNOWLEDGED", "Acknowledge every payroll warning with a review note before continuing", { warnings: Number(message.split(":")[1]) }); return; }
    if (message.startsWith("PAYROLL_CALCULATION_INCOMPLETE:")) {
      const [, expectedEmployees, calculatedEmployees, missingEmployees, unexpectedEmployees] = message.split(":");
      error(response, 409, "PAYROLL_CALCULATION_INCOMPLETE", "The employee list changed after this calculation; calculate the pay period again", { expectedEmployees: Number(expectedEmployees), calculatedEmployees: Number(calculatedEmployees), missingEmployees: Number(missingEmployees), unexpectedEmployees: Number(unexpectedEmployees) });
      return;
    }
    if (message === "PAYROLL_CALCULATION_CHANGED") { error(response, 409, "PAYROLL_CALCULATION_CHANGED", "The reviewed calculation version changed; return the pay period to draft and review it again"); return; }
    if (message === "ADVANCE_BALANCE_CHANGED") { error(response, 409, "ADVANCE_BALANCE_CHANGED", "A salary advance balance changed; return the period to draft and calculate again"); return; }
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
  const jobs = await prisma.exportJob.findMany({
    where: { clientId, ...(typeof request.query.payPeriodId === "string" ? { payPeriodId: request.query.payPeriodId } : {}) },
    select: { id: true, clientId: true, payPeriodId: true, format: true, status: true, fileName: true, contentType: true, fileSizeBytes: true, expiresAt: true, completedAt: true, createdAt: true, updatedAt: true },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
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

export async function downloadPayPeriodExportV2(request: Request, response: Response): Promise<void> {
  const clientId = await organizationId(request, response);
  if (!clientId) { error(response, 403, "ORGANIZATION_ACCESS_REQUIRED", "Choose an organization you can administer"); return; }
  const parsed = exportSchema.safeParse(request.body);
  if (!parsed.success) { error(response, 400, "INVALID_EXPORT", "Choose CSV or XLSX export format"); return; }
  const payPeriodId = String(request.params.id);
  try {
    const file = await generateDirectPayrollExport({ clientId, payPeriodId, format: parsed.data.format, template: parsed.data.template ?? null });
    await prisma.$transaction([
      prisma.payPeriod.update({ where: { id: payPeriodId }, data: { status: PayPeriodStatus.EXPORTED } }),
      prisma.auditLog.create({ data: { actorUserId: response.locals.auth.sub, clientId, action: "PAYROLL_EXPORT_DOWNLOADED", entityType: "PayrollCalculationRun", entityId: file.calculationId, details: { format: parsed.data.format, payPeriodId, version: file.calculationVersion, storage: "DIRECT" }, requestId: response.locals.requestId, ipAddress: request.ip } }),
    ]);
    response.setHeader("content-type", file.contentType);
    response.setHeader("content-disposition", `attachment; filename="${file.fileName.replace(/["\\\r\n]/g, "_")}"`);
    response.setHeader("cache-control", "private, no-store");
    response.send(Buffer.from(file.data));
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : "";
    if (message === "PAY_PERIOD_NOT_LOCKED") { error(response, 409, "PAY_PERIOD_NOT_LOCKED", "Lock the pay period before exporting it"); return; }
    if (message === "PAYROLL_CALCULATION_REQUIRED") { error(response, 409, "PAYROLL_CALCULATION_REQUIRED", "A locked payroll calculation is required"); return; }
    throw caught;
  }
}

export async function downloadPayrollExportV2(request: Request, response: Response): Promise<void> {
  const clientId = await organizationId(request, response);
  if (!clientId) { error(response, 403, "ORGANIZATION_ACCESS_REQUIRED", "Choose an organization you can administer"); return; }
  const job = await prisma.exportJob.findFirst({ where: { id: String(request.params.id), clientId, status: ExportJobStatus.COMPLETED, expiresAt: { gt: new Date() }, r2Key: { not: null } } });
  if (!job?.r2Key || !isPayrollExportObjectKeyOwned({ id: job.id, clientId: job.clientId, payPeriodId: job.payPeriodId, r2Key: job.r2Key })) { error(response, 404, "EXPORT_NOT_AVAILABLE", "This export is not ready or has expired"); return; }
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
