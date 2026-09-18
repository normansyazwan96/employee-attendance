import { Prisma } from "@prisma/client";
import type { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../services/prisma.js";
import { hashPassword, verifyPassword } from "../utils/password.js";
import { createAccessToken } from "../utils/token.js";

const strongPassword = z.string().min(12).max(128).regex(/[a-z]/).regex(/[A-Z]/).regex(/\d/).regex(/[^A-Za-z0-9]/);
const username = z.string().trim().min(3).max(40).regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/).transform((value) => value.toLowerCase());
const profileSchema = z.object({ username, displayName: z.string().trim().min(1).max(120).nullable(), firstName: z.string().trim().min(1).max(80).optional(), lastName: z.string().trim().min(1).max(80).optional(), currentPassword: z.string().min(1).optional(), newPassword: strongPassword.optional() });

function view(user: { id: string; username: string; role: string; displayName: string | null; mustChangePassword: boolean; employee: { firstName: string; lastName: string } | null }) { return { id: user.id, username: user.username, role: user.role, displayName: user.displayName, firstName: user.employee?.firstName ?? "", lastName: user.employee?.lastName ?? "", mustChangePassword: user.mustChangePassword }; }

export async function getProfile(_request: Request, response: Response): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: response.locals.auth.sub }, include: { employee: true } });
  if (!user) { response.status(404).json({ error: "Profile not found" }); return; }
  response.json({ profile: view(user) });
}

export async function updateProfile(request: Request, response: Response): Promise<void> {
  const parsed = profileSchema.safeParse(request.body);
  if (!parsed.success) { response.status(400).json({ error: "Enter valid profile details and use a password of at least 12 characters with uppercase, lowercase, number, and symbol characters" }); return; }
  const existing = await prisma.user.findUnique({ where: { id: response.locals.auth.sub }, include: { employee: true } });
  if (!existing) { response.status(404).json({ error: "Profile not found" }); return; }
  if (existing.mustChangePassword && !parsed.data.newPassword) { response.status(400).json({ error: "You must set a new password before continuing" }); return; }
  if (parsed.data.newPassword && (!parsed.data.currentPassword || !(await verifyPassword(parsed.data.currentPassword, existing.passwordHash)))) { response.status(400).json({ error: "Current password is required and must be correct" }); return; }
  if (parsed.data.newPassword && await verifyPassword(parsed.data.newPassword, existing.passwordHash)) { response.status(400).json({ error: "New password must be different from your current password" }); return; }
  try {
    const user = await prisma.user.update({ where: { id: existing.id }, data: { username: parsed.data.username, displayName: parsed.data.displayName, ...(parsed.data.newPassword ? { passwordHash: await hashPassword(parsed.data.newPassword), passwordVersion: { increment: 1 }, mustChangePassword: false } : {}), employee: existing.employee && parsed.data.firstName && parsed.data.lastName ? { update: { firstName: parsed.data.firstName, lastName: parsed.data.lastName } } : undefined }, include: { employee: true } });
    const token = createAccessToken({ sub: user.id, username: user.username, role: user.role, passwordVersion: user.passwordVersion });
    response.json({ profile: view(user), token });
  } catch (error: unknown) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") { response.status(409).json({ error: "That username is already in use" }); return; }
    throw error;
  }
}
