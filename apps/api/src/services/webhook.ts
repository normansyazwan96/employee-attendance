import { createHmac } from "node:crypto";
import { env } from "../config/env.js";

export type AttendanceWebhookPayload = {
  event: "attendance.clock_in" | "attendance.clock_out" | "attendance.break_start" | "attendance.break_end";
  eventId?: string;
  employeeId: string;
  employeeName: string;
  workDate: string;
  timestamp: string;
  location?: { latitude: number; longitude: number; accuracy: number };
};

export type AttendanceWebhookConfig = {
  url?: string;
  secret?: string;
};

export class WebhookHttpError extends Error {
  constructor(readonly status: number) {
    super(`Attendance webhook failed with status ${status}`);
  }
}

export class WebhookConfigurationError extends Error {
  constructor() {
    super("Attendance webhook delivery requires a secret of at least 32 characters");
  }
}

export async function sendAttendanceWebhook(payload: AttendanceWebhookPayload, config: AttendanceWebhookConfig = {}): Promise<number | null> {
  const url = config.url ?? env.WEBHOOK_URL;
  if (!url) return null;
  const secret = config.secret ?? env.WEBHOOK_SECRET;
  if (secret.length < 32) throw new WebhookConfigurationError();

  const body = JSON.stringify(payload);
  const signature = createHmac("sha256", secret)
    .update(body)
    .digest("hex");

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-webhook-signature": `sha256=${signature}`,
    },
    body,
  });

  if (!response.ok) {
    throw new WebhookHttpError(response.status);
  }
  return response.status;
}
