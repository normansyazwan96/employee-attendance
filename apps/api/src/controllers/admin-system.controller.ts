import type { Request, Response } from "express";
import { env } from "../config/env.js";
import { prisma } from "../services/prisma.js";

export function getWebhookDetails(_request: Request, response: Response): void {
  response.json({
    webhook: {
      enabled: Boolean(env.WEBHOOK_URL),
      url: env.WEBHOOK_URL || null,
      secretConfigured: Boolean(env.WEBHOOK_SECRET),
      events: ["attendance.clock_in", "attendance.clock_out", "attendance.break_start", "attendance.break_end"],
      method: "POST",
      contentType: "application/json",
      signatureHeader: "x-webhook-signature",
      signatureAlgorithm: "HMAC-SHA256",
      delivery: { mode: "Cloudflare Queue", maxRetries: 5, retryDelaySeconds: 60, deadLetterQueue: true },
      failureBehavior: "Attendance is saved first. Delivery retries asynchronously and exhausted messages are retained in the dead-letter queue.",
    },
  });
}

export async function getWebhookDeliveries(_request: Request, response: Response): Promise<void> {
  const data = await prisma.webhookDelivery.findMany({ select: { id: true, clientId: true, attendanceEventId: true, eventType: true, status: true, attempts: true, lastAttemptAt: true, responseStatus: true, lastError: true, deliveredAt: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 100 });
  response.json({ data });
}
