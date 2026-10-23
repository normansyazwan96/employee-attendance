import { AttendanceEventType, AttendanceStatus, Prisma, TimesheetState } from "@prisma/client";
import type { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../services/prisma.js";
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

  const policy = await prisma.workPolicy.findUnique({ where: { clientId } });
  if (policy && input.location.accuracy > policy.maximumGpsAccuracy) {
    await prisma.$transaction(async (transaction) => {
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
    });
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
    const result = await prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${employee.id}))::text`;

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
