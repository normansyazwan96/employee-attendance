import { Role } from "@prisma/client";
import type { Request, Response } from "express";
import { prisma } from "../services/prisma.js";

export async function getAdminAudit(_request: Request, response: Response): Promise<void> {
  const auth = response.locals.auth as { sub: string; role: Role };
  const user = auth.role === Role.DEV_ADMIN ? null : await prisma.user.findUnique({ where: { id: auth.sub }, select: { clientId: true } });
  if (auth.role !== Role.DEV_ADMIN && !user?.clientId) { response.status(401).json({ error: "A client account is required" }); return; }
  const logs = await prisma.auditLog.findMany({ where: auth.role === Role.DEV_ADMIN ? undefined : { clientId: user?.clientId }, orderBy: { createdAt: "desc" }, take: 100 });
  response.json({ audit: logs });
}
