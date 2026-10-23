import { env } from "../config/env.js";

export function emailConfigured(): boolean {
  return Boolean(env.RESEND_API_KEY && env.EMAIL_FROM);
}

export async function sendPasswordResetEmail(to: string, resetUrl: string): Promise<void> {
  if (!emailConfigured()) throw new Error("Email delivery is not configured");
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: env.EMAIL_FROM,
      to: [to],
      subject: "Reset your Attendance password",
      html: `<p>A password reset was requested for your Attendance account.</p><p><a href="${resetUrl}">Reset password</a></p><p>This link expires in one hour. If you did not request this, you can ignore this email.</p>`,
      text: `Reset your Attendance password: ${resetUrl}\n\nThis link expires in one hour. If you did not request this, you can ignore this email.`,
    }),
  });
  if (!response.ok) throw new Error(`Resend email delivery failed with status ${response.status}`);
}

export async function sendNotificationEmail(to: string, subject: string, message: string): Promise<void> {
  if (!emailConfigured()) return;
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: env.EMAIL_FROM, to: [to], subject, text: message, html: `<p>${message.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>` }),
  });
  if (!response.ok) throw new Error(`Resend email delivery failed with status ${response.status}`);
}
