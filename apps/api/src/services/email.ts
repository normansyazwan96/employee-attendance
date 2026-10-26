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

export async function sendPayrollStatementEmail(input: { to: string; employeeName: string; periodName: string; language: "en" | "ms"; fileName: string; pdf: Uint8Array }): Promise<string | null> {
  if (!emailConfigured()) throw new Error("Email delivery is not configured");
  const ms = input.language === "ms";
  const subject = ms ? `Penyata pengiraan gaji - ${input.periodName}` : `Payroll calculation statement - ${input.periodName}`;
  const message = ms
    ? `Salam ${input.employeeName}, penyata pengiraan gaji anda untuk ${input.periodName} dilampirkan. Dokumen ini bukan bukti pembayaran.`
    : `Hello ${input.employeeName}, your payroll calculation statement for ${input.periodName} is attached. This document is not proof of payment.`;
  const escaped = message.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: env.EMAIL_FROM,
      to: [input.to],
      subject,
      text: message,
      html: `<p>${escaped}</p><p><strong>attend+</strong></p>`,
      attachments: [{ filename: input.fileName, content: Buffer.from(input.pdf).toString("base64") }],
    }),
  });
  if (!response.ok) throw new Error(`Resend email delivery failed with status ${response.status}`);
  const result = await response.json().catch(() => null) as { id?: string } | null;
  return result?.id ?? null;
}
