import { Role } from "@prisma/client";
import type { Request, Response } from "express";
import { prisma } from "../services/prisma.js";

export async function getAdminClients(_request: Request, response: Response): Promise<void> {
  const auth = response.locals.auth as { sub: string; role: Role };
  if (auth.role === Role.DEV_ADMIN) { response.json({ clients: await prisma.client.findMany({ orderBy: { name: "asc" } }) }); return; }
  const user = await prisma.user.findUnique({ where: { id: auth.sub }, select: { clientId: true } });
  if (!user?.clientId) { response.status(401).json({ error: "A client account is required" }); return; }
  response.json({ clients: await prisma.client.findMany({ where: { id: user.clientId }, orderBy: { name: "asc" } }) });
}
