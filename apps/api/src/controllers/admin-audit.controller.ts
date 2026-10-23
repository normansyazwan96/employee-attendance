import { Role } from "@prisma/client";
import type { Request, Response } from "express";
import { prisma } from "../services/prisma.js";
import { getAdminContext } from "../services/admin-scope.js";

export async function getAdminAudit(_request: Request, response: Response): Promise<void> {
  const auth = response.locals.auth as { sub: string; role: Role };
  const context = await getAdminContext(response);
  if (auth.role !== Role.DEV_ADMIN && !context?.clientId) { response.status(401).json({ error: "An active organization membership is required" }); return; }
  const logs = await prisma.auditLog.findMany({ where: auth.role === Role.DEV_ADMIN && !context?.clientId ? undefined : { clientId: context?.clientId }, orderBy: { createdAt: "desc" }, take: 100 });
  response.json({ audit: logs });
}
