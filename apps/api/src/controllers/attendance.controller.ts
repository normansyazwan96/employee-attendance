import { AttendanceStatus, Prisma } from "@prisma/client";
import type { Request, Response } from "express";
import { prisma } from "../services/prisma.js";
import { validateLocation, type Location } from "../services/geofence.js";
import { z } from "zod";
import { attendanceDate } from "../utils/attendance-date.js";
import { calculateAttendanceHours, classifyAttendance } from "../services/attendance-rules.js";
import { sendAttendanceWebhook } from "../services/webhook.js";

async function currentEmployee(userId: string) {
  return prisma.employee.findUnique({ where: { userId }, include: { user: { select: { clientId: true } }, schedule: true } });
}

const locationSchema = z.object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180), accuracy: z.number().nonnegative().max(10_000) });

function requestLocation(request: Request, response: Response): Location | null {
  const parsed = locationSchema.safeParse(request.body?.location);
  if (!parsed.success) { response.status(400).json({ error: "A valid GPS location is required" }); return null; }
  return parsed.data;
}

async function validatedLocation(clientId: string | null, location: Location, response: Response): Promise<boolean> {
  const validation = await validateLocation(clientId, location);
  if (!validation.valid) { response.status(403).json({ error: validation.reason, location: validation }); return false; }
  return true;
}

export async function getTodayAttendance(_request: Request, response: Response): Promise<void> {
  const employee = await currentEmployee(response.locals.auth.sub);
  if (!employee) { response.status(403).json({ error: "An employee account is required" }); return; }
  const attendance = await prisma.attendanceRecord.findUnique({ where: { employeeId_workDate: { employeeId: employee.id, workDate: attendanceDate() } } });
  response.json({ attendance: attendance ? { ...attendance, ...calculateAttendanceHours(attendance), scheduleStatus: classifyAttendance(attendance, employee.schedule) } : null });
}

export async function getAttendanceHistory(_request: Request, response: Response): Promise<void> {
  const employee = await currentEmployee(response.locals.auth.sub);
  if (!employee) { response.status(403).json({ error: "An employee account is required" }); return; }
  const attendance = await prisma.attendanceRecord.findMany({ where: { employeeId: employee.id }, orderBy: [{ workDate: "desc" }, { clockInAt: "desc" }], take: 30 });
  response.json({ attendance: attendance.map((record) => ({ ...record, ...calculateAttendanceHours(record), scheduleStatus: classifyAttendance(record, employee.schedule) })) });
}

export async function clockIn(_request: Request, response: Response): Promise<void> {
  const location = requestLocation(_request, response);
  if (!location) return;
  const employee = await currentEmployee(response.locals.auth.sub);
  if (!employee) { response.status(403).json({ error: "An employee account is required" }); return; }
  if (!(await validatedLocation(employee.user.clientId, location, response))) return;
  const workDate = attendanceDate();
  const existing = await prisma.attendanceRecord.findUnique({ where: { employeeId_workDate: { employeeId: employee.id, workDate } } });
  if (existing) { response.status(409).json({ error: "You have already clocked in today" }); return; }
  try {
    const attendance = await prisma.attendanceRecord.create({ data: { employeeId: employee.id, workDate, clockInAt: new Date(), clockInLatitude: location.latitude, clockInLongitude: location.longitude, clockInAccuracy: location.accuracy } });
    await sendAttendanceWebhook({
      event: "attendance.clock_in",
      employeeId: employee.id,
      employeeName: `${employee.firstName} ${employee.lastName}`,
      workDate,
      timestamp: new Date().toISOString(),
      location,
    }, {
      url: process.env.WEBHOOK_URL,
      secret: process.env.WEBHOOK_SECRET,
    }).catch((error: unknown) => {
      console.warn("Attendance clock-in webhook failed:", error instanceof Error ? error.message : error);
    });
    response.status(201).json({ attendance });
  } catch (error: unknown) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") { response.status(409).json({ error: "You have already clocked in today" }); return; }
    throw error;
  }
}

export async function clockOut(_request: Request, response: Response): Promise<void> {
  const location = requestLocation(_request, response);
  if (!location) return;
  const employee = await currentEmployee(response.locals.auth.sub);
  if (!employee) { response.status(403).json({ error: "An employee account is required" }); return; }
  if (!(await validatedLocation(employee.user.clientId, location, response))) return;
  const attendance = await prisma.attendanceRecord.findUnique({ where: { employeeId_workDate: { employeeId: employee.id, workDate: attendanceDate() } } });
  if (!attendance) { response.status(400).json({ error: "Clock in before clocking out" }); return; }
  if (attendance.clockOutAt) { response.status(409).json({ error: "You have already clocked out today" }); return; }
  const updatedRecord = await prisma.attendanceRecord.updateMany({ where: { id: attendance.id, clockOutAt: null }, data: { clockOutAt: new Date(), clockOutLatitude: location.latitude, clockOutLongitude: location.longitude, clockOutAccuracy: location.accuracy, status: AttendanceStatus.CLOCKED_OUT } });
  if (updatedRecord.count === 0) { response.status(409).json({ error: "You have already clocked out today" }); return; }
  const updated = await prisma.attendanceRecord.findUniqueOrThrow({ where: { id: attendance.id } });
  await sendAttendanceWebhook({
    event: "attendance.clock_out",
    employeeId: employee.id,
    employeeName: `${employee.firstName} ${employee.lastName}`,
    workDate: attendance.workDate,
    timestamp: new Date().toISOString(),
    location,
  }, {
    url: process.env.WEBHOOK_URL,
    secret: process.env.WEBHOOK_SECRET,
  }).catch((error: unknown) => {
    console.warn("Attendance clock-out webhook failed:", error instanceof Error ? error.message : error);
  });
  response.json({ attendance: updated });
}

export async function getLocationStatus(request: Request, response: Response): Promise<void> {
  const location = requestLocation(request, response);
  if (!location) return;
  const employee = await currentEmployee(response.locals.auth.sub);
  if (!employee) { response.status(403).json({ error: "An employee account is required" }); return; }
  const validation = await validateLocation(employee.user.clientId, location);
  response.json({ location: validation });
}
