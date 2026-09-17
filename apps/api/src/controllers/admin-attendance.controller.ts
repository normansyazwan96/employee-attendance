import { Role } from "@prisma/client";
import type { Request, Response } from "express";
import { prisma } from "../services/prisma.js";
import { calculateAttendanceHours, classifyAttendance } from "../services/attendance-rules.js";
import { z } from "zod";

const querySchema = z.object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25) });
const exportQuerySchema = querySchema.pick({ from: true, to: true });

async function attendanceScope(response: Response, query: { from?: string; to?: string }) {
  const parsed = exportQuerySchema.safeParse(query);
  if (!parsed.success || (parsed.data.from && parsed.data.to && parsed.data.from > parsed.data.to)) { response.status(400).json({ error: "Use valid date filters" }); return null; }
  const auth = response.locals.auth as { sub: string; role: Role };
  const user = await prisma.user.findUnique({ where: { id: auth.sub }, select: { clientId: true } });
  if (!user) { response.status(401).json({ error: "Authentication is required" }); return null; }
  const scope = auth.role === Role.DEV_ADMIN ? {} : { employee: { user: { clientId: user.clientId } } };
  return { parsed: parsed.data, where: { ...scope, ...(parsed.data.from || parsed.data.to ? { workDate: { ...(parsed.data.from ? { gte: parsed.data.from } : {}), ...(parsed.data.to ? { lte: parsed.data.to } : {}) } } : {}) } };
}

export async function getAdminAttendance(request: Request, response: Response): Promise<void> {
  const parsed = querySchema.safeParse(request.query);
  if (!parsed.success || (parsed.data.from && parsed.data.to && parsed.data.from > parsed.data.to)) { response.status(400).json({ error: "Use valid date filters" }); return; }
  const auth = response.locals.auth as { sub: string; role: Role };
  const user = await prisma.user.findUnique({ where: { id: auth.sub }, select: { clientId: true } });
  if (!user) { response.status(401).json({ error: "Authentication is required" }); return; }
  const scope = auth.role === Role.DEV_ADMIN ? {} : { employee: { user: { clientId: user.clientId } } };
  const where = { ...scope, ...(parsed.data.from || parsed.data.to ? { workDate: { ...(parsed.data.from ? { gte: parsed.data.from } : {}), ...(parsed.data.to ? { lte: parsed.data.to } : {}) } } : {}) };
  const [attendance, total] = await Promise.all([prisma.attendanceRecord.findMany({
    where,
    include: { employee: { include: { user: { select: { email: true } }, schedule: true } } },
    orderBy: [{ workDate: "desc" }, { clockInAt: "desc" }],
    skip: (parsed.data.page - 1) * parsed.data.pageSize,
    take: parsed.data.pageSize,
  }), prisma.attendanceRecord.count({ where })]);
  response.json({ attendance: attendance.map((record) => {
    const { totalWorkingHours, overtimeHours } = calculateAttendanceHours(record);
    return {
      id: record.id,
      workDate: record.workDate,
      clockInAt: record.clockInAt,
      clockOutAt: record.clockOutAt,
      totalWorkingHours,
      overtimeHours,
      status: record.status,
      scheduleStatus: classifyAttendance(record, record.employee.schedule),
      employee: { id: record.employee.id, name: `${record.employee.firstName} ${record.employee.lastName}`, email: record.employee.user.email },
    };
  }), pagination: { page: parsed.data.page, pageSize: parsed.data.pageSize, total, totalPages: Math.ceil(total / parsed.data.pageSize) } });
}

const csv = (value: string | null): string => `"${(value ?? "").replaceAll("\"", "\"\"")}"`;

export async function exportAdminAttendance(request: Request, response: Response): Promise<void> {
  const scoped = await attendanceScope(response, request.query);
  if (!scoped) return;
  const records = await prisma.attendanceRecord.findMany({ where: scoped.where, include: { employee: { include: { user: { select: { email: true } }, schedule: true } } }, orderBy: [{ workDate: "desc" }, { clockInAt: "desc" }] });
  const rows = ["Employee,Email,Work date,Clock in,Clock out,Total working hours,Overtime,Attendance status,Schedule status", ...records.map((record) => {
    const { totalWorkingHours, overtimeHours } = calculateAttendanceHours(record);
    return [record.employee.firstName + " " + record.employee.lastName, record.employee.user.email, record.workDate, record.clockInAt.toISOString(), record.clockOutAt?.toISOString() ?? "", totalWorkingHours.toString(), overtimeHours.toString(), record.status, classifyAttendance(record, record.employee.schedule)].map(csv).join(",");
  })];
  response.type("text/csv").attachment("attendance-export.csv").send(rows.join("\r\n"));
}
