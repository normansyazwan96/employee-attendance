import type { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../services/prisma.js";
import { verifyPassword } from "../utils/password.js";
import { createAccessToken } from "../utils/token.js";

const loginSchema = z.object({ username: z.string().trim().min(3).max(40).regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/).transform((value) => value.toLowerCase()), password: z.string().min(1) });

export async function login(request: Request, response: Response): Promise<void> {
  const parsed = loginSchema.safeParse(request.body);
  if (!parsed.success) { response.status(400).json({ error: "Enter a valid username and password" }); return; }
  const user = await prisma.user.findUnique({ where: { username: parsed.data.username }, include: { employee: true } });
  if (!user || !user.isActive || !(await verifyPassword(parsed.data.password, user.passwordHash))) { response.status(401).json({ error: "Username or password is incorrect" }); return; }
  const token = createAccessToken({ sub: user.id, username: user.username, role: user.role, passwordVersion: user.passwordVersion });
  response.json({ token, user: { id: user.id, username: user.username, role: user.role, name: user.employee ? `${user.employee.firstName} ${user.employee.lastName}` : user.displayName, mustChangePassword: user.mustChangePassword } });
}
