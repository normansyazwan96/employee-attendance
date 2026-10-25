import type { Request, Response } from "express";
import { prisma } from "../services/prisma.js";
import { getAdminContext } from "../services/admin-scope.js";

export async function getAdminAudit(_request: Request, response: Response): Promise<void> {
  const context = await getAdminContext(response);
  const logs = await prisma.auditLog.findMany({ where: context?.clientId ? { clientId: context.clientId } : undefined, orderBy: { createdAt: "desc" }, take: 100 });
  response.json({ audit: logs });
}
