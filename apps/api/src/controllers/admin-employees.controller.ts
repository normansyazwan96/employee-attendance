import { Prisma, Role } from "@prisma/client";
import type { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../services/prisma.js";
import { hashPassword } from "../utils/password.js";
import { recordAudit } from "../services/audit.js";
import { getAdminContext } from "../services/admin-scope.js";

const strongPassword = z.string().min(12).max(128).regex(/[a-z]/).regex(/[A-Z]/).regex(/\d/).regex(/[^A-Za-z0-9]/);
const employeeSchema = z.object({
  username: z.string().trim().min(3).max(40).regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/).transform((value) => value.toLowerCase()),
  password: strongPassword,
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  ownerAdminId: z.string().min(1).optional(),
});
const statusSchema = z.object({ isActive: z.boolean() });

type Auth = { sub: string; role: Role };

const employeeInclude = { employee: true, createdBy: { select: { id: true, username: true, displayName: true, role: true } } } as const;

function employeeView(user: { id: string; username: string; isActive: boolean; clientId: string | null; employee: { id: string; firstName: string; lastName: string } | null; createdBy: { id: string; username: string; displayName: string | null; role: Role } | null }) {
  const ownerAdmin = user.createdBy?.role === Role.ADMIN
    ? { id: user.createdBy.id, username: user.createdBy.username, displayName: user.createdBy.displayName }
    : null;
  return { id: user.id, employeeId: user.employee?.id ?? null, username: user.username, firstName: user.employee?.firstName ?? "", lastName: user.employee?.lastName ?? "", isActive: user.isActive, clientId: user.clientId, ownerAdmin };
}

function employeeValidationError(error: z.ZodError): string {
  const field = String(error.issues[0]?.path[0] ?? "");
  if (field === "username") return "Username must be 3 to 40 characters and use only letters, numbers, dots, hyphens, or underscores";
  if (field === "password") return "Temporary password must be 12 to 128 characters and include uppercase, lowercase, number, and symbol characters";
  if (field === "firstName") return "First name is required and must be 80 characters or fewer";
  if (field === "lastName") return "Last name is required and must be 80 characters or fewer";
  if (field === "ownerAdminId") return "Select an administrator for this employee";
  return "Review the employee details and try again";
}

export async function getAdminEmployees(_request: Request, response: Response): Promise<void> {
  const context = await getAdminContext(response);
  if (!context) { response.status(401).json({ error: "A client account is required" }); return; }
  const users = await prisma.user.findMany({ where: context.employeeUserWhere, include: employeeInclude, orderBy: [{ isActive: "desc" }, { username: "asc" }] });
  response.json({ employees: users.map(employeeView) });
}

export async function createAdminEmployee(request: Request, response: Response): Promise<void> {
  const auth = response.locals.auth as Auth;
  const context = await getAdminContext(response);
  if (!context) { response.status(401).json({ error: "A client account is required" }); return; }
  const parsed = employeeSchema.safeParse(request.body);
  if (!parsed.success) { response.status(400).json({ error: employeeValidationError(parsed.error) }); return; }
  let clientId = context.clientId;
  let createdByUserId = auth.sub;
  if (auth.role === Role.DEV_ADMIN) {
    if (!parsed.data.ownerAdminId) { response.status(400).json({ error: "Select an administrator for this employee" }); return; }
    const ownerAdmin = await prisma.user.findFirst({ where: { id: parsed.data.ownerAdminId, role: Role.ADMIN, isActive: true }, select: { id: true, clientId: true } });
    if (!ownerAdmin?.clientId) { response.status(400).json({ error: "The selected administrator is inactive or has no client assignment" }); return; }
    clientId = ownerAdmin.clientId;
    createdByUserId = ownerAdmin.id;
  }
  if (!clientId) { response.status(400).json({ error: "The administrator is not assigned to a client" }); return; }
  if (!(await prisma.client.findUnique({ where: { id: clientId }, select: { id: true } }))) { response.status(400).json({ error: "Client not found" }); return; }
  try {
    const passwordHash = await hashPassword(parsed.data.password);
    const user = await prisma.user.create({ data: { username: parsed.data.username, passwordHash, mustChangePassword: true, role: Role.EMPLOYEE, clientId, createdByUserId, employee: { create: { firstName: parsed.data.firstName, lastName: parsed.data.lastName } } }, include: employeeInclude });
    await recordAudit({ actorUserId: auth.sub, clientId, action: "CREATE", entityType: "Employee", entityId: user.id, details: { username: user.username, clientId, ownerAdminId: createdByUserId } });
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
  const updated = await prisma.user.updateMany({ where: { id, ...context.employeeUserWhere }, data: parsed.data });
  if (updated.count === 0) { response.status(404).json({ error: "Employee not found" }); return; }
  const user = await prisma.user.findUniqueOrThrow({ where: { id }, include: employeeInclude });
  await recordAudit({ actorUserId: response.locals.auth.sub, clientId: user.clientId ?? undefined, action: parsed.data.isActive ? "ACTIVATE" : "DEACTIVATE", entityType: "Employee", entityId: id, details: { isActive: parsed.data.isActive } });
  response.json({ employee: employeeView(user) });
}
