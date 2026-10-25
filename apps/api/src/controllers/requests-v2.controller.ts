import { AttendanceEventSource, AttendanceEventType, AttendanceStatus, PayPeriodStatus, Prisma, RequestStatus, TimesheetState } from "@prisma/client";
import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import { z } from "zod";
import { getAdminContext } from "../services/admin-scope.js";
import { isD1Database, prisma } from "../services/prisma.js";
import { approvalRecipientIds, notifyUsers } from "../services/notifications.js";
import { planLeaveAllocations } from "../services/leave-allocation.js";
import { attendanceDate } from "../utils/attendance-date.js";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const correctionSchema = z.object({ timesheetDayId: z.string().min(1), reason: z.string().trim().min(3).max(160), note: z.string().trim().max(1_000).nullable().optional(), clockInAt: z.string().datetime().nullable(), clockOutAt: z.string().datetime().nullable() });
const clockExceptionSchema = z.object({
  action: z.enum(["CLOCK_IN", "CLOCK_OUT"]),
  reasonCode: z.enum(["GPS_UNAVAILABLE", "GPS_PERMISSION_DENIED", "GPS_TIMEOUT", "GPS_ACCURACY_TOO_LOW", "OUTSIDE_WORKSITE", "NO_WORKSITE"]),
  note: z.string().trim().max(1_000).nullable().optional(),
  diagnostics: z.object({
    attemptCount: z.number().int().min(1).max(20),
    accuracyMeters: z.number().nonnegative().max(10_000).nullable().optional(),
    worksiteId: z.string().max(200).nullable().optional(),
    worksiteName: z.string().max(200).nullable().optional(),
    distanceMeters: z.number().nonnegative().max(100_000).nullable().optional(),
    radiusMeters: z.number().int().nonnegative().max(100_000).nullable().optional(),
    browserErrorCode: z.number().int().min(1).max(3).nullable().optional(),
  }),
});
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

const leaveReviewInclude = { employee: { include: { user: true } }, leaveType: true } as const;
type LeaveForReview = Prisma.LeaveRequestGetPayload<{ include: typeof leaveReviewInclude }>;
const correctionReviewInclude = { timesheetDay: true, employee: { include: { user: true } } } as const;
type CorrectionForReview = Prisma.AttendanceCorrectionGetPayload<{ include: typeof correctionReviewInclude }>;

type CorrectionValues = {
  firstClockInAt?: string | null;
  lastClockOutAt?: string | null;
  requestKind?: "GPS_CLOCK_EXCEPTION";
  action?: "CLOCK_IN" | "CLOCK_OUT";
  reasonCode?: string;
  serverReceivedAt?: string;
  diagnostics?: Record<string, unknown>;
};

function correctedTimesheet(correction: CorrectionForReview, threshold: number) {
  const requested = correction.requestedValues as CorrectionValues;
  const first = requested.firstClockInAt ? new Date(requested.firstClockInAt) : null;
  const last = requested.lastClockOutAt ? new Date(requested.lastClockOutAt) : null;
  const gross = first && last ? Math.max(Math.floor((last.getTime() - first.getTime()) / 60_000) - correction.timesheetDay.breakMinutes, 0) : 0;
  const remainingCodes = (correction.timesheetDay.exceptionCodes ?? []).filter((code) => !["GPS_CLOCK_REQUEST_PENDING", "GPS_ACCURACY_REJECTED", "CORRECTION_INCOMPLETE"].includes(code));
  if ((!first || !last) && requested.requestKind !== "GPS_CLOCK_EXCEPTION") remainingCodes.push("CORRECTION_INCOMPLETE");
  const state = requested.requestKind === "GPS_CLOCK_EXCEPTION" && requested.action === "CLOCK_IN" && first && !last
    ? TimesheetState.OPEN
    : first && last && remainingCodes.length === 0
      ? TimesheetState.COMPLETE
      : TimesheetState.EXCEPTION;
  return {
    requested,
    first,
    last,
    gross,
    data: {
      firstClockInAt: first,
      lastClockOutAt: last,
      regularMinutes: Math.min(gross, threshold),
      overtimeMinutes: Math.max(gross - threshold, 0),
      state,
      exceptionCodes: [...new Set(remainingCodes)].sort(),
    },
  };
}

function gpsAdjustmentOperations(correction: CorrectionForReview, corrected: ReturnType<typeof correctedTimesheet>, actorUserId: string) {
  if (corrected.requested.requestKind !== "GPS_CLOCK_EXCEPTION" || !corrected.requested.action || !corrected.requested.serverReceivedAt) return [];
  const occurredAt = new Date(corrected.requested.serverReceivedAt);
  const eventType = corrected.requested.action === "CLOCK_IN" ? AttendanceEventType.CLOCK_IN : AttendanceEventType.CLOCK_OUT;
  const operations: Prisma.PrismaPromise<unknown>[] = [
    prisma.attendanceEvent.create({ data: {
      employeeId: correction.employeeId,
      clientId: correction.employee.user.clientId,
      workDate: correction.timesheetDay.workDate,
      type: eventType,
      source: AttendanceEventSource.ADMIN_ADJUSTMENT,
      occurredAt,
      idempotencyKey: `correction:${correction.id}`,
      createdByUserId: actorUserId,
      deviceDetails: { source: "GPS_CLOCK_EXCEPTION", correctionId: correction.id, reasonCode: corrected.requested.reasonCode ?? null, diagnostics: corrected.requested.diagnostics ?? null } as Prisma.InputJsonValue,
    } }),
  ];
  operations.push(eventType === AttendanceEventType.CLOCK_IN
    ? prisma.attendanceRecord.upsert({ where: { employeeId_workDate: { employeeId: correction.employeeId, workDate: correction.timesheetDay.workDate } }, create: { employeeId: correction.employeeId, workDate: correction.timesheetDay.workDate, clockInAt: occurredAt, status: AttendanceStatus.CLOCKED_IN }, update: { clockInAt: occurredAt, status: AttendanceStatus.CLOCKED_IN } })
    : prisma.attendanceRecord.upsert({ where: { employeeId_workDate: { employeeId: correction.employeeId, workDate: correction.timesheetDay.workDate } }, create: { employeeId: correction.employeeId, workDate: correction.timesheetDay.workDate, clockInAt: corrected.first ?? occurredAt, clockOutAt: occurredAt, status: AttendanceStatus.CLOCKED_OUT }, update: { clockOutAt: occurredAt, status: AttendanceStatus.CLOCKED_OUT } }));
  return operations;
}

async function reviewLeaveRequestOnD1(input: {
  leave: LeaveForReview;
  decision: "APPROVED" | "REJECTED";
  note?: string | null;
  actorUserId: string;
  requestId?: string;
  ipAddress?: string;
}): Promise<void> {
  const { leave } = input;
  const year = Number(leave.startDate.slice(0, 4));
  const operations: Prisma.PrismaPromise<unknown>[] = [
    prisma.leaveRequest.updateMany({ where: { id: leave.id, status: RequestStatus.PENDING }, data: { status: input.decision, reviewNote: input.note, reviewedAt: new Date(), reviewedByUserId: input.actorUserId } }),
  ];

  if (input.decision === "APPROVED") {
    const lockedPeriod = await prisma.payPeriod.findFirst({ where: { clientId: leave.clientId, status: { in: [PayPeriodStatus.LOCKED, PayPeriodStatus.EXPORTED] }, startDate: { lte: leave.endDate }, endDate: { gte: leave.startDate } }, select: { id: true } });
    if (lockedPeriod) throw new Error("PAY_PERIOD_LOCKED");
    const [assignments, legacySchedule, organizationHolidays, malaysiaHolidays, latestWorksite, client, policy] = await Promise.all([
      prisma.scheduleAssignment.findMany({ where: { employeeId: leave.employeeId, effectiveFrom: { lte: leave.endDate }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: leave.startDate } }] }, include: { shiftTemplate: true } }),
      prisma.employeeSchedule.findUnique({ where: { employeeId: leave.employeeId } }),
      prisma.holiday.findMany({ where: { clientId: leave.clientId, date: { gte: leave.startDate, lte: leave.endDate } }, select: { date: true, stateCode: true, isWorkingDayOverride: true } }),
      prisma.malaysiaHoliday.findMany({ where: { year: { in: [...new Set([Number(leave.startDate.slice(0, 4)), Number(leave.endDate.slice(0, 4))])] }, date: { gte: leave.startDate, lte: leave.endDate } }, select: { date: true, stateCode: true } }),
      prisma.attendanceEvent.findFirst({ where: { employeeId: leave.employeeId, workDate: { lte: leave.startDate }, worksiteId: { not: null } }, select: { worksite: { select: { stateCode: true } } }, orderBy: { occurredAt: "desc" } }),
      prisma.client.findUnique({ where: { id: leave.clientId }, select: { stateCode: true } }),
      prisma.workPolicy.findUnique({ where: { clientId: leave.clientId } }),
    ]);
    const stateCode = latestWorksite?.worksite?.stateCode ?? client?.stateCode ?? "14";
    const holidays = [
      ...organizationHolidays.filter((holiday) => !holiday.stateCode || holiday.stateCode === stateCode),
      ...malaysiaHolidays.filter((holiday) => holiday.stateCode === stateCode).map((holiday) => ({ date: holiday.date, isWorkingDayOverride: false })),
    ];
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
    const existingDays = await prisma.timesheetDay.findMany({ where: { employeeId: leave.employeeId, workDate: { in: allocations.map((item) => item.workDate) } } });
    const existingByDate = new Map(existingDays.map((day) => [day.workDate, day]));
    for (const allocation of allocations) {
      const existing = existingByDate.get(allocation.workDate);
      const timesheetDayId = existing?.id ?? randomUUID();
      const leaveMinutes = (existing?.leaveMinutes ?? 0) + allocation.minutes;
      const paidLeaveMinutes = (existing?.paidLeaveMinutes ?? 0) + (leave.leaveType.isPaid ? allocation.minutes : 0);
      const unpaidLeaveMinutes = (existing?.unpaidLeaveMinutes ?? 0) + (leave.leaveType.isPaid ? 0 : allocation.minutes);
      const exceptionCodes = (existing?.exceptionCodes ?? []).filter((code) => code !== "ABSENT" && code !== "PARTIAL_DAY_UNACCOUNTED");
      if ((existing?.regularMinutes ?? 0) + (existing?.overtimeMinutes ?? 0) + leaveMinutes < allocation.scheduledMinutes) exceptionCodes.push("PARTIAL_DAY_UNACCOUNTED");
      const state = existing?.state === TimesheetState.OPEN ? TimesheetState.OPEN : exceptionCodes.length > 0 ? TimesheetState.EXCEPTION : TimesheetState.COMPLETE;
      operations.push(
        prisma.timesheetDay.upsert({
          where: { employeeId_workDate: { employeeId: leave.employeeId, workDate: allocation.workDate } },
          create: { id: timesheetDayId, employeeId: leave.employeeId, clientId: leave.clientId, workDate: allocation.workDate, state, leaveMinutes, paidLeaveMinutes, unpaidLeaveMinutes, isAbsent: false, exceptionCodes },
          update: { state, leaveMinutes, paidLeaveMinutes, unpaidLeaveMinutes, isAbsent: false, exceptionCodes, version: { increment: 1 } },
        }),
        prisma.leaveAllocation.create({ data: { leaveRequestId: leave.id, timesheetDayId, workDate: allocation.workDate, scheduledMinutes: allocation.scheduledMinutes, minutes: allocation.minutes, paidMinutes: leave.leaveType.isPaid ? allocation.minutes : 0, unpaidMinutes: leave.leaveType.isPaid ? 0 : allocation.minutes } }),
      );
    }
  }

  operations.push(
    prisma.leaveBalance.updateMany({ where: { employeeId: leave.employeeId, leaveTypeId: leave.leaveTypeId, year }, data: { pendingMinutes: { decrement: leave.requestedMinutes }, ...(input.decision === "APPROVED" ? { usedMinutes: { increment: leave.requestedMinutes } } : {}) } }),
    prisma.auditLog.create({ data: { actorUserId: input.actorUserId, clientId: leave.clientId, action: `LEAVE_${input.decision}`, entityType: "LeaveRequest", entityId: leave.id, details: { note: input.note }, requestId: input.requestId, ipAddress: input.ipAddress } }),
  );
  await prisma.$transaction(operations);
}

async function reviewCorrectionOnD1(input: {
  correction: CorrectionForReview;
  decision: "APPROVED" | "REJECTED";
  note?: string | null;
  actorUserId: string;
  requestId?: string;
  ipAddress?: string;
}): Promise<void> {
  const { correction } = input;
  const operations: Prisma.PrismaPromise<unknown>[] = [
    prisma.attendanceCorrection.updateMany({ where: { id: correction.id, status: RequestStatus.PENDING }, data: { status: input.decision, reviewNote: input.note, reviewedAt: new Date(), reviewedByUserId: input.actorUserId } }),
  ];

  if (input.decision === "APPROVED") {
    const policy = correction.employee.user.clientId ? await prisma.workPolicy.findUnique({ where: { clientId: correction.employee.user.clientId } }) : null;
    const threshold = policy?.overtimeThreshold ?? 480;
    const corrected = correctedTimesheet(correction, threshold);
    if (correction.timesheetDay.state === TimesheetState.LOCKED) {
      if (!correction.timesheetDay.payPeriodId) throw new Error("LOCKED_PERIOD_REQUIRED");
      operations.push(prisma.payrollAdjustment.create({ data: {
        payPeriodId: correction.timesheetDay.payPeriodId,
        timesheetDayId: correction.timesheetDayId,
        correctionId: correction.id,
        adjustmentType: "ATTENDANCE_CORRECTION",
        minutes: corrected.gross - correction.timesheetDay.regularMinutes - correction.timesheetDay.overtimeMinutes,
        reason: correction.reason,
        beforeValues: correction.originalValues as Prisma.InputJsonValue,
        afterValues: corrected.data,
        createdByUserId: input.actorUserId,
      } }));
    } else {
      operations.push(...gpsAdjustmentOperations(correction, corrected, input.actorUserId));
      operations.push(prisma.timesheetDay.update({ where: { id: correction.timesheetDayId }, data: { ...corrected.data, version: { increment: 1 } } }));
    }
  }

  const requested = correction.requestedValues as CorrectionValues;
  operations.push(prisma.auditLog.create({ data: { actorUserId: input.actorUserId, clientId: correction.employee.user.clientId, action: `CORRECTION_${input.decision}`, entityType: "AttendanceCorrection", entityId: correction.id, details: { note: input.note, requestKind: requested.requestKind, action: requested.action, reasonCode: requested.reasonCode }, requestId: input.requestId, ipAddress: input.ipAddress } }));
  await prisma.$transaction(operations);
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

export async function createClockExceptionV2(request: Request, response: Response): Promise<void> {
  const parsed = clockExceptionSchema.safeParse(request.body);
  if (!parsed.success) { error(response, 400, "INVALID_CLOCK_EXCEPTION", "Enter valid GPS failure details"); return; }
  const employee = await employeeFor(response.locals.auth.sub);
  if (!employee?.user.clientId || employee.employmentStatus !== "ACTIVE") { error(response, 403, "EMPLOYEE_REQUIRED", "An active employee account assigned to an organization is required"); return; }

  const clientId = employee.user.clientId;
  const workDate = attendanceDate();
  const [timesheet, pending] = await Promise.all([
    prisma.timesheetDay.findUnique({ where: { employeeId_workDate: { employeeId: employee.id, workDate } } }),
    prisma.attendanceCorrection.findFirst({ where: { employeeId: employee.id, status: RequestStatus.PENDING, timesheetDay: { workDate } }, select: { id: true } }),
  ]);
  if (timesheet?.state === TimesheetState.LOCKED) { error(response, 409, "TIMESHEET_LOCKED", "This timesheet is locked and cannot be changed"); return; }
  if (pending) { error(response, 409, "CORRECTION_PENDING", "A correction request is already pending for today"); return; }
  if (parsed.data.action === "CLOCK_IN" && timesheet?.firstClockInAt) { error(response, 409, "CLOCK_IN_ALREADY_RECORDED", "Clock-in is already recorded for today"); return; }
  if (parsed.data.action === "CLOCK_OUT" && (!timesheet?.firstClockInAt || timesheet.lastClockOutAt)) { error(response, 409, "INVALID_CLOCK_EXCEPTION", timesheet?.lastClockOutAt ? "Clock-out is already recorded for today" : "Clock in before requesting a clock-out review"); return; }

  const now = new Date();
  const timesheetDayId = timesheet?.id ?? randomUUID();
  const requestedValues: CorrectionValues = {
    firstClockInAt: parsed.data.action === "CLOCK_IN" ? now.toISOString() : timesheet?.firstClockInAt?.toISOString() ?? null,
    lastClockOutAt: parsed.data.action === "CLOCK_OUT" ? now.toISOString() : timesheet?.lastClockOutAt?.toISOString() ?? null,
    requestKind: "GPS_CLOCK_EXCEPTION",
    action: parsed.data.action,
    reasonCode: parsed.data.reasonCode,
    serverReceivedAt: now.toISOString(),
    diagnostics: parsed.data.diagnostics,
  };
  const correctionId = randomUUID();
  const reason = `${parsed.data.action === "CLOCK_IN" ? "Clock-in" : "Clock-out"} blocked: ${parsed.data.reasonCode}`;
  const operations: Prisma.PrismaPromise<unknown>[] = [];
  if (timesheet) {
    operations.push(prisma.timesheetDay.update({ where: { id: timesheet.id }, data: { state: TimesheetState.EXCEPTION, exceptionCodes: [...new Set([...timesheet.exceptionCodes, "GPS_CLOCK_REQUEST_PENDING"])].sort(), version: { increment: 1 } } }));
  } else {
    operations.push(prisma.timesheetDay.create({ data: { id: timesheetDayId, employeeId: employee.id, clientId, workDate, state: TimesheetState.EXCEPTION, exceptionCodes: ["GPS_CLOCK_REQUEST_PENDING"] } }));
  }
  operations.push(
    prisma.attendanceCorrection.create({ data: {
      id: correctionId,
      employeeId: employee.id,
      timesheetDayId,
      reason,
      note: parsed.data.note,
      originalValues: { firstClockInAt: timesheet?.firstClockInAt?.toISOString() ?? null, lastClockOutAt: timesheet?.lastClockOutAt?.toISOString() ?? null, regularMinutes: timesheet?.regularMinutes ?? 0, overtimeMinutes: timesheet?.overtimeMinutes ?? 0, timesheetVersion: timesheet?.version ?? 0 },
      requestedValues: requestedValues as Prisma.InputJsonValue,
    } }),
    prisma.auditLog.create({ data: { actorUserId: response.locals.auth.sub, clientId, action: "GPS_CLOCK_EXCEPTION_REQUESTED", entityType: "AttendanceCorrection", entityId: correctionId, details: { action: parsed.data.action, reasonCode: parsed.data.reasonCode, diagnostics: parsed.data.diagnostics, serverReceivedAt: now.toISOString() }, requestId: response.locals.requestId, ipAddress: request.ip, userAgent: request.get("user-agent")?.slice(0, 500) } }),
  );
  await prisma.$transaction(operations);

  const recipients = await approvalRecipientIds(employee.userId, clientId);
  await notifyUsers({ userIds: recipients, clientId, type: "CORRECTION_PENDING", title: "GPS clock request awaiting review", message: `${employee.firstName} ${employee.lastName} could not ${parsed.data.action === "CLOCK_IN" ? "clock in" : "clock out"} and requested a review.`, entityType: "AttendanceCorrection", entityId: correctionId });
  response.status(201).json({ data: { id: correctionId, timesheetDayId, reason, note: parsed.data.note ?? null, requestedValues, status: RequestStatus.PENDING, createdAt: now.toISOString() } });
}

export async function listMyLeaveV2(_request: Request, response: Response): Promise<void> {
  const employee = await employeeFor(response.locals.auth.sub); if (!employee?.user.clientId) { error(response, 403, "EMPLOYEE_REQUIRED", "An employee account is required"); return; }
  const [types, balances, requests, policy] = await Promise.all([
    prisma.leaveType.findMany({ where: { clientId: employee.user.clientId, isActive: true }, orderBy: { name: "asc" } }),
    prisma.leaveBalance.findMany({ where: { employeeId: employee.id }, include: { leaveType: true }, orderBy: [{ year: "desc" }, { leaveType: { name: "asc" } }] }),
    prisma.leaveRequest.findMany({ where: { employeeId: employee.id }, include: { leaveType: true }, orderBy: { createdAt: "desc" }, take: 100 }),
    prisma.workPolicy.findUnique({ where: { clientId: employee.user.clientId }, select: { overtimeThreshold: true } }),
  ]);
  response.json({ types, balances, requests, dayMinutes: policy?.overtimeThreshold ?? 480 });
}

export async function createLeaveRequestV2(request: Request, response: Response): Promise<void> {
  const parsed = leaveSchema.safeParse(request.body);
  if (!parsed.success || parsed.data.endDate < parsed.data.startDate || parsed.data.startDate.slice(0, 4) !== parsed.data.endDate.slice(0, 4)) { error(response, 400, "INVALID_LEAVE_REQUEST", "Enter valid leave dates within one calendar year and a duration"); return; }
  const employee = await employeeFor(response.locals.auth.sub); if (!employee?.user.clientId) { error(response, 403, "EMPLOYEE_REQUIRED", "An employee account is required"); return; }
  const year = Number(parsed.data.startDate.slice(0, 4));
  try {
    const createWithD1 = async () => {
      const [leaveType, overlap] = await Promise.all([
        prisma.leaveType.findFirst({ where: { id: parsed.data.leaveTypeId, clientId: employee.user.clientId!, isActive: true } }),
        prisma.leaveRequest.findFirst({ where: { employeeId: employee.id, status: { in: [RequestStatus.PENDING, RequestStatus.APPROVED] }, startDate: { lte: parsed.data.endDate }, endDate: { gte: parsed.data.startDate } }, select: { id: true } }),
      ]);
      if (!leaveType) throw new Error("LEAVE_TYPE_NOT_FOUND");
      if (overlap) throw new Error("LEAVE_DATES_OVERLAP");
      const balance = await prisma.leaveBalance.upsert({ where: { employeeId_leaveTypeId_year: { employeeId: employee.id, leaveTypeId: leaveType.id, year } }, create: { employeeId: employee.id, leaveTypeId: leaveType.id, year, entitledMinutes: leaveType.defaultEntitlementMinutes }, update: {} });
      if (balance.entitledMinutes - balance.usedMinutes - balance.pendingMinutes < parsed.data.requestedMinutes) throw new Error("INSUFFICIENT_LEAVE");
      const [, created] = await prisma.$transaction([
        prisma.leaveBalance.update({ where: { id: balance.id }, data: { pendingMinutes: { increment: parsed.data.requestedMinutes } } }),
        prisma.leaveRequest.create({ data: { clientId: employee.user.clientId!, employeeId: employee.id, ...parsed.data } }),
      ]);
      return created;
    };
    const leaveRequest = isD1Database() ? await createWithD1() : await prisma.$transaction(async (transaction) => {
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
  const context = await getAdminContext(response); if (!context?.clientId) { error(response, 400, "ORGANIZATION_REQUIRED", "Select an organization before viewing approvals"); return; }
  const [corrections, leave, policy] = await Promise.all([
    prisma.attendanceCorrection.findMany({ where: { status: RequestStatus.PENDING, employee: { user: context.employeeUserWhere } }, include: { employee: { include: { user: { select: { username: true } } } }, timesheetDay: true }, orderBy: { createdAt: "asc" } }),
    prisma.leaveRequest.findMany({ where: { status: RequestStatus.PENDING, employee: { user: context.employeeUserWhere } }, include: { employee: { include: { user: { select: { username: true } } } }, leaveType: true }, orderBy: { createdAt: "asc" } }),
    context.clientId ? prisma.workPolicy.findUnique({ where: { clientId: context.clientId }, select: { overtimeThreshold: true } }) : Promise.resolve(null),
  ]);
  response.json({ corrections, leave, dayMinutes: policy?.overtimeThreshold ?? 480 });
}

export async function reviewCorrectionV2(request: Request, response: Response): Promise<void> {
  const context = await getAdminContext(response); if (!context?.clientId) { error(response, 400, "ORGANIZATION_REQUIRED", "Select an organization before reviewing corrections"); return; }
  const parsed = reviewSchema.safeParse(request.body); if (!parsed.success) { error(response, 400, "INVALID_REVIEW", "Choose approve or reject"); return; }
  const correction = await prisma.attendanceCorrection.findFirst({ where: { id: String(request.params.id), status: RequestStatus.PENDING, employee: { user: context.employeeUserWhere } }, include: correctionReviewInclude });
  if (!correction) { error(response, 404, "CORRECTION_NOT_FOUND", "Pending correction not found"); return; }
  const requestedValues = correction.requestedValues as CorrectionValues;
  if (parsed.data.decision === "APPROVED" && requestedValues.requestKind === "GPS_CLOCK_EXCEPTION" && ((requestedValues.action === "CLOCK_IN" && correction.timesheetDay.firstClockInAt) || (requestedValues.action === "CLOCK_OUT" && correction.timesheetDay.lastClockOutAt))) {
    error(response, 409, "CORRECTION_STALE", "Attendance has changed since this request was submitted. Reject it and review the latest timesheet."); return;
  }
  if (isD1Database()) {
    await reviewCorrectionOnD1({ correction, decision: parsed.data.decision, note: parsed.data.note, actorUserId: response.locals.auth.sub, requestId: response.locals.requestId, ipAddress: request.ip });
  } else {
    await prisma.$transaction(async (transaction) => {
      if (parsed.data.decision === "APPROVED") {
        const policy = correction.employee.user.clientId ? await transaction.workPolicy.findUnique({ where: { clientId: correction.employee.user.clientId } }) : null;
        const threshold = policy?.overtimeThreshold ?? 480;
        const corrected = correctedTimesheet(correction, threshold);
        if (correction.timesheetDay.state === TimesheetState.LOCKED) {
          if (!correction.timesheetDay.payPeriodId) throw new Error("LOCKED_PERIOD_REQUIRED");
          await transaction.payrollAdjustment.create({ data: { payPeriodId: correction.timesheetDay.payPeriodId, timesheetDayId: correction.timesheetDayId, correctionId: correction.id, adjustmentType: "ATTENDANCE_CORRECTION", minutes: corrected.gross - correction.timesheetDay.regularMinutes - correction.timesheetDay.overtimeMinutes, reason: correction.reason, beforeValues: correction.originalValues as Prisma.InputJsonValue, afterValues: corrected.data, createdByUserId: response.locals.auth.sub } });
        } else {
          if (corrected.requested.requestKind === "GPS_CLOCK_EXCEPTION" && corrected.requested.action && corrected.requested.serverReceivedAt) {
            const occurredAt = new Date(corrected.requested.serverReceivedAt);
            const eventType = corrected.requested.action === "CLOCK_IN" ? AttendanceEventType.CLOCK_IN : AttendanceEventType.CLOCK_OUT;
            await transaction.attendanceEvent.create({ data: { employeeId: correction.employeeId, clientId: correction.employee.user.clientId, workDate: correction.timesheetDay.workDate, type: eventType, source: AttendanceEventSource.ADMIN_ADJUSTMENT, occurredAt, idempotencyKey: `correction:${correction.id}`, createdByUserId: response.locals.auth.sub, deviceDetails: { source: "GPS_CLOCK_EXCEPTION", correctionId: correction.id, reasonCode: corrected.requested.reasonCode ?? null, diagnostics: corrected.requested.diagnostics ?? null } as Prisma.InputJsonValue } });
            if (eventType === AttendanceEventType.CLOCK_IN) await transaction.attendanceRecord.upsert({ where: { employeeId_workDate: { employeeId: correction.employeeId, workDate: correction.timesheetDay.workDate } }, create: { employeeId: correction.employeeId, workDate: correction.timesheetDay.workDate, clockInAt: occurredAt, status: AttendanceStatus.CLOCKED_IN }, update: { clockInAt: occurredAt, status: AttendanceStatus.CLOCKED_IN } });
            else await transaction.attendanceRecord.upsert({ where: { employeeId_workDate: { employeeId: correction.employeeId, workDate: correction.timesheetDay.workDate } }, create: { employeeId: correction.employeeId, workDate: correction.timesheetDay.workDate, clockInAt: corrected.first ?? occurredAt, clockOutAt: occurredAt, status: AttendanceStatus.CLOCKED_OUT }, update: { clockOutAt: occurredAt, status: AttendanceStatus.CLOCKED_OUT } });
          }
          await transaction.timesheetDay.update({ where: { id: correction.timesheetDayId }, data: { ...corrected.data, version: { increment: 1 } } });
        }
      }
      await transaction.attendanceCorrection.update({ where: { id: correction.id }, data: { status: parsed.data.decision, reviewNote: parsed.data.note, reviewedAt: new Date(), reviewedByUserId: response.locals.auth.sub } });
      const requested = correction.requestedValues as CorrectionValues;
      await transaction.auditLog.create({ data: { actorUserId: response.locals.auth.sub, clientId: correction.employee.user.clientId, action: `CORRECTION_${parsed.data.decision}`, entityType: "AttendanceCorrection", entityId: correction.id, details: { note: parsed.data.note, requestKind: requested.requestKind, action: requested.action, reasonCode: requested.reasonCode }, requestId: response.locals.requestId, ipAddress: request.ip } });
    });
  }
  await notifyUsers({ userIds: [correction.employee.userId], clientId: correction.employee.user.clientId, type: `CORRECTION_${parsed.data.decision}`, title: `Attendance correction ${parsed.data.decision.toLowerCase()}`, message: `Your attendance correction for ${correction.timesheetDay.workDate} was ${parsed.data.decision.toLowerCase()}.`, entityType: "AttendanceCorrection", entityId: correction.id });
  response.status(204).end();
}

export async function reviewLeaveRequestV2(request: Request, response: Response): Promise<void> {
  const context = await getAdminContext(response); if (!context?.clientId) { error(response, 400, "ORGANIZATION_REQUIRED", "Select an organization before reviewing leave requests"); return; }
  const parsed = reviewSchema.safeParse(request.body); if (!parsed.success) { error(response, 400, "INVALID_REVIEW", "Choose approve or reject"); return; }
  const leave = await prisma.leaveRequest.findFirst({ where: { id: String(request.params.id), status: RequestStatus.PENDING, employee: { user: context.employeeUserWhere } }, include: leaveReviewInclude });
  if (!leave) { error(response, 404, "LEAVE_REQUEST_NOT_FOUND", "Pending leave request not found"); return; }
  const year = Number(leave.startDate.slice(0, 4));
  try {
    if (isD1Database()) {
      await reviewLeaveRequestOnD1({ leave, decision: parsed.data.decision, note: parsed.data.note, actorUserId: response.locals.auth.sub, requestId: response.locals.requestId, ipAddress: request.ip });
    } else await prisma.$transaction(async (transaction) => {
      const claimed = await transaction.leaveRequest.updateMany({ where: { id: leave.id, status: RequestStatus.PENDING }, data: { status: parsed.data.decision, reviewNote: parsed.data.note, reviewedAt: new Date(), reviewedByUserId: response.locals.auth.sub } });
      if (claimed.count === 0) throw new Error("LEAVE_ALREADY_REVIEWED");
      if (parsed.data.decision === "APPROVED") {
        const lockedPeriod = await transaction.payPeriod.findFirst({ where: { clientId: leave.clientId, status: { in: [PayPeriodStatus.LOCKED, PayPeriodStatus.EXPORTED] }, startDate: { lte: leave.endDate }, endDate: { gte: leave.startDate } }, select: { id: true } });
        if (lockedPeriod) throw new Error("PAY_PERIOD_LOCKED");
        const [assignments, legacySchedule, organizationHolidays, malaysiaHolidays, latestWorksite, client, policy] = await Promise.all([
          transaction.scheduleAssignment.findMany({ where: { employeeId: leave.employeeId, effectiveFrom: { lte: leave.endDate }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: leave.startDate } }] }, include: { shiftTemplate: true } }),
          transaction.employeeSchedule.findUnique({ where: { employeeId: leave.employeeId } }),
          transaction.holiday.findMany({ where: { clientId: leave.clientId, date: { gte: leave.startDate, lte: leave.endDate } }, select: { date: true, stateCode: true, isWorkingDayOverride: true } }),
          transaction.malaysiaHoliday.findMany({ where: { year: { in: [...new Set([Number(leave.startDate.slice(0, 4)), Number(leave.endDate.slice(0, 4))])] }, date: { gte: leave.startDate, lte: leave.endDate } }, select: { date: true, stateCode: true } }),
          transaction.attendanceEvent.findFirst({ where: { employeeId: leave.employeeId, workDate: { lte: leave.startDate }, worksiteId: { not: null } }, select: { worksite: { select: { stateCode: true } } }, orderBy: { occurredAt: "desc" } }),
          transaction.client.findUnique({ where: { id: leave.clientId }, select: { stateCode: true } }),
          transaction.workPolicy.findUnique({ where: { clientId: leave.clientId } }),
        ]);
        const stateCode = latestWorksite?.worksite?.stateCode ?? client?.stateCode ?? "14";
        const holidays = [
          ...organizationHolidays.filter((holiday) => !holiday.stateCode || holiday.stateCode === stateCode),
          ...malaysiaHolidays.filter((holiday) => holiday.stateCode === stateCode).map((holiday) => ({ date: holiday.date, isWorkingDayOverride: false })),
        ];
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
