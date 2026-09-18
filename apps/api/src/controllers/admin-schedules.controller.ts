import { Role } from "@prisma/client";
import type { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../services/prisma.js";
import { recordAudit } from "../services/audit.js";
import { getAdminContext } from "../services/admin-scope.js";

const scheduleSchema = z.object({
  employeeId: z.string().min(1),
  workDays: z.array(z.number().int().min(0).max(6)).min(1).max(7),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  gracePeriodMinutes: z.number().int().min(0).max(180),
  isActive: z.boolean(),
});

const view = (schedule: { id: string; employeeId: string; workDays: number[]; startTime: string; endTime: string; gracePeriodMinutes: number; isActive: boolean; employee: { firstName: string; lastName: string; user: { email: string; clientId: string | null } } }) => ({ id: schedule.id, employeeId: schedule.employeeId, employee: { name: `${schedule.employee.firstName} ${schedule.employee.lastName}`, email: schedule.employee.user.email }, clientId: schedule.employee.user.clientId, workDays: schedule.workDays, startTime: schedule.startTime, endTime: schedule.endTime, gracePeriodMinutes: schedule.gracePeriodMinutes, isActive: schedule.isActive });

const include = { employee: { include: { user: { select: { email: true, clientId: true } } } } } as const;

export async function getAdminSchedules(_request: Request, response: Response): Promise<void> {
  const context = await getAdminContext(response);
  if (!context) { response.status(401).json({ error: "A client account is required" }); return; }
  const schedules = await prisma.employeeSchedule.findMany({ where: context.auth.role === Role.DEV_ADMIN ? undefined : { employee: { user: context.employeeUserWhere } }, include, orderBy: [{ isActive: "desc" }, { startTime: "asc" }] });
  response.json({ schedules: schedules.map(view) });
}

export async function upsertAdminSchedule(request: Request, response: Response): Promise<void> {
  const context = await getAdminContext(response);
  if (!context) { response.status(401).json({ error: "A client account is required" }); return; }
  const parsed = scheduleSchema.safeParse(request.body);
  if (!parsed.success) { response.status(400).json({ error: "Enter an employee, workdays, valid times, and a grace period" }); return; }
  const employee = await prisma.employee.findFirst({ where: { id: parsed.data.employeeId, user: context.employeeUserWhere }, select: { id: true, user: { select: { clientId: true } } } });
  if (!employee) { response.status(404).json({ error: "Employee not found" }); return; }
  const { employeeId, ...data } = parsed.data;
  const schedule = await prisma.employeeSchedule.upsert({ where: { employeeId }, create: { employeeId, ...data }, update: data, include });
  await recordAudit({ actorUserId: response.locals.auth.sub, clientId: employee.user.clientId ?? undefined, action: "UPSERT", entityType: "EmployeeSchedule", entityId: schedule.id, details: data });
  response.json({ schedule: view(schedule) });
}
