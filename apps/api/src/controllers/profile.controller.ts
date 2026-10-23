import { Prisma } from "@prisma/client";
import type { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../services/prisma.js";
import { hashPassword, verifyPassword } from "../utils/password.js";
import { createAccessToken } from "../utils/token.js";
import { accessTokenLifetimeSeconds } from "../services/auth-sessions.js";
import { recordAudit } from "../services/audit.js";

const strongPassword = z.string().min(8).max(128).regex(/[a-z]/).regex(/[A-Z]/).regex(/\d/).regex(/[^A-Za-z0-9]/);
const username = z.string().trim().min(3).max(40).regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/).transform((value) => value.toLowerCase());
const profileSchema = z.object({ username, email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()).nullable().optional(), displayName: z.string().trim().min(1).max(120).nullable(), firstName: z.string().trim().min(1).max(80).optional(), lastName: z.string().trim().min(1).max(80).optional(), currentPassword: z.string().min(1).optional(), newPassword: strongPassword.optional() });

function view(user: { id: string; username: string; email: string | null; role: string; displayName: string | null; mustChangePassword: boolean; employee: { firstName: string; lastName: string } | null; mfaCredential: { enabled: boolean } | null }) { return { id: user.id, username: user.username, email: user.email, role: user.role, displayName: user.displayName, firstName: user.employee?.firstName ?? "", lastName: user.employee?.lastName ?? "", mustChangePassword: user.mustChangePassword, mfaEnabled: user.mfaCredential?.enabled ?? false }; }

export async function getProfile(_request: Request, response: Response): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: response.locals.auth.sub }, include: { employee: true, mfaCredential: { select: { enabled: true } } } });
  if (!user) { response.status(404).json({ error: "Profile not found" }); return; }
  response.json({ profile: view(user) });
}

export async function updateProfile(request: Request, response: Response): Promise<void> {
  const parsed = profileSchema.safeParse(request.body);
  if (!parsed.success) { response.status(400).json({ error: "Enter valid profile details and use a password of at least 8 characters with uppercase, lowercase, number, and symbol characters" }); return; }
  const existing = await prisma.user.findUnique({ where: { id: response.locals.auth.sub }, include: { employee: true, mfaCredential: { select: { enabled: true } } } });
  if (!existing) { response.status(404).json({ error: "Profile not found" }); return; }
  if (existing.mustChangePassword && !parsed.data.newPassword) { response.status(400).json({ error: "You must set a new password before continuing" }); return; }
  if (parsed.data.newPassword && (!parsed.data.currentPassword || !(await verifyPassword(parsed.data.currentPassword, existing.passwordHash)))) { response.status(400).json({ error: "Current password is required and must be correct" }); return; }
  if (parsed.data.newPassword && await verifyPassword(parsed.data.newPassword, existing.passwordHash)) { response.status(400).json({ error: "New password must be different from your current password" }); return; }
  try {
    const user = await prisma.$transaction(async (transaction) => {
      const updated = await transaction.user.update({ where: { id: existing.id }, data: { username: parsed.data.username, ...(parsed.data.email !== undefined ? { email: parsed.data.email } : {}), displayName: parsed.data.displayName, ...(parsed.data.newPassword ? { passwordHash: await hashPassword(parsed.data.newPassword), passwordVersion: { increment: 1 }, mustChangePassword: false } : {}), employee: existing.employee && parsed.data.firstName && parsed.data.lastName ? { update: { firstName: parsed.data.firstName, lastName: parsed.data.lastName } } : undefined }, include: { employee: true, mfaCredential: { select: { enabled: true } } } });
      if (parsed.data.newPassword) {
        await transaction.authSession.updateMany({
          where: { userId: existing.id, revokedAt: null, ...(response.locals.auth.sid ? { id: { not: response.locals.auth.sid } } : {}) },
          data: { revokedAt: new Date() },
        });
      }
      return updated;
    });
    await recordAudit({
      actorUserId: user.id,
      clientId: user.clientId ?? undefined,
      action: parsed.data.newPassword ? "PROFILE_AND_PASSWORD_UPDATE" : "PROFILE_UPDATE",
      entityType: "User",
      entityId: user.id,
      details: { usernameChanged: existing.username !== user.username },
      requestId: response.locals.requestId,
      ipAddress: request.ip,
      userAgent: request.get("user-agent"),
    });
    const token = createAccessToken({ sub: user.id, username: user.username, role: user.role, passwordVersion: user.passwordVersion, ...(response.locals.auth.sid ? { sid: response.locals.auth.sid } : {}) }, response.locals.auth.sid ? accessTokenLifetimeSeconds : undefined);
    response.json({ profile: view(user), token });
  } catch (error: unknown) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") { response.status(409).json({ error: "That username is already in use" }); return; }
    throw error;
  }
}
