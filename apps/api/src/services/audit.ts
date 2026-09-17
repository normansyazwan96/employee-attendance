import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma.js";

export async function recordAudit(input: { actorUserId: string; clientId?: string; action: string; entityType: string; entityId: string; details?: Prisma.InputJsonValue }): Promise<void> {
  await prisma.auditLog.create({ data: input });
}