import { AttendanceEventType, type Prisma } from "@prisma/client";
import { env } from "../config/env.js";
import type { Location, LocationValidation } from "./geofence.js";
import { calculateTimesheet } from "./timesheet-calculator.js";
import { webhookPayload } from "./webhook-queue.js";

type LegacyEventInput = { attendanceId: string; employeeId: string; employeeName: string; clientId: string; workDate: string; type: AttendanceEventType; occurredAt: Date; location: Location; validation: LocationValidation; actorUserId: string };

export async function recordLegacyAttendanceEvent(transaction: Prisma.TransactionClient, input: LegacyEventInput): Promise<string | null> {
  const worksite = input.validation.worksite;
  if (!worksite) return null;
  const eventName = input.type === AttendanceEventType.CLOCK_IN ? "attendance.clock_in" : "attendance.clock_out";
  const event = await transaction.attendanceEvent.upsert({
    where: { employeeId_idempotencyKey: { employeeId: input.employeeId, idempotencyKey: `v1-${input.attendanceId}-${input.type.toLowerCase()}` } },
    create: { employeeId: input.employeeId, clientId: input.clientId, workDate: input.workDate, type: input.type, occurredAt: input.occurredAt, worksiteId: worksite.id, latitude: input.location.latitude, longitude: input.location.longitude, accuracyMeters: input.location.accuracy, distanceMeters: worksite.distanceMeters, acceptedRadiusMeters: worksite.radiusMeters, idempotencyKey: `v1-${input.attendanceId}-${input.type.toLowerCase()}`, createdByUserId: input.actorUserId, deviceDetails: { legacyApi: true } },
    update: {},
  });
  const events = await transaction.attendanceEvent.findMany({ where: { employeeId: input.employeeId, workDate: input.workDate }, orderBy: [{ occurredAt: "asc" }, { createdAt: "asc" }] });
  const policy = await transaction.workPolicy.findUnique({ where: { clientId: input.clientId } });
  const calculation = calculateTimesheet(events, { regularDayMinutes: policy?.overtimeThreshold ?? 480, roundingIncrement: policy?.roundingIncrement ?? 1, maximumShiftMinutes: policy?.maximumShiftMinutes });
  await transaction.timesheetDay.upsert({ where: { employeeId_workDate: { employeeId: input.employeeId, workDate: input.workDate } }, create: { employeeId: input.employeeId, clientId: input.clientId, workDate: input.workDate, ...calculation }, update: { ...calculation, version: { increment: 1 } } });
  const delivery = env.WEBHOOK_URL ? await transaction.webhookDelivery.upsert({ where: { attendanceEventId: event.id }, create: { clientId: input.clientId, attendanceEventId: event.id, eventType: eventName, payload: webhookPayload({ event: eventName, eventId: event.id, employeeId: input.employeeId, employeeName: input.employeeName, workDate: input.workDate, timestamp: input.occurredAt.toISOString(), location: input.location }) }, update: {}, select: { id: true } }) : null;
  return delivery?.id ?? null;
}
