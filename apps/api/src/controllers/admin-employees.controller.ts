import { MembershipRole, MembershipStatus, Prisma, Role } from "@prisma/client";
import type { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../services/prisma.js";
import { hashPassword } from "../utils/password.js";
import { recordAudit } from "../services/audit.js";
import { getAdminContext } from "../services/admin-scope.js";
import { compareEmployeeListShadow, type EmployeeShadowSnapshot } from "../services/d1-shadow.js";

const strongPassword = z.string().min(8).max(128).regex(/[a-z]/).regex(/[A-Z]/).regex(/\d/).regex(/[^A-Za-z0-9]/);
const employeeSchema = z.object({
  username: z.string().trim().min(3).max(40).regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/).transform((value) => value.toLowerCase()),
  password: strongPassword,
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
});
const statusSchema = z.object({ isActive: z.boolean() });

type Auth = { sub: string; role: Role };

const employeeInclude = { employee: true, createdBy: { select: { id: true, username: true, displayName: true, role: true } } } as const;

function employeeView(user: { id: string; username: string; isActive: boolean; clientId: string | null; employee: { id: string; firstName: string; lastName: string } | null; createdBy: { id: string; username: string; displayName: string | null; role: Role } | null }): EmployeeShadowSnapshot {
  const ownerAdmin = user.createdBy?.role === Role.ADMIN
    ? { id: user.createdBy.id, username: user.createdBy.username, displayName: user.createdBy.displayName }
    : null;
  return { id: user.id, employeeId: user.employee?.id ?? null, username: user.username, firstName: user.employee?.firstName ?? "", lastName: user.employee?.lastName ?? "", isActive: user.isActive, clientId: user.clientId, ownerAdmin };
}

function employeeValidationError(error: z.ZodError): string {
  const field = String(error.issues[0]?.path[0] ?? "");
  if (field === "username") return "Username must be 3 to 40 characters and use only letters, numbers, dots, hyphens, or underscores";
  if (field === "password") return "Temporary password must be 8 to 128 characters and include uppercase, lowercase, number, and symbol characters";
  if (field === "firstName") return "First name is required and must be 80 characters or fewer";
  if (field === "lastName") return "Last name is required and must be 80 characters or fewer";
  return "Review the employee details and try again";
}

export async function getAdminEmployees(_request: Request, response: Response): Promise<void> {
  const context = await getAdminContext(response);
  if (!context?.clientId) { response.status(400).json({ error: "Select an organization before viewing employees" }); return; }
  const users = await prisma.user.findMany({ where: context.employeeUserWhere, include: employeeInclude, orderBy: [{ isActive: "desc" }, { username: "asc" }] });
  const employees = users.map(employeeView);
  await compareEmployeeListShadow(employees, { role: context.auth.role, clientId: context.clientId, managerMembershipId: context.membershipId });
  response.json({ employees });
}

export async function createAdminEmployee(request: Request, response: Response): Promise<void> {
  const auth = response.locals.auth as Auth;
  const context = await getAdminContext(response);
  if (!context) { response.status(401).json({ error: "A client account is required" }); return; }
  const parsed = employeeSchema.safeParse(request.body);
  if (!parsed.success) { response.status(400).json({ error: employeeValidationError(parsed.error) }); return; }
  const clientId = context.clientId;
  if (!clientId) { response.status(400).json({ error: "Select an organization before adding an employee" }); return; }
  if (!(await prisma.client.findUnique({ where: { id: clientId }, select: { id: true } }))) { response.status(400).json({ error: "Client not found" }); return; }
  try {
    const passwordHash = await hashPassword(parsed.data.password);
    const user = await prisma.user.create({ data: { username: parsed.data.username, passwordHash, mustChangePassword: true, role: Role.EMPLOYEE, clientId, createdByUserId: auth.sub, employee: { create: { firstName: parsed.data.firstName, lastName: parsed.data.lastName } }, memberships: { create: { clientId, role: MembershipRole.EMPLOYEE } } }, include: employeeInclude });
    await recordAudit({ actorUserId: auth.sub, clientId, action: "CREATE", entityType: "Employee", entityId: user.id, details: { username: user.username, clientId } });
    response.status(201).json({ employee: employeeView(user) });
  } catch (error: unknown) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") { response.status(409).json({ error: "An account with that username already exists" }); return; }
    throw error;
  }
}

export async function updateAdminEmployeeStatus(request: Request, response: Response): Promise<void> {
  const context = await getAdminContext(response);
  if (!context) { response.status(401).json({ error: "A client account is required" }); return; }
  const parsed = statusSchema.safeParse(request.body);
  if (!parsed.success) { response.status(400).json({ error: "isActive must be a boolean" }); return; }
  const id = String(request.params.id);
  const target = await prisma.user.findFirst({ where: { id, ...context.employeeUserWhere }, select: { id: true, clientId: true } });
  if (!target?.clientId) { response.status(404).json({ error: "Employee not found" }); return; }
  await prisma.$transaction([
    prisma.user.update({ where: { id: target.id }, data: parsed.data }),
    prisma.organizationMembership.updateMany({ where: { userId: target.id, clientId: target.clientId }, data: { status: parsed.data.isActive ? MembershipStatus.ACTIVE : MembershipStatus.INACTIVE } }),
    ...(!parsed.data.isActive ? [prisma.authSession.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } })] : []),
  ]);
  const user = await prisma.user.findUniqueOrThrow({ where: { id }, include: employeeInclude });
  await recordAudit({ actorUserId: response.locals.auth.sub, clientId: user.clientId ?? undefined, action: parsed.data.isActive ? "ACTIVATE" : "DEACTIVATE", entityType: "Employee", entityId: id, details: { isActive: parsed.data.isActive } });
  response.json({ employee: employeeView(user) });
}
