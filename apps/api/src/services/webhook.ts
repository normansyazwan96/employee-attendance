import { createHmac } from "node:crypto";
import { env } from "../config/env.js";

export type AttendanceWebhookPayload = {
  event: "attendance.clock_in" | "attendance.clock_out";
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

export async function sendAttendanceWebhook(payload: AttendanceWebhookPayload, config: AttendanceWebhookConfig = {}): Promise<void> {
  const url = config.url ?? env.WEBHOOK_URL;
  if (!url) return;

  const body = JSON.stringify(payload);
  const signature = createHmac("sha256", config.secret ?? env.WEBHOOK_SECRET ?? "")
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
    throw new Error(`Attendance webhook failed with status ${response.status}`);
  }
}
