import type { Request, Response } from "express";
import { env } from "../config/env.js";

export function getWebhookDetails(_request: Request, response: Response): void {
  response.json({
    webhook: {
      enabled: Boolean(env.WEBHOOK_URL),
      url: env.WEBHOOK_URL || null,
      secretConfigured: Boolean(env.WEBHOOK_SECRET),
      events: ["attendance.clock_in", "attendance.clock_out"],
      method: "POST",
      contentType: "application/json",
      signatureHeader: "x-webhook-signature",
      signatureAlgorithm: "HMAC-SHA256",
      failureBehavior: "Attendance is saved even if webhook delivery fails.",
    },
  });
}
