import { createHash, randomBytes } from "node:crypto";
import type { Request, Response } from "express";
import { z } from "zod";
import { env } from "../config/env.js";
import { emailConfigured, sendPasswordResetEmail } from "../services/email.js";
import { logger } from "../services/logger.js";
import { prisma } from "../services/prisma.js";
import { hashPassword } from "../utils/password.js";

const strongPassword = z.string().min(8).max(128).regex(/[a-z]/).regex(/[A-Z]/).regex(/\d/).regex(/[^A-Za-z0-9]/);
const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");

export async function requestPasswordResetV2(request: Request, response: Response): Promise<void> {
  const parsed = z.object({ email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()) }).safeParse(request.body);
  if (parsed.success && emailConfigured()) {
    const user = await prisma.user.findUnique({ where: { email: parsed.data.email }, select: { id: true, email: true, isActive: true } });
    if (user?.email && user.isActive) {
      const rawToken = randomBytes(32).toString("base64url");
      const reset = await prisma.passwordResetToken.create({ data: { userId: user.id, tokenHash: tokenHash(rawToken), expiresAt: new Date(Date.now() + 60 * 60 * 1_000) } });
      const resetUrl = `${env.APP_BASE_URL}/reset-password?token=${encodeURIComponent(rawToken)}`;
      await sendPasswordResetEmail(user.email, resetUrl).catch((error: unknown) => {
        logger.error("password_reset_email_failed", { requestId: response.locals.requestId, userId: user.id, message: error instanceof Error ? error.message : "Unknown email error" });
        return prisma.passwordResetToken.delete({ where: { id: reset.id } });
      });
    }
  }
  response.status(202).json({ message: "If the address belongs to an active account, a reset link will be sent." });
}

export async function resetPasswordV2(request: Request, response: Response): Promise<void> {
  const parsed = z.object({ token: z.string().min(32).max(256), password: strongPassword }).safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: { code: "INVALID_RESET", message: "Use a valid reset link and a strong password of at least 8 characters" }, requestId: response.locals.requestId });
    return;
  }
  const reset = await prisma.passwordResetToken.findUnique({ where: { tokenHash: tokenHash(parsed.data.token) }, include: { user: true } });
  if (!reset || reset.usedAt || reset.expiresAt <= new Date() || !reset.user.isActive) {
    response.status(400).json({ error: { code: "RESET_EXPIRED", message: "This reset link is invalid or has expired" }, requestId: response.locals.requestId });
    return;
  }
  await prisma.$transaction(async (transaction) => {
    await transaction.user.update({ where: { id: reset.userId }, data: { passwordHash: await hashPassword(parsed.data.password), passwordVersion: { increment: 1 }, mustChangePassword: false, failedLoginAttempts: 0, lockedUntil: null } });
    await transaction.passwordResetToken.update({ where: { id: reset.id }, data: { usedAt: new Date() } });
    await transaction.passwordResetToken.updateMany({ where: { userId: reset.userId, usedAt: null, id: { not: reset.id } }, data: { usedAt: new Date() } });
    await transaction.authSession.updateMany({ where: { userId: reset.userId, revokedAt: null }, data: { revokedAt: new Date() } });
    await transaction.auditLog.create({ data: { actorUserId: reset.userId, clientId: reset.user.clientId, action: "PASSWORD_RECOVERY", entityType: "User", entityId: reset.userId, requestId: response.locals.requestId, ipAddress: request.ip, userAgent: request.get("user-agent") } });
  });
  response.status(204).end();
}
