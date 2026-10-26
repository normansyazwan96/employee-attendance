import { PayPeriodStatus, PayrollAdjustmentDecisionOutcome, PayrollAdjustmentDirection, PayrollCalculationStatus, Prisma } from "@prisma/client";
import type { Request, Response } from "express";
import { z } from "zod";
import { getAdminContext } from "../services/admin-scope.js";
import { emailConfigured, sendPayrollStatementEmail } from "../services/email.js";
import { generatePayrollStatementPdf } from "../services/payroll-statement-pdf.js";
import { getAdminPayrollStatement, getEmployeePayrollStatement, listAdminPayrollStatements, listEmployeePayrollStatements, payrollStatementHtml } from "../services/payroll-statements.js";
import { acquireDatabaseLock, prisma } from "../services/prisma.js";

const adjustmentSchema = z.object({
  employeeId: z.string().trim().min(1),
  direction: z.nativeEnum(PayrollAdjustmentDirection),
  code: z.string().trim().min(1).max(30).regex(/^[A-Za-z0-9_-]+$/).transform((value) => value.toUpperCase()),
  name: z.string().trim().min(1).max(120),
  amountSen: z.number().int().min(1).max(2_000_000_000),
  reason: z.string().trim().min(3).max(500),
});
const decisionSchema = z.object({ outcome: z.nativeEnum(PayrollAdjustmentDecisionOutcome), note: z.string().trim().min(3).max(500) });
const deliverySchema = z.object({ language: z.enum(["en", "ms"]).default("en") });

function error(response: Response, status: number, code: string, message: string, details?: unknown): void {
  response.status(status).json({ error: { code, message, ...(details === undefined ? {} : { details }) }, requestId: response.locals.requestId });
}

async function adminPayrollScope(_request: Request, response: Response) {
  const context = await getAdminContext(response);
  if (!context?.canManagePayroll) return null;
  const clientId = context.clientId;
  if (!clientId) return null;
  return {
    clientId,
    employeeUserWhere: context.employeeUserWhere,
  };
}

export async function listMyPayrollStatementsV2(_request: Request, response: Response): Promise<void> {
  const statements = await listEmployeePayrollStatements(response.locals.auth.sub);
  response.setHeader("cache-control", "private, no-store");
  response.json({ data: statements });
}

export async function getMyPayrollStatementV2(request: Request, response: Response): Promise<void> {
  const statement = await getEmployeePayrollStatement(response.locals.auth.sub, String(request.params.payPeriodId));
  if (!statement) { error(response, 404, "PAYROLL_STATEMENT_NOT_FOUND", "Payroll statement not found"); return; }
  response.setHeader("cache-control", "private, no-store");
  response.json({ data: statement });
}

export async function downloadMyPayrollStatementV2(request: Request, response: Response): Promise<void> {
  const statement = await getEmployeePayrollStatement(response.locals.auth.sub, String(request.params.payPeriodId));
  if (!statement) { error(response, 404, "PAYROLL_STATEMENT_NOT_FOUND", "Payroll statement not found"); return; }
  const language = request.acceptsLanguages("ms", "en") === "ms" ? "ms" : "en";
  const fileName = `payroll-statement-${statement.period.startDate}-${statement.period.endDate}.html`;
  response.setHeader("content-type", "text/html; charset=utf-8");
  response.setHeader("content-disposition", `attachment; filename="${fileName}"`);
  response.setHeader("cache-control", "private, no-store");
  response.send(payrollStatementHtml(statement, language));
}

export async function downloadMyPayrollStatementPdfV2(request: Request, response: Response): Promise<void> {
  const statement = await getEmployeePayrollStatement(response.locals.auth.sub, String(request.params.payPeriodId));
  if (!statement) { error(response, 404, "PAYROLL_STATEMENT_NOT_FOUND", "Payroll statement not found"); return; }
  const language = request.acceptsLanguages("ms", "en") === "ms" ? "ms" : "en";
  const file = await generatePayrollStatementPdf(statement, language);
  response.setHeader("content-type", file.contentType);
  response.setHeader("content-disposition", `attachment; filename="${file.fileName}"`);
  response.setHeader("cache-control", "private, no-store");
  response.send(Buffer.from(file.data));
}

export async function listPayrollStatementsV2(request: Request, response: Response): Promise<void> {
  const scope = await adminPayrollScope(request, response);
  if (!scope) { error(response, 403, "PAYROLL_ACCESS_REQUIRED", "Payroll access has not been granted"); return; }
  const payPeriodId = String(request.params.id);
  const period = await prisma.payPeriod.findFirst({ where: { id: payPeriodId, clientId: scope.clientId }, select: { id: true } });
  if (!period) { error(response, 404, "PAY_PERIOD_NOT_FOUND", "Pay period not found"); return; }
  const statements = await listAdminPayrollStatements(scope.clientId, payPeriodId, scope.employeeUserWhere);
  response.setHeader("cache-control", "private, no-store");
  response.json({ data: statements });
}

export async function getPayrollDeliveryCapabilitiesV2(_request: Request, response: Response): Promise<void> {
  response.setHeader("cache-control", "private, no-store");
  response.json({ data: { emailConfigured: emailConfigured() } });
}

export async function listPayrollStatementDeliveriesV2(request: Request, response: Response): Promise<void> {
  const scope = await adminPayrollScope(request, response);
  if (!scope) { error(response, 403, "PAYROLL_ACCESS_REQUIRED", "Payroll access has not been granted"); return; }
  const payPeriodId = String(request.params.id);
  const deliveries = await prisma.payrollStatementDelivery.findMany({
    where: { clientId: scope.clientId, payPeriodId, employee: { user: scope.employeeUserWhere } },
    include: { employee: { include: { user: { select: { username: true } } } } },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  response.json({ data: deliveries });
}

export async function emailPayrollStatementV2(request: Request, response: Response): Promise<void> {
  const scope = await adminPayrollScope(request, response);
  if (!scope) { error(response, 403, "PAYROLL_ACCESS_REQUIRED", "Payroll access has not been granted"); return; }
  const parsed = deliverySchema.safeParse(request.body ?? {});
  if (!parsed.success) { error(response, 400, "INVALID_STATEMENT_DELIVERY", "Choose English or Bahasa Malaysia"); return; }
  if (!emailConfigured()) { error(response, 503, "EMAIL_NOT_CONFIGURED", "Email delivery requires a Resend API key and sender address"); return; }
  const payPeriodId = String(request.params.id);
  const statement = await getAdminPayrollStatement(scope.clientId, payPeriodId, String(request.params.resultId), scope.employeeUserWhere);
  if (!statement) { error(response, 404, "PAYROLL_STATEMENT_NOT_FOUND", "Payroll statement not found in your administration scope"); return; }
  if (!statement.employee.contactEmail) { error(response, 409, "EMPLOYEE_EMAIL_REQUIRED", "Add a contact email to the employee profile before sending a statement"); return; }
  const file = await generatePayrollStatementPdf(statement, parsed.data.language);
  const deliveryBase = { clientId: scope.clientId, payPeriodId, calculationResultId: statement.id, employeeId: statement.employee.id, recipientEmail: statement.employee.contactEmail, language: parsed.data.language, fileName: file.fileName, requestedByUserId: response.locals.auth.sub } as const;
  try {
    const providerMessageId = await sendPayrollStatementEmail({ to: statement.employee.contactEmail, employeeName: `${statement.employee.firstName} ${statement.employee.lastName}`, periodName: statement.period.name, language: parsed.data.language, fileName: file.fileName, pdf: file.data });
    const delivery = await prisma.payrollStatementDelivery.create({ data: { ...deliveryBase, status: "SENT", providerMessageId } });
    await prisma.auditLog.create({ data: { actorUserId: response.locals.auth.sub, clientId: scope.clientId, action: "PAYROLL_STATEMENT_EMAILED", entityType: "PayrollStatementDelivery", entityId: delivery.id, details: { payPeriodId, employeeId: statement.employee.id, recipientEmail: statement.employee.contactEmail, language: parsed.data.language }, requestId: response.locals.requestId, ipAddress: request.ip } });
    response.status(201).json({ data: delivery });
  } catch (caught) {
    const failureReason = caught instanceof Error ? caught.message.slice(0, 500) : "Unknown email delivery failure";
    const delivery = await prisma.payrollStatementDelivery.create({ data: { ...deliveryBase, status: "FAILED", failureReason } });
    await prisma.auditLog.create({ data: { actorUserId: response.locals.auth.sub, clientId: scope.clientId, action: "PAYROLL_STATEMENT_EMAIL_FAILED", entityType: "PayrollStatementDelivery", entityId: delivery.id, details: { payPeriodId, employeeId: statement.employee.id, language: parsed.data.language, failureReason }, requestId: response.locals.requestId, ipAddress: request.ip } });
    error(response, 502, "STATEMENT_EMAIL_FAILED", "The statement email could not be delivered", { deliveryId: delivery.id });
  }
}

export async function createPayrollAdjustmentV2(request: Request, response: Response): Promise<void> {
  const scope = await adminPayrollScope(request, response);
  if (!scope) { error(response, 403, "PAYROLL_ACCESS_REQUIRED", "Payroll access has not been granted"); return; }
  const parsed = adjustmentSchema.safeParse(request.body);
  if (!parsed.success) { error(response, 400, "INVALID_PAYROLL_ADJUSTMENT", "Enter a valid employee, amount, name, code, and reason"); return; }
  const payPeriodId = String(request.params.id);
  try {
    const adjustment = await prisma.$transaction(async (transaction) => {
      await acquireDatabaseLock(transaction, payPeriodId);
      const period = await transaction.payPeriod.findFirst({
        where: { id: payPeriodId, clientId: scope.clientId, status: { in: [PayPeriodStatus.LOCKED, PayPeriodStatus.EXPORTED] } },
        select: { id: true },
      });
      if (!period) throw new Error("PAY_PERIOD_NOT_LOCKED");
      const result = await transaction.payrollCalculationResult.findFirst({
        where: {
          employeeId: parsed.data.employeeId,
          employee: { user: scope.employeeUserWhere },
          run: { clientId: scope.clientId, payPeriodId, status: PayrollCalculationStatus.LOCKED },
        },
        include: { monetaryAdjustments: { where: { decision: { outcome: PayrollAdjustmentDecisionOutcome.APPROVED } }, select: { direction: true, amountSen: true } } },
        orderBy: { createdAt: "desc" },
      });
      if (!result) throw new Error("PAYROLL_RESULT_NOT_FOUND");
      const currentAdjustmentTotal = result.monetaryAdjustments.reduce((total, item) => total + (item.direction === PayrollAdjustmentDirection.EARNING ? item.amountSen : -item.amountSen), 0);
      const nextAdjustment = parsed.data.direction === PayrollAdjustmentDirection.EARNING ? parsed.data.amountSen : -parsed.data.amountSen;
      if (result.calculatedPaySen + currentAdjustmentTotal + nextAdjustment < 0) throw new Error("ADJUSTMENT_EXCEEDS_PAY");
      return transaction.payrollMonetaryAdjustment.create({
        data: {
          clientId: scope.clientId,
          payPeriodId,
          calculationResultId: result.id,
          employeeId: parsed.data.employeeId,
          direction: parsed.data.direction,
          code: parsed.data.code,
          name: parsed.data.name,
          amountSen: parsed.data.amountSen,
          reason: parsed.data.reason,
          createdByUserId: response.locals.auth.sub,
        },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    await prisma.auditLog.create({
      data: {
        actorUserId: response.locals.auth.sub,
        clientId: scope.clientId,
        action: "PAYROLL_ADJUSTMENT_CREATED",
        entityType: "PayrollMonetaryAdjustment",
        entityId: adjustment.id,
        details: { payPeriodId, employeeId: adjustment.employeeId, direction: adjustment.direction, code: adjustment.code, amountSen: adjustment.amountSen, reason: adjustment.reason },
        requestId: response.locals.requestId,
        ipAddress: request.ip,
      },
    });
    response.status(201).json({ data: { ...adjustment, status: "PENDING", decision: null } });
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : "";
    if (message === "PAY_PERIOD_NOT_LOCKED") { error(response, 409, "PAY_PERIOD_NOT_LOCKED", "Lock the pay period before adding an adjustment"); return; }
    if (message === "PAYROLL_RESULT_NOT_FOUND") { error(response, 404, "PAYROLL_RESULT_NOT_FOUND", "No accessible locked payroll result was found for this employee"); return; }
    if (message === "ADJUSTMENT_EXCEEDS_PAY") { error(response, 409, "ADJUSTMENT_EXCEEDS_PAY", "The deduction cannot reduce the final calculated amount below zero"); return; }
    throw caught;
  }
}

export async function listPendingPayrollAdjustmentsV2(request: Request, response: Response): Promise<void> {
  const scope = await adminPayrollScope(request, response);
  if (!scope) { error(response, 403, "PAYROLL_ACCESS_REQUIRED", "Payroll access has not been granted"); return; }
  const payPeriodId = typeof request.query.payPeriodId === "string" ? request.query.payPeriodId : undefined;
  const adjustments = await prisma.payrollMonetaryAdjustment.findMany({
    where: { clientId: scope.clientId, decision: null, payPeriod: { status: { in: [PayPeriodStatus.LOCKED, PayPeriodStatus.EXPORTED] } }, ...(payPeriodId ? { payPeriodId } : {}) },
    include: { employee: { include: { user: { select: { username: true } } } }, payPeriod: { select: { id: true, name: true, startDate: true, endDate: true } } },
    orderBy: { createdAt: "asc" },
    take: 100,
  });
  const creatorIds = [...new Set(adjustments.map((item) => item.createdByUserId))];
  const creators = await prisma.user.findMany({ where: { id: { in: creatorIds } }, select: { id: true, username: true, displayName: true } });
  const creatorById = new Map(creators.map((creator) => [creator.id, creator]));
  response.setHeader("cache-control", "private, no-store");
  response.json({ data: adjustments.map((item) => ({ ...item, status: "PENDING", createdBy: creatorById.get(item.createdByUserId) ?? null })) });
}

export async function decidePayrollAdjustmentV2(request: Request, response: Response): Promise<void> {
  const scope = await adminPayrollScope(request, response);
  if (!scope) { error(response, 403, "PAYROLL_ACCESS_REQUIRED", "Payroll access has not been granted"); return; }
  const parsed = decisionSchema.safeParse(request.body);
  if (!parsed.success) { error(response, 400, "INVALID_PAYROLL_ADJUSTMENT_DECISION", "Choose approve or reject and enter a decision note"); return; }
  const payPeriodId = String(request.params.id);
  const adjustmentId = String(request.params.adjustmentId);
  try {
    const decision = await prisma.$transaction(async (transaction) => {
      await acquireDatabaseLock(transaction, adjustmentId);
      const adjustment = await transaction.payrollMonetaryAdjustment.findFirst({
        where: { id: adjustmentId, payPeriodId, clientId: scope.clientId, payPeriod: { status: { in: [PayPeriodStatus.LOCKED, PayPeriodStatus.EXPORTED] } } },
        include: {
          decision: true,
          employee: { select: { userId: true, firstName: true, lastName: true } },
          calculationResult: { include: { monetaryAdjustments: { include: { decision: true } } } },
        },
      });
      if (!adjustment) throw new Error("PAYROLL_ADJUSTMENT_NOT_FOUND");
      if (adjustment.decision) throw new Error("PAYROLL_ADJUSTMENT_ALREADY_DECIDED");
      if (adjustment.createdByUserId === response.locals.auth.sub) throw new Error("SELF_APPROVAL_NOT_ALLOWED");
      if (parsed.data.outcome === PayrollAdjustmentDecisionOutcome.APPROVED && adjustment.direction === PayrollAdjustmentDirection.DEDUCTION) {
        const approvedTotal = adjustment.calculationResult.monetaryAdjustments.reduce((total, item) => {
          if (item.decision?.outcome !== PayrollAdjustmentDecisionOutcome.APPROVED) return total;
          return total + (item.direction === PayrollAdjustmentDirection.EARNING ? item.amountSen : -item.amountSen);
        }, 0);
        if (adjustment.calculationResult.calculatedPaySen + approvedTotal - adjustment.amountSen < 0) throw new Error("ADJUSTMENT_EXCEEDS_PAY");
      }
      const created = await transaction.payrollMonetaryAdjustmentDecision.create({ data: { clientId: scope.clientId, adjustmentId, outcome: parsed.data.outcome, note: parsed.data.note, decidedByUserId: response.locals.auth.sub } });
      await transaction.notification.create({
        data: {
          userId: adjustment.employee.userId,
          clientId: scope.clientId,
          type: `PAYROLL_ADJUSTMENT_${parsed.data.outcome}`,
          title: parsed.data.outcome === PayrollAdjustmentDecisionOutcome.APPROVED ? "Payroll adjustment approved" : "Payroll adjustment rejected",
          message: `${adjustment.name} for ${adjustment.employee.firstName} ${adjustment.employee.lastName} was ${parsed.data.outcome.toLowerCase()}.`,
          entityType: "PayrollMonetaryAdjustment",
          entityId: adjustment.id,
        },
      });
      return created;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    const auditAction = decision.outcome === PayrollAdjustmentDecisionOutcome.APPROVED ? "PAYROLL_ADJUSTMENT_APPROVED" : "PAYROLL_ADJUSTMENT_REJECTED";
    await prisma.auditLog.create({ data: { actorUserId: response.locals.auth.sub, clientId: scope.clientId, action: auditAction, entityType: "PayrollMonetaryAdjustment", entityId: adjustmentId, details: { payPeriodId, outcome: decision.outcome, note: decision.note }, requestId: response.locals.requestId, ipAddress: request.ip } });
    response.status(201).json({ data: decision });
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : "";
    if (message === "PAYROLL_ADJUSTMENT_NOT_FOUND") { error(response, 404, "PAYROLL_ADJUSTMENT_NOT_FOUND", "Payroll adjustment not found in this organization"); return; }
    if (message === "PAYROLL_ADJUSTMENT_ALREADY_DECIDED") { error(response, 409, "PAYROLL_ADJUSTMENT_ALREADY_DECIDED", "This adjustment has already been approved or rejected"); return; }
    if (message === "SELF_APPROVAL_NOT_ALLOWED") { error(response, 409, "SELF_APPROVAL_NOT_ALLOWED", "A different payroll administrator must decide this adjustment"); return; }
    if (message === "ADJUSTMENT_EXCEEDS_PAY") { error(response, 409, "ADJUSTMENT_EXCEEDS_PAY", "This deduction would reduce the final calculated amount below zero"); return; }
    throw caught;
  }
}
