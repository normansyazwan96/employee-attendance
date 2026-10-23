import { sendNotificationEmail } from "./email.js";
import { logger } from "./logger.js";
import { prisma } from "./prisma.js";

type NotificationInput = { userIds: string[]; clientId?: string | null; type: string; title: string; message: string; entityType?: string; entityId?: string };

export async function notifyUsers(input: NotificationInput): Promise<void> {
  const userIds = [...new Set(input.userIds)].filter(Boolean);
  if (!userIds.length) return;
  const users = await prisma.user.findMany({ where: { id: { in: userIds }, isActive: true }, select: { id: true, email: true } });
  if (!users.length) return;
  await prisma.notification.createMany({ data: users.map((user) => ({ userId: user.id, clientId: input.clientId ?? null, type: input.type, title: input.title, message: input.message, entityType: input.entityType, entityId: input.entityId })) });
  await Promise.all(users.filter((user) => user.email).map(async (user) => {
    try { await sendNotificationEmail(user.email!, input.title, input.message); }
    catch (caught) { logger.warn("notification_email_failed", { userId: user.id, type: input.type, message: caught instanceof Error ? caught.message : "Unknown email error" }); }
  }));
}

export async function approvalRecipientIds(employeeUserId: string, clientId: string): Promise<string[]> {
  const membership = await prisma.organizationMembership.findUnique({ where: { userId_clientId: { userId: employeeUserId, clientId } }, include: { manager: { select: { userId: true } }, user: { select: { createdByUserId: true } } } });
  if (membership?.manager?.userId) return [membership.manager.userId];
  if (membership?.user.createdByUserId) return [membership.user.createdByUserId];
  const admins = await prisma.organizationMembership.findMany({ where: { clientId, role: "ADMIN", status: "ACTIVE" }, select: { userId: true } });
  return admins.map((admin) => admin.userId);
}
