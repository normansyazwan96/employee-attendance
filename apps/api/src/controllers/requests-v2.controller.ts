import { PayPeriodStatus, Prisma, RequestStatus, TimesheetState } from "@prisma/client";
import type { Request, Response } from "express";
import { z } from "zod";
import { getAdminContext } from "../services/admin-scope.js";
import { prisma } from "../services/prisma.js";
import { approvalRecipientIds, notifyUsers } from "../services/notifications.js";
import { planLeaveAllocations } from "../services/leave-allocation.js";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const correctionSchema = z.object({ timesheetDayId: z.string().min(1), reason: z.string().trim().min(3).max(160), note: z.string().trim().max(1_000).nullable().optional(), clockInAt: z.string().datetime().nullable(), clockOutAt: z.string().datetime().nullable() });
const leaveSchema = z.object({ leaveTypeId: z.string().min(1), startDate: date, endDate: date, requestedMinutes: z.number().int().min(1).max(60 * 24 * 31), reason: z.string().trim().max(1_000).nullable().optional() });
const reviewSchema = z.object({ decision: z.enum(["APPROVED", "REJECTED"]), note: z.string().trim().max(1_000).nullable().optional() });
const leaveTypeSchema = z.object({ code: z.string().trim().min(1).max(20).transform((value) => value.toUpperCase()), name: z.string().trim().min(1).max(120), isPaid: z.boolean(), defaultEntitlementMinutes: z.number().int().min(0).max(60 * 24 * 366), isActive: z.boolean().default(true) });
const balanceSchema = z.object({ employeeId: z.string().min(1), leaveTypeId: z.string().min(1), year: z.number().int().min(2020).max(2100), entitledMinutes: z.number().int().min(0).max(60 * 24 * 366) });

function error(response: Response, status: number, code: string, message: string): void {
  response.status(status).json({ error: { code, message }, requestId: response.locals.requestId });
}

async function employeeFor(userId: string) {
  return prisma.employee.findUnique({ where: { userId }, include: { user: { select: { clientId: true } } } });
}

export async function listMyCorrectionsV2(_request: Request, response: Response): Promise<void> {
  const employee = await employeeFor(response.locals.auth.sub); if (!employee) { error(response, 403, "EMPLOYEE_REQUIRED", "An employee account is required"); return; }
  const requests = await prisma.attendanceCorrection.findMany({ where: { employeeId: employee.id }, include: { timesheetDay: true }, orderBy: { createdAt: "desc" }, take: 100 });
  response.json({ data: requests });
}

export async function createCorrectionV2(request: Request, response: Response): Promise<void> {
  const parsed = correctionSchema.safeParse(request.body); if (!parsed.success) { error(response, 400, "INVALID_CORRECTION", "Enter a reason and valid before/after times"); return; }
  const employee = await employeeFor(response.locals.auth.sub); if (!employee) { error(response, 403, "EMPLOYEE_REQUIRED", "An employee account is required"); return; }
  const timesheet = await prisma.timesheetDay.findFirst({ where: { id: parsed.data.timesheetDayId, employeeId: employee.id } });
  if (!timesheet) { error(response, 404, "TIMESHEET_NOT_FOUND", "Timesheet not found"); return; }
  const pending = await prisma.attendanceCorrection.findFirst({ where: { timesheetDayId: timesheet.id, employeeId: employee.id, status: RequestStatus.PENDING }, select: { id: true } });
  if (pending) { error(response, 409, "CORRECTION_PENDING", "A correction request is already pending for this day"); return; }
  const correction = await prisma.attendanceCorrection.create({ data: {
    employeeId: employee.id,
    timesheetDayId: timesheet.id,
    reason: parsed.data.reason,
    note: parsed.data.note,
    originalValues: { firstClockInAt: timesheet.firstClockInAt?.toISOString() ?? null, lastClockOutAt: timesheet.lastClockOutAt?.toISOString() ?? null, regularMinutes: timesheet.regularMinutes, overtimeMinutes: timesheet.overtimeMinutes },
    requestedValues: { firstClockInAt: parsed.data.clockInAt, lastClockOutAt: parsed.data.clockOutAt },
  } });
  if (employee.user.clientId) {
    const recipients = await approvalRecipientIds(employee.userId, employee.user.clientId);
    await notifyUsers({ userIds: recipients, clientId: employee.user.clientId, type: "CORRECTION_PENDING", title: "Attendance correction awaiting review", message: `${employee.firstName} ${employee.lastName} requested an attendance correction for ${timesheet.workDate}.`, entityType: "AttendanceCorrection", entityId: correction.id });
  }
  response.status(201).json({ data: correction });
}

export async function listMyLeaveV2(_request: Request, response: Response): Promise<void> {
  const employee = await employeeFor(response.locals.auth.sub); if (!employee?.user.clientId) { error(response, 403, "EMPLOYEE_REQUIRED", "An employee account is required"); return; }
  const [types, balances, requests] = await Promise.all([
    prisma.leaveType.findMany({ where: { clientId: employee.user.clientId, isActive: true }, orderBy: { name: "asc" } }),
    prisma.leaveBalance.findMany({ where: { employeeId: employee.id }, include: { leaveType: true }, orderBy: [{ year: "desc" }, { leaveType: { name: "asc" } }] }),
    prisma.leaveRequest.findMany({ where: { employeeId: employee.id }, include: { leaveType: true }, orderBy: { createdAt: "desc" }, take: 100 }),
  ]);
  response.json({ types, balances, requests });
}

export async function createLeaveRequestV2(request: Request, response: Response): Promise<void> {
  const parsed = leaveSchema.safeParse(request.body);
  if (!parsed.success || parsed.data.endDate < parsed.data.startDate || parsed.data.startDate.slice(0, 4) !== parsed.data.endDate.slice(0, 4)) { error(response, 400, "INVALID_LEAVE_REQUEST", "Enter valid leave dates within one calendar year and a duration"); return; }
  const employee = await employeeFor(response.locals.auth.sub); if (!employee?.user.clientId) { error(response, 403, "EMPLOYEE_REQUIRED", "An employee account is required"); return; }
  const year = Number(parsed.data.startDate.slice(0, 4));
  try {
    const leaveRequest = await prisma.$transaction(async (transaction) => {
      const leaveType = await transaction.leaveType.findFirst({ where: { id: parsed.data.leaveTypeId, clientId: employee.user.clientId!, isActive: true } });
      if (!leaveType) throw new Error("LEAVE_TYPE_NOT_FOUND");
      const overlap = await transaction.leaveRequest.findFirst({ where: { employeeId: employee.id, status: { in: [RequestStatus.PENDING, RequestStatus.APPROVED] }, startDate: { lte: parsed.data.endDate }, endDate: { gte: parsed.data.startDate } }, select: { id: true } });
      if (overlap) throw new Error("LEAVE_DATES_OVERLAP");
      const balance = await transaction.leaveBalance.upsert({ where: { employeeId_leaveTypeId_year: { employeeId: employee.id, leaveTypeId: leaveType.id, year } }, create: { employeeId: employee.id, leaveTypeId: leaveType.id, year, entitledMinutes: leaveType.defaultEntitlementMinutes }, update: {} });
      if (balance.entitledMinutes - balance.usedMinutes - balance.pendingMinutes < parsed.data.requestedMinutes) throw new Error("INSUFFICIENT_LEAVE");
      await transaction.leaveBalance.update({ where: { id: balance.id }, data: { pendingMinutes: { increment: parsed.data.requestedMinutes } } });
      return transaction.leaveRequest.create({ data: { clientId: employee.user.clientId!, employeeId: employee.id, ...parsed.data } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    const recipients = await approvalRecipientIds(employee.userId, employee.user.clientId);
    await notifyUsers({ userIds: recipients, clientId: employee.user.clientId, type: "LEAVE_PENDING", title: "Leave request awaiting review", message: `${employee.firstName} ${employee.lastName} requested leave from ${leaveRequest.startDate} to ${leaveRequest.endDate}.`, entityType: "LeaveRequest", entityId: leaveRequest.id });
    response.status(201).json({ data: leaveRequest });
  } catch (caught) {
    if (caught instanceof Error && caught.message === "LEAVE_TYPE_NOT_FOUND") { error(response, 404, "LEAVE_TYPE_NOT_FOUND", "Leave type not found"); return; }
    if (caught instanceof Error && caught.message === "INSUFFICIENT_LEAVE") { error(response, 409, "INSUFFICIENT_LEAVE", "The requested leave exceeds the available balance"); return; }
    if (caught instanceof Error && caught.message === "LEAVE_DATES_OVERLAP") { error(response, 409, "LEAVE_DATES_OVERLAP", "An active leave request already overlaps these dates"); return; }
    throw caught;
  }
}

export async function cancelLeaveRequestV2(request: Request, response: Response): Promise<void> {
  const employee = await employeeFor(response.locals.auth.sub); if (!employee) { error(response, 403, "EMPLOYEE_REQUIRED", "An employee account is required"); return; }
  const id = String(request.params.id);
  const existing = await prisma.leaveRequest.findFirst({ where: { id, employeeId: employee.id, status: RequestStatus.PENDING } });
  if (!existing) { error(response, 404, "LEAVE_REQUEST_NOT_FOUND", "Pending leave request not found"); return; }
  await prisma.$transaction([
    prisma.leaveRequest.update({ where: { id }, data: { status: RequestStatus.CANCELLED, cancelledAt: new Date() } }),
    prisma.leaveBalance.updateMany({ where: { employeeId: employee.id, leaveTypeId: existing.leaveTypeId, year: Number(existing.startDate.slice(0, 4)) }, data: { pendingMinutes: { decrement: existing.requestedMinutes } } }),
  ]);
  response.status(204).end();
}

export async function listApprovalInboxV2(_request: Request, response: Response): Promise<void> {
  const context = await getAdminContext(response); if (!context) { error(response, 403, "ORGANIZATION_ACCESS_REQUIRED", "An active administrator membership is required"); return; }
  const [corrections, leave] = await Promise.all([
    prisma.attendanceCorrection.findMany({ where: { status: RequestStatus.PENDING, employee: { user: context.employeeUserWhere } }, include: { employee: { include: { user: { select: { username: true } } } }, timesheetDay: true }, orderBy: { createdAt: "asc" } }),
    prisma.leaveRequest.findMany({ where: { status: RequestStatus.PENDING, employee: { user: context.employeeUserWhere } }, include: { employee: { include: { user: { select: { username: true } } } }, leaveType: true }, orderBy: { createdAt: "asc" } }),
  ]);
  response.json({ corrections, leave });
}

export async function reviewCorrectionV2(request: Request, response: Response): Promise<void> {
  const context = await getAdminContext(response); if (!context) { error(response, 403, "ORGANIZATION_ACCESS_REQUIRED", "An active administrator membership is required"); return; }
  const parsed = reviewSchema.safeParse(request.body); if (!parsed.success) { error(response, 400, "INVALID_REVIEW", "Choose approve or reject"); return; }
  const correction = await prisma.attendanceCorrection.findFirst({ where: { id: String(request.params.id), status: RequestStatus.PENDING, employee: { user: context.employeeUserWhere } }, include: { timesheetDay: true, employee: { include: { user: true } } } });
  if (!correction) { error(response, 404, "CORRECTION_NOT_FOUND", "Pending correction not found"); return; }
  const requested = correction.requestedValues as { firstClockInAt?: string | null; lastClockOutAt?: string | null };
  await prisma.$transaction(async (transaction) => {
    if (parsed.data.decision === "APPROVED") {
      const first = requested.firstClockInAt ? new Date(requested.firstClockInAt) : null;
      const last = requested.lastClockOutAt ? new Date(requested.lastClockOutAt) : null;
      const gross = first && last ? Math.max(Math.floor((last.getTime() - first.getTime()) / 60_000) - correction.timesheetDay.breakMinutes, 0) : 0;
      const policy = correction.employee.user.clientId ? await transaction.workPolicy.findUnique({ where: { clientId: correction.employee.user.clientId } }) : null;
      const threshold = policy?.overtimeThreshold ?? 480;
      const corrected = { firstClockInAt: first?.toISOString() ?? null, lastClockOutAt: last?.toISOString() ?? null, regularMinutes: Math.min(gross, threshold), overtimeMinutes: Math.max(gross - threshold, 0) };
      if (correction.timesheetDay.state === TimesheetState.LOCKED) {
        if (!correction.timesheetDay.payPeriodId) throw new Error("LOCKED_PERIOD_REQUIRED");
        await transaction.payrollAdjustment.create({ data: {
          payPeriodId: correction.timesheetDay.payPeriodId,
          timesheetDayId: correction.timesheetDayId,
          correctionId: correction.id,
          adjustmentType: "ATTENDANCE_CORRECTION",
          minutes: gross - correction.timesheetDay.regularMinutes - correction.timesheetDay.overtimeMinutes,
          reason: correction.reason,
          beforeValues: correction.originalValues as Prisma.InputJsonValue,
          afterValues: corrected,
          createdByUserId: response.locals.auth.sub,
        } });
      } else {
        await transaction.timesheetDay.update({ where: { id: correction.timesheetDayId }, data: { firstClockInAt: first, lastClockOutAt: last, regularMinutes: corrected.regularMinutes, overtimeMinutes: corrected.overtimeMinutes, state: first && last ? TimesheetState.COMPLETE : TimesheetState.EXCEPTION, exceptionCodes: first && last ? [] : ["CORRECTION_INCOMPLETE"], version: { increment: 1 } } });
      }
    }
    await transaction.attendanceCorrection.update({ where: { id: correction.id }, data: { status: parsed.data.decision, reviewNote: parsed.data.note, reviewedAt: new Date(), reviewedByUserId: response.locals.auth.sub } });
    await transaction.auditLog.create({ data: { actorUserId: response.locals.auth.sub, clientId: correction.employee.user.clientId, action: `CORRECTION_${parsed.data.decision}`, entityType: "AttendanceCorrection", entityId: correction.id, details: { note: parsed.data.note }, requestId: response.locals.requestId, ipAddress: request.ip } });
  });
  await notifyUsers({ userIds: [correction.employee.userId], clientId: correction.employee.user.clientId, type: `CORRECTION_${parsed.data.decision}`, title: `Attendance correction ${parsed.data.decision.toLowerCase()}`, message: `Your attendance correction for ${correction.timesheetDay.workDate} was ${parsed.data.decision.toLowerCase()}.`, entityType: "AttendanceCorrection", entityId: correction.id });
  response.status(204).end();
}

export async function reviewLeaveRequestV2(request: Request, response: Response): Promise<void> {
  const context = await getAdminContext(response); if (!context) { error(response, 403, "ORGANIZATION_ACCESS_REQUIRED", "An active administrator membership is required"); return; }
  const parsed = reviewSchema.safeParse(request.body); if (!parsed.success) { error(response, 400, "INVALID_REVIEW", "Choose approve or reject"); return; }
  const leave = await prisma.leaveRequest.findFirst({ where: { id: String(request.params.id), status: RequestStatus.PENDING, employee: { user: context.employeeUserWhere } }, include: { employee: { include: { user: true } }, leaveType: true } });
  if (!leave) { error(response, 404, "LEAVE_REQUEST_NOT_FOUND", "Pending leave request not found"); return; }
  const year = Number(leave.startDate.slice(0, 4));
  try {
    await prisma.$transaction(async (transaction) => {
      const claimed = await transaction.leaveRequest.updateMany({ where: { id: leave.id, status: RequestStatus.PENDING }, data: { status: parsed.data.decision, reviewNote: parsed.data.note, reviewedAt: new Date(), reviewedByUserId: response.locals.auth.sub } });
      if (claimed.count === 0) throw new Error("LEAVE_ALREADY_REVIEWED");
      if (parsed.data.decision === "APPROVED") {
        const lockedPeriod = await transaction.payPeriod.findFirst({ where: { clientId: leave.clientId, status: { in: [PayPeriodStatus.LOCKED, PayPeriodStatus.EXPORTED] }, startDate: { lte: leave.endDate }, endDate: { gte: leave.startDate } }, select: { id: true } });
        if (lockedPeriod) throw new Error("PAY_PERIOD_LOCKED");
        const [assignments, legacySchedule, holidays, policy] = await Promise.all([
          transaction.scheduleAssignment.findMany({ where: { employeeId: leave.employeeId, effectiveFrom: { lte: leave.endDate }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: leave.startDate } }] }, include: { shiftTemplate: true } }),
          transaction.employeeSchedule.findUnique({ where: { employeeId: leave.employeeId } }),
          transaction.holiday.findMany({ where: { clientId: leave.clientId, date: { gte: leave.startDate, lte: leave.endDate } }, select: { date: true, isWorkingDayOverride: true } }),
          transaction.workPolicy.findUnique({ where: { clientId: leave.clientId } }),
        ]);
        const allocations = planLeaveAllocations({
          startDate: leave.startDate,
          endDate: leave.endDate,
          requestedMinutes: leave.requestedMinutes,
          assignments: assignments.map((item) => ({ effectiveFrom: item.effectiveFrom, effectiveTo: item.effectiveTo, workDays: item.shiftTemplate.workDays, startTime: item.shiftTemplate.startTime, endTime: item.shiftTemplate.endTime, breakMinutes: item.shiftTemplate.breakMinutes, isActive: item.shiftTemplate.isActive })),
          legacySchedule,
          holidays,
          defaultDayMinutes: policy?.overtimeThreshold ?? 480,
          defaultBreakMinutes: policy?.defaultBreakMinutes ?? 60,
        });
        const existingDays = await transaction.timesheetDay.findMany({ where: { employeeId: leave.employeeId, workDate: { in: allocations.map((item) => item.workDate) } } });
        const existingByDate = new Map(existingDays.map((day) => [day.workDate, day]));
        for (const allocation of allocations) {
          const existing = existingByDate.get(allocation.workDate);
          const leaveMinutes = (existing?.leaveMinutes ?? 0) + allocation.minutes;
          const paidLeaveMinutes = (existing?.paidLeaveMinutes ?? 0) + (leave.leaveType.isPaid ? allocation.minutes : 0);
          const unpaidLeaveMinutes = (existing?.unpaidLeaveMinutes ?? 0) + (leave.leaveType.isPaid ? 0 : allocation.minutes);
          const exceptionCodes = (existing?.exceptionCodes ?? []).filter((code) => code !== "ABSENT" && code !== "PARTIAL_DAY_UNACCOUNTED");
          if ((existing?.regularMinutes ?? 0) + (existing?.overtimeMinutes ?? 0) + leaveMinutes < allocation.scheduledMinutes) exceptionCodes.push("PARTIAL_DAY_UNACCOUNTED");
          const state = existing?.state === TimesheetState.OPEN ? TimesheetState.OPEN : exceptionCodes.length > 0 ? TimesheetState.EXCEPTION : TimesheetState.COMPLETE;
          const timesheet = await transaction.timesheetDay.upsert({
            where: { employeeId_workDate: { employeeId: leave.employeeId, workDate: allocation.workDate } },
            create: { employeeId: leave.employeeId, clientId: leave.clientId, workDate: allocation.workDate, state, leaveMinutes, paidLeaveMinutes, unpaidLeaveMinutes, isAbsent: false, exceptionCodes },
            update: { state, leaveMinutes, paidLeaveMinutes, unpaidLeaveMinutes, isAbsent: false, exceptionCodes, version: { increment: 1 } },
          });
          await transaction.leaveAllocation.create({ data: { leaveRequestId: leave.id, timesheetDayId: timesheet.id, workDate: allocation.workDate, scheduledMinutes: allocation.scheduledMinutes, minutes: allocation.minutes, paidMinutes: leave.leaveType.isPaid ? allocation.minutes : 0, unpaidMinutes: leave.leaveType.isPaid ? 0 : allocation.minutes } });
        }
      }
      await transaction.leaveBalance.updateMany({ where: { employeeId: leave.employeeId, leaveTypeId: leave.leaveTypeId, year }, data: { pendingMinutes: { decrement: leave.requestedMinutes }, ...(parsed.data.decision === "APPROVED" ? { usedMinutes: { increment: leave.requestedMinutes } } : {}) } });
      await transaction.auditLog.create({ data: { actorUserId: response.locals.auth.sub, clientId: leave.clientId, action: `LEAVE_${parsed.data.decision}`, entityType: "LeaveRequest", entityId: leave.id, details: { note: parsed.data.note }, requestId: response.locals.requestId, ipAddress: request.ip } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : "";
    if (message === "LEAVE_ALREADY_REVIEWED") { error(response, 409, "LEAVE_ALREADY_REVIEWED", "This leave request has already been reviewed"); return; }
    if (message === "PAY_PERIOD_LOCKED") { error(response, 409, "PAY_PERIOD_LOCKED", "Leave cannot be approved inside a locked pay period"); return; }
    if (message === "INSUFFICIENT_SCHEDULED_MINUTES") { error(response, 409, "LEAVE_DURATION_EXCEEDS_SCHEDULE", "The requested leave duration exceeds scheduled working time in this date range"); return; }
    throw caught;
  }
  await notifyUsers({ userIds: [leave.employee.userId], clientId: leave.clientId, type: `LEAVE_${parsed.data.decision}`, title: `Leave request ${parsed.data.decision.toLowerCase()}`, message: `Your ${leave.leaveType.name} request from ${leave.startDate} to ${leave.endDate} was ${parsed.data.decision.toLowerCase()}.`, entityType: "LeaveRequest", entityId: leave.id });
  response.status(204).end();
}

export async function createLeaveTypeV2(request: Request, response: Response): Promise<void> {
  const context = await getAdminContext(response); if (!context?.clientId) { error(response, 403, "ORGANIZATION_ACCESS_REQUIRED", "An organization administrator is required"); return; }
  const parsed = leaveTypeSchema.safeParse(request.body); if (!parsed.success) { error(response, 400, "INVALID_LEAVE_TYPE", "Enter valid leave type details"); return; }
  const leaveType = await prisma.leaveType.create({ data: { clientId: context.clientId, ...parsed.data } });
  response.status(201).json({ data: leaveType });
}

export async function setLeaveBalanceV2(request: Request, response: Response): Promise<void> {
  const context = await getAdminContext(response); if (!context?.clientId) { error(response, 403, "ORGANIZATION_ACCESS_REQUIRED", "An organization administrator is required"); return; }
  const parsed = balanceSchema.safeParse(request.body); if (!parsed.success) { error(response, 400, "INVALID_LEAVE_BALANCE", "Enter a valid employee, leave type, year, and entitlement"); return; }
  const [employee, leaveType] = await Promise.all([prisma.employee.findFirst({ where: { id: parsed.data.employeeId, user: context.employeeUserWhere } }), prisma.leaveType.findFirst({ where: { id: parsed.data.leaveTypeId, clientId: context.clientId } })]);
  if (!employee || !leaveType) { error(response, 404, "LEAVE_BALANCE_TARGET_NOT_FOUND", "Employee or leave type not found"); return; }
  const balance = await prisma.leaveBalance.upsert({ where: { employeeId_leaveTypeId_year: { employeeId: employee.id, leaveTypeId: leaveType.id, year: parsed.data.year } }, create: parsed.data, update: { entitledMinutes: parsed.data.entitledMinutes } });
  response.json({ data: balance });
}
