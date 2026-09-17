import type { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../services/prisma.js";
import { verifyPassword } from "../utils/password.js";
import { createAccessToken } from "../utils/token.js";

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });

export async function login(request: Request, response: Response): Promise<void> {
  const parsed = loginSchema.safeParse(request.body);
  if (!parsed.success) { response.status(400).json({ error: "Enter a valid email and password" }); return; }
  const user = await prisma.user.findUnique({ where: { email: parsed.data.email.toLowerCase() }, include: { employee: true } });
  if (!user || !user.isActive || !(await verifyPassword(parsed.data.password, user.passwordHash))) { response.status(401).json({ error: "Email or password is incorrect" }); return; }
  const token = createAccessToken({ sub: user.id, email: user.email, role: user.role });
  response.json({ token, user: { id: user.id, email: user.email, role: user.role, name: user.employee ? `${user.employee.firstName} ${user.employee.lastName}` : user.displayName } });
}
