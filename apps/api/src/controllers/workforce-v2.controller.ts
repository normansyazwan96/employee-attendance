import { MembershipRole, MembershipStatus, Prisma, Role, type ScheduleAssignment } from "@prisma/client";
import type { Request, Response } from "express";
import { z } from "zod";
import { getAdminContext } from "../services/admin-scope.js";
import { prisma } from "../services/prisma.js";
import { recordAudit } from "../services/audit.js";
import { hashPassword } from "../utils/password.js";
import Holidays from "date-holidays";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const cursorSchema = z.object({ cursor: z.string().optional(), limit: z.coerce.number().int().min(1).max(100).default(50) });
const timesheetQuerySchema = cursorSchema.extend({ from: date.optional(), to: date.optional() });
const departmentSchema = z.object({ name: z.string().trim().min(1).max(120), code: z.string().trim().min(1).max(20).transform((value) => value.toUpperCase()).nullable().optional(), isActive: z.boolean().default(true) });
const shiftSchema = z.object({ name: z.string().trim().min(1).max(120), workDays: z.array(z.number().int().min(0).max(6)).min(1).max(7), startTime: time, endTime: time, breakMinutes: z.number().int().min(0).max(480), gracePeriodMinutes: z.number().int().min(0).max(180), isActive: z.boolean().default(true) });
const assignmentSchema = z.object({ employeeId: z.string().min(1), shiftTemplateId: z.string().min(1), effectiveFrom: date, effectiveTo: date.nullable().optional() });
const policySchema = z.object({ gracePeriodMinutes: z.number().int().min(0).max(180), defaultBreakMinutes: z.number().int().min(0).max(480), roundingIncrement: z.number().int().min(1).max(60), overtimeThreshold: z.number().int().min(1).max(1_440), maximumShiftMinutes: z.number().int().min(60).max(2_880), missedClockOutMinutes: z.number().int().min(60).max(2_880), maximumGpsAccuracy: z.number().int().min(10).max(10_000), exactGpsRetentionDays: z.number().int().min(1).max(365) });
const holidaySchema = z.object({ date, name: z.string().trim().min(1).max(160), stateCode: z.string().trim().min(1).max(10).transform((value) => value.toUpperCase()).nullable().optional(), isWorkingDayOverride: z.boolean().default(false) });
const managerSchema = z.object({ username: z.string().trim().min(3).max(40).regex(/^[a-zA-Z0-9._-]+$/).transform((value) => value.toLowerCase()), displayName: z.string().trim().min(1).max(120), password: z.string().min(8).max(128) });
const managerReportsSchema = z.object({ employeeIds: z.array(z.string().min(1)).max(100) });
const managerStatusSchema = z.object({ isActive: z.boolean() });
const employeeDetailsSchema = z.object({ employeeNumber: z.string().trim().min(1).max(40).nullable().optional(), employmentStatus: z.enum(["ACTIVE", "ON_LEAVE", "TERMINATED"]), joinDate: z.string().datetime().nullable().optional(), terminationDate: z.string().datetime().nullable().optional(), departmentId: z.string().min(1).nullable().optional() });
const holidayImportSchema = z.object({ year: z.number().int().min(2020).max(2100), stateCode: z.string().regex(/^\d{2}$/) });

function v2Error(response: Response, status: number, code: string, message: string): void {
  response.status(status).json({ error: { code, message }, requestId: response.locals.requestId });
}

function previousIsoDate(value: string): string {
  const dateValue = new Date(`${value}T00:00:00.000Z`);
  dateValue.setUTCDate(dateValue.getUTCDate() - 1);
  return dateValue.toISOString().slice(0, 10);
}

async function organizationScope(request: Request, response: Response, required: boolean): Promise<{ clientId?: string; employeeUserWhere: Prisma.UserWhereInput } | null> {
  const context = await getAdminContext(response);
  if (!context) { v2Error(response, 403, "ORGANIZATION_ACCESS_REQUIRED", "An active administrator membership is required"); return null; }
  if (context.clientId) return { clientId: context.clientId, employeeUserWhere: context.employeeUserWhere };
  const requested = request.header("x-organization-id")?.trim();
  if (!requested) {
    if (required) { v2Error(response, 400, "ORGANIZATION_REQUIRED", "Select an organization for this action"); return null; }
    return { employeeUserWhere: context.employeeUserWhere };
  }
  const exists = await prisma.client.findUnique({ where: { id: requested }, select: { id: true } });
  if (!exists) { v2Error(response, 404, "ORGANIZATION_NOT_FOUND", "Organization not found"); return null; }
  return { clientId: requested, employeeUserWhere: { role: Role.EMPLOYEE, clientId: requested } };
}

export async function listDepartmentsV2(request: Request, response: Response): Promise<void> {
  const scope = await organizationScope(request, response, false); if (!scope) return;
  const query = cursorSchema.parse(request.query);
  const data = await prisma.department.findMany({ where: scope.clientId ? { clientId: scope.clientId } : undefined, orderBy: { id: "asc" }, take: query.limit + 1, ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}) });
  const nextCursor = data.length > query.limit ? data[query.limit - 1]?.id ?? null : null;
  response.json({ data: data.slice(0, query.limit), nextCursor });
}

export async function createDepartmentV2(request: Request, response: Response): Promise<void> {
  const scope = await organizationScope(request, response, true); if (!scope?.clientId) return;
  const parsed = departmentSchema.safeParse(request.body); if (!parsed.success) { v2Error(response, 400, "INVALID_DEPARTMENT", "Enter valid department details"); return; }
  try {
    const department = await prisma.department.create({ data: { clientId: scope.clientId, ...parsed.data } });
    await recordAudit({ actorUserId: response.locals.auth.sub, clientId: scope.clientId, action: "CREATE", entityType: "Department", entityId: department.id, details: parsed.data, requestId: response.locals.requestId, ipAddress: request.ip });
    response.status(201).json({ data: department });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") { v2Error(response, 409, "DEPARTMENT_EXISTS", "A department with this name or code already exists"); return; }
    throw error;
  }
}

export async function listWorkforceEmployeesV2(request: Request, response: Response): Promise<void> {
  const scope = await organizationScope(request, response, true); if (!scope?.clientId) return;
  const data = await prisma.employee.findMany({ where: { user: scope.employeeUserWhere }, include: { user: { select: { id: true, username: true, isActive: true } }, department: true }, orderBy: [{ lastName: "asc" }, { firstName: "asc" }] });
  response.json({ data });
}

export async function listWorkforceTimesheetsV2(request: Request, response: Response): Promise<void> {
  const scope = await organizationScope(request, response, true); if (!scope?.clientId) return;
  const parsed = timesheetQuerySchema.safeParse(request.query);
  if (!parsed.success || (parsed.data.from && parsed.data.to && parsed.data.from > parsed.data.to)) { v2Error(response, 400, "INVALID_DATE_RANGE", "Choose a valid timesheet date range"); return; }
  const data = await prisma.timesheetDay.findMany({
    where: { clientId: scope.clientId, employee: { user: scope.employeeUserWhere }, ...(parsed.data.from || parsed.data.to ? { workDate: { ...(parsed.data.from ? { gte: parsed.data.from } : {}), ...(parsed.data.to ? { lte: parsed.data.to } : {}) } } : {}) },
    include: { employee: { select: { firstName: true, lastName: true, employeeNumber: true, user: { select: { username: true } } } } },
    orderBy: [{ workDate: "desc" }, { id: "desc" }],
    take: parsed.data.limit + 1,
    ...(parsed.data.cursor ? { cursor: { id: parsed.data.cursor }, skip: 1 } : {}),
  });
  const hasMore = data.length > parsed.data.limit;
  if (hasMore) data.pop();
  response.json({ data, nextCursor: hasMore ? data.at(-1)?.id ?? null : null });
}

export async function updateWorkforceEmployeeV2(request: Request, response: Response): Promise<void> {
  const scope = await organizationScope(request, response, true); if (!scope?.clientId) return;
  const parsed = employeeDetailsSchema.safeParse(request.body); if (!parsed.success) { v2Error(response, 400, "INVALID_EMPLOYEE_DETAILS", "Enter valid employment details"); return; }
  if (parsed.data.joinDate && parsed.data.terminationDate && parsed.data.terminationDate < parsed.data.joinDate) { v2Error(response, 400, "INVALID_EMPLOYMENT_DATES", "Termination date cannot be before join date"); return; }
  const employee = await prisma.employee.findFirst({ where: { id: String(request.params.id), user: scope.employeeUserWhere }, select: { id: true } });
  if (!employee) { v2Error(response, 404, "EMPLOYEE_NOT_FOUND", "Employee not found in your scope"); return; }
  if (parsed.data.departmentId) {
    const department = await prisma.department.findFirst({ where: { id: parsed.data.departmentId, clientId: scope.clientId }, select: { id: true } });
    if (!department) { v2Error(response, 404, "DEPARTMENT_NOT_FOUND", "Department not found"); return; }
  }
  if (parsed.data.employeeNumber) {
    const duplicate = await prisma.employee.findFirst({ where: { id: { not: employee.id }, employeeNumber: parsed.data.employeeNumber, user: { clientId: scope.clientId } }, select: { id: true } });
    if (duplicate) { v2Error(response, 409, "EMPLOYEE_NUMBER_EXISTS", "That employee number is already in use"); return; }
  }
  const updated = await prisma.employee.update({ where: { id: employee.id }, data: { employeeNumber: parsed.data.employeeNumber, employmentStatus: parsed.data.employmentStatus, joinDate: parsed.data.joinDate ? new Date(parsed.data.joinDate) : parsed.data.joinDate, terminationDate: parsed.data.terminationDate ? new Date(parsed.data.terminationDate) : parsed.data.terminationDate, departmentId: parsed.data.departmentId }, include: { department: true, user: { select: { username: true, isActive: true } } } });
  await recordAudit({ actorUserId: response.locals.auth.sub, clientId: scope.clientId, action: "UPDATE", entityType: "EmployeeDetails", entityId: employee.id, details: parsed.data, requestId: response.locals.requestId, ipAddress: request.ip });
  response.json({ data: updated });
}

export async function listShiftTemplatesV2(request: Request, response: Response): Promise<void> {
  const scope = await organizationScope(request, response, false); if (!scope) return;
  const shifts = await prisma.shiftTemplate.findMany({ where: scope.clientId ? { clientId: scope.clientId } : undefined, orderBy: [{ isActive: "desc" }, { name: "asc" }] });
  response.json({ data: shifts });
}

export async function createShiftTemplateV2(request: Request, response: Response): Promise<void> {
  const scope = await organizationScope(request, response, true); if (!scope?.clientId) return;
  const parsed = shiftSchema.safeParse(request.body); if (!parsed.success) { v2Error(response, 400, "INVALID_SHIFT", "Enter valid shift details"); return; }
  const shift = await prisma.shiftTemplate.create({ data: { clientId: scope.clientId, ...parsed.data, isOvernight: parsed.data.endTime <= parsed.data.startTime } });
  await recordAudit({ actorUserId: response.locals.auth.sub, clientId: scope.clientId, action: "CREATE", entityType: "ShiftTemplate", entityId: shift.id, details: parsed.data, requestId: response.locals.requestId, ipAddress: request.ip });
  response.status(201).json({ data: shift });
}

export async function listScheduleAssignmentsV2(request: Request, response: Response): Promise<void> {
  const scope = await organizationScope(request, response, false); if (!scope) return;
  const assignments = await prisma.scheduleAssignment.findMany({ where: { employee: { user: scope.employeeUserWhere } }, include: { employee: { select: { firstName: true, lastName: true } }, shiftTemplate: true }, orderBy: [{ effectiveFrom: "desc" }, { id: "desc" }] });
  response.json({ data: assignments });
}

export async function createScheduleAssignmentV2(request: Request, response: Response): Promise<void> {
  const scope = await organizationScope(request, response, true); if (!scope?.clientId) return;
  const parsed = assignmentSchema.safeParse(request.body);
  if (!parsed.success || (parsed.data.effectiveTo && parsed.data.effectiveTo < parsed.data.effectiveFrom)) { v2Error(response, 400, "INVALID_ASSIGNMENT", "Enter valid assignment dates"); return; }
  const [employee, shift] = await Promise.all([
    prisma.employee.findFirst({ where: { id: parsed.data.employeeId, user: scope.employeeUserWhere }, select: { id: true } }),
    prisma.shiftTemplate.findFirst({ where: { id: parsed.data.shiftTemplateId, clientId: scope.clientId }, select: { id: true } }),
  ]);
  if (!employee || !shift) { v2Error(response, 404, "ASSIGNMENT_TARGET_NOT_FOUND", "Employee or shift template not found"); return; }
  let assignment: ScheduleAssignment;
  try {
    assignment = await prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${employee.id}))::text`;
      const futureOverlap = await transaction.scheduleAssignment.findFirst({ where: { employeeId: employee.id, effectiveFrom: { gte: parsed.data.effectiveFrom, lte: parsed.data.effectiveTo ?? "9999-12-31" } }, select: { id: true } });
      if (futureOverlap) throw new Error("SCHEDULE_ASSIGNMENT_OVERLAP");
      const prior = await transaction.scheduleAssignment.findFirst({ where: { employeeId: employee.id, effectiveFrom: { lt: parsed.data.effectiveFrom }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: parsed.data.effectiveFrom } }] }, orderBy: { effectiveFrom: "desc" }, select: { id: true } });
      if (prior) await transaction.scheduleAssignment.update({ where: { id: prior.id }, data: { effectiveTo: previousIsoDate(parsed.data.effectiveFrom) } });
      return transaction.scheduleAssignment.create({ data: parsed.data });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (caught) {
    if (caught instanceof Error && caught.message === "SCHEDULE_ASSIGNMENT_OVERLAP") { v2Error(response, 409, "SCHEDULE_ASSIGNMENT_OVERLAP", "This employee already has a schedule assignment in that date range"); return; }
    throw caught;
  }
  await recordAudit({ actorUserId: response.locals.auth.sub, clientId: scope.clientId, action: "CREATE", entityType: "ScheduleAssignment", entityId: assignment.id, details: parsed.data, requestId: response.locals.requestId, ipAddress: request.ip });
  response.status(201).json({ data: assignment });
}

export async function getWorkPolicyV2(request: Request, response: Response): Promise<void> {
  const scope = await organizationScope(request, response, true); if (!scope?.clientId) return;
  const policy = await prisma.workPolicy.upsert({ where: { clientId: scope.clientId }, create: { clientId: scope.clientId }, update: {} });
  response.json({ data: policy });
}

export async function updateWorkPolicyV2(request: Request, response: Response): Promise<void> {
  const scope = await organizationScope(request, response, true); if (!scope?.clientId) return;
  const parsed = policySchema.safeParse(request.body); if (!parsed.success || parsed.data.overtimeThreshold > parsed.data.maximumShiftMinutes) { v2Error(response, 400, "INVALID_POLICY", "Enter valid attendance policy values"); return; }
  const policy = await prisma.workPolicy.upsert({ where: { clientId: scope.clientId }, create: { clientId: scope.clientId, ...parsed.data }, update: parsed.data });
  await recordAudit({ actorUserId: response.locals.auth.sub, clientId: scope.clientId, action: "UPDATE", entityType: "WorkPolicy", entityId: policy.id, details: parsed.data, requestId: response.locals.requestId, ipAddress: request.ip });
  response.json({ data: policy });
}

export async function listHolidaysV2(request: Request, response: Response): Promise<void> {
  const scope = await organizationScope(request, response, false); if (!scope) return;
  const year = z.coerce.number().int().min(2020).max(2100).optional().safeParse(request.query.year);
  if (!year.success) { v2Error(response, 400, "INVALID_YEAR", "Use a valid holiday year"); return; }
  const holidays = await prisma.holiday.findMany({ where: { ...(scope.clientId ? { clientId: scope.clientId } : {}), ...(year.data ? { date: { startsWith: `${year.data}-` } } : {}) }, orderBy: [{ date: "asc" }, { name: "asc" }] });
  response.json({ data: holidays });
}

export async function createHolidayV2(request: Request, response: Response): Promise<void> {
  const scope = await organizationScope(request, response, true); if (!scope?.clientId) return;
  const parsed = holidaySchema.safeParse(request.body); if (!parsed.success) { v2Error(response, 400, "INVALID_HOLIDAY", "Enter valid holiday details"); return; }
  const holiday = await prisma.holiday.create({ data: { clientId: scope.clientId, ...parsed.data } });
  await recordAudit({ actorUserId: response.locals.auth.sub, clientId: scope.clientId, action: "CREATE", entityType: "Holiday", entityId: holiday.id, details: parsed.data, requestId: response.locals.requestId, ipAddress: request.ip });
  response.status(201).json({ data: holiday });
}

export function malaysiaCalendar(year: number, stateCode: string): { states: Record<string, string>; holidays: Array<{ date: string; name: string; type: string }> } | null {
  const engine = new Holidays();
  const states = engine.getStates("MY") as Record<string, string>;
  if (!states[stateCode]) return null;
  engine.init("MY", stateCode);
  const holidays = engine.getHolidays(year).filter((holiday) => holiday.type === "public").map((holiday) => ({ date: holiday.date.slice(0, 10), name: holiday.name, type: holiday.type }));
  return { states, holidays };
}

export async function getMalaysiaHolidayCalendarV2(request: Request, response: Response): Promise<void> {
  const scope = await organizationScope(request, response, true); if (!scope?.clientId) return;
  const year = z.coerce.number().int().min(2020).max(2100).safeParse(request.query.year ?? new Date().getFullYear());
  const client = await prisma.client.findUnique({ where: { id: scope.clientId }, select: { stateCode: true } });
  const stateCode = typeof request.query.stateCode === "string" ? request.query.stateCode : client?.stateCode ?? "14";
  if (!year.success) { v2Error(response, 400, "INVALID_YEAR", "Use a valid holiday year"); return; }
  const calendar = malaysiaCalendar(year.data, stateCode);
  if (!calendar) { v2Error(response, 400, "INVALID_STATE", "Choose a valid Malaysian state or federal territory"); return; }
  response.json({ data: calendar.holidays, states: calendar.states, stateCode, disclaimer: "Calendar dates must be checked against current official Malaysian federal and state notices before payroll use." });
}

export async function importMalaysiaHolidayCalendarV2(request: Request, response: Response): Promise<void> {
  const scope = await organizationScope(request, response, true); if (!scope?.clientId) return;
  const parsed = holidayImportSchema.safeParse(request.body); if (!parsed.success) { v2Error(response, 400, "INVALID_HOLIDAY_IMPORT", "Choose a valid year and Malaysian state"); return; }
  const calendar = malaysiaCalendar(parsed.data.year, parsed.data.stateCode);
  if (!calendar) { v2Error(response, 400, "INVALID_STATE", "Choose a valid Malaysian state or federal territory"); return; }
  await prisma.$transaction(async (transaction) => {
    await transaction.client.update({ where: { id: scope.clientId }, data: { stateCode: parsed.data.stateCode } });
    for (const holiday of calendar.holidays) {
      await transaction.holiday.upsert({ where: { clientId_date_name: { clientId: scope.clientId!, date: holiday.date, name: holiday.name } }, create: { clientId: scope.clientId!, date: holiday.date, name: holiday.name, stateCode: parsed.data.stateCode, source: "MALAYSIA_CALENDAR" }, update: { stateCode: parsed.data.stateCode, source: "MALAYSIA_CALENDAR" } });
    }
    await transaction.auditLog.create({ data: { actorUserId: response.locals.auth.sub, clientId: scope.clientId, action: "IMPORT_HOLIDAYS", entityType: "Client", entityId: scope.clientId!, details: { year: parsed.data.year, stateCode: parsed.data.stateCode, count: calendar.holidays.length }, requestId: response.locals.requestId, ipAddress: request.ip } });
  });
  response.status(201).json({ imported: calendar.holidays.length, stateCode: parsed.data.stateCode, year: parsed.data.year });
}

export async function listManagersV2(request: Request, response: Response): Promise<void> {
  const scope = await organizationScope(request, response, true); if (!scope?.clientId) return;
  const managers = await prisma.organizationMembership.findMany({
    where: { clientId: scope.clientId, role: MembershipRole.MANAGER, ...(response.locals.auth.role === Role.DEV_ADMIN ? {} : { user: { createdByUserId: response.locals.auth.sub } }) },
    include: { user: { select: { id: true, username: true, displayName: true, isActive: true } }, reports: { select: { userId: true } } },
    orderBy: { createdAt: "asc" },
  });
  response.json({ data: managers });
}

export async function createManagerV2(request: Request, response: Response): Promise<void> {
  const scope = await organizationScope(request, response, true); if (!scope?.clientId) return;
  const parsed = managerSchema.safeParse(request.body); if (!parsed.success) { v2Error(response, 400, "INVALID_MANAGER", "Enter a valid username, name, and password of at least 8 characters"); return; }
  try {
    const manager = await prisma.user.create({
      data: {
        username: parsed.data.username,
        displayName: parsed.data.displayName,
        passwordHash: await hashPassword(parsed.data.password),
        mustChangePassword: true,
        role: Role.MANAGER,
        clientId: scope.clientId,
        createdByUserId: response.locals.auth.sub,
        memberships: { create: { clientId: scope.clientId, role: MembershipRole.MANAGER } },
      },
      select: { id: true, username: true, displayName: true, isActive: true, memberships: { select: { id: true, clientId: true, role: true, status: true } } },
    });
    await recordAudit({ actorUserId: response.locals.auth.sub, clientId: scope.clientId, action: "CREATE", entityType: "Manager", entityId: manager.id, details: { username: manager.username }, requestId: response.locals.requestId, ipAddress: request.ip });
    response.status(201).json({ data: manager });
  } catch (caught) {
    if (caught instanceof Prisma.PrismaClientKnownRequestError && caught.code === "P2002") { v2Error(response, 409, "USERNAME_EXISTS", "That username is already in use"); return; }
    throw caught;
  }
}

export async function assignManagerReportsV2(request: Request, response: Response): Promise<void> {
  const scope = await organizationScope(request, response, true); if (!scope?.clientId) return;
  const parsed = managerReportsSchema.safeParse(request.body); if (!parsed.success) { v2Error(response, 400, "INVALID_REPORTS", "Choose valid employees for this manager"); return; }
  const manager = await prisma.organizationMembership.findFirst({ where: { userId: String(request.params.userId), clientId: scope.clientId, role: MembershipRole.MANAGER, status: MembershipStatus.ACTIVE, ...(response.locals.auth.role === Role.DEV_ADMIN ? {} : { user: { createdByUserId: response.locals.auth.sub } }) }, select: { id: true, userId: true } });
  if (!manager) { v2Error(response, 404, "MANAGER_NOT_FOUND", "Active manager not found"); return; }
  const employees = await prisma.employee.findMany({ where: { id: { in: parsed.data.employeeIds }, user: scope.employeeUserWhere }, select: { userId: true } });
  if (employees.length !== new Set(parsed.data.employeeIds).size) { v2Error(response, 403, "EMPLOYEE_SCOPE_VIOLATION", "One or more employees are outside your management scope"); return; }
  await prisma.$transaction(async (transaction) => {
    await transaction.organizationMembership.updateMany({ where: { clientId: scope.clientId, managerMembershipId: manager.id }, data: { managerMembershipId: null } });
    if (employees.length > 0) await transaction.organizationMembership.updateMany({ where: { clientId: scope.clientId, userId: { in: employees.map((employee) => employee.userId) }, role: MembershipRole.EMPLOYEE, status: MembershipStatus.ACTIVE }, data: { managerMembershipId: manager.id } });
    await transaction.auditLog.create({ data: { actorUserId: response.locals.auth.sub, clientId: scope.clientId, action: "ASSIGN_REPORTS", entityType: "Manager", entityId: manager.userId, details: { employeeIds: parsed.data.employeeIds }, requestId: response.locals.requestId, ipAddress: request.ip } });
  });
  response.status(204).end();
}

export async function updateManagerStatusV2(request: Request, response: Response): Promise<void> {
  const scope = await organizationScope(request, response, true); if (!scope?.clientId) return;
  const parsed = managerStatusSchema.safeParse(request.body); if (!parsed.success) { v2Error(response, 400, "INVALID_MANAGER_STATUS", "Choose whether this manager is active"); return; }
  const userId = String(request.params.userId);
  const manager = await prisma.organizationMembership.findFirst({ where: { userId, clientId: scope.clientId, role: MembershipRole.MANAGER, ...(response.locals.auth.role === Role.DEV_ADMIN ? {} : { user: { createdByUserId: response.locals.auth.sub } }) }, select: { id: true } });
  if (!manager) { v2Error(response, 404, "MANAGER_NOT_FOUND", "Manager not found in your scope"); return; }
  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { isActive: parsed.data.isActive, passwordVersion: { increment: 1 } } }),
    prisma.organizationMembership.update({ where: { id: manager.id }, data: { status: parsed.data.isActive ? MembershipStatus.ACTIVE : MembershipStatus.INACTIVE } }),
    prisma.authSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } }),
    prisma.auditLog.create({ data: { actorUserId: response.locals.auth.sub, clientId: scope.clientId, action: parsed.data.isActive ? "ACTIVATE" : "DEACTIVATE", entityType: "Manager", entityId: userId, requestId: response.locals.requestId, ipAddress: request.ip } }),
  ]);
  response.status(204).end();
}

export async function getAttendanceEventLocationV2(request: Request, response: Response): Promise<void> {
  const scope = await organizationScope(request, response, true); if (!scope?.clientId) return;
  const event = await prisma.attendanceEvent.findFirst({ where: { id: String(request.params.id), clientId: scope.clientId, employee: { user: scope.employeeUserWhere } }, select: { id: true, workDate: true, type: true, occurredAt: true, worksiteId: true, latitude: true, longitude: true, accuracyMeters: true, distanceMeters: true, acceptedRadiusMeters: true } });
  if (!event) { v2Error(response, 404, "ATTENDANCE_EVENT_NOT_FOUND", "Attendance event not found in your scope"); return; }
  await recordAudit({ actorUserId: response.locals.auth.sub, clientId: scope.clientId, action: "VIEW_EXACT_GPS", entityType: "AttendanceEvent", entityId: event.id, details: { workDate: event.workDate }, requestId: response.locals.requestId, ipAddress: request.ip });
  response.setHeader("cache-control", "private, no-store");
  response.json({ data: event });
}
