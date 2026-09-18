import { Prisma, Role } from "@prisma/client";
import type { Request, Response } from "express";
import { z } from "zod";
import { getAdminContext, type AdminAuth } from "../services/admin-scope.js";
import { recordAudit } from "../services/audit.js";
import { prisma } from "../services/prisma.js";
import { hashPassword } from "../utils/password.js";

const strongPassword = z.string().min(12).max(128).regex(/[a-z]/).regex(/[A-Z]/).regex(/\d/).regex(/[^A-Za-z0-9]/);
const adminSchema = z.object({
  email: z.string().email().transform((value) => value.toLowerCase()),
  displayName: z.string().trim().min(1).max(120),
  clientId: z.string().min(1),
  password: strongPassword,
});
const resetSchema = z.object({ password: strongPassword });

function accountView(user: { id: string; email: string; role: Role; isActive: boolean; displayName: string | null; clientId: string | null; client: { name: string } | null }) {
  return { id: user.id, email: user.email, role: user.role, isActive: user.isActive, displayName: user.displayName, clientId: user.clientId, clientName: user.client?.name ?? null };
}

const accountInclude = { client: { select: { name: true } } } as const;

export async function getAdminAccounts(_request: Request, response: Response): Promise<void> {
  const auth = response.locals.auth as AdminAuth;
  if (auth.role !== Role.DEV_ADMIN) { response.status(403).json({ error: "Only a dev admin can manage admin accounts" }); return; }
  const users = await prisma.user.findMany({ where: { role: Role.ADMIN }, include: accountInclude, orderBy: [{ isActive: "desc" }, { email: "asc" }] });
  response.json({ admins: users.map(accountView) });
}

export async function createAdminAccount(request: Request, response: Response): Promise<void> {
  const auth = response.locals.auth as AdminAuth;
  if (auth.role !== Role.DEV_ADMIN) { response.status(403).json({ error: "Only a dev admin can create admin accounts" }); return; }
  const parsed = adminSchema.safeParse(request.body);
  if (!parsed.success) { response.status(400).json({ error: "Enter a valid name, email, client, and strong temporary password" }); return; }
  if (!(await prisma.client.findUnique({ where: { id: parsed.data.clientId }, select: { id: true } }))) { response.status(400).json({ error: "Client not found" }); return; }
  try {
    const user = await prisma.user.create({ data: { email: parsed.data.email, displayName: parsed.data.displayName, clientId: parsed.data.clientId, role: Role.ADMIN, passwordHash: await hashPassword(parsed.data.password), mustChangePassword: true, createdByUserId: auth.sub }, include: accountInclude });
    await recordAudit({ actorUserId: auth.sub, clientId: user.clientId ?? undefined, action: "CREATE", entityType: "Admin", entityId: user.id, details: { email: user.email, clientId: user.clientId } });
    response.status(201).json({ admin: accountView(user) });
  } catch (error: unknown) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") { response.status(409).json({ error: "An account with that email already exists" }); return; }
    throw error;
  }
}

export async function resetManagedAccountPassword(request: Request, response: Response): Promise<void> {
  const context = await getAdminContext(response);
  if (!context) { response.status(401).json({ error: "A client account is required" }); return; }
  const parsed = resetSchema.safeParse(request.body);
  if (!parsed.success) { response.status(400).json({ error: "Use a password of at least 12 characters with uppercase, lowercase, number, and symbol characters" }); return; }
  const id = String(request.params.id);
  const target = await prisma.user.findFirst({
    where: context.auth.role === Role.DEV_ADMIN
      ? { id, role: { in: [Role.ADMIN, Role.EMPLOYEE] } }
      : { id, ...context.employeeUserWhere },
    include: accountInclude,
  });
  if (!target) { response.status(404).json({ error: "Managed account not found" }); return; }
  const user = await prisma.user.update({ where: { id: target.id }, data: { passwordHash: await hashPassword(parsed.data.password), passwordVersion: { increment: 1 }, mustChangePassword: true }, include: accountInclude });
  await recordAudit({ actorUserId: context.auth.sub, clientId: user.clientId ?? undefined, action: "RESET_PASSWORD", entityType: user.role === Role.ADMIN ? "Admin" : "Employee", entityId: user.id, details: { email: user.email } });
  response.json({ account: accountView(user) });
}
