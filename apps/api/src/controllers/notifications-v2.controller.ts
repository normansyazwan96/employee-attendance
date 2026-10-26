import type { Request, Response } from "express";
import { prisma } from "../services/prisma.js";

export async function listNotificationsV2(request: Request, response: Response): Promise<void> {
  const unreadOnly = request.query.unread === "true";
  const data = await prisma.notification.findMany({ where: { userId: response.locals.auth.sub, ...(unreadOnly ? { readAt: null } : {}) }, orderBy: { createdAt: "desc" }, take: 100 });
  response.json({ data });
}

export async function markNotificationReadV2(request: Request, response: Response): Promise<void> {
  const result = await prisma.notification.updateMany({ where: { id: String(request.params.id), userId: response.locals.auth.sub }, data: { readAt: new Date() } });
  if (!result.count) { response.status(404).json({ error: { code: "NOTIFICATION_NOT_FOUND", message: "Notification not found" }, requestId: response.locals.requestId }); return; }
  response.status(204).end();
}
