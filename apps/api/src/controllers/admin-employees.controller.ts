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
  clientId: z.string().min(1).optional(),
});
const statusSchema = z.object({ isActive: z.boolean() });

type Auth = { sub: string; role: Role };

function employeeView(user: { id: string; username: string; isActive: boolean; clientId: string | null; employee: { id: string; firstName: string; lastName: string } | null }) {
  return { id: user.id, employeeId: user.employee?.id ?? null, username: user.username, firstName: user.employee?.firstName ?? "", lastName: user.employee?.lastName ?? "", isActive: user.isActive, clientId: user.clientId };
}

export async function getAdminEmployees(_request: Request, response: Response): Promise<void> {
  const context = await getAdminContext(response);
  if (!context) { response.status(401).json({ error: "A client account is required" }); return; }
  const users = await prisma.user.findMany({ where: context.employeeUserWhere, include: { employee: true }, orderBy: [{ isActive: "desc" }, { username: "asc" }] });
  response.json({ employees: users.map(employeeView) });
}

export async function createAdminEmployee(request: Request, response: Response): Promise<void> {
  const auth = response.locals.auth as Auth;
  const context = await getAdminContext(response);
  if (!context) { response.status(401).json({ error: "A client account is required" }); return; }
  const parsed = employeeSchema.safeParse(request.body);
  if (!parsed.success) { response.status(400).json({ error: "Enter a valid username, strong password, first name, and last name" }); return; }
  const clientId = auth.role === Role.DEV_ADMIN ? parsed.data.clientId : context.clientId;
  if (!clientId) { response.status(400).json({ error: "A clientId is required for dev admin employee creation" }); return; }
  if (!(await prisma.client.findUnique({ where: { id: clientId }, select: { id: true } }))) { response.status(400).json({ error: "Client not found" }); return; }
  try {
    const passwordHash = await hashPassword(parsed.data.password);
    const user = await prisma.user.create({ data: { username: parsed.data.username, passwordHash, mustChangePassword: true, role: Role.EMPLOYEE, clientId, createdByUserId: auth.sub, employee: { create: { firstName: parsed.data.firstName, lastName: parsed.data.lastName } } }, include: { employee: true } });
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
  const updated = await prisma.user.updateMany({ where: { id, ...context.employeeUserWhere }, data: parsed.data });
  if (updated.count === 0) { response.status(404).json({ error: "Employee not found" }); return; }
  const user = await prisma.user.findUniqueOrThrow({ where: { id }, include: { employee: true } });
  await recordAudit({ actorUserId: response.locals.auth.sub, clientId: user.clientId ?? undefined, action: parsed.data.isActive ? "ACTIVATE" : "DEACTIVATE", entityType: "Employee", entityId: id, details: { isActive: parsed.data.isActive } });
  response.json({ employee: employeeView(user) });
}
