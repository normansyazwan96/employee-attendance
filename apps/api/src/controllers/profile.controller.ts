import type { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../services/prisma.js";
import { hashPassword, verifyPassword } from "../utils/password.js";

const profileSchema = z.object({ email: z.string().email().transform((value) => value.toLowerCase()), displayName: z.string().trim().min(1).max(120).nullable(), firstName: z.string().trim().min(1).max(80).optional(), lastName: z.string().trim().min(1).max(80).optional(), currentPassword: z.string().min(1).optional(), newPassword: z.string().min(8).max(128).optional() });

function view(user: { id: string; email: string; role: string; displayName: string | null; employee: { firstName: string; lastName: string } | null }) { return { id: user.id, email: user.email, role: user.role, displayName: user.displayName, firstName: user.employee?.firstName ?? "", lastName: user.employee?.lastName ?? "" }; }

export async function getProfile(_request: Request, response: Response): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: response.locals.auth.sub }, include: { employee: true } });
  if (!user) { response.status(404).json({ error: "Profile not found" }); return; }
  response.json({ profile: view(user) });
}

export async function updateProfile(request: Request, response: Response): Promise<void> {
  const parsed = profileSchema.safeParse(request.body);
  if (!parsed.success) { response.status(400).json({ error: "Enter valid profile details" }); return; }
  const existing = await prisma.user.findUnique({ where: { id: response.locals.auth.sub }, include: { employee: true } });
  if (!existing) { response.status(404).json({ error: "Profile not found" }); return; }
  if (parsed.data.newPassword && (!parsed.data.currentPassword || !(await verifyPassword(parsed.data.currentPassword, existing.passwordHash)))) { response.status(400).json({ error: "Current password is required and must be correct" }); return; }
  const user = await prisma.user.update({ where: { id: existing.id }, data: { email: parsed.data.email, displayName: parsed.data.displayName, ...(parsed.data.newPassword ? { passwordHash: await hashPassword(parsed.data.newPassword) } : {}), employee: existing.employee && parsed.data.firstName && parsed.data.lastName ? { update: { firstName: parsed.data.firstName, lastName: parsed.data.lastName } } : undefined }, include: { employee: true } });
  response.json({ profile: view(user) });
}