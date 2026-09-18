import { Prisma, Role } from "@prisma/client";
import type { Response } from "express";
import { prisma } from "./prisma.js";

export type AdminAuth = { sub: string; role: Role };
export type AdminContext = { auth: AdminAuth; clientId: string | undefined; employeeUserWhere: Prisma.UserWhereInput };

export async function getAdminContext(response: Response): Promise<AdminContext | null> {
  const auth = response.locals.auth as AdminAuth;
  if (auth.role === Role.DEV_ADMIN) return { auth, clientId: undefined, employeeUserWhere: { role: Role.EMPLOYEE } };
  const user = await prisma.user.findUnique({ where: { id: auth.sub }, select: { clientId: true } });
  if (!user?.clientId) return null;
  return { auth, clientId: user.clientId, employeeUserWhere: { role: Role.EMPLOYEE, clientId: user.clientId, createdByUserId: auth.sub } };
}
