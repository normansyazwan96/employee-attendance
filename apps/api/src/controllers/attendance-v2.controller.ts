import { AttendanceEventType, AttendanceStatus, Prisma, RequestStatus, TimesheetState, type AttendanceEvent, type AttendanceRecord, type ShiftTemplate, type TimesheetDay } from "@prisma/client";
import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import { z } from "zod";
import { acquireDatabaseLock, executeD1Batch, isD1Database, prisma, queryD1First } from "../services/prisma.js";
import { validateLocation, validateWorksiteLocations, type Location, type LocationValidation } from "../services/geofence.js";
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

type D1ActionState = {
  occurredAt: Date;
  duplicate: AttendanceEvent | null;
  latest: Pick<AttendanceEvent, "type" | "workDate"> | null;
  workDate: string | null;
  existingTimesheet: TimesheetDay | null;
  attendance: AttendanceRecord | null;
  events: Array<Pick<AttendanceEvent, "type" | "occurredAt">>;
  shiftTemplate: Pick<ShiftTemplate, "startTime" | "endTime" | "gracePeriodMinutes" | "isOvernight"> | null;
};

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
  actionState: D1ActionState;
};

type AttendancePreflight = {
  employee: ({ id: string; firstName: string; lastName: string; employmentStatus: string; user: { clientId: string | null } } | null);
  pendingValues?: { requestKind?: string; action?: string };
  policy: { overtimeThreshold: number; roundingIncrement: number; maximumShiftMinutes: number; maximumGpsAccuracy: number } | null;
  locationValidation: LocationValidation;
  actionState: D1ActionState;
};

function parseJsonObject(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "string") return value && typeof value === "object" ? value as Record<string, unknown> : undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
}

function parseJsonArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function d1Date(value: unknown): Date | null {
  if (value == null) return null;
  const date = new Date(typeof value === "number" ? value : Number.isFinite(Number(value)) ? Number(value) : String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

function mapD1Event(value: unknown): AttendanceEvent | null {
  const row = parseJsonObject(value);
  const occurredAt = d1Date(row?.occurredAt);
  const createdAt = d1Date(row?.createdAt);
  if (!row || !occurredAt || !createdAt) return null;
  return {
    id: String(row.id), employeeId: String(row.employeeId), clientId: row.clientId == null ? null : String(row.clientId), workDate: String(row.workDate),
    type: String(row.type) as AttendanceEventType, source: String(row.source) as AttendanceEvent["source"], occurredAt,
    worksiteId: row.worksiteId == null ? null : String(row.worksiteId), latitude: row.latitude == null ? null : Number(row.latitude), longitude: row.longitude == null ? null : Number(row.longitude),
    accuracyMeters: row.accuracyMeters == null ? null : Number(row.accuracyMeters), distanceMeters: row.distanceMeters == null ? null : Number(row.distanceMeters),
    acceptedRadiusMeters: row.acceptedRadiusMeters == null ? null : Number(row.acceptedRadiusMeters), idempotencyKey: String(row.idempotencyKey),
    createdByUserId: row.createdByUserId == null ? null : String(row.createdByUserId), deviceDetails: parseJsonObject(row.deviceDetails) as Prisma.JsonValue ?? null, createdAt,
  };
}

function mapD1Timesheet(value: unknown): TimesheetDay | null {
  const row = parseJsonObject(value);
  const createdAt = d1Date(row?.createdAt);
  const updatedAt = d1Date(row?.updatedAt);
  if (!row || !createdAt || !updatedAt) return null;
  return {
    id: String(row.id), employeeId: String(row.employeeId), clientId: row.clientId == null ? null : String(row.clientId), workDate: String(row.workDate), state: String(row.state) as TimesheetState,
    firstClockInAt: d1Date(row.firstClockInAt), lastClockOutAt: d1Date(row.lastClockOutAt), regularMinutes: Number(row.regularMinutes), overtimeMinutes: Number(row.overtimeMinutes),
    breakMinutes: Number(row.breakMinutes), lateMinutes: Number(row.lateMinutes), earlyDepartureMinutes: Number(row.earlyDepartureMinutes), leaveMinutes: Number(row.leaveMinutes),
    paidLeaveMinutes: Number(row.paidLeaveMinutes), unpaidLeaveMinutes: Number(row.unpaidLeaveMinutes), isAbsent: Boolean(row.isAbsent), exceptionCodes: parseJsonArray(row.exceptionCodes).map(String),
    version: Number(row.version), approvedAt: d1Date(row.approvedAt), lockedAt: d1Date(row.lockedAt), createdAt, updatedAt, payPeriodId: row.payPeriodId == null ? null : String(row.payPeriodId),
  };
}

function mapD1Attendance(value: unknown): AttendanceRecord | null {
  const row = parseJsonObject(value);
  const clockInAt = d1Date(row?.clockInAt);
  const createdAt = d1Date(row?.createdAt);
  const updatedAt = d1Date(row?.updatedAt);
  if (!row || !clockInAt || !createdAt || !updatedAt) return null;
  return {
    id: String(row.id), employeeId: String(row.employeeId), workDate: String(row.workDate), clockInAt, clockOutAt: d1Date(row.clockOutAt),
    clockInLatitude: row.clockInLatitude == null ? null : Number(row.clockInLatitude), clockInLongitude: row.clockInLongitude == null ? null : Number(row.clockInLongitude),
    clockInAccuracy: row.clockInAccuracy == null ? null : Number(row.clockInAccuracy), clockOutLatitude: row.clockOutLatitude == null ? null : Number(row.clockOutLatitude),
    clockOutLongitude: row.clockOutLongitude == null ? null : Number(row.clockOutLongitude), clockOutAccuracy: row.clockOutAccuracy == null ? null : Number(row.clockOutAccuracy),
    status: String(row.status) as AttendanceStatus, createdAt, updatedAt,
  };
}

async function loadD1AttendancePreflight(userId: string, requestedType: AttendanceEventType, input: { location: Location; idempotencyKey: string }): Promise<AttendancePreflight> {
  const occurredAt = new Date();
  const today = attendanceDate(occurredAt);
  const row = await queryD1First(`WITH employee_row AS (
    SELECT e."id", e."firstName", e."lastName", e."employmentStatus", u."clientId"
    FROM "Employee" e INNER JOIN "User" u ON u."id" = e."userId" WHERE e."userId" = ? LIMIT 1
  ), duplicate_event AS (
    SELECT ae.* FROM "AttendanceEvent" ae INNER JOIN employee_row er ON er."id" = ae."employeeId" WHERE ae."idempotencyKey" = ? LIMIT 1
  ), latest_event AS (
    SELECT ae."type", ae."workDate" FROM "AttendanceEvent" ae INNER JOIN employee_row er ON er."id" = ae."employeeId" ORDER BY ae."occurredAt" DESC, ae."createdAt" DESC LIMIT 1
  ), target AS (
    SELECT CASE WHEN d."workDate" IS NOT NULL THEN d."workDate" WHEN ? = 'CLOCK_IN' THEN ? ELSE l."workDate" END AS "workDate"
    FROM employee_row er LEFT JOIN duplicate_event d ON 1 = 1 LEFT JOIN latest_event l ON 1 = 1
  )
  SELECT er.*, p."overtimeThreshold", p."roundingIncrement", p."maximumShiftMinutes", p."maximumGpsAccuracy",
    (SELECT c."requestedValues" FROM "AttendanceCorrection" c WHERE c."employeeId" = er."id" AND c."status" = 'PENDING' ORDER BY c."createdAt" DESC LIMIT 1) AS "pendingValues",
    (SELECT json_group_array(json_object('id', w."id", 'name', w."name", 'latitude', w."latitude", 'longitude', w."longitude", 'radiusMeters', w."radiusMeters")) FROM "Worksite" w WHERE w."clientId" = er."clientId" AND w."isActive" = 1) AS "worksites",
    (SELECT json_object('id', d."id", 'employeeId', d."employeeId", 'clientId', d."clientId", 'workDate', d."workDate", 'type', d."type", 'source', d."source", 'occurredAt', d."occurredAt", 'worksiteId', d."worksiteId", 'latitude', d."latitude", 'longitude', d."longitude", 'accuracyMeters', d."accuracyMeters", 'distanceMeters', d."distanceMeters", 'acceptedRadiusMeters', d."acceptedRadiusMeters", 'idempotencyKey', d."idempotencyKey", 'createdByUserId', d."createdByUserId", 'deviceDetails', d."deviceDetails", 'createdAt', d."createdAt") FROM duplicate_event d) AS "duplicateEvent",
    (SELECT json_object('type', l."type", 'workDate', l."workDate") FROM latest_event l) AS "latestEvent", target."workDate",
    (SELECT json_object('id', t."id", 'employeeId', t."employeeId", 'clientId', t."clientId", 'workDate', t."workDate", 'state', t."state", 'firstClockInAt', t."firstClockInAt", 'lastClockOutAt', t."lastClockOutAt", 'regularMinutes', t."regularMinutes", 'overtimeMinutes', t."overtimeMinutes", 'breakMinutes', t."breakMinutes", 'lateMinutes', t."lateMinutes", 'earlyDepartureMinutes', t."earlyDepartureMinutes", 'leaveMinutes', t."leaveMinutes", 'paidLeaveMinutes', t."paidLeaveMinutes", 'unpaidLeaveMinutes', t."unpaidLeaveMinutes", 'isAbsent', t."isAbsent", 'exceptionCodes', t."exceptionCodes", 'version', t."version", 'approvedAt', t."approvedAt", 'lockedAt', t."lockedAt", 'createdAt', t."createdAt", 'updatedAt', t."updatedAt", 'payPeriodId', t."payPeriodId") FROM "TimesheetDay" t WHERE t."employeeId" = er."id" AND t."workDate" = target."workDate" LIMIT 1) AS "existingTimesheet",
    (SELECT json_object('id', a."id", 'employeeId', a."employeeId", 'workDate', a."workDate", 'clockInAt', a."clockInAt", 'clockOutAt', a."clockOutAt", 'clockInLatitude', a."clockInLatitude", 'clockInLongitude', a."clockInLongitude", 'clockInAccuracy', a."clockInAccuracy", 'clockOutLatitude', a."clockOutLatitude", 'clockOutLongitude', a."clockOutLongitude", 'clockOutAccuracy', a."clockOutAccuracy", 'status', a."status", 'createdAt', a."createdAt", 'updatedAt', a."updatedAt") FROM "AttendanceRecord" a WHERE a."employeeId" = er."id" AND a."workDate" = target."workDate" LIMIT 1) AS "attendance",
    (SELECT json_group_array(json_object('type', ordered."type", 'occurredAt', ordered."occurredAt")) FROM (SELECT ae."type", ae."occurredAt" FROM "AttendanceEvent" ae WHERE ae."employeeId" = er."id" AND ae."workDate" = target."workDate" ORDER BY ae."occurredAt", ae."createdAt") ordered) AS "events",
    (SELECT json_object('startTime', st."startTime", 'endTime', st."endTime", 'gracePeriodMinutes', st."gracePeriodMinutes", 'isOvernight', st."isOvernight") FROM "ScheduleAssignment" sa INNER JOIN "ShiftTemplate" st ON st."id" = sa."shiftTemplateId" WHERE sa."employeeId" = er."id" AND sa."effectiveFrom" <= target."workDate" AND (sa."effectiveTo" IS NULL OR sa."effectiveTo" >= target."workDate") ORDER BY sa."effectiveFrom" DESC LIMIT 1) AS "shiftTemplate"
  FROM employee_row er LEFT JOIN "WorkPolicy" p ON p."clientId" = er."clientId" CROSS JOIN target`, [userId, input.idempotencyKey, requestedType, today]);
  const employee = row ? {
    id: String(row.id),
    firstName: String(row.firstName),
    lastName: String(row.lastName),
    employmentStatus: String(row.employmentStatus),
    user: { clientId: row.clientId == null ? null : String(row.clientId) },
  } : null;
  const policy = row?.overtimeThreshold == null ? null : {
    overtimeThreshold: Number(row.overtimeThreshold),
    roundingIncrement: Number(row.roundingIncrement),
    maximumShiftMinutes: Number(row.maximumShiftMinutes),
    maximumGpsAccuracy: Number(row.maximumGpsAccuracy),
  };
  const pending = parseJsonObject(row?.pendingValues);
  const latest = parseJsonObject(row?.latestEvent);
  const shift = parseJsonObject(row?.shiftTemplate);
  const events = parseJsonArray(row?.events).flatMap((value) => {
    const event = parseJsonObject(value);
    const occurredAt = d1Date(event?.occurredAt);
    return event && occurredAt ? [{ type: String(event.type) as AttendanceEventType, occurredAt }] : [];
  });
  const worksites = parseJsonArray(row?.worksites).flatMap((value) => {
    const worksite = parseJsonObject(value);
    return worksite ? [{ id: String(worksite.id), name: String(worksite.name), latitude: Number(worksite.latitude), longitude: Number(worksite.longitude), radiusMeters: Number(worksite.radiusMeters) }] : [];
  });
  return {
    employee,
    pendingValues: pending as AttendancePreflight["pendingValues"],
    policy,
    locationValidation: validateWorksiteLocations(worksites, input.location),
    actionState: {
      occurredAt,
      duplicate: mapD1Event(row?.duplicateEvent),
      latest: latest ? { type: String(latest.type) as AttendanceEventType, workDate: String(latest.workDate) } : null,
      workDate: row?.workDate == null ? null : String(row.workDate),
      existingTimesheet: mapD1Timesheet(row?.existingTimesheet),
      attendance: mapD1Attendance(row?.attendance),
      events,
      shiftTemplate: shift ? { startTime: String(shift.startTime), endTime: String(shift.endTime), gracePeriodMinutes: Number(shift.gracePeriodMinutes), isOvernight: Boolean(shift.isOvernight) } : null,
    },
  };
}

async function applyAttendanceActionOnD1(args: D1AttendanceActionInput) {
  const { employee, clientId, requestedType, input, acceptedWorksite, policy, actorUserId, requestId, ipAddress, userAgent, actionState } = args;
  const { duplicate, latest, existingTimesheet, attendance, events, shiftTemplate } = actionState;
  if (duplicate) {
    return { event: duplicate, timesheet: existingTimesheet, attendance, replayed: true, webhookDeliveryId: null };
  }

  if (!transitionAllowed(latest?.type, requestedType)) throw new AttendanceActionError(409, "INVALID_ATTENDANCE_TRANSITION", transitionMessages[requestedType]);

  const now = actionState.occurredAt;
  const workDate = actionState.workDate;
  if (!workDate) throw new AttendanceActionError(409, "INVALID_ATTENDANCE_TRANSITION", transitionMessages[requestedType]);
  if (existingTimesheet?.state === TimesheetState.LOCKED) throw new AttendanceActionError(409, "TIMESHEET_LOCKED", "This timesheet is locked and cannot accept new events");

  const calculation = calculateTimesheet([...events, { type: requestedType, occurredAt: now }], {
    regularDayMinutes: policy?.overtimeThreshold ?? 480,
    roundingIncrement: policy?.roundingIncrement ?? 1,
    maximumShiftMinutes: policy?.maximumShiftMinutes,
  });
  const scheduleMetrics = calculateScheduleMetrics(workDate, calculation.firstClockInAt, calculation.lastClockOutAt, shiftTemplate);
  const scheduleExceptions = applyScheduleExceptions(calculation, scheduleMetrics);
  const eventId = randomUUID();
  const attendanceId = attendance?.id ?? randomUUID();
  const timesheetId = existingTimesheet?.id ?? randomUUID();
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
      values: [attendanceId, employee.id, workDate, nowMs, input.location.latitude, input.location.longitude, input.location.accuracy, nowMs, nowMs],
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
      values: [timesheetId, employee.id, clientId, workDate, scheduleExceptions.state, calculation.firstClockInAt?.getTime() ?? null, calculation.lastClockOutAt?.getTime() ?? null, calculation.regularMinutes, calculation.overtimeMinutes, calculation.breakMinutes, scheduleMetrics.lateMinutes, scheduleMetrics.earlyDepartureMinutes, JSON.stringify(scheduleExceptions.exceptionCodes), nowMs, nowMs],
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
  const event = {
    id: eventId,
    employeeId: employee.id,
    clientId,
    workDate,
    type: requestedType,
    source: "MOBILE_GPS" as const,
    occurredAt: now,
    worksiteId: acceptedWorksite.id,
    latitude: input.location.latitude,
    longitude: input.location.longitude,
    accuracyMeters: input.location.accuracy,
    distanceMeters: acceptedWorksite.distanceMeters,
    acceptedRadiusMeters: acceptedWorksite.radiusMeters,
    idempotencyKey: input.idempotencyKey,
    createdByUserId: actorUserId,
    deviceDetails: { userAgent },
    createdAt: now,
  };
  const timesheet = {
    ...existingTimesheet,
    id: timesheetId,
    employeeId: employee.id,
    clientId,
    workDate,
    state: scheduleExceptions.state,
    firstClockInAt: calculation.firstClockInAt,
    lastClockOutAt: calculation.lastClockOutAt,
    regularMinutes: calculation.regularMinutes,
    overtimeMinutes: calculation.overtimeMinutes,
    breakMinutes: calculation.breakMinutes,
    lateMinutes: scheduleMetrics.lateMinutes,
    earlyDepartureMinutes: scheduleMetrics.earlyDepartureMinutes,
    leaveMinutes: existingTimesheet?.leaveMinutes ?? 0,
    paidLeaveMinutes: existingTimesheet?.paidLeaveMinutes ?? 0,
    unpaidLeaveMinutes: existingTimesheet?.unpaidLeaveMinutes ?? 0,
    isAbsent: existingTimesheet?.isAbsent ?? false,
    exceptionCodes: scheduleExceptions.exceptionCodes,
    version: existingTimesheet ? existingTimesheet.version + 1 : 1,
    approvedAt: existingTimesheet?.approvedAt ?? null,
    lockedAt: existingTimesheet?.lockedAt ?? null,
    createdAt: existingTimesheet?.createdAt ?? now,
    updatedAt: now,
    payPeriodId: existingTimesheet?.payPeriodId ?? null,
  };
  const storedAttendance = requestedType === AttendanceEventType.CLOCK_IN
    ? attendance
      ? { ...attendance, clockOutAt: null, clockOutLatitude: null, clockOutLongitude: null, clockOutAccuracy: null, status: AttendanceStatus.CLOCKED_IN, updatedAt: now }
      : { id: attendanceId, employeeId: employee.id, workDate, clockInAt: now, clockOutAt: null, clockInLatitude: input.location.latitude, clockInLongitude: input.location.longitude, clockInAccuracy: input.location.accuracy, clockOutLatitude: null, clockOutLongitude: null, clockOutAccuracy: null, status: AttendanceStatus.CLOCKED_IN, createdAt: now, updatedAt: now }
    : requestedType === AttendanceEventType.CLOCK_OUT && attendance
      ? { ...attendance, clockOutAt: now, clockOutLatitude: input.location.latitude, clockOutLongitude: input.location.longitude, clockOutAccuracy: input.location.accuracy, status: AttendanceStatus.CLOCKED_OUT, updatedAt: now }
      : attendance;
  return { event, timesheet, attendance: storedAttendance, replayed: false, webhookDeliveryId };
}

async function performAction(request: Request, response: Response, requestedType: AttendanceEventType): Promise<void> {
  const input = actionInput(request, response);
  if (!input) return;

  const d1Preflight = isD1Database() ? await loadD1AttendancePreflight(response.locals.auth.sub, requestedType, input) : null;
  const employee = d1Preflight?.employee ?? await prisma.employee.findUnique({
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

  const [pendingCorrection, policy, locationValidation] = d1Preflight
    ? [null, d1Preflight.policy, d1Preflight.locationValidation] as const
    : await Promise.all([
        prisma.attendanceCorrection.findFirst({ where: { employeeId: employee.id, status: RequestStatus.PENDING }, select: { requestedValues: true }, orderBy: { createdAt: "desc" } }),
        prisma.workPolicy.findUnique({ where: { clientId } }),
        validateLocation(clientId, input.location),
      ]);
  const pendingValues = d1Preflight?.pendingValues ?? pendingCorrection?.requestedValues as { requestKind?: string; action?: string } | undefined;
  if (pendingValues?.requestKind === "GPS_CLOCK_EXCEPTION" && pendingValues.action === requestedType) {
    response.status(409).json({ error: { code: "CLOCK_EXCEPTION_PENDING", message: "A GPS clock request for this action is awaiting administrator review" }, requestId: response.locals.requestId });
    return;
  }

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
      actionState: d1Preflight!.actionState,
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
