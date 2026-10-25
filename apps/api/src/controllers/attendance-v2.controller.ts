import { AttendanceEventType, AttendanceStatus, Prisma, RequestStatus, TimesheetState } from "@prisma/client";
import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import { z } from "zod";
import { acquireDatabaseLock, executeD1Batch, isD1Database, prisma } from "../services/prisma.js";
import { validateLocation, type Location } from "../services/geofence.js";
import { calculateTimesheet } from "../services/timesheet-calculator.js";
import { attendanceDate } from "../utils/attendance-date.js";
import { env } from "../config/env.js";
import { enqueueWebhookDelivery, webhookPayload } from "../services/webhook-queue.js";
import { logger } from "../services/logger.js";
import { applyScheduleExceptions, calculateScheduleMetrics } from "../services/schedule-metrics.js";

const locationSchema = z.object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180), accuracy: z.number().nonnegative().max(10_000) });
const idempotencyPattern = /^[A-Za-z0-9._:-]{8,128}$/;
const webhookEventNames: Record<AttendanceEventType, "attendance.clock_in" | "attendance.clock_out" | "attendance.break_start" | "attendance.break_end"> = {
  CLOCK_IN: "attendance.clock_in",
  CLOCK_OUT: "attendance.clock_out",
  BREAK_START: "attendance.break_start",
  BREAK_END: "attendance.break_end",
};

class AttendanceActionError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

const transitionMessages: Record<AttendanceEventType, string> = {
  CLOCK_IN: "Clock out before starting another shift",
  CLOCK_OUT: "Clock in before clocking out",
  BREAK_START: "Clock in before starting a break",
  BREAK_END: "Start a break before ending it",
};

function transitionAllowed(lastType: AttendanceEventType | undefined, requestedType: AttendanceEventType): boolean {
  if (requestedType === AttendanceEventType.CLOCK_IN) return !lastType || lastType === AttendanceEventType.CLOCK_OUT;
  if (requestedType === AttendanceEventType.CLOCK_OUT) return lastType === AttendanceEventType.CLOCK_IN || lastType === AttendanceEventType.BREAK_END;
  if (requestedType === AttendanceEventType.BREAK_START) return lastType === AttendanceEventType.CLOCK_IN || lastType === AttendanceEventType.BREAK_END;
  return lastType === AttendanceEventType.BREAK_START;
}

function actionInput(request: Request, response: Response): { location: Location; idempotencyKey: string } | null {
  const parsedLocation = locationSchema.safeParse(request.body?.location);
  const idempotencyKey = request.header("idempotency-key")?.trim();
  if (!parsedLocation.success) {
    response.status(400).json({ error: { code: "INVALID_LOCATION", message: "A valid GPS location is required" }, requestId: response.locals.requestId });
    return null;
  }
  if (!idempotencyKey || !idempotencyPattern.test(idempotencyKey)) {
    response.status(400).json({ error: { code: "INVALID_IDEMPOTENCY_KEY", message: "A valid Idempotency-Key header is required" }, requestId: response.locals.requestId });
    return null;
  }
  return { location: parsedLocation.data, idempotencyKey };
}

type D1AttendanceActionInput = {
  employee: { id: string; firstName: string; lastName: string };
  clientId: string;
  requestedType: AttendanceEventType;
  input: { location: Location; idempotencyKey: string };
  acceptedWorksite: { id: string; distanceMeters: number; radiusMeters: number };
  policy: { overtimeThreshold: number; roundingIncrement: number; maximumShiftMinutes: number } | null;
  actorUserId: string;
  requestId: string;
  ipAddress: string | undefined;
  userAgent: string | null;
};

async function applyAttendanceActionOnD1(args: D1AttendanceActionInput) {
  const { employee, clientId, requestedType, input, acceptedWorksite, policy, actorUserId, requestId, ipAddress, userAgent } = args;
  const duplicate = await prisma.attendanceEvent.findUnique({
    where: { employeeId_idempotencyKey: { employeeId: employee.id, idempotencyKey: input.idempotencyKey } },
  });
  if (duplicate) {
    const [timesheet, attendance] = await Promise.all([
      prisma.timesheetDay.findUnique({ where: { employeeId_workDate: { employeeId: employee.id, workDate: duplicate.workDate } } }),
      prisma.attendanceRecord.findUnique({ where: { employeeId_workDate: { employeeId: employee.id, workDate: duplicate.workDate } } }),
    ]);
    return { event: duplicate, timesheet, attendance, replayed: true, webhookDeliveryId: null };
  }

  const latest = await prisma.attendanceEvent.findFirst({ where: { employeeId: employee.id }, orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }] });
  if (!transitionAllowed(latest?.type, requestedType)) throw new AttendanceActionError(409, "INVALID_ATTENDANCE_TRANSITION", transitionMessages[requestedType]);

  const now = new Date();
  const workDate = requestedType === AttendanceEventType.CLOCK_IN ? attendanceDate(now) : latest!.workDate;
  const [lockedTimesheet, attendance, events, assignment] = await Promise.all([
    prisma.timesheetDay.findUnique({ where: { employeeId_workDate: { employeeId: employee.id, workDate } }, select: { state: true } }),
    prisma.attendanceRecord.findUnique({ where: { employeeId_workDate: { employeeId: employee.id, workDate } } }),
    prisma.attendanceEvent.findMany({ where: { employeeId: employee.id, workDate }, orderBy: [{ occurredAt: "asc" }, { createdAt: "asc" }] }),
    prisma.scheduleAssignment.findFirst({ where: { employeeId: employee.id, effectiveFrom: { lte: workDate }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: workDate } }] }, include: { shiftTemplate: true }, orderBy: { effectiveFrom: "desc" } }),
  ]);
  if (lockedTimesheet?.state === TimesheetState.LOCKED) throw new AttendanceActionError(409, "TIMESHEET_LOCKED", "This timesheet is locked and cannot accept new events");

  const calculation = calculateTimesheet([...events, { type: requestedType, occurredAt: now }], {
    regularDayMinutes: policy?.overtimeThreshold ?? 480,
    roundingIncrement: policy?.roundingIncrement ?? 1,
    maximumShiftMinutes: policy?.maximumShiftMinutes,
  });
  const scheduleMetrics = calculateScheduleMetrics(workDate, calculation.firstClockInAt, calculation.lastClockOutAt, assignment?.shiftTemplate ?? null);
  const scheduleExceptions = applyScheduleExceptions(calculation, scheduleMetrics);
  const eventId = randomUUID();
  const webhookDeliveryId = env.WEBHOOK_URL ? randomUUID() : null;
  const nowMs = now.getTime();
  const operations: Array<{ sql: string; values: unknown[] }> = [{
    sql: `INSERT INTO "AttendanceEvent" ("id", "employeeId", "clientId", "workDate", "type", "occurredAt", "worksiteId", "latitude", "longitude", "accuracyMeters", "distanceMeters", "acceptedRadiusMeters", "idempotencyKey", "createdByUserId", "deviceDetails", "createdAt") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    values: [eventId, employee.id, clientId, workDate, requestedType, nowMs, acceptedWorksite.id, input.location.latitude, input.location.longitude, input.location.accuracy, acceptedWorksite.distanceMeters, acceptedWorksite.radiusMeters, input.idempotencyKey, actorUserId, JSON.stringify({ userAgent }), nowMs],
  }];

  if (requestedType === AttendanceEventType.CLOCK_IN) {
    operations.push(attendance ? {
      sql: `UPDATE "AttendanceRecord" SET "clockOutAt" = NULL, "clockOutLatitude" = NULL, "clockOutLongitude" = NULL, "clockOutAccuracy" = NULL, "status" = 'CLOCKED_IN', "updatedAt" = ? WHERE "id" = ?`,
      values: [nowMs, attendance.id],
    } : {
      sql: `INSERT INTO "AttendanceRecord" ("id", "employeeId", "workDate", "clockInAt", "clockInLatitude", "clockInLongitude", "clockInAccuracy", "status", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?, ?, ?, 'CLOCKED_IN', ?, ?)`,
      values: [randomUUID(), employee.id, workDate, nowMs, input.location.latitude, input.location.longitude, input.location.accuracy, nowMs, nowMs],
    });
  } else if (requestedType === AttendanceEventType.CLOCK_OUT && attendance) {
    operations.push({
      sql: `UPDATE "AttendanceRecord" SET "clockOutAt" = ?, "clockOutLatitude" = ?, "clockOutLongitude" = ?, "clockOutAccuracy" = ?, "status" = 'CLOCKED_OUT', "updatedAt" = ? WHERE "id" = ?`,
      values: [nowMs, input.location.latitude, input.location.longitude, input.location.accuracy, nowMs, attendance.id],
    });
  }

  operations.push(
    {
      sql: `INSERT INTO "TimesheetDay" ("id", "employeeId", "clientId", "workDate", "state", "firstClockInAt", "lastClockOutAt", "regularMinutes", "overtimeMinutes", "breakMinutes", "lateMinutes", "earlyDepartureMinutes", "exceptionCodes", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT ("employeeId", "workDate") DO UPDATE SET "state" = excluded."state", "firstClockInAt" = excluded."firstClockInAt", "lastClockOutAt" = excluded."lastClockOutAt", "regularMinutes" = excluded."regularMinutes", "overtimeMinutes" = excluded."overtimeMinutes", "breakMinutes" = excluded."breakMinutes", "lateMinutes" = excluded."lateMinutes", "earlyDepartureMinutes" = excluded."earlyDepartureMinutes", "exceptionCodes" = excluded."exceptionCodes", "version" = "TimesheetDay"."version" + 1, "updatedAt" = excluded."updatedAt"`,
      values: [randomUUID(), employee.id, clientId, workDate, scheduleExceptions.state, calculation.firstClockInAt?.getTime() ?? null, calculation.lastClockOutAt?.getTime() ?? null, calculation.regularMinutes, calculation.overtimeMinutes, calculation.breakMinutes, scheduleMetrics.lateMinutes, scheduleMetrics.earlyDepartureMinutes, JSON.stringify(scheduleExceptions.exceptionCodes), nowMs, nowMs],
    },
    {
      sql: `INSERT INTO "AuditLog" ("id", "actorUserId", "clientId", "action", "entityType", "entityId", "details", "requestId", "ipAddress", "userAgent", "createdAt") VALUES (?, ?, ?, ?, 'AttendanceEvent', ?, ?, ?, ?, ?, ?)`,
      values: [randomUUID(), actorUserId, clientId, requestedType, eventId, JSON.stringify({ workDate, worksiteId: acceptedWorksite.id, idempotencyKey: input.idempotencyKey }), requestId, ipAddress ?? null, userAgent, nowMs],
    },
  );
  if (webhookDeliveryId) {
    operations.push({
      sql: `INSERT INTO "WebhookDelivery" ("id", "clientId", "attendanceEventId", "eventType", "payload", "status", "attempts", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?, 'PENDING', 0, ?, ?)`,
      values: [webhookDeliveryId, clientId, eventId, webhookEventNames[requestedType], JSON.stringify(webhookPayload({ event: webhookEventNames[requestedType], eventId, employeeId: employee.id, employeeName: `${employee.firstName} ${employee.lastName}`, workDate, timestamp: now.toISOString(), location: input.location })), nowMs, nowMs],
    });
  }

  await executeD1Batch(operations);
  const [event, timesheet, storedAttendance] = await Promise.all([
    prisma.attendanceEvent.findUnique({ where: { id: eventId } }),
    prisma.timesheetDay.findUnique({ where: { employeeId_workDate: { employeeId: employee.id, workDate } } }),
    prisma.attendanceRecord.findUnique({ where: { employeeId_workDate: { employeeId: employee.id, workDate } } }),
  ]);
  if (!event || !timesheet) throw new Error("D1 attendance batch completed without the expected records");
  return { event, timesheet, attendance: storedAttendance, replayed: false, webhookDeliveryId };
}

async function performAction(request: Request, response: Response, requestedType: AttendanceEventType): Promise<void> {
  const input = actionInput(request, response);
  if (!input) return;

  const employee = await prisma.employee.findUnique({
    where: { userId: response.locals.auth.sub },
    include: { user: { select: { clientId: true } } },
  });
  if (!employee?.user.clientId) {
    response.status(403).json({ error: { code: "EMPLOYEE_REQUIRED", message: "An employee account assigned to an organization is required" }, requestId: response.locals.requestId });
    return;
  }
  if (employee.employmentStatus !== "ACTIVE") {
    response.status(403).json({ error: { code: "EMPLOYMENT_INACTIVE", message: "Only active employees can record attendance" }, requestId: response.locals.requestId });
    return;
  }
  const clientId = employee.user.clientId;

  const pendingCorrection = await prisma.attendanceCorrection.findFirst({ where: { employeeId: employee.id, status: RequestStatus.PENDING }, select: { requestedValues: true }, orderBy: { createdAt: "desc" } });
  const pendingValues = pendingCorrection?.requestedValues as { requestKind?: string; action?: string } | undefined;
  if (pendingValues?.requestKind === "GPS_CLOCK_EXCEPTION" && pendingValues.action === requestedType) {
    response.status(409).json({ error: { code: "CLOCK_EXCEPTION_PENDING", message: "A GPS clock request for this action is awaiting administrator review" }, requestId: response.locals.requestId });
    return;
  }

  const policy = await prisma.workPolicy.findUnique({ where: { clientId } });
  if (policy && input.location.accuracy > policy.maximumGpsAccuracy) {
    const recordGpsRejection = async (transaction: Prisma.TransactionClient) => {
      const workDate = attendanceDate();
      const existing = await transaction.timesheetDay.findUnique({ where: { employeeId_workDate: { employeeId: employee.id, workDate } } });
      if (existing && existing.state !== TimesheetState.LOCKED) {
        await transaction.timesheetDay.update({
          where: { id: existing.id },
          data: {
            state: existing.state === TimesheetState.OPEN ? TimesheetState.OPEN : TimesheetState.EXCEPTION,
            exceptionCodes: [...new Set([...existing.exceptionCodes, "GPS_ACCURACY_REJECTED"])].sort(),
            version: { increment: 1 },
          },
        });
      } else if (!existing) {
        await transaction.timesheetDay.create({ data: { employeeId: employee.id, clientId, workDate, state: TimesheetState.EXCEPTION, exceptionCodes: ["GPS_ACCURACY_REJECTED"] } });
      }
      await transaction.auditLog.create({ data: { actorUserId: response.locals.auth.sub, clientId, action: "ATTENDANCE_REJECTED_GPS_ACCURACY", entityType: "Employee", entityId: employee.id, details: { accuracyMeters: input.location.accuracy, maximumGpsAccuracy: policy.maximumGpsAccuracy }, requestId: response.locals.requestId, ipAddress: request.ip } });
    };
    if (isD1Database()) {
      const workDate = attendanceDate();
      const existing = await prisma.timesheetDay.findUnique({ where: { employeeId_workDate: { employeeId: employee.id, workDate } } });
      const nowMs = Date.now();
      const exceptionCodes = [...new Set([...(existing?.exceptionCodes ?? []), "GPS_ACCURACY_REJECTED"])].sort();
      await executeD1Batch([
        existing ? {
          sql: `UPDATE "TimesheetDay" SET "state" = ?, "exceptionCodes" = ?, "version" = "version" + 1, "updatedAt" = ? WHERE "id" = ?`,
          values: [existing.state === TimesheetState.OPEN ? TimesheetState.OPEN : TimesheetState.EXCEPTION, JSON.stringify(exceptionCodes), nowMs, existing.id],
        } : {
          sql: `INSERT INTO "TimesheetDay" ("id", "employeeId", "clientId", "workDate", "state", "exceptionCodes", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, 'EXCEPTION', ?, ?, ?)`,
          values: [randomUUID(), employee.id, clientId, workDate, JSON.stringify(exceptionCodes), nowMs, nowMs],
        },
        {
          sql: `INSERT INTO "AuditLog" ("id", "actorUserId", "clientId", "action", "entityType", "entityId", "details", "requestId", "ipAddress", "createdAt") VALUES (?, ?, ?, 'ATTENDANCE_REJECTED_GPS_ACCURACY', 'Employee', ?, ?, ?, ?, ?)`,
          values: [randomUUID(), response.locals.auth.sub, clientId, employee.id, JSON.stringify({ accuracyMeters: input.location.accuracy, maximumGpsAccuracy: policy.maximumGpsAccuracy }), response.locals.requestId, request.ip ?? null, nowMs],
        },
      ]);
    } else {
      await prisma.$transaction(recordGpsRejection);
    }
    response.status(422).json({ error: { code: "GPS_ACCURACY_TOO_LOW", message: `GPS accuracy must be within ${policy.maximumGpsAccuracy} metres` }, requestId: response.locals.requestId });
    return;
  }

  const locationValidation = await validateLocation(clientId, input.location);
  if (!locationValidation.valid || !locationValidation.worksite) {
    response.status(403).json({ error: { code: "OUTSIDE_WORKSITE", message: locationValidation.reason ?? "The location is not allowed" }, location: locationValidation, requestId: response.locals.requestId });
    return;
  }
  const acceptedWorksite = locationValidation.worksite;

  try {
    const result = isD1Database() ? await applyAttendanceActionOnD1({
      employee,
      clientId,
      requestedType,
      input,
      acceptedWorksite,
      policy,
      actorUserId: response.locals.auth.sub,
      requestId: response.locals.requestId,
      ipAddress: request.ip,
      userAgent: request.get("user-agent")?.slice(0, 500) ?? null,
    }) : await prisma.$transaction(async (transaction) => {
      await acquireDatabaseLock(transaction, employee.id);

      const duplicate = await transaction.attendanceEvent.findUnique({
        where: { employeeId_idempotencyKey: { employeeId: employee.id, idempotencyKey: input.idempotencyKey } },
      });
      if (duplicate) {
        const [timesheet, attendance] = await Promise.all([
          transaction.timesheetDay.findUnique({ where: { employeeId_workDate: { employeeId: employee.id, workDate: duplicate.workDate } } }),
          transaction.attendanceRecord.findUnique({ where: { employeeId_workDate: { employeeId: employee.id, workDate: duplicate.workDate } } }),
        ]);
        return { event: duplicate, timesheet, attendance, replayed: true, webhookDeliveryId: null };
      }

      const latest = await transaction.attendanceEvent.findFirst({
        where: { employeeId: employee.id },
        orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
      });
      if (!transitionAllowed(latest?.type, requestedType)) {
        throw new AttendanceActionError(409, "INVALID_ATTENDANCE_TRANSITION", transitionMessages[requestedType]);
      }

      const now = new Date();
      const workDate = requestedType === AttendanceEventType.CLOCK_IN ? attendanceDate(now) : latest!.workDate;
      const lockedTimesheet = await transaction.timesheetDay.findUnique({ where: { employeeId_workDate: { employeeId: employee.id, workDate } }, select: { state: true } });
      if (lockedTimesheet?.state === TimesheetState.LOCKED) {
        throw new AttendanceActionError(409, "TIMESHEET_LOCKED", "This timesheet is locked and cannot accept new events");
      }

      const event = await transaction.attendanceEvent.create({
        data: {
          employeeId: employee.id,
          clientId,
          workDate,
          type: requestedType,
          occurredAt: now,
          worksiteId: acceptedWorksite.id,
          latitude: input.location.latitude,
          longitude: input.location.longitude,
          accuracyMeters: input.location.accuracy,
          distanceMeters: acceptedWorksite.distanceMeters,
          acceptedRadiusMeters: acceptedWorksite.radiusMeters,
          idempotencyKey: input.idempotencyKey,
          createdByUserId: response.locals.auth.sub,
          deviceDetails: { userAgent: request.get("user-agent")?.slice(0, 500) ?? null },
        },
      });

      let attendance = await transaction.attendanceRecord.findUnique({ where: { employeeId_workDate: { employeeId: employee.id, workDate } } });
      if (requestedType === AttendanceEventType.CLOCK_IN) {
        attendance = attendance
          ? await transaction.attendanceRecord.update({ where: { id: attendance.id }, data: { clockOutAt: null, clockOutLatitude: null, clockOutLongitude: null, clockOutAccuracy: null, status: AttendanceStatus.CLOCKED_IN } })
          : await transaction.attendanceRecord.create({ data: { employeeId: employee.id, workDate, clockInAt: now, clockInLatitude: input.location.latitude, clockInLongitude: input.location.longitude, clockInAccuracy: input.location.accuracy } });
      } else if (requestedType === AttendanceEventType.CLOCK_OUT && attendance) {
        attendance = await transaction.attendanceRecord.update({ where: { id: attendance.id }, data: { clockOutAt: now, clockOutLatitude: input.location.latitude, clockOutLongitude: input.location.longitude, clockOutAccuracy: input.location.accuracy, status: AttendanceStatus.CLOCKED_OUT } });
      }

      const events = await transaction.attendanceEvent.findMany({ where: { employeeId: employee.id, workDate }, orderBy: [{ occurredAt: "asc" }, { createdAt: "asc" }] });
      const calculation = calculateTimesheet(events, { regularDayMinutes: policy?.overtimeThreshold ?? 480, roundingIncrement: policy?.roundingIncrement ?? 1, maximumShiftMinutes: policy?.maximumShiftMinutes });
      const assignment = await transaction.scheduleAssignment.findFirst({ where: { employeeId: employee.id, effectiveFrom: { lte: workDate }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: workDate } }] }, include: { shiftTemplate: true }, orderBy: { effectiveFrom: "desc" } });
      const scheduleMetrics = calculateScheduleMetrics(workDate, calculation.firstClockInAt, calculation.lastClockOutAt, assignment?.shiftTemplate ?? null);
      const scheduleExceptions = applyScheduleExceptions(calculation, scheduleMetrics);
      const timesheet = await transaction.timesheetDay.upsert({
        where: { employeeId_workDate: { employeeId: employee.id, workDate } },
        create: { employeeId: employee.id, clientId, workDate, ...calculation, ...scheduleMetrics, ...scheduleExceptions },
        update: { ...calculation, ...scheduleMetrics, ...scheduleExceptions, version: { increment: 1 } },
      });

      await transaction.auditLog.create({
        data: {
          actorUserId: response.locals.auth.sub,
          clientId,
          action: requestedType,
          entityType: "AttendanceEvent",
          entityId: event.id,
          details: { workDate, worksiteId: event.worksiteId, idempotencyKey: input.idempotencyKey },
          requestId: response.locals.requestId,
          ipAddress: request.ip,
          userAgent: request.get("user-agent")?.slice(0, 500),
        },
      });
      const delivery = env.WEBHOOK_URL
        ? await transaction.webhookDelivery.create({
          data: {
            clientId,
            attendanceEventId: event.id,
            eventType: webhookEventNames[requestedType],
            payload: webhookPayload({
              event: webhookEventNames[requestedType],
              eventId: event.id,
              employeeId: employee.id,
              employeeName: `${employee.firstName} ${employee.lastName}`,
              workDate,
              timestamp: now.toISOString(),
              location: input.location,
            }),
          },
          select: { id: true },
        })
        : null;
      return { event, timesheet, attendance, replayed: false, webhookDeliveryId: delivery?.id ?? null };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });

    if (result.webhookDeliveryId) {
      await enqueueWebhookDelivery(result.webhookDeliveryId).catch((error: unknown) => {
        logger.warn("webhook_enqueue_failed", { deliveryId: result.webhookDeliveryId, message: error instanceof Error ? error.message : "Unknown queue error" });
      });
    }
    response.status(result.replayed ? 200 : 201).json({ event: result.event, timesheet: result.timesheet, attendance: result.attendance, replayed: result.replayed });
  } catch (error) {
    if (error instanceof AttendanceActionError) {
      response.status(error.status).json({ error: { code: error.code, message: error.message }, requestId: response.locals.requestId });
      return;
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      response.status(409).json({ error: { code: "CONCURRENT_ATTENDANCE_ACTION", message: "This attendance action was already processed. Refresh and try again." }, requestId: response.locals.requestId });
      return;
    }
    throw error;
  }
}

export const clockInV2 = (request: Request, response: Response) => performAction(request, response, AttendanceEventType.CLOCK_IN);
export const clockOutV2 = (request: Request, response: Response) => performAction(request, response, AttendanceEventType.CLOCK_OUT);
export const breakStartV2 = (request: Request, response: Response) => performAction(request, response, AttendanceEventType.BREAK_START);
export const breakEndV2 = (request: Request, response: Response) => performAction(request, response, AttendanceEventType.BREAK_END);

export async function getTodayTimesheetV2(_request: Request, response: Response): Promise<void> {
  const employee = await prisma.employee.findUnique({ where: { userId: response.locals.auth.sub }, select: { id: true } });
  if (!employee) {
    response.status(403).json({ error: { code: "EMPLOYEE_REQUIRED", message: "An employee account is required" }, requestId: response.locals.requestId });
    return;
  }
  const workDate = attendanceDate();
  const [timesheet, events] = await Promise.all([
    prisma.timesheetDay.findUnique({ where: { employeeId_workDate: { employeeId: employee.id, workDate } } }),
    prisma.attendanceEvent.findMany({ where: { employeeId: employee.id, workDate }, orderBy: [{ occurredAt: "asc" }, { createdAt: "asc" }] }),
  ]);
  response.json({ timesheet, events });
}

export async function listMyTimesheetsV2(request: Request, response: Response): Promise<void> {
  const employee = await prisma.employee.findUnique({ where: { userId: response.locals.auth.sub }, select: { id: true } });
  if (!employee) { response.status(403).json({ error: { code: "EMPLOYEE_REQUIRED", message: "An employee account is required" }, requestId: response.locals.requestId }); return; }
  const today = attendanceDate();
  const defaultFrom = new Date(`${today}T00:00:00Z`); defaultFrom.setUTCDate(defaultFrom.getUTCDate() - 6);
  const from = typeof request.query.from === "string" ? request.query.from : defaultFrom.toISOString().slice(0, 10);
  const to = typeof request.query.to === "string" ? request.query.to : today;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to || (new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86_400_000 > 62) {
    response.status(400).json({ error: { code: "INVALID_DATE_RANGE", message: "Choose a valid date range of no more than 63 days" }, requestId: response.locals.requestId }); return;
  }
  const data = await prisma.timesheetDay.findMany({ where: { employeeId: employee.id, workDate: { gte: from, lte: to } }, orderBy: { workDate: "desc" } });
  response.json({ data });
}

export async function getMyScheduleV2(_request: Request, response: Response): Promise<void> {
  const employee = await prisma.employee.findUnique({ where: { userId: response.locals.auth.sub }, select: { id: true } });
  if (!employee) { response.status(403).json({ error: { code: "EMPLOYEE_REQUIRED", message: "An employee account is required" }, requestId: response.locals.requestId }); return; }
  const today = attendanceDate();
  const assignment = await prisma.scheduleAssignment.findFirst({ where: { employeeId: employee.id, effectiveFrom: { lte: today }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: today } }] }, include: { shiftTemplate: true }, orderBy: { effectiveFrom: "desc" } });
  response.json({ data: assignment });
}
